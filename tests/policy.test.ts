/**
 * Slice 3 RBAC stub (A3.1–A3.4).
 * In-memory node:sqlite stands in for D1. No Wrangler, no secrets.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentStore } from "../src/agents.ts";
import { PolicyStore } from "../src/policy.ts";
import worker from "../src/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function openDb(): { db: DatabaseSync; d1: D1Database } {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(readFileSync(join(root, "migrations/0001_accounts.sql"), "utf8"));
  db.exec(readFileSync(join(root, "migrations/0002_agents.sql"), "utf8"));
  db.exec(readFileSync(join(root, "migrations/0003_rbac.sql"), "utf8"));
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

async function insertAccount(d1: D1Database, account_id: string): Promise<void> {
  const now = "2026-09-27T00:00:00.000Z";
  await d1
    .prepare(
      `INSERT INTO accounts
        (account_id, email, stytch_user_id, linked_apple, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'member', ?, ?)`,
    )
    .bind(account_id, `${account_id}@example.com`, `sty_${account_id}`, null, now, now)
    .run();
}

function post(path: string, body: unknown): Request {
  return new Request(`https://login.prims.sh${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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

async function expectCheck(
  env: ReturnType<typeof workerEnv>,
  body: { agent_id: string; resource: string; action: string },
  allow: boolean,
): Promise<void> {
  const res = await worker.fetch(post("/v1/policy/check", body), env, {} as ExecutionContext);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { allow });
}

async function twoAgents(d1: D1Database): Promise<{ a: string; b: string }> {
  await insertAccount(d1, "acc_owner");
  const agents = new AgentStore(d1);
  const agentA = await agents.create({
    account_id: "acc_owner",
    display_name: "agent-a",
  });
  const agentB = await agents.create({
    account_id: "acc_owner",
    display_name: "agent-b",
  });
  return { a: agentA.agent_id, b: agentB.agent_id };
}

test("A3.1-A3.3 read grant allows; write and other agent deny", async () => {
  const { d1 } = openDb();
  const { a, b } = await twoAgents(d1);
  const policy = new PolicyStore(d1);
  const granted = await policy.grant({
    agent_id: a,
    resource: "resource:demo",
    action: "read",
    effect: "allow",
  });
  assert.equal(granted?.effect, "allow");
  assert.equal(granted?.resource, "resource:demo");

  assert.equal(
    await policy.check({ agent_id: a, resource: "resource:demo", action: "read" }),
    true,
  );
  assert.equal(
    await policy.check({ agent_id: a, resource: "resource:demo", action: "write" }),
    false,
  );
  assert.equal(
    await policy.check({ agent_id: b, resource: "resource:demo", action: "read" }),
    false,
  );
  assert.equal(
    await policy.check({ agent_id: a, resource: "resource:other", action: "read" }),
    false,
  );
});

test("deny overrides allow when both rows match", async () => {
  const { db, d1 } = openDb();
  const { a } = await twoAgents(d1);
  const policy = new PolicyStore(d1);
  const first = new Date("2026-09-27T00:00:00.000Z");
  const second = new Date("2026-09-27T00:05:00.000Z");
  await policy.grant({
    agent_id: a,
    resource: "resource:demo",
    action: "read",
    effect: "allow",
    now: first,
  });
  await policy.grant({
    agent_id: a,
    resource: "resource:demo",
    action: "read",
    effect: "deny",
    now: second,
  });
  const count = db
    .prepare(
      `SELECT COUNT(*) AS n FROM agent_policies
       WHERE agent_id = ? AND resource = ? AND action = ?`,
    )
    .get(a, "resource:demo", "read") as { n: number };
  assert.equal(count.n, 2);
  assert.equal(
    await policy.check({ agent_id: a, resource: "resource:demo", action: "read" }),
    false,
  );

  const again = await policy.grant({
    agent_id: a,
    resource: "resource:demo",
    action: "read",
    effect: "allow",
    now: second,
  });
  assert.equal(again?.created_at, first.toISOString());
  assert.equal(again?.updated_at, second.toISOString());
  const still = db
    .prepare(
      `SELECT COUNT(*) AS n FROM agent_policies
       WHERE agent_id = ? AND resource = ? AND action = ? AND effect = 'allow'`,
    )
    .get(a, "resource:demo", "read") as { n: number };
  assert.equal(still.n, 1);
});

test("unknown agent is default deny and cannot be granted", async () => {
  const { d1 } = openDb();
  const policy = new PolicyStore(d1);
  assert.equal(
    await policy.check({
      agent_id: "agent_missing",
      resource: "resource:demo",
      action: "read",
    }),
    false,
  );
  assert.equal(
    await policy.grant({
      agent_id: "agent_missing",
      resource: "resource:demo",
      action: "read",
      effect: "allow",
    }),
    null,
  );
});

test("A3.4 HTTP check suite and unauthenticated grant is 401", async () => {
  const { d1 } = openDb();
  const { a, b } = await twoAgents(d1);
  await new PolicyStore(d1).grant({
    agent_id: a,
    resource: "resource:demo",
    action: "read",
    effect: "allow",
  });
  const env = workerEnv(d1);
  const ctx = {} as ExecutionContext;
  await expectCheck(env, { agent_id: a, resource: "resource:demo", action: "read" }, true);
  await expectCheck(env, { agent_id: a, resource: "resource:demo", action: "write" }, false);
  await expectCheck(env, { agent_id: b, resource: "resource:demo", action: "read" }, false);

  const bad = await worker.fetch(
    post("/v1/policy/check", { agent_id: a, resource: "resource:demo", action: "admin" }),
    env,
    ctx,
  );
  assert.equal(bad.status, 400);
  const grant = await worker.fetch(
    post(`/v1/agents/${a}/policy`, {
      resource: "resource:demo",
      action: "write",
    }),
    env,
    ctx,
  );
  assert.equal(grant.status, 401);
  const health = await worker.fetch(new Request("https://login.prims.sh/health"), env, ctx);
  assert.equal(((await health.json()) as { slice: number }).slice, 3);
});
