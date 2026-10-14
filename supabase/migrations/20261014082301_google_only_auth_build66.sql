-- Build66: Google OAuth only. Preserve every existing user/profile and relation.
begin;
do $$begin
 if to_regprocedure('solaris_private.active_account(uuid,text)') is null then raise exception 'Apply 005 first';end if;
end$$;
create or replace function solaris_private.active_account(u uuid,s text) returns boolean
language sql stable security definer set search_path=pg_catalog,solaris_private,pg_temp as $$
 select u is not null
 and exists(select 1 from auth.users where id=u and not is_anonymous and email_confirmed_at is not null)
 and exists(select 1 from auth.identities where user_id=u and provider='google')
 and coalesce(auth.jwt()->'amr' @> '[{"method":"oauth"}]'::jsonb,false)
 and not exists(select 1 from account_deletions where uid=u)
 and exists(select 1 from auth.sessions where user_id=u and id::text=s)
$$;
revoke all on function solaris_private.active_account(uuid,text) from public,anon,authenticated;
-- Preserve the deletion implementation, but permanently retire ID lookup.
do $$begin
 if to_regprocedure('solaris_private.account_service_build65(text,jsonb)') is null then
  alter function public.solaris_account_service(text,jsonb) set schema solaris_private;
  alter function solaris_private.solaris_account_service(text,jsonb) rename to account_service_build65;
 end if;
end$$;
revoke all on function solaris_private.account_service_build65(text,jsonb) from public,anon,authenticated,service_role;
create or replace function public.solaris_account_service(action text,args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,solaris_private,pg_temp as $$
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'Service required' using errcode='42501';end if;
 if action='login_lookup' then return jsonb_build_object('allowed',false,'code','google_only');end if;
 return account_service_build65(action,args);
end$$;
revoke all on function public.solaris_account_service(text,jsonb) from public,anon,authenticated;
grant execute on function public.solaris_account_service(text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
