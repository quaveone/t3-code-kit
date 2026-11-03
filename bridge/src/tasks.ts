import type { Config } from "./config.ts";
import type { T3Client } from "./t3-client.ts";

type Project = { id: string; title: string; workspaceRoot?: string };

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

	async read(taskId: string, limit = 6): Promise<unknown> {
		return this.t3.call("t3_thread_read", { threadId: taskId, limit, maxCharsPerItem: 6000 });
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
		const read = (await this.read(taskId, 4)) as Record<string, unknown>;
		return {
			status: statusOf(last) ?? "unknown",
			reply: lastAssistantText(read) ?? "(no reply text)",
			link: typeof read.link === "string" ? read.link : undefined,
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
	const run = (value.run ?? value.resultRun) as Record<string, unknown> | undefined;
	if (run && typeof run.status === "string") return run.status;
	return undefined;
}

function isStillRunning(raw: unknown): boolean {
	if (raw && typeof raw === "object" && (raw as Record<string, unknown>).timedOut === true) return true;
	const status = statusOf(raw);
	return status === "running" || status === "starting" || status === "queued" || status === "preparing";
}

/** Finds the newest assistant message text in a `t3_thread_read` result. */
export function lastAssistantText(read: Record<string, unknown>): string | undefined {
	const items = (read.items ?? read.messages) as Record<string, unknown>[] | undefined;
	if (!Array.isArray(items)) return undefined;
	for (const item of [...items].reverse()) {
		const role = item.role ?? item.kind ?? item.type;
		if (role === "assistant" || role === "assistant_message") {
			const text = item.text ?? item.content ?? item.markdown;
			if (typeof text === "string" && text.trim()) return text;
		}
	}
	return undefined;
}
