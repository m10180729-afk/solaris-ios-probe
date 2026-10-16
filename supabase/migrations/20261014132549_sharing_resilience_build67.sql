-- Build67: renew an existing viewer's consent lease through its own heartbeat.
-- Publisher freshness, explicit stop/unwatch, five slots and all original
-- signaling/Google-session validation remain enforced by the existing RPC.
begin;
do $$begin
 if to_regprocedure('solaris_private.active_account(uuid,text)') is null
  or to_regprocedure('solaris_private.account_service_build65(text,jsonb)') is null
 then raise exception 'Apply 006 first';end if;
 if to_regprocedure('solaris_private.action_build66(text,jsonb)') is null then
  alter function public.solaris_action(text,jsonb) set schema solaris_private;
  alter function solaris_private.solaris_action(text,jsonb) rename to action_build66;
 end if;
end$$;
revoke all on function solaris_private.action_build66(text,jsonb) from public,anon,authenticated,service_role;
create or replace function public.solaris_action(action text,args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,solaris_private,pg_temp as $$
#variable_conflict use_variable
declare u uuid:=auth.uid();rid uuid;target uuid;sid uuid;kind text;b record;
begin
 if u is null or not active_account(u,auth.jwt()->>'session_id') then
  raise exception 'Authentication required' using errcode='42501';
 end if;
 if action='signal' and args->'payload'->>'type'='media-heartbeat' then
  rid:=(args->'payload'->>'broadcast')::uuid;target:=(args->>'recipient')::uuid;
  sid:=(args->>'scope_id')::uuid;kind:=args->>'scope_kind';
  if can_signal(kind,sid,u,target) then
   select * into b from broadcasts where id=rid and ready
    and publisher=target and publisher<>u and scope_kind=kind and scope_id=sid
    and last_seen>now()-interval '45 seconds';
   if found then
    -- Like viewer sync, renew a still-existing consent row after a delayed
    -- request. Never recreate an unwatched or reallocated slot. UPDATE's row
    -- lock also makes concurrent slot cleanup observe this renewal or leave
    -- no row for the original signal validator to authorize.
    update viewers set last_seen=now() where broadcast_id=rid and uid=u;
   end if;
  end if;
 end if;
 -- A rejected message/rate limit rolls back the lease renewal in this same
 -- statement, and delegation preserves payload limits and domain checks.
 return action_build66(action,args);
end$$;
revoke all on function public.solaris_action(text,jsonb) from public,anon;
grant execute on function public.solaris_action(text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
