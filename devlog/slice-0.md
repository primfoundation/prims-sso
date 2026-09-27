## 2026-09-27 Slice 0 scaffolding

- **What changed:** Added Cloudflare Workers TypeScript façade for Stytch passkey register/login (`src/`), `wrangler.toml`, brand assets under `public/`, `.dev.vars.example`, `.gitignore`.
- **Why:** Issue #7 Slice 0 — thin Workers edge over Stytch; RP ID `prims.sh`; secrets only via Workers secrets / gitignored `.dev.vars`.
- **Supporting Research:** Stytch WebAuthn API guide; architecture locks in #6.

## 2026-09-27 Live cutover + A0 re-run (ready for PrimsDrive re-verify)

- **What changed:** Façade live on Eidos Worker `prims-sso` / `login.prims.sh` (PrimsDrive deploy). Source on `main` (`17dc8e6` + follow-up scrub/docs). `.dev.vars.example` placeholders non-secret-shaped; secret **names** documented.
- **Why:** Close Slice 0 after stub FAIL; do **not** self-claim VERIFIED; do **not** start Slice 1.
- **Evidence (no secrets):**
  - A0.1: `GET https://login.prims.sh/` → 200 `text/html`, title `Prims · Sign in`.
  - A0.2: PARTIAL — `POST /api/passkey/register/start` → creation options `rp.id = prims.sh`; `login/start` → `rpId = prims.sh`. Origin served is `https://login.prims.sh`. Full authenticator ceremony for PrimsDrive.
  - A0.3: `/health` → `stytch_env=test`, `rp_id=prims.sh`, `stytch_configured=true`. Secret names listed (not values). Test project id (non-secret): `project-test-e9217d12-…`.
  - A0.4: tracked-file scan clean after placeholder scrub.

## Checklist

- [x] Workers façade code + brand public assets
- [x] Live `login.prims.sh` HTML passkey UI (not JSON stub)
- [x] A0.1 PASS
- [x] Stytch RP ID `prims.sh` confirmed via register/login start options
- [x] A0.3 secret names + test env via `/health`
- [x] A0.4 no secrets in git
- [x] Push to `primfoundation/prims-sso`
- [x] Comment on #7 + ping PrimsDrive re-verify
- [ ] Wait for PrimsDrive `Slice 0: VERIFIED` (do not start Slice 1)
