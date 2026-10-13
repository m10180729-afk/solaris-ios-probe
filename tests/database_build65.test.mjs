import{test,before,after}from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{PGlite}from'@electric-sql/pglite';
let db;const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333';
const SA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',SB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',SC='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const D1='dddddddd-dddd-4ddd-8ddd-dddddddddddd',D2='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean not null default false,raw_user_meta_data jsonb default '{}');
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
 insert into auth.users(id,email,email_confirmed_at) values('${A}','alice@example.test',now()),('${B}','bob@example.test',now()),('${C}','carol@example.test',now());
 insert into auth.sessions values('${SA}','${A}'),('${SB}','${B}'),('${SC}','${C}');`);
 for(const file of['001_solaris.sql','003_build60_dm.sql','004_build61_accounts_broadcast.sql','005_build65_accounts_presence_invites.sql'])await db.exec(await readFile('backend/'+file,'utf8'));
 for(const[uid,id]of[[A,'alice'],[B,'bob'],[C,'carol']])await rpc(uid,'profile',{user_id:id,nickname:id});
});
after(async()=>{await db?.close();});
async function claims(uid,sid,role='authenticated'){
 await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[uid??'',JSON.stringify({sub:uid,session_id:sid??({[A]:SA,[B]:SB,[C]:SC}[uid]),role})]);
}
async function rpc(uid,action,args={},sid){await claims(uid,sid);return(await db.query('select public.solaris_action($1,$2::jsonb) result',[action,JSON.stringify(args)])).rows[0].result;}
async function service(action,args={}){await claims(null,null,'service_role');return(await db.query('select public.solaris_account_service($1,$2::jsonb) result',[action,JSON.stringify(args)])).rows[0].result;}

test('changing own ID retains UID and uniqueness, old ID no longer resolves',async()=>{
 assert.equal((await rpc(A,'profile',{user_id:'ALICE_NEW'})).uid,A);
 assert.equal((await rpc(A,'profile')).user_id,'alice_new');
 await assert.rejects(rpc(B,'profile',{user_id:'alice_new'}),/unique|duplicate/);
 const lookup=await service('login_lookup',{user_id:'alice_new',ip_hash:'a'.repeat(64)});assert.equal(lookup.uid,A);assert.equal(lookup.email,'alice@example.test');
 assert.equal((await service('login_lookup',{user_id:'alice',ip_hash:'a'.repeat(64)})).uid,null);
 await assert.rejects(rpc(A,'profile',{user_id:'bad@email.test'}),/Invalid/);
});
test('signup reserves ID before email confirmation but login lookup cannot expose unconfirmed mailbox',async()=>{
 const uid='44444444-4444-4444-8444-444444444444';
 await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3::jsonb)',[uid,'pending@example.test',JSON.stringify({solaris_user_id:'reserved_id',solaris_nickname:'예약'})]);
 assert.equal((await db.query('select user_id from solaris_private.profiles where uid=$1',[uid])).rows[0].user_id,'reserved_id');
 const pending=await service('login_lookup',{user_id:'reserved_id',ip_hash:'b'.repeat(64)});assert.equal(pending.email,null);
 await db.query('update auth.users set email_confirmed_at=now() where id=$1',[uid]);
 assert.equal((await service('login_lookup',{user_id:'reserved_id',ip_hash:'b'.repeat(64)})).uid,uid);
});
test('anonymous and unconfirmed Auth sessions cannot access Solaris RPC or avatars',async()=>{
 const u='99999999-9999-4999-8999-999999999999',s='88888888-8888-4888-8888-888888888888';
 await db.query('insert into auth.users(id,email,is_anonymous,email_confirmed_at) values($1,$2,true,now())',[u,'anon@example.test']);
 await db.query('insert into auth.sessions values($1,$2)',[s,u]);
 await assert.rejects(rpc(u,'profile',{user_id:'anon_blocked',nickname:'anonymous'},s),/Authentication/);
 await claims(u,s);assert.equal((await db.query('select public.solaris_session_active() ok')).rows[0].ok,false);
 await db.query('update auth.users set is_anonymous=false,email_confirmed_at=null where id=$1',[u]);
 await assert.rejects(rpc(u,'profile',{user_id:'unconfirmed',nickname:'pending'},s),/Authentication/);
 await db.query('delete from auth.users where id=$1',[u]);
});
test('login lookup is service-only and rejected attempts keep durable rate counters',async()=>{
 await db.exec('set role authenticated');try{await assert.rejects(db.query("select public.solaris_account_service('login_lookup','{}')"),/permission denied/);}finally{await db.exec('reset role');}
 for(let i=0;i<10;i++)assert.equal((await service('login_lookup',{user_id:'unknown_id',ip_hash:'c'.repeat(64)})).allowed,true);
 assert.equal((await service('login_lookup',{user_id:'unknown_id',ip_hash:'c'.repeat(64)})).allowed,false);
 assert.equal((await db.query("select count from solaris_private.login_limits where key='id:unknown_id'")).rows[0].count,11);
});
test('presence combines devices, preserves friend relation status and hides invisible activity',async()=>{
 await rpc(A,'friend_request',{target:B});await rpc(B,'friend_accept',{target:A});
 await rpc(A,'sync',{device_id:D1});await rpc(A,'sync',{device_id:D2});
 await rpc(A,'presence_set',{device_id:D1,status:'away'});
 let friend=(await rpc(B,'sync')).friends.find(f=>f.profile.uid===A);
 assert.equal(friend.status,'accepted');assert.equal(friend.presence_status,'away');assert.equal(friend.online,true);
 await rpc(A,'presence_leave',{device_id:D1});assert.equal((await rpc(B,'sync')).friends[0].presence_status,'away');
 await rpc(A,'sync',{device_id:D2,presence_active:false});assert.equal((await rpc(B,'sync')).friends[0].presence_status,'offline');
 await rpc(A,'sync',{device_id:D2,presence_active:true});assert.equal((await rpc(B,'sync')).friends[0].presence_status,'away');
 await rpc(A,'presence_set',{device_id:D2,status:'invisible'});friend=(await rpc(B,'sync')).friends[0];
 assert.equal(friend.presence_status,'offline');assert.equal(friend.online,false);assert(!('last_seen'in friend.profile));assert(!('presence_preference'in friend.profile));
 assert.equal((await rpc(A,'sync',{device_id:D2})).me.presence_preference,'invisible');
 await rpc(A,'presence_set',{device_id:D2,status:'dnd'});await db.query("update solaris_private.presence_devices set last_seen=now()-interval '46 seconds' where uid=$1",[A]);
 assert.equal((await rpc(B,'sync')).friends[0].presence_status,'offline');
 await assert.rejects(rpc(A,'presence_set',{device_id:D1,status:'offline'}),/Invalid presence/);
});
test('every server member retrieves stable invite but cannot change owner settings',async()=>{
 const{id}=await rpc(A,'server_create',{name:'allmember'}),first=await rpc(A,'server_invite',{server_id:id});
 await rpc(B,'server_join',{invite:first.code});assert.deepEqual(await rpc(B,'server_invite',{server_id:id}),first);
 assert.equal((await rpc(B,'sync')).servers.find(s=>s.id===id).invite,first.code);
 await assert.rejects(rpc(C,'server_invite',{server_id:id}),/member/);
 await assert.rejects(rpc(B,'server_rename',{server_id:id,name:'steal'}),/owner/);
});
test('revoked session and deleting account cannot use RPC or Storage with retained JWT',async()=>{
 await db.query('insert into auth.sessions values($1,$2)',[D1,A]);await rpc(A,'sync',{device_id:D1},D1);
 await db.query('delete from auth.sessions where id=$1',[D1]);await assert.rejects(rpc(A,'profile',{},D1),/Authentication/);
 await claims(A,D1);assert.equal((await db.query('select public.solaris_avatar_visible($1) ok',[A+'/x.png'])).rows[0].ok,false);
 await service('delete_begin',{uid:C,session_id:SC});await assert.rejects(rpc(C,'sync'),/Authentication/);
 await claims(C,SC);assert.equal((await db.query('select public.solaris_session_active() ok')).rows[0].ok,false);
 assert.equal((await service('delete_context',{uid:C,session_id:SC})).deletionStarted,true);
});
test('hard Auth deletion cleans owned servers/domain rows while preserving unrelated data',async()=>{
 const own=await rpc(B,'server_create',{name:'deleted-owner'}),channel=(await rpc(B,'sync')).channels.find(c=>c.server_id===own.id);
 await rpc(B,'channel_enter',{id:channel.id});await rpc(B,'broadcast_start',{scope_kind:'channel',scope_id:channel.id,transport:'browser'});
 await rpc(A,'dm_send',{target:B,client_id:D1,text:'purged'});await rpc(A,'session_request',{target:B});
 await db.query('insert into solaris_private.signals(sender,recipient,scope_kind,scope_id,payload) values($1,$2,$3,$4,$5)',[A,B,'friend',B,'{}']);
 await db.query('delete from auth.users where id=$1',[B]);
 for(const query of['select count(*) n from solaris_private.profiles where uid=$1','select count(*) n from auth.sessions where user_id=$1','select count(*) n from solaris_private.sessions where $1 in(a,b)','select count(*) n from solaris_private.dm_messages where $1 in(sender,recipient)','select count(*) n from solaris_private.signals where $1 in(sender,recipient)','select count(*) n from solaris_private.servers where owner=$1','select count(*) n from solaris_private.broadcasts where publisher=$1'])assert.equal(Number((await db.query(query,[B])).rows[0].n),0);
 assert.equal((await rpc(A,'profile')).uid,A);await assert.rejects(rpc(B,'profile'),/Authentication/);
});
test('reapplying build65 preserves IDs and invitation codes',async()=>{
 const before=await rpc(A,'sync');await db.exec(await readFile('backend/005_build65_accounts_presence_invites.sql','utf8'));
 const after=await rpc(A,'sync');assert.equal(after.me.user_id,before.me.user_id);assert.deepEqual(after.servers,before.servers);
});
