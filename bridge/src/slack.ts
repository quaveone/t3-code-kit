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

	/**
	 * A mention posted by an allowed bot or incoming webhook. Webhook posts have no `user` and arrive as a
	 * `bot_message`, sometimes also as an `app_mention`, so the channel and ts pick the single copy to act on.
	 */
	private async isAllowedBotMention(event: SlackEvent): Promise<boolean> {
		if (event.user || !event.bot_id || !event.channel || !event.ts) return false;
		if (!this.config.allowedBots.has(event.bot_id)) return false;
		if (event.type !== "app_mention" && event.subtype !== "bot_message") return false;
		const ownUserId = await this.ownUserId();
		if (!ownUserId || !(event.text ?? "").includes(`<@${ownUserId}>`)) return false;
		return this.store.firstSeen(`bot-mention-${event.channel}-${event.ts}`);
	}

	private async onEvent(event: SlackEvent): Promise<void> {
		if (await this.isAllowedBotMention(event)) {
			await this.run({ ...event, thread_ts: event.thread_ts ?? event.ts });
			return;
		}
		// Messages a person sends through another app carry a bot_id too, so only the bridge's own
		// user and edits, joins and other subtypes are skipped. SLACK_ALLOWED_USERS still gates requests.
		if (event.subtype || !event.user || !event.channel || !event.ts) return;
		const ownUserId = await this.ownUserId();
		if (event.user === ownUserId) return;
		const threadTs = event.thread_ts ?? event.ts;
		const linked = this.store.t3ThreadFor(event.channel, threadTs);
		const isMention = event.type === "app_mention";
		// Plain messages count only as replies inside threads the bridge owns. A mention also arrives as a
		// `message` event; that copy is skipped so the app_mention handler is the only one that acts on it.
		const isThreadReply = Boolean(event.thread_ts) && event.thread_ts !== event.ts;
		// Only a mention of this bot marks the message-event copy; other mentions (for example the "Sent
		// using <@app>" footer some clients add) are ordinary text.
		const mentionsBot = ownUserId ? (event.text ?? "").includes(`<@${ownUserId}>`) : /<@[A-Z0-9]+>/.test(event.text ?? "");
		if (!isMention && (!linked || !isThreadReply || mentionsBot)) return;
		if (!this.config.allowedUsers.has(event.user)) {
			if (isMention) await this.post(event.channel, threadTs, "You are not allowed to use this bridge.");
			return;
		}
		await this.run(event);
	}

	/** Starts or continues the T3 thread for an event that already passed the access checks. */
	private async run(event: SlackEvent): Promise<void> {
		const channel = event.channel as string;
		const ts = event.ts as string;
		const threadTs = event.thread_ts ?? ts;
		const linked = this.store.t3ThreadFor(channel, threadTs);
		const { project, message } = parseMention(event.text ?? "");
		if (!message) {
			await this.post(channel, threadTs, "Usage: `@T3 [project] what to do`. Reply in the thread to continue.");
			return;
		}
		try {
			let taskId = linked;
			if (taskId) {
				await this.tasks.send(taskId, message);
				await this.post(channel, threadTs, "Sent to the same T3 thread. Working on it…");
			} else {
				const started = await this.tasks.start({
					project,
					message,
					clientRequestId: `slack-${channel}-${ts}`,
				});
				taskId = started.taskId;
				this.store.linkSlackThread(channel, threadTs, taskId);
				await this.post(channel, threadTs, `Started T3 thread \`${taskId}\`. I will post the answer here.`);
			}
			const result = await this.tasks.waitForResult(taskId);
			const header = `*${result.status}*${result.link ? ` · ${result.link}` : ""}\n`;
			await this.post(channel, threadTs, header + truncate(result.reply));
		} catch (error) {
			const text = error instanceof UserError ? error.message : "The bridge could not reach T3. Check its logs.";
			if (!(error instanceof UserError)) console.error("task failed", error);
			await this.post(channel, threadTs, text);
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
