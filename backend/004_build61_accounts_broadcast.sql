-- Build61, after 003_build60_dm.sql. Safe to reapply; no account data reset.
begin;
do $$begin
 if to_regprocedure('solaris_private.action_build60(text,jsonb)') is null then
  if to_regprocedure('solaris_private.action_base(text,jsonb)') is null then
   raise exception 'Apply 003_build60_dm.sql first';
  end if;
  alter function public.solaris_action(text,jsonb) set schema solaris_private;
  alter function solaris_private.solaris_action(text,jsonb) rename to action_build60;
 end if;
end$$;
revoke all on function solaris_private.action_build60(text,jsonb) from public,anon,authenticated;
alter table solaris_private.profiles add column if not exists bio text not null default '' check(length(bio)<=190);
-- Keep the most recent ready broadcast when upgrading older duplicate rows.
delete from solaris_private.broadcasts b using (
 select id,row_number() over(partition by publisher order by ready desc,last_seen desc,id desc) rank
 from solaris_private.broadcasts
) x where b.id=x.id and x.rank>1;
create unique index if not exists one_publisher_broadcast on solaris_private.broadcasts(publisher);
create table if not exists solaris_private.broadcast_starts(
 attempt_id uuid primary key,publisher uuid not null references solaris_private.profiles(uid) on delete cascade,
 scope_kind text not null,scope_id uuid not null,transport text not null,created_at timestamptz not null default now()
);
create index if not exists broadcast_start_age on solaris_private.broadcast_starts(created_at);
alter table solaris_private.broadcast_starts enable row level security;
revoke all on solaris_private.broadcast_starts from public,anon,authenticated;
create or replace function public.solaris_action(action text,args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,solaris_private,pg_temp as $$
#variable_conflict use_variable
declare u uuid:=auth.uid();result jsonb;bid uuid;sid uuid;kind text;mode text;r record;intro text;
begin
 if u is null then raise exception 'Authentication required' using errcode='42501';end if;
 if action='profile' then
  if args?'bio' then
   if jsonb_typeof(args->'bio') is distinct from 'string' then raise exception 'Invalid profile introduction';end if;
   intro:=btrim(args->>'bio');if length(intro)>190 then raise exception 'Profile introduction is limited to 190 characters';end if;
  end if;
  result:=action_build60(action,args-'bio');
  if args?'bio' then update profiles set bio=intro,updated_at=now() where uid=u returning to_jsonb(profiles) into result;end if;
  return result;
 elsif action='broadcast_start' then
  -- Row lock serializes starts from different devices for this account.
  perform 1 from profiles where uid=u for update;
  if not found then raise exception 'Profile required' using errcode='42501';end if;
  kind:=args->>'scope_kind';sid:=(args->>'scope_id')::uuid;mode:=args->>'transport';
  if kind not in('channel','direct') or kind is null or not scope_access(kind,sid,u) then
   raise exception 'Broadcast permission denied' using errcode='42501';end if;
  if kind='channel' and not exists(select 1 from channel_presence where uid=u and channel_id=sid) then
   raise exception 'Join the channel first';end if;
  if mode not in('browser','native','replaykit') or mode is null then raise exception 'Invalid broadcast transport';end if;
  if args?'quality' and jsonb_typeof(args->'quality')<>'object' then raise exception 'Invalid broadcast quality';end if;
  bid:=coalesce((args->>'attempt_id')::uuid,gen_random_uuid());
  select * into r from broadcast_starts where attempt_id=bid;
  if found then
   if r.publisher<>u or r.scope_kind<>kind or r.scope_id<>sid or r.transport<>mode then raise exception 'Broadcast retry mismatch';end if;
   if not exists(select 1 from broadcasts where id=bid and publisher=u) then raise exception 'Broadcast start was superseded';end if;
   return jsonb_build_object('id',bid);
  end if;
  perform rate_guard(u,'broadcast_start',20);
  insert into broadcast_starts(attempt_id,publisher,scope_kind,scope_id,transport) values(bid,u,kind,sid,mode);
  delete from broadcasts where publisher=u;
  insert into broadcasts(id,publisher,scope_kind,scope_id,transport,quality,ready)
   values(bid,u,kind,sid,mode,coalesce(args->'quality','{}'),mode='browser');
  return jsonb_build_object('id',bid);
 end if;
 result:=action_build60(action,args);
 if action='channel_leave' then delete from broadcasts where publisher=u and scope_kind='channel';
 elsif action='channel_enter' then delete from broadcasts where publisher=u and scope_kind='channel' and scope_id<>(args->>'id')::uuid;
 elsif action='sync' then delete from broadcast_starts where created_at<now()-interval '6 hours';end if;
 return result;
end$$;
revoke all on function public.solaris_action(text,jsonb) from public,anon;
grant execute on function public.solaris_action(text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
