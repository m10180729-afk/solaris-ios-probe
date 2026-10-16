import{test}from'node:test';import assert from'node:assert/strict';import{createAccountHandler}from'../backend/functions/solaris-account/handler.mjs';
const UID='11111111-1111-4111-8111-111111111111',SID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const token='fixture.'+Buffer.from(JSON.stringify({sub:UID,session_id:SID})).toString('base64url')+'.sig';
const json=(v,status=200)=>new Response(JSON.stringify(v),{status});
const req=(body,bearer)=>new Request('https://fixture.supabase.co/functions/v1/solaris-account',{method:'POST',headers:{'Content-Type':'application/json',...(bearer?{Authorization:'Bearer '+bearer}:{})},body:JSON.stringify(body)});
const setup=handler=>{const calls=[];const handle=createAccountHandler({url:'https://fixture.supabase.co',serviceKey:'server-only-fixture',fetchImpl:async(url,options)=>{calls.push({url,body:options.body&&JSON.parse(options.body),headers:options.headers});return handler(url,options,calls);}});return{handle,calls};};
test('retired ID login rejects all credentials without mailbox lookup or upstream requests',async()=>{
 const{handle,calls}=setup(()=>{throw Error('Legacy login must never reach Auth or RPC');});
 for(const body of[{action:'login_id',user_id:'alice',password:'valid-password'}, {action:'login_id',user_id:'missing'}, {action:'login_id',email:'private@example.test',password:''}, {action:'login_id',user_id:UID,uid:SID}]){
  const response=await handle(req(body,token));assert.equal(response.status,410);
  assert.deepEqual(await response.json(),{code:'google_only',message:'Solaris는 Google 계정으로만 가입하고 로그인할 수 있습니다. 앱을 업데이트하세요.'});
 }
 assert.deepEqual(calls,[]);
});
test('invalid request limits still protect the account service before retired login handling',async()=>{
 const{handle,calls}=setup(()=>{throw Error('No upstream request expected');});
 assert.equal((await handle(req({action:'login_id',password:'x'.repeat(9000)}))).status,400);
 assert.equal((await handle(new Request('https://fixture.supabase.co',{method:'GET'}))).status,405);
 assert.equal((await handle(new Request('https://fixture.supabase.co',{method:'POST',body:'{"action":"login_id"}'}))).status,400);
 assert.equal((await handle(new Request('https://fixture.supabase.co',{method:'OPTIONS'}))).status,204);
 assert.deepEqual(calls,[]);
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
