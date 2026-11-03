import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
	OAuthClientInformationMixed,
	OAuthClientMetadata,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Store } from "./store.ts";

/**
 * OAuth client for T3's /mcp endpoint, persisted in the bridge store.
 * T3 grants are approved once with a pairing code and last 30 days (no refresh grant).
 */
export class T3AuthProvider implements OAuthClientProvider {
	pendingAuthorizationUrl: URL | undefined;

	constructor(
		private store: Store,
		private callbackUrl: string,
	) {}

	get redirectUrl(): string {
		return this.callbackUrl;
	}

	get clientMetadata(): OAuthClientMetadata {
		return {
			client_name: "T3 Bridge (Slack and REST)",
			redirect_uris: [this.callbackUrl],
			grant_types: ["authorization_code"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
			scope: "orchestration:read orchestration:operate",
		};
	}

	clientInformation(): OAuthClientInformationMixed | undefined {
		return this.store.get<OAuthClientInformationMixed>("oauth.client");
	}

	saveClientInformation(info: OAuthClientInformationMixed): void {
		this.store.set("oauth.client", info);
	}

	tokens(): OAuthTokens | undefined {
		return this.store.get<OAuthTokens>("oauth.tokens");
	}

	saveTokens(tokens: OAuthTokens): void {
		this.store.set("oauth.tokens", tokens);
		const expiresAt = tokens.expires_in
			? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
			: null;
		this.store.set("oauth.tokensSavedAt", { at: new Date().toISOString(), expiresAt });
	}

	redirectToAuthorization(url: URL): void {
		this.pendingAuthorizationUrl = url;
	}

	saveCodeVerifier(verifier: string): void {
		this.store.set("oauth.verifier", verifier);
	}

	codeVerifier(): string {
		const verifier = this.store.get<string>("oauth.verifier");
		if (!verifier) throw new Error("No PKCE verifier saved; start the login again.");
		return verifier;
	}

	invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
		if (scope === "all" || scope === "tokens") this.store.delete("oauth.tokens");
		if (scope === "all" || scope === "client") this.store.delete("oauth.client");
		if (scope === "all" || scope === "verifier") this.store.delete("oauth.verifier");
	}
}
