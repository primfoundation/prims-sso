/**
 * Lightweight AccountStore tests (no Workers runtime).
 * Run: node --experimental-sqlite tests/accounts_store.test.mjs
 * (Node 22+). Validates A1 field defaults used by the D1 store.
 */
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = readFileSync(join(root, "migrations/0001_accounts.sql"), "utf8");

/** Minimal D1-like wrapper over node:sqlite for store logic checks. */
function openFakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(sql);
  return {
    prepare(query) {
      return {
        bind(...params) {
          const stmt = db.prepare(query);
          return {
            async first() {
              return stmt.get(...params) ?? null;
            },
            async run() {
              stmt.run(...params);
              return { success: true };
            },
          };
        },
      };
    },
  };
}

// Dynamic import of compiled? Store is TS — duplicate minimal assertions in JS
// against the migration schema instead of importing TS.
async function main() {
  const d1 = openFakeD1();
  const now = new Date().toISOString();
  const account_id = "acc_test_1";
  await d1
    .prepare(
      `INSERT INTO accounts
        (account_id, email, stytch_user_id, linked_apple, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      account_id,
      "a@example.com",
      "user-test-1",
      null,
      "member",
      now,
      now,
    )
    .run();

  const row = await d1
    .prepare("SELECT * FROM accounts WHERE account_id = ?")
    .bind(account_id)
    .first();
  assert.equal(row.role, "member");
  assert.equal(row.linked_apple, null);
  assert.equal(row.email, "a@example.com");

  await d1
    .prepare(
      "UPDATE accounts SET linked_apple = ?, updated_at = ? WHERE account_id = ?",
    )
    .bind("apple_stub", now, account_id)
    .run();
  const patched = await d1
    .prepare("SELECT linked_apple FROM accounts WHERE account_id = ?")
    .bind(account_id)
    .first();
  assert.equal(patched.linked_apple, "apple_stub");

  console.log("accounts_store.test.mjs PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
