import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { T3AuthProvider } from "./t3-auth.ts";

export class T3NotSignedInError extends Error {
	constructor(readonly authorizationUrl: string | undefined) {
		super("The bridge is not signed in to T3. Open GET /v1/t3/login to approve it.");
	}
}

/** Thin MCP client for T3's public /mcp tools. One connection, reopened on failure. */
export class T3Client {
	private client: Client | undefined;
	private transport: StreamableHTTPClientTransport | undefined;

	constructor(
		private mcpUrl: string,
		private auth: T3AuthProvider,
	) {}

	private newTransport(): StreamableHTTPClientTransport {
		return new StreamableHTTPClientTransport(new URL(this.mcpUrl), { authProvider: this.auth });
	}

	async connect(): Promise<Client> {
		if (this.client) return this.client;
		const transport = this.newTransport();
		const client = new Client({ name: "t3-bridge", version: "0.1.0" });
		try {
			await client.connect(transport);
		} catch (error) {
			if (error instanceof UnauthorizedError) {
				this.transport = transport;
				throw new T3NotSignedInError(this.auth.pendingAuthorizationUrl?.toString());
			}
			throw error;
		}
		this.client = client;
		this.transport = transport;
		return client;
	}

	/** Starts (or restarts) the OAuth flow and returns the URL a person opens to approve. */
	async startLogin(): Promise<string> {
		this.auth.invalidateCredentials("tokens");
		await this.close();
		try {
			await this.connect();
		} catch (error) {
			if (error instanceof T3NotSignedInError && error.authorizationUrl) return error.authorizationUrl;
			throw error;
		}
		throw new Error("T3 accepted the connection without a sign-in.");
	}

	async finishLogin(code: string): Promise<void> {
		const transport = this.transport ?? this.newTransport();
		await transport.finishAuth(code);
		await this.close();
		await this.connect();
	}

	async close(): Promise<void> {
		const client = this.client;
		this.client = undefined;
		this.transport = undefined;
		await client?.close().catch(() => undefined);
	}

	async listTools(): Promise<{ name: string; description?: string; inputSchema: unknown }[]> {
		const client = await this.connect();
		const result = await client.listTools();
		return result.tools;
	}

	/**
	 * Calls a tool and returns its structured content, or parsed JSON text content.
	 * A lost MCP session (for example after T3 restarts) is reopened once.
	 */
	async call(name: string, args: Record<string, unknown>, timeoutMs = 60_000): Promise<unknown> {
		try {
			return await this.callOnce(name, args, timeoutMs);
		} catch (error) {
			if (error instanceof T3NotSignedInError || !isTransportError(error)) throw error;
			await this.close();
			return this.callOnce(name, args, timeoutMs);
		}
	}

	private async callOnce(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
		const client = await this.connect();
		try {
			const result = await client.callTool({ name, arguments: args }, undefined, {
				timeout: timeoutMs,
				resetTimeoutOnProgress: true,
			});
			if (result.isError) throw new Error(`T3 tool ${name} failed: ${textOf(result.content)}`);
			if (result.structuredContent) return result.structuredContent;
			const text = textOf(result.content);
			try {
				return JSON.parse(text);
			} catch {
				return text;
			}
		} catch (error) {
			if (error instanceof UnauthorizedError) {
				await this.close();
				throw new T3NotSignedInError(undefined);
			}
			throw error;
		}
	}
}

function isTransportError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /Streamable HTTP error|fetch failed|ECONNRESET|ECONNREFUSED|socket|Not connected/i.test(message);
}

function textOf(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : ""))
		.join("\n");
}
