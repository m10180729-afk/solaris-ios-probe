-- Build65 after 004. Reapplying preserves accounts and existing invitation codes.
-- The account Edge Function uses service-only RPCs; clients never resolve IDs to emails.
begin;
do $$begin
 if to_regprocedure('solaris_private.action_build61(text,jsonb)') is null then
  if to_regprocedure('solaris_private.action_build60(text,jsonb)') is null then raise exception 'Apply 004 first';end if;
  alter function public.solaris_action(text,jsonb) set schema solaris_private;
  alter function solaris_private.solaris_action(text,jsonb) rename to action_build61;
 end if;
end$$;
revoke all on function solaris_private.action_build61(text,jsonb) from public,anon,authenticated;
alter table solaris_private.profiles add column if not exists presence_preference text not null default 'online'
 check(presence_preference in('online','away','dnd','invisible'));
create table if not exists solaris_private.presence_devices(
 uid uuid not null references solaris_private.profiles(uid) on delete cascade,
 device_id uuid not null,session_id uuid not null,last_seen timestamptz not null default now(),
 primary key(uid,device_id)
);
create index if not exists presence_device_age on solaris_private.presence_devices(last_seen);
create table if not exists solaris_private.account_deletions(
 uid uuid primary key references auth.users(id) on delete cascade,
 started_at timestamptz not null default now()
);
create table if not exists solaris_private.login_limits(
 key text not null,started_at timestamptz not null,count integer not null,
 primary key(key,started_at)
);
alter table solaris_private.presence_devices enable row level security;
alter table solaris_private.account_deletions enable row level security;
alter table solaris_private.login_limits enable row level security;
revoke all on solaris_private.presence_devices,solaris_private.account_deletions,solaris_private.login_limits from public,anon,authenticated;

create or replace function solaris_private.active_account(u uuid,s text) returns boolean
language sql stable security definer set search_path=pg_catalog,solaris_private,pg_temp as $$
 select u is not null and exists(select 1 from auth.users where id=u and not is_anonymous and email_confirmed_at is not null)
 and not exists(select 1 from account_deletions where uid=u)
 and exists(select 1 from auth.sessions where user_id=u and id::text=s)
$$;
create or replace function public.solaris_session_active() returns boolean
language sql stable security definer set search_path=pg_catalog,solaris_private,pg_temp as $$
 select active_account(auth.uid(),auth.jwt()->>'session_id')
$$;
revoke all on function public.solaris_session_active() from public,anon;
grant execute on function public.solaris_session_active() to authenticated;

create or replace function solaris_private.presence_status(u uuid) returns text
language sql stable security definer set search_path=pg_catalog,solaris_private,pg_temp as $$
 select case when p.presence_preference='invisible' or exists(select 1 from account_deletions where uid=u)
 or not exists(select 1 from presence_devices d join auth.sessions s on s.id=d.session_id and s.user_id=d.uid
 where d.uid=u and d.last_seen>now()-interval '45 seconds') then 'offline' else p.presence_preference end
 from profiles p where p.uid=u
$$;
create or replace function solaris_private.public_profile(p jsonb,viewer uuid) returns jsonb
language sql immutable set search_path=pg_catalog,solaris_private,pg_temp as $$select case when p->>'uid'=viewer::text then p else p-'last_seen'-'presence_preference' end$$;

-- Initial ID metadata is display data only, never an authorization claim.
-- Reserving it at signup allows ID login after email confirmation even on another device.
create or replace function solaris_private.signup_profile() returns trigger
language plpgsql security definer set search_path=pg_catalog,solaris_private,pg_temp as $$
declare handle text:=lower(btrim(new.raw_user_meta_data->>'solaris_user_id'));nick text;
begin
 if handle is not null then
  if handle !~ '^[a-z0-9_]{3,32}$' then raise exception 'Invalid Solaris ID';end if;
  nick:=coalesce(nullif(btrim(new.raw_user_meta_data->>'solaris_nickname'),''),handle);
  insert into profiles(uid,user_id,nickname) values(new.id,handle,nick);
 end if;
 return new;
end$$;
drop trigger if exists solaris_signup_profile on auth.users;
create trigger solaris_signup_profile after insert on auth.users for each row execute function solaris_private.signup_profile();

-- Auth hard deletion is transactional with all domain cleanup. Storage bytes must
-- first be removed with the Storage API; deleting storage.objects SQL rows is unsafe.
create or replace function solaris_private.delete_account_data() returns trigger
language plpgsql security definer set search_path=pg_catalog,solaris_private,pg_temp as $$
begin
 delete from signals where sender=old.id or recipient=old.id
  or(scope_kind='direct' and scope_id in(select id from sessions where old.id in(a,b)))
  or(scope_kind='channel' and scope_id in(select c.id from channels c join servers s on s.id=c.server_id where s.owner=old.id));
 delete from viewers where uid=old.id;
 delete from broadcasts where publisher=old.id
  or(scope_kind='direct' and scope_id in(select id from sessions where old.id in(a,b)))
  or(scope_kind='channel' and scope_id in(select c.id from channels c join servers s on s.id=c.server_id where s.owner=old.id));
 delete from sessions where old.id in(a,b);
 delete from servers where owner=old.id;
 delete from rate_limits where uid=old.id;
 return old;
end$$;
drop trigger if exists solaris_delete_account_data on auth.users;
create trigger solaris_delete_account_data before delete on auth.users for each row execute function solaris_private.delete_account_data();

-- Narrow service-only operations. The signed role check also fails closed if a
-- future accidental EXECUTE grant exposes the function to a frontend role.
create or replace function public.solaris_account_service(action text,args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,solaris_private,pg_temp as $$
#variable_conflict use_variable
declare u uuid;s text;handle text;email text;key text;n integer;allowed boolean:=true;paths jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'Service required' using errcode='42501';end if;
 if action='login_lookup' then
  handle:=lower(btrim(args->>'user_id'));
  if handle is null or handle !~ '^[a-z0-9_]{3,32}$' or coalesce(args->>'ip_hash','') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('allowed',false);end if;
  -- Commit counters even for rejected passwords; do not raise/roll back here.
  foreach key in array array['ip:'||(args->>'ip_hash'),'id:'||handle,'global'] loop
   insert into login_limits values(key,date_trunc('minute',now()),1)
   on conflict on constraint login_limits_pkey do update set count=login_limits.count+1 returning count into n;
   if n>(case when key='global' then 300 when key like 'ip:%' then 30 else 10 end) then allowed:=false;end if;
  end loop;
  delete from login_limits where started_at<now()-interval '1 hour';
  if not allowed then return jsonb_build_object('allowed',false);end if;
  select a.id,a.email into u,email from profiles p join auth.users a on a.id=p.uid
   where p.user_id=handle and a.email_confirmed_at is not null
   and not exists(select 1 from account_deletions where uid=a.id);
  return jsonb_build_object('allowed',true,'uid',u,'email',email);
 elsif action in('delete_context','delete_begin') then
  u:=(args->>'uid')::uuid;s:=args->>'session_id';
  if u is null or not exists(select 1 from auth.users where id=u)
   or not exists(select 1 from auth.sessions where user_id=u and id::text=s) then raise exception 'Authentication required' using errcode='42501';end if;
  if action='delete_begin' then
   insert into account_deletions(uid) values(u) on conflict do nothing;
   delete from presence_devices where uid=u;
   return jsonb_build_object('deletionStarted',true);
  end if;
  select coalesce(jsonb_agg(name),'[]') into paths from storage.objects
   where bucket_id='solaris-avatars' and split_part(name,'/',1)=u::text;
  -- Reject unexpected storage ownership rather than deleting another app's data.
  return jsonb_build_object('paths',paths,'deletionStarted',exists(select 1 from account_deletions where uid=u));
 end if;
 raise exception 'Unknown account operation';
end$$;
revoke all on function public.solaris_account_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.solaris_account_service(text,jsonb) to service_role;

create or replace function public.solaris_action(action text,args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,solaris_private,pg_temp as $$
#variable_conflict use_variable
declare u uuid:=auth.uid();sid uuid;did uuid;pref text;result jsonb;items jsonb;item jsonb;code text;
begin
 if not active_account(u,auth.jwt()->>'session_id') then raise exception 'Authentication required' using errcode='42501';end if;
 if action='profile' and args?'user_id' then
  if jsonb_typeof(args->'user_id') is distinct from 'string' or lower(btrim(args->>'user_id')) !~ '^[a-z0-9_]{3,32}$' then raise exception 'Invalid Solaris ID';end if;
  if exists(select 1 from profiles where uid=u) then
   update profiles set user_id=lower(btrim(args->>'user_id')),updated_at=now() where uid=u;
  end if;
 elsif action='server_invite' then
  sid:=(args->>'server_id')::uuid;
  if not member(sid,u) then raise exception 'Server member required' using errcode='42501';end if;
  perform rate_guard(u,'server_invite',30);
  select invite into code from servers where id=sid;
  return jsonb_build_object('code',code,'invite',code);
 elsif action in('presence_set','presence_leave') then
  did:=(args->>'device_id')::uuid;
  if did is null or not exists(select 1 from profiles where uid=u) then raise exception 'Profile and device required';end if;
  if action='presence_leave' then
   delete from presence_devices where uid=u and device_id=did;
   return 'true';
  end if;
  pref:=args->>'status';
  if pref is null or pref not in('online','away','dnd','invisible') then raise exception 'Invalid presence';end if;
  perform rate_guard(u,'presence_set',30);
  update profiles set presence_preference=pref where uid=u;
  insert into presence_devices values(u,did,(auth.jwt()->>'session_id')::uuid,now())
   on conflict(uid,device_id) do update set last_seen=now(),session_id=excluded.session_id;
  return jsonb_build_object('presence_preference',pref,'presence_status',presence_status(u));
 end if;
 if action='sync' then
  -- Older clients get a per-auth-session device identity, never one global UID row.
  did:=coalesce((args->>'device_id')::uuid,(auth.jwt()->>'session_id')::uuid);
  if args?'presence_active' and jsonb_typeof(args->'presence_active') is distinct from 'boolean' then raise exception 'Invalid presence activity';end if;
  if args->'presence_active'='false'::jsonb then
   delete from presence_devices where uid=u and device_id=did;
  else
   insert into presence_devices values(u,did,(auth.jwt()->>'session_id')::uuid,now())
    on conflict(uid,device_id) do update set last_seen=now(),session_id=excluded.session_id;
  end if;
  delete from presence_devices where last_seen<now()-interval '5 minutes';
 end if;
 result:=action_build61(action,args);
 if action='sync' then
  foreach code in array array['friends','members'] loop
   items:='[]';
   for item in select value from jsonb_array_elements(result->code) loop
    pref:=coalesce(presence_status((item->'profile'->>'uid')::uuid),'offline');
    item:=item||jsonb_build_object('presence_status',pref,'online',pref<>'offline','profile',public_profile(item->'profile',u));
    items:=items||jsonb_build_array(item);
   end loop;
   result:=jsonb_set(result,array[code],items);
  end loop;
  items:='[]';
  for item in select value from jsonb_array_elements(result->'broadcasts') loop
   items:=items||jsonb_build_array(item||jsonb_build_object('profile',public_profile(item->'profile',u)));
  end loop;
  result:=jsonb_set(result,'{broadcasts}',items);
  items:='[]';
  for item in select value from jsonb_array_elements(result->'blocks') loop items:=items||jsonb_build_array(public_profile(item,u));end loop;
  result:=jsonb_set(result,'{blocks}',items);
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'owner',s.owner,'invite',s.invite)),'[]') into items from servers s where member(s.id,u);
  result:=jsonb_set(result,'{servers}',items);
  result:=jsonb_set(result,'{me,presence_status}',to_jsonb(coalesce(presence_status(u),'offline')));
 end if;
 return result;
end$$;
revoke all on function public.solaris_action(text,jsonb) from public,anon;
grant execute on function public.solaris_action(text,jsonb) to authenticated;
revoke all on all functions in schema solaris_private from public,anon,authenticated;

create or replace function public.solaris_avatar_visible(path text) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,solaris_private,pg_temp as $$
begin return active_account(auth.uid(),auth.jwt()->>'session_id') and visible_profile(auth.uid(),split_part(path,'/',1)::uuid);
exception when invalid_text_representation then return false;end$$;
drop policy if exists solaris_avatar_insert on storage.objects;
drop policy if exists solaris_avatar_update on storage.objects;
drop policy if exists solaris_avatar_delete on storage.objects;
create policy solaris_avatar_insert on storage.objects for insert to authenticated with check(public.solaris_session_active() and bucket_id='solaris-avatars' and (storage.foldername(name))[1]=auth.uid()::text);
create policy solaris_avatar_update on storage.objects for update to authenticated using(public.solaris_session_active() and bucket_id='solaris-avatars' and (storage.foldername(name))[1]=auth.uid()::text) with check(public.solaris_session_active() and bucket_id='solaris-avatars' and (storage.foldername(name))[1]=auth.uid()::text);
create policy solaris_avatar_delete on storage.objects for delete to authenticated using(public.solaris_session_active() and bucket_id='solaris-avatars' and (storage.foldername(name))[1]=auth.uid()::text);
notify pgrst,'reload schema';
commit;
