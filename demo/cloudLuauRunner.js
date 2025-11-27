import axios from "axios";
import fs from "fs";
import path from "path";

async function createTask({ axiosInstance, executionKey, universeId, placeId, scriptContents, placeVersion }) {
	const baseUrl = `https://apis.roblox.com/cloud/v2/universes/${universeId}/places/${placeId}`;
	const url = placeVersion
		? `${baseUrl}/versions/${placeVersion}/luau-execution-session-tasks`
		: `${baseUrl}/luau-execution-session-tasks`;

	const response = await axiosInstance({
		method: "post",
		url,
		data: {
			script: scriptContents,
			timeout: "60s",
		},
		headers: {
			"x-api-key": executionKey,
			"Content-Type": "application/json",
		},
	});

	return response.data;
}

async function pollForTaskCompletion({ axiosInstance, executionKey, taskPath }) {
	let task = null;

	while (!task || (task.state !== "COMPLETE" && task.state !== "FAILED")) {
		await new Promise((resolve) => setTimeout(resolve, 300));

		const response = await axiosInstance.get(`https://apis.roblox.com/cloud/v2/${taskPath}`, {
			headers: {
				"x-api-key": executionKey,
			},
		});

		task = response.data;
	}

	if (typeof process?.stdout?.write === "function") {
		process.stdout.write("\r" + " ".repeat(80) + "\r");
	}

	return task;
}

async function getTaskLogs({ axiosInstance, executionKey, taskPath }) {
	const response = await axiosInstance.get(`https://apis.roblox.com/cloud/v2/${taskPath}/logs`, {
		headers: {
			"x-api-key": executionKey,
		},
	});

	return response.data;
}

function analyzeTaskLogs(logs) {
	let failedTests = 0;
	let totalTests = 0;

	const groups = logs?.luauExecutionSessionTaskLogs;
	if (!Array.isArray(groups)) {
		return { failedTests, totalTests };
	}

	for (const entry of groups) {
		if (!entry || !Array.isArray(entry.messages)) {
			continue;
		}

		for (const raw of entry.messages) {
			const message = typeof raw === "string" ? raw : JSON.stringify(raw);
			console.log(message);

			const testResultMatch = message.match(/(\d+)\s+passed,\s+(\d+)\s+failed,\s+(\d+)\s+skipped/);
			if (testResultMatch) {
				const passed = Number.parseInt(testResultMatch[1], 10);
				const failed = Number.parseInt(testResultMatch[2], 10);
				const skipped = Number.parseInt(testResultMatch[3], 10);

				if (Number.isFinite(passed) && Number.isFinite(failed) && Number.isFinite(skipped)) {
					totalTests += passed + failed + skipped;
				}

				if (Number.isFinite(failed)) {
					failedTests += failed;
				}
			}

			const suiteSummaryMatch = message.match(/Test Suites:\s+(\d+)\s+failed/);
			if (suiteSummaryMatch) {
				const failed = Number.parseInt(suiteSummaryMatch[1], 10);
				if (Number.isFinite(failed)) {
					failedTests += failed;
				}
			}
		}
	}

	return { failedTests, totalTests };
}

async function runLuauExecution({ axiosInstance, executionKey, universeId, placeId, placeVersion, scriptContents }) {
	const task = await createTask({
		axiosInstance,
		executionKey,
		universeId,
		placeId,
		scriptContents,
		placeVersion,
	});

	const completedTask = await pollForTaskCompletion({
		axiosInstance,
		executionKey,
		taskPath: task.path,
	});

	const logs = await getTaskLogs({
		axiosInstance,
		executionKey,
		taskPath: task.path,
	});

	const { failedTests } = analyzeTaskLogs(logs);

	if (completedTask.state === "COMPLETE") {
		if (failedTests > 0) {
			console.error(`Luau task completed but ${failedTests} test(s) failed`);
			return false;
		}

		return true;
	}

	const errorCode = completedTask.error?.code ?? "UNKNOWN";
	const errorMessage = completedTask.error?.message ?? "Luau task failed";
	console.error(`${errorCode} ${errorMessage}`);
	console.error("Luau task failed");
	return false;
}

export async function runCloudLuau(scriptFile, options = {}) {
	const {
		scriptContents: inlineScriptContents,
		executionKey = process.env.LUAU_EXECUTION_KEY,
		universeId = process.env.LUAU_EXECUTION_UNIVERSE_ID,
		placeId = process.env.LUAU_EXECUTION_PLACE_ID,
		placeVersion = process.env.PLACE_VERSION ?? null,
		axiosInstance = axios,
	} = options;

	const headersDefaults = (axiosInstance.defaults.headers ||= {});
	const commonHeaders = (headersDefaults.common ||= {});
	if (!commonHeaders["User-Agent"]) {
		commonHeaders["User-Agent"] = "Node.js/Roblox-Test-Runner";
	}

	let scriptContents = inlineScriptContents ?? null;
	let resolvedScriptPath = null;

	if (!scriptContents) {
		if (!scriptFile) {
			throw new Error("runCloudLuau requires a script file path or scriptContents option.");
		}

		resolvedScriptPath = path.resolve(scriptFile);
		scriptContents = fs.readFileSync(resolvedScriptPath, "utf8");
	} else if (scriptFile) {
		resolvedScriptPath = path.resolve(scriptFile);
	}

	return runLuauExecution({
		axiosInstance,
		executionKey,
		universeId,
		placeId,
		placeVersion,
		scriptContents,
		scriptSource: resolvedScriptPath,
	});
}
