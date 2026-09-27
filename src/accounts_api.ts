/** Account CRUD HTTP handlers (Slice 1). */

import {
  AccountConflictError,
  AccountStore,
  toPublic,
} from "./accounts";
import { requireSession, type AuthEnv } from "./auth";

export interface AccountEnv extends AuthEnv {
  DB: D1Database;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function store(env: AccountEnv): AccountStore {
  return new AccountStore(env.DB);
}

/** POST /v1/accounts — create or upsert-on-first-login for the session user. */
export async function handleAccountCreate(
  request: Request,
  env: AccountEnv,
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  let bodyEmail: string | undefined;
  try {
    const body = (await request.json()) as { email?: string };
    bodyEmail = body.email?.trim().toLowerCase();
  } catch {
    bodyEmail = undefined;
  }
  if (bodyEmail && bodyEmail !== session.email) {
    return json(
      { error: "email must match the authenticated Stytch session" },
      400,
    );
  }

  try {
    const { account, created } = await store(env).upsertOnLogin({
      stytch_user_id: session.stytch_user_id,
      email: session.email,
    });
    return json(
      {
        ...toPublic(account),
        created,
      },
      created ? 201 : 200,
    );
  } catch (err) {
    if (err instanceof AccountConflictError) {
      return json({ error: err.message }, 409);
    }
    throw err;
  }
}

/** GET /v1/accounts/:account_id — authenticated; own account only. */
export async function handleAccountGet(
  request: Request,
  env: AccountEnv,
  account_id: string,
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const row = await store(env).getById(account_id);
  if (!row) return json({ error: "not found" }, 404);
  if (row.stytch_user_id !== session.stytch_user_id) {
    return json({ error: "forbidden" }, 403);
  }
  return json(toPublic(row));
}

/**
 * PATCH /v1/accounts/:account_id — set optional linked_apple stub (string|null).
 * Does not change primary auth (passkeys remain the door).
 */
export async function handleAccountPatch(
  request: Request,
  env: AccountEnv,
  account_id: string,
): Promise<Response> {
  const session = await requireSession(request, env);
  if (session instanceof Response) return session;

  const existing = await store(env).getById(account_id);
  if (!existing) return json({ error: "not found" }, 404);
  if (existing.stytch_user_id !== session.stytch_user_id) {
    return json({ error: "forbidden" }, 403);
  }

  let body: { linked_apple?: string | null };
  try {
    body = (await request.json()) as { linked_apple?: string | null };
  } catch {
    return json({ error: "JSON body required" }, 400);
  }
  if (!("linked_apple" in body)) {
    return json({ error: "linked_apple field required (string or null)" }, 400);
  }
  if (body.linked_apple !== null && typeof body.linked_apple !== "string") {
    return json({ error: "linked_apple must be string or null" }, 400);
  }
  const linked =
    body.linked_apple === null ? null : body.linked_apple.trim() || null;

  const updated = await store(env).setLinkedApple(account_id, linked);
  if (!updated) return json({ error: "not found" }, 404);
  return json(toPublic(updated));
}
