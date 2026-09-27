# prims-sso

**Prims SSO** — the Prims account **identity provider** for humans (and issuer of agent tokens).

This service is the **sole** human IdP for the foundation (`login.prims.sh`): passkeys-first so people sign into [drive.prims.sh](https://drive.prims.sh), Prims Browsers, and other Prims surfaces with one **Prims account**.

**Glossary:** [GLOSSARY.md](./GLOSSARY.md) · **Architecture (canonical):** [#6](https://github.com/primfoundation/prims-sso/issues/6) · **Build plan:** [#7](https://github.com/primfoundation/prims-sso/issues/7)

## Architecture lock

| Layer | Role |
|-------|------|
| **`login.prims.sh` (Cloudflare Workers)** | Thin edge façade — branding, consumer sessions, rate limits, UX. |
| **Stytch** | Passkey / WebAuthn core, account APIs, M2M clients for agents. |
| **Prims abstraction** | `agent_id`, scopes, RBAC, connectors — owned here so the passkey core is **swappable**. |
| **Authz store** | OpenFGA / Authzed-class policy (separate from SSO authn). |
| **Connector vault** | Refresh tokens keyed by `agent_id`; SSO stores refs only. |

**Not** Authentik. **Not** stock Cloudflare Access as the account store. **Not** a fully custom WebAuthn implementation. **RP ID = `prims.sh`**. Apple Sign-In is optional link/recovery ([#5](https://github.com/primfoundation/prims-sso/issues/5)), not the primary door.

## Slice 0 status — passkey door

Workers façade for Stytch-backed passkey **registration** and **sign-in**.

| Item | Value |
|------|--------|
| RP ID | `prims.sh` (locked) |
| Login origin | `https://login.prims.sh` |
| Secrets (Workers only) | `STYTCH_PROJECT_ID`, `STYTCH_SECRET` (optional `STYTCH_ENV=test\|live`) |
| Non-secret vars | `RP_ID`, `SESSION_COOKIE`, `SESSION_DURATION_MINUTES` |

### Local development

```bash
cp .dev.vars.example .dev.vars   # fill Stytch test project values — never commit
npm install
npm run dev                      # http://127.0.0.1:8787
```

Stytch dashboard (test project): set WebAuthn domain / RP ID to **`prims.sh`**, and allow origins `https://login.prims.sh` and `http://localhost:8787` (or `http://127.0.0.1:8787`) for local UX. Attestation: **none** (consumer default per #6).

### Deploy

```bash
# Preview (temporary Cloudflare account — UI only; WebAuthn RP ID prims.sh needs *.prims.sh origin)
npm run deploy:preview

# Production (account that owns zone prims.sh)
npx wrangler secret put STYTCH_PROJECT_ID
npx wrangler secret put STYTCH_SECRET
npx wrangler deploy
# Attach custom domain login.prims.sh to this Worker in the CF dashboard (or routes in wrangler.toml).
```

### Routes (Slice 0)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/`, `/login` | Passkey sign-in UI |
| GET | `/register` | Passkey registration UI |
| GET | `/session` | Signed-in page (requires `prims_session` cookie) |
| GET | `/health` | Config probe (no secret values) |
| POST | `/api/passkey/register/start` | Stytch WebAuthn register start |
| POST | `/api/passkey/register/finish` | Stytch WebAuthn register + session cookie |
| POST | `/api/passkey/login/start` | Stytch WebAuthn authenticate start |
| POST | `/api/passkey/login/finish` | Stytch WebAuthn authenticate + session cookie |
| POST | `/api/logout` | Revoke Stytch session + clear cookie |

## What this is

| Concern | Owner |
|---------|--------|
| **Human identity** (Prims account, web session on `login.prims.sh`) | **This repo** (`prims-sso`) + Stytch |
| **Agent tokens** (short-lived, scoped under a human account) | **Issued by prims-sso** (Slice 2+); **held by Cloudflare** for `drive.prims.sh` per [primsdrive-cloud](https://github.com/primfoundation/primsdrive-cloud); mini never sees raw secrets |

Human SSO sessions never authorize `/v1` or `/mcp`. Agent bearers never authorize the HTML app.

## Consumers

- **drive.prims.sh** human web login — [primsdrive-cloud#6](https://github.com/primfoundation/primsdrive-cloud/issues/6)
- **browsers.prims.sh** — session via this IdP
- Future Prims web surfaces that need the same account

## Related

- Cloud edge / packs: [primfoundation/primsdrive-cloud](https://github.com/primfoundation/primsdrive-cloud)
- Mac File Provider app: [primfoundation/primsdrive](https://github.com/primfoundation/primsdrive)
- Product / registry: registry.prims.sh

## Workstreams

1. [#6 Architecture: passkeys + Stytch IdP core](https://github.com/primfoundation/prims-sso/issues/6) (canonical; #1 superseded)
2. [#7 Paseo workspace: prims-sso v1](https://github.com/primfoundation/prims-sso/issues/7) — ordered slices 0–4
3. [#2 OIDC/OAuth provider endpoint](https://github.com/primfoundation/prims-sso/issues/2)
4. [#3 drive.prims.sh integration](https://github.com/primfoundation/prims-sso/issues/3)
5. [#4 Agent vs human identity separation](https://github.com/primfoundation/prims-sso/issues/4)
6. [#5 Apple Sign-In optional under passkeys-first](https://github.com/primfoundation/prims-sso/issues/5)

## Brand assets

Login-surface brand (folio, favicon, Instrument Sans, kit.css) lives in [`brand/`](./brand/) and is served from [`public/`](./public/) by the Worker.
