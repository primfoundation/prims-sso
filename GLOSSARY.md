# Glossary

Short locked meanings for **prims-sso**. Canonical architecture: [#6 Architecture: passkeys + unlimited agent keypairs](https://github.com/primfoundation/prims-sso/issues/6).

| Term | Meaning |
|------|---------|
| **Prim** | A single file / pack — the durable unit of knowledge (one pack on disk). |
| **Prims** | The foundation and product family (org, IdP, drive, browsers, desktop) — plural naming for infrastructure and surfaces. |
| **Prims account** | Free human identity on the foundation. Sole human IdP surface: `login.prims.sh`. Authenticated with **passkeys (WebAuthn)**; email is identifier/recovery only. |
| **Prims agent** | First-class **sub-identity** under a human Prims account. Own **cryptographic keypair**, scoped permissions, **per-agent connectors**, rules, and fine-grained RBAC (drives/packs/surfaces, read vs write). Never borrows the human’s session. Essentially unlimited per human (thousands; no hard cap); throttled by **per-human** rate limits. Keys issued and scoped by prims-sso; rotatable; one revoke is instant, global, and touches nothing else. Downstream surfaces trust assertions — never raw private keys. |

Spelling: product / mount names keep the **s** where foundation-scoped (`PrimsDrive`, `prims-sso`). A Prim type pack may stay singular (e.g. `prim.workbook`).

IdP: built from scratch on **Cloudflare Workers** (edge-native, passwordless). Not Authentik. Not stock Cloudflare Access.
