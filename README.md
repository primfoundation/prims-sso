# prims-sso

**Prims SSO** — the Prims account **identity provider** for humans.

This service is the IdP that web login depends on: OIDC/OAuth so people can sign into [drive.prims.sh](https://drive.prims.sh) and other Prims surfaces with a **Prims account**.

## What this is

| Concern | Owner |
|---------|--------|
| **Human identity** (email, Prims account, web session) | **This repo** (`prims-sso`) |
| **Agent / API identity** (per-agent bearer keys) | Cloudflare, per [primsdrive-cloud](https://github.com/primfoundation/primsdrive-cloud) auth spec — **not** this IdP |

Agent API keys and human Prims accounts must stay separate. A browser session from Prims SSO never authorizes `/v1` or `/mcp`; agent bearers never authorize the HTML app.

## Consumers

- **drive.prims.sh** human web login — [primsdrive-cloud#6](https://github.com/primfoundation/primsdrive-cloud/issues/6)
- Future Prims web surfaces that need the same account

Prefer Cloudflare Access + this IdP (or equivalent OIDC) for the HTML gate.

## Related

- Cloud edge / packs: [primfoundation/primsdrive-cloud](https://github.com/primfoundation/primsdrive-cloud)
- Mac File Provider app: [primfoundation/primsdrive](https://github.com/primfoundation/primsdrive)
- Product / registry: registry.prims.sh (coordinate with Prims product)

## Workstreams

Tracked as GitHub Issues (cross-linked):

1. Prims account model
2. OIDC/OAuth provider endpoint for web login
3. drive.prims.sh integration (Cloudflare Access + this IdP)
4. Agent identity vs human identity separation

## Status

**Plan / issues only.** No application code yet.
