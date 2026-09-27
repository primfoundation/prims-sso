## 2026-09-27 JSON response helper

- **What changed:** `agents_api.ts` has its own small `json()` helper, same shape as `accounts_api.ts` and `src/index.ts`.
- **Why:** Slice 2 should not refactor Slice 0/1 modules to share a helper. The three copies are each a few lines and keep the account handlers untouched.
- **Supporting Research:** None.
