-- Slice 3: RBAC allow/deny stub. Not OpenFGA.
-- Exact match on (agent_id, resource, action). No wildcards or inheritance.
-- Precedence at read time (see PolicyStore.check):
--   1. a matching effect=deny wins
--   2. else a matching effect=allow
--   3. else default deny
-- Both effects may exist for one tuple; the primary key allows that pair.
-- Replace this table with an OpenFGA/Authzed-class store later (#6 §6).

CREATE TABLE IF NOT EXISTS agent_policies (
  agent_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('read', 'write')),
  effect TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, resource, action, effect),
  FOREIGN KEY (agent_id) REFERENCES agents (agent_id)
);
