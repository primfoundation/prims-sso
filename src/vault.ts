/**
 * Slice 4 connector vault stub.
 * Stores a fake token keyed by agent_id + connector_id.
 * Metadata callers receive `ref` only. No OAuth providers.
 */

export interface StoredVaultRef {
  ref: string;
  agent_id: string;
  connector_id: string;
  created_at: string;
  updated_at: string;
}

export interface VaultSecret extends StoredVaultRef {
  token: string;
}

export interface ConnectorRef {
  ref: string;
  connector_id: string;
}

export interface AgentMetadata {
  agent_id: string;
  account_id: string;
  display_name: string;
  created_at: string;
  updated_at: string;
  connectors: ConnectorRef[];
}

const CONNECTOR_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_FAKE_TOKEN = 4096;
const MAX_REF = 80;

interface AgentFields {
  agent_id: string;
  account_id: string;
  display_name: string;
  created_at: string;
  updated_at: string;
}

function iso(now?: Date): string {
  return (now ?? new Date()).toISOString();
}

export function normalizeConnectorId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const connector_id = input.trim();
  if (!CONNECTOR_ID.test(connector_id)) return null;
  return connector_id;
}

export function normalizeFakeToken(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const token = input.trim();
  if (!token || token.length > MAX_FAKE_TOKEN) return null;
  return token;
}

export function normalizeRef(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const ref = input.trim();
  if (!ref || ref.length > MAX_REF) return null;
  return ref;
}

/** Explicit field pick so a raw vault token cannot ride along on agent JSON. */
export function toAgentMetadata(
  agent: AgentFields,
  connectors: ConnectorRef[],
): AgentMetadata {
  return {
    agent_id: agent.agent_id,
    account_id: agent.account_id,
    display_name: agent.display_name,
    created_at: agent.created_at,
    updated_at: agent.updated_at,
    connectors: connectors.map((row) => ({
      ref: row.ref,
      connector_id: row.connector_id,
    })),
  };
}

export class VaultStore {
  constructor(private readonly db: D1Database) {}

  /** Upsert by (agent_id, connector_id). Returns the ref, never the token. */
  async store(input: {
    agent_id: string;
    connector_id: string;
    token: string;
    now?: Date;
  }): Promise<StoredVaultRef | null> {
    if (!(await this.agentExists(input.agent_id))) return null;
    const stamp = iso(input.now);
    await this.insert(input, `vref_${crypto.randomUUID()}`, stamp);
    return this.publicByConnector(input.agent_id, input.connector_id);
  }

  async retrieve(ref: string): Promise<VaultSecret | null> {
    const row = await this.db
      .prepare(
        `SELECT ref, agent_id, connector_id, token, created_at, updated_at
         FROM connector_vault WHERE ref = ?`,
      )
      .bind(ref)
      .first<VaultSecret>();
    return row ?? null;
  }

  async listRefs(agent_id: string): Promise<ConnectorRef[]> {
    const rows = await this.db
      .prepare(
        `SELECT ref, connector_id FROM connector_vault
         WHERE agent_id = ? ORDER BY connector_id`,
      )
      .bind(agent_id)
      .all<ConnectorRef>();
    return rows.results ?? [];
  }

  /** Drop every vault row for an agent. Old refs then 404. */
  async deleteByAgent(agent_id: string): Promise<number> {
    const existing = await this.db
      .prepare("SELECT COUNT(*) AS n FROM connector_vault WHERE agent_id = ?")
      .bind(agent_id)
      .first<{ n: number }>();
    await this.db
      .prepare("DELETE FROM connector_vault WHERE agent_id = ?")
      .bind(agent_id)
      .run();
    return Number(existing?.n ?? 0);
  }

  private async agentExists(agent_id: string): Promise<boolean> {
    const row = await this.db
      .prepare("SELECT agent_id FROM agents WHERE agent_id = ?")
      .bind(agent_id)
      .first<{ agent_id: string }>();
    return Boolean(row);
  }

  private async insert(
    input: { agent_id: string; connector_id: string; token: string },
    ref: string,
    stamp: string,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO connector_vault
          (ref, agent_id, connector_id, token, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(agent_id, connector_id) DO UPDATE SET
           token = excluded.token,
           updated_at = excluded.updated_at`,
      )
      .bind(ref, input.agent_id, input.connector_id, input.token, stamp, stamp)
      .run();
  }

  private async publicByConnector(
    agent_id: string,
    connector_id: string,
  ): Promise<StoredVaultRef | null> {
    const row = await this.db
      .prepare(
        `SELECT ref, agent_id, connector_id, created_at, updated_at
         FROM connector_vault
         WHERE agent_id = ? AND connector_id = ?`,
      )
      .bind(agent_id, connector_id)
      .first<StoredVaultRef>();
    return row ?? null;
  }
}
