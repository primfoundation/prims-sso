## 2026-09-27 Slice 3 — RBAC allow/deny stub

- **What changed:** D1 migration `migrations/0003_rbac.sql` (`agent_policies`: `agent_id`, `resource`, `action` read|write, `effect` allow|deny, timestamps, primary key so both effects can coexist). Owner-scoped `POST /v1/agents/:agent_id/policy`. Check at `POST /v1/policy/check` → `{ allow }`. Precedence: matching deny overrides matching allow; no matching allow is deny. `/health` reports `slice: 3`. `npm test` covers A3.1–A3.4. README Policy / RBAC stub section states this is not OpenFGA and is replaceable per #6 §6.
- **Why:** GitHub issue #7 Slice 3 acceptance A3.1–A3.4. Extend Slice 0–2 session auth and D1; do not redesign them.
- **Supporting Research:** Issue #7 §4 Slice 3. Issue #6 §6 (authz is a separate OpenFGA/Authzed-class store; this D1 table is the temporary stub behind `POST /v1/policy/check`).

## Checklist

- [x] Migration checked in
- [x] Grant read on resource:demo → check allow
- [x] Same agent write with no grant → deny
- [x] Other agent with no rows → deny
- [x] Deny overrides allow
- [x] npm test
- [x] README Policy / RBAC stub + curl
- [x] health slice 3
