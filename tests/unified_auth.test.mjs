import {test} from 'node:test';
import assert from 'node:assert/strict';
import {API} from '../shared/api.mjs';
globalThis.location={href:'https://fixture.example.test/shared/index.html'};
const user=id=>({id,is_anonymous:false,email:'fixture@example.test',email_confirmed_at:'2026-10-14T00:00:00Z',app_metadata:{provider:'google',providers:['google']},identities:[{provider:'google',identity_data:{sub:'fixture-'+id,email:'fixture@example.test',email_verified:true}}]});
const session=(uid,seconds=3600)=>({user:user(uid),access_token:'fixture-'+uid,refresh_token:'fixture-refresh-'+uid,expires_at:Date.now()/1000+seconds});
const fixture=bridge=>{const records=new Map(),api=new API({url:'https://fixture.supabase.co',key:'sb_publishable_fixture'},bridge??{native:false},{get:async k=>structuredClone(records.get(k)),set:async(k,v)=>records.set(k,structuredClone(v))});api.session=session('old',-1);return{api,records};};

test('late refresh cannot overwrite a newly accepted Google account',async()=>{
 const{api,records}=fixture();let release,started;const ready=new Promise(r=>started=r),pending=new Promise(r=>release=r);
 api.auth=async()=>{started();await pending;return session('old');};
 const refresh=api.ensure();await ready;await api.acceptSession(session('new'),++api.revision);release();await refresh;
 assert.equal(api.session.user.id,'new');assert.equal(records.get('auth').user.id,'new');
});
test('late invalid refresh cannot clear a newer verified Google account',async()=>{
 const{api,records}=fixture();let release,started;const ready=new Promise(r=>started=r),pending=new Promise(r=>release=r);
 api.auth=async()=>{started();await pending;return{...session('old'),user:{id:'old',is_anonymous:false,email_confirmed_at:'2026-10-14',identities:[{provider:'email'}]}};};
 const refresh=api.ensure();await ready;await api.acceptSession(session('new'),++api.revision);release();await refresh;
 assert.equal(api.session.user.id,'new');assert.equal(records.get('auth').user.id,'new');
});
test('late protected-vault read cannot clear a new Google login of the same UID',async()=>{
 let release,started;const ready=new Promise(r=>started=r),pending=new Promise(r=>release=r),stored={...session('old',7200),user:{id:'old',is_anonymous:false,email_confirmed_at:'2026-10-14',identities:[{provider:'email'}]}};
 const{api}=fixture({native:true,call:async(command,args)=>{if(command==='vaultGet'){started();await pending;return JSON.stringify(stored);}if(command==='vaultSet')return true;throw Error('Unexpected native command');}});
 const refreshing=api.ensure();await ready;await api.acceptSession({...session('old'),access_token:'new-google-token'},++api.revision);release();await refreshing;
 assert.equal(api.session.user.id,'old');assert.equal(api.session.access_token,'new-google-token');
});
test('protected vault writes are serialized across a Google account switch',async()=>{
 let active=0,max=0,release,started;const pending=new Promise(r=>release=r),ready=new Promise(r=>started=r),writes=[];
 const{api}=fixture({native:true,call:async(command,args)=>{if(command!=='vaultSet')throw Error('unexpected command');active++;max=Math.max(max,active);const value=JSON.parse(args.value);if(value.user.id==='old'){started();await pending;}writes.push(value.user.id);active--;}});
 api.session=session('old');const save=api.save();await ready;const accepted=api.acceptSession(session('new'),++api.revision);release();await Promise.all([save,accepted]);
 assert.equal(max,1);assert.deepEqual(writes,['old','new']);assert.equal(api.session.user.id,'new');
});
test('refresh response for a different UID is rejected before persistence',async()=>{
 const{api,records}=fixture();api.auth=async()=>session('different');await assert.rejects(api.ensure(),/일치/);assert.equal(api.session.user.id,'old');assert.equal(records.size,0);
});

test('all legacy authentication and credential mutation APIs reject without HTTP or state changes',async()=>{
 const{api,records}=fixture();api.session=session('old');const revision=api.revision,original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw Error('A Google-only rejection must not reach HTTP');};
 api.auth=async()=>{calls++;throw Error('A Google-only rejection must not reach Auth');};
 api.authFlow.prepare=async()=>{calls++;throw Error('A Google-only rejection must not create a PKCE flow');};
 const forbidden=[
  ['signup',()=>api.signup()],['ID password login',()=>api.login('solar_id','fixture-password')],
  ['email signup',()=>api.registerEmail('fixture@example.test','fixture-password',{user_id:'solar_id',nickname:'fixture'})],
  ['email flow',()=>api.emailFlow('signup','fixture@example.test')],['email change',()=>api.recoverEmail('fixture@example.test')],
  ['email change verification',()=>api.verifyEmailLink('fixture@example.test','123456')],
  ['email OTP',()=>api.emailOTP('fixture@example.test')],['OTP verification',()=>api.verifyOTP('fixture@example.test','123456')],
  ['signup verification',()=>api.verifyAccount('fixture@example.test','123456','signup')],
  ['recovery verification',()=>api.verifyAccount('fixture@example.test','123456','recovery')],
  ['password reset',()=>api.passwordReset('fixture@example.test')],['signup resend',()=>api.resendVerification('fixture@example.test','signup')],
  ['recovery resend',()=>api.resendVerification('fixture@example.test','recovery')],
  ['credential update',()=>api.updateUser({email:'fixture@example.test',password:'fixture-password'})],
  ['password upgrade',()=>api.setPassword('fixture-password')]
 ];
 try{for(const[label,invoke]of forbidden){await assert.rejects(async()=>invoke(),e=>e.code==='google_only',label);assert.equal(api.revision,revision,label);assert.equal(api.session.user.id,'old',label);}assert.equal(calls,0);assert.equal(records.size,0);}finally{globalThis.fetch=original;}
});
test('malformed Google session is rejected before overwriting saved identity',async()=>{
 const{api,records}=fixture();await assert.rejects(api.acceptSession({access_token:'incomplete',user:user('new')},api.revision),/유효/);assert.equal(api.session.user.id,'old');assert.equal(records.size,0);
});
test('email, anonymous and spoofed metadata sessions cannot be accepted as Google identities',async()=>{
 const variants=[
  {id:'new',email_confirmed_at:'2026-10-14',app_metadata:{provider:'email',providers:['email']},identities:[{provider:'email'}]},
  {...user('new'),is_anonymous:true},
  {...user('new'),email_confirmed_at:null},
  {...user('new'),identities:[]},
  {...user('new'),identities:[{provider:'email'}]},
  {id:'new',email_confirmed_at:'2026-10-14',user_metadata:{provider:'google'},app_metadata:{provider:'email',providers:['email']},identities:[{provider:'email'}]}
 ];
 for(const rejected of variants){const{api,records}=fixture();await assert.rejects(api.acceptSession({...session('new'),user:rejected},api.revision),e=>e.code==='google_only');assert.equal(api.session.user.id,'old');assert.equal(records.size,0);}
});
test('low-level Auth requests cannot bypass the disabled email and password methods',async()=>{
 const{api}=fixture(),original=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;throw Error('Forbidden Auth request reached HTTP');};
 const routes=[['signup',{}],['signup?redirect_to=fixture',{}],['otp',{email:'fixture@example.test'}],['verify',{email:'fixture@example.test',token:'123456',type:'signup'}],['recover',{email:'fixture@example.test'}],['resend',{email:'fixture@example.test',type:'signup'}],['token?grant_type=password',{email:'fixture@example.test',password:'fixture-password'}],['user',{email:'fixture@example.test'},true,{method:'PUT'}],['user',{password:'fixture-password'},true,{method:'PUT'}]];
 try{for(const args of routes)await assert.rejects(api.auth(...args),e=>e.code==='google_only');assert.equal(requests,0);}finally{globalThis.fetch=original;}
});
test('Google refresh and account inspection clear a server-rejected identity without deleting history',async()=>{
 for(const operation of['ensure','account']){
  const{api,records}=fixture();api.session=session('old',operation==='ensure'?-1:3600);records.set('messages:old',{text:'private history'});
  const rejected={id:'old',is_anonymous:false,email_confirmed_at:'2026-10-14',app_metadata:{provider:'email'},identities:[{provider:'email'}]};
  api.auth=async()=>operation==='ensure'?{...session('old'),user:rejected}:rejected;
  await assert.rejects(api[operation](),e=>e.code==='google_only');assert.equal(api.session,null);assert.equal(records.get('auth'),null);assert.deepEqual(records.get('messages:old'),{text:'private history'});
 }
});
test('normal stored Google sessions retain their UID in web and native storage',async()=>{
 for(const native of[false,true]){
  const saved=session('old'),records=new Map([['auth',saved],['session',JSON.stringify(saved)]]),original=globalThis.fetch;let requests=0;
  const bridge={native,call:async(command,args)=>{if(command==='vaultGet')return records.get(args.key);if(command==='vaultSet'){records.set(args.key,args.value);return true;}throw Error('Unexpected native command');}};
  const api=new API({url:'https://fixture.supabase.co',key:'sb_publishable_fixture'},bridge,{get:async k=>records.get(k),set:async(k,v)=>records.set(k,structuredClone(v))});
  globalThis.fetch=async()=>{requests++;throw Error('A fresh saved Google session needs no refresh');};
  try{await api.init();assert.equal(api.session.user.id,'old');assert.equal(requests,0);}finally{globalThis.fetch=original;}
 }
});
test('a verified Google session persists its server identity and no password',async()=>{
 const{api,records}=fixture();await api.acceptSession(session('new'),++api.revision);assert.equal(records.get('auth').user.id,'new');assert.equal(records.get('auth').user.identities[0].provider,'google');assert(!JSON.stringify(records.get('auth')).includes('password'));
});
test('older server session shape may use trusted Google app metadata only when identities are omitted',async()=>{
 const{api,records}=fixture(),saved=session('new');delete saved.user.identities;await api.acceptSession(saved,++api.revision);assert.equal(records.get('auth').user.id,'new');assert.equal(api.session.user.app_metadata.provider,'google');
});

test('non-Google stored sessions are cleared in web and native storage without deleting private data',async()=>{
 for(const native of[false,true]){
  const saved={...session('old'),user:{id:'old',is_anonymous:false,email_confirmed_at:'2026-10-14',app_metadata:{provider:'email',providers:['email']},identities:[{provider:'email'}]}};
  const records=new Map([['auth',saved],['session',JSON.stringify(saved)],['auth-flow',native?JSON.stringify({kind:'signup'}):{kind:'signup'}],['messages:old',{text:'private history'}]]),original=globalThis.fetch;let calls=0;
  const bridge={native,call:async(command,args)=>{if(command==='vaultGet')return records.get(args.key);if(command==='vaultSet'){records.set(args.key,args.value);return true;}if(command==='authCancel')return true;throw Error('Unexpected native command');}};
  const api=new API({url:'https://fixture.supabase.co',key:'sb_publishable_fixture'},bridge,{get:async k=>records.get(k),set:async(k,v)=>records.set(k,structuredClone(v))});
  globalThis.fetch=async()=>{calls++;throw Error('Invalid stored identity must be rejected before HTTP');};
  try{await api.init();assert.equal(api.session,null);assert.equal(native?JSON.parse(records.get('session')):records.get('auth'),null);assert.deepEqual(records.get('messages:old'),{text:'private history'});assert.equal(calls,0);}finally{globalThis.fetch=original;}
 }
});
test('logout serializes after pending vault saves and clears only local authentication',async()=>{
 let release,started;const pending=new Promise(r=>release=r),ready=new Promise(r=>started=r),writes=[];
 const{api}=fixture({native:true,call:async(command,args)=>{const value=JSON.parse(args.value);if(value){started();await pending;}writes.push(value?.user?.id??null);}});api.session=session('old');
 const old=api.save();await ready;const cleared=api.clearSession();release();await Promise.all([old,cleared]);assert.deepEqual(writes,['old',null]);assert.equal(api.session,null);
});
test('a late Google code exchange cannot restore an account after local logout',async()=>{
 const{api,records}=fixture();api.session=null;const{pending}=await api.authFlow.prepare('google');let release,started;const ready=new Promise(r=>started=r);
 api.auth=async path=>{if(path.startsWith('token')){started();await new Promise(r=>release=r);return session('new');}return user('new');};
 const returning=api.authReturn(pending.base+'?solaris_state='+pending.state+'&code=fixture-code'),rejected=assert.rejects(returning,/취소/);await ready;await Promise.all([api.clearSession(),api.authFlow.cancel()]);release();await rejected;
 assert.equal(api.session,null);assert.equal(records.get('auth'),null);
});
