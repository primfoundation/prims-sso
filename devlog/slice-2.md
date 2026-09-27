## 2026-09-27 Slice 2 — Agent sub-identity + tokens + revoke

- **What changed:** D1 migration `migrations/0002_agents.sql` (`agents`, `agent_tokens` with SHA-256 `token_hash` and `revoked_at` denylist). Owner-scoped `POST /v1/accounts/:account_id/agents`, `POST /v1/agents/:agent_id/tokens`, `POST /v1/agent-tokens/revoke`. Token introspect at `POST /v1/agent-tokens/introspect`. `/health` reports `slice: 2`. `npm test` covers issue → verify → revoke → verify fail and a sibling agent token (A2.5). README Agent API curl examples. Default TTL 3600s, max 3600s.
- **Why:** GitHub issue #7 Slice 2 acceptance A2.1–A2.5. Extend Slice 0/1 session auth and D1; do not redesign them.
- **Supporting Research:** Issue #7 §4 Slice 2. Cloudflare D1 foreign keys are enforced (https://developers.cloudflare.com/d1/sql-api/foreign-keys/). Node 22 `--experimental-transform-types` runs the TypeScript tests without a new dependency.

## Checklist

- [x] Migration checked in
- [x] Create agent returns agent_id
- [x] Issue token; introspect returns active + agent_id
- [x] Revoke denylist; introspect fails immediately
- [x] Sibling agent token still valid
- [x] npm test
- [x] README Agent API + TTL
- [x] health slice 2
