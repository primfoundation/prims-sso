/** Prims account model — D1 primary store (Slice 1). */

export type AccountRole = "member";

export interface Account {
  account_id: string;
  email: string;
  stytch_user_id: string;
  linked_apple: string | null;
  role: AccountRole;
  created_at: string;
  updated_at: string;
}

export interface AccountPublic {
  account_id: string;
  email: string;
  linked_apple: string | null;
  role: AccountRole;
  created_at: string;
  updated_at: string;
}

export function toPublic(row: Account): AccountPublic {
  return {
    account_id: row.account_id,
    email: row.email,
    linked_apple: row.linked_apple,
    role: row.role,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function newAccountId(): string {
  return `acc_${crypto.randomUUID()}`;
}

export class AccountStore {
  constructor(private readonly db: D1Database) {}

  async getById(account_id: string): Promise<Account | null> {
    return this.db
      .prepare("SELECT * FROM accounts WHERE account_id = ?")
      .bind(account_id)
      .first<Account>();
  }

  async getByStytchUserId(stytch_user_id: string): Promise<Account | null> {
    return this.db
      .prepare("SELECT * FROM accounts WHERE stytch_user_id = ?")
      .bind(stytch_user_id)
      .first<Account>();
  }

  async getByEmail(email: string): Promise<Account | null> {
    return this.db
      .prepare("SELECT * FROM accounts WHERE email = ?")
      .bind(email.toLowerCase())
      .first<Account>();
  }

  /**
   * Create or return existing account for this Stytch user (upsert-on-first-login).
   * Default role is always `member`.
   */
  async upsertOnLogin(params: {
    stytch_user_id: string;
    email: string;
  }): Promise<{ account: Account; created: boolean }> {
    const email = params.email.trim().toLowerCase();
    const existing = await this.getByStytchUserId(params.stytch_user_id);
    if (existing) {
      if (existing.email !== email) {
        const updated_at = nowIso();
        await this.db
          .prepare(
            "UPDATE accounts SET email = ?, updated_at = ? WHERE account_id = ?",
          )
          .bind(email, updated_at, existing.account_id)
          .run();
        return {
          account: { ...existing, email, updated_at },
          created: false,
        };
      }
      return { account: existing, created: false };
    }

    const byEmail = await this.getByEmail(email);
    if (byEmail) {
      // Rare: email row exists under a different stytch id — refuse silent merge.
      throw new AccountConflictError(
        "Email already linked to another Prims account",
      );
    }

    const account: Account = {
      account_id: newAccountId(),
      email,
      stytch_user_id: params.stytch_user_id,
      linked_apple: null,
      role: "member",
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    await this.db
      .prepare(
        `INSERT INTO accounts
          (account_id, email, stytch_user_id, linked_apple, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        account.account_id,
        account.email,
        account.stytch_user_id,
        account.linked_apple,
        account.role,
        account.created_at,
        account.updated_at,
      )
      .run();
    return { account, created: true };
  }

  async setLinkedApple(
    account_id: string,
    linked_apple: string | null,
  ): Promise<Account | null> {
    const existing = await this.getById(account_id);
    if (!existing) return null;
    const updated_at = nowIso();
    await this.db
      .prepare(
        "UPDATE accounts SET linked_apple = ?, updated_at = ? WHERE account_id = ?",
      )
      .bind(linked_apple, updated_at, account_id)
      .run();
    return { ...existing, linked_apple, updated_at };
  }
}

export class AccountConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountConflictError";
  }
}
