import{test}from'node:test';import assert from'node:assert/strict';import{API}from'../shared/api.mjs';
globalThis.location={href:'https://fixture.example.test/shared/index.html'};
const session=(id,expired=false)=>({user:{id,is_anonymous:false,email_confirmed_at:'2026-10-14',identities:[{provider:'google'}]},access_token:'fixture-'+id,refresh_token:'refresh-'+id,expires_at:Date.now()/1000+(expired?-1:3600)});
const fixture=()=>{const records=new Map([['messages:old',{text:'private preserved'}]]),ledger={get:async k=>structuredClone(records.get(k)),set:async(k,v)=>records.set(k,structuredClone(v))},api=new API({url:'https://fixture.supabase.co',key:'sb_publishable_fixture'},{native:false},ledger);api.session=session('old');return{api,records,ledger};};
test('old password-only Google-linked RPC session can leave the rejected session and restart Google login',async()=>{
 const{api,records}=fixture(),previous=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({code:'42501',message:'Authentication required'}),{status:403});
 try{await assert.rejects(api.rpc('profile'),e=>e.localSignedOut===true);assert.equal(api.session,null);assert.equal(records.get('auth'),null);assert.deepEqual(records.get('messages:old'),{text:'private preserved'});assert.equal((await api.authFlow.prepare('google')).pending.kind,'google');}finally{globalThis.fetch=previous;}
});
test('network and unrelated member permissions keep the current Google credentials',async()=>{
 const{api}=fixture(),previous=globalThis.fetch;
 for(const response of[()=>{throw Error('Network offline');},()=>new Response(JSON.stringify({code:'42501',message:'Server member required'}),{status:403})]){
  globalThis.fetch=response;try{await assert.rejects(api.rpc('server_invite'));assert.equal(api.session.user.id,'old');}finally{globalThis.fetch=previous;}
 }
});
test('revoked refresh clears only authentication while transient failures remain retryable',async()=>{
 for(const[status,code,clears]of[[400,'refresh_token_not_found',true],[401,'bad_jwt',true],[503,'temporarily_unavailable',false],[400,'unrelated_error',false]]){
  const{api,records}=fixture();api.session=session('old',true);api.auth=async()=>{const e=Error(code);Object.assign(e,{status,code});throw e;};
  await assert.rejects(api.ensure(),e=>Boolean(e.localSignedOut)===clears);assert.equal(Boolean(api.session),!clears);assert.deepEqual(records.get('messages:old'),{text:'private preserved'});
 }
});
test('late revoked refresh cannot clear a newer login of the same UID',async()=>{
 const{api}=fixture();api.session=session('old',true);let release,start;const ready=new Promise(r=>start=r),pending=new Promise(r=>release=r);api.auth=async()=>{start();await pending;const e=Error('revoked');e.status=401;throw e;};
 const refreshing=api.ensure();await ready;const newer={...session('old'),access_token:'new-google'};await api.acceptSession(newer,++api.revision);release();await assert.rejects(refreshing);assert.equal(api.session.access_token,'new-google');
});
test('revoked getUser restores Google login without deleting account data',async()=>{
 const{api,records}=fixture();api.auth=async()=>{const e=Error('revoked');e.status=401;throw e;};await assert.rejects(api.account(),e=>e.localSignedOut===true);assert.equal(api.session,null);assert(records.has('messages:old'));
});
for(const fails of[false,true])test('late deletion marker cleanup cannot clear new Google login: '+(fails?'lost response':'success'),async()=>{
 const{api,ledger,records}=fixture();let release,start;const ready=new Promise(r=>start=r),pending=new Promise(r=>release=r),set=ledger.set;
 ledger.set=async(k,v)=>{if(k==='delete-pending:old'&&v===null){start();await pending;}return set(k,v);};
 api.accountFunction=async()=>{if(fails){const e=Error('deleted');e.status=401;throw e;}return{deleted:true};};
 const deleting=api.deleteAccount();await ready;await api.acceptSession(session('new'),++api.revision);release();await assert.rejects(deleting);assert.equal(api.session.user.id,'new');assert.equal(records.get('auth').user.id,'new');
});
