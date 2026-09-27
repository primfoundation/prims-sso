/** Stytch session gate for authenticated Account API (Slice 1). */

import { parseCookies, DEFAULT_SESSION_COOKIE } from "./session";
import { stytchFromEnv, type StytchClient } from "./stytch";

export interface SessionIdentity {
  stytch_user_id: string;
  email: string;
  session_token: string;
}

export interface AuthEnv {
  SESSION_COOKIE?: string;
  STYTCH_PROJECT_ID?: string;
  STYTCH_SECRET?: string;
  STYTCH_ENV?: string;
}

function cookieName(env: AuthEnv): string {
  return env.SESSION_COOKIE || DEFAULT_SESSION_COOKIE;
}

/** Prefer Authorization: Bearer <stytch_session_token>; else Cookie prims_session. */
export function extractSessionToken(
  request: Request,
  env: AuthEnv,
): string | null {
  const auth = request.headers.get("Authorization");
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m?.[1]) return m[1].trim();
  }
  const cookies = parseCookies(request.headers.get("Cookie"));
  const fromCookie = cookies[cookieName(env)];
  return fromCookie?.trim() || null;
}

export async function requireSession(
  request: Request,
  env: AuthEnv,
  stytch?: StytchClient,
): Promise<SessionIdentity | Response> {
  const token = extractSessionToken(request, env);
  if (!token) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  const client = stytch ?? stytchFromEnv(env);
  try {
    const auth = await client.sessionsAuthenticate(token);
    const user = await client.usersGet(auth.user_id);
    const email =
      user.emails?.find((e) => e.primary)?.email ||
      user.emails?.[0]?.email ||
      "";
    if (!email) {
      return new Response(
        JSON.stringify({ error: "session user has no email" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        },
      );
    }
    return {
      stytch_user_id: auth.user_id,
      email: email.toLowerCase(),
      session_token: token,
    };
  } catch {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}
