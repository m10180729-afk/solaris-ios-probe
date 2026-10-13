import{test}from'node:test';import assert from'node:assert/strict';import{API}from'../shared/api.mjs';
const session=uid=>({user:{id:uid},access_token:'fixture-'+uid,refresh_token:'refresh',expires_at:Date.now()/1000+3600});
const fixture=()=>{const records=new Map(),api=new API({url:'https://fixture.supabase.co',key:'sb_publishable_fixture'},{native:false},{get:async k=>records.get(k),set:async(k,v)=>records.set(k,structuredClone(v))});api.session=session('old');return{api,records};};
test('ID login sends no email resolver and persists only verified session, not password',async()=>{
 const{api,records}=fixture();let sent;api.accountFunction=async body=>{sent=body;return session('new')};await api.login(' SOLAR_USER ','password-123');assert.deepEqual(sent,{action:'login_id',user_id:'solar_user',password:'password-123'});assert.equal(records.get('auth').user.id,'new');assert(!JSON.stringify(records.get('auth')).includes('password-123'));
});
test('late ID login is discarded after logout',async()=>{
 const{api}=fixture();let release;api.accountFunction=async()=>{await new Promise(r=>release=r);return session('old')};const login=api.login('solar','password');await api.clearSession();release();await login;assert.equal(api.session,null);
});
test('successful deletion clears session and OAuth flow; temporary cleanup failure keeps credentials for retry',async()=>{
 const{api,records}=fixture();let cancelled=0;api.authFlow.cancel=async()=>cancelled++;
 api.accountFunction=async()=>{const e=Error('retry');e.deletionStarted=true;throw e;};await assert.rejects(api.deleteAccount(),/retry/);assert.equal(api.session.user.id,'old');assert.equal(cancelled,0);
 api.accountFunction=async()=>({deleted:true});await api.deleteAccount();assert.equal(api.session,null);assert.equal(records.get('auth'),null);assert.equal(cancelled,1);
});
test('lost successful deletion response then401 clears old credentials, never a newer account',async()=>{
 const{api}=fixture();api.authFlow.cancel=async()=>{};api.accountFunction=async()=>{const e=Error('gone');e.status=401;throw e;};await assert.rejects(api.deleteAccount(),e=>e.localSignedOut===true);assert.equal(api.session,null);
 api.session=session('old');api.accountFunction=async()=>{api.revision++;api.session=session('new');return{deleted:true};};await assert.rejects(api.deleteAccount(),/취소/);assert.equal(api.session.user.id,'new');
});
test('presence heartbeat adds instance device ID and explicit departure leaves only that device',async()=>{
 const{api}=fixture();let posted;const saved=globalThis.fetch;globalThis.fetch=async(url,options)=>{posted={url,options,body:JSON.parse(options.body)};return new Response('{}',{status:200});};
 try{await api.rpc('sync',{cursor:5});assert.equal(posted.body.args.device_id,api.deviceId);assert.equal(posted.body.args.cursor,5);await api.setPresence('dnd');assert.equal(posted.body.action,'presence_set');assert.equal(posted.body.args.device_id,api.deviceId);await api.leavePresence();assert.equal(posted.body.action,'presence_leave');assert.equal(posted.options.keepalive,true);assert.equal(api.session.user.id,'old');}finally{globalThis.fetch=saved;}
});
test('account endpoint sends only publishable key and authenticated reply cannot clear a newer login',async()=>{
 const{api}=fixture();let release,started;const ready=new Promise(r=>started=r),original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{assert(url.endsWith('/functions/v1/solaris-account'));assert.equal(options.headers.apikey,'sb_publishable_fixture');assert.equal(options.headers.Authorization,'Bearer fixture-old');started();await new Promise(r=>release=r);return Response.json({deleted:true});};
 try{const deletion=api.deleteAccount(),rejected=assert.rejects(deletion,/취소/);await ready;api.revision++;api.session=session('new');release();await rejected;assert.equal(api.session.user.id,'new');}finally{globalThis.fetch=original;}
});
