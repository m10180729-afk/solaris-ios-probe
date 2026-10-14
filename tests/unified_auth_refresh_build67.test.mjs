import {test} from 'node:test';
import assert from 'node:assert/strict';
import {API} from '../shared/api.mjs';

globalThis.location={href:'https://fixture.example.test/shared/index.html'};
const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',otherSID='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const jwt=claims=>'fixture.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.signature';
const session=(seconds=60,authID=sid,refresh='original-refresh')=>{
 const expires=Date.now()/1000+seconds;
 return {user:{id:uid,is_anonymous:false,email_confirmed_at:'2026-10-14',identities:[{provider:'google'}]},access_token:jwt({sub:uid,session_id:authID,exp:expires}),refresh_token:refresh,expires_at:expires};
};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(options={}){
 const current=session(options.remaining??60),stored=Object.hasOwn(options,'stored')?options.stored:current;
 const vault=new Map([['session',JSON.stringify(stored)]]),calls=[],authCalls=[];
 const bridge={native:true,async call(command,args={}){
  calls.push({command,args});
  const run=async()=>{
   if(command==='vaultGet')return vault.get(args.key)??null;
   if(command==='vaultSet'){vault.set(args.key,args.value);return true;}
   if(command==='platform')return {platform:options.platform??'ios'};
   if(command==='mediaStatus')return options.status??{active:true,nativeAuthRefreshOwner:true};
   if(command==='authCancel')return true;
   throw Error('Unexpected native command: '+command);
  };
  return options.call?options.call(command,args,run):run();
 }};
 const api=new API({url:'https://fixture.supabase.co',key:'sb_publishable_fixture'},bridge,{get:async()=>null,set:async()=>{}});
 api.session=current;
 api.auth=async(path,body)=>{authCalls.push({path,body});return session(3600,sid,'host-rotated');};
 return {api,current,vault,calls,authCalls};
}

test('newer same-UID credentials from another auth session cannot replace the current login',async()=>{
 const {api,current,authCalls,calls}=fixture({stored:session(3600,otherSID,'another-login')});
 await api.ensure();
 assert.equal(authCalls.length,1);
 assert.equal(authCalls[0].body.refresh_token,current.refresh_token);
 assert.equal(api.session.refresh_token,'host-rotated');
 assert(!calls.some(c=>c.command==='mediaStatus'));
});

test('newer credentials from the same JWT auth session are adopted without consuming refresh again',async()=>{
 const newer=session(3600,sid,'extension-rotated'),{api,authCalls,calls}=fixture({stored:newer});
 await api.ensure();
 assert.deepEqual(api.session,newer);
 assert.equal(authCalls.length,0);
 assert.deepEqual(calls.map(c=>c.command),['vaultGet']);
});

test('active ReplayKit owns refresh while the host uses its valid access token and later imports the handoff',async()=>{
 const {api,current,vault,calls,authCalls}=fixture(),previous=globalThis.fetch;
 const requests=[];
 globalThis.fetch=async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify({ok:true}));};
 try{
  assert.deepEqual(await api.rpc('sync'),{ok:true});
  assert.equal(authCalls.length,0);
  assert.equal(api.session,current);
  assert.equal(requests[0].options.headers.Authorization,'Bearer '+current.access_token);
  assert.deepEqual(calls.map(c=>c.command),['vaultGet','platform','mediaStatus']);
  assert.deepEqual(calls.at(-1).args,{});
  const newer=session(3600,sid,'extension-rotated');vault.set('session',JSON.stringify(newer));
  await api.ensure();assert.deepEqual(api.session,newer);assert.equal(authCalls.length,0);
 }finally{globalThis.fetch=previous;}
});

for(const remaining of [15,10,-1])test('host refresh falls back despite ReplayKit ownership with '+remaining+' seconds remaining',async()=>{
 const {api,authCalls}=fixture({remaining});
 await api.ensure();assert.equal(authCalls.length,1);assert.equal(api.session.refresh_token,'host-rotated');
});

for(const status of [{active:false,nativeAuthRefreshOwner:false},{active:true,nativeAuthRefreshOwner:'true'}])test('inactive or invalid ownership status lets the host refresh: '+JSON.stringify(status),async()=>{
 const {api,authCalls}=fixture({status});
 await api.ensure();assert.equal(authCalls.length,1);
});

test('ownership status failure falls back to host refresh without signing out',async()=>{
 const {api,authCalls}=fixture({call:async(command,args,run)=>{if(command==='mediaStatus')throw Error('Extension status unavailable');return run();}});
 await api.ensure();assert.equal(authCalls.length,1);assert.equal(api.session.user.id,uid);
});

test('non-iOS native refresh skips ReplayKit status and caches platform capability once',async()=>{
 const {api,vault,calls,authCalls}=fixture({platform:'windows'});
 await api.ensure();
 const next=session(60,sid,'host-rotated');api.session=next;vault.set('session',JSON.stringify(next));
 await api.ensure();
 assert.equal(authCalls.length,2);
 assert.equal(calls.filter(c=>c.command==='platform').length,1);
 assert.equal(calls.filter(c=>c.command==='mediaStatus').length,0);
});

test('malformed JWTs, mismatched subjects and legacy fixture tokens never bypass auth-session matching',async()=>{
 const invalidTokens=['fixture-token','fixture.not-json.signature',jwt({sub:uid,session_id:'not-a-uuid'}),jwt({sub:otherSID,session_id:sid})];
 for(const access_token of invalidTokens){
  const saved={...session(3600),access_token},{api,current,authCalls}=fixture({stored:saved});
  await api.ensure();assert.equal(authCalls.length,1);assert.equal(authCalls[0].body.refresh_token,current.refresh_token);
 }
 for(const stored of [{access_token:jwt({session_id:sid}),expires_at:Date.now()/1000+3600},'invalid-vault-json']){
  const {api,vault,authCalls}=fixture({stored});if(typeof stored==='string')vault.set('session',stored);
  await api.ensure();assert.equal(authCalls.length,1);
 }
 const {api,vault,authCalls,calls}=fixture();api.session={...api.session,access_token:'same-fake-token'};
 vault.set('session',JSON.stringify({...api.session,expires_at:Date.now()/1000+3600,refresh_token:'fake-newer'}));
 await api.ensure();assert.equal(authCalls.length,1);assert.equal(api.session.refresh_token,'host-rotated');
 assert(!calls.some(c=>c.command==='mediaStatus'));
});

for(const blocked of ['vaultGet','platform','mediaStatus'])test('logout during '+blocked+' cannot resume a stale host refresh or restore credentials',async()=>{
 const ready=deferred(),pending=deferred();
 const {api,authCalls}=fixture({call:async(command,args,run)=>{if(command===blocked){const result=await run();ready.resolve();await pending.promise;return result;}return run();}});
 const refreshing=api.ensure();await ready.promise;await api.clearSession();pending.resolve();await refreshing;
 assert.equal(api.session,null);assert.equal(authCalls.length,0);
});

test('a replacement session during ownership lookup survives even without a revision change',async()=>{
 const ready=deferred(),pending=deferred(),{api,authCalls}=fixture({call:async(command,args,run)=>{if(command==='mediaStatus'){ready.resolve();await pending.promise;}return run();}});
 const refreshing=api.ensure();await ready.promise;const replacement=session(3600,otherSID,'new-login');api.session=replacement;
 pending.resolve();await refreshing;assert.equal(api.session,replacement);assert.equal(authCalls.length,0);
});

test('concurrent host fallbacks retain one refresh request for the current session',async()=>{
 const ready=deferred(),pending=deferred(),{api,authCalls}=fixture({remaining:10,status:{nativeAuthRefreshOwner:false}});
 api.auth=async(path,body)=>{authCalls.push({path,body});ready.resolve();await pending.promise;return session(3600,sid,'host-rotated');};
 const first=api.ensure(),second=api.ensure();await ready.promise;pending.resolve();await Promise.all([first,second]);
 assert.equal(authCalls.length,1);assert.equal(api.session.refresh_token,'host-rotated');
});
