/** Stytch remains the issuer. Validate online on every call, then map to an
 * existing Prims account and explicitly assigned agent; never provision grants. */
import { AccountStore } from './accounts';
import { AgentStore } from './agents';

export interface OAuthTokenEnv {
  DB: D1Database;
  CONNECTED_APPS_ENABLED?: string;
  OAUTH_ISSUER?: string;
  OAUTH_INTROSPECTION_ENDPOINT?: string;
  OAUTH_CLIENT_ID?: string;
  OAUTH_CLIENT_SECRET?: string;
  // Operator assignments: [{stytch_user_id, client_id, agent_id}]. No tokens.
  OAUTH_AGENT_BINDINGS?: string;
}
const RESOURCE = 'https://drive.prims.sh';
const reply = (body: unknown, status: number) => Response.json(body, {
  status, headers: {'Cache-Control':'no-store'},
});
const inactive = () => reply({active:false},401);
function https(value: string | undefined): URL {
  const u = new URL(value ?? '');
  if(u.protocol !== 'https:' || u.username || u.password || u.hash || u.search) throw new Error();
  return u;
}
async function readToken(request: Request): Promise<string | null> {
  if(request.headers.get('content-type')?.split(';')[0] !== 'application/json') return null;
  const reader=request.body?.getReader(); if(!reader) return null;
  const chunks: Uint8Array[]=[]; let size=0;
  while(true) {
    const {done,value}=await reader.read(); if(done) break;
    size+=value.length; if(size>20000) {await reader.cancel();return null;}
    chunks.push(value);
  }
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const body=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));
  return typeof body?.token==='string' && /^[A-Za-z0-9._~+/-]{1,16384}={0,2}$/.test(body.token)
    ? body.token : null;
}
export async function introspectOAuth(request: Request, env: OAuthTokenEnv): Promise<Response> {
  if(env.CONNECTED_APPS_ENABLED!=='true') return reply({error:'oauth_not_ready'},503);
  let issuer: URL, endpoint: URL, bindings: Array<{stytch_user_id:string;client_id:string;agent_id:string}>;
  try {
    issuer=https(env.OAUTH_ISSUER); endpoint=https(env.OAUTH_INTROSPECTION_ENDPOINT);
    if(endpoint.origin!==issuer.origin || !env.OAUTH_CLIENT_ID) throw new Error();
    bindings=JSON.parse(env.OAUTH_AGENT_BINDINGS ?? '[]');
    if(!Array.isArray(bindings) || bindings.some(b=>!b ||
      ['stytch_user_id','client_id','agent_id'].some(k=>typeof (b as any)[k]!=='string' || !(b as any)[k]))) throw new Error();
  } catch { return reply({error:'oauth_configuration_unavailable'},503); }
  let token: string | null;
  try { token=await readToken(request); } catch { return inactive(); }
  if(!token) return inactive();
  try {
    const form=new URLSearchParams({token,client_id:env.OAUTH_CLIENT_ID!,token_type_hint:'access_token'});
    if(env.OAUTH_CLIENT_SECRET) form.set('client_secret',env.OAUTH_CLIENT_SECRET);
    const response=await fetch(endpoint.href, {method:'POST',body:form,
      headers:{'Content-Type':'application/x-www-form-urlencoded'},redirect:'manual',signal:AbortSignal.timeout(4000)});
    // Misconfiguration, provider errors and redirects are unavailable, not valid credentials.
    if(response.status!==200) return reply({error:'oauth_provider_unavailable'},503);
    const claims=await response.json() as Record<string,unknown>;
    const now=Math.floor(Date.now()/1000);
    if(claims.active!==true || claims.iss!==env.OAUTH_ISSUER || claims.client_id!==env.OAUTH_CLIENT_ID
      || claims.token_type!=='access_token' || typeof claims.sub!=='string' || !claims.sub
      || typeof claims.exp!=='number' || !Number.isFinite(claims.exp) || claims.exp<=now
      || (claims.nbf!==undefined && (typeof claims.nbf!=='number' || !Number.isFinite(claims.nbf) || claims.nbf>now))
      || !(claims.aud===RESOURCE || (Array.isArray(claims.aud) && claims.aud.every(a=>typeof a==='string') && claims.aud.includes(RESOURCE)))
      || typeof claims.scope!=='string' || !claims.scope.split(' ').some(s=>s==='primsdrive.read'||s==='primsdrive.write')) return inactive();
    const matches=bindings.filter(b=>b.stytch_user_id===claims.sub && b.client_id===claims.client_id);
    if(matches.length!==1) return inactive();
    const account=await new AccountStore(env.DB).getByStytchUserId(claims.sub);
    const agent=await new AgentStore(env.DB).get(matches[0].agent_id);
    if(!account || !agent || agent.account_id!==account.account_id) return inactive();
    return reply({active:true,account_id:account.account_id,agent_id:agent.agent_id,
      resource:RESOURCE,scope:claims.scope,expires_at:new Date(claims.exp*1000).toISOString()},200);
  } catch { return reply({error:'oauth_provider_unavailable'},503); }
}
