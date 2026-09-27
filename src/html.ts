/** Login / register HTML for login.prims.sh (brand kit from /public). */

export type PageMode = "login" | "register" | "signed-in";

export function renderPage(opts: {
  mode: PageMode;
  rpId: string;
  email?: string;
  userId?: string;
  error?: string;
}): string {
  const { mode, rpId, email, userId, error } = opts;
  const title =
    mode === "register"
      ? "Prims · Create passkey"
      : mode === "signed-in"
        ? "Prims · Signed in"
        : "Prims · Sign in";

  const lede =
    mode === "register"
      ? "Create a Prims account with a passkey. Email is only an identifier — the passkey is the door."
      : mode === "signed-in"
        ? "You are signed in to your Prims account."
        : "Sign in with a passkey. One Prims account for drive, browsers, and foundation surfaces.";

  const body =
    mode === "signed-in"
      ? signedInBody(email, userId)
      : authFormBody(mode, error);

  return `<!doctype html>
<html lang="en" data-palette="paper">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/kit.css">
<style>
  main { min-height: 100vh; display: grid; place-items: center; padding: 2rem 1.25rem;
    background:
      radial-gradient(1200px 600px at 10% -10%, color-mix(in srgb, var(--accent) 28%, transparent), transparent 55%),
      radial-gradient(900px 500px at 110% 10%, color-mix(in srgb, var(--ink) 6%, transparent), transparent 50%),
      var(--bg);
  }
  .shell { width: min(26rem, 100%); }
  .mark { display:flex; align-items:center; gap:0.85rem; margin-bottom: 1.5rem; }
  .mark img { width: 44px; height: 44px; }
  .brand { font-size: 1.75rem; font-weight: 650; letter-spacing: -0.03em; line-height: 1.1; }
  .lede { margin: 0 0 1.5rem; color: var(--ink-soft); font-size: 1rem; line-height: 1.5; }
  label { display:block; font-size: 0.8rem; color: var(--ink-soft); margin-bottom: 0.35rem; }
  input[type="email"] {
    width: 100%; padding: 0.7rem 0.85rem; margin-bottom: 1rem;
    border: 1px solid var(--line); border-radius: var(--radius);
    background: var(--raised); color: var(--ink); font: 500 0.95rem var(--sans);
  }
  .actions { display: flex; flex-direction: column; gap: 0.65rem; }
  button.primary, a.primary {
    display: inline-flex; align-items: center; justify-content: center;
    width: 100%; padding: 0.75rem 1rem;
    background: var(--ink); color: var(--bg); text-decoration: none;
    border: 1px solid var(--ink); border-radius: var(--radius);
    font: 600 0.95rem var(--sans); cursor: pointer;
  }
  button.primary:disabled { opacity: 0.45; cursor: not-allowed; }
  button.primary:not(:disabled):hover, a.primary:hover { filter: brightness(1.08); }
  button.ghost, a.ghost {
    display: inline-flex; align-items: center; justify-content: center;
    width: 100%; padding: 0.65rem 1rem;
    background: transparent; color: var(--ink); text-decoration: none;
    border: 1px solid var(--line); border-radius: var(--radius);
    font: 500 0.9rem var(--sans); cursor: pointer;
  }
  .err { margin: 0 0 1rem; padding: 0.65rem 0.75rem; background: var(--surface);
    border: 1px solid var(--line); color: var(--ink); font-size: 0.85rem; }
  .status { margin: 1rem 0 0; min-height: 1.25rem; font-size: 0.85rem; color: var(--ink-soft); }
  .meta { margin-top: 1.75rem; font-size: 0.75rem; color: var(--subtle); line-height: 1.4; }
  .meta code { font-family: var(--mono); font-size: 0.72rem; }
</style>
<main>
  <div class="shell">
    <div class="mark">
      <img src="/folio.svg" alt="">
      <div class="brand">Prims</div>
    </div>
    <p class="lede">${escapeHtml(lede)}</p>
    ${body}
    <p class="meta">Passkeys via Stytch · RP ID <code>${escapeHtml(rpId)}</code> · façade on Workers</p>
  </div>
</main>
${mode === "signed-in" ? "" : clientScript()}
</html>`;
}

function authFormBody(mode: PageMode, error?: string): string {
  const isRegister = mode === "register";
  const err = error
    ? `<p class="err" role="alert">${escapeHtml(error)}</p>`
    : "";
  return `${err}
<form id="auth-form" class="actions" autocomplete="on">
  <div>
    <label for="email">Email ${isRegister ? "(required)" : "(optional for discoverable passkeys)"}</label>
    <input id="email" name="email" type="email" ${isRegister ? "required" : ""}
      placeholder="you@example.com" autocomplete="${isRegister ? "username webauthn" : "username webauthn"}">
  </div>
  <button type="submit" class="primary" id="primary-btn">
    ${isRegister ? "Create passkey" : "Sign in with passkey"}
  </button>
  ${
    isRegister
      ? `<a class="ghost" href="/">Already have a passkey? Sign in</a>`
      : `<a class="ghost" href="/register">New here? Create a passkey</a>`
  }
  <p class="status" id="status" aria-live="polite"></p>
</form>`;
}

function signedInBody(email?: string, userId?: string): string {
  return `<div class="actions">
  <p class="status" style="min-height:auto;margin:0 0 1rem;color:var(--ink)">
    ${email ? escapeHtml(email) : "Prims account"}
    ${userId ? `<br><code style="font-family:var(--mono);font-size:0.75rem;color:var(--subtle)">${escapeHtml(userId)}</code>` : ""}
  </p>
  <form method="post" action="/api/logout">
    <button type="submit" class="ghost">Sign out</button>
  </form>
  <a class="ghost" href="/register">Add another passkey</a>
</div>`;
}

function clientScript(): string {
  return `<script type="module">
const form = document.getElementById("auth-form");
const statusEl = document.getElementById("status");
const btn = document.getElementById("primary-btn");
const isRegister = location.pathname.startsWith("/register");

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? "var(--ink)" : "var(--ink-soft)";
}

function b64urlToBuffer(value) {
  const pad = "=".repeat((4 - (value.length % 4)) % 4);
  const b64 = (value + pad).replace(/-/g, "+").replace(/_/g, "/");
  const str = atob(b64);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes.buffer;
}

function bufferToB64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/g, "");
}

function parseCreationOptions(jsonStr) {
  const opts = typeof jsonStr === "string" ? JSON.parse(jsonStr) : jsonStr;
  const publicKey = opts.publicKey ?? opts;
  publicKey.challenge = b64urlToBuffer(publicKey.challenge);
  if (publicKey.user?.id) {
    publicKey.user.id = typeof publicKey.user.id === "string"
      ? b64urlToBuffer(publicKey.user.id)
      : publicKey.user.id;
  }
  if (Array.isArray(publicKey.excludeCredentials)) {
    publicKey.excludeCredentials = publicKey.excludeCredentials.map((c) => ({
      ...c,
      id: typeof c.id === "string" ? b64urlToBuffer(c.id) : c.id,
    }));
  }
  return publicKey;
}

function parseRequestOptions(jsonStr) {
  const opts = typeof jsonStr === "string" ? JSON.parse(jsonStr) : jsonStr;
  const publicKey = opts.publicKey ?? opts;
  publicKey.challenge = b64urlToBuffer(publicKey.challenge);
  if (Array.isArray(publicKey.allowCredentials)) {
    publicKey.allowCredentials = publicKey.allowCredentials.map((c) => ({
      ...c,
      id: typeof c.id === "string" ? b64urlToBuffer(c.id) : c.id,
    }));
  }
  return publicKey;
}

function serializeAttestation(credential) {
  const response = credential.response;
  return JSON.stringify({
    id: credential.id,
    rawId: bufferToB64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToB64url(response.clientDataJSON),
      attestationObject: bufferToB64url(response.attestationObject),
    },
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
  });
}

function serializeAssertion(credential) {
  const response = credential.response;
  return JSON.stringify({
    id: credential.id,
    rawId: bufferToB64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToB64url(response.clientDataJSON),
      authenticatorData: bufferToB64url(response.authenticatorData),
      signature: bufferToB64url(response.signature),
      userHandle: response.userHandle ? bufferToB64url(response.userHandle) : null,
    },
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
  });
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || data.error_message || ("HTTP " + res.status);
    throw new Error(msg);
  }
  return data;
}

form?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!window.PublicKeyCredential) {
    setStatus("This browser does not support passkeys.", true);
    return;
  }
  const email = document.getElementById("email").value.trim();
  btn.disabled = true;
  try {
    if (isRegister) {
      if (!email) throw new Error("Email is required to register.");
      setStatus("Starting registration…");
      const start = await postJson("/api/passkey/register/start", { email });
      const publicKey = parseCreationOptions(start.public_key_credential_creation_options);
      setStatus("Touch your authenticator…");
      const cred = await navigator.credentials.create({ publicKey });
      if (!cred) throw new Error("Passkey creation was cancelled.");
      setStatus("Finishing registration…");
      await postJson("/api/passkey/register/finish", {
        user_id: start.user_id,
        public_key_credential: serializeAttestation(cred),
      });
      setStatus("Passkey created. Signed in.");
      location.href = "/session";
    } else {
      setStatus("Starting sign-in…");
      const start = await postJson("/api/passkey/login/start", email ? { email } : {});
      const publicKey = parseRequestOptions(start.public_key_credential_request_options);
      setStatus("Touch your authenticator…");
      const cred = await navigator.credentials.get({ publicKey });
      if (!cred) throw new Error("Passkey sign-in was cancelled.");
      setStatus("Finishing sign-in…");
      await postJson("/api/passkey/login/finish", {
        public_key_credential: serializeAssertion(cred),
      });
      setStatus("Signed in.");
      location.href = "/session";
    }
  } catch (err) {
    console.error(err);
    setStatus(err?.message || String(err), true);
  } finally {
    btn.disabled = false;
  }
});
</script>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
