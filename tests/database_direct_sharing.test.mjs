import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const [A,B,C]=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
let db;
async function rpc(uid,action,args={},amr='oauth'){
 await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[uid??'',JSON.stringify({sub:uid,session_id:uid,amr:[{method:amr}],role:'authenticated'})]);
 return(await db.query('select public.solaris_action($1,$2::jsonb) value',[action,JSON.stringify(args)])).rows[0].value;
}
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz default now(),is_anonymous boolean default false,raw_user_meta_data jsonb default '{}');
 create table auth.identities(user_id uuid references auth.users(id) on delete cascade,provider text,primary key(user_id,provider));
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`);
 for(const f of ['001_solaris.sql','003_build60_dm.sql','004_build61_accounts_broadcast.sql','005_build65_accounts_presence_invites.sql','006_build66_google_only.sql','007_build67_sharing_resilience.sql','008_direct_sharing_flow.sql'])await db.exec(await readFile('backend/'+f,'utf8'));
 for(const [i,uid] of [A,B,C].entries()){await db.query('insert into auth.users(id) values($1)',[uid]);await db.query("insert into auth.identities values($1,'google')",[uid]);await db.query('insert into auth.sessions values($1,$1)',[uid]);await rpc(uid,'profile',{user_id:'direct_'+i,nickname:'direct '+i});}
});
beforeEach(async()=>{await db.exec(`delete from solaris_private.broadcasts;delete from solaris_private.sessions;delete from solaris_private.blocks;delete from solaris_private.friends;delete from solaris_private.rate_limits;insert into solaris_private.friends values('${A}','${B}','${A}','accepted');`);});
after(async()=>{await db?.close();});
test('one explicit start opens sharing for existing friends without another acceptance',async()=>{
 const s=await rpc(A,'direct_open',{target:B});assert.equal((await rpc(B,'sync')).sessions.find(x=>x.id===s.id).state,'accepted');
 const b=await rpc(A,'broadcast_start',{scope_kind:'direct',scope_id:s.id,transport:'browser',attempt_id:randomUUID()});
 assert((await rpc(B,'sync')).broadcasts.some(x=>x.id===b.id));assert.equal(await rpc(B,'broadcast_watch',{id:b.id}),true);
 assert((await rpc(B,'signal',{scope_kind:'direct',scope_id:s.id,recipient:A,payload:{type:'media-join',broadcast:b.id}})).id);
});
test('nonfriends, self, anonymous and password-only calls cannot open a direct screen',async()=>{
 for(const [u,t,method] of [[A,C,'oauth'],[A,A,'oauth'],[null,B,'oauth'],[A,B,'password']])await assert.rejects(rpc(u,'direct_open',{target:t},method),/Friendship required|Authentication required/);
});
test('both friends repeatedly open the same active session',async()=>{
 const first=await rpc(A,'direct_open',{target:B}),second=await rpc(B,'direct_open',{target:A});assert.equal(first.id,second.id);
 assert.equal((await db.query("select count(*)::int n from solaris_private.sessions where state='accepted'")).rows[0].n,1);
});
test('a pending old request is promoted in place and legacy starts also need no acceptance',async()=>{
 const id=randomUUID();await db.query("insert into solaris_private.sessions(id,a,b,requester) values($1,$2,$3,$2)",[id,A,B]);
 assert.equal((await rpc(B,'session_request',{target:A})).id,id);assert.equal((await rpc(A,'sync')).sessions[0].state,'accepted');
});
test('blocking revokes direct sharing and prevents reopening',async()=>{
 const s=await rpc(A,'direct_open',{target:B});const b=await rpc(A,'broadcast_start',{scope_kind:'direct',scope_id:s.id,transport:'browser',attempt_id:randomUUID()});
 await rpc(B,'block',{target:A});await assert.rejects(rpc(A,'direct_open',{target:B}),/Friendship required/);await assert.rejects(rpc(B,'broadcast_watch',{id:b.id}),/Broadcast unavailable/);
});
test('explicit end stops publication; opening later creates a new scope',async()=>{
 const s=await rpc(A,'direct_open',{target:B});await rpc(A,'broadcast_start',{scope_kind:'direct',scope_id:s.id,transport:'browser',attempt_id:randomUUID()});
 await rpc(B,'session_end',{id:s.id});assert.equal((await rpc(A,'sync')).broadcasts.length,0);assert.notEqual((await rpc(A,'direct_open',{target:B})).id,s.id);
});
test('viewers retain explicit unwatch control and outsiders cannot watch',async()=>{
 const s=await rpc(A,'direct_open',{target:B}),b=await rpc(A,'broadcast_start',{scope_kind:'direct',scope_id:s.id,transport:'browser',attempt_id:randomUUID()});
 await rpc(B,'broadcast_watch',{id:b.id});await rpc(B,'broadcast_unwatch',{id:b.id});
 await assert.rejects(rpc(C,'broadcast_watch',{id:b.id}),/Broadcast unavailable/);
 assert.equal((await db.query('select count(*)::int n from solaris_private.viewers')).rows[0].n,0);
});
test('migration is identical to documented SQL, repeatable, and keeps accounts and private grants',async()=>{
 const sql=await readFile('backend/008_direct_sharing_flow.sql','utf8');assert.equal(sql,await readFile('supabase/migrations/20261015233314_direct_sharing_flow.sql','utf8'));await db.exec(sql);
 assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,3);
 assert.equal((await db.query("select has_function_privilege('anon','public.solaris_action(text,jsonb)','execute') allowed")).rows[0].allowed,false);
 assert.equal((await db.query("select has_function_privilege('authenticated','solaris_private.action_before_direct_flow(text,jsonb)','execute') allowed")).rows[0].allowed,false);
});
