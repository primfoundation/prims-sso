-- Slice 1: Prims account model (primary store = D1)
-- Why D1: SQL schema + checked-in migrations (A1.4), simple CRUD by
-- account_id/email, and enough for thousands of rows before we need DO
-- sharding. Durable Objects reserved for later coordination-heavy state.

CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  stytch_user_id TEXT NOT NULL UNIQUE,
  linked_apple TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts (email);
CREATE INDEX IF NOT EXISTS idx_accounts_stytch_user_id ON accounts (stytch_user_id);
