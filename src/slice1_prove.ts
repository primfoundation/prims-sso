/**
 * Test-env only Slice 1 acceptance harness.
 * Gate: X-Prims-Ops must equal STYTCH_PROJECT_ID (non-secret project id).
 * Mints a short Stytch OTP session via Worker secrets, then runs A1.1–A1.3
 * by invoking Account handlers directly (no secret values in response).
 */

import {
  handleAccountCreate,
  handleAccountGet,
  handleAccountPatch,
} from "./accounts_api";
import { AccountStore, toPublic } from "./accounts";
import { stytchFromEnv } from "./stytch";

export interface ProveEnv {
  DB: D1Database;
  STYTCH_PROJECT_ID?: string;
  STYTCH_SECRET?: string;
  STYTCH_ENV?: string;
  SESSION_COOKIE?: string;
  SESSION_DURATION_MINUTES?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function withBearer(sessionToken: string, init?: RequestInit): Request {
  return new Request("https://login.prims.sh/v1/accounts", {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
      ...(init?.headers || {}),
    },
  });
}

export async function handleSlice1Prove(
  request: Request,
  env: ProveEnv,
): Promise<Response> {
  const stytch = stytchFromEnv(env);
  if (stytch.envName !== "test") {
    return json({ error: "slice1 prove is test-env only" }, 404);
  }
  const ops = request.headers.get("X-Prims-Ops")?.trim();
  if (!ops || ops !== env.STYTCH_PROJECT_ID?.trim()) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!env.DB) {
    return json({ error: "D1 binding DB missing" }, 503);
  }

  const email = `slice1-prove-${Date.now()}@example.com`;
  const results: {
    email_domain: string;
    checks: Record<string, unknown>;
  } = { email_domain: "example.com", checks: {} };

  try {
    const start = (await stytch.otpsEmailLoginOrCreate(email)) as {
      email_id?: string;
      method_id?: string;
      code?: string;
      otp?: string;
    };
    const code = start.code || start.otp || "000000";
    const method_id = start.method_id || start.email_id || "";
    if (!method_id) {
      return json(
        {
          error: "Stytch OTP did not return method_id/email_id",
          hint: "Enable Email OTP on the Stytch test project",
          start_keys: Object.keys(start),
        },
        502,
      );
    }
    const minutes = Math.max(
      5,
      Number(env.SESSION_DURATION_MINUTES || "60") || 60,
    );
    const auth = await stytch.otpsAuthenticate({
      method_id,
      code,
      session_duration_minutes: minutes,
    });
    if (!auth.session_token) {
      return json({ error: "OTP auth returned no session_token" }, 502);
    }
    const token = auth.session_token;

    // A1.1
    const createRes = await handleAccountCreate(
      withBearer(token, { method: "POST", body: "{}" }),
      env,
    );
    const createBody = (await createRes.json()) as {
      account_id?: string;
      role?: string;
      created?: boolean;
    };
    const a11 =
      (createRes.status === 200 || createRes.status === 201) &&
      Boolean(createBody.account_id) &&
      createBody.role === "member";
    results.checks.A1_1 = {
      pass: a11,
      http: createRes.status,
      account_id_prefix: createBody.account_id?.slice(0, 8),
      role: createBody.role,
      created: createBody.created,
    };
    if (!a11 || !createBody.account_id) {
      return json({ ok: false, ...results }, 500);
    }
    const account_id = createBody.account_id;

    // A1.2
    const getOk = await handleAccountGet(
      withBearer(token, { method: "GET" }),
      env,
      account_id,
    );
    const getBody = (await getOk.json()) as { email?: string; role?: string };
    const getUnauth = await handleAccountGet(
      new Request("https://login.prims.sh/v1/accounts/" + account_id, {
        method: "GET",
      }),
      env,
      account_id,
    );
    const a12 =
      getOk.status === 200 &&
      getBody.email === email &&
      getBody.role === "member" &&
      getUnauth.status === 401;
    results.checks.A1_2 = {
      pass: a12,
      get_http: getOk.status,
      unauth_http: getUnauth.status,
      email_match: getBody.email === email,
      role: getBody.role,
    };

    // A1.3
    const patchSet = await handleAccountPatch(
      withBearer(token, {
        method: "PATCH",
        body: JSON.stringify({ linked_apple: "apple_stub_sub_slice1" }),
      }),
      env,
      account_id,
    );
    const patchSetBody = (await patchSet.json()) as {
      linked_apple?: string | null;
    };
    const patchClear = await handleAccountPatch(
      withBearer(token, {
        method: "PATCH",
        body: JSON.stringify({ linked_apple: null }),
      }),
      env,
      account_id,
    );
    const patchClearBody = (await patchClear.json()) as {
      linked_apple?: string | null;
    };
    const a13 =
      patchSet.status === 200 &&
      patchSetBody.linked_apple === "apple_stub_sub_slice1" &&
      patchClear.status === 200 &&
      patchClearBody.linked_apple === null;
    results.checks.A1_3 = {
      pass: a13,
      set_http: patchSet.status,
      clear_http: patchClear.status,
      set_value_ok: patchSetBody.linked_apple === "apple_stub_sub_slice1",
      cleared: patchClearBody.linked_apple === null,
    };

    const row = await new AccountStore(env.DB).getById(account_id);
    results.checks.store = {
      present: Boolean(row),
      public: row ? toPublic(row) : null,
    };

    const all = a11 && a12 && a13 && Boolean(row);
    return json({ ok: all, slice: 1, ...results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message, ...results }, 500);
  }
}
