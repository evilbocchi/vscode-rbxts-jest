<div align="center">
    <img src="./branding/logo.png/" width="128" height="128"/>
</div>

# rbxts-jest VS Code Extension

Run your [roblox-ts](https://roblox-ts.com/) Jest tests directly from the VS Code Testing sidebar. This extension watches your TypeScript spec files, discovers the `describe`/`it` tree, and executes the suite through your project-provided `npm test` script so results flow back into the editor.

## Highlights
- **Automatic discovery** of `*.spec.ts` files and nested `describe` / `it` blocks.
- **Testing sidebar integration** with run, debug, and rerun actions powered by the VS Code Testing API.
- **On-demand commands** to refresh test metadata or execute the whole suite.
- **Selective execution** by forwarding VS Code's selection filter to Jest via `JEST_TEST_NAME_PATTERN`.
- **Roblox Cloud ready**: ships with a sample runner that forwards results from Roblox Cloud Luau execution.

## Requirements
- VS Code 1.106.0 or newer.
- Node.js 18+ (needed for the extension host and the demo project scripts).
- A workspace with an `npm test` script that ultimately runs your Jest-Luau tests. The included demo uses [rbxluau](https://github.com/Unreal-Works/roblox-luau-execute) to run tests in the Roblox Cloud.

> **Tip:** The extension looks for a `package.json` with a `test` script in the workspace root, in the configured `rbxtsProjectPath`, or one directory above the workspace. Make sure one of those locations exposes an appropriate runner.

## Getting Started
1. Install the extension (from the Marketplace or by running `npm install && npm run compile` and using VS Code's `Install from VSIX...`).
2. Open a roblox-ts project that includes Jest specs (default glob: `**/__tests__/**/*.spec.ts` and `**/*.spec.ts`).
3. Ensure your `npm test` script builds any required assets and returns a zero exit code on success.
4. Open the **Testing** view (`Ctrl+Shift+`\``) to see the discovered test tree.
5. Run or debug individual tests, suites, or the full workspace using the inline buttons or commands below.

## Commands
- `rbxts-jest: Refresh Tests` (command id: `vscode-rbxts-jest.refreshTests`)
  - Rebuilds the test tree. Runs automatically on activation and when files change.
- `rbxts-jest: Run All Tests` (command id: `vscode-rbxts-jest.runAllTests`)
  - Invokes VS Code's `testing.runAll` for the rbxts-jest controller.

You can access these commands from the Command Palette (`Ctrl+Shift+P`) or map them to custom keybindings.

## Configuration
`rbxts-jest` contributes settings under `Settings → Extensions → rbxts-jest`:

| Setting                | Default                                         | Description                                                                                                           |
| ---------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `rbxts-jest.testMatch` | `["**/__tests__/**/*.spec.ts", "**/*.spec.ts"]` | Glob patterns used during discovery.                                                                                  |
| `rbxts-jest.rbxtsProjectPath`  | None                                        | Fallback location inspected for a `package.json` with a `test` script. Update if you keep the bundled roblox-ts project elsewhere. |

## How Test Execution Works
1. **Discovery**: `TestParser` scans each matching spec file to build a nested tree of `describe` and `it` nodes.
2. **Run request**: Starting a run collects all selected leaf nodes (individual tests) and their parents.
3. **Filtering**: If you triggered a subset of tests, the extension builds a `JEST_TEST_NAME_PATTERN` regex from their full names. Your `npm test` script can read this env var to filter execution.
4. **Execution**: `npm test` is executed from the first folder that exposes the script (workspace root, `rbxtsProjectPath`, or parent). The bundled demo compiles the project, republishes the `place.rbxl`, and calls Roblox Cloud Luau to execute `src/runTests.ts`.
5. **Result parsing**: Standard Jest glyphs (`✓`, `✕`, `●`, etc.) in stdout/stderr are mapped back to VS Code test results so passes, failures, and messages appear inline.

If the command cannot start, every pending test is marked as errored with the surfaced message to help diagnose missing tools or environment variables.

## Using the Included Demo Project
The `demo/` folder contains a roblox-ts sample with Jest tests plus a Roblox Cloud runner:

```text
npm run build  # compiles TypeScript and rebuilds place.rbxl via rojo
npm test       # builds and invokes demo/runTests.js
```

`demo/runTests.js` deploys `demo/place.rbxl` to Roblox and then runs `src/runTests.ts`. This file requires `@rbxts/jest` and exposes any failures through stdout, which the extension parses. Adapt this structure for your own experience by editing `demo/runTests.ts` or pointing `rbxts-jest.rbxtsProjectPath` at your project.

## Development
Interested in hacking on the extension itself?

```shell
npm install
npm run watch   # incremental build
```

- Launch the **Extension Development Host** from VS Code (`F5`) to test changes.
- Run `npm test` to execute the extension's integration tests via `@vscode/test-electron`.
- Before publishing, build with `npm run compile` and verify `out/` contains the transpiled scripts.

## Troubleshooting
- **No tests appear**: confirm your spec files match `rbxts-jest.testMatch` and contain `describe`/`it`. Use the refresh command after adjusting patterns.
- **Runs fail immediately**: ensure the extension can find a folder with an `npm test` script and that the script exits with code `0` on success.
- **Roblox Cloud errors**: double-check the environment variables and permissions. View the Testing output channel for the full log replayed by the extension.

## License
MIT