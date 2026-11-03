/** Environment-only configuration. Invalid or missing required values fail at start. */
export type SlackConfig = {
	apiUrl: string;
	botToken: string;
	signingSecret: string;
	allowedUsers: Set<string>;
};

export type Config = {
	port: number;
	publicUrl: string;
	t3McpUrl: string;
	bridgeToken: string;
	statePath: string;
	defaultProject: string | undefined;
	defaultBaseRef: string;
	reposRoot: string;
	modelSelection: { instanceId: string; model: string; options: Record<string, string> };
	runtimeMode: "approval-required" | "auto-accept-edits" | "auto" | "full-access";
	waitTimeoutMs: number;
	slack: SlackConfig | undefined;
};

const RUNTIME_MODES = ["approval-required", "auto-accept-edits", "auto", "full-access"] as const;

function required(env: Record<string, string | undefined>, key: string): string {
	const value = env[key]?.trim();
	if (!value) throw new Error(`${key} is required`);
	return value;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
	const bridgeToken = required(env, "BRIDGE_TOKEN");
	if (bridgeToken.length < 32) throw new Error("BRIDGE_TOKEN must be at least 32 characters");
	const runtimeMode = (env.T3_RUNTIME_MODE ?? "full-access") as Config["runtimeMode"];
	if (!RUNTIME_MODES.includes(runtimeMode)) throw new Error(`T3_RUNTIME_MODE must be one of ${RUNTIME_MODES.join(", ")}`);

	const slackKeys = ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET", "SLACK_ALLOWED_USERS"];
	const slackSet = slackKeys.filter((key) => env[key]?.trim());
	if (slackSet.length > 0 && slackSet.length < slackKeys.length) {
		throw new Error(`Slack needs all of ${slackKeys.join(", ")}`);
	}

	return {
		port: Number(env.PORT ?? 8787),
		publicUrl: required(env, "PUBLIC_URL").replace(/\/$/, ""),
		t3McpUrl: required(env, "T3_MCP_URL"),
		bridgeToken,
		statePath: env.STATE_PATH ?? "/data/bridge.sqlite",
		defaultProject: env.DEFAULT_PROJECT?.trim() || undefined,
		defaultBaseRef: env.DEFAULT_BASE_REF?.trim() || "main",
		reposRoot: (env.T3_REPOS_ROOT?.trim() || "/data/home/repos").replace(/\/$/, ""),
		modelSelection: {
			instanceId: env.T3_PROVIDER_INSTANCE?.trim() || "claudeAgent",
			model: env.T3_MODEL?.trim() || "claude-opus-5-5",
			options: { effort: env.T3_MODEL_EFFORT?.trim() || "medium" },
		},
		runtimeMode,
		waitTimeoutMs: Number(env.WAIT_TIMEOUT_MS ?? 2 * 60 * 60 * 1000),
		slack:
			slackSet.length === slackKeys.length
				? {
						apiUrl: (env.SLACK_API_URL?.trim() || "https://slack.com/api").replace(/\/$/, ""),
						botToken: required(env, "SLACK_BOT_TOKEN"),
						signingSecret: required(env, "SLACK_SIGNING_SECRET"),
						allowedUsers: new Set(required(env, "SLACK_ALLOWED_USERS").split(/[\s,]+/).filter(Boolean)),
					}
				: undefined,
	};
}
