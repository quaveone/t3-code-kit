import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { parseMention, verifySlackSignature } from "./slack.ts";

describe("verifySlackSignature", () => {
	const secret = "test-secret";
	const body = '{"type":"event_callback"}';
	const now = 1_800_000_000;
	const sign = (ts: number) =>
		`v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`;

	test("accepts a fresh, correct signature", () => {
		expect(verifySlackSignature(secret, String(now), sign(now), body, now)).toBe(true);
	});
	test("rejects a stale timestamp", () => {
		expect(verifySlackSignature(secret, String(now - 301), sign(now - 301), body, now)).toBe(false);
	});
	test("rejects a wrong signature and missing headers", () => {
		expect(verifySlackSignature(secret, String(now), "v0=deadbeef", body, now)).toBe(false);
		expect(verifySlackSignature(secret, null, sign(now), body, now)).toBe(false);
	});
});

describe("parseMention", () => {
	test("reads a bracketed project", () => {
		expect(parseMention("<@U123> [my-service] fix the sync")).toEqual({
			project: "my-service",
			message: "fix the sync",
		});
	});
	test("falls back to the default project", () => {
		expect(parseMention("<@U123> why is it failing?")).toEqual({ message: "why is it failing?" });
	});
});
