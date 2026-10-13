# Solaris account endpoint

Apply `backend/005_build65_accounts_presence_invites.sql` after 004, then deploy
`solaris-account` with **verify_jwt=false**. ID password login has no user JWT;
deletion explicitly validates the supplied user token with Auth getUser and the
live auth.sessions row. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are server-only
Edge environment values. Never place a service key in shared/native assets.

POST JSON `{action:"login_id",user_id,password}` returns an ordinary session only
after password verification and confirmed email. Unknown IDs, incorrect passwords,
and unconfirmed accounts use the same failure. SQL keeps durable IP/ID/global
minute counters; the IP is HMAC hashed. No public email resolver exists.

POST `{action:"delete_account"}` with Bearer access token can delete only that
verified UID. It removes that UID's Solaris avatar objects with the Storage API,
marks a deleting tombstone, then hard-deletes Auth. The Auth trigger removes owned
servers, channels, relationships, DMs, sessions, broadcasts, viewers and signals;
auth.sessions/refresh tokens cascade. A tombstone blocks retained JWTs in RPC and
Storage policies. Partial deletion can be retried with the same live user session.
Other applications' storage/data are never erased by this endpoint.

Official reference checked 2026-10-13:
- https://supabase.com/docs/reference/javascript/auth-signinwithpassword (email/phone, no username API)
- https://supabase.com/docs/guides/auth/managing-user-data (delete Storage first; JWT/session caveat)
- https://supabase.com/docs/guides/auth/sessions (session_id against auth.sessions)
- https://supabase.com/docs/reference/javascript/storage-from-remove

Deploying or operating this endpoint and the migration is an owner operation.
