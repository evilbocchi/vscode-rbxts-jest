import dotenv from "dotenv";
import * as rbxluau from "rbxluau";

// Load environment variables from .env file
dotenv.config({ quiet: true });

// Get test filter from environment variable (set by VS Code extension)
const testNamePattern = process.env.JEST_TEST_NAME_PATTERN || "";

// Build the Luau script with optional test filter
let luauScript = "local output = require(game.ReplicatedStorage.src.runTests)";
if (testNamePattern) {
	// Escape the pattern for Lua string
	const escapedPattern = testNamePattern.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
	luauScript += `("${escapedPattern}")`;
} else {
	luauScript += "()";
}

rbxluau.executeLuau(luauScript, {
	place: "place.rbxl",
});
