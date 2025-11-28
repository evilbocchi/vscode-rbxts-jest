import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { activate, deactivate } from "../extension";
import { RbxtsJestTestController } from "../testController";

suite("Extension Activation", () => {
	const workspaceDir = path.resolve(__dirname, "..", "..");
	const workspaceFolder: vscode.WorkspaceFolder = {
		uri: vscode.Uri.file(workspaceDir),
		name: path.basename(workspaceDir),
		index: 0,
	};
	const demoPackage = vscode.Uri.file(path.join(workspaceDir, "demo", "package.json"));

	async function withWorkspaceFolders(overrides: vscode.WorkspaceFolder[] | undefined, run: () => Promise<void>) {
		const descriptor = Object.getOwnPropertyDescriptor(vscode.workspace, "workspaceFolders");
		Object.defineProperty(vscode.workspace, "workspaceFolders", {
			configurable: true,
			get: () => overrides,
		});
		try {
			await run();
		} finally {
			if (descriptor) {
				Object.defineProperty(vscode.workspace, "workspaceFolders", descriptor);
			} else {
				delete (vscode.workspace as { workspaceFolders?: vscode.WorkspaceFolder[] }).workspaceFolders;
			}
		}
	}

	async function runActivationTest(
		findFilesResult: vscode.Uri[],
	): Promise<string[]> {
		const subscriptions: vscode.Disposable[] = [];
		const context = {
			subscriptions,
			extensionUri: vscode.Uri.file(workspaceDir),
		} as unknown as vscode.ExtensionContext;

		const registered: string[] = [];
		const originalFindFiles = vscode.workspace.findFiles;
		const originalRegisterCommand = vscode.commands.registerCommand;

		(vscode.workspace as unknown as { findFiles: typeof vscode.workspace.findFiles }).findFiles = async () =>
			findFilesResult;
		(vscode.commands as unknown as { registerCommand: typeof vscode.commands.registerCommand }).registerCommand = (
			commandId: string,
			callback: (...args: unknown[]) => unknown,
		) => {
			registered.push(commandId);
			return new vscode.Disposable(() => {
				void callback;
			});
		};

		try {
			await activate(context);
			return registered;
		} finally {
			await deactivate();
			while (subscriptions.length > 0) {
				const disposable = subscriptions.pop();
				try {
					disposable?.dispose();
				} catch {
					// Ignore cleanup issues in test environment.
				}
			}
			(vscode.workspace as unknown as { findFiles: typeof vscode.workspace.findFiles }).findFiles = originalFindFiles;
			(vscode.commands as unknown as { registerCommand: typeof vscode.commands.registerCommand }).registerCommand =
				originalRegisterCommand;
		}
	}

	test("registers commands when @rbxts/jest dependency exists", async () => {
		await withWorkspaceFolders([workspaceFolder], async () => {
			const registered = await runActivationTest([demoPackage]);

			assert.ok(
				registered.includes("vscode-rbxts-jest.refreshTests"),
				"Refresh command should be registered",
			);
			assert.ok(registered.includes("vscode-rbxts-jest.runAllTests"), "Run-all command should be registered");
			assert.ok(
				registered.includes("vscode-rbxts-jest.toggleWatchMode"),
				"Toggle-watch-mode command should be registered",
			);
		});
	});

	test("skips command registration when dependency is absent", async () => {
		await withWorkspaceFolders([workspaceFolder], async () => {
			const registered = await runActivationTest([]);
			assert.deepStrictEqual(registered, [], "No commands should be registered when dependency is missing");
		});
	});
});

suite("RbxtsJestTestController", () => {
	let controller: RbxtsJestTestController;
	let context: vscode.ExtensionContext;
	let workspaceRoot: string;
	let subscriptions: vscode.Disposable[];

	suiteSetup(() => {
		const workspace = vscode.workspace.workspaceFolders?.[0];
		workspaceRoot = workspace ? workspace.uri.fsPath : path.resolve(__dirname, "..", "..");
	});

	setup(() => {
		subscriptions = [];
		context = {
			subscriptions,
			extensionUri: vscode.Uri.file(workspaceRoot),
		} as unknown as vscode.ExtensionContext;

		controller = new RbxtsJestTestController(context);
	});

	teardown(() => {
		controller.dispose();
		while (subscriptions.length > 0) {
			const disposable = subscriptions.pop();
			try {
				disposable?.dispose();
			} catch {
				// Ignore cleanup errors to avoid noisy tests.
			}
		}
	});

	function createTestTree() {
		const internal = controller as unknown as { controller: vscode.TestController };
		const internalController = internal.controller;
		const fileUri = vscode.Uri.file(path.join(workspaceRoot, "demo", "src", "__tests__", "add.spec.ts"));
		const fileItem = internalController.createTestItem(fileUri.toString(), "add.spec.ts", fileUri);
		internalController.items.add(fileItem);

		const describeItem = internalController.createTestItem(`${fileItem.id}/Math Suite`, "Math Suite", fileUri);
		fileItem.children.add(describeItem);

		const passingTest = internalController.createTestItem(
			`${describeItem.id}/subtracts numbers?`,
			"subtracts numbers?",
			fileUri,
		);
		const failingTest = internalController.createTestItem(
			`${describeItem.id}/adds numbers`,
			"adds numbers",
			fileUri,
		);

		describeItem.children.add(passingTest);
		describeItem.children.add(failingTest);

		return { passingTest, failingTest };
	}

	test("buildTestNamePattern creates regex for subset of tests", () => {
		const { passingTest, failingTest } = createTestTree();
		const internals = controller as unknown as { buildTestNamePattern(tests: vscode.TestItem[]): string };

		const pattern = internals.buildTestNamePattern([passingTest]);
		assert.strictEqual(pattern, "Math Suite subtracts numbers\\?");

		const fullPattern = internals.buildTestNamePattern([passingTest, failingTest]);
		assert.strictEqual(fullPattern, "");
	});

	test("parseAndReportResults marks pass and fail correctly", () => {
		const { passingTest, failingTest } = createTestTree();
		const internals = controller as unknown as {
			parseAndReportResults(tests: vscode.TestItem[], run: vscode.TestRun, result: TestRunResultShape): void;
		};

		const recorder = createRunRecorder();
		const stdout = [
			" FAIL  demo/src/__tests__/add.spec.ts",
			"  Math Suite",
			"    \u2713 subtracts numbers? (5 ms)",
			"    \u2715 adds numbers (10 ms)",
			"",
		].join("\n");
		const stderr = [
			"  \u25CF Math Suite \u203A adds numbers",
			"",
			"    Expected: 4",
			"    Received: 5",
			"",
		].join("\n");

		const result: TestRunResultShape = {
			exitCode: 1,
			success: false,
			stdout,
			stderr,
		};

		internals.parseAndReportResults([passingTest, failingTest], recorder.run, result);

		assert.deepStrictEqual(recorder.passed, [passingTest], "Passing test should be recorded as passed");
		assert.strictEqual(recorder.failed.length, 1, "Exactly one test should fail");
		assert.strictEqual(recorder.failed[0].test, failingTest, "Failing test should match the expected item");
		assert.strictEqual(
			recorder.failed[0].messages[0],
			"Expected: 4\nReceived: 5",
			"Failure message should extract expected and received values",
		);
		assert.ok(
			recorder.output.join("").includes("Expected: 4"),
			"Run output should preserve captured stdout and stderr",
		);
	});
});

interface TestRunResultShape {
	exitCode: number;
	stdout: string;
	stderr: string;
	success: boolean;
}

interface RunRecorder {
	run: vscode.TestRun;
	passed: vscode.TestItem[];
	failed: Array<{ test: vscode.TestItem; messages: string[] }>;
	output: string[];
}

function createRunRecorder(): RunRecorder {
	const passed: vscode.TestItem[] = [];
	const failed: Array<{ test: vscode.TestItem; messages: string[] }> = [];
	const output: string[] = [];

	const run = {
		enqueued: () => undefined,
		started: () => undefined,
		skipped: () => undefined,
		errored: () => undefined,
		appendOutput: (chunk: string) => {
			output.push(chunk);
		},
		end: () => undefined,
		failed: (test: vscode.TestItem, message: vscode.TestMessage | vscode.TestMessage[]) => {
			const messages = Array.isArray(message) ? message : [message];
			failed.push({
				test,
				messages: messages.map((msg) => {
					if (typeof msg.message === "string") {
						return msg.message;
					}
					return msg.message.value ?? "";
				}),
			});
		},
		passed: (test: vscode.TestItem) => {
			passed.push(test);
		},
	} as unknown as vscode.TestRun;

	return { run, passed, failed, output };
}
