/**
 * Thin Stytch Consumer API client for Workers.
 * Passkey / WebAuthn crypto stays in Stytch + the browser — Workers only proxy.
 */

export type StytchEnvName = "test" | "live";

export interface StytchConfig {
  projectId: string;
  secret: string;
  /** Override; otherwise inferred from projectId prefix. */
  envName?: StytchEnvName;
}

export interface StytchErrorBody {
  status_code?: number;
  error_type?: string;
  error_message?: string;
  request_id?: string;
}

export class StytchApiError extends Error {
  readonly status: number;
  readonly body: StytchErrorBody;

  constructor(status: number, body: StytchErrorBody) {
    super(body.error_message ?? `Stytch HTTP ${status}`);
    this.name = "StytchApiError";
    this.status = status;
    this.body = body;
  }
}

function inferEnv(projectId: string, override?: StytchEnvName): StytchEnvName {
  if (override === "test" || override === "live") return override;
  return projectId.startsWith("project-live-") ? "live" : "test";
}

function baseUrl(envName: StytchEnvName): string {
  return envName === "live"
    ? "https://api.stytch.com"
    : "https://test.stytch.com";
}

export class StytchClient {
  private readonly projectId: string;
  private readonly secret: string;
  readonly envName: StytchEnvName;

  constructor(cfg: StytchConfig) {
    this.projectId = cfg.projectId;
    this.secret = cfg.secret;
    this.envName = inferEnv(cfg.projectId, cfg.envName);
  }

  private authHeader(): string {
    const token = btoa(`${this.projectId}:${this.secret}`);
    return `Basic ${token}`;
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${baseUrl(this.envName)}${path}`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as StytchErrorBody & T;
    if (!res.ok) {
      throw new StytchApiError(res.status, json);
    }
    return json;
  }

  createUser(email: string) {
    return this.request<{ user_id: string }>("/v1/users", {
      email,
    });
  }

  searchUsersByEmail(email: string) {
    return this.request<{
      results: Array<{ user_id: string; emails?: Array<{ email: string }> }>;
    }>("/v1/users/search", {
      limit: 1,
      query: {
        operator: "AND",
        operands: [
          {
            filter_name: "email_address",
            filter_value: [email],
          },
        ],
      },
    });
  }

  webauthnRegisterStart(params: {
    user_id: string;
    domain: string;
  }) {
    return this.request<{
      user_id: string;
      public_key_credential_creation_options: string;
    }>("/v1/webauthn/register/start", {
      user_id: params.user_id,
      domain: params.domain,
      return_passkey_credential_options: true,
      use_base64_url_encoding: true,
    });
  }

  webauthnRegister(params: {
    user_id: string;
    public_key_credential: string;
    session_duration_minutes: number;
  }) {
    return this.request<{
      user_id: string;
      session_token?: string;
      session_jwt?: string;
    }>("/v1/webauthn/register", params);
  }

  webauthnAuthenticateStart(params: {
    domain: string;
    user_id?: string;
  }) {
    return this.request<{
      user_id: string;
      public_key_credential_request_options: string;
    }>("/v1/webauthn/authenticate/start", {
      domain: params.domain,
      user_id: params.user_id,
      return_passkey_credential_options: true,
      use_base64_url_encoding: true,
    });
  }

  webauthnAuthenticate(params: {
    public_key_credential: string;
    session_duration_minutes: number;
  }) {
    return this.request<{
      user_id: string;
      session_token?: string;
      session_jwt?: string;
    }>("/v1/webauthn/authenticate", params);
  }

  sessionsAuthenticate(session_token: string) {
    return this.request<{
      user_id: string;
      session?: { session_id: string; user_id: string };
      session_token: string;
      session_jwt: string;
    }>("/v1/sessions/authenticate", {
      session_token,
    });
  }

  sessionsRevoke(session_token: string) {
    return this.request<{ status_code: number }>("/v1/sessions/revoke", {
      session_token,
    });
  }

  usersGet(user_id: string) {
    return this.requestGet<{
      user_id: string;
      emails?: Array<{ email: string; primary?: boolean }>;
    }>(`/v1/users/${encodeURIComponent(user_id)}`);
  }

  /** Test-env helper: OTP login_or_create (code returned in test responses). */
  otpsEmailLoginOrCreate(email: string) {
    return this.request<{
      email_id: string;
      method_id?: string;
      status_code: number;
    }>("/v1/otps/email/login_or_create", { email });
  }

  otpsAuthenticate(params: {
    method_id: string;
    code: string;
    session_duration_minutes: number;
  }) {
    return this.request<{
      user_id: string;
      session_token?: string;
      session_jwt?: string;
    }>("/v1/otps/authenticate", params);
  }

  private async requestGet<T>(path: string): Promise<T> {
    const res = await fetch(`${baseUrl(this.envName)}${path}`, {
      method: "GET",
      headers: {
        Authorization: this.authHeader(),
        "Content-Type": "application/json",
      },
    });
    const json = (await res.json()) as StytchErrorBody & T;
    if (!res.ok) {
      throw new StytchApiError(res.status, json);
    }
    return json;
  }
}

export function stytchFromEnv(env: {
  STYTCH_PROJECT_ID?: string;
  STYTCH_SECRET?: string;
  STYTCH_ENV?: string;
}): StytchClient {
  const projectId = env.STYTCH_PROJECT_ID?.trim();
  const secret = env.STYTCH_SECRET?.trim();
  if (!projectId || !secret) {
    throw new Error(
      "Missing STYTCH_PROJECT_ID or STYTCH_SECRET (set via wrangler secret put / .dev.vars)",
    );
  }
  const envName =
    env.STYTCH_ENV === "live" || env.STYTCH_ENV === "test"
      ? env.STYTCH_ENV
      : undefined;
  return new StytchClient({ projectId, secret, envName });
}
