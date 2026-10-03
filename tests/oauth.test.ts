import assert from 'node:assert/strict';
import {test} from 'node:test';
import {authorizePage,loginContinuation} from '../src/oauth';
import {StytchClient} from '../src/stytch';
import {renderPage} from '../src/html';
const origin='https://login.prims.sh';
const env={CONNECTED_APPS_ENABLED:'true'};
const query=new URLSearchParams({client_id:'registered-client',redirect_uri:'https://chatgpt.com/connector_platform_oauth_redirect',
  response_type:'code',scope:'primsdrive.read',resource:'https://drive.prims.sh',code_challenge:'a'.repeat(43),code_challenge_method:'S256',state:'client-state'}).toString();
function fixture() {
  const calls:Array<{kind:string;body:any}>=[];
  const client={
    oauthAuthorizeStart:async(body:any)=>{
      calls.push({kind:'start',body});
      return {user_id:'existing-user',client:{client_id:body.client_id,client_name:'<script>bad</script>'},scope_results:body.scopes.map((scope:string)=>({scope,is_grantable:true}))};
    },
    oauthAuthorize:async(body:any)=>{
      calls.push({kind:'submit',body});
      return {redirect_uri:body.redirect_uri+'?'+new URLSearchParams(body.consent_granted?{code:'provider-code',state:body.state}:{error:'access_denied',state:body.state})};
    },
  } as unknown as StytchClient;
  return {client,calls};
}
const get=(q=query,cookie='prims_session=human-session')=>new Request(origin+'/oauth/authorize?'+q,{headers:{Cookie:cookie}});
async function page(client:StytchClient) {
  const res=await authorizePage(get(),env,client);
  assert.equal(res.status,200);
  const html=await res.text();
  const csrf=/name="csrf" value="([^"]+)"/.exec(html)![1];
  return {html,csrf,cookie:'prims_session=human-session; '+res.headers.get('set-cookie')!.split(';')[0]};
}
function post(csrf:string,cookie:string,q=query,decision='approve',from=origin) {
  return new Request(origin+'/oauth/authorize',{method:'POST',headers:{Origin:from,Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf,query:q,decision})});
}
test('disabled adapter and bearer-only requests never issue a code',async()=>{
  const {client,calls}=fixture();
  assert.equal((await authorizePage(get(),{},client)).status,503);
  const res=await authorizePage(new Request(origin+'/oauth/authorize?'+query,{headers:{Authorization:'Bearer human-session'}}),env,client);
  assert.equal(res.status,302);
  assert.equal(new URL(res.headers.get('location')!,origin).searchParams.get('return_to'),'/oauth/authorize?'+query);
  assert.equal(calls.length,0);
});
test('valid request renders escaped consent and sends session, PKCE and audience to provider only after approval',async()=>{
  const {client,calls}=fixture(); const p=await page(client);
  assert.ok(p.html.includes('&lt;script&gt;bad&lt;/script&gt;'));
  assert.ok(!p.html.includes('human-session'));
  assert.equal(calls.length,1);
  const res=await authorizePage(post(p.csrf,p.cookie),env,client);
  assert.equal(res.status,303);
  assert.equal(new URL(res.headers.get('location')!).searchParams.get('code'),'provider-code');
  const submitted=calls.at(-1)!.body;
  assert.equal(submitted.session_token,'human-session');
  assert.equal(submitted.code_challenge,'a'.repeat(43));
  assert.deepEqual(submitted.resources,['https://drive.prims.sh']);
  assert.equal(submitted.consent_granted,true);
  assert.match(res.headers.get('set-cookie')!,/Max-Age=0/);
});
test('cancel is conveyed to provider and cannot mint approval',async()=>{
  const {client,calls}=fixture(); const p=await page(client);
  const res=await authorizePage(post(p.csrf,p.cookie,query,'deny'),env,client);
  assert.equal(res.status,303); assert.equal(calls.at(-1)!.body.consent_granted,false);
  assert.equal(new URL(res.headers.get('location')!).searchParams.get('error'),'access_denied');
});
test('CSRF, session changes, query tampering and cross-origin submission fail before provider access',async()=>{
  const {client,calls}=fixture(); const p=await page(client); const count=calls.length;
  for(const req of [post(p.csrf,p.cookie,query+'&nonce=changed'),post(p.csrf,p.cookie.replace('human-session','other-session')),
    post(p.csrf,'prims_session=human-session'),post(p.csrf,p.cookie,query,'approve','https://evil.example'),post(p.csrf+'0',p.cookie)]) {
    assert.equal((await authorizePage(req,env,client)).status,403);
  }
  assert.equal(calls.length,count);
});
test('invalid audience, weak PKCE, duplicate parameters, insecure callbacks and unsupported scope fail closed',async()=>{
  const {client,calls}=fixture();
  for(const q of [query+'&client_id=other',query.replace('S256','plain'),query.replace('drive.prims.sh','evil.example'),
    query.replace('https%3A%2F%2Fchatgpt','http%3A%2F%2Fchatgpt'),query.replace('primsdrive.read','admin')]) {
    assert.equal((await authorizePage(get(q),env,client)).status,400);
  }
  assert.equal(calls.length,0);
});
test('ungrantable scopes and unexpected provider callback fail closed',async()=>{
  const {client}=fixture(); const p=await page(client);
  client.oauthAuthorize=async()=>({redirect_uri:'https://evil.example/?code=provider-code'});
  assert.equal((await authorizePage(post(p.csrf,p.cookie),env,client)).status,502);
  client.oauthAuthorizeStart=async()=>({user_id:'u',client:{client_id:'registered-client',client_name:'app'},scope_results:[]});
  assert.equal((await authorizePage(get(),env,client)).status,403);
});
test('passkey continuation only permits a valid local authorize route and escapes script data',()=>{
  const path='/oauth/authorize?'+query;
  assert.equal(loginContinuation(path),path);
  for(const value of ['https://evil.example','//evil.example','/api/logout',path+'#fragment',null]) assert.equal(loginContinuation(value),'/session');
  const html=renderPage({mode:'login',rpId:'prims.sh',returnTo:path});
  assert.match(html,/location.href = returnTo/);
  assert.ok(!renderPage({mode:'login',rpId:'prims.sh',returnTo:'</script>'}).includes('const returnTo = "</script>"'));
});
