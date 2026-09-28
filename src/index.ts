/**
 * prims-sso — Stytch passkey façade (Slice 0), Prims accounts (Slice 1),
 * agent sub-identity tokens (Slice 2), an RBAC allow/deny stub (Slice 3),
 * and a connector vault stub (Slice 4).
 * RP ID locked to prims.sh (#6). No WebAuthn crypto here.
 */

import {
  handleAccountCreate,
  handleAccountGet,
  handleAccountPatch,
} from "./accounts_api";
import { dispatchAgentRoutes } from "./agents_api";
import { dispatchPolicyRoutes } from "./policy_api";
import { dispatchVaultRoutes } from "./vault_api";
import { AccountStore } from "./accounts";
import { renderPage } from "./html";
import { authorizePage, loginContinuation } from "./oauth";
import {
  clearSessionCookieHeader,
  DEFAULT_SESSION_COOKIE,
  parseCookies,
  sessionCookieHeader,
} from "./session";
import { StytchApiError, stytchFromEnv, type StytchClient } from "./stytch";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  RP_ID: string;
  SESSION_COOKIE: string;
  SESSION_DURATION_MINUTES: string;
  STYTCH_PROJECT_ID?: string;
  STYTCH_SECRET?: string;
  STYTCH_ENV?: string;
  CONNECTED_APPS_ENABLED?: string;
}

function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function html(body: string, status = 200, headers?: HeadersInit): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...headers,
    },
  });
}

function getClient(env: Env): StytchClient {
  return stytchFromEnv(env);
}

function rpId(env: Env): string {
  return env.RP_ID || "prims.sh";
}

function cookieName(env: Env): string {
  return env.SESSION_COOKIE || DEFAULT_SESSION_COOKIE;
}

function sessionMinutes(env: Env): number {
  const n = Number(env.SESSION_DURATION_MINUTES || "60");
  return Number.isFinite(n) && n >= 5 ? n : 60;
}

async function readJson<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}

async function resolveUserIdByEmail(
  stytch: StytchClient,
  email: string,
): Promise<string | null> {
  try {
    const found = await stytch.searchUsersByEmail(email);
    return found.results?.[0]?.user_id ?? null;
  } catch (err) {
    if (err instanceof StytchApiError && err.status === 404) return null;
    if (
      err instanceof StytchApiError &&
      err.body.error_type === "user_not_found"
    ) {
      return null;
    }
    throw err;
  }
}

async function ensureUser(stytch: StytchClient, email: string): Promise<string> {
  const existing = await resolveUserIdByEmail(stytch, email);
  if (existing) return existing;
  return (await stytch.createUser(email)).user_id;
}

/** Best-effort Prims account upsert after passkey session mint. */
async function upsertAccountForUser(
  env: Env,
  stytch: StytchClient,
  user_id: string,
): Promise<void> {
  if (!env.DB) return;
  try {
    const user = await stytch.usersGet(user_id);
    const email =
      user.emails?.find((e) => e.primary)?.email ||
      user.emails?.[0]?.email ||
      "";
    if (!email) return;
    await new AccountStore(env.DB).upsertOnLogin({
      stytch_user_id: user_id,
      email,
    });
  } catch {
    // Account upsert must not break passkey login.
  }
}

function mapStytchError(err: unknown): Response {
  if (err instanceof StytchApiError) {
    return json(
      {
        error: err.body.error_message ?? err.message,
        error_type: err.body.error_type,
        request_id: err.body.request_id,
      },
      err.status >= 400 && err.status < 600 ? err.status : 502,
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  const status = /Missing STYTCH_/.test(message) ? 503 : 500;
  return json({ error: message }, status);
}

async function handleRegisterStart(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await readJson<{ email?: string }>(request);
  const email = body.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return json({ error: "Valid email is required" }, 400);
  }
  const stytch = getClient(env);
  const user_id = await ensureUser(stytch, email);
  const start = await stytch.webauthnRegisterStart({
    user_id,
    domain: rpId(env),
  });
  return json({
    user_id: start.user_id,
    public_key_credential_creation_options:
      start.public_key_credential_creation_options,
  });
}

async function handleRegisterFinish(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await readJson<{
    user_id?: string;
    public_key_credential?: string;
  }>(request);
  if (!body.user_id || !body.public_key_credential) {
    return json({ error: "user_id and public_key_credential required" }, 400);
  }
  const stytch = getClient(env);
  const minutes = sessionMinutes(env);
  const result = await stytch.webauthnRegister({
    user_id: body.user_id,
    public_key_credential: body.public_key_credential,
    session_duration_minutes: minutes,
  });
  await upsertAccountForUser(env, stytch, result.user_id);
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
  });
  const sessionToken = result.session_token || result.session_jwt;
  if (sessionToken) {
    headers.append(
      "Set-Cookie",
      sessionCookieHeader(cookieName(env), sessionToken, minutes * 60),
    );
  }
  return new Response(
    JSON.stringify({
      ok: true,
      user_id: result.user_id,
      has_session: Boolean(result.session_token),
    }),
    { status: 200, headers },
  );
}

async function handleLoginStart(request: Request, env: Env): Promise<Response> {
  const body = await readJson<{ email?: string }>(request);
  const email = body.email?.trim().toLowerCase();
  const stytch = getClient(env);
  let user_id: string | undefined;
  if (email) {
    const found = await resolveUserIdByEmail(stytch, email);
    if (!found) {
      return json(
        { error: "No account for that email. Register a passkey first." },
        404,
      );
    }
    user_id = found;
  }
  const start = await stytch.webauthnAuthenticateStart({
    domain: rpId(env),
    user_id,
  });
  return json({
    user_id: start.user_id,
    public_key_credential_request_options:
      start.public_key_credential_request_options,
  });
}

async function handleLoginFinish(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await readJson<{ public_key_credential?: string }>(request);
  if (!body.public_key_credential) {
    return json({ error: "public_key_credential required" }, 400);
  }
  const stytch = getClient(env);
  const minutes = sessionMinutes(env);
  const result = await stytch.webauthnAuthenticate({
    public_key_credential: body.public_key_credential,
    session_duration_minutes: minutes,
  });
  await upsertAccountForUser(env, stytch, result.user_id);
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
  });
  const sessionToken = result.session_token || result.session_jwt;
  if (sessionToken) {
    headers.append(
      "Set-Cookie",
      sessionCookieHeader(cookieName(env), sessionToken, minutes * 60),
    );
  }
  return new Response(
    JSON.stringify({
      ok: true,
      user_id: result.user_id,
      has_session: Boolean(result.session_token),
    }),
    { status: 200, headers },
  );
}

async function handleSessionPage(
  request: Request,
  env: Env,
): Promise<Response> {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const token = cookies[cookieName(env)];
  if (!token) {
    return Response.redirect(new URL("/", request.url).toString(), 302);
  }
  try {
    const stytch = getClient(env);
    const auth = await stytch.sessionsAuthenticate(token);
    return html(
      renderPage({
        mode: "signed-in",
        rpId: rpId(env),
        userId: auth.user_id,
      }),
    );
  } catch {
    const headers = new Headers();
    headers.append("Set-Cookie", clearSessionCookieHeader(cookieName(env)));
    headers.set("Location", "/");
    return new Response(null, { status: 302, headers });
  }
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const token = cookies[cookieName(env)];
  if (token) {
    try {
      await getClient(env).sessionsRevoke(token);
    } catch {
      // Best-effort revoke; always clear local cookie.
    }
  }
  const headers = new Headers();
  headers.append("Set-Cookie", clearSessionCookieHeader(cookieName(env)));
  headers.set("Location", "/");
  return new Response(null, { status: 302, headers });
}

async function handleHealth(env: Env): Promise<Response> {
  const configured = Boolean(
    env.STYTCH_PROJECT_ID?.trim() && env.STYTCH_SECRET?.trim(),
  );
  let stytch_env: string | null = null;
  if (configured) {
    try {
      stytch_env = getClient(env).envName;
    } catch {
      stytch_env = null;
    }
  }
  return json({
    ok: true,
    service: "prims-sso",
    slice: 4,
    rp_id: rpId(env),
    stytch_configured: configured,
    stytch_env,
    d1_bound: Boolean(env.DB),
    secrets_expected: [
      "STYTCH_PROJECT_ID",
      "STYTCH_SECRET",
      "STYTCH_PUBLIC_TOKEN",
      "STYTCH_API_HOST",
      "STYTCH_PROJECT_DOMAIN",
      "STYTCH_ENV_SLUG",
    ],
  });
}

const ACCOUNT_PATH = /^\/v1\/accounts\/([^/]+)$/;

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    try {
      if (method === "GET" && path === "/health") {
        return handleHealth(env);
      }

      if (path === "/oauth/authorize") return authorizePage(request, env);

      if (method === "GET" && (path === "/" || path === "/login")) {
        return html(renderPage({ mode: "login", rpId: rpId(env), returnTo: loginContinuation(url.searchParams.get('return_to')) }),200,{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
      }
      if (method === "GET" && path === "/register") {
        return html(renderPage({ mode: "register", rpId: rpId(env), returnTo: loginContinuation(url.searchParams.get('return_to')) }),200,{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
      }
      if (method === "GET" && path === "/session") {
        return handleSessionPage(request, env);
      }

      if (method === "POST" && path === "/api/passkey/register/start") {
        return await handleRegisterStart(request, env);
      }
      if (method === "POST" && path === "/api/passkey/register/finish") {
        return await handleRegisterFinish(request, env);
      }
      if (method === "POST" && path === "/api/passkey/login/start") {
        return await handleLoginStart(request, env);
      }
      if (method === "POST" && path === "/api/passkey/login/finish") {
        return await handleLoginFinish(request, env);
      }
      if ((method === "POST" || method === "GET") && path === "/api/logout") {
        return handleLogout(request, env);
      }

      // Slice 1 — Account API
      if (method === "POST" && path === "/v1/accounts") {
        return await handleAccountCreate(request, env);
      }
      const acc = ACCOUNT_PATH.exec(path);
      if (acc) {
        const account_id = decodeURIComponent(acc[1]);
        if (method === "GET") {
          return await handleAccountGet(request, env, account_id);
        }
        if (method === "PATCH") {
          return await handleAccountPatch(request, env, account_id);
        }
      }

      const agentResponse = await dispatchAgentRoutes(request, env, path, method);
      if (agentResponse) return agentResponse;

      const policyResponse = await dispatchPolicyRoutes(request, env, path, method);
      if (policyResponse) return policyResponse;

      const vaultResponse = await dispatchVaultRoutes(request, env, path, method);
      if (vaultResponse) return vaultResponse;

      if (env.ASSETS) {
        const asset = await env.ASSETS.fetch(request);
        if (asset.status !== 404) return asset;
      }
      return json({ error: "not found" }, 404);
    } catch (err) {
      return mapStytchError(err);
    }
  },
};
