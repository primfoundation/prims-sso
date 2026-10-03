/** Stytch remains the issuer. Validate online on every call, then map to an
 * existing Prims account and explicitly assigned agent; never provision grants.
 * ChatGPT and Grok are separate Connected App clients of that same project.
 */
import { AccountStore } from "./accounts";
import { AgentStore } from "./agents";

export interface OAuthTokenEnv {
  DB: D1Database;
  CONNECTED_APPS_ENABLED?: string;
  OAUTH_ISSUER?: string;
  OAUTH_INTROSPECTION_ENDPOINT?: string;
  /** When set, only this Connected App client may pass. Omit for ChatGPT and Grok together. */
  OAUTH_CLIENT_ID?: string;
  OAUTH_CLIENT_SECRET?: string;
  /** Optional `{client_id: secret}` for confidential clients. Public CIMD clients stay absent. */
  OAUTH_CLIENT_SECRETS?: string;
  // Operator assignments: [{stytch_user_id, client_id, agent_id}]. No tokens.
  OAUTH_AGENT_BINDINGS?: string;
}

interface Binding {
  stytch_user_id: string;
  client_id: string;
  agent_id: string;
}

interface ProviderConfig {
  endpoint: URL;
  bindings: Binding[];
  secrets: Record<string, string>;
}

const RESOURCE = "https://drive.prims.sh";

const reply = (body: unknown, status: number) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});
const inactive = () => reply({ active: false }, 401);

function https(value: string | undefined): URL {
  const u = new URL(value ?? "");
  if (u.protocol !== "https:" || u.username || u.password || u.hash || u.search) {
    throw new Error("https");
  }
  return u;
}

function parseBindings(raw: string | undefined): Binding[] {
  const bindings = JSON.parse(raw ?? "[]") as unknown;
  if (!Array.isArray(bindings)) throw new Error("bindings");
  for (const row of bindings) {
    if (!row || typeof row !== "object") throw new Error("bindings");
    const binding = row as Binding;
    for (const key of ["stytch_user_id", "client_id", "agent_id"] as const) {
      if (typeof binding[key] !== "string" || !binding[key]) throw new Error("bindings");
    }
  }
  return bindings as Binding[];
}

function parseSecrets(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("secrets");
  const secrets: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string" || !value) throw new Error("secrets");
    secrets[key] = value;
  }
  return secrets;
}

function loadConfig(env: OAuthTokenEnv): ProviderConfig {
  if (env.OAUTH_CLIENT_ID !== undefined && !env.OAUTH_CLIENT_ID) throw new Error("client");
  const issuer = https(env.OAUTH_ISSUER);
  const endpoint = https(env.OAUTH_INTROSPECTION_ENDPOINT);
  if (endpoint.origin !== issuer.origin) throw new Error("origin");
  return {
    endpoint,
    bindings: parseBindings(env.OAUTH_AGENT_BINDINGS),
    secrets: parseSecrets(env.OAUTH_CLIENT_SECRETS),
  };
}

function decodeB64Url(segment: string): Uint8Array {
  const pad = segment.length % 4 === 0 ? "" : "=".repeat(4 - (segment.length % 4));
  const binary = atob(segment.replaceAll("-", "+").replaceAll("_", "/") + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Unverified routing hint. Stytch's introspection response is the authority. */
export function clientIdFromAccessToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part || part.length > 12000)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(decodeB64Url(parts[1]))) as {
      client_id?: unknown;
    };
    const id = payload.client_id;
    if (typeof id !== "string" || !id || id.length > 2048 || /[\s\u0000-\u001f]/.test(id)) return null;
    return id;
  } catch {
    return null;
  }
}

function secretFor(
  env: OAuthTokenEnv,
  clientId: string,
  secrets: Record<string, string>,
): string | undefined {
  if (env.OAUTH_CLIENT_ID === clientId && env.OAUTH_CLIENT_SECRET) return env.OAUTH_CLIENT_SECRET;
  return secrets[clientId];
}

function audienceAllowsDrive(aud: unknown): boolean {
  if (aud === RESOURCE) return true;
  return Array.isArray(aud)
    && aud.every((item) => typeof item === "string")
    && aud.includes(RESOURCE);
}

function claimsAccept(
  claims: Record<string, unknown>,
  issuer: string,
  clientId: string,
  now: number,
): boolean {
  if (claims.active !== true || claims.iss !== issuer || claims.client_id !== clientId) return false;
  if (claims.token_type !== "access_token" || typeof claims.sub !== "string" || !claims.sub) return false;
  if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= now) return false;
  if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || !Number.isFinite(claims.nbf) || claims.nbf > now)) {
    return false;
  }
  if (!audienceAllowsDrive(claims.aud) || typeof claims.scope !== "string") return false;
  return claims.scope.split(" ").some((scope) => scope === "primsdrive.read" || scope === "primsdrive.write");
}

async function readToken(request: Request): Promise<string | null> {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 20000) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const body = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  return typeof body?.token === "string" && /^[A-Za-z0-9._~+/-]{1,16384}={0,2}$/.test(body.token)
    ? body.token
    : null;
}

function presentedClient(env: OAuthTokenEnv, token: string, bindings: Binding[]): string | null {
  const clientId = clientIdFromAccessToken(token);
  if (!clientId || !bindings.some((binding) => binding.client_id === clientId)) return null;
  if (env.OAUTH_CLIENT_ID && clientId !== env.OAUTH_CLIENT_ID) return null;
  return clientId;
}

export async function introspectOAuth(request: Request, env: OAuthTokenEnv): Promise<Response> {
  if (env.CONNECTED_APPS_ENABLED !== "true") return reply({ error: "oauth_not_ready" }, 503);
  let config: ProviderConfig;
  try {
    config = loadConfig(env);
  } catch {
    return reply({ error: "oauth_configuration_unavailable" }, 503);
  }
  let token: string | null;
  try {
    token = await readToken(request);
  } catch {
    return inactive();
  }
  const clientId = token ? presentedClient(env, token, config.bindings) : null;
  if (!token || !clientId) return inactive();
  try {
    return await providerDecision(env, config, token, clientId);
  } catch {
    return reply({ error: "oauth_provider_unavailable" }, 503);
  }
}

async function providerDecision(
  env: OAuthTokenEnv,
  config: ProviderConfig,
  token: string,
  clientId: string,
): Promise<Response> {
  const form = new URLSearchParams({ token, client_id: clientId, token_type_hint: "access_token" });
  const secret = secretFor(env, clientId, config.secrets);
  if (secret) form.set("client_secret", secret);
  const response = await fetch(config.endpoint.href, {
    method: "POST",
    body: form,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    redirect: "manual",
    signal: AbortSignal.timeout(4000),
  });
  if (response.status !== 200) return reply({ error: "oauth_provider_unavailable" }, 503);
  const claims = await response.json() as Record<string, unknown>;
  const now = Math.floor(Date.now() / 1000);
  if (!claimsAccept(claims, env.OAUTH_ISSUER ?? "", clientId, now)) return inactive();
  const matches = config.bindings.filter((binding) =>
    binding.stytch_user_id === claims.sub && binding.client_id === claims.client_id);
  if (matches.length !== 1) return inactive();
  const account = await new AccountStore(env.DB).getByStytchUserId(String(claims.sub));
  const agent = await new AgentStore(env.DB).get(matches[0].agent_id);
  if (!account || !agent || agent.account_id !== account.account_id) return inactive();
  return reply({
    active: true,
    account_id: account.account_id,
    agent_id: agent.agent_id,
    resource: RESOURCE,
    scope: claims.scope,
    expires_at: new Date(Number(claims.exp) * 1000).toISOString(),
  }, 200);
}
