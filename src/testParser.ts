/**
 * Represents a parsed test item from a test file
 */
export interface TestItem {
    name: string;
    type: "describe" | "it" | "test";
    line: number;
    column: number;
    children: TestItem[];
}

interface StackItem {
    item: TestItem;
    braceDepth: number;
}

/**
 * Parser for Jest test files to extract test structure
 */
export class TestParser {
    /**
     * Parse a test file content and extract test items
     */
    public parseTestFile(content: string, _filePath: string): TestItem[] {
        const tests: TestItem[] = [];
        const lines = content.split("\n");

        // Stack to track nested describe blocks with their starting brace depth
        const describeStack: StackItem[] = [];
        let braceDepth = 0;

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];

            // Count braces, ignoring those in strings
            const cleanLine = this.removeStrings(line);
            const openBraces = (cleanLine.match(/\{/g) || []).length;
            const closeBraces = (cleanLine.match(/\}/g) || []).length;

            // Match describe blocks
            const describeMatch = line.match(/^\s*describe\s*\(\s*(['"`])(.+?)\1/);
            if (describeMatch) {
                const describeItem: TestItem = {
                    name: describeMatch[2],
                    type: "describe",
                    line: lineNum,
                    column: line.indexOf("describe"),
                    children: [],
                };

                if (describeStack.length > 0) {
                    describeStack[describeStack.length - 1].item.children.push(describeItem);
                } else {
                    tests.push(describeItem);
                }

                // Push with the brace depth BEFORE this line's opening brace
                describeStack.push({ item: describeItem, braceDepth: braceDepth });
            }

            // Match it/test blocks
            const itMatch = line.match(/^\s*(?:it|test)\s*\(\s*(['"`])(.+?)\1/);
            if (itMatch) {
                const testItem: TestItem = {
                    name: itMatch[2],
                    type: "it",
                    line: lineNum,
                    column: line.indexOf("it") !== -1 ? line.indexOf("it") : line.indexOf("test"),
                    children: [],
                };

                if (describeStack.length > 0) {
                    describeStack[describeStack.length - 1].item.children.push(testItem);
                } else {
                    tests.push(testItem);
                }
            }

            // Update brace depth
            braceDepth += openBraces - closeBraces;

            // Pop describe blocks that have closed
            while (describeStack.length > 0 && braceDepth <= describeStack[describeStack.length - 1].braceDepth) {
                describeStack.pop();
            }
        }

        return tests;
    }

    private removeStrings(line: string): string {
        // Remove string contents to avoid counting braces inside strings
        return line
            .replace(/"(?:[^"\\]|\\.)*"/g, '""')
            .replace(/'(?:[^'\\]|\\.)*'/g, "''")
            .replace(/`(?:[^`\\]|\\.)*`/g, "``");
    }

    /**
     * Get a flat list of all test names (for filtering)
     */
    public flattenTests(tests: TestItem[], prefix: string = ""): string[] {
        const result: string[] = [];

        for (const test of tests) {
            const fullName = prefix ? `${prefix} > ${test.name}` : test.name;

            if (test.type === "it" || test.type === "test") {
                result.push(fullName);
            }

            if (test.children.length > 0) {
                result.push(...this.flattenTests(test.children, fullName));
            }
        }

        return result;
    }
}
