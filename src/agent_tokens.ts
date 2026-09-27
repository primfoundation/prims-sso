/** Opaque agent bearer tokens: generate, hash, TTL bounds (Slice 2). */

/** Default and maximum lifetime. Documented in the README Agent API. */
export const DEFAULT_TOKEN_TTL_SECONDS = 3600;
export const MAX_TOKEN_TTL_SECONDS = 3600;
export const MIN_TOKEN_TTL_SECONDS = 1;

const TOKEN_PREFIX = "agt_";

export function generateAgentToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return `${TOKEN_PREFIX}${encoded}`;
}

/** SHA-256 hex. Only this digest is written to D1. */
export async function hashAgentToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Missing ttl → 3600. Otherwise an integer in [1, 3600].
 * Returns an error string when the caller must reject the request.
 */
export function resolveTtlSeconds(input: unknown): number | string {
  if (input === undefined) return DEFAULT_TOKEN_TTL_SECONDS;
  if (typeof input !== "number" || !Number.isInteger(input)) {
    return "ttl_seconds must be an integer number of seconds";
  }
  if (input < MIN_TOKEN_TTL_SECONDS || input > MAX_TOKEN_TTL_SECONDS) {
    return `ttl_seconds must be between ${MIN_TOKEN_TTL_SECONDS} and ${MAX_TOKEN_TTL_SECONDS}`;
  }
  return input;
}

export function normalizeDisplayName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input.trim();
  if (!name || name.length > 128) return null;
  return name;
}
