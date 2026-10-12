-- Build60: persistent friend DMs and a 100MiB ordinary-file limit.
-- Existing installations: run this file only after 001 (and 002 if needed).
-- Reapplying this migration preserves accounts, friends, servers and messages.
begin;
create table if not exists solaris_private.dm_messages (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,
  client_id uuid not null,
  sender uuid not null references solaris_private.profiles(uid) on delete cascade,
  recipient uuid not null references solaris_private.profiles(uid) on delete cascade,
  text text not null check(length(btrim(text)) between 1 and 2000),
  created_at timestamptz not null default now(),
  unique(sender,client_id), check(sender <> recipient)
);
create index if not exists dm_sender_order on solaris_private.dm_messages(sender,seq);
create index if not exists dm_recipient_order on solaris_private.dm_messages(recipient,seq);
create index if not exists dm_pair_order on solaris_private.dm_messages(least(sender,recipient),greatest(sender,recipient),seq);
alter table solaris_private.dm_messages enable row level security;
revoke all on solaris_private.dm_messages from public,anon,authenticated;
do $$begin
  if to_regprocedure('solaris_private.action_base(text,jsonb)') is null then
    alter function public.solaris_action(text,jsonb) set schema solaris_private;
    alter function solaris_private.solaris_action(text,jsonb) rename to action_base;
  end if;
end$$;
revoke all on function solaris_private.action_base(text,jsonb) from public,anon,authenticated;
-- Put temporary schemas last in both the wrapper and existing definer helpers.
do $$declare f record; begin
  for f in select p.oid::regprocedure name from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='solaris_private' and p.prosecdef loop
    execute format('alter function %s set search_path to pg_catalog,solaris_private,pg_temp',f.name);
  end loop;
end$$;

create or replace function public.solaris_action(action text,args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,solaris_private,pg_temp as $$
declare
  u uuid := auth.uid(); target uuid; client uuid; body text;
  row dm_messages; result jsonb; messages jsonb; lim integer; after_seq bigint; before_seq bigint;
begin
  if u is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if action in ('dm_send','dm_history') then
    target := (args->>'target')::uuid;
    if target is null or target=u or not are_friends(u,target) then
      raise exception 'Friend message permission denied' using errcode='42501';
    end if;
    if action='dm_send' then
      client := (args->>'client_id')::uuid; body := btrim(args->>'text');
      if client is null or body is null or length(body) not between 1 and 2000 then
        raise exception 'Invalid message';
      end if;
      select * into row from dm_messages where sender=u and client_id=client;
      if found then
        if row.recipient<>target or row.text<>body then raise exception 'Message retry mismatch'; end if;
        return to_jsonb(row);
      end if;
      perform rate_guard(u,'dm_send',60);
      insert into dm_messages(sender,recipient,client_id,text) values(u,target,client,body)
        on conflict(sender,client_id) do nothing;
      select * into row from dm_messages where sender=u and client_id=client;
      if row.recipient<>target or row.text<>body then raise exception 'Message retry mismatch'; end if;
      return to_jsonb(row);
    end if;
    lim := greatest(1,least(100,coalesce((args->>'limit')::integer,50)));
    after_seq := greatest(0,coalesce((args->>'after')::bigint,0));
    before_seq := coalesce((args->>'before')::bigint,9223372036854775807);
    select coalesce(jsonb_agg(to_jsonb(m) order by m.seq),'[]') into result from (
      select * from dm_messages where least(sender,recipient)=least(u,target)
        and greatest(sender,recipient)=greatest(u,target) and seq>after_seq and seq<before_seq
      order by seq desc limit lim
    ) m;
    return result;
  end if;
  result := solaris_private.action_base(action,args);
  if action='signal' and args->'payload'->>'type'='file-offer' then
    if jsonb_typeof(args->'payload'->'size') is distinct from 'number'
      or (args->'payload'->>'size')::numeric not between 0 and 104857600
      or trunc((args->'payload'->>'size')::numeric)<>(args->'payload'->>'size')::numeric then
      raise exception 'Files are limited to 100MiB';
    end if;
  end if;
  if action='sync' then
    -- DMs do not expire with media signals. An overlapping cursor also catches
    -- nearby transactions that commit after their identity sequence was issued.
    after_seq := greatest(0,coalesce((args->>'dm_cursor')::bigint,0)-200);
    select coalesce(jsonb_agg(to_jsonb(m) order by m.seq),'[]') into messages
    from (
      select * from dm_messages where (sender=u or recipient=u)
        and are_friends(sender,recipient) and seq>after_seq
        and (seq>coalesce((args->>'dm_cursor')::bigint,0) or created_at>now()-interval '30 seconds')
      order by seq desc limit 200
    ) m;
    return result || jsonb_build_object('messages',messages);
  end if;
  return result;
end$$;
revoke all on function public.solaris_action(text,jsonb) from public,anon;
grant execute on function public.solaris_action(text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
