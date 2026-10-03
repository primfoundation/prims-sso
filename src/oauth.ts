/** Human consent adapter for the existing Stytch project, not a token issuer. */
import { DEFAULT_SESSION_COOKIE, parseCookies } from './session';
import { StytchApiError, stytchFromEnv, type StytchClient } from './stytch';
import type { AuthEnv } from './auth';

export interface OAuthEnv extends AuthEnv { CONNECTED_APPS_ENABLED?: string }
const ORIGIN = 'https://login.prims.sh';
const RESOURCE = 'https://drive.prims.sh';
const COOKIE = '__Host-prims_oauth';
const SCOPES = new Set(['openid', 'profile', 'email', 'offline_access', 'primsdrive.read', 'primsdrive.write']);
const HEADERS = {
  'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
};
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const failure = (error: string, status: number) => new Response(JSON.stringify({error}), {
  status, headers: {...HEADERS, 'Content-Type':'application/json'},
});
function params(query: string) {
  if (query.length > 8192) throw new Error('invalid_request');
  const p = new URLSearchParams(query);
  const allowed = ['client_id','redirect_uri','response_type','scope','state','nonce','code_challenge','code_challenge_method','resource','prompt'];
  for (const k of p.keys()) if (!allowed.includes(k) || p.getAll(k).length !== 1) throw new Error('invalid_request');
  const client_id = p.get('client_id') ?? '';
  const redirect_uri = p.get('redirect_uri') ?? '';
  const redirect = new URL(redirect_uri);
  if (!client_id || client_id.length > 2048 || redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.hash)
    throw new Error('invalid_request');
  if (['code','error','state','iss'].some(k => redirect.searchParams.has(k))) throw new Error('invalid_request');
  if (p.get('response_type') !== 'code' || p.get('code_challenge_method') !== 'S256'
    || !/^[A-Za-z0-9_-]{43}$/.test(p.get('code_challenge') ?? '')) throw new Error('invalid_pkce');
  if (p.get('resource') !== RESOURCE) throw new Error('invalid_resource');
  const scopes = (p.get('scope') ?? '').split(' ').filter(Boolean);
  if (!scopes.length || scopes.some(s => !SCOPES.has(s))
    || !scopes.some(s => s === 'primsdrive.read' || s === 'primsdrive.write')) throw new Error('invalid_scope');
  if (p.has('prompt') && p.get('prompt') !== 'consent') throw new Error('invalid_prompt');
  return {p, start:{client_id,redirect_uri,response_type:'code',scopes,prompt:p.get('prompt') ?? undefined}};
}

/** Only this local route can be resumed after passkey login. */
export function loginContinuation(value: string | null): string {
  if (!value || value.length > 9000) return '/session';
  try {
    const u = new URL(value, ORIGIN);
    if (!value.startsWith('/oauth/authorize?') || u.origin !== ORIGIN || u.pathname !== '/oauth/authorize' || u.hash) return '/session';
    params(u.search);
    return u.pathname + u.search;
  } catch { return '/session'; }
}

async function mac(token: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('prims-oauth-consent\n'+message))), b=>b.toString(16).padStart(2,'0')).join('');
}
function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i=0;i<a.length;i++) diff |= a.charCodeAt(i)^b.charCodeAt(i);
  return diff === 0;
}
function consentCookie(value: string, age=600): string {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
}

export async function authorizePage(request: Request, env: OAuthEnv, client?: StytchClient): Promise<Response> {
  if (env.CONNECTED_APPS_ENABLED !== 'true') return failure('connected_apps_not_ready',503);
  const url = new URL(request.url);
  if (url.origin !== ORIGIN) return failure('origin_denied',403);
  if (!['GET','POST'].includes(request.method)) return failure('method_not_allowed',405);
  try {
    let query = url.search.slice(1), csrf = '', decision = '';
    if (request.method === 'POST') {
      if (request.headers.get('Origin') !== ORIGIN) return failure('origin_denied',403);
      if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/x-www-form-urlencoded') return failure('form_required',415);
      const reader = request.body?.getReader();
      if (!reader) return failure('invalid_request',400);
      const chunks: Uint8Array[] = []; let length=0;
      while (true) {
        const {value,done}=await reader.read(); if(done) break;
        length+=value.length; if(length>16384) { await reader.cancel(); return failure('request_too_large',413); }
        chunks.push(value);
      }
      const bytes=new Uint8Array(length);let offset=0;
      for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length;}
      const form = new URLSearchParams(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));
      if (['query','csrf','decision'].some(k=>form.getAll(k).length!==1) || Array.from(form.keys()).some(k=>!['query','csrf','decision'].includes(k))) return failure('invalid_request',400);
      query=form.get('query')!;csrf=form.get('csrf')!;decision=form.get('decision')!;
      if (!['approve','deny'].includes(decision)) return failure('invalid_request',400);
    }
    const {p,start} = params(query);
    const cookies = parseCookies(request.headers.get('Cookie'));
    // This HTML surface never accepts an agent bearer as a human session.
    const session = cookies[env.SESSION_COOKIE || DEFAULT_SESSION_COOKIE];
    if (!session) {
      if (request.method === 'POST') return failure('session_required',401);
      const location='/login?return_to='+encodeURIComponent('/oauth/authorize?'+query);
      return new Response(null,{status:302,headers:{...HEADERS,Location:location}});
    }
    const stytch=client ?? stytchFromEnv(env);
    if (request.method === 'POST') {
      const [nonce,stamp,tag,...extra] = csrf.split('.');
      const age=Date.now()-Number(stamp);
      if (extra.length || !/^[a-f0-9]{32}$/.test(nonce??'') || !/^\d{13}$/.test(stamp??'') || !/^[a-f0-9]{64}$/.test(tag??'')
        || age<0 || age>600000 || !equal(csrf,cookies[COOKIE]??'')
        || !equal(tag,await mac(session,nonce+'.'+stamp+'\n'+query))) return failure('invalid_consent',403);
    }
    // Provider validates registered redirect, client, scopes and live session.
    const checked=await stytch.oauthAuthorizeStart({...start,session_token:session});
    if (checked.client.client_id!==start.client_id || !Array.isArray(checked.scope_results)
      || start.scopes.some(s=>!checked.scope_results.some(r=>r.scope===s && r.is_grantable))) return failure('scope_denied',403);
    if (request.method === 'POST') {
      const result=await stytch.oauthAuthorize({...start,session_token:session,consent_granted:decision==='approve',
        code_challenge:p.get('code_challenge')!,resources:[RESOURCE],state:p.get('state')??undefined,nonce:p.get('nonce')??undefined});
      const dest=new URL(result.redirect_uri), expected=new URL(start.redirect_uri);
      if (dest.origin!==expected.origin || dest.pathname!==expected.pathname || dest.username || dest.password || dest.hash
        || Array.from(expected.searchParams).some(([k,v])=>dest.searchParams.get(k)!==v)) return failure('invalid_provider_redirect',502);
      return new Response(null,{status:303,headers:{...HEADERS,Location:dest.href,'Set-Cookie':consentCookie('',0)}});
    }
    const nonce=crypto.randomUUID().replaceAll('-',''),stamp=String(Date.now());
    csrf=nonce+'.'+stamp+'.'+await mac(session,nonce+'.'+stamp+'\n'+query);
    const body=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect PrimsDrive</title><link rel="stylesheet" href="/kit.css"><main><h1>Connect PrimsDrive</h1><p>Allow <strong>${escape(checked.client.client_name)}</strong> to access PrimsDrive with your Prims account?</p><p>Return address: <code>${escape(start.redirect_uri)}</code></p><ul>${start.scopes.map(s=>`<li>${escape(s)}</li>`).join('')}</ul><p>Access is limited to profiles assigned to your account. You can revoke this connection.</p><form method="post" action="/oauth/authorize"><input type="hidden" name="query" value="${escape(query)}"><input type="hidden" name="csrf" value="${csrf}"><button name="decision" value="approve">Allow access</button><button name="decision" value="deny">Cancel</button></form></main></html>`;
    return new Response(body,{headers:{...HEADERS,'Content-Type':'text/html; charset=utf-8','Set-Cookie':consentCookie(csrf)}});
  } catch(e) {
    if(e instanceof StytchApiError) return failure('provider_rejected_request',e.status>=500?502:400);
    return failure('invalid_or_unavailable_authorization',400);
  }
}
