import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../src/index.ts";

const env = {
  ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
  RP_ID: "prims.sh",
  SESSION_COOKIE: "prims_session",
  SESSION_DURATION_MINUTES: "60",
} as unknown as Parameters<typeof worker.fetch>[1];
const ctx = {} as ExecutionContext;

test("login façade refuses issuer discovery and does not mint token or revoke endpoints", async () => {
  for (const path of [
    "/.well-known/oauth-authorization-server",
    "/.well-known/openid-configuration",
  ]) {
    const res = await worker.fetch(new Request(`https://login.prims.sh${path}`), env, ctx);
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.error, "issuer_not_hosted_here");
    assert.equal(body.authorization_ui, "https://login.prims.sh/oauth/authorize");
    for (const key of ["issuer", "authorization_endpoint", "token_endpoint", "revocation_endpoint", "registration_endpoint"]) {
      assert.equal(Object.hasOwn(body, key), false);
    }
  }
  for (const path of ["/oauth/token", "/oauth/revoke", "/v1/oauth2/token", "/v1/oauth2/revoke"]) {
    const res = await worker.fetch(new Request(`https://login.prims.sh${path}`, { method: "POST" }), env, ctx);
    assert.equal(res.status, 404);
  }
  const health = await worker.fetch(new Request("https://login.prims.sh/health"), env, ctx);
  assert.equal(health.status, 200);
  const probe = await health.json() as Record<string, unknown>;
  assert.equal(probe.connected_apps_enabled, false);
  assert.equal(probe.oauth_issuer_configured, false);
  assert.equal(probe.oauth_introspection_configured, false);
});
