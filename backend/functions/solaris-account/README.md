# Solaris account endpoint — build66

Solaris signup and login use Google OAuth only. Apply `backend/006_build66_google_only.sql` after 005, disable the Supabase Email and anonymous providers, and keep Google enabled. Do not reset existing Auth users or Solaris data. Verified same-email Google sign-in can automatically link to an existing account; profile IDs remain searchable handles.

`login_id` is retired: this function returns HTTP 410 `google_only` before any lookup or password request. The service-only SQL wrapper also blocks `login_lookup` without returning a mailbox.

POST `{action:"delete_account"}` with a Bearer access token can delete only that verified UID. The function checks Auth getUser and the live auth.sessions row before removing only that UID's Solaris avatar objects, creating a deletion tombstone and deleting Auth. Its existing data-cleanup trigger removes owned domain data. Partial deletion can be retried with the same live session. Older valid credentials may finish their own account deletion; this cleanup exception does not permit signup, login or RPC/Storage access.

Deploy `solaris-account` with **verify_jwt=false**: deletion implements explicit server-side getUser verification; parsed JWT claims alone never grant authority. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected server-only Edge environment values. Never include a service key in shared/native assets.

Official references checked 2026-10-14:
- https://supabase.com/docs/guides/auth/auth-identity-linking
- https://supabase.com/docs/guides/auth/jwt-fields
- https://supabase.com/docs/guides/auth/managing-user-data
- https://supabase.com/docs/guides/auth/sessions
- https://supabase.com/docs/reference/javascript/storage-from-remove
