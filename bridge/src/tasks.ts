import type { Config } from "./config.ts";
import type { T3Client } from "./t3-client.ts";

type Project = { id: string; title: string; workspaceRoot?: string };

type ThreadItem = {
	itemId: string;
	type: string;
	createdBy?: string | null;
	text?: string | null;
	textTruncated?: boolean;
	nextTextOffset?: number | null;
};
type ThreadPage = { thread?: { link?: string | null }; items?: ThreadItem[]; nextPosition?: number | null; hasMore?: boolean };

export type TaskRequest = {
	project?: string;
	message: string;
	title?: string;
	/** Run in a new worktree from this ref. `null` runs in the project checkout. */
	baseRef?: string | null;
	clientRequestId?: string;
};

/** Task operations shared by the REST API and Slack. A task is a T3 thread. */
export class Tasks {
	constructor(
		private t3: T3Client,
		private config: Config,
	) {}

	async projects(): Promise<Project[]> {
		const result = (await this.t3.call("t3_project_list", { limit: 100 })) as {
			projects?: Project[];
			items?: Project[];
		};
		return result.projects ?? result.items ?? [];
	}

	/** Clones `owner/name` from GitHub into the T3 server and registers it as a project. */
	async addProject(repository: string, title?: string): Promise<Project> {
		if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new UserError("`repository` must look like owner/name.");
		const name = title ?? repository.split("/")[1] ?? repository;
		const existing = (await this.projects()).find((p) => p.title === name);
		if (existing) return existing;
		const destinationPath = `${this.config.reposRoot}/${name}`;
		await this.t3.call(
			"t3_project_clone",
			{ provider: "github", repository, destinationPath, protocol: "https" },
			10 * 60 * 1000,
		);
		return (await this.t3.call("t3_project_create", {
			title: name,
			workspaceRoot: destinationPath,
			defaultModelSelection: this.config.modelSelection,
		})) as Project;
	}

	/** Resolves a project by id or case-insensitive title, falling back to DEFAULT_PROJECT. */
	async resolveProject(nameOrId: string | undefined): Promise<Project> {
		const wanted = (nameOrId ?? this.config.defaultProject)?.toLowerCase();
		if (!wanted) throw new UserError("No project given and DEFAULT_PROJECT is not set.");
		const projects = await this.projects();
		const match = projects.find((p) => p.id.toLowerCase() === wanted || p.title.toLowerCase() === wanted);
		if (!match) {
			throw new UserError(`Unknown project "${nameOrId}". Known: ${projects.map((p) => p.title).join(", ")}`);
		}
		return match;
	}

	async start(request: TaskRequest): Promise<{ taskId: string; projectId: string; raw: unknown }> {
		const project = await this.resolveProject(request.project);
		const baseRef = request.baseRef === undefined ? this.config.defaultBaseRef : request.baseRef;
		const title = request.title ?? request.message.split("\n")[0]?.slice(0, 80) ?? "Task";
		const raw = await this.t3.call("t3_thread_launch", {
			projectId: project.id,
			title,
			message: request.message,
			modelSelection: this.config.modelSelection,
			runtimeMode: this.config.runtimeMode,
			...(baseRef ? { workspaceStrategy: { type: "worktree", baseRef, startFromOrigin: true } } : {}),
			...(request.clientRequestId ? { clientRequestId: request.clientRequestId } : {}),
		});
		const taskId = threadIdOf(raw);
		if (!taskId) throw new Error(`T3 did not return a thread id: ${JSON.stringify(raw).slice(0, 300)}`);
		return { taskId, projectId: project.id, raw };
	}

	async send(taskId: string, message: string): Promise<unknown> {
		return this.t3.call("t3_thread_send", { threadId: taskId, message, mode: "auto" });
	}

	/**
	 * Returns the thread and its newest `limit` messages. T3 pages oldest first, so this walks to the end
	 * cheaply (1 character per item) and then reads the newest items in full.
	 */
	async read(taskId: string, limit = 6): Promise<{ thread: unknown; items: ThreadItem[] }> {
		let afterPosition: number | undefined;
		let thread: unknown;
		let tail: ThreadItem[] = [];
		for (let page = 0; page < 100; page++) {
			const result = (await this.t3.call("t3_thread_read", {
				threadId: taskId,
				limit: 100,
				maxCharsPerItem: 1,
				...(afterPosition === undefined ? {} : { afterPosition }),
			})) as ThreadPage;
			thread = result.thread;
			tail = [...tail, ...(result.items ?? [])].slice(-limit);
			if (!result.hasMore || result.nextPosition == null) break;
			afterPosition = result.nextPosition;
		}
		const items = await Promise.all(tail.map((item) => this.fullItem(taskId, item)));
		return { thread, items };
	}

	/** Reads one item's full text, following `nextTextOffset` up to a 50k-character cap. */
	private async fullItem(taskId: string, item: ThreadItem): Promise<ThreadItem> {
		let text = "";
		let textOffset: number | null | undefined = 0;
		while (textOffset != null && text.length < 50_000) {
			const result = (await this.t3.call("t3_thread_read", {
				threadId: taskId,
				itemId: item.itemId,
				textOffset,
				maxCharsPerItem: 10_000,
			})) as ThreadPage;
			const part = result.items?.[0];
			if (!part) break;
			text += part.text ?? "";
			textOffset = part.textTruncated ? part.nextTextOffset : null;
		}
		return { ...item, text, textTruncated: false };
	}

	/** Waits until the thread's latest run settles, polling T3 in bounded slices. */
	async waitForResult(taskId: string): Promise<{ status: string; reply: string; link?: string }> {
		const deadline = Date.now() + this.config.waitTimeoutMs;
		let last: unknown;
		while (Date.now() < deadline) {
			last = await this.t3.call(
				"t3_thread_wait",
				{ threadId: taskId, timeoutMs: 10 * 60 * 1000 },
				11 * 60 * 1000,
			);
			if (!isStillRunning(last)) break;
		}
		const read = await this.read(taskId, 4);
		const thread = read.thread as { link?: string | null } | undefined;
		return {
			status: statusOf(last) ?? "unknown",
			reply: lastAssistantText(read) ?? "(no reply text)",
			link: thread?.link ?? undefined,
		};
	}
}

export class UserError extends Error {}

function threadIdOf(raw: unknown): string | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const value = raw as Record<string, unknown>;
	if (typeof value.threadId === "string") return value.threadId;
	const thread = value.thread as Record<string, unknown> | undefined;
	if (thread && typeof thread.id === "string") return thread.id;
	return undefined;
}

function statusOf(raw: unknown): string | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const value = raw as Record<string, unknown>;
	for (const key of ["status", "state"]) if (typeof value[key] === "string") return value[key] as string;
	const run = value.resultRun as Record<string, unknown> | undefined;
	if (run && typeof run.status === "string") return run.status;
	return undefined;
}

function isStillRunning(raw: unknown): boolean {
	if (raw && typeof raw === "object" && (raw as Record<string, unknown>).timedOut === true) return true;
	const status = statusOf(raw);
	return status === "running" || status === "starting" || status === "queued" || status === "preparing";
}

/** Finds the newest assistant message text in a thread read (`type: "assistant_message"`). */
export function lastAssistantText(read: { items?: { type?: string; text?: string | null }[] }): string | undefined {
	const items = read.items ?? [];
	for (const item of [...items].reverse()) {
		if (item.type === "assistant_message" && item.text?.trim()) return item.text;
	}
	return undefined;
}
