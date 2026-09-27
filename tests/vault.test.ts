/**
 * Slice 4 connector vault stub (A4.1–A4.4).
 * In-memory node:sqlite stands in for D1. No Wrangler, no real secrets.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentStore } from "../src/agents.ts";
import worker from "../src/index.ts";
import {
  normalizeConnectorId,
  normalizeFakeToken,
  toAgentMetadata,
  VaultStore,
} from "../src/vault.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FAKE = "fake-connector-token-a4";
const ctx = {} as ExecutionContext;

function openDb(): { db: DatabaseSync; d1: D1Database } {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of ["0001_accounts.sql", "0002_agents.sql", "0003_rbac.sql", "0004_vault.sql"]) {
    db.exec(readFileSync(join(root, "migrations", file), "utf8"));
  }
  const d1 = {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          const stmt = db.prepare(query);
          return {
            async first() {
              return stmt.get(...(params as [])) ?? null;
            },
            async all() {
              return { results: stmt.all(...(params as [])) };
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

function authedEnv(d1: D1Database) {
  return {
    ...workerEnv(d1),
    STYTCH_PROJECT_ID: "project-test-00000000-0000-0000-0000-000000000000",
    STYTCH_SECRET: "local-test-secret-not-a-real-stytch-secret",
    STYTCH_ENV: "test" as const,
  };
}

function post(path: string, body: unknown, session?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (session) headers.set("cookie", `prims_session=${session}`);
  return new Request(`https://login.prims.sh${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function get(path: string, session?: string): Request {
  const headers = new Headers();
  if (session) headers.set("cookie", `prims_session=${session}`);
  return new Request(`https://login.prims.sh${path}`, { headers });
}

function useSessions(
  users: Record<string, { user_id: string; email: string }>,
): () => void {
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/v1/sessions/authenticate")) {
      const parsed = JSON.parse(String(init?.body ?? "{}")) as { session_token?: string };
      const user = users[parsed.session_token ?? ""];
      if (!user) {
        return Response.json({ error_type: "session_not_found", error_message: "no" }, { status: 401 });
      }
      return Response.json({
        user_id: user.user_id,
        session_token: parsed.session_token,
        session_jwt: "jwt",
        status_code: 200,
      });
    }
    const match = /\/v1\/users\/([^/?]+)/.exec(url);
    if (!match) return previous(input, init);
    const user_id = decodeURIComponent(match[1]);
    const user = Object.values(users).find((row) => row.user_id === user_id);
    if (!user) return Response.json({ error_type: "user_not_found" }, { status: 404 });
    return Response.json({ user_id, emails: [{ email: user.email, primary: true }] });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = previous;
  };
}

function assertNoSecret(body: unknown, secret: string): void {
  const encoded = JSON.stringify(body);
  assert.equal(encoded.includes(secret), false);
  assert.equal(encoded.includes('"token"'), false);
}

async function createAgent(
  env: ReturnType<typeof authedEnv>,
  account_id: string,
  display_name: string,
  session: string,
): Promise<string> {
  const res = await worker.fetch(
    post(`/v1/accounts/${account_id}/agents`, { display_name }, session),
    env,
    ctx,
  );
  assert.equal(res.status, 201);
  return ((await res.json()) as { agent_id: string }).agent_id;
}

test("connector ids and fake tokens normalize", () => {
  assert.equal(normalizeConnectorId(" fake:demo "), "fake:demo");
  assert.equal(normalizeConnectorId(""), null);
  assert.equal(normalizeConnectorId("has space"), null);
  assert.equal(normalizeFakeToken(`  ${FAKE}  `), FAKE);
  assert.equal(normalizeFakeToken(""), null);
  assert.equal(normalizeFakeToken("x".repeat(4097)), null);
});

test("A4.1 store returns a ref and metadata omits the raw token", async () => {
  const { db, d1 } = openDb();
  await insertAccount(d1, "acc_owner", "sty_owner");
  const agent = await new AgentStore(d1).create({
    account_id: "acc_owner",
    display_name: "alpha",
  });
  const vault = new VaultStore(d1);
  const stored = await vault.store({
    agent_id: agent.agent_id,
    connector_id: "fake:demo",
    token: FAKE,
  });
  assert.ok(stored);
  assert.match(stored.ref, /^vref_/);
  assert.equal(JSON.stringify(stored).includes(FAKE), false);
  const row = db.prepare("SELECT token FROM connector_vault WHERE ref = ?").get(stored.ref) as {
    token: string;
  };
  assert.equal(row.token, FAKE);
  const meta = toAgentMetadata(agent, await vault.listRefs(agent.agent_id));
  assert.deepEqual(meta.connectors, [{ ref: stored.ref, connector_id: "fake:demo" }]);
  assertNoSecret(meta, FAKE);
  const again = await vault.store({
    agent_id: agent.agent_id,
    connector_id: "fake:demo",
    token: `${FAKE}-2`,
  });
  assert.equal(again?.ref, stored.ref);
  assert.equal(await vault.store({ agent_id: "agent_missing", connector_id: "fake:demo", token: FAKE }), null);
});

test("A4.2-A4.3 retrieve by ref, then revoke agent makes the ref fail", async () => {
  const { d1 } = openDb();
  await insertAccount(d1, "acc_owner", "sty_owner");
  const agents = new AgentStore(d1);
  const agentA = await agents.create({ account_id: "acc_owner", display_name: "alpha" });
  const agentB = await agents.create({ account_id: "acc_owner", display_name: "beta" });
  const vault = new VaultStore(d1);
  const refA = await vault.store({ agent_id: agentA.agent_id, connector_id: "fake:demo", token: FAKE });
  const refB = await vault.store({
    agent_id: agentB.agent_id,
    connector_id: "fake:demo",
    token: `${FAKE}-b`,
  });
  assert.ok(refA && refB);
  assert.equal((await vault.retrieve(refA.ref))?.token, FAKE);
  const revoked = await agents.revokeAgent({ account_id: "acc_owner", agent_id: agentA.agent_id });
  assert.equal(revoked.ok, true);
  assert.equal(await vault.deleteByAgent(agentA.agent_id), 1);
  assert.equal(await vault.retrieve(refA.ref), null);
  assert.equal((await vault.retrieve(refB.ref))?.token, `${FAKE}-b`);
  assert.equal(await vault.deleteByAgent(agentA.agent_id), 0);
});

test("vault HTTP routes reject missing sessions", async () => {
  const { d1 } = openDb();
  const env = workerEnv(d1);
  const store = await worker.fetch(
    post("/v1/agents/agent_x/vault", { connector_id: "fake:demo", token: FAKE }),
    env,
    ctx,
  );
  assert.equal(store.status, 401);
  const meta = await worker.fetch(get("/v1/agents/agent_x"), env, ctx);
  assert.equal(meta.status, 401);
  const read = await worker.fetch(post("/v1/vault/retrieve", { ref: "vref_x" }), env, ctx);
  assert.equal(read.status, 401);
  const revoke = await worker.fetch(post("/v1/agents/agent_x/revoke", {}), env, ctx);
  assert.equal(revoke.status, 401);
});

test("A4.1 HTTP store and metadata hide the raw token", async () => {
  const { d1 } = openDb();
  await insertAccount(d1, "acc_owner", "sty_owner");
  await insertAccount(d1, "acc_other", "sty_other");
  const env = authedEnv(d1);
  const restore = useSessions({
    sess_owner: { user_id: "sty_owner", email: "acc_owner@example.com" },
    sess_other: { user_id: "sty_other", email: "acc_other@example.com" },
  });
  try {
    const agentA = await createAgent(env, "acc_owner", "alpha", "sess_owner");
    const storedRes = await worker.fetch(
      post(`/v1/agents/${agentA}/vault`, { connector_id: "fake:demo", token: FAKE }, "sess_owner"),
      env,
      ctx,
    );
    assert.equal(storedRes.status, 201);
    const stored = (await storedRes.json()) as { ref: string; connector_id: string };
    assert.match(stored.ref, /^vref_/);
    assert.equal(stored.connector_id, "fake:demo");
    assertNoSecret(stored, FAKE);
    const metaRes = await worker.fetch(get(`/v1/agents/${agentA}`, "sess_owner"), env, ctx);
    assert.equal(metaRes.status, 200);
    const meta = (await metaRes.json()) as { connectors: Array<{ ref: string }> };
    assert.deepEqual(meta.connectors.map((row) => row.ref), [stored.ref]);
    assertNoSecret(meta, FAKE);
    const accountRes = await worker.fetch(get("/v1/accounts/acc_owner", "sess_owner"), env, ctx);
    assert.equal(accountRes.status, 200);
    assertNoSecret(await accountRes.json(), FAKE);
    const denied = await worker.fetch(
      post(`/v1/agents/${agentA}/vault`, { connector_id: "fake:other", token: FAKE }, "sess_other"),
      env,
      ctx,
    );
    assert.equal(denied.status, 403);
  } finally {
    restore();
  }
});

test("A4.2 HTTP retrieve returns the fake token only to the owner", async () => {
  const { d1 } = openDb();
  await insertAccount(d1, "acc_owner", "sty_owner");
  await insertAccount(d1, "acc_other", "sty_other");
  const env = authedEnv(d1);
  const restore = useSessions({
    sess_owner: { user_id: "sty_owner", email: "acc_owner@example.com" },
    sess_other: { user_id: "sty_other", email: "acc_other@example.com" },
  });
  try {
    const agentA = await createAgent(env, "acc_owner", "alpha", "sess_owner");
    const storedRes = await worker.fetch(
      post(`/v1/agents/${agentA}/vault`, { connector_id: "fake:demo", token: FAKE }, "sess_owner"),
      env,
      ctx,
    );
    const ref = ((await storedRes.json()) as { ref: string }).ref;
    const read = await worker.fetch(post("/v1/vault/retrieve", { ref }, "sess_owner"), env, ctx);
    assert.equal(read.status, 200);
    assert.equal(((await read.json()) as { token: string }).token, FAKE);
    const other = await worker.fetch(post("/v1/vault/retrieve", { ref }, "sess_other"), env, ctx);
    assert.equal(other.status, 404);
    const missing = await worker.fetch(
      post("/v1/vault/retrieve", { ref: "vref_missing" }, "sess_owner"),
      env,
      ctx,
    );
    assert.equal(missing.status, 404);
  } finally {
    restore();
  }
});

test("A4.3 HTTP revoke agent makes the old ref fail and keeps the sibling", async () => {
  const { d1 } = openDb();
  await insertAccount(d1, "acc_owner", "sty_owner");
  const env = authedEnv(d1);
  const restore = useSessions({
    sess_owner: { user_id: "sty_owner", email: "acc_owner@example.com" },
  });
  try {
    const agentA = await createAgent(env, "acc_owner", "alpha", "sess_owner");
    const agentB = await createAgent(env, "acc_owner", "beta", "sess_owner");
    const tokenA = await worker.fetch(post(`/v1/agents/${agentA}/tokens`, {}, "sess_owner"), env, ctx);
    const tokenB = await worker.fetch(post(`/v1/agents/${agentB}/tokens`, {}, "sess_owner"), env, ctx);
    assert.equal(tokenA.status, 201);
    assert.equal(tokenB.status, 201);
    const rawA = ((await tokenA.json()) as { token: string }).token;
    const rawB = ((await tokenB.json()) as { token: string }).token;
    const refA = ((await (await worker.fetch(
      post(`/v1/agents/${agentA}/vault`, { connector_id: "fake:demo", token: FAKE }, "sess_owner"),
      env,
      ctx,
    )).json()) as { ref: string }).ref;
    const refB = ((await (await worker.fetch(
      post(`/v1/agents/${agentB}/vault`, { connector_id: "fake:demo", token: `${FAKE}-b` }, "sess_owner"),
      env,
      ctx,
    )).json()) as { ref: string }).ref;
    const revoked = await worker.fetch(post(`/v1/agents/${agentA}/revoke`, {}, "sess_owner"), env, ctx);
    assert.equal(revoked.status, 200);
    assert.equal(((await revoked.json()) as { vault_entries_deleted: number }).vault_entries_deleted, 1);
    const dead = await worker.fetch(post("/v1/vault/retrieve", { ref: refA }, "sess_owner"), env, ctx);
    assert.equal(dead.status, 404);
    const live = await worker.fetch(post("/v1/vault/retrieve", { ref: refB }, "sess_owner"), env, ctx);
    assert.equal(live.status, 200);
    assert.equal(((await live.json()) as { token: string }).token, `${FAKE}-b`);
    const introA = await worker.fetch(post("/v1/agent-tokens/introspect", { token: rawA }), env, ctx);
    assert.equal(introA.status, 401);
    const introB = await worker.fetch(post("/v1/agent-tokens/introspect", { token: rawB }), env, ctx);
    assert.equal(introB.status, 200);
    const meta = await worker.fetch(get(`/v1/agents/${agentA}`, "sess_owner"), env, ctx);
    assert.equal(meta.status, 200);
    assertNoSecret(await meta.json(), FAKE);
  } finally {
    restore();
  }
});

test("A4.4 README documents the vault stub and no real OAuth", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.match(readme, /## Connector vault stub \(Slice 4\)/);
  assert.match(readme, /No real OAuth providers/);
  assert.match(readme, /\/v1\/agents\/\$AGENT_ID\/vault/);
  assert.match(readme, /\/v1\/agents\/\$AGENT_ID"/);
  assert.match(readme, /\/v1\/vault\/retrieve/);
  assert.match(readme, /\/v1\/agents\/\$AGENT_ID\/revoke/);
  assert.match(readme, /migrations\/0004_vault\.sql/);
  assert.match(readme, /"slice": 4/);
});
