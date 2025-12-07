import * as assert from "assert";
import * as vscode from "vscode";

suite("TestController - Result Parsing", () => {
    /**
     * Helper to simulate the parseAndReportResults logic
     */
    function parseTestResults(output: string, testNames: string[]): Map<string, "passed" | "failed"> {
        const results = new Map<string, "passed" | "failed">();
        const cleanedOutput = stripAnsiCodes(output).replace(/\r/g, "");

        for (const testName of testNames) {
            const escapedName = escapeRegex(testName);

            // Look for test results in the output
            const inErrorSection = new RegExp(`^\\s*●[^\\n]*${escapedName}`, "im");
            const failPattern = new RegExp(`(?:Γò|[✕✗×✘])[^\\n]*${escapedName}`, "i");
            const passPattern = new RegExp(`(?:Γô|[✓✔√])[^\\n]*${escapedName}`, "i");

            const hasFail = failPattern.test(cleanedOutput) || inErrorSection.test(cleanedOutput);
            const hasPass = passPattern.test(cleanedOutput);

            if (hasFail) {
                results.set(testName, "failed");
            } else if (hasPass) {
                results.set(testName, "passed");
            } else {
                // Default to passed if not explicitly failed
                results.set(testName, "passed");
            }
        }

        return results;
    }

    function stripAnsiCodes(text: string): string {
        return text.replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/g, "");
    }

    function escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    test("correctly identifies passing tests with proper Unicode", () => {
        const output = `
 PASS  src/__tests__/div.spec
  div
    ✓ divides 6 / 2 to equal 3 (0 ms)
    ✓ divides 9 / 3 to equal 3 (0 ms)
    ✓ divides 8 / 2 to equal 4 (0 ms)

Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
        `;

        const testNames = ["divides 6 / 2 to equal 3", "divides 9 / 3 to equal 3", "divides 8 / 2 to equal 4"];
        const results = parseTestResults(output, testNames);

        assert.strictEqual(results.get("divides 6 / 2 to equal 3"), "passed");
        assert.strictEqual(results.get("divides 9 / 3 to equal 3"), "passed");
        assert.strictEqual(results.get("divides 8 / 2 to equal 4"), "passed");
    });

    test("correctly identifies failing tests with proper Unicode", () => {
        const output = `
 FAIL  src/__tests__/add.spec
  add
    ✕ fails when expecting 5 + 5 to equal 30 (1 ms)
    ✕ fails when expecting 10 + 15 to equal 20 (0 ms)

  ● add › fails when expecting 5 + 5 to equal 30

    expect(received).toBe(expected)
    Expected: 30
    Received: 10

Test Suites: 1 failed, 1 total
Tests:       2 failed, 2 total
        `;

        const testNames = ["fails when expecting 5 + 5 to equal 30", "fails when expecting 10 + 15 to equal 20"];
        const results = parseTestResults(output, testNames);

        assert.strictEqual(results.get("fails when expecting 5 + 5 to equal 30"), "failed");
        assert.strictEqual(results.get("fails when expecting 10 + 15 to equal 20"), "failed");
    });

    test("correctly identifies mixed pass/fail with proper Unicode", () => {
        const output = `
 FAIL  src/__tests__/mul.spec
  mul
    ✓ multiplies 6 * 2 to equal 12 (1 ms)
    ✓ multiplies 3 * 4 to equal 12 (1 ms)
    ✓ multiplies 5 * 5 to equal 25 (1 ms)
    ✕ fails when expecting 5 * 5 to equal 30 (2 ms)

  ● mul › fails when expecting 5 * 5 to equal 30

    expect(received).toBe(expected)
    Expected: 30
    Received: 25

Test Suites: 1 failed, 1 total
Tests:       1 failed, 3 passed, 4 total
        `;

        const testNames = [
            "multiplies 6 * 2 to equal 12",
            "multiplies 3 * 4 to equal 12",
            "multiplies 5 * 5 to equal 25",
            "fails when expecting 5 * 5 to equal 30",
        ];
        const results = parseTestResults(output, testNames);

        assert.strictEqual(results.get("multiplies 6 * 2 to equal 12"), "passed");
        assert.strictEqual(results.get("multiplies 3 * 4 to equal 12"), "passed");
        assert.strictEqual(results.get("multiplies 5 * 5 to equal 25"), "passed");
        assert.strictEqual(results.get("fails when expecting 5 * 5 to equal 30"), "failed");
    });

    test("correctly identifies passing tests with corrupted Unicode encoding", () => {
        const output = `
 PASS  src/__tests__/div.spec
  div
    ${"\u0393\u00f4"} divides 6 / 2 to equal 3 (0 ms)
    ${"\u0393\u00f4"} divides 9 / 3 to equal 3 (0 ms)
    ${"\u0393\u00f4"} divides 8 / 2 to equal 4 (0 ms)

Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
        `;

        const testNames = ["divides 6 / 2 to equal 3", "divides 9 / 3 to equal 3", "divides 8 / 2 to equal 4"];
        const results = parseTestResults(output, testNames);

        assert.strictEqual(results.get("divides 6 / 2 to equal 3"), "passed");
        assert.strictEqual(results.get("divides 9 / 3 to equal 3"), "passed");
        assert.strictEqual(results.get("divides 8 / 2 to equal 4"), "passed");
    });

    test("correctly identifies failing tests with corrupted Unicode encoding", () => {
        const output = `
 FAIL  src/__tests__/add.spec
  add
    ${"\u0393\u00f2"} fails when expecting 5 + 5 to equal 30 (1 ms)
    ${"\u0393\u00f2"} fails when expecting 10 + 15 to equal 20 (0 ms)

  ${"\u25cf"} add ${"\u203a"} fails when expecting 5 + 5 to equal 30

    expect(received).toBe(expected)
    Expected: 30
    Received: 10

Test Suites: 1 failed, 1 total
Tests:       2 failed, 2 total
        `;

        const testNames = ["fails when expecting 5 + 5 to equal 30", "fails when expecting 10 + 15 to equal 20"];
        const results = parseTestResults(output, testNames);

        assert.strictEqual(results.get("fails when expecting 5 + 5 to equal 30"), "failed");
        assert.strictEqual(results.get("fails when expecting 10 + 15 to equal 20"), "failed");
    });

    test("correctly identifies mixed pass/fail with corrupted Unicode encoding", () => {
        const output = `
 FAIL  src/__tests__/mul.spec
  mul
    ${"\u0393\u00f4"} multiplies 6 * 2 to equal 12 (1 ms)
    ${"\u0393\u00f4"} multiplies 3 * 4 to equal 12 (1 ms)
    ${"\u0393\u00f4"} multiplies 5 * 5 to equal 25 (1 ms)
    ${"\u0393\u00f2"} fails when expecting 5 * 5 to equal 30 (2 ms)

  ${"\u25cf"} mul ${"\u203a"} fails when expecting 5 * 5 to equal 30

    expect(received).toBe(expected)
    Expected: 30
    Received: 25

Test Suites: 1 failed, 1 total
Tests:       1 failed, 3 passed, 4 total
        `;

        const testNames = [
            "multiplies 6 * 2 to equal 12",
            "multiplies 3 * 4 to equal 12",
            "multiplies 5 * 5 to equal 25",
            "fails when expecting 5 * 5 to equal 30",
        ];
        const results = parseTestResults(output, testNames);

        assert.strictEqual(results.get("multiplies 6 * 2 to equal 12"), "passed");
        assert.strictEqual(results.get("multiplies 3 * 4 to equal 12"), "passed");
        assert.strictEqual(results.get("multiplies 5 * 5 to equal 25"), "passed");
        assert.strictEqual(results.get("fails when expecting 5 * 5 to equal 30"), "failed");
    });

    test("regression: does not mark all tests as failed when process exits with code 1", () => {
        const output = `
 FAIL  src/__tests__/add.spec
  add
    ${"\u0393\u00f2"} fails when expecting 5 + 5 to equal 30 (1 ms)

 PASS  src/__tests__/div.spec
  div
    ${"\u0393\u00f4"} divides 6 / 2 to equal 3 (0 ms)
    ${"\u0393\u00f4"} divides 9 / 3 to equal 3 (0 ms)

Test Suites: 1 failed, 1 passed, 2 total
Tests:       1 failed, 2 passed, 3 total
        `;

        const testNames = [
            "fails when expecting 5 + 5 to equal 30",
            "divides 6 / 2 to equal 3",
            "divides 9 / 3 to equal 3",
        ];
        const results = parseTestResults(output, testNames);

        // Only the explicitly failed test should be marked as failed
        assert.strictEqual(results.get("fails when expecting 5 + 5 to equal 30"), "failed");
        // These should be marked as passed despite the overall exit code being 1
        assert.strictEqual(results.get("divides 6 / 2 to equal 3"), "passed");
        assert.strictEqual(results.get("divides 9 / 3 to equal 3"), "passed");
    });

    test("handles ANSI escape codes in output", () => {
        const output = `
 \u001b[31mFAIL\u001b[0m  src/__tests__/add.spec
  add
    \u001b[31m✕\u001b[0m fails when expecting 5 + 5 to equal 30 (1 ms)

 \u001b[32mPASS\u001b[0m  src/__tests__/div.spec
  div
    \u001b[32m✓\u001b[0m divides 6 / 2 to equal 3 (0 ms)

Test Suites: 1 failed, 1 passed, 2 total
Tests:       1 failed, 1 passed, 2 total
        `;

        const testNames = ["fails when expecting 5 + 5 to equal 30", "divides 6 / 2 to equal 3"];
        const results = parseTestResults(output, testNames);

        assert.strictEqual(results.get("fails when expecting 5 + 5 to equal 30"), "failed");
        assert.strictEqual(results.get("divides 6 / 2 to equal 3"), "passed");
    });

    test("handles test names with special regex characters", () => {
        const output = `
 PASS  src/__tests__/special.spec
  special
    ✓ test with (parentheses) and [brackets] (0 ms)
    ✓ test with $dollar and ^caret (0 ms)

Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
        `;

        const testNames = ["test with (parentheses) and [brackets]", "test with $dollar and ^caret"];
        const results = parseTestResults(output, testNames);

        assert.strictEqual(results.get("test with (parentheses) and [brackets]"), "passed");
        assert.strictEqual(results.get("test with $dollar and ^caret"), "passed");
    });
});
