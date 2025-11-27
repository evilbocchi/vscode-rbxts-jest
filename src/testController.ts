import * as vscode from "vscode";
import * as path from "path";
import { TestParser, TestItem as ParsedTestItem } from "./testParser";

export class RbxtsJestTestController {
    private controller: vscode.TestController;
    private testParser: TestParser;
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private testItemMap: Map<string, vscode.TestItem> = new Map();

    constructor(private context: vscode.ExtensionContext) {
        this.controller = vscode.tests.createTestController("rbxts-jest-tests", "rbxts-jest Tests");
        this.testParser = new TestParser();

        // Create run profile for running tests
        this.controller.createRunProfile(
            "Run Tests",
            vscode.TestRunProfileKind.Run,
            (request, token) => this.runTests(request, token),
            true,
        );

        // Set up the resolve handler for lazy test discovery
        this.controller.resolveHandler = async (item) => {
            if (!item) {
                await this.discoverAllTests();
            }
        };

        context.subscriptions.push(this.controller);
        this.setupFileWatcher();
    }

    private setupFileWatcher(): void {
        const config = vscode.workspace.getConfiguration("rbxts-jest");
        const testPatterns = config.get<string[]>("testMatch") || ["**/__tests__/**/*.spec.ts", "**/*.spec.ts"];

        // Watch for changes in test files
        this.fileWatcher = vscode.workspace.createFileSystemWatcher("**/*.spec.ts");

        this.fileWatcher.onDidCreate((uri) => this.onTestFileChanged(uri));
        this.fileWatcher.onDidChange((uri) => this.onTestFileChanged(uri));
        this.fileWatcher.onDidDelete((uri) => this.onTestFileDeleted(uri));

        this.context.subscriptions.push(this.fileWatcher);
    }

    private async onTestFileChanged(uri: vscode.Uri): Promise<void> {
        await this.parseTestFile(uri);
    }

    private onTestFileDeleted(uri: vscode.Uri): void {
        const testId = uri.toString();
        const existingItem = this.testItemMap.get(testId);
        if (existingItem) {
            this.controller.items.delete(existingItem.id);
            this.testItemMap.delete(testId);
        }
    }

    public async discoverAllTests(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }

        // Clear existing tests
        this.controller.items.replace([]);
        this.testItemMap.clear();

        for (const folder of workspaceFolders) {
            await this.discoverTestsInFolder(folder);
        }
    }

    private async discoverTestsInFolder(folder: vscode.WorkspaceFolder): Promise<void> {
        const config = vscode.workspace.getConfiguration("rbxts-jest");
        const testPatterns = config.get<string[]>("testMatch") || ["**/__tests__/**/*.spec.ts", "**/*.spec.ts"];

        for (const pattern of testPatterns) {
            const files = await vscode.workspace.findFiles(
                new vscode.RelativePattern(folder, pattern),
                "**/node_modules/**",
            );

            for (const file of files) {
                await this.parseTestFile(file);
            }
        }
    }

    private async parseTestFile(uri: vscode.Uri): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            const content = document.getText();
            const tests = this.testParser.parseTestFile(content, uri.fsPath);

            // Create or update the file test item
            const fileId = uri.toString();
            const fileName = path.basename(uri.fsPath);

            let fileItem = this.testItemMap.get(fileId);
            if (!fileItem) {
                fileItem = this.controller.createTestItem(fileId, fileName, uri);
                this.controller.items.add(fileItem);
                this.testItemMap.set(fileId, fileItem);
            }

            // Clear existing children
            fileItem.children.replace([]);

            // Add describe blocks and tests
            this.addTestItems(fileItem, tests, uri);
        } catch (error) {
            console.error(`Error parsing test file ${uri.fsPath}:`, error);
        }
    }

    private addTestItems(parent: vscode.TestItem, tests: ParsedTestItem[], uri: vscode.Uri): void {
        for (const test of tests) {
            const testId = `${parent.id}/${test.name}`;
            const testItem = this.controller.createTestItem(testId, test.name, uri);

            // Set the range for navigation
            testItem.range = new vscode.Range(new vscode.Position(test.line, 0), new vscode.Position(test.line, 100));

            // Add any nested tests (for describe blocks)
            if (test.children && test.children.length > 0) {
                this.addTestItems(testItem, test.children, uri);
            }

            parent.children.add(testItem);
            this.testItemMap.set(testId, testItem);
        }
    }

    private async runTests(request: vscode.TestRunRequest, token: vscode.CancellationToken): Promise<void> {
        const run = this.controller.createTestRun(request);
        const queue: vscode.TestItem[] = [];

        // Collect all tests to run
        if (request.include) {
            request.include.forEach((item) => this.collectTests(item, queue));
        } else {
            this.controller.items.forEach((item) => this.collectTests(item, queue));
        }

        // Filter out excluded tests
        const testsToRun = queue.filter((test) => !request.exclude?.some((excluded) => excluded.id === test.id));

        // Mark all tests as queued
        for (const test of testsToRun) {
            run.enqueued(test);
        }

        if (token.isCancellationRequested) {
            run.end();
            return;
        }

        // Run the tests
        await this.executeTests(testsToRun, run, token);

        run.end();
    }

    private collectTests(item: vscode.TestItem, queue: vscode.TestItem[]): void {
        // If it's a leaf node (actual test), add it
        if (item.children.size === 0) {
            queue.push(item);
        } else {
            // Add the item itself (describe block) and all children
            queue.push(item);
            item.children.forEach((child) => this.collectTests(child, queue));
        }
    }

    private async executeTests(
        tests: vscode.TestItem[],
        run: vscode.TestRun,
        token: vscode.CancellationToken,
    ): Promise<void> {
        const config = vscode.workspace.getConfiguration("rbxts-jest");
        const demoPath = config.get<string>("demoPath") || "demo";

        // Build test name pattern for filtering
        const testNamePattern = this.buildTestNamePattern(tests);

        // Mark tests as started
        for (const test of tests) {
            run.started(test);
        }

        try {
            // Execute the test runner
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error("No workspace folder found");
            }

            // Try to find the test runner folder
            const fs = require("fs");
            const workspaceRoot = workspaceFolder.uri.fsPath;

            // Check multiple possible locations for package.json with test script
            const possiblePaths = [
                workspaceRoot, // Current workspace root
                path.join(workspaceRoot, demoPath), // Configured demo path
                path.join(workspaceRoot, ".."), // Parent folder (if workspace is demo)
            ];

            let testFolder: string | undefined;
            for (const testPath of possiblePaths) {
                const packageJsonPath = path.join(testPath, "package.json");
                if (fs.existsSync(packageJsonPath)) {
                    try {
                        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
                        if (packageJson.scripts?.test) {
                            testFolder = testPath;
                            break;
                        }
                    } catch {
                        // Continue to next path
                    }
                }
            }

            if (!testFolder) {
                throw new Error(`Could not find a folder with a test script. Searched: ${possiblePaths.join(", ")}`);
            }

            // Run npm test in the found folder with the test filter
            const result = await this.runTestCommand(testFolder, token, testNamePattern);

            // Parse results and update test states
            this.parseAndReportResults(tests, run, result);
        } catch (error) {
            // Mark all tests as errored
            for (const test of tests) {
                run.errored(
                    test,
                    new vscode.TestMessage(
                        `Test execution failed: ${error instanceof Error ? error.message : String(error)}`,
                    ),
                );
            }
        }
    }

    /**
     * Build a Jest testNamePattern regex from the selected tests
     * Returns empty string to run all tests
     */
    private buildTestNamePattern(tests: vscode.TestItem[]): string {
        // Get only leaf tests (actual it() blocks, not describe blocks or files)
        const leafTests = tests.filter(t => t.children.size === 0);
        
        if (leafTests.length === 0) {
            return ""; // Run all tests
        }

        // Count total leaf tests in the entire test tree
        const totalLeafTests = this.countAllLeafTests();

        if (leafTests.length >= totalLeafTests) {
            return ""; // Running all tests, no filter needed
        }

        // Build pattern from test names
        // We need to build the full path: "describe name test name"
        const testPatterns = leafTests.map(test => {
            const fullName = this.getFullTestName(test);
            // Escape regex special characters in the test name
            return this.escapeRegex(fullName);
        });

        // Join with | for OR matching
        return testPatterns.join("|");
    }

    private countAllLeafTests(): number {
        let count = 0;
        const countInItem = (item: vscode.TestItem): void => {
            if (item.children.size === 0) {
                count++;
            } else {
                item.children.forEach(child => countInItem(child));
            }
        };
        this.controller.items.forEach(item => countInItem(item));
        return count;
    }

    /**
     * Get the full test name including parent describe blocks
     * e.g., "add fails when expecting 5 + 5 to equal 30"
     */
    private getFullTestName(item: vscode.TestItem): string {
        const parts: string[] = [];
        let current: vscode.TestItem | undefined = item;
        
        while (current) {
            // Skip file-level items (where id equals the file URI)
            const isFileLevel = current.uri && current.id === current.uri.toString();
            if (!isFileLevel) {
                parts.unshift(current.label);
            }
            current = this.findParent(current);
        }
        
        return parts.join(" ");
    }

    private findParent(item: vscode.TestItem): vscode.TestItem | undefined {
        // Find parent by checking if any item contains this one as a child
        let parent: vscode.TestItem | undefined;
        
        const searchInItem = (searchItem: vscode.TestItem): boolean => {
            let found = false;
            searchItem.children.forEach(child => {
                if (child.id === item.id) {
                    parent = searchItem;
                    found = true;
                } else if (!found) {
                    found = searchInItem(child);
                }
            });
            return found;
        };

        this.controller.items.forEach(rootItem => {
            if (!parent) {
                searchInItem(rootItem);
            }
        });

        return parent;
    }

    private async runTestCommand(
        cwd: string,
        token: vscode.CancellationToken,
        testNamePattern: string = "",
    ): Promise<TestRunResult> {
        // Check if the directory exists
        const fs = require("fs");
        if (!fs.existsSync(cwd)) {
            return {
                exitCode: 1,
                stdout: "",
                stderr: `Demo folder not found: ${cwd}`,
                success: false,
            };
        }

        return new Promise((resolve, reject) => {
            const cp = require("child_process");

            // Use exec instead of spawn for better cross-platform compatibility
            const command = "npm test";
            let cancelled = false;



            // Pass test name pattern via environment variable
            const env = { ...process.env };
            if (testNamePattern) {
                env.JEST_TEST_NAME_PATTERN = testNamePattern;
            }

            const proc = cp.exec(
                command,
                {
                    cwd,
                    env,
                    maxBuffer: 10 * 1024 * 1024, // 10MB buffer
                    windowsHide: true,
                },
                (error: Error | null, stdout: string, stderr: string) => {
                    if (cancelled) {
                        reject(new Error("Test run cancelled"));
                        return;
                    }

                    resolve({
                        exitCode: error ? 1 : 0,
                        stdout: stdout || "",
                        stderr: stderr || "",
                        success: !error,
                    });
                },
            );

            proc.on("error", (err: Error) => {
                console.error("Process error:", err);
                resolve({
                    exitCode: 1,
                    stdout: "",
                    stderr: `Failed to start process: ${err.message}`,
                    success: false,
                });
            });

            token.onCancellationRequested(() => {
                cancelled = true;
                proc.kill();
            });
        });
    }

    private parseAndReportResults(tests: vscode.TestItem[], run: vscode.TestRun, result: TestRunResult): void {
        const output = result.stdout + "\n" + result.stderr;



        // Parse the Jest output to determine which tests passed/failed
        // Jest-lua uses similar format to Jest:
        // ✓ test name (time) - for passing
        // ✕ test name - for failing

        for (const test of tests) {
            // Check if this is a file-level or describe-level item
            if (test.children.size > 0) {
                // Skip parent items, they'll be handled by their children
                continue;
            }

            const testName = test.label;
            const escapedName = this.escapeRegex(testName);

            // Look for test results in the output
            // Handle various pass/fail symbols
            const passPattern = new RegExp(`[✓✔√]\\s*${escapedName}`, "i");
            const failPattern = new RegExp(`[✕✗×✘]\\s*${escapedName}`, "i");

            // Also check for the test name in error sections (● marker)
            const inErrorSection = new RegExp(`●[^●]*${escapedName}`, "is");

            // Determine test result
            const hasFail = failPattern.test(output) || inErrorSection.test(output);
            const hasPass = passPattern.test(output);

            if (hasFail) {
                // Extract error message for this specific test
                const message = this.extractErrorMessage(output, testName);
                run.failed(test, new vscode.TestMessage(message));
            } else if (hasPass) {
                run.passed(test);
            } else {
                // Couldn't determine - use exit code
                if (result.success) {
                    run.passed(test);
                } else {
                    run.failed(test, new vscode.TestMessage(`Test may have failed. Check output for details.`));
                }
            }
        }

        // Append the full output to the run
        run.appendOutput(output.replace(/\r?\n/g, "\r\n"));
    }

    private extractErrorMessage(output: string, testName: string): string {
        // Try to find the error block for this test
        // Jest-lua format typically shows:
        // ● describe › test name
        //   Expected: X
        //   Received: Y

        const escapedName = this.escapeRegex(testName);

        // Look for the error section containing this test name
        const errorBlockPattern = new RegExp(`●[^●]*?${escapedName}[^●]*?(?=●|Test Suites:|$)`, "is");

        const errorBlock = output.match(errorBlockPattern);

        if (errorBlock) {
            const block = errorBlock[0];

            // Extract Expected and Received values
            const expectedMatch = block.match(/Expected:\s*(.+?)(?:\n|$)/i);
            const receivedMatch = block.match(/Received:\s*(.+?)(?:\n|$)/i);

            if (expectedMatch && receivedMatch) {
                return `Expected: ${expectedMatch[1].trim()}\nReceived: ${receivedMatch[1].trim()}`;
            }

            // Try alternate format: "expect(received).toBe(expected)"
            const toBeMatch = block.match(/expect\s*\(\s*received\s*\)\.toBe\s*\(\s*expected\s*\)/i);
            if (toBeMatch) {
                const exp = block.match(/Expected:\s*(.+?)(?:\n|$)/i);
                const rec = block.match(/Received:\s*(.+?)(?:\n|$)/i);
                if (exp && rec) {
                    return `Expected: ${exp[1].trim()}\nReceived: ${rec[1].trim()}`;
                }
            }

            // Return a trimmed version of the error block
            const trimmed = block.substring(0, 300).trim();
            return trimmed || `Test failed: ${testName}`;
        }

        // Fallback: try to find any Expected/Received near the test name
        const nearbyPattern = new RegExp(
            `${escapedName}[\\s\\S]{0,200}?Expected:\\s*([^\\n]+)[\\s\\S]{0,50}?Received:\\s*([^\\n]+)`,
            "i",
        );
        const nearbyMatch = output.match(nearbyPattern);

        if (nearbyMatch) {
            return `Expected: ${nearbyMatch[1].trim()}\nReceived: ${nearbyMatch[2].trim()}`;
        }

        return `Test failed: ${testName}`;
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    public dispose(): void {
        this.controller.dispose();
        this.fileWatcher?.dispose();
    }
}

interface TestRunResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    success: boolean;
}
