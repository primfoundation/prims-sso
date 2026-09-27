-- Slice 4: connector credential vault stub.
-- Fake opaque tokens only. No real OAuth providers and no token exchange.
-- Callers outside the authorized retrieve path receive `ref` only.
-- The raw token lives in this table and is not copied onto accounts or agents.
-- Revoking an agent deletes these rows so the old ref is irretrievable.

CREATE TABLE IF NOT EXISTS connector_vault (
  ref TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (agent_id, connector_id),
  FOREIGN KEY (agent_id) REFERENCES agents (agent_id)
);

CREATE INDEX IF NOT EXISTS idx_connector_vault_agent_id
  ON connector_vault (agent_id);
