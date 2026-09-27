## 2026-09-27 JSON response helper

- **What changed:** `agents_api.ts` has its own small `json()` helper, same shape as `accounts_api.ts` and `src/index.ts`.
- **Why:** Slice 2 should not refactor Slice 0/1 modules to share a helper. The three copies are each a few lines and keep the account handlers untouched.
- **Supporting Research:** None.

## 2026-09-27 Vault route helpers

- **What changed:** `vault_api.ts` copies the small `json()`, `readBody()`, and `requireOwner()` helpers from `policy_api.ts`. `tests/vault.test.ts` copies the in-memory D1 `openDb` shape and adds `all()` for ref lists.
- **Why:** Slice 4 must not refactor Slice 2/3 modules or their test harnesses to share those helpers. Each copy is short and leaves token and policy behavior untouched.
- **Supporting Research:** None.

## 2026-09-27 Policy route helpers

- **What changed:** `policy_api.ts` copies the small `json()`, `readBody()`, and `requireOwner()` helpers from `agents_api.ts`.
- **Why:** Slice 3 must not refactor the Slice 2 agent module to share those helpers. Each copy is short and leaves token issue/revoke behavior untouched.
- **Supporting Research:** None.
