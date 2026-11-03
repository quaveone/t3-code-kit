import { afterAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { SlackBridge } from "./slack.ts";
import { Store } from "./store.ts";
import type { Tasks } from "./tasks.ts";

// End-to-end Slack flow against a fake Slack Web API and a fake T3 task layer.
const posts: { channel: string; thread_ts: string; text: string }[] = [];
const slackApi = Bun.serve({
	port: 0,
	async fetch(request) {
		posts.push((await request.json()) as (typeof posts)[number]);
		return Response.json({ ok: true });
	},
});
afterAll(() => slackApi.stop(true));

const calls: string[] = [];
const fakeTasks = {
	async start(request: { project?: string; message: string }) {
		calls.push(`start:${request.project ?? "default"}:${request.message}`);
		return { taskId: "thread-1", projectId: "p1", raw: {} };
	},
	async send(taskId: string, message: string) {
		calls.push(`send:${taskId}:${message}`);
		return {};
	},
	async waitForResult(taskId: string) {
		return { status: "completed", reply: `answer for ${taskId}` };
	},
} as unknown as Tasks;

const secret = "signing-secret";
const bridge = new SlackBridge(
	{ apiUrl: `http://127.0.0.1:${slackApi.port}`, botToken: "xoxb-test", signingSecret: secret, allowedUsers: new Set(["U1"]) },
	new Store(":memory:"),
	fakeTasks,
);

function signedRequest(payload: unknown): Request {
	const body = JSON.stringify(payload);
	const ts = String(Math.floor(Date.now() / 1000));
	const signature = `v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`;
	return new Request("http://bridge/slack/events", {
		method: "POST",
		body,
		headers: { "x-slack-request-timestamp": ts, "x-slack-signature": signature },
	});
}

async function until(predicate: () => boolean): Promise<void> {
	for (let i = 0; i < 100 && !predicate(); i++) await Bun.sleep(10);
}

describe("SlackBridge flow", () => {
	test("answers the URL verification challenge", async () => {
		const response = await bridge.handle(signedRequest({ type: "url_verification", challenge: "abc" }));
		expect(await response.json()).toEqual({ challenge: "abc" });
	});

	test("starts a thread on mention and posts the answer in the Slack thread", async () => {
		const response = await bridge.handle(
			signedRequest({
				type: "event_callback",
				event_id: "Ev1",
				event: { type: "app_mention", user: "U1", text: "<@B1> [furia] fix it", channel: "C1", ts: "100.1" },
			}),
		);
		expect(response.status).toBe(200);
		await until(() => posts.length >= 2);
		expect(calls).toContain("start:furia:fix it");
		expect(posts.at(-1)).toMatchObject({ channel: "C1", thread_ts: "100.1" });
		expect(posts.at(-1)?.text).toContain("answer for thread-1");
	});

	test("routes a plain reply in an owned thread to the same T3 thread", async () => {
		const before = posts.length;
		await bridge.handle(
			signedRequest({
				type: "event_callback",
				event_id: "Ev2",
				event: { type: "message", user: "U1", text: "also add a test", channel: "C1", ts: "100.5", thread_ts: "100.1" },
			}),
		);
		await until(() => posts.length >= before + 2);
		expect(calls).toContain("send:thread-1:also add a test");
	});

	test("skips the message-event copy of a mention so T3 gets it once", async () => {
		const callCount = calls.length;
		await bridge.handle(
			signedRequest({
				type: "event_callback",
				event_id: "Ev4",
				event: { type: "message", user: "U1", text: "<@B1> [furia] fix it", channel: "C1", ts: "100.1" },
			}),
		);
		await bridge.handle(
			signedRequest({
				type: "event_callback",
				event_id: "Ev5",
				event: { type: "message", user: "U1", text: "<@B1> more", channel: "C1", ts: "100.7", thread_ts: "100.1" },
			}),
		);
		await Bun.sleep(50);
		expect(calls.length).toBe(callCount);
	});

	test("ignores duplicate deliveries and unknown users", async () => {
		const callCount = calls.length;
		await bridge.handle(
			signedRequest({
				type: "event_callback",
				event_id: "Ev1",
				event: { type: "app_mention", user: "U1", text: "<@B1> again", channel: "C1", ts: "100.9" },
			}),
		);
		await bridge.handle(
			signedRequest({
				type: "event_callback",
				event_id: "Ev3",
				event: { type: "app_mention", user: "U9", text: "<@B1> hi", channel: "C1", ts: "101.0" },
			}),
		);
		await until(() => posts.some((p) => p.text.includes("not allowed")));
		expect(calls.length).toBe(callCount);
		expect(posts.at(-1)?.text).toContain("not allowed");
	});

	test("rejects a bad signature", async () => {
		const request = new Request("http://bridge/slack/events", {
			method: "POST",
			body: "{}",
			headers: { "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)), "x-slack-signature": "v0=bad" },
		});
		expect((await bridge.handle(request)).status).toBe(401);
	});
});
