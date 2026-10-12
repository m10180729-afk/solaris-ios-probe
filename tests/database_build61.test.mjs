import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
const A=randomUUID(),B=randomUUID(),C=randomUUID();let db,channel,other,direct;
async function rpc(uid,action,args={}){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid??'']);return(await db.query('select public.solaris_action($1,$2::jsonb) result',[action,JSON.stringify(args)])).rows[0].result;}
before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`);
 for(const name of ['001_solaris.sql','003_build60_dm.sql','004_build61_accounts_broadcast.sql'])await db.exec(await readFile('backend/'+name,'utf8'));
 for(const[uid,id]of[[A,'alice'],[B,'bob'],[C,'outsider']]){await db.query('insert into auth.users values($1)',[uid]);await rpc(uid,'profile',{user_id:id,nickname:'같은 닉네임'});}
 await rpc(A,'friend_request',{target:B});await rpc(B,'friend_accept',{target:A});const s=await rpc(A,'server_create',{name:'shared'}),server=(await rpc(A,'sync')).servers.find(x=>x.id===s.id);await rpc(B,'server_join',{invite:server.invite});channel=(await rpc(A,'sync')).channels.find(x=>x.server_id===s.id);other=await rpc(A,'channel_create',{server_id:s.id,name:'other'});await rpc(A,'channel_enter',{id:channel.id});const request=await rpc(A,'session_request',{target:B});await rpc(B,'session_accept',{id:request.id});direct=request.id;
});
after(async()=>db?.close());
const start=(kind='channel',id=channel.id,attempt=randomUUID())=>rpc(A,'broadcast_start',{scope_kind:kind,scope_id:id,transport:'native',attempt_id:attempt});
test('profile intro handles Unicode and syncs through friends and members',async()=>{
 const bio='🌞'.repeat(190);await rpc(A,'profile',{bio});const synced=await rpc(B,'sync');assert.equal(synced.friends.find(f=>f.profile.uid===A).profile.bio,bio);assert.equal(synced.members.find(m=>m.profile.uid===A).profile.bio,bio);
 await assert.rejects(rpc(A,'profile',{bio:'x'.repeat(191)}),/190/);await assert.rejects(rpc(A,'profile',{bio:123}),/Invalid/);assert.equal((await rpc(A,'profile')).bio,bio);
});
test('starting again replaces the old broadcast and removes its viewers',async()=>{
 const first=await start();await rpc(A,'broadcast_touch',{id:first.id});await rpc(B,'broadcast_watch',{id:first.id});const second=await start();const own=(await rpc(A,'sync')).broadcasts.filter(b=>b.publisher===A);assert.deepEqual(own.map(b=>b.id),[second.id]);await rpc(A,'broadcast_touch',{id:second.id});assert.deepEqual((await rpc(B,'sync')).broadcasts.filter(b=>b.publisher===A).map(b=>b.id),[second.id]);assert.equal((await db.query('select count(*)::int n from solaris_private.viewers where broadcast_id=$1',[first.id])).rows[0].n,0);
});
test('one publisher stays unique across channel and direct scopes; stale stops do not end the replacement',async()=>{
 const old=await start(),next=await start('direct',direct);await rpc(A,'broadcast_stop',{id:old.id});assert.equal(await rpc(A,'broadcast_touch',{id:old.id}),false);assert.equal(await rpc(A,'broadcast_touch',{id:next.id}),true);assert.deepEqual((await rpc(B,'sync')).broadcasts.filter(b=>b.publisher===A).map(b=>b.id),[next.id]);
});
test('idempotent retries keep the ID and superseded retries cannot restart an old stream',async()=>{
 const attempt=randomUUID(),first=await start('direct',direct,attempt);assert.equal((await start('direct',direct,attempt)).id,first.id);await start('direct',direct);await assert.rejects(start('direct',direct,attempt),/superseded/);await assert.rejects(start('channel',channel.id,attempt),/mismatch/);
});
test('unauthorized starts do not remove the current broadcast, and private records cannot be read',async()=>{
 const current=await start('direct',direct);await assert.rejects(rpc(A,'broadcast_start',{scope_kind:'direct',scope_id:randomUUID(),transport:'native'}),/permission/);await rpc(A,'broadcast_touch',{id:current.id});assert((await rpc(A,'sync')).broadcasts.some(b=>b.id===current.id));await assert.rejects(rpc(C,'broadcast_watch',{id:current.id}),/unavailable/);
 await db.exec('set role authenticated');try{await assert.rejects(db.query('select * from solaris_private.broadcast_starts'),/permission/);await assert.rejects(db.query("select solaris_private.action_build60('profile','{}')"),/permission/);}finally{await db.exec('reset role');}
});
test('combined upgrades can be reapplied while accounts, profile, friends and messages survive',async()=>{
 await rpc(A,'dm_send',{target:B,client_id:randomUUID(),text:'업데이트 후에도 유지'});const before=await rpc(A,'sync');for(const name of ['003_build60_dm.sql','004_build61_accounts_broadcast.sql','004_build61_accounts_broadcast.sql'])await db.exec(await readFile('backend/'+name,'utf8'));const after=await rpc(A,'sync');assert.equal(after.me.uid,before.me.uid);assert.equal(after.me.bio,before.me.bio);assert.deepEqual(after.friends,before.friends);assert.deepEqual(after.servers,before.servers);assert((await rpc(B,'dm_history',{target:A})).some(m=>m.text==='업데이트 후에도 유지'));
});
