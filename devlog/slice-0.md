## 2026-09-27 Slice 0 scaffolding

- **What changed:** Added Cloudflare Workers TypeScript façade for Stytch passkey register/login (`src/`), `wrangler.toml`, brand assets under `public/`, `.dev.vars.example`, `.gitignore`.
- **Why:** Issue #7 Slice 0 — thin Workers edge over Stytch; RP ID `prims.sh`; secrets only via Workers secrets / gitignored `.dev.vars`.
- **Supporting Research:** Stytch WebAuthn API guide (register/authenticate start+finish, `use_base64_url_encoding`, `return_passkey_credential_options`); architecture locks in #6.

## 2026-09-27 Deploy + acceptance (partial)

- **What changed:** Deployed preview Worker via `wrangler deploy --temporary` → `https://prims-sso.malleable-algebra.workers.dev`. Commit `0346650` on `main` (local, not yet pushed — no GH auth in workspace).
- **Why:** A0.1 allows documented preview URL until DNS/`login.prims.sh` cutover.
- **Evidence (no secrets):**
  - A0.1: `GET https://prims-sso.malleable-algebra.workers.dev/` → HTTP 200, `text/html`, title `Prims · Sign in`, CTA `Sign in with passkey`, meta RP ID `prims.sh`. `/register` 200. `/health` JSON `rp_id=prims.sh`, `stytch_configured=false`.
  - A0.2: **BLOCKED** — needs Stytch project secrets + origin under `*.prims.sh` (workers.dev cannot complete WebAuthn with RP ID `prims.sh`).
  - A0.3: **BLOCKED** — Stytch project not yet created/configured in this seat (no dashboard credentials). Secret **names** planned: `STYTCH_PROJECT_ID`, `STYTCH_SECRET` (optional `STYTCH_ENV`).
  - A0.4: **PASS** — `git ls-files` scan for `secret-test-` / `secret-live-` / live `STYTCH_SECRET=` values: clean. `.dev.vars` gitignored; only `.dev.vars.example` placeholders tracked.

## Checklist

- [x] Workers façade code + brand public assets
- [x] Preview deploy (`prims-sso.malleable-algebra.workers.dev`)
- [x] A0.1 PASS (preview)
- [x] A0.4 PASS
- [ ] Stytch test project: RP ID `prims.sh`, origins `https://login.prims.sh` (+ localhost for dev)
- [ ] Secrets put: `STYTCH_PROJECT_ID`, `STYTCH_SECRET`
- [ ] Deploy/attach `login.prims.sh` (CF account owning `prims.sh` zone)
- [ ] A0.2 passkey register + sign-in proof
- [ ] A0.3 report (env name, RP ID confirm, secret names)
- [ ] Comment on #7 + ping PrimsDrive; wait for `Slice 0: VERIFIED`
