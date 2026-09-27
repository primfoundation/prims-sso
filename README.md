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

1. [#1 Prims account model](https://github.com/primfoundation/prims-sso/issues/1)
2. [#2 OIDC/OAuth provider endpoint](https://github.com/primfoundation/prims-sso/issues/2)
3. [#3 drive.prims.sh integration (Cloudflare Access + IdP)](https://github.com/primfoundation/prims-sso/issues/3)
4. [#4 Agent vs human identity separation](https://github.com/primfoundation/prims-sso/issues/4)

## Status

**Plan / issues only.** No application code yet.

## Brand assets

Login-surface brand (folio, favicon, Instrument Sans, kit.css) lives in [`brand/`](./brand/) — folded from archived `logins-prims-sh`. Asset consolidation only; no SSO app code yet.