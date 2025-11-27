import { runCLI } from "@rbxts/jest";
import { ReplicatedStorage, ServerStorage } from "@rbxts/services";

export = () => {
	// force chalk to load with the right color level
	const [chalkSuccess, Chalk] = import("@rbxts-js/chalk-lua").await();
	if (chalkSuccess) {
		(Chalk as unknown as { level: number }).level = 3;
	}

	const cwd = script.Parent!;

	// run jest
	const [success, output] = runCLI(
		cwd,
		{
			setupFiles: [cwd.FindFirstChild("setup") as ModuleScript],
		},
		[cwd],
	).await();

	print(output);
};
