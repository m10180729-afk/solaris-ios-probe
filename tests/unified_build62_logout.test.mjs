import {test} from 'node:test';
import assert from 'node:assert/strict';
import {API} from '../shared/api.mjs';

const session=(seconds=3600)=>({user:{id:'existing-uid'},access_token:'fixture-token',refresh_token:'fixture-refresh',expires_at:Date.now()/1000+seconds});
function fixture(){
 const records=new Map([['messages:existing-uid',{text:'private history'}],['auth-flow',{state:'pending',verifier:'fixture-verifier'}]]);
 const api=new API({url:'https://fixture.supabase.co',key:'sb_publishable_fixture'},{native:false},{get:async k=>structuredClone(records.get(k)),set:async(k,v)=>records.set(k,structuredClone(v))});
 api.session=session();return{api,records};
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}

test('offline logout clears authentication and pending PKCE but preserves account history',async()=>{
 const{api,records}=fixture();api.session=session(-1);const original=globalThis.fetch;
 globalThis.fetch=async()=>{throw new TypeError('offline');};
 try{const result=await api.logout();assert.deepEqual(result,{remoteRevoked:false,hadSession:true});assert.equal(api.session,null);assert.equal(records.get('auth'),null);assert.equal(records.get('auth-flow'),null);assert.deepEqual(records.get('messages:existing-uid'),{text:'private history'});}finally{globalThis.fetch=original;}
});
test('logout cancels late refresh before it can restore the previous account',async()=>{
 const{api,records}=fixture(),pending=deferred(),started=deferred();api.session=session(-1);
 api.auth=async()=>{started.resolve();await pending.promise;return session();};const original=globalThis.fetch;globalThis.fetch=async()=>new Response(null,{status:204});
 try{const refreshing=api.ensure();await started.promise;await api.logout();pending.resolve();await refreshing;assert.equal(api.session,null);assert.equal(records.get('auth'),null);}finally{globalThis.fetch=original;}
});
test('late account inspection cannot persist a session after sign-out',async()=>{
 const{api,records}=fixture(),pending=deferred(),started=deferred();api.auth=async()=>{started.resolve();await pending.promise;return{id:'existing-uid'};};
 const result=api.account();const rejected=assert.rejects(result,/취소/);await started.promise;await api.clearSession();pending.resolve();await rejected;assert.equal(api.session,null);assert.equal(records.get('auth'),null);
});
test('late profile update cannot resurrect authentication after sign-out',async()=>{
 const{api,records}=fixture(),pending=deferred(),started=deferred();const original=globalThis.fetch;
 globalThis.fetch=async()=>{started.resolve();await pending.promise;return Response.json({id:'existing-uid',email:'fixture@example.test'});};
 try{const result=api.updateUser({email:'fixture@example.test'}),rejected=assert.rejects(result,/취소/);await started.promise;await api.clearSession();pending.resolve();await rejected;assert.equal(api.session,null);assert.equal(records.get('auth'),null);}finally{globalThis.fetch=original;}
});
test('late stored-session read is invalidated by sign-out',async()=>{
 const{api,records}=fixture(),pending=deferred();api.ledger.get=async()=>{await pending.promise;return session();};const init=api.init();await api.clearSession();pending.resolve();await init;assert.equal(api.session,null);assert.equal(records.get('auth'),null);
});
test('repeated logout shares a single local revocation request',async()=>{
 const{api}=fixture(),pending=deferred();const original=globalThis.fetch;let requests=0;
 globalThis.fetch=async(url,options)=>{requests++;assert(url.endsWith('/logout?scope=local'));assert.equal(options.headers.Authorization,'Bearer fixture-token');await pending.promise;return new Response(null,{status:204});};
 try{const first=api.logout(),second=api.logout();assert.equal(first,second);pending.resolve();assert.equal((await first).remoteRevoked,true);assert.equal(requests,1);}finally{globalThis.fetch=original;}
});
test('expired access token does not falsely claim remote session revocation',async()=>{
 const{api}=fixture();api.session=session(-1);const original=globalThis.fetch;globalThis.fetch=async()=>new Response(null,{status:401});
 try{assert.equal((await api.logout()).remoteRevoked,false);assert.equal(api.session,null);}finally{globalThis.fetch=original;}
});
test('protected storage failure is reported instead of claiming a durable logout',async()=>{
 const api=new API({url:'https://fixture.supabase.co',key:'sb_publishable_fixture'},{native:true,call:async(command,args)=>{if(command==='vaultSet'&&args.key==='session')throw Error('vault write failed');return true;}},{set:async()=>{}});api.session=session();const original=globalThis.fetch;globalThis.fetch=async()=>new Response(null,{status:204});
 try{await assert.rejects(api.logout(),/vault write failed/);}finally{globalThis.fetch=original;}
});

test('a delayed search body cannot reopen private results after logout',async()=>{
 const{api,records}=fixture(),pending=deferred(),started=deferred(),original=globalThis.fetch;
 globalThis.fetch=async url=>String(url).includes('/rest/v1/rpc/')?{ok:true,json:async()=>{started.resolve();await pending.promise;return{uid:'old-friend',nickname:'previous search'};}}:new Response(null,{status:204});
 try{
  const search=api.rpc('search',{user_id:'old-friend'}),rejected=assert.rejects(search,/인증 상태가 변경.*취소/);
  await started.promise;await api.logout();pending.resolve();await rejected;
  assert.equal(api.session,null);assert.equal(records.get('auth'),null);
 }finally{globalThis.fetch=original;}
});

test('logging back into the same UID cannot accept an earlier session response',async()=>{
 const{api}=fixture(),pending=deferred(),started=deferred(),original=globalThis.fetch;let rpcCalls=0;
 globalThis.fetch=async(url,options)=>{
  if(!String(url).includes('/rest/v1/rpc/'))return new Response(null,{status:204});
  if(++rpcCalls===1)return{ok:true,json:async()=>{started.resolve();await pending.promise;return{nickname:'old session result'};}};
  assert.equal(options.headers.Authorization,'Bearer new-login-token');return Response.json({nickname:'current session result'});
 };
 try{
  const request=api.rpc('profile'),rejected=assert.rejects(request,/인증 상태가 변경.*취소/);
  await started.promise;await api.logout();api.auth=async()=>({...session(),access_token:'new-login-token'});
  await api.login('fixture@example.test','fixture-password');pending.resolve();await rejected;
  assert.equal(api.session.user.id,'existing-uid');assert.equal(api.session.access_token,'new-login-token');
  assert.deepEqual(await api.rpc('profile'),{nickname:'current session result'});
 }finally{globalThis.fetch=original;}
});

test('an old request waiting for refresh cannot be sent under a later same-UID login',async()=>{
 const{api}=fixture(),pending=deferred(),started=deferred(),original=globalThis.fetch;let rpcCalls=0;api.session=session(-1);
 api.auth=async path=>{if(path.includes('refresh_token')){started.resolve();await pending.promise;return session();}return{...session(),access_token:'new-login-token'};};
 globalThis.fetch=async url=>{if(String(url).includes('/rest/v1/rpc/'))rpcCalls++;return new Response(null,{status:204});};
 try{
  const request=api.rpc('friend_request',{target:'old-friend'}),rejected=assert.rejects(request,/인증 상태가 변경.*취소/);
  await started.promise;await api.logout();await api.login('fixture@example.test','fixture-password');pending.resolve();await rejected;
  assert.equal(rpcCalls,0);assert.equal(api.session.access_token,'new-login-token');
 }finally{globalThis.fetch=original;}
});

test('a normal same-account token refresh still permits its pending request',async()=>{
 const{api}=fixture(),original=globalThis.fetch;api.session=session(-1);
 api.auth=async()=>({...session(),access_token:'refreshed-token'});
 globalThis.fetch=async(url,options)=>{assert(String(url).includes('/rest/v1/rpc/'));assert.equal(options.headers.Authorization,'Bearer refreshed-token');return Response.json({uid:'existing-uid'});};
 try{assert.deepEqual(await api.rpc('profile'),{uid:'existing-uid'});}finally{globalThis.fetch=original;}
});
