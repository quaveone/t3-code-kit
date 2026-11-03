import { describe, expect, test } from "bun:test";
import { lastAssistantText } from "./tasks.ts";

describe("lastAssistantText", () => {
	test("returns the newest assistant text", () => {
		const read = {
			items: [
				{ role: "user", text: "do it" },
				{ role: "assistant", text: "first" },
				{ role: "assistant", text: "final answer" },
			],
		};
		expect(lastAssistantText(read)).toBe("final answer");
	});
	test("returns undefined without assistant messages", () => {
		expect(lastAssistantText({ items: [{ role: "user", text: "hi" }] })).toBeUndefined();
	});
});
