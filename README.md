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
| Secrets (Workers only) | `STYTCH_PROJECT_ID`, `STYTCH_SECRET`, `STYTCH_PUBLIC_TOKEN`, `STYTCH_API_HOST`, `STYTCH_PROJECT_DOMAIN`, `STYTCH_ENV_SLUG` |
| Non-secret vars | `RP_ID=prims.sh`, `SESSION_COOKIE`, `SESSION_DURATION_MINUTES` |
| Cloudflare | Eidos AGI account · Worker `prims-sso` · custom domain `login.prims.sh` |

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
| **Agent tokens** (short-lived, scoped under a human account) | **Issued by prims-sso** (Slice 2 Agent API); **held by Cloudflare** for `drive.prims.sh` per [primsdrive-cloud](https://github.com/primfoundation/primsdrive-cloud); mini never sees raw secrets |

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


## Account API (Slice 1)

Primary store: **D1** (`prims-sso-accounts`), table `accounts`.
Why D1: checked-in SQL migrations + simple CRUD by `account_id` / email.

Auth: passkey session cookie `prims_session`, or `Authorization: Bearer <stytch_session_token>`.

```bash
# Upsert (create-on-first-login) — returns account_id + role=member
curl -sS -X POST https://login.prims.sh/v1/accounts \
  -H 'content-type: application/json' \
  -H "cookie: prims_session=$PRIM_SESSION" \
  -d '{}'

# Get own account
curl -sS https://login.prims.sh/v1/accounts/$ACCOUNT_ID \
  -H "cookie: prims_session=$PRIM_SESSION"

# Unauthenticated → 401
curl -sS -o /dev/null -w '%{http_code}\n' https://login.prims.sh/v1/accounts/$ACCOUNT_ID

# Optional Apple stub (not primary auth)
curl -sS -X PATCH https://login.prims.sh/v1/accounts/$ACCOUNT_ID \
  -H 'content-type: application/json' \
  -H "cookie: prims_session=$PRIM_SESSION" \
  -d '{"linked_apple":"apple-user-stub"}'
```

Schema: `migrations/0001_accounts.sql` (`account_id`, `email`, `stytch_user_id`, `linked_apple`, `role` default `member`, timestamps).

## Agent API (Slice 2)

Sub-identities under a Prims account, plus short-lived opaque tokens. `GET /health` reports `"slice": 2` (and still reports `d1_bound` / `stytch_configured`).

| Item | Value |
|------|--------|
| Schema | `migrations/0002_agents.sql` — `agents` (`agent_id`, `account_id`, `display_name`, timestamps) and `agent_tokens` (`token_id`, `token_hash`, `agent_id`, `account_id`, `expires_at`, `revoked_at`, `created_at`) |
| Token TTL | Default **3600 seconds** (1 hour). Minimum **1**. Maximum **3600** (≤ 1h). |
| Storage | SHA-256 hex in `token_hash`. The raw token is returned **once** at issue and is not stored. |
| Revoke | Sets `revoked_at` (denylist). The next introspect fails immediately (no cache; ≤ 5s SLA). |
| Session auth | Create, issue, and revoke use the same passkey session as the Account API: cookie `prims_session` or `Authorization: Bearer <stytch_session_token>`. The caller must own the account. |
| Introspect auth | The agent token itself is the credential (`{"token":"..."}`). A human session is not required. |

Create the Prims account (`POST /v1/accounts`) before creating agents. Revoking one token does not revoke a sibling agent's token.

```bash
# Create agent — response includes agent_id, display_name, account_id
curl -sS -X POST "https://login.prims.sh/v1/accounts/$ACCOUNT_ID/agents" \
  -H 'content-type: application/json' \
  -H "cookie: prims_session=$PRIM_SESSION" \
  -d '{"display_name":"Drive reader"}'

# Issue token (omit ttl_seconds to use the 3600s default)
curl -sS -X POST "https://login.prims.sh/v1/agents/$AGENT_ID/tokens" \
  -H 'content-type: application/json' \
  -H "cookie: prims_session=$PRIM_SESSION" \
  -d '{"ttl_seconds":3600}'

# Introspect — 200 {"active":true,"agent_id":"..."} or 401 {"active":false}
curl -sS -X POST https://login.prims.sh/v1/agent-tokens/introspect \
  -H 'content-type: application/json' \
  -d "{\"token\":\"$AGENT_TOKEN\"}"

# Revoke by token_id (or pass {"token":"<raw token>"} instead)
curl -sS -X POST https://login.prims.sh/v1/agent-tokens/revoke \
  -H 'content-type: application/json' \
  -H "cookie: prims_session=$PRIM_SESSION" \
  -d "{\"token_id\":\"$TOKEN_ID\"}"
```

Issue response fields: `token` (once), `token_id`, `agent_id`, `account_id`, `expires_at`, `ttl_seconds`.

### Tests

```bash
npm test
```

`npm test` runs the Slice 1 account schema check and the Slice 2 token suite (in-memory SQLite, no Wrangler): issue → introspect active → revoke → introspect inactive, plus a sibling agent token that stays valid after the other revoke (A2.5).

Apply the new migration on the existing D1 database (`prims-sso-accounts`) before deploying the Worker:

```bash
npx wrangler d1 migrations apply prims-sso-accounts --remote
```

