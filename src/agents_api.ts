/** Agent + token HTTP handlers (Slice 2). Owner session matches Account API. */

import { AccountStore, type Account } from "./accounts";
import { normalizeDisplayName, resolveTtlSeconds } from "./agent_tokens";
import { AgentStore } from "./agents";
import { requireSession, type AuthEnv } from "./auth";

export interface AgentEnv extends AuthEnv {
  DB: D1Database;
}

const ACCOUNT_AGENTS = /^\/v1\/accounts\/([^/]+)\/agents$/;
const AGENT_TOKENS = /^\/v1\/agents\/([^/]+)\/tokens$/;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as unknown;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // Empty or non-JSON bodies use defaults (issue TTL) or fail validation.
  }
  return {};
}

async function requireOwner(
  request: Request,
  env: AgentEnv,
): Promise<{ account: Account } | Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;
  const account = await new AccountStore(env.DB).getByStytchUserId(
    session.stytch_user_id,
  );
  if (!account) return json({ error: "not found" }, 404);
  return { account };
}

/** POST /v1/accounts/:account_id/agents */
export async function handleCreateAgent(
  request: Request,
  env: AgentEnv,
  account_id: string,
): Promise<Response> {
  const owner = await requireOwner(request, env);
  if (owner instanceof Response) return owner;
  if (owner.account.account_id !== account_id) {
    return json({ error: "forbidden" }, 403);
  }
  const display_name = normalizeDisplayName((await readBody(request)).display_name);
  if (!display_name) {
    return json({ error: "display_name is required (1-128 characters)" }, 400);
  }
  const agent = await new AgentStore(env.DB).create({
    account_id,
    display_name,
  });
  return json(agent, 201);
}

/** POST /v1/agents/:agent_id/tokens — raw token returned once. */
export async function handleIssueToken(
  request: Request,
  env: AgentEnv,
  agent_id: string,
): Promise<Response> {
  const owner = await requireOwner(request, env);
  if (owner instanceof Response) return owner;
  const agent = await new AgentStore(env.DB).get(agent_id);
  if (!agent) return json({ error: "not found" }, 404);
  if (agent.account_id !== owner.account.account_id) {
    return json({ error: "forbidden" }, 403);
  }
  const ttl = resolveTtlSeconds((await readBody(request)).ttl_seconds);
  if (typeof ttl !== "number") return json({ error: ttl }, 400);
  const issued = await new AgentStore(env.DB).issueToken({
    agent_id,
    ttl_seconds: ttl,
  });
  if (!issued) return json({ error: "not found" }, 404);
  return json(issued, 201);
}

/**
 * POST /v1/agent-tokens/introspect
 * The agent token is the credential. No human session required.
 * Active → 200 { active, agent_id, ... }. Expired/revoked/unknown → 401.
 */
export async function handleIntrospect(
  request: Request,
  env: AgentEnv,
): Promise<Response> {
  const token = (await readBody(request)).token;
  if (typeof token !== "string" || !token.trim()) {
    return json({ active: false, error: "token is required" }, 400);
  }
  const result = await new AgentStore(env.DB).introspect(token.trim());
  return json(result, result.active ? 200 : 401);
}

/** POST /v1/agent-tokens/revoke — body { token_id } or { token }. */
export async function handleRevoke(
  request: Request,
  env: AgentEnv,
): Promise<Response> {
  const owner = await requireOwner(request, env);
  if (owner instanceof Response) return owner;
  const body = await readBody(request);
  const token_id = typeof body.token_id === "string" ? body.token_id.trim() : "";
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token_id && !token) {
    return json({ error: "token_id or token is required" }, 400);
  }
  const revoked = await new AgentStore(env.DB).revoke({
    account_id: owner.account.account_id,
    token_id: token_id || undefined,
    token: token || undefined,
  });
  if (!revoked) return json({ error: "not found" }, 404);
  return json({ revoked: true, ...revoked });
}

/** Slice 2 routes. Null when the path is not an agent route. */
export async function dispatchAgentRoutes(
  request: Request,
  env: AgentEnv,
  path: string,
  method: string,
): Promise<Response | null> {
  if (method !== "POST") return null;
  if (path === "/v1/agent-tokens/introspect") {
    return handleIntrospect(request, env);
  }
  if (path === "/v1/agent-tokens/revoke") return handleRevoke(request, env);
  const create = ACCOUNT_AGENTS.exec(path);
  if (create) {
    return handleCreateAgent(request, env, decodeURIComponent(create[1]));
  }
  const issue = AGENT_TOKENS.exec(path);
  if (issue) {
    return handleIssueToken(request, env, decodeURIComponent(issue[1]));
  }
  return null;
}
