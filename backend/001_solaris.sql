-- Solaris build55. Apply once in the project owner's Supabase SQL editor.
-- Existing build54 tables are deliberately untouched. No service key in clients.
begin;
create schema if not exists solaris_private;
revoke all on schema solaris_private from public, anon, authenticated;

create table solaris_private.profiles (
  uid uuid primary key references auth.users(id) on delete cascade,
  user_id text not null unique check (user_id ~ '^[a-z0-9_]{3,32}$'),
  nickname text not null check (length(btrim(nickname)) between 1 and 32),
  avatar_path text,
  last_seen timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table solaris_private.friends (
  a uuid not null references solaris_private.profiles(uid) on delete cascade,
  b uuid not null references solaris_private.profiles(uid) on delete cascade,
  requester uuid not null,
  status text not null check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  primary key(a,b), check (a < b), check (requester in (a,b))
);
create table solaris_private.blocks (
  owner uuid not null references solaris_private.profiles(uid) on delete cascade,
  target uuid not null references solaris_private.profiles(uid) on delete cascade,
  primary key(owner,target), check(owner <> target)
);
create table solaris_private.servers (
  id uuid primary key default gen_random_uuid(), owner uuid not null references solaris_private.profiles(uid),
  name text not null check(length(btrim(name)) between 1 and 64),
  invite text not null unique default replace(gen_random_uuid()::text,'-',''),
  created_at timestamptz not null default now()
);
create table solaris_private.members (
  server_id uuid not null references solaris_private.servers(id) on delete cascade,
  uid uuid not null references solaris_private.profiles(uid) on delete cascade,
  primary key(server_id,uid)
);
create table solaris_private.channels (
  id uuid primary key default gen_random_uuid(), server_id uuid not null references solaris_private.servers(id) on delete cascade,
  name text not null check(length(btrim(name)) between 1 and 64), files_enabled boolean not null default true
);
create table solaris_private.channel_presence (
  uid uuid primary key references solaris_private.profiles(uid) on delete cascade,
  channel_id uuid not null references solaris_private.channels(id) on delete cascade,
  last_seen timestamptz not null default now()
);
create table solaris_private.sessions (
  id uuid primary key default gen_random_uuid(), a uuid not null references solaris_private.profiles(uid),
  b uuid not null references solaris_private.profiles(uid), requester uuid not null,
  state text not null default 'requested' check(state in ('requested','accepted','ended')),
  created_at timestamptz not null default now(), check(a < b), check(requester in (a,b))
);
create unique index one_active_session on solaris_private.sessions(a,b) where state <> 'ended';
create table solaris_private.broadcasts (
  id uuid primary key default gen_random_uuid(), publisher uuid not null references solaris_private.profiles(uid),
  scope_kind text not null check(scope_kind in ('direct','channel')), scope_id uuid not null,
  transport text not null check(transport in ('browser','native','replaykit')),
  quality jsonb not null default '{}', ready boolean not null default false, last_seen timestamptz not null default now(),
  unique(publisher,scope_kind,scope_id)
);
create table solaris_private.viewers (
  broadcast_id uuid not null references solaris_private.broadcasts(id) on delete cascade,
  uid uuid not null references solaris_private.profiles(uid), last_seen timestamptz not null default now(),
  primary key(broadcast_id,uid)
);
create table solaris_private.signals (
  id bigint generated always as identity primary key, sender uuid not null,
  recipient uuid not null, scope_kind text not null, scope_id uuid not null,
  payload jsonb not null check(octet_length(payload::text) <= 65536), created_at timestamptz not null default now()
);
create index signals_inbox on solaris_private.signals(recipient,id);
create table solaris_private.rate_limits (
  uid uuid not null, action text not null, started_at timestamptz not null, count integer not null,
  primary key(uid,action,started_at)
);

create function solaris_private.blocked(x uuid,y uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, solaris_private
as $$select exists(select 1 from blocks where (owner=x and target=y) or (owner=y and target=x))$$;
create function solaris_private.are_friends(x uuid,y uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, solaris_private
as $$select not blocked(x,y) and exists(select 1 from friends where a=least(x,y) and b=greatest(x,y) and status='accepted')$$;
create function solaris_private.member(s uuid,u uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, solaris_private
as $$select exists(select 1 from members where server_id=s and uid=u)$$;
create function solaris_private.scope_access(k text,s uuid,u uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, solaris_private
as $$select case k
 when 'direct' then exists(select 1 from sessions where id=s and u in(a,b) and state='accepted' and are_friends(a,b))
 when 'channel' then exists(select 1 from channels where id=s and member(server_id,u))
 else false end$$;
create function solaris_private.can_signal(k text,s uuid,x uuid,y uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, solaris_private
as $$select x<>y and not blocked(x,y) and case k
 when 'friend' then s=y and are_friends(x,y)
 else scope_access(k,s,x) and scope_access(k,s,y) end$$;
create function solaris_private.visible_profile(x uuid,y uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, solaris_private
as $$select x=y or (not blocked(x,y) and (
 exists(select 1 from friends where a=least(x,y) and b=greatest(x,y)) or
 exists(select 1 from members m join members n using(server_id) where m.uid=x and n.uid=y)))$$;
create function solaris_private.rate_guard(u uuid,k text,lim integer) returns void
language plpgsql security definer set search_path = pg_catalog, solaris_private as $$
declare n integer;
begin
 insert into rate_limits values(u,k,date_trunc('minute',now()),1)
 on conflict(uid,action,started_at) do update set count=rate_limits.count+1 returning count into n;
 if n>lim then raise exception 'Too many requests. Try again shortly.' using errcode='P0001'; end if;
end$$;

-- All domain mutations go through an authenticated, narrowly checked RPC.
-- Enabling RLS also prevents accidental direct API grants in the future.
do $$declare t text; begin
 foreach t in array array['profiles','friends','blocks','servers','members','channels','channel_presence','sessions','broadcasts','viewers','signals','rate_limits'] loop
  execute format('alter table solaris_private.%I enable row level security',t);
  execute format('revoke all on solaris_private.%I from public,anon,authenticated',t);
 end loop;
end$$;
create policy own_profile on solaris_private.profiles for select to authenticated using(solaris_private.visible_profile(auth.uid(),uid));
create policy own_friend on solaris_private.friends for select to authenticated using(auth.uid() in(a,b));
create policy own_block on solaris_private.blocks for select to authenticated using(owner=auth.uid());
create policy own_server on solaris_private.servers for select to authenticated using(solaris_private.member(id,auth.uid()));
create policy own_membership on solaris_private.members for select to authenticated using(solaris_private.member(server_id,auth.uid()));
create policy own_channel on solaris_private.channels for select to authenticated using(solaris_private.member(server_id,auth.uid()));
create policy own_session on solaris_private.sessions for select to authenticated using(auth.uid() in(a,b));
create policy own_signal on solaris_private.signals for select to authenticated using(recipient=auth.uid());

create function public.solaris_action(action text,args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,solaris_private as $$
#variable_conflict use_variable
declare u uuid:=auth.uid(); target uuid; sid uuid; cid uuid; rid uuid; seq bigint; r record; result jsonb; n integer; av text;
begin
 if u is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if action='profile' then
  perform rate_guard(u,'profile',20);
  if args ? 'user_id' then
   insert into profiles(uid,user_id,nickname) values(u,lower(btrim(args->>'user_id')),coalesce(nullif(btrim(args->>'nickname'),''),lower(btrim(args->>'user_id'))))
   on conflict(uid) do nothing;
  end if;
  av:=args->>'avatar_path';
  if av is not null and (av not like u::text||'/%' or av like '%..%') then raise exception 'Invalid avatar path'; end if;
  update profiles set nickname=case when args ? 'nickname' then btrim(args->>'nickname') else nickname end,
   avatar_path=case when args ? 'avatar_path' then av else avatar_path end,updated_at=now(),last_seen=now() where uid=u returning to_jsonb(profiles) into result;
  return result;
 end if;
 if not exists(select 1 from profiles where uid=u) then raise exception 'Create your ID first'; end if;
 if action='search' then
  perform rate_guard(u,'search',30);
  select jsonb_build_object('uid',uid,'user_id',user_id,'nickname',nickname,'avatar_path',avatar_path) into result
  from profiles where user_id=lower(btrim(args->>'user_id')) and uid<>u and not blocked(u,uid);
  return result;
 end if;
 if action like 'friend_%' or action in('block','unblock','session_request') then
  target:=(args->>'target')::uuid;
  if target=u or not exists(select 1 from profiles where uid=target) then raise exception 'Invalid user'; end if;
  -- Serialize pair operations, including opposite-direction requests and blocks.
  perform pg_advisory_xact_lock(hashtextextended(least(u,target)::text||greatest(u,target)::text,0));
  if action='unblock' then delete from blocks where owner=u and blocks.target=target; return 'true'; end if;
  if action='block' then
   insert into blocks values(u,target) on conflict do nothing;
   delete from friends where a=least(u,target) and b=greatest(u,target);
   update sessions set state='ended' where a=least(u,target) and b=greatest(u,target);
   delete from broadcasts where scope_kind='direct' and scope_id in(select id from sessions where a=least(u,target) and b=greatest(u,target));
   delete from signals where (sender=u and recipient=target) or(sender=target and recipient=u);
   return 'true';
  end if;
  if blocked(u,target) then raise exception 'Connection unavailable' using errcode='42501'; end if;
  if action='friend_request' then
   perform rate_guard(u,'friend_request',10);
   insert into friends values(least(u,target),greatest(u,target),u,'pending',now()) on conflict do nothing;
  elsif action='friend_accept' then
   update friends set status='accepted' where a=least(u,target) and b=greatest(u,target) and requester=target and status='pending';
   if not found then raise exception 'Request no longer available'; end if;
  elsif action in('friend_reject','friend_cancel') then
   delete from friends where a=least(u,target) and b=greatest(u,target) and status='pending' and
    requester=case action when 'friend_reject' then target else u end;
  elsif action='friend_remove' then
   delete from friends where a=least(u,target) and b=greatest(u,target);
   update sessions set state='ended' where a=least(u,target) and b=greatest(u,target);
   delete from broadcasts where scope_kind='direct' and scope_id in(select id from sessions where a=least(u,target) and b=greatest(u,target));
  elsif action='session_request' then
   if not are_friends(u,target) then raise exception 'Friendship required' using errcode='42501'; end if;
   insert into sessions(a,b,requester) values(least(u,target),greatest(u,target),u)
   on conflict(a,b) where state<>'ended' do update set requester=sessions.requester returning id into rid;
   return jsonb_build_object('id',rid);
  else raise exception 'Unknown friend operation'; end if;
  return 'true';
 end if;
 if action in('session_accept','session_reject','session_end') then
  sid:=(args->>'id')::uuid;
  select * into r from sessions where id=sid for update;
  if not found or u not in(r.a,r.b) then raise exception 'Session unavailable' using errcode='42501'; end if;
  if action='session_accept' then
   if r.requester=u or r.state<>'requested' or not are_friends(r.a,r.b) then raise exception 'Invalid acceptance'; end if;
   update sessions set state='accepted' where id=sid;
  else
   update sessions set state='ended' where id=sid;
   delete from broadcasts where scope_kind='direct' and scope_id=sid;
  end if;
  return 'true';
 end if;
 if action='server_create' then
  perform rate_guard(u,'server_create',5);
  insert into servers(owner,name) values(u,btrim(args->>'name')) returning id into sid;
  insert into members values(sid,u); insert into channels(server_id,name) values(sid,'일반');
  return jsonb_build_object('id',sid);
 elsif action='server_join' then
  perform rate_guard(u,'server_join',20);
  select id into sid from servers where invite=args->>'invite';
  if sid is null then raise exception 'Invalid invitation'; end if;
  insert into members values(sid,u) on conflict do nothing; return jsonb_build_object('id',sid);
 elsif action='server_leave' then
  sid:=(args->>'id')::uuid;
  if exists(select 1 from servers where id=sid and owner=u) then raise exception 'Owner must delete the server'; end if;
  delete from channel_presence where uid=u and channel_id in(select id from channels where server_id=sid);
  delete from broadcasts where publisher=u and scope_kind='channel' and scope_id in(select id from channels where server_id=sid);
  delete from members where server_id=sid and uid=u; return 'true';
 elsif action in('server_rename','server_delete','server_invite','channel_create','channel_update','channel_delete') then
  sid:=(args->>'server_id')::uuid;
  if not exists(select 1 from servers where id=sid and owner=u) then raise exception 'Server owner required' using errcode='42501'; end if;
  if action='server_delete' then
   delete from broadcasts where scope_kind='channel' and scope_id in(select id from channels where server_id=sid);
   delete from servers where id=sid;
  elsif action='server_rename' then update servers set name=btrim(args->>'name') where id=sid;
  elsif action='server_invite' then update servers set invite=replace(gen_random_uuid()::text,'-','') where id=sid;
  elsif action='channel_create' then insert into channels(server_id,name) values(sid,btrim(args->>'name'));
  else
   cid:=(args->>'id')::uuid;
   if action='channel_delete' then
    delete from broadcasts where scope_kind='channel' and scope_id=cid and exists(select 1 from channels where id=cid and server_id=sid);
    delete from channels where id=cid and server_id=sid;
   else update channels set name=coalesce(args->>'name',name),files_enabled=coalesce((args->>'files_enabled')::boolean,files_enabled) where id=cid and server_id=sid; end if;
  end if;
  return 'true';
 elsif action='channel_enter' then
  cid:=(args->>'id')::uuid;
  if not scope_access('channel',cid,u) then raise exception 'Channel unavailable' using errcode='42501'; end if;
  insert into channel_presence values(u,cid,now()) on conflict(uid) do update set channel_id=cid,last_seen=now(); return 'true';
 elsif action='channel_leave' then delete from channel_presence where uid=u; return 'true';
 end if;
 if action='broadcast_start' then
  sid:=(args->>'scope_id')::uuid;
  if not scope_access(args->>'scope_kind',sid,u) then raise exception 'Broadcast permission denied' using errcode='42501'; end if;
  if args->>'scope_kind'='channel' and not exists(select 1 from channel_presence where uid=u and channel_id=sid) then raise exception 'Join the channel first'; end if;
  insert into broadcasts(publisher,scope_kind,scope_id,transport,quality,ready) values(u,args->>'scope_kind',sid,args->>'transport',coalesce(args->'quality','{}'),args->>'transport'='browser')
  on conflict(publisher,scope_kind,scope_id) do update set last_seen=now(),transport=excluded.transport,quality=excluded.quality,ready=excluded.ready returning id into rid;
  return jsonb_build_object('id',rid);
 elsif action='broadcast_stop' then delete from broadcasts where id=(args->>'id')::uuid and publisher=u; return 'true';
 elsif action='broadcast_touch' then
  update broadcasts set last_seen=now(),ready=true where id=(args->>'id')::uuid and publisher=u and scope_access(scope_kind,scope_id,u); return to_jsonb(found);
 elsif action='broadcast_watch' then
  rid:=(args->>'id')::uuid;
  select * into r from broadcasts where id=rid and ready and last_seen>now()-interval '45 seconds' for update;
  if not found or r.publisher=u or blocked(u,r.publisher) or not scope_access(r.scope_kind,r.scope_id,u) then raise exception 'Broadcast unavailable' using errcode='42501'; end if;
  delete from viewers where broadcast_id=rid and last_seen<now()-interval '45 seconds';
  select count(*) into n from viewers where broadcast_id=rid;
  if n>=5 and not exists(select 1 from viewers where broadcast_id=rid and uid=u) then raise exception 'Five viewers already connected'; end if;
  insert into viewers values(rid,u,now()) on conflict(broadcast_id,uid) do update set last_seen=now(); return 'true';
 elsif action='broadcast_unwatch' then delete from viewers where broadcast_id=(args->>'id')::uuid and uid=u; return 'true';
 end if;
 if action='signal' then
  target:=(args->>'recipient')::uuid; sid:=(args->>'scope_id')::uuid;
  if not can_signal(args->>'scope_kind',sid,u,target) then raise exception 'Connection permission denied' using errcode='42501'; end if;
  if (args->'payload'->>'type' like 'file-%' or args->'payload'->>'type'='rtc' and args->'payload'->>'peer' like 'files:%')
     and args->>'scope_kind'='channel' and not exists(select 1 from channels where id=sid and files_enabled) then raise exception 'Channel file sharing disabled' using errcode='42501'; end if;
  if args->'payload'->>'type' like 'media-%' or args->'payload'->>'type' like 'native-%' or
     args->'payload'->>'type'='rtc' and args->'payload'->>'peer' like 'media:%' then
   rid:=coalesce(args->'payload'->>'broadcast',split_part(args->'payload'->>'peer',':',2))::uuid;
   select * into r from broadcasts where id=rid and ready and scope_kind=args->>'scope_kind' and scope_id=sid and last_seen>now()-interval '45 seconds';
   if not found or not (r.publisher=u or r.publisher=target) then raise exception 'Broadcast signaling permission denied' using errcode='42501'; end if;
   if args->'payload'->>'type'<>'media-leave' and not exists(select 1 from viewers where broadcast_id=rid and uid=case when r.publisher=u then target else u end and last_seen>now()-interval '45 seconds') then
    raise exception 'Viewer consent and slot required' using errcode='42501';
   end if;
  end if;
  perform rate_guard(u,'signal',900);
  insert into signals(sender,recipient,scope_kind,scope_id,payload) values(u,target,args->>'scope_kind',sid,args->'payload') returning id into seq;
  return jsonb_build_object('id',seq);
 end if;
 if action='sync' then
  update profiles set last_seen=now() where uid=u;
  update channel_presence set last_seen=now() where uid=u;
  update viewers v set last_seen=now() where uid=u and exists(select 1 from broadcasts b where b.id=v.broadcast_id and scope_access(b.scope_kind,b.scope_id,u));
  -- A publisher must heartbeat independently; sync does not keep ghosts alive.
  delete from broadcasts where last_seen<now()-interval '45 seconds';
  delete from signals where created_at<now()-interval '5 minutes';
  delete from rate_limits where started_at<now()-interval '1 hour';
  return jsonb_build_object(
   'me',(select to_jsonb(p) from profiles p where uid=u),
   'friends',coalesce((select jsonb_agg(to_jsonb(f)||jsonb_build_object('profile',to_jsonb(p),'online',p.last_seen>now()-interval '45 seconds')) from friends f join profiles p on p.uid=case when f.a=u then f.b else f.a end where u in(f.a,f.b) and not blocked(f.a,f.b)),'[]'::jsonb),
   'blocks',coalesce((select jsonb_agg(to_jsonb(p)-'last_seen') from blocks b join profiles p on p.uid=b.target where b.owner=u),'[]'::jsonb),
   'servers',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'owner',s.owner,'invite',case when s.owner=u then s.invite else null end)) from servers s where member(s.id,u)),'[]'::jsonb),
   'channels',coalesce((select jsonb_agg(to_jsonb(c)) from channels c where member(c.server_id,u)),'[]'::jsonb),
   'members',coalesce((select jsonb_agg(jsonb_build_object('server_id',m.server_id,'profile',to_jsonb(p),'channel_id',cp.channel_id,'online',p.last_seen>now()-interval '45 seconds')) from members m join profiles p on p.uid=m.uid left join channel_presence cp on cp.uid=m.uid and cp.last_seen>now()-interval '45 seconds' where member(m.server_id,u) and not blocked(u,m.uid)),'[]'::jsonb),
   'sessions',coalesce((select jsonb_agg(to_jsonb(s)) from sessions s where u in(a,b) and state<>'ended' and are_friends(a,b)),'[]'::jsonb),
   'broadcasts',coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object('profile',to_jsonb(p))) from broadcasts b join profiles p on p.uid=b.publisher where (b.ready or b.publisher=u) and scope_access(b.scope_kind,b.scope_id,u) and not blocked(u,b.publisher)),'[]'::jsonb),
   'signals',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from (select * from signals x where recipient=u and id>coalesce((args->>'cursor')::bigint,0) and not blocked(u,sender) and case scope_kind when 'friend' then are_friends(u,sender) else scope_access(scope_kind,scope_id,u) and scope_access(scope_kind,scope_id,sender) end order by id limit 200) s),'[]'::jsonb)
  );
 end if;
 raise exception 'Unknown action';
end$$;
revoke all on function public.solaris_action(text,jsonb) from public,anon;
grant execute on function public.solaris_action(text,jsonb) to authenticated;
revoke all on all functions in schema solaris_private from public,anon,authenticated;

-- Only small, validated avatars use Storage; video/general files stay P2P.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('solaris-avatars','solaris-avatars',false,524288,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create function public.solaris_avatar_visible(path text) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,solaris_private as $$
begin return auth.uid() is not null and visible_profile(auth.uid(),split_part(path,'/',1)::uuid);
exception when invalid_text_representation then return false; end$$;
revoke all on function public.solaris_avatar_visible(text) from public,anon;
grant execute on function public.solaris_avatar_visible(text) to authenticated;
create policy solaris_avatar_read on storage.objects for select to authenticated using(bucket_id='solaris-avatars' and public.solaris_avatar_visible(name));
create policy solaris_avatar_insert on storage.objects for insert to authenticated with check(bucket_id='solaris-avatars' and (storage.foldername(name))[1]=auth.uid()::text);
create policy solaris_avatar_update on storage.objects for update to authenticated using(bucket_id='solaris-avatars' and (storage.foldername(name))[1]=auth.uid()::text) with check(bucket_id='solaris-avatars' and (storage.foldername(name))[1]=auth.uid()::text);
create policy solaris_avatar_delete on storage.objects for delete to authenticated using(bucket_id='solaris-avatars' and (storage.foldername(name))[1]=auth.uid()::text);
commit;
