import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { runCloudLuau } from "./cloudLuauRunner.js";

dotenv.config({ quiet: true });

const PLACE_FILE_PATH = path.join(import.meta.dirname, "place.rbxl");

// Check if place file exists
if (!fs.existsSync(PLACE_FILE_PATH)) {
	console.error(`Place file not found: ${PLACE_FILE_PATH}`);
	process.exit(1);
}

const API_KEY = process.env.LUAU_EXECUTION_KEY;
const UNIVERSE_ID = process.env.LUAU_EXECUTION_UNIVERSE_ID;
const PLACE_ID = process.env.LUAU_EXECUTION_PLACE_ID;

const placeFileBuffer = fs.readFileSync(PLACE_FILE_PATH);
const response = await axios({
	method: "post",
	url: `https://apis.roblox.com/universes/v1/${UNIVERSE_ID}/places/${PLACE_ID}/versions?versionType=Saved`,
	data: placeFileBuffer,
	headers: {
		"x-api-key": API_KEY,
		"Content-Type": "application/octet-stream",
		"User-Agent": "Node.js/Roblox-Place-Publisher",
	},
	maxBodyLength: Infinity,
	maxContentLength: Infinity,
});
const PLACE_VERSION = response.data.versionNumber;

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

const cloudResult = await runCloudLuau(PLACE_FILE_PATH, {
	scriptContents: luauScript,
	placeVersion: PLACE_VERSION,
});

if (cloudResult === true) {
	process.exit(0);
} else if (cloudResult === false) {
	console.error("Cloud tests failed.");
	process.exit(1);
} else {
	console.warn("Cloud tests could not run; environment variables may be missing.");
	process.exit(0);
}
