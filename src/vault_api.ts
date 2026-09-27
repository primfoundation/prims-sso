/** Connector vault HTTP handlers (Slice 4 stub). No OAuth providers. */

import { AccountStore, type Account } from "./accounts";
import { AgentStore, type Agent } from "./agents";
import { requireSession, type AuthEnv } from "./auth";
import {
  normalizeConnectorId,
  normalizeFakeToken,
  normalizeRef,
  toAgentMetadata,
  VaultStore,
} from "./vault";

export interface VaultEnv extends AuthEnv {
  DB: D1Database;
}

const AGENT_ONE = /^\/v1\/agents\/([^/]+)$/;
const AGENT_VAULT = /^\/v1\/agents\/([^/]+)\/vault$/;
const AGENT_REVOKE = /^\/v1\/agents\/([^/]+)\/revoke$/;

function revokeError(reason: "not_found" | "forbidden"): Response {
  if (reason === "forbidden") return json({ error: "forbidden" }, 403);
  return json({ error: "not found" }, 404);
}

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
  env: VaultEnv,
): Promise<{ account: Account } | Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;
  const account = await new AccountStore(env.DB).getByStytchUserId(
    session.stytch_user_id,
  );
  if (!account) return json({ error: "not found" }, 404);
  return { account };
}

async function ownedAgent(
  env: VaultEnv,
  agent_id: string,
  account_id: string,
): Promise<Agent | Response> {
  const agent = await new AgentStore(env.DB).get(agent_id);
  if (!agent) return json({ error: "not found" }, 404);
  if (agent.account_id !== account_id) return json({ error: "forbidden" }, 403);
  return agent;
}

/** POST /v1/agents/:agent_id/vault — owner session. Response is the ref only. */
export async function handleStoreVault(
  request: Request,
  env: VaultEnv,
  agent_id: string,
): Promise<Response> {
  const owner = await requireOwner(request, env);
  if (owner instanceof Response) return owner;
  const gated = await ownedAgent(env, agent_id, owner.account.account_id);
  if (gated instanceof Response) return gated;
  const body = await readBody(request);
  const connector_id = normalizeConnectorId(body.connector_id);
  if (!connector_id) {
    return json({ error: "connector_id is required (1-128 characters)" }, 400);
  }
  const token = normalizeFakeToken(body.token);
  if (!token) return json({ error: "token is required (1-4096 characters)" }, 400);
  const stored = await new VaultStore(env.DB).store({ agent_id, connector_id, token });
  if (!stored) return json({ error: "not found" }, 404);
  return json(stored, 201);
}

/** GET /v1/agents/:agent_id — metadata plus connector refs. Never the raw token. */
export async function handleAgentMetadata(
  request: Request,
  env: VaultEnv,
  agent_id: string,
): Promise<Response> {
  const owner = await requireOwner(request, env);
  if (owner instanceof Response) return owner;
  const gated = await ownedAgent(env, agent_id, owner.account.account_id);
  if (gated instanceof Response) return gated;
  const connectors = await new VaultStore(env.DB).listRefs(agent_id);
  return json(toAgentMetadata(gated, connectors));
}

/**
 * POST /v1/vault/retrieve — owner session only.
 * Body { ref } returns the fake token. Missing or another account's ref is 404.
 */
export async function handleRetrieveVault(
  request: Request,
  env: VaultEnv,
): Promise<Response> {
  const owner = await requireOwner(request, env);
  if (owner instanceof Response) return owner;
  const ref = normalizeRef((await readBody(request)).ref);
  if (!ref) return json({ error: "ref is required" }, 400);
  const secret = await new VaultStore(env.DB).retrieve(ref);
  if (!secret) return json({ error: "not found" }, 404);
  const gated = await ownedAgent(env, secret.agent_id, owner.account.account_id);
  if (gated instanceof Response) return json({ error: "not found" }, 404);
  return json({
    ref: secret.ref,
    agent_id: secret.agent_id,
    connector_id: secret.connector_id,
    token: secret.token,
  });
}

/** POST /v1/agents/:agent_id/revoke — denylist tokens and delete vault rows. */
export async function handleRevokeAgent(
  request: Request,
  env: VaultEnv,
  agent_id: string,
): Promise<Response> {
  const owner = await requireOwner(request, env);
  if (owner instanceof Response) return owner;
  const revoked = await new AgentStore(env.DB).revokeAgent({
    account_id: owner.account.account_id,
    agent_id,
  });
  if (!revoked.ok) return revokeError(revoked.reason);
  const vault_entries_deleted = await new VaultStore(env.DB).deleteByAgent(agent_id);
  return json({ revoked: true, agent_id, vault_entries_deleted });
}

/** Slice 4 routes. Null when the path is not a vault route. */
export async function dispatchVaultRoutes(
  request: Request,
  env: VaultEnv,
  path: string,
  method: string,
): Promise<Response | null> {
  if (method === "POST" && path === "/v1/vault/retrieve") {
    return handleRetrieveVault(request, env);
  }
  const vault = AGENT_VAULT.exec(path);
  if (method === "POST" && vault) {
    return handleStoreVault(request, env, decodeURIComponent(vault[1]));
  }
  const revoke = AGENT_REVOKE.exec(path);
  if (method === "POST" && revoke) {
    return handleRevokeAgent(request, env, decodeURIComponent(revoke[1]));
  }
  const meta = AGENT_ONE.exec(path);
  if (method === "GET" && meta) {
    return handleAgentMetadata(request, env, decodeURIComponent(meta[1]));
  }
  return null;
}
