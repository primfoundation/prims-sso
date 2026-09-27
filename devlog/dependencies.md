## 2026-09-27 Dependency decision — Slice 2 tests

- **What changed:** No new packages. `npm test` uses Node's built-in `node:test` and `node:sqlite` plus `--experimental-transform-types`.
- **Why:** Vitest would also work and has well over 1,000 GitHub stars, but the repo already tests the account schema with `node:sqlite` and the token suite only needs an in-memory D1 stand-in. Adding a test runner is unnecessary.
- **Supporting Research:** Node.js 22 type-stripping / transform-types docs (parameter properties in existing `AccountStore` require transform, not strip-only).
