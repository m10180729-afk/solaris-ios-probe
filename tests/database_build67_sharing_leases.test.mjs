import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

const users=Array.from({length:8},(_,i)=>`${i+1}`.repeat(8)+'-'+`${i+1}`.repeat(4)+'-4'+`${i+1}`.repeat(3)+'-8'+`${i+1}`.repeat(3)+'-'+`${i+1}`.repeat(12));
const [A,B,C,D,E,F,G,O]=users;
const upgrade='backend/007_build67_sharing_resilience.sql';
const official='supabase/migrations/20261014132549_sharing_resilience_build67.sql';
let old,updated;
async function fixture(withUpgrade,withGoogleOnly=true){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz default now(),is_anonymous boolean not null default false,raw_user_meta_data jsonb default '{}');
 create table auth.identities(user_id uuid references auth.users(id) on delete cascade,provider text,primary key(user_id,provider));
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`);
 for(const name of ['001_solaris.sql','003_build60_dm.sql','004_build61_accounts_broadcast.sql','005_build65_accounts_presence_invites.sql',...(withGoogleOnly?['006_build66_google_only.sql']:[])])
  await db.exec(await readFile('backend/'+name,'utf8'));
 const rpc=async(uid,action,args={},amr=['oauth'],session=uid)=>{
  const claims={sub:uid,role:'authenticated',session_id:session};
  if(amr!==null)claims.amr=amr.map(method=>({method,timestamp:1791960000}));
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[uid??'',JSON.stringify(claims)]);
  return(await db.query('select public.solaris_action($1,$2::jsonb) value',[action,JSON.stringify(args)])).rows[0].value;
 };
 for(const [i,uid] of users.entries()){
  await db.query('insert into auth.users(id) values($1)',[uid]);await db.query("insert into auth.identities values($1,'google')",[uid]);
  await db.query('insert into auth.sessions values($1,$1)',[uid]);await rpc(uid,'profile',{user_id:'lease_user_'+i,nickname:'lease '+i});
 }
 const server=await rpc(A,'server_create',{name:'Isolated lease test'}),invite=(await rpc(A,'server_invite',{server_id:server.id})).code;
 for(const uid of users.slice(1,-1))await rpc(uid,'server_join',{invite});
 const channel=(await rpc(A,'sync',{cursor:0})).channels.find(c=>c.server_id===server.id).id;
 await rpc(A,'channel_enter',{id:channel});
 if(withUpgrade)await db.exec(await readFile(upgrade,'utf8'));
 const start=async(transport='browser',watchers=[B])=>{
  const b=await rpc(A,'broadcast_start',{scope_kind:'channel',scope_id:channel,transport,attempt_id:randomUUID()});
  if(transport!=='browser')await rpc(A,'broadcast_touch',{id:b.id});
  for(const uid of watchers)await rpc(uid,'broadcast_watch',{id:b.id});return b.id;
 };
 const signal=(uid,target,broadcast,payload={},amr=['oauth'],scope=channel)=>rpc(uid,'signal',{recipient:target,scope_kind:'channel',scope_id:scope,payload:{type:'media-heartbeat',broadcast,connectionID:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',fps:60,framesDecoded:6000,...payload}},amr);
 const age=async(table,broadcast,seconds,uid)=>{
  const filter=table==='broadcasts'?'id=$2':'broadcast_id=$2 and uid=$3';
  await db.query(`update solaris_private.${table} set last_seen=now()-($1::double precision * interval '1 second') where ${filter}`,uid?[seconds,broadcast,uid]:[seconds,broadcast]);
 };
 const seen=async(table,broadcast,uid)=>{
  const filter=table==='broadcasts'?'id=$1':'broadcast_id=$1 and uid=$2';
  return(await db.query(`select last_seen,extract(epoch from now()-last_seen)::double precision as age from solaris_private.${table} where ${filter}`,uid?[broadcast,uid]:[broadcast])).rows[0]??null;
 };
 const reset=async()=>{
  await db.exec('delete from solaris_private.signals;delete from solaris_private.broadcasts;delete from solaris_private.broadcast_starts;delete from solaris_private.rate_limits;delete from solaris_private.blocks;delete from solaris_private.account_deletions;delete from solaris_private.sessions;delete from solaris_private.friends;');
  await db.exec('update auth.users set is_anonymous=false,email_confirmed_at=now();');
  for(const uid of users)await db.query("insert into auth.identities values($1,'google') on conflict do nothing",[uid]);
  for(const uid of users)await db.query('insert into auth.sessions values($1,$1) on conflict do nothing',[uid]);
  for(const uid of users.slice(0,-1))await db.query('insert into solaris_private.members(server_id,uid) values($1,$2) on conflict do nothing',[server.id,uid]);
  await db.query('insert into solaris_private.channel_presence values($1,$2,now()) on conflict(uid) do update set channel_id=excluded.channel_id,last_seen=now()',[A,channel]);
 };
 return{db,rpc,start,signal,age,seen,reset,channel,server};
}
before(async()=>{
 assert.deepEqual(await readFile(upgrade),await readFile(official),'Official CLI migration and documented SQL must be identical');
 old=await fixture(false);updated=await fixture(true);
});
beforeEach(async()=>{await old.reset();await updated.reset();});
after(async()=>{await old?.db.close();await updated?.db.close();});

test('build66 reproduction: 25-second viewer heartbeat does not renew the viewer lease',async()=>{
 const id=await old.start();await old.age('viewers',id,25,B);await old.signal(B,A,id);
 assert((await old.seen('viewers',id,B)).age>=24);assert((await old.seen('broadcasts',id)).age<2);
});
test('build66 reproduction: delayed sync rejects live viewer heartbeat until sync renews consent',async()=>{
 const id=await old.start();await old.age('viewers',id,46,B);
 await assert.rejects(old.signal(B,A,id),/Viewer consent and slot required/);
 await old.rpc(B,'sync',{cursor:0});assert((await old.signal(B,A,id)).id);
});
test('build66 reproduction: publisher sync alone deletes its 46-second broadcast and viewer rows',async()=>{
 const id=await old.start();await old.age('broadcasts',id,46);
 const s=await old.rpc(A,'sync',{cursor:0});assert(!s.broadcasts.some(b=>b.id===id));
 assert.equal(await old.seen('viewers',id,B),null);assert.equal(await old.rpc(A,'broadcast_touch',{id}),false);
});
test('build66 reproduction: late publisher heartbeat succeeds only before another caller cleans the row',async()=>{
 let id=await old.start();await old.age('broadcasts',id,46);assert.equal(await old.rpc(A,'broadcast_touch',{id}),true);
 assert((await old.rpc(C,'sync',{cursor:0})).broadcasts.some(b=>b.id===id));
 id=await old.start();await old.age('broadcasts',id,46);await old.rpc(C,'sync',{cursor:0});
 assert.equal(await old.rpc(A,'broadcast_touch',{id}),false);
});
test('build66 reproduction: an unfinished native capture consent is also expired by global sync',async()=>{
 const b=await old.rpc(A,'broadcast_start',{scope_kind:'channel',scope_id:old.channel,transport:'native',attempt_id:randomUUID()});
 await old.age('broadcasts',b.id,46);await old.rpc(C,'sync',{cursor:0});
 assert.equal(await old.rpc(A,'broadcast_touch',{id:b.id}),false);
});
test('build66 reproduction: an expired viewer lease blocks a recovery offer until rewatch',async()=>{
 const id=await old.start();await old.age('viewers',id,46,B);
 await assert.rejects(old.signal(A,B,id,{type:'native-offer',sdp:'isolated-fixture'}),/Viewer consent/);
 await old.rpc(B,'broadcast_watch',{id});assert((await old.signal(A,B,id,{type:'native-offer',sdp:'isolated-fixture'})).id);
});
test('build66 reproduction: delayed-sync viewer can lose its slot to a sixth viewer despite earlier heartbeat',async()=>{
 const id=await old.start('browser',[B,C,D,E,F]);await old.age('viewers',id,25,B);await old.signal(B,A,id);
 await old.age('viewers',id,46,B);await old.rpc(G,'broadcast_watch',{id});
 assert.equal(await old.seen('viewers',id,B),null);
 assert.equal((await old.db.query('select count(*)::int n from solaris_private.viewers where broadcast_id=$1',[id])).rows[0].n,5);
});
test('signaling backlog: 200 valid telemetry messages defer a new offer to the next cursor page',async()=>{
 const id=await old.start();for(let i=0;i<200;i++)await old.signal(B,A,id,{framesDecoded:6000+i});
 const offer=await old.signal(B,A,id,{type:'native-receive-offer',sdp:'isolated-fixture'});
 const first=await old.rpc(A,'sync',{cursor:0});assert.equal(first.signals.length,200);assert(first.signals.every(s=>s.payload.type==='media-heartbeat'));
 const cursor=Math.max(...first.signals.map(s=>Number(s.id))),second=await old.rpc(A,'sync',{cursor});
 assert(second.signals.some(s=>Number(s.id)===Number(offer.id)&&s.payload.type==='native-receive-offer'));
});

test('build67: 25-second viewer heartbeat renews only its own consent, not publisher freshness',async()=>{
 const id=await updated.start('browser',[B,C]);await updated.age('viewers',id,25,B);await updated.age('viewers',id,25,C);await updated.age('broadcasts',id,25);
 const other=(await updated.seen('viewers',id,C)).last_seen;
 await updated.signal(B,A,id);assert((await updated.seen('viewers',id,B)).age<2);assert((await updated.seen('broadcasts',id)).age>=24);
 assert.deepEqual((await updated.seen('viewers',id,C)).last_seen,other);
});
test('build67: existing 46-second consent recovers through heartbeat and permits recovery signaling',async()=>{
 const id=await updated.start();await updated.age('viewers',id,46,B);
 await updated.signal(B,A,id);assert((await updated.seen('viewers',id,B)).age<2);
 assert((await updated.signal(A,B,id,{type:'native-offer',sdp:'isolated-fixture'})).id);
});
test('build67: frequent healthy heartbeat retains all five slots; sixth viewer remains denied',async()=>{
 const id=await updated.start('browser',[B,C,D,E,F]);await updated.age('viewers',id,25,B);await updated.signal(B,A,id);
 await assert.rejects(updated.rpc(G,'broadcast_watch',{id}),/Five viewers/);
 assert(await updated.seen('viewers',id,B));assert.equal((await updated.db.query('select count(*)::int n from solaris_private.viewers where broadcast_id=$1',[id])).rows[0].n,5);
});
test('build67: a viewer whose expired slot was reallocated cannot recreate it with a heartbeat',async()=>{
 const id=await updated.start('browser',[B,C,D,E,F]);await updated.age('viewers',id,46,B);
 await updated.rpc(G,'broadcast_watch',{id});assert.equal(await updated.seen('viewers',id,B),null);
 await assert.rejects(updated.signal(B,A,id),/Viewer consent/);
 assert.equal(await updated.seen('viewers',id,B),null);assert(await updated.seen('viewers',id,G));
 assert.equal((await updated.db.query('select count(*)::int n from solaris_private.viewers where broadcast_id=$1',[id])).rows[0].n,5);
});
test('build67: explicit unwatch or stop cannot be resurrected by late heartbeat',async()=>{
 const id=await updated.start();await updated.rpc(B,'broadcast_unwatch',{id});
 await assert.rejects(updated.signal(B,A,id),/Viewer consent/);assert.equal(await updated.seen('viewers',id,B),null);
 await updated.rpc(B,'broadcast_watch',{id});await updated.rpc(A,'broadcast_stop',{id});
 await assert.rejects(updated.signal(B,A,id),/Broadcast signaling/);assert.equal(await updated.seen('broadcasts',id),null);
});
test('build67: publisher stats or publisher heartbeat cannot renew another viewer',async()=>{
 const id=await updated.start();await updated.age('viewers',id,25,B);
 await updated.signal(A,B,id,{type:'media-sender-stats'});await updated.signal(A,B,id);
 assert((await updated.seen('viewers',id,B)).age>=24);
});
test('build67: missing slot, wrong scope and mismatched broadcast publisher cannot gain consent',async()=>{
 const id=await updated.start();await assert.rejects(updated.signal(C,A,id),/Viewer consent/);
 await updated.age('viewers',id,25,B);const prior=(await updated.seen('viewers',id,B)).last_seen;
 await assert.rejects(updated.signal(B,A,id,{},['oauth'],randomUUID()),/permission/i);
 await assert.rejects(updated.signal(B,C,id),/Broadcast signaling/);
 assert.deepEqual((await updated.seen('viewers',id,B)).last_seen,prior);
 assert.equal(await updated.seen('viewers',id,C),null);
});
test('build67: revoked/non-OAuth session cannot renew an existing consent row',async()=>{
 const id=await updated.start();await updated.age('viewers',id,25,B);const prior=(await updated.seen('viewers',id,B)).last_seen;
 await assert.rejects(updated.signal(B,A,id,{},['password']),/Authentication/);
 await updated.db.query('delete from auth.sessions where id=$1',[B]);await assert.rejects(updated.signal(B,A,id),/Authentication/);
 assert.deepEqual((await updated.seen('viewers',id,B)).last_seen,prior);
});
test('build67: Google identity, OAuth AMR, live owned session and active account are required before renewal',async()=>{
 const id=await updated.start();await updated.age('viewers',id,25,B);const prior=(await updated.seen('viewers',id,B)).last_seen;
 const args={recipient:A,scope_kind:'channel',scope_id:updated.channel,payload:{type:'media-heartbeat',broadcast:id}};
 for(const amr of [['password'],['token_refresh'],[],null])await assert.rejects(updated.rpc(B,'signal',args,amr),/Authentication/);
 for(const session of [null,randomUUID(),A])await assert.rejects(updated.rpc(B,'signal',args,['oauth'],session),/Authentication/);
 await assert.rejects(updated.rpc(null,'signal',args),/Authentication/);
 await updated.db.query("delete from auth.identities where user_id=$1 and provider='google'",[B]);
 await updated.db.query("update auth.users set raw_user_meta_data=$2::jsonb where id=$1",[B,JSON.stringify({provider:'google',providers:['google']})]);
 await assert.rejects(updated.signal(B,A,id),/Authentication/);
 await updated.db.query("insert into auth.identities values($1,'google')",[B]);
 await updated.db.query('update auth.users set is_anonymous=true where id=$1',[B]);await assert.rejects(updated.signal(B,A,id),/Authentication/);
 await updated.db.query('update auth.users set is_anonymous=false,email_confirmed_at=null where id=$1',[B]);await assert.rejects(updated.signal(B,A,id),/Authentication/);
 await updated.db.query('update auth.users set email_confirmed_at=now() where id=$1',[B]);
 await updated.db.query('insert into solaris_private.account_deletions(uid) values($1)',[B]);await assert.rejects(updated.signal(B,A,id),/Authentication/);
 assert.deepEqual((await updated.seen('viewers',id,B)).last_seen,prior);
});
test('build67: lost scope membership and blocking both prevent heartbeat renewal',async()=>{
 const id=await updated.start();await updated.age('viewers',id,25,B);const prior=(await updated.seen('viewers',id,B)).last_seen;
 await updated.db.query('delete from solaris_private.members where server_id=$1 and uid=$2',[updated.server.id,B]);await assert.rejects(updated.signal(B,A,id),/permission/i);
 assert.deepEqual((await updated.seen('viewers',id,B)).last_seen,prior);
 await updated.db.query('insert into solaris_private.members values($1,$2)',[updated.server.id,B]);await updated.rpc(B,'block',{target:A});
 await assert.rejects(updated.signal(B,A,id),/permission/i);assert.deepEqual((await updated.seen('viewers',id,B)).last_seen,prior);
});
test('build67: publisher losing membership or blocking its viewer also prevents renewal',async()=>{
 const id=await updated.start();await updated.age('viewers',id,25,B);const prior=(await updated.seen('viewers',id,B)).last_seen;
 await updated.db.query('delete from solaris_private.members where server_id=$1 and uid=$2',[updated.server.id,A]);await assert.rejects(updated.signal(B,A,id),/permission/i);
 await updated.db.query('insert into solaris_private.members values($1,$2)',[updated.server.id,A]);await updated.rpc(A,'block',{target:B});
 await assert.rejects(updated.signal(B,A,id),/permission/i);assert.deepEqual((await updated.seen('viewers',id,B)).last_seen,prior);
});
test('build67: accepted direct-session viewer renews only while the session and friendship remain valid',async()=>{
 const session=randomUUID();
 await updated.db.query("insert into solaris_private.friends(a,b,requester,status) values($1,$2,$1,'accepted')",[A,B]);
 await updated.db.query("insert into solaris_private.sessions(id,a,b,requester,state) values($1,$2,$3,$2,'accepted')",[session,A,B]);
 const b=await updated.rpc(A,'broadcast_start',{scope_kind:'direct',scope_id:session,transport:'browser',attempt_id:randomUUID()});await updated.rpc(B,'broadcast_watch',{id:b.id});
 const args={recipient:A,scope_kind:'direct',scope_id:session,payload:{type:'media-heartbeat',broadcast:b.id}};
 await updated.age('viewers',b.id,46,B);assert((await updated.rpc(B,'signal',args)).id);assert((await updated.seen('viewers',b.id,B)).age<2);
 await updated.age('viewers',b.id,25,B);const prior=(await updated.seen('viewers',b.id,B)).last_seen;
 await updated.db.query("update solaris_private.sessions set state='ended' where id=$1",[session]);await assert.rejects(updated.rpc(B,'signal',args),/permission/i);
 await updated.db.query("update solaris_private.sessions set state='accepted' where id=$1",[session]);
 await updated.db.query("update solaris_private.friends set status='pending' where a=$1 and b=$2",[A,B]);await assert.rejects(updated.rpc(B,'signal',args),/permission/i);
 assert.deepEqual((await updated.seen('viewers',b.id,B)).last_seen,prior);
});
test('build67: expired publisher and unfinished capture readiness cannot be revived by a viewer',async()=>{
 let id=await updated.start();await updated.age('broadcasts',id,46);await assert.rejects(updated.signal(B,A,id),/Broadcast signaling/);
 assert((await updated.seen('broadcasts',id)).age>=45);await updated.rpc(C,'sync',{cursor:0});assert.equal(await updated.seen('broadcasts',id),null);
 const b=await updated.rpc(A,'broadcast_start',{scope_kind:'channel',scope_id:updated.channel,transport:'native',attempt_id:randomUUID()});
 await assert.rejects(updated.signal(B,A,b.id),/Broadcast signaling/);
 assert.equal((await updated.db.query('select ready from solaris_private.broadcasts where id=$1',[b.id])).rows[0].ready,false);
});
test('build67: oversized heartbeat rejected by original payload limit rolls back renewal',async()=>{
 const id=await updated.start();await updated.age('viewers',id,25,B);const prior=(await updated.seen('viewers',id,B)).last_seen;
 await assert.rejects(updated.signal(B,A,id,{extra:'x'.repeat(70000)}),/check constraint/);
 assert.deepEqual((await updated.seen('viewers',id,B)).last_seen,prior);
});
test('build67: original signal rate limit still rejects and rolls back heartbeat renewal',async()=>{
 const id=await updated.start();await updated.age('viewers',id,25,B);const prior=(await updated.seen('viewers',id,B)).last_seen;
 await updated.db.query("insert into solaris_private.rate_limits values($1,'signal',date_trunc('minute',now()),900)",[B]);
 await assert.rejects(updated.signal(B,A,id),/Too many requests/);assert.deepEqual((await updated.seen('viewers',id,B)).last_seen,prior);
 assert.equal((await updated.db.query("select count from solaris_private.rate_limits where uid=$1 and action='signal'",[B])).rows[0].count,900);
});
test('build67: authenticated callers use the guarded public RPC; all client roles lack delegate access',async()=>{
 const id=await updated.start();await updated.signal(B,A,id);await updated.age('viewers',id,25,B);
 const args={recipient:A,scope_kind:'channel',scope_id:updated.channel,payload:{type:'media-heartbeat',broadcast:id}};
 await updated.db.exec('set role authenticated');try{
  assert((await updated.db.query("select public.solaris_action('signal',$1::jsonb) value",[JSON.stringify(args)])).rows[0].value.id);
 }finally{await updated.db.exec('reset role');}
 assert((await updated.seen('viewers',id,B)).age<2);
 for(const role of ['anon','authenticated','service_role']){
  assert.equal((await updated.db.query("select has_function_privilege($1,'solaris_private.action_build66(text,jsonb)','execute') allowed",[role])).rows[0].allowed,false);
  if(role==='authenticated')continue;
  await updated.db.exec('set role '+role);try{
   await assert.rejects(updated.db.query("select public.solaris_action('signal',$1::jsonb)",[JSON.stringify(args)]),/permission denied/);
  }finally{await updated.db.exec('reset role');}
 }
});
test('build67: reapplication preserves profiles/servers/consent and private delegate cannot bypass guards',async()=>{
 const id=await updated.start();
 const snapshot=async()=>{
  const value={};for(const table of ['auth.users','auth.identities','auth.sessions','solaris_private.profiles','solaris_private.servers','solaris_private.channels','solaris_private.members','solaris_private.broadcasts','solaris_private.viewers'])
   value[table]=(await updated.db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') value from ${table} t`)).rows[0].value;
  return value;
 };
 const prior=await snapshot(),delegate=(await updated.db.query("select pg_get_functiondef('solaris_private.action_build66(text,jsonb)'::regprocedure) value")).rows[0].value;
 await updated.db.exec(await readFile(upgrade,'utf8'));assert.deepEqual(await snapshot(),prior);
 assert.equal((await updated.db.query("select pg_get_functiondef('solaris_private.action_build66(text,jsonb)'::regprocedure) value")).rows[0].value,delegate);
 assert(await updated.seen('viewers',id,B));assert((await updated.signal(B,A,id)).id);
 await updated.db.exec('set role authenticated');try{await assert.rejects(updated.db.query("select solaris_private.action_build66('sync','{}')"),/permission denied/);}finally{await updated.db.exec('reset role');}
});
test('build67: requires Google-only build66 before installing its public wrapper',async()=>{
 const baseline=await fixture(false,false);
 try{
  await assert.rejects(baseline.db.exec(await readFile(upgrade,'utf8')),/Apply 006 first/);await baseline.db.exec('rollback');
  assert.equal((await baseline.db.query("select to_regprocedure('solaris_private.action_build66(text,jsonb)') value")).rows[0].value,null);
  assert.equal((await baseline.rpc(A,'profile')).uid,A);
 }finally{await baseline.db.close();}
});
