import { Database } from "bun:sqlite";

/** Small key/value + Slack-thread store on one SQLite file (one bridge container). */
export class Store {
	private db: Database;

	constructor(path: string) {
		this.db = new Database(path, { create: true });
		this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
		this.db.exec(
			`CREATE TABLE IF NOT EXISTS slack_threads (
				channel TEXT NOT NULL,
				thread_ts TEXT NOT NULL,
				t3_thread_id TEXT NOT NULL,
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				PRIMARY KEY (channel, thread_ts)
			)`,
		);
		this.db.exec(
			"CREATE TABLE IF NOT EXISTS slack_events (event_id TEXT PRIMARY KEY, seen_at TEXT NOT NULL DEFAULT (datetime('now')))",
		);
	}

	get<T>(key: string): T | undefined {
		const row = this.db.query("SELECT value FROM kv WHERE key = ?").get(key) as
			| { value: string }
			| null;
		return row ? (JSON.parse(row.value) as T) : undefined;
	}

	set(key: string, value: unknown): void {
		this.db
			.query("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
			.run(key, JSON.stringify(value));
	}

	delete(key: string): void {
		this.db.query("DELETE FROM kv WHERE key = ?").run(key);
	}

	t3ThreadFor(channel: string, threadTs: string): string | undefined {
		const row = this.db
			.query("SELECT t3_thread_id FROM slack_threads WHERE channel = ? AND thread_ts = ?")
			.get(channel, threadTs) as { t3_thread_id: string } | null;
		return row?.t3_thread_id;
	}

	linkSlackThread(channel: string, threadTs: string, t3ThreadId: string): void {
		this.db
			.query("INSERT OR REPLACE INTO slack_threads (channel, thread_ts, t3_thread_id) VALUES (?, ?, ?)")
			.run(channel, threadTs, t3ThreadId);
	}

	/** Returns true the first time an event id is seen (Slack retries deliveries). */
	firstSeen(eventId: string): boolean {
		const result = this.db.query("INSERT OR IGNORE INTO slack_events (event_id) VALUES (?)").run(eventId);
		return result.changes === 1;
	}
}
