import{test}from'node:test';import assert from'node:assert/strict';import{createAccountHandler}from'../backend/functions/solaris-account/handler.mjs';
const UID='11111111-1111-4111-8111-111111111111',SID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const token='fixture.'+Buffer.from(JSON.stringify({sub:UID,session_id:SID})).toString('base64url')+'.sig';
const json=(v,status=200)=>new Response(JSON.stringify(v),{status});
const req=(body,bearer)=>new Request('https://fixture.supabase.co/functions/v1/solaris-account',{method:'POST',headers:{'Content-Type':'application/json',...(bearer?{Authorization:'Bearer '+bearer}:{})},body:JSON.stringify(body)});
const setup=handler=>{const calls=[];const handle=createAccountHandler({url:'https://fixture.supabase.co',serviceKey:'server-only-fixture',wait:async()=>{},fetchImpl:async(url,options)=>{calls.push({url,body:options.body&&JSON.parse(options.body),headers:options.headers});return handler(url,options,calls);}});return{handle,calls};};
test('ID login reveals no mailbox/provider distinction before successful password verification',async()=>{
 for(const exists of[false,true]){
  const{handle,calls}=setup(url=>url.includes('/rpc/')?json({allowed:true,uid:exists?UID:null,email:exists?'private@example.test':null}):json({error:'Invalid login credentials',email:'private@example.test'},400));
  const r=await handle(req({action:'login_id',user_id:'alice',password:'wrong'}));assert.equal(r.status,401);assert.deepEqual(await r.json(),{code:'invalid_credentials',message:'아이디 또는 비밀번호를 확인하세요. 이메일 인증도 필요합니다.'});
  assert.equal(calls.length,2);assert(calls[0].body.args.ip_hash.match(/^[a-f0-9]{64}$/));assert.equal(calls[0].body.args.password,undefined);
 }
});
test('confirmed password response UID must match private ID lookup; secret/password are not persisted',async()=>{
 const session={user:{id:UID,email_confirmed_at:'2026-10-13'},access_token:'access',refresh_token:'refresh'};
 const{handle}=setup(url=>url.includes('/rpc/')?json({allowed:true,uid:UID,email:'private@example.test'}):json(session));
 const r=await handle(req({action:'login_id',user_id:'alice',password:'password'}));assert.equal(r.status,200);assert.deepEqual(await r.json(),session);
 session.user.id=SID;assert.equal((await handle(req({action:'login_id',user_id:'alice',password:'password'}))).status,401);
});
test('durable rate rejection never sends a password attempt upstream',async()=>{
 const{handle,calls}=setup(()=>json({allowed:false}));assert.equal((await handle(req({action:'login_id',user_id:'alice',password:'password'}))).status,401);assert.equal(calls.length,1);
});
test('delete ignores arbitrary target, verifies user/session and removes only own Storage paths before Auth',async()=>{
 const{handle,calls}=setup((url,o)=>{
  if(url.endsWith('/auth/v1/user'))return json({id:UID});
  if(url.includes('/rpc/'))return json(JSON.parse(o.body).action==='delete_context'?{paths:[UID+'/photo.png']}:{deletionStarted:true});
  return json({});
 });
 const r=await handle(req({action:'delete_account',uid:SID},token));assert.equal(r.status,200);assert.deepEqual(await r.json(),{deleted:true});
 assert.equal(calls[1].body.args.uid,UID);assert.equal(calls[1].body.args.session_id,SID);
 assert(calls[2].url.includes('/storage/'));assert.deepEqual(calls[2].body.prefixes,[UID+'/photo.png']);
 assert(calls.at(-1).url.endsWith('/admin/users/'+UID));assert.equal(calls.at(-1).body.should_soft_delete,false);
});
test('foreign Storage path or failed removal never starts Auth deletion',async()=>{
 for(const foreign of[true,false]){
  const{handle,calls}=setup((url,o)=>url.endsWith('/auth/v1/user')?json({id:UID}):url.includes('/rpc/')?json({paths:[(foreign?SID:UID)+'/x.png']}):json({error:'failure'},500));
  const r=await handle(req({action:'delete_account'},token));assert.equal(r.status,503);assert.equal((await r.json()).deletionStarted,false);assert(!calls.some(c=>c.url.includes('/admin/users/')));assert(!calls.some(c=>c.body?.action==='delete_begin'));
 }
});
test('failed Auth deletion reports retryable tombstone, stale session never accesses storage/admin',async()=>{
 const{handle}=setup((url,o)=>url.endsWith('/auth/v1/user')?json({id:UID}):url.includes('/rpc/')?json(JSON.parse(o.body).action==='delete_context'?{paths:[]}:{deletionStarted:true}):json({},500));
 const r=await handle(req({action:'delete_account'},token));assert.equal(r.status,503);assert.equal((await r.json()).deletionStarted,true);
 const stale=setup(url=>url.endsWith('/auth/v1/user')?json({id:UID}):json({},403));assert.equal((await stale.handle(req({action:'delete_account'},token))).status,401);assert.equal(stale.calls.length,2);
});
test('deletion rechecks storage after tombstone to remove a racing upload',async()=>{
 let listed=0;const{handle,calls}=setup((url,o)=>{
  if(url.endsWith('/auth/v1/user'))return json({id:UID});
  if(url.includes('/rpc/'))return json(JSON.parse(o.body).action==='delete_context'?{paths:++listed===1?[]:[UID+'/racing.png']}:{deletionStarted:true});
  return json({});
 });
 const r=await handle(req({action:'delete_account'},token));assert.equal(r.status,200);
 const begin=calls.findIndex(c=>c.body?.action==='delete_begin'),storage=calls.findIndex(c=>c.url.includes('/storage/'));
 assert(begin>=0&&storage>begin);assert.deepEqual(calls[storage].body.prefixes,[UID+'/racing.png']);
});
