import{test,before,after}from'node:test';
import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
import{PGlite}from'@electric-sql/pglite';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
const SA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',SB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',SC='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SIDS={[A]:SA,[B]:SB,[C]:SC};let db,baseline,server;
const migration=()=>readFile('backend/006_build66_google_only.sql','utf8');
async function claims(uid,amr=['oauth'],role='authenticated',sid=SIDS[uid]){
 const value={sub:uid,role,session_id:sid,user_metadata:{provider:'google'}};
 if(amr!==null)value.amr=amr.map(method=>({method,timestamp:1791960000}));
 await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[uid??'',JSON.stringify(value)]);
}
async function rpc(uid,action,args={},amr=['oauth'],sid=SIDS[uid]){await claims(uid,amr,'authenticated',sid);return(await db.query('select public.solaris_action($1,$2::jsonb) value',[action,JSON.stringify(args)])).rows[0].value;}
async function active(uid,amr=['oauth'],sid=SIDS[uid]){await claims(uid,amr,'authenticated',sid);return(await db.query('select public.solaris_session_active() value')).rows[0].value;}
async function service(action,args={}){await claims(null,null,'service_role');return(await db.query('select public.solaris_account_service($1,$2::jsonb) value',[action,JSON.stringify(args)])).rows[0].value;}
async function snapshot(){
 const tables=['auth.users','auth.identities','auth.sessions','solaris_private.profiles','solaris_private.servers','solaris_private.channels','solaris_private.friends','solaris_private.dm_messages','storage.objects'];
 const value={};for(const table of tables)value[table]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') value from ${table} t`)).rows[0].value;return value;
}
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean not null default false,raw_user_meta_data jsonb default '{}');
 create table auth.identities(user_id uuid references auth.users(id) on delete cascade,provider text,primary key(user_id,provider));
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
 grant usage on schema auth,storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;
 insert into auth.users(id,email,email_confirmed_at) values('${A}','alice@example.test',now()),('${B}','bob@example.test',now()),('${C}','carol@example.test',now());
 insert into auth.identities values('${A}','google'),('${B}','google'),('${B}','email'),('${C}','email');
 insert into auth.sessions values('${SA}','${A}'),('${SB}','${B}'),('${SC}','${C}');`);
 for(const file of['001_solaris.sql','003_build60_dm.sql','004_build61_accounts_broadcast.sql','005_build65_accounts_presence_invites.sql'])await db.exec(await readFile('backend/'+file,'utf8'));
 for(const[uid,id]of[[A,'alice'],[B,'bob'],[C,'carol']])await rpc(uid,'profile',{user_id:id,nickname:id});
 server=await rpc(A,'server_create',{name:'Preserved server'});server.invite=(await rpc(A,'server_invite',{server_id:server.id})).code;await rpc(B,'server_join',{invite:server.invite});
 await rpc(A,'friend_request',{target:B});await rpc(B,'friend_accept',{target:A});
 await rpc(A,'dm_send',{target:B,client_id:SC,text:'preserved message'});
 await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['solaris-avatars',A+'/preserved.png']);
 baseline=await snapshot();await db.exec(await migration());
});
after(async()=>{await db?.close();});

test('Google-only migration preserves existing email users, profiles, servers and messages',async()=>{
 assert.deepEqual(await snapshot(),baseline);
 assert.equal((await rpc(A,'profile')).user_id,'alice');
 assert.equal((await rpc(B,'profile')).user_id,'bob');
 assert.equal((await db.query('select user_id from solaris_private.profiles where uid=$1',[C])).rows[0].user_id,'carol');
});
test('verified Google identity with OAuth or refreshed OAuth can use RPC and Storage',async()=>{
 for(const amr of[['oauth'],['oauth','token_refresh'],['oauth','totp']]){
  assert.equal(await active(A,amr),true);assert.equal((await rpc(A,'profile',{},amr)).uid,A);
  await db.exec('set role authenticated');try{
   const path=A+'/'+amr.join('-')+'.png';await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['solaris-avatars',path]);
   await db.query('delete from storage.objects where name=$1',[path]);
  }finally{await db.exec('reset role');}
 }
});
test('email-only and forged Google metadata cannot access RPC or Storage',async()=>{
 await db.query("update auth.users set raw_user_meta_data='{"+'"provider":"google","providers":["google"]'+"}' where id=$1",[C]);
 assert.equal(await active(C),false);await assert.rejects(rpc(C,'profile'),/Authentication/);
 await db.exec('set role authenticated');try{await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['solaris-avatars',C+'/blocked.png']),/row-level security/);}finally{await db.exec('reset role');}
});
test('linking Google does not authorize an old password-only or missing-AMR session',async()=>{
 for(const amr of[['password'],['token_refresh'],[],null]){
  assert.equal(await active(B,amr),false);await assert.rejects(rpc(B,'sync',{},amr),/Authentication/);
 }
 assert.equal(await active(B,['oauth']),true);
});
test('anonymous, unconfirmed, revoked Google identity and revoked session fail closed',async()=>{
 await db.query('update auth.users set is_anonymous=true where id=$1',[A]);assert.equal(await active(A),false);
 await db.query('update auth.users set is_anonymous=false,email_confirmed_at=null where id=$1',[A]);assert.equal(await active(A),false);
 await db.query('update auth.users set email_confirmed_at=now() where id=$1',[A]);
 await db.query("delete from auth.identities where user_id=$1 and provider='google'",[A]);
 assert.equal(await active(A),false);await assert.rejects(rpc(A,'profile'),/Authentication/);
 await db.query("insert into auth.identities values($1,'google')",[A]);
 await db.query('delete from auth.sessions where id=$1',[SA]);assert.equal(await active(A),false);
 await assert.rejects(rpc(A,'profile'),/Authentication/);
 await db.query('insert into auth.sessions values($1,$2)',[SA,A]);assert.equal(await active(A),true);
});
test('legacy ID-to-email lookup is disabled and remains service-only',async()=>{
 for(const id of['alice','carol','unknown'])assert.deepEqual(await service('login_lookup',{user_id:id,ip_hash:'a'.repeat(64)}),{allowed:false,code:'google_only'});
 for(const role of['anon','authenticated']){
  await claims(A,['oauth'],role);await db.exec('set role '+role);try{
   await assert.rejects(db.query("select public.solaris_account_service('login_lookup','{}')"),/permission denied/);
  }finally{await db.exec('reset role');}
 }
 await claims(null,null,'service_role');await db.exec('set role service_role');try{
  await assert.rejects(db.query("select solaris_private.account_service_build65('login_lookup','{}')"),/permission denied/);
 }finally{await db.exec('reset role');}
 await claims(A,['oauth']);await assert.rejects(db.query("select public.solaris_account_service('login_lookup','{}')"),/Service required/);
});
test('self-deletion cleanup remains available without enabling legacy sign-in',async()=>{
 assert.deepEqual(await service('delete_context',{uid:C,session_id:SC}),{paths:[],deletionStarted:false});
 assert.deepEqual(await service('delete_begin',{uid:C,session_id:SC}),{deletionStarted:true});
 assert.equal((await service('delete_context',{uid:C,session_id:SC})).deletionStarted,true);
 await assert.rejects(service('delete_context',{uid:C,session_id:SA}),/Authentication/);
});
test('reapplying Google-only migration retains ID, invite and related data',async()=>{
 const before=await snapshot();await db.exec(await migration());assert.deepEqual(await snapshot(),before);
 assert.equal((await rpc(A,'profile')).user_id,'alice');assert.equal((await rpc(B,'server_invite',{server_id:server.id})).code,server.invite);
});
