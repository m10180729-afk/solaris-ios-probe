-- Upgrade an existing build55 schema; preserves accounts, UID, friends and servers.
-- Fresh installations already have this change in 001_solaris.sql.
begin;
alter table solaris_private.broadcasts add column if not exists ready boolean not null default true;
alter table solaris_private.broadcasts alter column ready set default false;
create or replace function public.solaris_action(action text,args jsonb default '{}') returns jsonb
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
commit;
