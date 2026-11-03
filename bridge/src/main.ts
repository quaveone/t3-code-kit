import { timingSafeEqual } from "node:crypto";
import { loadConfig } from "./config.ts";
import { SlackBridge } from "./slack.ts";
import { Store } from "./store.ts";
import { T3AuthProvider } from "./t3-auth.ts";
import { T3Client, T3NotSignedInError } from "./t3-client.ts";
import { Tasks, UserError } from "./tasks.ts";

const config = loadConfig();
const store = new Store(config.statePath);
const auth = new T3AuthProvider(store, `${config.publicUrl}/oauth/callback`);
const t3 = new T3Client(config.t3McpUrl, auth);
const tasks = new Tasks(t3, config);
const slack = config.slack ? new SlackBridge(config.slack, store, tasks) : undefined;

function authorized(request: Request): boolean {
	const header = request.headers.get("authorization") ?? "";
	const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
	const expected = Buffer.from(config.bridgeToken);
	return given.length === expected.length && timingSafeEqual(given, expected);
}

async function json<T>(request: Request): Promise<T> {
	const text = await request.text();
	if (text.length > 128 * 1024) throw new UserError("Body too large (max 128 KiB).");
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new UserError("Body must be JSON.");
	}
}

async function route(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname;

	if (path === "/healthz") return Response.json({ ok: true });
	if (path === "/slack/events" && request.method === "POST") {
		return slack ? slack.handle(request) : new Response("Slack is not configured", { status: 404 });
	}
	if (path === "/oauth/callback") {
		const code = url.searchParams.get("code");
		if (!code) return new Response("Missing code", { status: 400 });
		await t3.finishLogin(code);
		return new Response("The bridge is signed in to T3. You can close this tab.");
	}

	if (!path.startsWith("/v1/")) return new Response("Not found", { status: 404 });
	if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });

	if (path === "/v1/t3/login" && request.method === "POST") {
		return Response.json({ authorizationUrl: await t3.startLogin() });
	}
	if (path === "/v1/t3/status" && request.method === "GET") {
		const saved = store.get<{ at: string; expiresAt: string | null }>("oauth.tokensSavedAt");
		try {
			await t3.connect();
			return Response.json({ signedIn: true, ...saved });
		} catch (error) {
			if (error instanceof T3NotSignedInError) return Response.json({ signedIn: false, ...saved });
			throw error;
		}
	}
	if (path === "/v1/projects" && request.method === "GET") {
		return Response.json({ projects: await tasks.projects() });
	}
	if (path === "/v1/tasks" && request.method === "POST") {
		const body = await json<{ project?: string; message?: string; title?: string; baseRef?: string | null; clientRequestId?: string }>(request);
		if (!body.message?.trim()) throw new UserError("`message` is required.");
		const started = await tasks.start({ ...body, message: body.message });
		return Response.json({ taskId: started.taskId, projectId: started.projectId }, { status: 202 });
	}
	const taskMatch = path.match(/^\/v1\/tasks\/([^/]+)(\/messages|\/wait)?$/);
	if (taskMatch) {
		const taskId = decodeURIComponent(taskMatch[1] ?? "");
		if (!taskMatch[2] && request.method === "GET") return Response.json(await tasks.read(taskId));
		if (taskMatch[2] === "/messages" && request.method === "POST") {
			const body = await json<{ message?: string }>(request);
			if (!body.message?.trim()) throw new UserError("`message` is required.");
			return Response.json(await tasks.send(taskId, body.message), { status: 202 });
		}
		if (taskMatch[2] === "/wait" && request.method === "POST") {
			return Response.json(await tasks.waitForResult(taskId));
		}
	}
	return new Response("Not found", { status: 404 });
}

Bun.serve({
	port: config.port,
	hostname: "0.0.0.0",
	idleTimeout: 0,
	async fetch(request) {
		try {
			return await route(request);
		} catch (error) {
			if (error instanceof UserError) return Response.json({ error: error.message }, { status: 400 });
			if (error instanceof T3NotSignedInError) {
				return Response.json({ error: error.message }, { status: 503 });
			}
			console.error("request failed", error);
			return Response.json({ error: "internal error" }, { status: 500 });
		}
	},
});
console.log(`t3-bridge listening on :${config.port}${slack ? " (Slack on)" : ""}`);
