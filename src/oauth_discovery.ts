/** login.prims.sh is the consent façade, not the OAuth issuer.
 * Token, refresh, revoke, registration, and metadata stay on the verified
 * Stytch custom domain. These routes fail closed so a client cannot treat
 * the façade as that issuer.
 */

const HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

export const ISSUER_DISCOVERY_PATHS = [
  "/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration",
] as const;

export function isIssuerDiscoveryPath(path: string): boolean {
  return (ISSUER_DISCOVERY_PATHS as readonly string[]).includes(path);
}

export function configuredHttps(value: string | undefined): boolean {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && !url.username && !url.password && !url.hash && !url.search;
  } catch {
    return false;
  }
}

export function issuerDiscoveryRefusal(): Response {
  return Response.json(
    {
      error: "issuer_not_hosted_here",
      authorization_ui: "https://login.prims.sh/oauth/authorize",
    },
    { status: 503, headers: HEADERS },
  );
}
