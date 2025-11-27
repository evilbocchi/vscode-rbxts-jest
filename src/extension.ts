import * as vscode from 'vscode';
import { RbxtsJestTestController } from './testController';

let testController: RbxtsJestTestController | undefined;

export function activate(context: vscode.ExtensionContext) {
	console.log('rbxts-jest extension is now active!');

	// Create the test controller
	testController = new RbxtsJestTestController(context);

	// Register the refresh command
	const refreshCommand = vscode.commands.registerCommand('vscode-rbxts-jest.refreshTests', async () => {
		if (testController) {
			await testController.discoverAllTests();
			vscode.window.showInformationMessage('Tests refreshed!');
		}
	});

	// Register the run all tests command
	const runAllCommand = vscode.commands.registerCommand('vscode-rbxts-jest.runAllTests', async () => {
		// This will trigger running all tests through the test explorer
		await vscode.commands.executeCommand('testing.runAll');
	});

	context.subscriptions.push(refreshCommand, runAllCommand);

	// Initial test discovery
	testController.discoverAllTests();
}

export function deactivate() {
	if (testController) {
		testController.dispose();
		testController = undefined;
	}
}
