-- A friendship is the direct-sharing boundary; no second request/accept step.
-- Capturing still requires an explicit start, and viewers keep their slot and
-- unwatch controls. Block/remove and Google session checks remain authoritative.
begin;
do $$begin
 if to_regprocedure('solaris_private.action_before_direct_flow(text,jsonb)') is null then
  alter function public.solaris_action(text,jsonb) set schema solaris_private;
  alter function solaris_private.solaris_action(text,jsonb) rename to action_before_direct_flow;
 end if;
end$$;
revoke all on function solaris_private.action_before_direct_flow(text,jsonb) from public,anon,authenticated,service_role;
create or replace function public.solaris_action(action text,args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,solaris_private,pg_temp as $$
#variable_conflict use_variable
declare u uuid:=auth.uid();target uuid;rid uuid;
begin
 if u is null or not active_account(u,auth.jwt()->>'session_id') then
  raise exception 'Authentication required' using errcode='42501';
 end if;
 if action in('direct_open','session_request') then
  target:=(args->>'target')::uuid;
  if target is null or target=u or not are_friends(u,target) then
   raise exception 'Friendship required' using errcode='42501';
  end if;
  perform 1 from profiles where uid in(u,target) order by uid for update;
  perform rate_guard(u,'direct_open',60);
  insert into sessions(a,b,requester,state) values(least(u,target),greatest(u,target),u,'accepted')
   on conflict(a,b) where state<>'ended' do update set state='accepted' returning id into rid;
  return jsonb_build_object('id',rid);
 end if;
 return action_before_direct_flow(action,args);
end$$;
revoke all on function public.solaris_action(text,jsonb) from public,anon;
grant execute on function public.solaris_action(text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
