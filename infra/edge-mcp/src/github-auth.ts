/**
 * GitHub as the upstream identity provider for this MCP server.
 *
 * Why GitHub and not a static bearer token: claude.ai custom connectors accept
 * OAuth (out of the box) or no auth. Fixed-credential request headers
 * (`static_headers`) are beta and org-admin-only, and the MCP authorization
 * spec forbids tokens in the URL. OAuth is the only path that is both
 * available today and not a secret-in-a-URL.
 *
 * Only ALLOWED_GITHUB_LOGIN can finish the flow. The GitHub token obtained here
 * is used solely to learn who the user is; repository writes always go through
 * the separate fine-grained PAT in GITHUB_REPO_PAT.
 */

import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface AuthEnv {
  OAUTH_PROVIDER: OAuthHelpers;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  COOKIE_SECRET: string;
  ALLOWED_GITHUB_LOGIN: string;
}

/** Props handed to the MCP agent for the authenticated user. */
export interface Props extends Record<string, unknown> {
  login: string;
  name: string;
}

const encoder = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(text: string): Uint8Array {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Sign the pending auth request into the OAuth `state` so it survives the GitHub round-trip untampered. */
async function signState(secret: string, req: AuthRequest): Promise<string> {
  const payload = b64url(encoder.encode(JSON.stringify(req)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload));
  return `${payload}.${b64url(new Uint8Array(sig))}`;
}

async function verifyState(secret: string, state: string): Promise<AuthRequest | null> {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    unb64url(sig),
    encoder.encode(payload),
  );
  if (!ok) return null;
  return JSON.parse(new TextDecoder().decode(unb64url(payload))) as AuthRequest;
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export const githubAuthHandler = {
  async fetch(request: Request, env: AuthEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/authorize") {
      const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      if (!oauthReq.clientId) return text("missing client_id", 400);

      const gh = new URL("https://github.com/login/oauth/authorize");
      gh.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      gh.searchParams.set("redirect_uri", new URL("/callback", url.origin).href);
      gh.searchParams.set("scope", "read:user");
      gh.searchParams.set("state", await signState(env.COOKIE_SECRET, oauthReq));
      return Response.redirect(gh.href, 302);
    }

    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) return text("missing code or state", 400);

      const oauthReq = await verifyState(env.COOKIE_SECRET, state);
      if (!oauthReq) return text("invalid state", 400);

      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: new URL("/callback", url.origin).href,
        }),
      });
      const token = (await tokenRes.json()) as { access_token?: string; error?: string };
      if (!token.access_token) return text(`github token exchange failed: ${token.error ?? "unknown"}`, 401);

      const userRes = await fetch("https://api.github.com/user", {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token.access_token}`,
          "user-agent": "dashboard-mcp",
        },
      });
      if (!userRes.ok) return text(`github user lookup failed: ${userRes.status}`, 401);
      const user = (await userRes.json()) as { login: string; name: string | null };

      if (user.login.toLowerCase() !== env.ALLOWED_GITHUB_LOGIN.toLowerCase()) {
        return text(`${user.login} is not authorized for this server`, 403);
      }

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReq,
        userId: user.login,
        metadata: { label: user.login },
        scope: oauthReq.scope,
        props: { login: user.login, name: user.name ?? user.login } satisfies Props,
      });
      return Response.redirect(redirectTo, 302);
    }

    // @cloudflare/workers-oauth-provider serves /.well-known/oauth-authorization-server
    // but not RFC 9728 protected resource metadata, and its 401 carries no
    // resource_metadata pointer. Claude falls back to probing these two paths,
    // so serve them here or discovery 404s and the connector never links.
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
      const suffix = url.pathname.slice("/.well-known/oauth-protected-resource".length);
      // Claude probes /.well-known/oauth-protected-resource/mcp first, then the bare path.
      const resource = new URL(suffix === "" || suffix === "/" ? "/mcp" : suffix, url.origin).href;
      return Response.json({
        resource,
        authorization_servers: [url.origin],
        bearer_methods_supported: ["header"],
      });
    }

    if (url.pathname === "/") {
      return text("dashboard MCP server. Add https://<this-host>/mcp as a custom connector.", 200);
    }

    return text("not found", 404);
  },
};
