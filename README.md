# prims-sso

**Prims SSO** — the Prims account **identity provider** for humans.

This service is the **sole** human IdP for the foundation (`login.prims.sh`): OIDC/OAuth so people sign into [drive.prims.sh](https://drive.prims.sh), Prims Browsers, and other Prims surfaces with one **Prims account**.

**Glossary:** [GLOSSARY.md](./GLOSSARY.md) · **Account model (locked):** [#1](https://github.com/primfoundation/prims-sso/issues/1)

## What this is

| Concern | Owner |
|---------|--------|
| **Human identity** (Prims account, web session on `login.prims.sh`) | **This repo** (`prims-sso`) |
| **Agent keys** (per-agent scoped bearers under a human account) | **Issued by prims-sso**; **held by Cloudflare** for `drive.prims.sh` per [primsdrive-cloud](https://github.com/primfoundation/primsdrive-cloud); mini never sees raw keys |

Human SSO sessions never authorize `/v1` or `/mcp`. Agent bearers never authorize the HTML app. One identity, one door — browsers delegates here ([cleanup#10](https://github.com/primfoundation/prims-cleanup/issues/10), [#5](https://github.com/primfoundation/prims-sso/issues/5)).

## Consumers

- **drive.prims.sh** human web login — [primsdrive-cloud#6](https://github.com/primfoundation/primsdrive-cloud/issues/6)
- **browsers.prims.sh** — session via this IdP (cloud login app deprecated)
- Future Prims web surfaces that need the same account

Prefer Cloudflare Access + this IdP (or equivalent OIDC) for HTML gates.

## Related

- Cloud edge / packs: [primfoundation/primsdrive-cloud](https://github.com/primfoundation/primsdrive-cloud)
- Mac File Provider app: [primfoundation/primsdrive](https://github.com/primfoundation/primsdrive)
- Product / registry: registry.prims.sh (coordinate with Prims product)

## Workstreams

1. [#1 Prims account model — locked spec](https://github.com/primfoundation/prims-sso/issues/1)
2. [#2 OIDC/OAuth provider endpoint](https://github.com/primfoundation/prims-sso/issues/2)
3. [#3 drive.prims.sh integration (Cloudflare Access + IdP)](https://github.com/primfoundation/prims-sso/issues/3)
4. [#4 Agent vs human identity separation](https://github.com/primfoundation/prims-sso/issues/4)
5. [#5 Apple OAuth for browsers door](https://github.com/primfoundation/prims-sso/issues/5)

## Status

**Plan / issues only.** No application code yet.

## Brand assets

Login-surface brand (folio, favicon, Instrument Sans, kit.css) lives in [`brand/`](./brand/) — folded from archived `logins-prims-sh`. Asset consolidation only; no SSO app code yet.
