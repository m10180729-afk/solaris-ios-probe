import{test}from'node:test';import assert from'node:assert/strict';import{API}from'../shared/api.mjs';
const session=(uid,seconds=3600)=>({user:{id:uid},access_token:'fixture-'+uid,refresh_token:'fixture-refresh-'+uid,expires_at:Date.now()/1000+seconds});
const fixture=bridge=>{const records=new Map(),api=new API({url:'https://fixture.supabase.co',key:'sb_publishable_fixture'},bridge??{native:false},{set:async(k,v)=>records.set(k,structuredClone(v))});api.session=session('old',-1);return{api,records}};
test('late refresh cannot overwrite a newly recovered account',async()=>{const{api,records}=fixture();let release,started;const ready=new Promise(r=>started=r),pending=new Promise(r=>release=r);api.auth=async path=>{if(path.startsWith('token')){started();await pending;return session('old')}return session('new')};const refresh=api.ensure();await ready;await api.verifyOTP('email','code');release();await refresh;assert.equal(api.session.user.id,'new');assert.equal(records.get('auth').user.id,'new');});
test('protected vault writes are serialized across account recovery',async()=>{let active=0,max=0,release,started;const pending=new Promise(r=>release=r),ready=new Promise(r=>started=r),writes=[];const{api}=fixture({native:true,call:async(command,args)=>{if(command!=='vaultSet')throw Error('unexpected command');active++;max=Math.max(max,active);const value=JSON.parse(args.value);if(value.user.id==='old'){started();await pending}writes.push(value.user.id);active--}});api.session=session('old');const save=api.save();await ready;api.auth=async()=>session('new');const recovered=api.verifyOTP('email','code');release();await Promise.all([save,recovered]);assert.equal(max,1);assert.deepEqual(writes,['old','new']);assert.equal(api.session.user.id,'new');});
test('linking recovery email cannot replace the existing internal UID',async()=>{const{api,records}=fixture();api.auth=async()=>session('different');await assert.rejects(api.verifyEmailLink('email','code'),/UID/);assert.equal(api.session.user.id,'old');assert.equal(records.size,0);});
test('refresh response for a different UID is rejected before persistence',async()=>{const{api,records}=fixture();api.auth=async()=>session('different');await assert.rejects(api.ensure(),/일치/);assert.equal(api.session.user.id,'old');assert.equal(records.size,0);});

test('email password login persists authenticated UID without storing a password',async()=>{
 const{api,records}=fixture();let sent;api.auth=async(path,body)=>{sent={path,body};return session('existing')};
 await api.login(' user@example.test ','password-123');assert.equal(sent.path,'token?grant_type=password');assert.equal(sent.body.email,'user@example.test');
 assert.equal(records.get('auth').user.id,'existing');assert(!JSON.stringify(records.get('auth')).includes('password-123'));
});
test('unconfirmed signup carries ID metadata but persists no password or incomplete session',async()=>{
 const{api,records}=fixture();let body;api.auth=async(path,args)=>{body=args;return{user:{id:'new'}}};
 const result=await api.registerEmail('user@example.test','password-123',{user_id:'solar',nickname:'태양'});
 assert.equal(result.confirmationRequired,true);assert.equal(body.data.solaris_user_id,'solar');assert.equal(records.size,0);
});
test('malformed login session is rejected before overwriting saved identity',async()=>{
 const{api,records}=fixture();api.auth=async()=>({access_token:'incomplete',user:{id:'new'}});
 await assert.rejects(api.login('user@example.test','password-123'),/유효/);assert.equal(api.session.user.id,'old');assert.equal(records.size,0);
});
test('password upgrade requires a server verified email on the same UID',async()=>{
 const{api}=fixture();api.session=session('old');api.auth=async()=>({id:'old',email:'user@example.test'});let updated=false;api.updateUser=async()=>{updated=true};
 await assert.rejects(api.setPassword('password-123'),/이메일 인증/);assert.equal(updated,false);
 api.auth=async()=>({id:'foreign',email_confirmed_at:'2026-10-11'});await assert.rejects(api.setPassword('password-123'),/UID/);assert.equal(updated,false);
 api.auth=async()=>({id:'old',email_confirmed_at:'2026-10-11'});await api.setPassword('password-123');assert.equal(updated,true);assert.equal(api.session.user.id,'old');
});
test('logout serializes after pending vault saves and clears only local authentication',async()=>{
 let release,started;const pending=new Promise(r=>release=r),ready=new Promise(r=>started=r),writes=[];
 const{api}=fixture({native:true,call:async(command,args)=>{const value=JSON.parse(args.value);if(value){started();await pending;}writes.push(value?.user?.id??null)}});api.session=session('old');
 const old=api.save();await ready;const cleared=api.clearSession();release();await Promise.all([old,cleared]);assert.deepEqual(writes,['old',null]);assert.equal(api.session,null);
});
test('a late login response cannot restore an account after local logout',async()=>{
 const{api,records}=fixture();let release;api.auth=async()=>{await new Promise(r=>release=r);return session('old')};
 const login=api.login('user@example.test','password-123');await api.clearSession();release();await login;assert.equal(api.session,null);assert.equal(records.get('auth'),null);
});
