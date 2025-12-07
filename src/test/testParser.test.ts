import * as assert from "assert";
import { TestParser } from "../testParser";

suite("TestParser", () => {
    let parser: TestParser;

    setup(() => {
        parser = new TestParser();
    });

    test("parses simple test case", () => {
        const content = `
it("should pass", () => {
    expect(true).toBe(true);
});
        `;

        const tests = parser.parseTestFile(content, "test.spec.ts");
        assert.strictEqual(tests.length, 1);
        assert.strictEqual(tests[0].name, "should pass");
        assert.strictEqual(tests[0].type, "it");
    });

    test("parses describe blocks with nested tests", () => {
        const content = `
describe("math operations", () => {
    it("adds numbers", () => {
        expect(1 + 1).toBe(2);
    });
    
    it("multiplies numbers", () => {
        expect(2 * 3).toBe(6);
    });
});
        `;

        const tests = parser.parseTestFile(content, "test.spec.ts");
        assert.strictEqual(tests.length, 1);
        assert.strictEqual(tests[0].name, "math operations");
        assert.strictEqual(tests[0].type, "describe");
        assert.strictEqual(tests[0].children.length, 2);
        assert.strictEqual(tests[0].children[0].name, "adds numbers");
        assert.strictEqual(tests[0].children[1].name, "multiplies numbers");
    });

    test("parses nested describe blocks", () => {
        const content = `
describe("outer", () => {
    describe("inner", () => {
        it("test case", () => {});
    });
});
        `;

        const tests = parser.parseTestFile(content, "test.spec.ts");
        assert.strictEqual(tests.length, 1);
        assert.strictEqual(tests[0].name, "outer");
        assert.strictEqual(tests[0].children.length, 1);
        assert.strictEqual(tests[0].children[0].name, "inner");
        assert.strictEqual(tests[0].children[0].children.length, 1);
        assert.strictEqual(tests[0].children[0].children[0].name, "test case");
    });
});
