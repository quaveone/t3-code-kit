import { describe, expect, test } from "bun:test";
import { lastAssistantText } from "./tasks.ts";

describe("lastAssistantText", () => {
	test("returns the newest assistant text", () => {
		const read = {
			items: [
				{ type: "user_message", text: "do it" },
				{ type: "assistant_message", text: "first" },
				{ type: "assistant_message", text: "final answer" },
			],
		};
		expect(lastAssistantText(read)).toBe("final answer");
	});
	test("returns undefined without assistant messages", () => {
		expect(lastAssistantText({ items: [{ type: "user_message", text: "hi" }] })).toBeUndefined();
	});
});
