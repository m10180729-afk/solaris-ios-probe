import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {API} from '../shared/api.mjs';

// Execute the production app functions, with UI dependencies supplied by the
// fixture. The browser gate additionally exercises their actual DOM and bridge.
const app=await readFile(new URL('../shared/app.mjs',import.meta.url),'utf8');
const bootCode=app.slice(app.indexOf('async function boot(){'),app.indexOf('async function notify('));
const googleControlsCode=app.slice(app.indexOf('function refreshGoogleLogin(){'),app.indexOf('function conversationKey('));
const callbackCode=googleControlsCode+app.slice(app.indexOf('async function ackNativeAuthReturn('),app.indexOf("bridge.addEventListener('event',e=>"));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const session=()=>({user:{id:'returning-user',is_anonymous:false,email_confirmed_at:'2026-10-14',app_metadata:{provider:'google',providers:['google']},identities:[{provider:'google',identity_data:{sub:'fixture-returning-user',email_verified:true}}]},access_token:'fixture-access',refresh_token:'fixture-refresh',expires_at:Date.now()/1000+3600});
function fixture(){
 const vault=new Map([['session','null']]),calls=[];
 const bridge={native:true,async call(command,args={}){
  calls.push({command,key:args.key,url:args.url});
  if(command==='platform')return{platform:'ios'};
  if(command==='vaultGet')return vault.get(args.key)??null;
  if(command==='vaultSet'){vault.set(args.key,args.value);return true;}
  return true;
 }};
 const api=new API({url:'https://fixture.supabase.co',key:'sb_publishable_fixture'},bridge,{});
 return{api,vault,calls};
}
function bootFixture(api,ready){
 const modes=[];
 const context=createContext({api,authReady:ready,loggingOut:false,accountUIEpoch:0,authReturnSeen:false,bootPromise:null,booting:false,showAuth:mode=>modes.push(mode??'login'),error:e=>{throw e;}});
 runInContext(bootCode,context);return{context,modes};
}

test('startup boot waits for the initial protected-session read without starting a second one',async()=>{
 const{api,calls}=fixture(),ready=deferred(),read=deferred(),started=deferred();
 const nativeCall=api.bridge.call;api.bridge.call=async(command,args)=>{if(command==='vaultGet'&&args.key==='session'){started.resolve();await read.promise;}return nativeCall(command,args);};
 const{context,modes}=bootFixture(api,ready.promise);
 const initial=api.init();await started.promise;const boot=context.boot();await new Promise(r=>setImmediate(r));
 assert.deepEqual(modes,[]);assert.equal(api.revision,1);
 read.resolve();await initial;ready.resolve();await boot;
 assert.deepEqual(modes,['login']);assert.equal(calls.filter(c=>c.command==='vaultGet'&&c.key==='session').length,1);
});

test('native callback exchanging PKCE survives startup resume and signed-out boot',async()=>{
 const{api,vault,calls}=fixture();await api.init();
 const{pending}=await api.authFlow.prepare('google'),exchange=deferred(),started=deferred();
 api.auth=async path=>{if(path.startsWith('token')){started.resolve();await exchange.promise;return session();}return session().user;};
 const{context,modes}=bootFixture(api,Promise.resolve());
 const callback=api.authReturn(pending.base+'?solaris_state='+pending.state+'&code=fixture-code');await started.promise;
 await context.boot();assert.deepEqual(modes,['login']);exchange.resolve();await callback;
 assert.equal(api.session.user.id,'returning-user');assert.equal(JSON.parse(vault.get('session')).user.id,'returning-user');assert.equal(vault.get('auth-flow'),'null');
 assert.equal(calls.filter(c=>c.command==='vaultGet'&&c.key==='session').length,1);
});

test('failed native callback ends the waiting UI and restores a visible retry state',async()=>{
 const{api,vault}=fixture();await api.init();const{pending}=await api.authFlow.prepare('google');
 const failure=new Error('fixture authentication failed');api.auth=async()=>{throw failure;};
 const nodes=new Map([
  ['#auth-pending',{hidden:false}],['#google-login',{disabled:true}],['#google-session-recovery',{hidden:true}],['#google-panel',{hidden:false}],
  ['#onboarding-status',{textContent:''}]
 ]);
 const context=createContext({api,bridge:api.bridge,authReady:Promise.resolve(),loggingOut:false,accountUIEpoch:0,googleBusy:true,providers:null,authReturnQueue:Promise.resolve(),authReturnSeen:false,authReturns:new Set(),$:selector=>nodes.get(selector)});
 runInContext(callbackCode,context);
 await assert.rejects(context.receiveAuthReturn(pending.base+'?solaris_state='+pending.state+'&code=fixture-code'),e=>e===failure);
 assert.equal(nodes.get('#auth-pending').hidden,true);assert.equal(nodes.get('#google-login').disabled,false);assert.equal(context.googleBusy,false);
 assert.match(nodes.get('#onboarding-status').textContent,/다시 시도/);
 assert.equal(api.session,null);assert.equal(JSON.parse(vault.get('auth-flow')),null);
 assert.equal(await api.authFlow.resume(),null,'A processed failure must not return to waiting after restart');
 const duplicate=await context.receiveAuthReturn(pending.base+'?solaris_state='+pending.state+'&code=fixture-code');
 assert.equal(duplicate,true,'An acknowledged failure duplicate must preserve its original guidance');
});

test('foreground recovers a queued native callback, acknowledges its exact URL and does not retry in a loop',async()=>{
 const{api,calls}=fixture();await api.init();const{pending}=await api.authFlow.prepare('google');
 const returned=pending.base+'?solaris_state='+pending.state+'&code=fixture-code';let queued=returned;
 const nativeCall=api.bridge.call;api.bridge.call=async(command,args)=>{if(command==='authTake'){calls.push({command});return queued;}if(command==='authAck'){calls.push({command,url:args.url});if(queued===args.url)queued=null;return true;}return nativeCall(command,args);};
 const failure=new Error('fixture authentication failed');api.auth=async()=>{throw failure;};
 const nodes=new Map([['#auth-pending',{hidden:false}],['#google-login',{disabled:true}],['#google-session-recovery',{hidden:true}],['#google-panel',{hidden:false}],['#onboarding-status',{textContent:''}]]),errors=[];let polls=0;
 const context=createContext({api,bridge:api.bridge,authReady:Promise.resolve(),loggingOut:false,accountUIEpoch:0,googleBusy:true,providers:null,authReturnQueue:Promise.resolve(),authReturnSeen:false,authReturns:new Set(),$:selector=>nodes.get(selector),error:e=>errors.push(e),poll:async()=>polls++});
 runInContext(callbackCode,context);await context.foreground();
 assert.equal(queued,null);assert.deepEqual(errors,[failure]);assert.equal(polls,1);assert.equal(nodes.get('#auth-pending').hidden,true);
 assert.equal(calls.filter(c=>c.command==='authTake').length,1);assert.equal(calls.find(c=>c.command==='authAck').url,returned);
 await context.foreground();assert.equal(calls.filter(c=>c.command==='authTake').length,2);assert.equal(errors.length,1);assert.equal(polls,2);
});

test('a native authTake failure is displayed once without retrying or blocking foreground sync',async()=>{
 const failure=new Error('fixture native callback read failed'),errors=[];let reads=0,polls=0;
 const context=createContext({bridge:{native:true,call:async command=>{assert.equal(command,'authTake');reads++;throw failure;}},authReady:Promise.resolve(),loggingOut:false,accountUIEpoch:0,error:e=>errors.push(e),poll:async()=>polls++});
 runInContext(callbackCode,context);await context.foreground();await new Promise(r=>setImmediate(r));
 assert.deepEqual(errors,[failure]);assert.equal(reads,1);assert.equal(polls,1);
});
