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

## Slice 1 — Prims account model (D1)

**Primary store: Cloudflare D1** (`DB` binding, database `prims-sso-accounts`).

**Why D1 (not Durable Object):** Slice 1 needs a relational row per human (`account_id`, email, role, timestamps) plus a checked-in SQL migration (A1.4). D1 gives simple CRUD and unique indexes on email / `stytch_user_id`. Durable Objects are reserved for later coordination-heavy state (agent fan-out, etc.).

Schema: [`migrations/0001_accounts.sql`](./migrations/0001_accounts.sql).

Passkey register/login finish also **upserts** a Prims account on first success (same default `role=member`).

### Auth for Account API

Mutating and read account routes require a **Slice 0 Stytch session**:

| Mechanism | How |
|-----------|-----|
| Cookie | `Cookie: prims_session=<stytch_session_token>` (set by passkey login/register) |
| Header | `Authorization: Bearer <stytch_session_token>` |

Unauthenticated requests receive **401**. Callers may only read/patch **their own** `account_id` (403 otherwise). `linked_apple` is an optional stub string and is **not** primary auth.

### Account API

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/v1/accounts` | Create or upsert-on-first-login for the session user → `account_id`, `role=member` |
| GET | `/v1/accounts/:account_id` | Return email + role (+ linked_apple, timestamps) |
| PATCH | `/v1/accounts/:account_id` | Set `linked_apple` to a string or `null` |

#### curl examples

```bash
# After passkey sign-in, session cookie is set. Or use Bearer:
export SESSION='<stytch_session_token>'   # never commit
export BASE='https://login.prims.sh'

# A1.1 — upsert / create
curl -sS -X POST "$BASE/v1/accounts" \
  -H "Authorization: Bearer $SESSION" \
  -H 'content-type: application/json' \
  -d '{}'
# → {"account_id":"acc_…","email":"…","linked_apple":null,"role":"member",...,"created":true}

# A1.2 — authenticated GET
curl -sS "$BASE/v1/accounts/$ACCOUNT_ID" \
  -H "Authorization: Bearer $SESSION"
# Unauthenticated → 401
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/v1/accounts/$ACCOUNT_ID"

# A1.3 — linked_apple stub
curl -sS -X PATCH "$BASE/v1/accounts/$ACCOUNT_ID" \
  -H "Authorization: Bearer $SESSION" \
  -H 'content-type: application/json' \
  -d '{"linked_apple":"apple_stub_sub"}'
curl -sS -X PATCH "$BASE/v1/accounts/$ACCOUNT_ID" \
  -H "Authorization: Bearer $SESSION" \
  -H 'content-type: application/json' \
  -d '{"linked_apple":null}'
```

### D1 migrate / deploy

```bash
npx wrangler d1 create prims-sso-accounts   # once; paste database_id into wrangler.toml
npx wrangler d1 migrations apply prims-sso-accounts --remote
npx wrangler deploy
```

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
