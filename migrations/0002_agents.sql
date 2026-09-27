-- Slice 2: agent sub-identity + short-lived tokens.
-- Raw bearer tokens are not stored. token_hash is SHA-256 hex of the
-- secret returned once at issue time. revoked_at IS NOT NULL is the
-- denylist: the next introspect/verify read fails immediately (no cache).

CREATE TABLE IF NOT EXISTS agents (
  agent_id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts (account_id)
);

CREATE INDEX IF NOT EXISTS idx_agents_account_id ON agents (account_id);

CREATE TABLE IF NOT EXISTS agent_tokens (
  token_id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  agent_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents (agent_id),
  FOREIGN KEY (account_id) REFERENCES accounts (account_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_tokens_agent_id ON agent_tokens (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_tokens_account_id ON agent_tokens (account_id);
