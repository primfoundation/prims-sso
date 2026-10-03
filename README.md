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

Sub-identities under a Prims account, plus short-lived opaque tokens. `GET /health` reports `d1_bound` and `stytch_configured`. The current slice number is in the Connector vault section below.

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

`npm test` runs, with no Wrangler and no secrets:

- Slice 1 account schema check
- Slice 2 token suite: issue → introspect active → revoke → introspect inactive, plus a sibling agent token that stays valid (A2.5)
- Slice 3 policy suite (`tests/policy.test.ts`, A3.1–A3.4): grant read → allow; write with no grant → deny; other agent with no rows → deny; matching deny overrides allow
- Slice 4 vault suite (`tests/vault.test.ts`, A4.1–A4.4): store fake token → ref; agent metadata omits the raw token; authorized retrieve returns it; revoke agent makes the old ref fail

Apply checked-in migrations (including `migrations/0004_vault.sql`) on the existing D1 database (`prims-sso-accounts`) before deploying the Worker:

```bash
npx wrangler d1 migrations apply prims-sso-accounts --remote
```

## Policy / RBAC stub (Slice 3)

Minimal per-agent allow/deny rows. **This is a stub, not OpenFGA.** Issue [#6 §6](https://github.com/primfoundation/prims-sso/issues/6) keeps authorization in an OpenFGA / Authzed-class store, separate from SSO authn. `POST /v1/policy/check` is the seam: replace `PolicyStore` later without changing that HTTP shape. `GET /health` reports the current slice in the Connector vault section (`"slice": 4`).

| Item | Value |
|------|--------|
| Schema | `migrations/0003_rbac.sql` — `agent_policies` (`agent_id`, `resource`, `action`, `effect`, `created_at`, `updated_at`) |
| Actions | `read` or `write` only |
| Effects | `allow` or `deny` |
| Primary key | `(agent_id, resource, action, effect)` — both effects may exist for one tuple |
| Match | Exact `resource` string. No wildcards, inheritance, or usersets |
| Grant auth | Passkey session (cookie `prims_session` or `Authorization: Bearer <stytch_session_token>`). Caller must own the agent's account |
| Check auth | None on this stub. Callers are trusted until the OpenFGA replacement. A missing agent is deny, not 404 |

**Precedence** for `POST /v1/policy/check`:

1. A row with the same `agent_id`, `resource`, and `action` and `effect=deny` → `{ "allow": false }`.
2. Otherwise a matching `effect=allow` → `{ "allow": true }`.
3. Otherwise **default deny** → `{ "allow": false }`.

```bash
# Grant read on resource:demo. effect defaults to allow when omitted.
curl -sS -X POST "https://login.prims.sh/v1/agents/$AGENT_ID/policy" \
  -H 'content-type: application/json' \
  -H "cookie: prims_session=$PRIM_SESSION" \
  -d '{"resource":"resource:demo","action":"read","effect":"allow"}'

# Optional explicit deny (overrides an allow on the same agent, resource, and action)
curl -sS -X POST "https://login.prims.sh/v1/agents/$AGENT_ID/policy" \
  -H 'content-type: application/json' \
  -H "cookie: prims_session=$PRIM_SESSION" \
  -d '{"resource":"resource:demo","action":"read","effect":"deny"}'

# Check — 200 {"allow":true} or {"allow":false}. No session.
curl -sS -X POST https://login.prims.sh/v1/policy/check \
  -H 'content-type: application/json' \
  -d "{\"agent_id\":\"$AGENT_ID\",\"resource\":\"resource:demo\",\"action\":\"read\"}"
```

Grant response is the row (`agent_id`, `resource`, `action`, `effect`, timestamps), HTTP 201. Unauthenticated grant is 401. Another account's agent is 403.

## Connector vault stub (Slice 4)

Stub only: a caller-supplied **fake** connector token. No real OAuth providers (no Gmail, Drive, or any other provider token exchange). `GET /health` reports `"slice": 4`.

The raw token is stored in D1 table `connector_vault`, keyed by `agent_id` + `connector_id`. Account responses and `GET /v1/agents/:agent_id` return an opaque `ref` only. The fake token comes back from `POST /v1/vault/retrieve`, and only for the passkey session that owns the agent.

| Item | Value |
|------|--------|
| Schema | `migrations/0004_vault.sql` — `connector_vault` (`ref`, `agent_id`, `connector_id`, `token`, timestamps), unique `(agent_id, connector_id)` |
| Store | `POST /v1/agents/:agent_id/vault` with `{ "connector_id", "token" }` → `{ ref, agent_id, connector_id }` (HTTP 201). The body does not include `token` |
| Metadata | `GET /v1/agents/:agent_id` → agent fields plus `connectors: [{ ref, connector_id }]`. No raw token |
| Retrieve | `POST /v1/vault/retrieve` with `{ "ref" }` → `{ ref, agent_id, connector_id, token }` |
| Auth | Same passkey session as the Account API: cookie `prims_session` or `Authorization: Bearer <stytch_session_token>`. Caller must own the agent's account. No session → 401. Another account's ref → 404 |
| Replace | Storing the same `connector_id` again updates the fake token and keeps the same `ref` |
| Revoke agent | `POST /v1/agents/:agent_id/revoke` denylists that agent's live tokens and **deletes** its vault rows. Retrieve by the old `ref` then fails. A sibling agent's vault ref and token stay valid |

```bash
# Store a fake token — response includes ref and does not include the token
curl -sS -X POST "https://login.prims.sh/v1/agents/$AGENT_ID/vault" \
  -H 'content-type: application/json' \
  -H "cookie: prims_session=$PRIM_SESSION" \
  -d '{"connector_id":"fake:demo","token":"fake-connector-token"}'

# Agent metadata — connectors list refs only
curl -sS "https://login.prims.sh/v1/agents/$AGENT_ID" \
  -H "cookie: prims_session=$PRIM_SESSION"

# Authorized retrieve — returns the fake token
curl -sS -X POST https://login.prims.sh/v1/vault/retrieve \
  -H 'content-type: application/json' \
  -H "cookie: prims_session=$PRIM_SESSION" \
  -d "{\"ref\":\"$VAULT_REF\"}"

# Revoke the agent — vault rows for that agent_id are deleted
curl -sS -X POST "https://login.prims.sh/v1/agents/$AGENT_ID/revoke" \
  -H "cookie: prims_session=$PRIM_SESSION"

# Old ref — 404
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://login.prims.sh/v1/vault/retrieve \
  -H 'content-type: application/json' \
  -H "cookie: prims_session=$PRIM_SESSION" \
  -d "{\"ref\":\"$VAULT_REF\"}"
```

`connector_id` is a label (`fake:demo`), 1–128 characters (`A-Za-z0-9._:-`). `token` is an opaque fake string, 1–4096 characters. Unauthenticated store, metadata, retrieve, and revoke are 401.

## Connected Apps consent (gated, not enabled)

ChatGPT and Grok reach PrimsDrive through the **existing** Stytch Connected Apps
project. This Worker renders consent at `GET /oauth/authorize` and maps provider
access tokens at `POST /v1/oauth/introspect`. Stytch hosts issuer discovery,
`/v1/oauth2/token` (code and refresh), `/v1/oauth2/revoke`, and client registration.
`login.prims.sh` returns 503 for `/.well-known/oauth-authorization-server` and
`/.well-known/openid-configuration` so it is not a second issuer.

`CONNECTED_APPS_ENABLED` is unset. `/health` reports `connected_apps_enabled`,
`oauth_issuer_configured`, and `oauth_introspection_configured` as false until
the checklist in [docs/CONNECTED-APPS.md](./docs/CONNECTED-APPS.md) is done.
Do not bind fixture accounts or assign Sandisk profiles from this service.

