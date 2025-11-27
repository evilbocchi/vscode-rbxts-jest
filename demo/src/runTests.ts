import { runCLI } from "@rbxts/jest";

// Accept optional test filter pattern
// This can be passed from the VS Code extension to run specific tests
export = (testNamePattern?: string) => {
	// force chalk to load with the right color level
	const [chalkSuccess, Chalk] = import("@rbxts-js/chalk-lua").await();
	if (chalkSuccess) {
		(Chalk as unknown as { level: number }).level = 3;
	}

	const cwd = script.Parent!;

	// Build Jest options
	const jestOptions: { setupFiles: ModuleScript[]; testNamePattern?: string } = {
		setupFiles: [cwd.FindFirstChild("setup") as ModuleScript],
	};

	// Add test name filter if provided
	if (testNamePattern !== undefined && testNamePattern !== "") {
		jestOptions.testNamePattern = testNamePattern;
	}

	// run jest
	runCLI(cwd, jestOptions, [cwd]).await();
};
