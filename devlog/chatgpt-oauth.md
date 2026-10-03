## 2026-10-03T21:00:00Z Investigation

- **What changed:** Compared `main` with draft PR #11 (`connected-apps-consent`) and issue #2 against the ChatGPT OAuth contract in primsdrive-cloud `docs/CHATGPT-CONNECTION.md` (`project-completion`).
- **Why:** ChatGPT needs authorization code + S256 PKCE, protected-resource metadata, issuer discovery, a copied callback, resource-bound scopes, refresh, and revocation. Drive already calls `POST /v1/oauth/introspect` and expects `active`, `agent_id`, `account_id`, `resource`, and `scope`.
- **Supporting Research:** See `devlog/research.md`. Main has passkeys, accounts, `agt_` tokens, policy, and a vault stub. It has no authorize, consent, token, refresh, revoke, or OAuth introspection. PR #11 adds gated `/oauth/authorize` and single-client `/v1/oauth/introspect`, disabled by default, with no token database. Stytch's MCP guide hosts discovery, token, refresh, revoke, and registration on the project custom domain. `login.prims.sh` must stay the consent façade. Default Stytch `aud` is the project id; Drive's resource is `https://drive.prims.sh`.

## 2026-10-03T21:20:00Z Implementation

- **What changed:** On top of the PR #11 adapter, introspection selects the Connected App client from the access token and the operator binding list, so ChatGPT and Grok can map to existing agents. Issuer-discovery paths on the façade return 503 without metadata. `/health` reports three OAuth booleans that stay false. No Wrangler flags, no schema, no deploy.
- **Why:** A second token endpoint on `login.prims.sh` would advertise an issuer Stytch does not sign. The remaining code gap for two public clients was the single `OAUTH_CLIENT_ID` pin.
- **Supporting Research:** Stytch Connected Apps token, refresh, revoke, and introspection docs; Stytch MCP authorization overview; `stytch-node` `lib/b2c/idp.ts` and `idp_oauth.ts`.
- **File size:** `src/index.ts` remains over the 350-line code cap from the Slice 0 façade. This change adds the discovery route and three health fields. New modules stay under the cap. `providerDecision` and `introspectOAuth` stay under 50 code lines. `authorizePage` was already 61 code lines in the consent adapter; this change does not expand it.

## Checklist

- [x] Gap recorded against main, PR #11, and issue #2
- [x] No second issuer, token database, or production flag
- [x] ChatGPT and Grok bindings tested
- [x] Discovery refusal tested
- [x] Daniel checklist written in `docs/CONNECTED-APPS.md` and the PR body
