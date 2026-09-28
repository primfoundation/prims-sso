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
absent from deployment config. There is no new discovery document advertising an
unverified issuer. This change has not been deployed.

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

## Activation gates (must verify against the actual existing project)

1. Confirm which existing Stytch environment is intended. The deployed SSO health
   reported `test` during the Drive work. Do not silently switch projects or call
   that production identity verification.
2. Enable Connected Apps in that project and configure Authorization URL
   `https://login.prims.sh/oauth/authorize`. Configure required custom scopes
   `primsdrive.read` and `primsdrive.write` and resource/audience enforcement.
3. Obtain the actual project discovery document. Verify its issuer, S256 support,
   endpoints, resource handling, DCR/CIMD capabilities and RFC 9207 behavior.
   The canonical Prims login facade and the token's `iss` need not be identical:
   use Stytch's verified issuer for the existing project, or a supported custom
   domain. Do not fabricate `iss=https://login.prims.sh` or rewrite signed tokens.
4. Register the actual ChatGPT client/callback from the ChatGPT connection UI.
   The callback in tests is a fixture, not a claim of successful registration.
5. Add issuer-side OAuth introspection/account and agent mapping using verified
   provider subject/client claims and the existing Prims account/policy store.
   Drive's current `agt_` validator does not yet accept Stytch OAuth JWTs. Keep
   OAuth mode disabled until this is connected and revocation is proven live.
6. Test login, consent approval/denial, resource and scope enforcement, wrong PKCE,
   callback mismatch, expired/replayed codes, refresh, and revocation with Stytch.
   Then enable resource discovery at Drive and test the actual ChatGPT tools.

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

Configuration, all absent until actual provider verification:
- `CONNECTED_APPS_ENABLED=true`
- `OAUTH_ISSUER`: exact verified discovery issuer
- `OAUTH_INTROSPECTION_ENDPOINT`: verified HTTPS endpoint on the issuer origin
- `OAUTH_CLIENT_ID`, optional secret `OAUTH_CLIENT_SECRET` for confidential clients
- `OAUTH_AGENT_BINDINGS`: JSON array of `{stytch_user_id, client_id, agent_id}`
  for existing account-owned agents; missing/ambiguous/cross-account mappings deny

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
