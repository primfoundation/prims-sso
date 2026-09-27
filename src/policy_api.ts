/** Policy grant + check HTTP handlers (Slice 3 RBAC stub). */

import { AccountStore, type Account } from "./accounts";
import { AgentStore } from "./agents";
import { requireSession, type AuthEnv } from "./auth";
import {
  normalizeAgentId,
  normalizeResource,
  parseAction,
  parseEffect,
  PolicyStore,
  type PolicyAction,
  type PolicyEffect,
} from "./policy";

export interface PolicyEnv extends AuthEnv {
  DB: D1Database;
}

const AGENT_POLICY = /^\/v1\/agents\/([^/]+)\/policy$/;

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
    // Empty or non-JSON bodies fail field validation.
  }
  return {};
}

async function requireOwner(
  request: Request,
  env: PolicyEnv,
): Promise<{ account: Account } | Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;
  const account = await new AccountStore(env.DB).getByStytchUserId(
    session.stytch_user_id,
  );
  if (!account) return json({ error: "not found" }, 404);
  return { account };
}

function parseGrant(body: Record<string, unknown>):
  | { resource: string; action: PolicyAction; effect: PolicyEffect }
  | { error: string } {
  const resource = normalizeResource(body.resource);
  if (!resource) return { error: "resource is required (1-256 characters)" };
  const action = parseAction(body.action);
  if (!action) return { error: "action must be read or write" };
  const effect =
    body.effect === undefined ? "allow" : parseEffect(body.effect);
  if (!effect) return { error: "effect must be allow or deny" };
  return { resource, action, effect };
}

function parseCheck(body: Record<string, unknown>):
  | { agent_id: string; resource: string; action: PolicyAction }
  | { error: string } {
  const agent_id = normalizeAgentId(body.agent_id);
  if (!agent_id) return { error: "agent_id is required" };
  const resource = normalizeResource(body.resource);
  if (!resource) return { error: "resource is required (1-256 characters)" };
  const action = parseAction(body.action);
  if (!action) return { error: "action must be read or write" };
  return { agent_id, resource, action };
}

/** POST /v1/agents/:agent_id/policy — owner of the agent's account. */
export async function handlePolicyGrant(
  request: Request,
  env: PolicyEnv,
  agent_id: string,
): Promise<Response> {
  const owner = await requireOwner(request, env);
  if (owner instanceof Response) return owner;
  const gated = await ownedAgent(env, agent_id, owner.account.account_id);
  if (gated instanceof Response) return gated;
  const parsed = parseGrant(await readBody(request));
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  const row = await new PolicyStore(env.DB).grant({ agent_id, ...parsed });
  if (!row) return json({ error: "not found" }, 404);
  return json(row, 201);
}

async function ownedAgent(
  env: PolicyEnv,
  agent_id: string,
  account_id: string,
): Promise<true | Response> {
  const agent = await new AgentStore(env.DB).get(agent_id);
  if (!agent) return json({ error: "not found" }, 404);
  if (agent.account_id !== account_id) return json({ error: "forbidden" }, 403);
  return true;
}

/**
 * POST /v1/policy/check
 * Body { agent_id, resource, action } → { allow }.
 * Stub: no human session. Missing allow, and any matching deny, are false.
 */
export async function handlePolicyCheck(
  request: Request,
  env: PolicyEnv,
): Promise<Response> {
  const parsed = parseCheck(await readBody(request));
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  const allow = await new PolicyStore(env.DB).check(parsed);
  return json({ allow });
}

/** Slice 3 routes. Null when the path is not a policy route. */
export async function dispatchPolicyRoutes(
  request: Request,
  env: PolicyEnv,
  path: string,
  method: string,
): Promise<Response | null> {
  if (method !== "POST") return null;
  if (path === "/v1/policy/check") return handlePolicyCheck(request, env);
  const grant = AGENT_POLICY.exec(path);
  if (!grant) return null;
  return handlePolicyGrant(request, env, decodeURIComponent(grant[1]));
}
