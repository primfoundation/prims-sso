## 2026-09-27 Slice 1 — Prims account model (D1)

- **What changed:** D1 migration `0001_accounts.sql`; `AccountStore`; authenticated `/v1/accounts` CRUD; upsert on passkey finish; test-env `POST /v1/_ops/slice1-prove`; README Account API.
- **Why:** Issue #7 Slice 1 — persist Prims accounts with default `role=member`, Stytch session gate for mutating ops. D1 chosen for SQL migrations + simple CRUD (vs DO).
- **Supporting Research:** #7 §4 Slice 1 acceptance A1.1–A1.4.

## Checklist

- [x] D1 schema + migration in repo
- [x] POST/GET/PATCH Account API + session auth (cookie or Bearer)
- [x] README Account API + curl examples
- [ ] Create remote D1 + apply migrations + deploy to Eidos Worker
- [ ] A1.1–A1.3 green (via slice1-prove or curl)
- [ ] Comment on #7 + ping PrimsDrive (do not claim VERIFIED; do not start Slice 2)
