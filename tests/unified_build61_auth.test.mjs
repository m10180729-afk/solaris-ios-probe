import {test} from 'node:test';
import assert from 'node:assert/strict';
import {API} from '../shared/api.mjs';
import {AuthFlow,authURLAllowed,authReturnAllowed} from '../shared/authflow.mjs';
const project='https://fixture.supabase.co';
const session=id=>({user:{id},access_token:'fixture-access',refresh_token:'fixture-refresh',expires_at:Date.now()/1000+3600});
function fixture(){
 const values=new Map(),calls=[];
 const bridge={native:true,async call(command,args={}){calls.push({command,args});if(command==='platform')return{platform:'windows'};if(command==='vaultGet')return values.get(args.key);if(command==='vaultSet')values.set(args.key,args.value);return true;}};
 const api=new API({url:project,key:'sb_publishable_fixture'},bridge,{});
 return{api,values,calls};
}
const callback=f=>f.base+'?solaris_state='+f.state+'&code=fixture-code';
test('PKCE uses a per-request verifier, S256 and exact desktop callback',async()=>{
 const{api,calls}=fixture();const first=await api.authFlow.prepare('google'),next=await api.authFlow.prepare('google');
 assert.notEqual(first.pending.verifier,next.pending.verifier);assert.notEqual(first.pending.state,next.pending.state);
 const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(next.pending.verifier))).toString('base64url');
 assert.equal(next.challenge,digest);assert.equal(next.pending.base,'http://127.0.0.1:43854/auth/callback');
 assert(calls.some(c=>c.command==='authListen'));assert(!next.redirectTo.includes(next.pending.verifier));
});
test('external browser and callback allowlists reject lookalikes and tokens in fragments',()=>{
 assert(authURLAllowed(project+'/auth/v1/authorize?provider=google',project));assert(authURLAllowed('https://accounts.google.com/o/oauth2/v2/auth',project));
 for(const u of ['https://accounts.google.com.evil.test/o/oauth2/auth','https://user@accounts.google.com/o/oauth2/auth','http://accounts.google.com/o/oauth2/auth',project+'/auth/v1/authorize?provider=github'])assert(!authURLAllowed(u,project));
 const base='solaris://auth/callback';assert(authReturnAllowed(base+'?code=x',base));for(const u of ['solaris://other/callback?code=x',base+'/extra?code=x',base+'#access_token=x','solaris://user@auth/callback?code=x'])assert(!authReturnAllowed(u,base));
});
test('expired or foreign-state callbacks never exchange a code',async()=>{
 const{api}=fixture();const{pending:f}=await api.authFlow.prepare('google');let calls=0;api.auth=async()=>{calls++;};
 await assert.rejects(api.authReturn(callback({...f,state:crypto.randomUUID()})),/다른/);f.expires=0;await assert.rejects(api.authReturn(callback(f)),/만료/);assert.equal(calls,0);
});
test('Google linking retains UID and verifies user at the authentication server',async()=>{
 const{api,values}=fixture();api.session=session('owner');let exchange;
 api.auth=async(path,body)=>{if(path.startsWith('user/identities/authorize'))return{url:'https://accounts.google.com/o/oauth2/v2/auth'};if(path.startsWith('token')){exchange=body;return session('owner');}return{id:'owner',identities:[{provider:'google'}]};};
 const f=await api.google(true);const result=await api.authReturn(callback(f));assert.equal(result.kind,'google-link');assert.equal(result.session.user.id,'owner');assert.equal(exchange.code_verifier,f.verifier);assert.equal(JSON.parse(values.get('session')).user.id,'owner');assert.equal(values.get('auth-flow'),'null');
});
test('a linked account or server user with a different UID is never persisted',async()=>{
 const{api,values}=fixture();api.session=session('owner');const{pending:f}=await api.authFlow.prepare('google-link');api.auth=async()=>session('other');await assert.rejects(api.authReturn(callback(f)),/UID/);assert.equal(api.session.user.id,'owner');assert.equal(values.has('session'),false);
 const second=fixture();const flow=await second.api.authFlow.prepare('google');second.api.auth=async path=>path==='user'?{id:'other'}:session('owner');await assert.rejects(second.api.authReturn(callback(flow.pending)),/확인/);assert.equal(second.values.has('session'),false);
});
test('signup resend reuses the original PKCE request',async()=>{
 const{api}=fixture();const{pending:f}=await api.authFlow.prepare('signup',{email:'a@example.test'});let request;api.auth=async(path,body,bearer,options)=>{request={path,body,options};return{};};
 await api.resendVerification(' a@example.test ','signup');assert.equal(request.path,'resend');assert.equal(new URL(request.options.redirectTo).searchParams.get('solaris_state'),f.state);assert.equal((await api.authFlow.read()).verifier,f.verifier);
});
test('cancellation during exchange prevents a late session from returning',async()=>{
 const{api,values}=fixture();const{pending:f}=await api.authFlow.prepare('google');let release,started;const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);
 api.auth=async path=>{if(path.startsWith('token')){started();await gate;return session('owner');}return{id:'owner'};};
 const result=api.authReturn(callback(f));await ready;await api.authFlow.cancel();release();await assert.rejects(result,/취소/);assert.equal(values.has('session'),false);assert.equal(api.session,null);
});
test('a cold restart restores the verifier from the protected vault',async()=>{
 const{api}=fixture();const{pending:f}=await api.authFlow.prepare('google');const flow=new AuthFlow(api);assert.deepEqual(await flow.read(),f);api.authFlow=flow;api.auth=async path=>path==='user'?{id:'owner'}:session('owner');await api.authReturn(callback(f));assert.equal(api.session.user.id,'owner');
});
test('manual email verification cannot switch UID without returning session tokens',async()=>{
 const{api,values}=fixture();api.session=session('owner');api.auth=async()=>({user:{id:'other'}});await assert.rejects(api.verifyEmailLink('a@example.test','123456'),/UID/);assert.equal(api.session.user.id,'owner');assert.equal(values.has('session'),false);
});
