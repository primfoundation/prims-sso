import assert from 'node:assert/strict';
import { test } from 'node:test';
import { introspectOAuth, type OAuthTokenEnv } from '../src/oauth_tokens';
const request=(token='provider.jwt.token')=>new Request('https://login.prims.sh/v1/oauth/introspect',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token}),
});
function setup() {
  const state={account:true,agentAccount:'account',calls:0,reads:0,status:200};
  const claims:Record<string,unknown>={active:true,iss:'https://issuer.example',client_id:'client',
    token_type:'access_token',sub:'user',exp:Math.floor(Date.now()/1000)+300,
    aud:['https://drive.prims.sh'],scope:'primsdrive.read primsdrive.write'};
  const env:OAuthTokenEnv={CONNECTED_APPS_ENABLED:'true',OAUTH_ISSUER:'https://issuer.example',
    OAUTH_INTROSPECTION_ENDPOINT:'https://issuer.example/v1/oauth2/introspect',OAUTH_CLIENT_ID:'client',
    OAUTH_AGENT_BINDINGS:JSON.stringify([{stytch_user_id:'user',client_id:'client',agent_id:'agent'}]),
    DB:{prepare:(sql:string)=>({bind:(id:string)=>({first:async()=>{
      state.reads++;
      if(sql.includes('FROM accounts')) {assert.equal(id,'user');return state.account?{account_id:'account'}:null;}
      assert.equal(id,'agent');return {agent_id:'agent',account_id:state.agentAccount};
    }})})} as any};
  const fetcher=async(input:unknown,init?:RequestInit)=>{
    state.calls++;assert.equal(input,env.OAUTH_INTROSPECTION_ENDPOINT);
    assert.equal(init?.redirect,'manual');assert.ok(init?.signal);
    const body=init!.body as URLSearchParams;
    assert.equal(body.get('token'),'provider.jwt.token');assert.equal(body.get('client_id'),'client');
    assert.equal(body.get('token_type_hint'),'access_token');
    assert.equal(new Headers(init?.headers).get('authorization'),null);
    return Response.json(claims,{status:state.status});
  };
  return {state,claims,env,fetcher};
}
test('OAuth uses online validation every time; revoked token fails on the next call',async t=>{
  const {state,claims,env,fetcher}=setup();t.mock.method(globalThis,'fetch',fetcher);
  const good=await introspectOAuth(request(),env);assert.equal(good.status,200);
  assert.equal(good.headers.get('cache-control'),'no-store');
  assert.deepEqual(await good.json(),{active:true,account_id:'account',agent_id:'agent',
    resource:'https://drive.prims.sh',scope:claims.scope,expires_at:new Date(Number(claims.exp)*1000).toISOString()});
  claims.active=false;assert.equal((await introspectOAuth(request(),env)).status,401);assert.equal(state.calls,2);
});
test('rejects wrong issuer, client, token kind, subject, audience, scope and temporal claims',async t=>{
  const {claims,env,fetcher,state}=setup();t.mock.method(globalThis,'fetch',fetcher);
  for(const [key,value] of [ ['iss','https://other.example'],['client_id','other'],['token_type','refresh_token'],
    ['sub',''],['sub','unassigned'],['aud',['project-test-id']],['aud','https://drive.prims.sh.evil'],
    ['scope','openid'],['exp',0],['exp','9999999999'],['nbf',9999999999] ] as const) {
    const original=claims[key];claims[key]=value;
    assert.equal((await introspectOAuth(request(),env)).status,401,key);claims[key]=original;
  }
  assert.equal(state.reads,0);
});
test('no account creation or cross-account assignment; ambiguous bindings fail closed',async t=>{
  const {env,fetcher,state}=setup();t.mock.method(globalThis,'fetch',fetcher);
  state.account=false;assert.equal((await introspectOAuth(request(),env)).status,401);
  state.account=true;state.agentAccount='other';assert.equal((await introspectOAuth(request(),env)).status,401);
  state.agentAccount='account';
  for(const binding of ['[]',JSON.stringify([...JSON.parse(env.OAUTH_AGENT_BINDINGS!),...JSON.parse(env.OAUTH_AGENT_BINDINGS!)])]) {
    assert.equal((await introspectOAuth(request(),{...env,OAUTH_AGENT_BINDINGS:binding})).status,401);
  }
});
test('disabled, invalid configuration, malformed credentials and provider outage never authorize',async t=>{
  const {env,fetcher,state}=setup();t.mock.method(globalThis,'fetch',fetcher);
  for(const override of [{CONNECTED_APPS_ENABLED:undefined},{OAUTH_ISSUER:'http://issuer.example'},
    {OAUTH_INTROSPECTION_ENDPOINT:'https://evil.example/introspect'},{OAUTH_AGENT_BINDINGS:'null'},
    {OAUTH_CLIENT_ID:''}]) assert.equal((await introspectOAuth(request(),{...env,...override})).status,503);
  assert.equal((await introspectOAuth(request('a'.repeat(21000)),env)).status,401);
  assert.equal((await introspectOAuth(request('bad token'),env)).status,401);assert.equal(state.calls,0);
  for(const status of [302,400,401,429,500]) {state.status=status;assert.equal((await introspectOAuth(request(),env)).status,503);}
});
