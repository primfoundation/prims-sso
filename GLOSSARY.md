# Glossary

Short locked meanings for **prims-sso**. Canonical architecture: [#6 Architecture: passkeys + Stytch IdP core](https://github.com/primfoundation/prims-sso/issues/6).

| Term | Meaning |
|------|---------|
| **Prim** | A single file / pack — the durable unit of knowledge (one pack on disk). |
| **Prims** | The foundation and product family (org, IdP, drive, browsers, desktop) — plural naming for infrastructure and surfaces. |
| **Prims account** | Free human identity on the foundation. Sole human IdP surface: `login.prims.sh`. Authenticated with **passkeys (WebAuthn)** via **Stytch**; email (and optional Apple Sign-In) are identifier / link / recovery only — not the primary door. |
| **Prims agent** | First-class **sub-identity** under a human Prims account. Stable **`agent_id`** + **short-lived tokens** (Stytch M2M-backed), scoped permissions, **per-agent connectors**, rules, and fine-grained RBAC in an **OpenFGA/Authzed-class** store (separate from SSO authn). Never borrows the human’s session. Essentially unlimited per human (thousands; no hard cap); throttled by **per-human** rate limits. Issued and scoped by prims-sso; rotatable; one revoke is instant, isolated (denylist + introspection). Downstream surfaces trust assertions — never raw secrets. Connector refresh tokens live in a **dedicated vault** keyed by `agent_id`; SSO stores refs only. |

Spelling: product / mount names keep the **s** where foundation-scoped (`PrimsDrive`, `prims-sso`). A Prim type pack may stay singular (e.g. `prim.workbook`).

**IdP lock:** **Stytch** = passkey / WebAuthn / account / M2M core. **`login.prims.sh` on Cloudflare Workers** = thin edge façade. Agent identity (`agent_id`, scopes, RBAC, connectors) stays behind a **Prims-owned abstraction** so the passkey core is swappable. **RP ID = `prims.sh`** (login origin `https://login.prims.sh`). Not Authentik. Not stock Cloudflare Access as the account store. Not a fully custom WebAuthn implementation.
