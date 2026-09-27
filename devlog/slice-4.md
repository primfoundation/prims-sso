## 2026-09-27T07:40:00Z Slice 4 — Connector vault stub

- **What changed:** D1 migration `migrations/0004_vault.sql` (`connector_vault`: opaque `ref`, `agent_id`, `connector_id`, fake `token`, timestamps, unique `(agent_id, connector_id)`). Owner-scoped `POST /v1/agents/:agent_id/vault` returns `ref` only. `GET /v1/agents/:agent_id` returns agent fields plus connector refs and omits the raw token. `POST /v1/vault/retrieve` returns the fake token for the owning passkey session. `POST /v1/agents/:agent_id/revoke` denylists that agent's live tokens and deletes its vault rows so the old ref 404s. `/health` reports `slice: 4`. `npm test` covers A4.1–A4.4. README Connector vault stub section states this is a fake-token stub with no real OAuth providers.
- **Why:** GitHub issue #7 Slice 4 acceptance A4.1–A4.4. Extend Slice 0–3 session auth and D1; do not redesign them.
- **Supporting Research:** Issue #7 §4 Slice 4. Glossary already locks connector secrets to a vault keyed by `agent_id` with refs on SSO metadata.
- **File size:** `src/index.ts` was already over the 350-line code cap (Slice 0 passkey façade). This slice only sets `slice: 4` and dispatches vault routes. Splitting the façade is out of scope. New vault modules stay under the cap. The A4.3 HTTP test stays under 50 code lines by keeping setup in helpers.

## Checklist

- [x] Migration checked in
- [x] Store fake token → ref; agent metadata omits raw token
- [x] Authorized retrieve returns the fake token
- [x] Revoke agent → old ref fails; sibling vault remains
- [x] npm test
- [x] README vault API curls; no real OAuth
- [x] health slice 4
