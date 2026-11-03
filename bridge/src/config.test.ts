import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config.ts";

const base = {
	BRIDGE_TOKEN: "x".repeat(32),
	PUBLIC_URL: "https://bridge.example.com/",
	T3_MCP_URL: "https://t3.example.com/mcp",
};

describe("loadConfig", () => {
	test("reads defaults and trims the public URL", () => {
		const config = loadConfig(base);
		expect(config.publicUrl).toBe("https://bridge.example.com");
		expect(config.runtimeMode).toBe("full-access");
		expect(config.slack).toBeUndefined();
		expect(config.modelSelection).toEqual({
			instanceId: "claudeAgent",
			model: "claude-opus-5-5",
			options: { effort: "medium" },
		});
	});
	test("rejects a short bridge token", () => {
		expect(() => loadConfig({ ...base, BRIDGE_TOKEN: "short" })).toThrow("at least 32");
	});
	test("requires every Slack value once one is set", () => {
		expect(() => loadConfig({ ...base, SLACK_BOT_TOKEN: "xoxb" })).toThrow("Slack needs all");
	});
	test("parses allowed Slack users", () => {
		const config = loadConfig({
			...base,
			SLACK_BOT_TOKEN: "xoxb",
			SLACK_SIGNING_SECRET: "s",
			SLACK_ALLOWED_USERS: "U1, U2",
		});
		expect([...(config.slack?.allowedUsers ?? [])]).toEqual(["U1", "U2"]);
	});
});
