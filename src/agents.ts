/** Agent sub-identities and hashed short-lived tokens (Slice 2, D1). */

import { generateAgentToken, hashAgentToken } from "./agent_tokens";

export interface Agent {
  agent_id: string;
  account_id: string;
  display_name: string;
  created_at: string;
  updated_at: string;
}

export interface IssuedAgentToken {
  token: string;
  token_id: string;
  agent_id: string;
  account_id: string;
  expires_at: string;
  ttl_seconds: number;
}

export interface ActiveIntrospection {
  active: true;
  agent_id: string;
  account_id: string;
  token_id: string;
  expires_at: string;
}

export type Introspection = ActiveIntrospection | { active: false };

export type RevokeAgentResult =
  | { ok: true; agent_id: string }
  | { ok: false; reason: "not_found" | "forbidden" };

interface TokenRow {
  token_id: string;
  token_hash: string;
  agent_id: string;
  account_id: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

const TOKEN_SELECT =
  "SELECT token_id, token_hash, agent_id, account_id, expires_at, revoked_at, created_at FROM agent_tokens";

function iso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

function isLive(row: TokenRow, now: Date): boolean {
  if (row.revoked_at) return false;
  const expiresMs = Date.parse(row.expires_at);
  return Number.isFinite(expiresMs) && expiresMs > now.getTime();
}

export class AgentStore {
  constructor(private readonly db: D1Database) {}

  async create(input: {
    account_id: string;
    display_name: string;
    now?: Date;
  }): Promise<Agent> {
    const stamp = iso(input.now);
    const agent: Agent = {
      agent_id: `agent_${crypto.randomUUID()}`,
      account_id: input.account_id,
      display_name: input.display_name,
      created_at: stamp,
      updated_at: stamp,
    };
    await this.db
      .prepare(
        `INSERT INTO agents
          (agent_id, account_id, display_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        agent.agent_id,
        agent.account_id,
        agent.display_name,
        agent.created_at,
        agent.updated_at,
      )
      .run();
    return agent;
  }

  async get(agent_id: string): Promise<Agent | null> {
    const row = await this.db
      .prepare(
        `SELECT agent_id, account_id, display_name, created_at, updated_at
         FROM agents WHERE agent_id = ?`,
      )
      .bind(agent_id)
      .first<Agent>();
    return row ?? null;
  }

  /** Returns the raw token once. D1 stores only token_hash. */
  async issueToken(input: {
    agent_id: string;
    ttl_seconds: number;
    now?: Date;
  }): Promise<IssuedAgentToken | null> {
    const agent = await this.get(input.agent_id);
    if (!agent) return null;
    const now = input.now ?? new Date();
    const token = generateAgentToken();
    const issued: IssuedAgentToken = {
      token,
      token_id: `tok_${crypto.randomUUID()}`,
      agent_id: agent.agent_id,
      account_id: agent.account_id,
      expires_at: new Date(now.getTime() + input.ttl_seconds * 1000).toISOString(),
      ttl_seconds: input.ttl_seconds,
    };
    await this.insertToken(issued, await hashAgentToken(token), iso(now));
    return issued;
  }

  async introspect(token: string, now = new Date()): Promise<Introspection> {
    const row = await this.byHash(await hashAgentToken(token));
    if (!row || !isLive(row, now)) return { active: false };
    return {
      active: true,
      agent_id: row.agent_id,
      account_id: row.account_id,
      token_id: row.token_id,
      expires_at: row.expires_at,
    };
  }

  /**
   * Denylist one token owned by account_id. Idempotent if already revoked.
   * Returns null when the token is missing or owned by someone else.
   */
  async revoke(input: {
    account_id: string;
    token_id?: string;
    token?: string;
    now?: Date;
  }): Promise<{ token_id: string; agent_id: string; account_id: string } | null> {
    const row = await this.findOwned(input);
    if (!row) return null;
    if (!row.revoked_at) {
      await this.db
        .prepare(
          "UPDATE agent_tokens SET revoked_at = ? WHERE token_id = ? AND account_id = ?",
        )
        .bind(iso(input.now), row.token_id, input.account_id)
        .run();
    }
    return {
      token_id: row.token_id,
      agent_id: row.agent_id,
      account_id: row.account_id,
    };
  }

  /**
   * Denylist every live token for one agent owned by account_id.
   * A second call still succeeds. The vault handler deletes connector rows.
   */
  async revokeAgent(input: {
    account_id: string;
    agent_id: string;
    now?: Date;
  }): Promise<RevokeAgentResult> {
    const agent = await this.get(input.agent_id);
    if (!agent) return { ok: false, reason: "not_found" };
    if (agent.account_id !== input.account_id) {
      return { ok: false, reason: "forbidden" };
    }
    const stamp = iso(input.now);
    await this.db
      .prepare(
        `UPDATE agent_tokens
         SET revoked_at = ?
         WHERE agent_id = ? AND account_id = ? AND revoked_at IS NULL`,
      )
      .bind(stamp, input.agent_id, input.account_id)
      .run();
    await this.db
      .prepare(
        "UPDATE agents SET updated_at = ? WHERE agent_id = ? AND account_id = ?",
      )
      .bind(stamp, input.agent_id, input.account_id)
      .run();
    return { ok: true, agent_id: agent.agent_id };
  }

  private async insertToken(
    issued: IssuedAgentToken,
    token_hash: string,
    created_at: string,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO agent_tokens
          (token_id, token_hash, agent_id, account_id, expires_at, revoked_at, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      )
      .bind(
        issued.token_id,
        token_hash,
        issued.agent_id,
        issued.account_id,
        issued.expires_at,
        created_at,
      )
      .run();
  }

  private async byHash(token_hash: string): Promise<TokenRow | null> {
    const row = await this.db
      .prepare(`${TOKEN_SELECT} WHERE token_hash = ?`)
      .bind(token_hash)
      .first<TokenRow>();
    return row ?? null;
  }

  private async findOwned(input: {
    account_id: string;
    token_id?: string;
    token?: string;
  }): Promise<TokenRow | null> {
    const row = input.token_id
      ? await this.byId(input.token_id)
      : input.token
        ? await this.byHash(await hashAgentToken(input.token))
        : null;
    if (!row || row.account_id !== input.account_id) return null;
    return row;
  }

  private async byId(token_id: string): Promise<TokenRow | null> {
    const row = await this.db
      .prepare(`${TOKEN_SELECT} WHERE token_id = ?`)
      .bind(token_id)
      .first<TokenRow>();
    return row ?? null;
  }
}
