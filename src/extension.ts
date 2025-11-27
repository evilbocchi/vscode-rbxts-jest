import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { RbxtsJestTestController } from "./testController";

let testController: RbxtsJestTestController | undefined;
let watchModeEnabled = false;
let watchModeStatusBar: vscode.StatusBarItem | undefined;
let sourceFileWatcher: vscode.FileSystemWatcher | undefined;
let debounceTimer: NodeJS.Timeout | undefined;
let isRunningTests = false;

/**
 * Check if @rbxts/jest is in the dependencies of any package.json in the workspace
 */
async function hasRbxtsJestDependency(): Promise<boolean> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return false;
    }

    for (const folder of workspaceFolders) {
        // Search for package.json files in the workspace
        const packageJsonFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, "**/package.json"),
            "**/node_modules/**",
        );

        for (const file of packageJsonFiles) {
            try {
                const content = fs.readFileSync(file.fsPath, "utf-8");
                const packageJson = JSON.parse(content);

                // Check dependencies and devDependencies
                const deps = packageJson.dependencies || {};
                const devDeps = packageJson.devDependencies || {};

                if (deps["@rbxts/jest"] || devDeps["@rbxts/jest"]) {
                    return true;
                }
            } catch {
                // Ignore invalid package.json files
            }
        }
    }

    return false;
}

export async function activate(context: vscode.ExtensionContext) {
    // Check if @rbxts/jest is in the workspace dependencies
    const hasJest = await hasRbxtsJestDependency();
    if (!hasJest) {
        // Silently return - extension won't activate without @rbxts/jest
        return;
    }

    console.log("rbxts-jest extension is now active!");

    // Create the test controller
    testController = new RbxtsJestTestController(context);

    // Register the refresh command
    const refreshCommand = vscode.commands.registerCommand("vscode-rbxts-jest.refreshTests", async () => {
        if (testController) {
            await testController.discoverAllTests();
            vscode.window.showInformationMessage("Tests refreshed!");
        }
    });

    // Register the run all tests command
    const runAllCommand = vscode.commands.registerCommand("vscode-rbxts-jest.runAllTests", async () => {
        // This will trigger running all tests through the test explorer
        await vscode.commands.executeCommand("testing.runAll");
    });

    // Register the watch mode toggle command
    const watchModeCommand = vscode.commands.registerCommand("vscode-rbxts-jest.toggleWatchMode", () => {
        toggleWatchMode(context);
    });

    // Create status bar item for watch mode
    watchModeStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    watchModeStatusBar.command = "vscode-rbxts-jest.toggleWatchMode";
    updateWatchModeStatusBar();
    watchModeStatusBar.show();

    context.subscriptions.push(refreshCommand, runAllCommand, watchModeCommand, watchModeStatusBar);

    // Initial test discovery
    testController.discoverAllTests();
}

export function deactivate() {
    if (testController) {
        testController.dispose();
        testController = undefined;
    }
    if (sourceFileWatcher) {
        sourceFileWatcher.dispose();
        sourceFileWatcher = undefined;
    }
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
}

function toggleWatchMode(context: vscode.ExtensionContext): void {
    watchModeEnabled = !watchModeEnabled;
    updateWatchModeStatusBar();

    if (watchModeEnabled) {
        setupSourceFileWatcher(context);
        vscode.window.showInformationMessage("rbxts-jest: Watch mode enabled. Tests will re-run on file changes.");
    } else {
        if (sourceFileWatcher) {
            sourceFileWatcher.dispose();
            sourceFileWatcher = undefined;
        }
        vscode.window.showInformationMessage("rbxts-jest: Watch mode disabled.");
    }
}

function updateWatchModeStatusBar(): void {
    if (!watchModeStatusBar) {
        return;
    }

    if (watchModeEnabled) {
        watchModeStatusBar.text = "$(eye) Jest Watch: ON";
        watchModeStatusBar.tooltip = "Click to disable watch mode";
        watchModeStatusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    } else {
        watchModeStatusBar.text = "$(eye-closed) Jest Watch: OFF";
        watchModeStatusBar.tooltip = "Click to enable watch mode";
        watchModeStatusBar.backgroundColor = undefined;
    }
}

function setupSourceFileWatcher(context: vscode.ExtensionContext): void {
    // Dispose existing watcher if any
    if (sourceFileWatcher) {
        sourceFileWatcher.dispose();
    }

    const config = vscode.workspace.getConfiguration("rbxts-jest");
    const watchPatterns = config.get<string[]>("watchPatterns") || ["**/*.ts", "**/*.tsx", "**/*.lua", "**/*.luau"];
    const debounceDelay = config.get<number>("watchDebounceDelay") || 500;

    // Create a composite pattern
    const pattern = `{${watchPatterns.join(",")}}`;
    sourceFileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    const onFileChange = (uri: vscode.Uri) => {
        // Ignore if tests are already running
        if (isRunningTests) {
            return;
        }

        const filePath = uri.fsPath.toLowerCase();

        // Ignore node_modules and output directories
        if (filePath.includes("node_modules") || 
            filePath.includes("\\out\\") || 
            filePath.includes("/out/") ||
            filePath.includes("\\include\\") ||
            filePath.includes("/include/")) {
            return;
        }

        // Ignore binary/generated files
        if (filePath.endsWith(".rbxl") || 
            filePath.endsWith(".rbxlx") || 
            filePath.endsWith(".rbxm") || 
            filePath.endsWith(".rbxmx") ||
            filePath.endsWith(".d.ts") ||
            filePath.endsWith(".js") ||
            filePath.endsWith(".map")) {
            return;
        }

        // Debounce to avoid running tests too frequently
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(async () => {
            if (watchModeEnabled && !isRunningTests) {
                isRunningTests = true;
                
                try {
                    // Update status bar to show running
                    if (watchModeStatusBar) {
                        watchModeStatusBar.text = "$(sync~spin) Jest Watch: Running...";
                    }

                    // Refresh test discovery for test files
                    if (uri.fsPath.includes(".spec.")) {
                        await testController?.discoverAllTests();
                    }

                    // Run all tests
                    await vscode.commands.executeCommand("testing.runAll");
                } finally {
                    isRunningTests = false;
                    // Restore status bar
                    updateWatchModeStatusBar();
                }
            }
        }, debounceDelay);
    };

    sourceFileWatcher.onDidChange(onFileChange);
    sourceFileWatcher.onDidCreate(onFileChange);
    sourceFileWatcher.onDidDelete(onFileChange);

    context.subscriptions.push(sourceFileWatcher);
}
