## 2026-10-03 ChatGPT OAuth on the existing Stytch project

- **Query:** Stytch Connected Apps OAuth token endpoint refresh revoke discovery oauth-authorization-server consumer IDP
- **Summary:** Consumer Connected Apps serves metadata at `https://{custom-domain}/.well-known/oauth-authorization-server`. Token exchange and refresh are `POST https://{custom-domain}/v1/oauth2/token` with `grant_type` of `authorization_code` or `refresh_token`. Public clients send `code_verifier` and no `client_secret`. `offline_access` is required for a refresh token. Revocation is `POST /v1/oauth2/revoke` (RFC 7009). The legacy `api.stytch.com` issuer `stytch.com/{project_id}` is not an HTTPS URL.
- **Source:** https://stytch.com/docs/connected-apps/resources/custom-domains and the Connected Apps token, refresh, and revoke API pages.

- **Query:** Stytch Connected Apps client ID metadata document CIMD dynamic client registration ChatGPT MCP
- **Summary:** CIMD is supported and must be enabled in the dashboard. The `client_id` is an HTTPS URL Stytch fetches. DCR remains `POST /v1/oauth2/register` and is also dashboard-gated. ChatGPT and Grok callbacks must be copied from those products. Do not invent redirect URIs.
- **Source:** https://stytch.com/docs/connected-apps/oauth-learn-more/client-types and https://stytch.com/docs/connected-apps/guides/mcp-auth-overview

- **Query:** Stytch authorize `resources` and access-token audience
- **Source:** `https://github.com/stytchauth/stytch-node/blob/main/lib/b2c/idp_oauth.ts` (`resources` on authorize) and the Connected App access-token object. Default `aud` is the project id. Extra audiences come from the client `access_token_custom_audience`. This Worker still requires `aud` to include `https://drive.prims.sh`.
