# PrimsDrive OAuth consent adapter

Candidate for #2, not a completed OAuth provider or production rollout.
The direct ChatGPT connection is a release goal of
https://github.com/primfoundation/primsdrive-cloud/pull/10.

`/oauth/authorize` is implemented as a server-rendered adapter to **the existing
Stytch Consumer project's Connected Apps**. It uses the existing host-only Prims
passkey session. Stytch validates the registered client and callback, evaluates
scopes, records consent, and issues codes. This Worker adds no code/token/client
database and does not mint an independent identity.

The route returns 503 unless `CONNECTED_APPS_ENABLED=true`. The flag is deliberately
absent from deployment config. `GET /.well-known/oauth-authorization-server` and
`GET /.well-known/openid-configuration` on `login.prims.sh` return 503
`issuer_not_hosted_here`. They do not publish an issuer, token endpoint, revocation
endpoint, or registration endpoint. This change has not been deployed.

## Implemented boundary

- Login and registration preserve only a valid local OAuth continuation.
- HTML requires the existing session cookie; a bearer token cannot act as a
  browser session. Provider preflight validates the live session on GET and POST.
- Only authorization-code requests with S256 PKCE, an HTTPS callback, the exact
  Drive resource `https://drive.prims.sh`, and known scopes can proceed.
- Explicit Allow/Cancel; untrusted client names and callback URLs are escaped.
- Consent forms are bound to the session and exact query using an HMAC with a
  fresh nonce, expire after ten minutes, require same-origin POST, and use a
  Secure/HttpOnly/host-only cookie cleared after submission. Code replay protection
  remains Stytch's responsibility; the adapter does not claim single-use forms
  against a client replaying all of its own cookie/session material.
- Provider validation runs again on submission; provider callbacks must match
  the original callback origin, path and original query values.
- No-store, no-referrer, no external script, frame-ancestors none, bounded bodies.

## What stays on Stytch

ChatGPT and Grok perform token, refresh, and revoke against the verified Stytch
issuer, not against this Worker. Confirmed from Stytch's MCP authorization guide
and Connected Apps API (checked 2026-10-03):

| Step | Owner | Path on the verified issuer |
|------|--------|-----------------------------|
| Protected resource metadata | Drive `drive.prims.sh` | `/.well-known/oauth-protected-resource` |
| Issuer discovery | Stytch | `/.well-known/oauth-authorization-server` and `/.well-known/openid-configuration` |
| Consent | this Worker | `https://login.prims.sh/oauth/authorize` |
| Code exchange and refresh | Stytch | `POST /v1/oauth2/token` |
| Revocation | Stytch | `POST /v1/oauth2/revoke` |
| Client registration | Stytch, dashboard-gated | `POST /v1/oauth2/register` (DCR) or CIMD fetch |
| Online introspection | Stytch, then this Worker maps identity | `POST /v1/oauth2/introspect` |

`grant_type` is `authorization_code` or `refresh_token`. Public clients send
`code_verifier` and omit `client_secret`. `offline_access` is what makes Stytch
return a refresh token. Revoking a refresh token also revokes the access token
issued with it. The legacy issuer `stytch.com/{project_id}` is not an HTTPS URL;
ChatGPT will reject it. Use the HTTPS issuer from the custom-domain metadata.

## Daniel activation checklist

Do these in order. Leave every enable flag unset until the matching check passes.
Deployed `GET https://login.prims.sh/health` still reports Stytch `test`. That is
not production identity. Do not point `drive.prims.sh` or `login.prims.sh` at
Stytch. Do not create accounts for this checklist. Do not assign Sandisk profiles
to the existing fixture identities.

1. In the **existing** Stytch project, enable Connected Apps. Set Authorization URL
   to exactly `https://login.prims.sh/oauth/authorize`. Add scopes `primsdrive.read`,
   `primsdrive.write`, and `offline_access`.
2. Give that project an HTTPS custom domain (`*.customers.stytch.com`, or a CNAME
   Daniel controls that is neither `login.prims.sh` nor `drive.prims.sh`). Fetch
   `GET https://{that-domain}/.well-known/oauth-authorization-server` and copy:
   - `issuer` → later `OAUTH_ISSUER` and Drive `MCP_OAUTH_ISSUER`
   - `authorization_endpoint` must equal `https://login.prims.sh/oauth/authorize`
   - `token_endpoint` (code exchange and refresh)
   - `revocation_endpoint`
   - introspection URL on that same origin (`/v1/oauth2/introspect` unless the document names another)
   - `code_challenge_methods_supported` includes `S256`
   - `grant_types_supported` includes `authorization_code` and `refresh_token`
   - `response_types_supported` includes `code`
3. Prefer CIMD. Enable it in Connected Apps. From the ChatGPT connection screen
   for `https://drive.prims.sh/mcp`, copy the actual client metadata URL and
   redirect URI. Repeat for Grok from Grok's own connection screen. Do not invent
   callback paths or wildcard redirects. Enable DCR only if a client cannot
   present a metadata URL. Confirm each client's `access_token_custom_audience`
   includes `https://drive.prims.sh`. Stytch's default `aud` is the project id,
   and this Worker rejects project-only audiences.
4. Sign in at `https://login.prims.sh` with the real passkey. `POST /v1/accounts`,
   then create one agent for ChatGPT and one for Grok under that account. Put only
   those existing rows in `OAUTH_AGENT_BINDINGS`:
   `[{stytch_user_id, client_id, agent_id}, …]`. The live D1 inventory from
   2026-09-28 was six test accounts and six test agents. Do not bind those
   fixtures, and do not attach Sandisk profiles to them.
5. Set Worker config only after steps 1–4 match the live metadata. All of these
   are absent from `wrangler.toml` on purpose:
   - `CONNECTED_APPS_ENABLED=true`
   - `OAUTH_ISSUER` = the copied `issuer`
   - `OAUTH_INTROSPECTION_ENDPOINT` = the copied introspection URL (same origin)
   - `OAUTH_AGENT_BINDINGS` = the JSON from step 4
   - `OAUTH_CLIENT_ID` only to pin one client. Omit it so ChatGPT and Grok both
     match bindings. `OAUTH_CLIENT_SECRET` / `OAUTH_CLIENT_SECRETS` only for
     confidential clients. CIMD clients are public and get no secret.
6. On Drive, still in the undeployed candidate, set `MCP_OAUTH_ISSUER` to that
   same issuer and only then `MCP_OAUTH_ENABLED=true`. Until both are set,
   `/.well-known/oauth-protected-resource` stays 503. The resource value is
   exactly `https://drive.prims.sh`. Drive `DRIVE_ACCOUNT_PROFILES` may name the
   real `account_id` only after step 4.
7. Exercise consent approval and denial, wrong PKCE, callback mismatch, expired
   and replayed codes, refresh, and revocation against Stytch before calling the
   connection live. After revoke, the next Drive tool call must fail. Relink is
   a new consent. `/health` then shows `connected_apps_enabled`,
   `oauth_issuer_configured`, and `oauth_introspection_configured`. Those three
   stay false in this change.

SSO #2 also includes OIDC for Cloudflare Access: this adapter alone does not
complete its ID-token/userinfo acceptance or SSO #3's Access application setup.

## Validation and primary API source

`npm test` includes consent boundary tests with a fake provider. Those tests prove
the adapter's checks, not a live Stytch round-trip. `npm run typecheck` and Wrangler
dry-run verify Worker compilation. Provider payloads follow the official SDK:
https://github.com/stytchauth/stytch-node/blob/main/lib/b2c/idp_oauth.ts
(`oauth.authorizeStart`, `oauth.authorize`, including `resources` and PKCE).

Official integration example (issuer discovery is project-dependent):
https://github.com/stytchauth/mcp-examples/tree/main/consumer-integrated

## OAuth token adapter (2026-09-28 candidate)

`POST /v1/oauth/introspect` validates online with Stytch on every request, then
looks up the provider subject in existing Prims accounts and the assigned agent
in the existing agent store. It does not mint tokens or provision identities.

Configuration, all absent until the checklist above is verified:
- `CONNECTED_APPS_ENABLED=true`
- `OAUTH_ISSUER`: exact `issuer` from the Stytch discovery document
- `OAUTH_INTROSPECTION_ENDPOINT`: verified HTTPS introspection URL on that origin
- `OAUTH_AGENT_BINDINGS`: JSON array of `{stytch_user_id, client_id, agent_id}`
  for existing account-owned agents. One row per client, so ChatGPT and Grok can
  both map without a second user store. Missing, ambiguous, or cross-account
  rows deny. The access token's unverified `client_id` only selects which
  Connected App is presented to Stytch; the provider response must echo it.
- `OAUTH_CLIENT_ID`: optional pin to a single client. Omit it when more than one
  binding client must work.
- `OAUTH_CLIENT_SECRET`: secret for that pinned confidential client only
- `OAUTH_CLIENT_SECRETS`: optional JSON object of `client_id` to secret. A
  secret is sent only for the client id inside the presented token.

Accept only provider `active=true`, matching issuer/client, `access_token`, valid
expiry/not-before, exact Drive audience and Drive scopes. Refresh/session/ID
tokens and project-only audiences do not qualify. Provider failures return 503;
inactive credentials return 401. Responses are no-store; no token caching.
Drive still performs live profile-policy checks after this authentication.

The live D1 inventory contains earlier test accounts only; no real Daniel account
assignment is available. Do not attach production profiles to those fixtures.
Live Stytch/ChatGPT consent, refresh, revocation, and installation remain gates.

Research: official Stytch SDK `lib/b2c/idp.ts` network introspection and
https://stytch.com/docs/api-reference/consumer/api/connected-apps/methods/introspect-token
were checked. The requested research-first/check-governance skillflow tools are
not exposed in this session; no successful run is claimed. No production
activation or schema change is included in this candidate.
