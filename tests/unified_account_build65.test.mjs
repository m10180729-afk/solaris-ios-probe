import{test}from'node:test';import assert from'node:assert/strict';import{API}from'../shared/api.mjs';
const session=uid=>({user:{id:uid,is_anonymous:false,email_confirmed_at:'2026-10-14',app_metadata:{provider:'google',providers:['google']},identities:[{provider:'google',identity_data:{sub:'fixture-'+uid,email_verified:true}}]},access_token:'fixture-'+uid,refresh_token:'refresh',expires_at:Date.now()/1000+3600});
const fixture=()=>{const records=new Map(),api=new API({url:'https://fixture.supabase.co',key:'sb_publishable_fixture'},{native:false},{get:async k=>records.get(k),set:async(k,v)=>records.set(k,structuredClone(v))});api.session=session('old');return{api,records};};
test('public account endpoint cannot bypass Google-only policy with ID password login',async()=>{
 const{api,records}=fixture(),original=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;throw Error('Blocked ID login must not reach the account endpoint');};
 try{await assert.rejects(api.accountFunction({action:'login_id',user_id:'solar_user',password:'password-123'}),e=>e.code==='google_only');assert.equal(requests,0);assert.equal(records.size,0);assert.equal(api.session.user.id,'old');}finally{globalThis.fetch=original;}
});
test('unique profile ID remains editable without becoming an authentication credential',async()=>{
 const{api}=fixture();let sent;api.rpc=async(action,args)=>{sent={action,args};return{uid:'old',user_id:args.user_id};};
 assert.deepEqual(await api.changeID(' SOLAR_USER '),{uid:'old',user_id:'solar_user'});assert.deepEqual(sent,{action:'profile',args:{user_id:'solar_user'}});assert.equal(api.session.user.id,'old');
});
test('successful deletion clears session and OAuth flow; temporary cleanup failure keeps credentials for retry',async()=>{
 const{api,records}=fixture();let cancelled=0;api.authFlow.cancel=async()=>cancelled++;
 api.accountFunction=async()=>{const e=Error('retry');e.deletionStarted=true;throw e;};await assert.rejects(api.deleteAccount(),/retry/);assert.equal(api.session.user.id,'old');assert.equal(cancelled,0);assert.equal(api.deletionPending,true);assert.equal(records.get('delete-pending:old'),true);
 await api.save();const restarted=new API(api.config,{native:false},api.ledger);await restarted.init();assert.equal(restarted.session.user.id,'old');assert.equal(restarted.deletionPending,true);
 api.accountFunction=async()=>({deleted:true});await api.deleteAccount();assert.equal(api.session,null);assert.equal(records.get('auth'),null);assert.equal(cancelled,1);assert.equal(api.deletionPending,false);assert.equal(records.get('delete-pending:old'),null);
});
test('lost successful deletion response then401 clears old credentials, never a newer account',async()=>{
 const{api}=fixture();api.authFlow.cancel=async()=>{};api.accountFunction=async()=>{const e=Error('gone');e.status=401;throw e;};await assert.rejects(api.deleteAccount(),e=>e.localSignedOut===true);assert.equal(api.session,null);
 api.session=session('old');api.accountFunction=async()=>{api.revision++;api.session=session('new');return{deleted:true};};await assert.rejects(api.deleteAccount(),/취소/);assert.equal(api.session.user.id,'new');
});
test('presence heartbeat adds instance device ID and explicit departure leaves only that device',async()=>{
 const{api}=fixture();let posted;const saved=globalThis.fetch;globalThis.fetch=async(url,options)=>{posted={url,options,body:JSON.parse(options.body)};return new Response('{}',{status:200});};
 try{await api.rpc('sync',{cursor:5,presence_active:false});assert.equal(posted.body.args.device_id,api.deviceId);assert.equal(posted.body.args.cursor,5);assert.equal(posted.body.args.presence_active,false);await api.setPresence('dnd');assert.equal(posted.body.action,'presence_set');assert.equal(posted.body.args.device_id,api.deviceId);await api.leavePresence();assert.equal(posted.body.action,'presence_leave');assert.equal(posted.options.keepalive,true);assert.equal(api.session.user.id,'old');}finally{globalThis.fetch=saved;}
});
test('account endpoint sends only publishable key and authenticated reply cannot clear a newer login',async()=>{
 const{api}=fixture();let release,started;const ready=new Promise(r=>started=r),original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{assert(url.endsWith('/functions/v1/solaris-account'));assert.equal(options.headers.apikey,'sb_publishable_fixture');assert.equal(options.headers.Authorization,'Bearer fixture-old');started();await new Promise(r=>release=r);return Response.json({deleted:true});};
 try{const deletion=api.deleteAccount(),rejected=assert.rejects(deletion,/취소/);await ready;api.revision++;api.session=session('new');release();await rejected;assert.equal(api.session.user.id,'new');}finally{globalThis.fetch=original;}
});
test('delayed deletion marker from a Google login cannot apply to a newer account',async()=>{
 const{api,records}=fixture();let release,started;const ready=new Promise(r=>started=r),pending=new Promise(r=>release=r);
 api.ledger.get=async key=>{if(key==='delete-pending:old'){started();await pending;return true;}return records.get(key);};
 const old=api.acceptSession(session('old'),++api.revision);await ready;await api.acceptSession(session('new'),++api.revision);release();await old;
 assert.equal(api.session.user.id,'new');assert.equal(api.deletionPending,false);assert.equal(records.get('auth').user.id,'new');
});
test('delayed startup deletion marker cannot apply to a newer Google account',async()=>{
 const{api,records}=fixture();records.set('auth',session('old'));let release,started;const ready=new Promise(r=>started=r),pending=new Promise(r=>release=r);
 api.ledger.get=async key=>{if(key==='delete-pending:old'){started();await pending;return true;}return records.get(key);};
 const restoring=api.init();await ready;await api.acceptSession(session('new'),++api.revision);release();await restoring;
 assert.equal(api.session.user.id,'new');assert.equal(api.deletionPending,false);assert.equal(records.get('auth').user.id,'new');
});
