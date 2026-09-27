/**
 * Slice 2 token issue / introspect / revoke (A2.1–A2.5).
 * In-memory node:sqlite stands in for D1. No Wrangler, no secrets.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_TOKEN_TTL_SECONDS,
  MAX_TOKEN_TTL_SECONDS,
  hashAgentToken,
  normalizeDisplayName,
  resolveTtlSeconds,
} from "../src/agent_tokens.ts";
import { AgentStore } from "../src/agents.ts";
import worker from "../src/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function openDb(): { db: DatabaseSync; d1: D1Database } {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(readFileSync(join(root, "migrations/0001_accounts.sql"), "utf8"));
  db.exec(readFileSync(join(root, "migrations/0002_agents.sql"), "utf8"));
  const d1 = {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          const stmt = db.prepare(query);
          return {
            async first() {
              return stmt.get(...(params as [])) ?? null;
            },
            async run() {
              stmt.run(...(params as []));
              return { success: true };
            },
          };
        },
      };
    },
  };
  return { db, d1: d1 as D1Database };
}

async function insertAccount(
  d1: D1Database,
  account_id: string,
  stytch_user_id: string,
): Promise<void> {
  const now = "2026-09-27T00:00:00.000Z";
  await d1
    .prepare(
      `INSERT INTO accounts
        (account_id, email, stytch_user_id, linked_apple, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'member', ?, ?)`,
    )
    .bind(account_id, `${account_id}@example.com`, stytch_user_id, null, now, now)
    .run();
}

function workerEnv(d1: D1Database) {
  return {
    DB: d1,
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    RP_ID: "prims.sh",
    SESSION_COOKIE: "prims_session",
    SESSION_DURATION_MINUTES: "60",
  };
}

function post(path: string, body: unknown): Request {
  return new Request(`https://login.prims.sh${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("hashAgentToken is sha-256 hex and display names trim", async () => {
  assert.equal(
    await hashAgentToken("agt_test"),
    "1817cb9906f26fc9b43b151677ca30da5873c5b22ac3771bcfefbfd31f288318",
  );
  assert.equal(normalizeDisplayName("  Drive reader  "), "Drive reader");
  assert.equal(normalizeDisplayName(""), null);
  assert.equal(normalizeDisplayName("x".repeat(129)), null);
});

test("ttl defaults to 3600 and rejects anything over one hour", () => {
  assert.equal(resolveTtlSeconds(undefined), DEFAULT_TOKEN_TTL_SECONDS);
  assert.equal(DEFAULT_TOKEN_TTL_SECONDS, 3600);
  assert.equal(MAX_TOKEN_TTL_SECONDS, 3600);
  assert.equal(resolveTtlSeconds(3600), 3600);
  assert.equal(resolveTtlSeconds(1), 1);
  assert.equal(typeof resolveTtlSeconds(3601), "string");
  assert.equal(typeof resolveTtlSeconds(0), "string");
  assert.equal(typeof resolveTtlSeconds(1.5), "string");
});

test("A2.1-A2.5 issue, verify, revoke, sibling agent stays valid", async () => {
  const { db, d1 } = openDb();
  await insertAccount(d1, "acc_owner", "user_owner");
  const store = new AgentStore(d1);
  const start = new Date("2026-09-27T00:00:00.000Z");
  const agentA = await store.create({
    account_id: "acc_owner",
    display_name: "alpha",
    now: start,
  });
  const agentB = await store.create({
    account_id: "acc_owner",
    display_name: "beta",
    now: start,
  });
  assert.match(agentA.agent_id, /^agent_/);
  assert.equal(agentA.account_id, "acc_owner");
  assert.equal(agentA.display_name, "alpha");

  const ttl = resolveTtlSeconds(undefined);
  assert.equal(typeof ttl, "number");
  const tokenA = await store.issueToken({
    agent_id: agentA.agent_id,
    ttl_seconds: ttl as number,
    now: start,
  });
  const tokenB = await store.issueToken({
    agent_id: agentB.agent_id,
    ttl_seconds: 3600,
    now: start,
  });
  assert.ok(tokenA && tokenB);
  assert.equal(tokenA.expires_at, "2026-09-27T01:00:00.000Z");
  assert.equal(tokenA.agent_id, agentA.agent_id);

  const stored = db
    .prepare("SELECT token_hash FROM agent_tokens WHERE token_id = ?")
    .get(tokenA.token_id) as { token_hash: string };
  assert.equal(stored.token_hash, await hashAgentToken(tokenA.token));
  assert.equal(JSON.stringify(stored).includes(tokenA.token), false);

  const live = await store.introspect(tokenA.token, new Date(start.getTime() + 1000));
  assert.equal(live.active, true);
  if (live.active) assert.equal(live.agent_id, agentA.agent_id);

  const revoked = await store.revoke({
    account_id: "acc_owner",
    token_id: tokenA.token_id,
    now: start,
  });
  assert.equal(revoked?.agent_id, agentA.agent_id);
  const dead = await store.introspect(tokenA.token, new Date(start.getTime() + 1000));
  assert.deepEqual(dead, { active: false });

  const sibling = await store.introspect(tokenB.token, new Date(start.getTime() + 1000));
  assert.equal(sibling.active, true);
  if (sibling.active) assert.equal(sibling.agent_id, agentB.agent_id);
});

test("expired and unknown tokens fail introspect", async () => {
  const { d1 } = openDb();
  await insertAccount(d1, "acc_exp", "user_exp");
  const store = new AgentStore(d1);
  const agent = await store.create({
    account_id: "acc_exp",
    display_name: "expiring",
  });
  const start = new Date("2026-09-27T00:00:00.000Z");
  const issued = await store.issueToken({
    agent_id: agent.agent_id,
    ttl_seconds: 60,
    now: start,
  });
  assert.ok(issued);
  const before = await store.introspect(
    issued.token,
    new Date(start.getTime() + 59_000),
  );
  assert.equal(before.active, true);
  const after = await store.introspect(
    issued.token,
    new Date(start.getTime() + 60_000),
  );
  assert.equal(after.active, false);
  assert.deepEqual(await store.introspect("agt_unknown"), { active: false });
});

test("revoke is per token and per owning account", async () => {
  const { d1 } = openDb();
  await insertAccount(d1, "acc_a", "sty_a");
  await insertAccount(d1, "acc_b", "sty_b");
  const store = new AgentStore(d1);
  const agent = await store.create({ account_id: "acc_a", display_name: "a" });
  const first = await store.issueToken({
    agent_id: agent.agent_id,
    ttl_seconds: 3600,
  });
  const second = await store.issueToken({
    agent_id: agent.agent_id,
    ttl_seconds: 3600,
  });
  assert.ok(first && second);
  assert.equal(await store.revoke({ account_id: "acc_b", token: first.token }), null);
  assert.equal((await store.introspect(first.token)).active, true);
  assert.ok(await store.revoke({ account_id: "acc_a", token: first.token }));
  assert.equal((await store.introspect(first.token)).active, false);
  assert.equal((await store.introspect(second.token)).active, true);
  assert.ok(await store.revoke({ account_id: "acc_a", token_id: first.token_id }));
});

test("HTTP introspect fails immediately after revoke; sibling stays active", async () => {
  const { d1 } = openDb();
  await insertAccount(d1, "acc_http", "user_http");
  const store = new AgentStore(d1);
  const agentA = await store.create({
    account_id: "acc_http",
    display_name: "http-a",
  });
  const agentB = await store.create({
    account_id: "acc_http",
    display_name: "http-b",
  });
  const tokenA = await store.issueToken({
    agent_id: agentA.agent_id,
    ttl_seconds: 3600,
  });
  const tokenB = await store.issueToken({
    agent_id: agentB.agent_id,
    ttl_seconds: 3600,
  });
  assert.ok(tokenA && tokenB);
  const env = workerEnv(d1);
  const ctx = {} as ExecutionContext;
  const before = await worker.fetch(post("/v1/agent-tokens/introspect", { token: tokenA.token }), env, ctx);
  assert.equal(before.status, 200);
  const beforeBody = (await before.json()) as { active: boolean; agent_id: string };
  assert.equal(beforeBody.active, true);
  assert.equal(beforeBody.agent_id, agentA.agent_id);

  assert.ok(await store.revoke({ account_id: "acc_http", token_id: tokenA.token_id }));
  const after = await worker.fetch(post("/v1/agent-tokens/introspect", { token: tokenA.token }), env, ctx);
  assert.equal(after.status, 401);
  assert.equal(((await after.json()) as { active: boolean }).active, false);

  const sibling = await worker.fetch(
    post("/v1/agent-tokens/introspect", { token: tokenB.token }),
    env,
    ctx,
  );
  assert.equal(sibling.status, 200);
  const siblingBody = (await sibling.json()) as { active: boolean; agent_id: string };
  assert.equal(siblingBody.active, true);
  assert.equal(siblingBody.agent_id, agentB.agent_id);
});

test("health reports the current slice and agent routes gate on session", async () => {
  const { d1 } = openDb();
  const env = workerEnv(d1);
  const ctx = {} as ExecutionContext;
  const health = await worker.fetch(new Request("https://login.prims.sh/health"), env, ctx);
  assert.equal(health.status, 200);
  const body = (await health.json()) as {
    slice: number;
    d1_bound: boolean;
    stytch_configured: boolean;
    rp_id: string;
  };
  assert.equal(body.slice, 4);
  assert.equal(body.d1_bound, true);
  assert.equal(body.stytch_configured, false);
  assert.equal(body.rp_id, "prims.sh");

  const create = await worker.fetch(
    post("/v1/accounts/acc_x/agents", { display_name: "nope" }),
    env,
    ctx,
  );
  assert.equal(create.status, 401);
  const issue = await worker.fetch(post("/v1/agents/agent_x/tokens", {}), env, ctx);
  assert.equal(issue.status, 401);
  const revoke = await worker.fetch(post("/v1/agent-tokens/revoke", {}), env, ctx);
  assert.equal(revoke.status, 401);
  const missing = await worker.fetch(post("/v1/agent-tokens/introspect", {}), env, ctx);
  assert.equal(missing.status, 400);
});
