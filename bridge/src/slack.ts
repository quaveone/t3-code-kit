import { createHmac, timingSafeEqual } from "node:crypto";
import type { SlackConfig } from "./config.ts";
import type { Store } from "./store.ts";
import { type Tasks, UserError } from "./tasks.ts";

const MAX_SLACK_TEXT = 3500;

/** Verifies Slack's v0 request signature and rejects requests older than 5 minutes. */
export function verifySlackSignature(
	signingSecret: string,
	timestamp: string | null,
	signature: string | null,
	body: string,
	nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
	if (!timestamp || !signature) return false;
	const ts = Number(timestamp);
	if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > 300) return false;
	const expected = `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
	const a = Buffer.from(expected);
	const b = Buffer.from(signature);
	return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Parses a mention: "<@BOT> [project] message". A leading `[name]` picks the project;
 * otherwise DEFAULT_PROJECT is used.
 */
export function parseMention(text: string): { project?: string; message: string } {
	const withoutMentions = text.replace(/<@[A-Z0-9]+>/g, "").trim();
	const match = withoutMentions.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
	if (match) return { project: match[1]?.trim(), message: (match[2] ?? "").trim() };
	return { message: withoutMentions };
}

type SlackEvent = {
	type: string;
	user?: string;
	bot_id?: string;
	subtype?: string;
	text?: string;
	channel?: string;
	ts?: string;
	thread_ts?: string;
};

export class SlackBridge {
	private botUserId: Promise<string | undefined> | undefined;

	constructor(
		private config: SlackConfig,
		private store: Store,
		private tasks: Tasks,
	) {}

	async handle(request: Request): Promise<Response> {
		const body = await request.text();
		const ok = verifySlackSignature(
			this.config.signingSecret,
			request.headers.get("x-slack-request-timestamp"),
			request.headers.get("x-slack-signature"),
			body,
		);
		if (!ok) return new Response("invalid signature", { status: 401 });
		const payload = JSON.parse(body) as {
			type: string;
			challenge?: string;
			event_id?: string;
			event?: SlackEvent;
		};
		if (payload.type === "url_verification") return Response.json({ challenge: payload.challenge });
		if (payload.type !== "event_callback" || !payload.event) return new Response("ignored");
		if (payload.event_id && !this.store.firstSeen(payload.event_id)) return new Response("duplicate");
		// Ack within Slack's 3-second window; the work continues in the background.
		void this.onEvent(payload.event).catch((error) => console.error("slack event failed", error));
		return new Response("ok");
	}

	/** The bridge's own bot user id, from auth.test, so its own posts are never treated as requests. */
	private ownUserId(): Promise<string | undefined> {
		this.botUserId ??= fetch(`${this.config.apiUrl}/auth.test`, {
			method: "POST",
			headers: { Authorization: `Bearer ${this.config.botToken}` },
		})
			.then((response) => response.json() as Promise<{ ok: boolean; user_id?: string }>)
			.then((result) => (result.ok ? result.user_id : undefined))
			.catch(() => undefined);
		return this.botUserId;
	}

	private async onEvent(event: SlackEvent): Promise<void> {
		// Messages a person sends through another app carry a bot_id too, so only the bridge's own
		// user and edits, joins and other subtypes are skipped. SLACK_ALLOWED_USERS still gates requests.
		if (event.subtype || !event.user || !event.channel || !event.ts) return;
		if (event.user === (await this.ownUserId())) return;
		const threadTs = event.thread_ts ?? event.ts;
		const linked = this.store.t3ThreadFor(event.channel, threadTs);
		const isMention = event.type === "app_mention";
		// Plain messages count only as replies inside threads the bridge owns. A mention also arrives as a
		// `message` event; that copy is skipped so the app_mention handler is the only one that acts on it.
		const isThreadReply = Boolean(event.thread_ts) && event.thread_ts !== event.ts;
		if (!isMention && (!linked || !isThreadReply || /<@[A-Z0-9]+>/.test(event.text ?? ""))) return;
		if (!this.config.allowedUsers.has(event.user)) {
			if (isMention) await this.post(event.channel, threadTs, "You are not allowed to use this bridge.");
			return;
		}
		const { project, message } = parseMention(event.text ?? "");
		if (!message) {
			await this.post(event.channel, threadTs, "Usage: `@T3 [project] what to do`. Reply in the thread to continue.");
			return;
		}
		try {
			let taskId = linked;
			if (taskId) {
				await this.tasks.send(taskId, message);
				await this.post(event.channel, threadTs, "Sent to the same T3 thread. Working on it…");
			} else {
				const started = await this.tasks.start({
					project,
					message,
					clientRequestId: `slack-${event.channel}-${event.ts}`,
				});
				taskId = started.taskId;
				this.store.linkSlackThread(event.channel, threadTs, taskId);
				await this.post(event.channel, threadTs, `Started T3 thread \`${taskId}\`. I will post the answer here.`);
			}
			const result = await this.tasks.waitForResult(taskId);
			const header = `*${result.status}*${result.link ? ` · ${result.link}` : ""}\n`;
			await this.post(event.channel, threadTs, header + truncate(result.reply));
		} catch (error) {
			const text = error instanceof UserError ? error.message : "The bridge could not reach T3. Check its logs.";
			if (!(error instanceof UserError)) console.error("task failed", error);
			await this.post(event.channel, threadTs, text);
		}
	}

	private async post(channel: string, threadTs: string, text: string): Promise<void> {
		const response = await fetch(`${this.config.apiUrl}/chat.postMessage`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.config.botToken}`,
				"Content-Type": "application/json; charset=utf-8",
			},
			body: JSON.stringify({ channel, thread_ts: threadTs, text, unfurl_links: false }),
		});
		const result = (await response.json()) as { ok: boolean; error?: string };
		if (!result.ok) console.error("slack post failed", result.error);
	}
}

function truncate(text: string): string {
	return text.length <= MAX_SLACK_TEXT ? text : `${text.slice(0, MAX_SLACK_TEXT)}\n… (cut; full answer in T3)`;
}
