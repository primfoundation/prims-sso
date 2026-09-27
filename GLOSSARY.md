# Glossary

Short locked meanings for **prims-sso**. Canonical account decisions live in [issue #1](https://github.com/primfoundation/prims-sso/issues/1).

| Term | Meaning |
|------|---------|
| **Prim** | A single file / pack — the durable unit of knowledge (one pack on disk). |
| **Prims** | The foundation and product family (org, IdP, drive, browsers, desktop) — plural naming for infrastructure and surfaces. |
| **Prims account** | Free human identity on the foundation. Email and Sign in with Apple both produce the same linkable account. Sole human IdP surface: `login.prims.sh`. |
| **Prims agent** | Sub-identity under a human Prims account. Own scoped API key (bearer); never shares the human’s browser session. Keys issued by prims-sso; Cloudflare holds them for `drive.prims.sh`; the mini never sees raw agent keys. |

Spelling: product / mount names keep the **s** where foundation-scoped (`PrimsDrive`, `prims-sso`). A Prim type pack may stay singular (e.g. `prim.workbook`).
