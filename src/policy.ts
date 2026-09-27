/**
 * Slice 3 RBAC stub: exact-match allow/deny rows in D1.
 * Not OpenFGA. Swap this store for an OpenFGA/Authzed client later (#6 §6).
 * Precedence: matching deny overrides matching allow; no allow row is deny.
 */

export type PolicyAction = "read" | "write";
export type PolicyEffect = "allow" | "deny";

export interface PolicyGrant {
  agent_id: string;
  resource: string;
  action: PolicyAction;
  effect: PolicyEffect;
  created_at: string;
  updated_at: string;
}

export interface PolicyTuple {
  agent_id: string;
  resource: string;
  action: PolicyAction;
  effect: PolicyEffect;
}

const MAX_RESOURCE_LEN = 256;
const MAX_AGENT_ID_LEN = 128;

export function parseAction(input: unknown): PolicyAction | null {
  if (input === "read" || input === "write") return input;
  return null;
}

export function parseEffect(input: unknown): PolicyEffect | null {
  if (input === "allow" || input === "deny") return input;
  return null;
}

export function normalizeResource(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const resource = input.trim();
  if (!resource || resource.length > MAX_RESOURCE_LEN) return null;
  return resource;
}

export function normalizeAgentId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const agent_id = input.trim();
  if (!agent_id || agent_id.length > MAX_AGENT_ID_LEN) return null;
  return agent_id;
}

function iso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

export class PolicyStore {
  constructor(private readonly db: D1Database) {}

  /** Insert or refresh one row. Null when the agent does not exist. */
  async grant(input: PolicyTuple & { now?: Date }): Promise<PolicyGrant | null> {
    if (!(await this.agentExists(input.agent_id))) return null;
    const stamp = iso(input.now);
    await this.upsert(input, stamp);
    return this.getExact(input);
  }

  /**
   * Deny overrides allow when both rows match the same tuple.
   * No matching allow → false (default deny).
   */
  async check(input: {
    agent_id: string;
    resource: string;
    action: PolicyAction;
  }): Promise<boolean> {
    if (await this.match(input, "deny")) return false;
    return this.match(input, "allow");
  }

  private async agentExists(agent_id: string): Promise<boolean> {
    const row = await this.db
      .prepare("SELECT agent_id FROM agents WHERE agent_id = ?")
      .bind(agent_id)
      .first<{ agent_id: string }>();
    return Boolean(row);
  }

  private async upsert(input: PolicyTuple, stamp: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO agent_policies
          (agent_id, resource, action, effect, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(agent_id, resource, action, effect)
         DO UPDATE SET updated_at = excluded.updated_at`,
      )
      .bind(
        input.agent_id,
        input.resource,
        input.action,
        input.effect,
        stamp,
        stamp,
      )
      .run();
  }

  private async getExact(input: PolicyTuple): Promise<PolicyGrant | null> {
    const row = await this.db
      .prepare(
        `SELECT agent_id, resource, action, effect, created_at, updated_at
         FROM agent_policies
         WHERE agent_id = ? AND resource = ? AND action = ? AND effect = ?`,
      )
      .bind(input.agent_id, input.resource, input.action, input.effect)
      .first<PolicyGrant>();
    return row ?? null;
  }

  private async match(
    input: { agent_id: string; resource: string; action: PolicyAction },
    effect: PolicyEffect,
  ): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT effect FROM agent_policies
         WHERE agent_id = ? AND resource = ? AND action = ? AND effect = ?
         LIMIT 1`,
      )
      .bind(input.agent_id, input.resource, input.action, effect)
      .first<{ effect: string }>();
    return Boolean(row);
  }
}
