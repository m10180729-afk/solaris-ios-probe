// Real UI/IndexedDB, isolated SQL backend. No public account or network capture.
import{chromium}from'playwright';import{PGlite}from'@electric-sql/pglite';import{createServer}from'node:http';import{readFile,mkdir,writeFile}from'node:fs/promises';import{randomUUID,createHash}from'node:crypto';import{join,extname}from'node:path';import assert from'node:assert/strict';
const out='build/ui-evidence';await mkdir(out,{recursive:true});const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb,email_confirmed_at timestamptz default now(),is_anonymous boolean not null default false);create table auth.identities(user_id uuid references auth.users(id) on delete cascade,provider text,primary key(user_id,provider));create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`);await db.exec(await readFile('backend/001_solaris.sql','utf8'));await db.exec(await readFile('backend/003_build60_dm.sql','utf8'));await db.exec(await readFile('backend/004_build61_accounts_broadcast.sql','utf8'));await db.exec(await readFile('backend/005_build65_accounts_presence_invites.sql','utf8'));await db.exec(await readFile('backend/006_build66_google_only.sql','utf8'));let serial=Promise.resolve();const rpc=(uid,action,args={},authMethod='oauth')=>{const r=serial.then(async()=>{await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[uid,JSON.stringify({sub:uid,session_id:uid,role:'authenticated',amr:[{method:authMethod,timestamp:Math.floor(Date.now()/1000)}]})]);return(await db.query('select public.solaris_action($1,$2::jsonb) result',[action,JSON.stringify(args)])).rows[0].result});serial=r.catch(()=>{});return r;};
const host=createServer(async(req,res)=>{try{const name=new URL(req.url,'http://local').pathname;if(name.includes('..')||!name.startsWith('/shared/')&&!name.startsWith('/ios/App/Resources/Unified/')){res.writeHead(404).end();return;}res.setHeader('Content-Type',extname(name)==='.mjs'?'text/javascript':extname(name)==='.css'?'text/css':extname(name)==='.png'?'image/png':'text/html');res.end(await readFile(join(process.cwd(),name)));}catch{res.writeHead(404).end();}});await new Promise(r=>host.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+host.address().port;let browser;const contexts=[],pages=[],uids=[],errors=[],photos=new Map(),authUsers=new Map(),authRequests=[],oauthCodes=new Map(),results={};
async function seedUser(uid){await db.query('insert into auth.users(id) values($1)',[uid]);await db.query("insert into auth.identities(user_id,provider) values($1,'google')",[uid]);await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[uid]);}
function fixtureGoogleUser(uid,email='google-'+uid.slice(0,8)+'@example.test'){
 return{id:uid,email,email_confirmed_at:new Date().toISOString(),is_anonymous:false,identities:[{provider:'google',id:uid,user_id:uid}],app_metadata:{provider:'google',providers:['google']},user_metadata:{}};
}
async function installFixture(ctx,uid,{authMethod='oauth'}={}){await ctx.route('https://*.supabase.co/**',async route=>{try{const req=route.request(),url=new URL(req.url());let value;if(url.pathname.startsWith('/auth/v1/')){
 const body=req.method()==='GET'?{}:req.postDataJSON()??{},user=authUsers.get(uid),makeSession=()=>({access_token:uid,refresh_token:'fixture-only',expires_at:Date.now()/1000+3600,user});
 const grant=url.searchParams.get('grant_type');authRequests.push({uid,path:url.pathname,method:req.method(),grant});
 if(url.pathname==='/auth/v1/authorize'){
  assert.equal(url.searchParams.get('provider'),'google');assert.equal(url.searchParams.get('code_challenge_method'),'s256');
  const redirect=url.searchParams.get('redirect_to'),challenge=url.searchParams.get('code_challenge');assert.match(challenge,/^[A-Za-z0-9_-]{43}$/);
  const target=new URL(redirect);assert.equal(target.origin,base);assert.equal(target.searchParams.getAll('solaris_state').length,1);
  const code='fixture-oauth-'+randomUUID();oauthCodes.set(code,{uid,challenge});
  // Playwright intercepts only the first URL of an HTTP redirect chain.
  // Separate document navigations keep both synthetic OAuth origins routed;
  // otherwise a 302 here could send the fixture to the real Google website.
  const provider='https://accounts.google.com/o/oauth2/v2/auth?solaris_fixture_redirect='+encodeURIComponent(redirect)+'&solaris_fixture_code='+encodeURIComponent(code);
  await route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><title>Isolated Google authorization fixture</title><script>location.replace('+JSON.stringify(provider)+')</script>'});return;
 }else if(url.pathname==='/auth/v1/user'){
  if(req.method()!=='GET')throw Error('Google-only account does not accept password or email changes');
  if(req.headers().authorization!=='Bearer '+uid){const error=Error('Authentication required');error.status=401;throw error;}
  if(!user){const error=Error('Deleted account session');error.status=401;throw error;}value=user;
 }else if(url.pathname==='/auth/v1/token'){
  if(!user){const error=Error('Deleted account session');error.status=401;throw error;}
  if(grant==='pkce'){
   if(body.auth_code==='fixture-cold-code')assert.match(body.code_verifier,/^fixture-protected-verifier-/);
   else{const proof=oauthCodes.get(body.auth_code);assert(proof&&proof.uid===uid&&proof.providerReached===true,'Only an issued code returned by the isolated Google provider may be exchanged');assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'),proof.challenge,'PKCE verifier must match its authorization challenge');oauthCodes.delete(body.auth_code);}
   authMethod='oauth';value=makeSession();
  }else if(grant==='refresh_token'){assert.equal(body.refresh_token,'fixture-only');value=makeSession();}
  else throw Error('Google-only account does not accept password authentication');
 }else if(url.pathname==='/auth/v1/settings')value={external:{google:true},disable_signup:false};
 else if(url.pathname==='/auth/v1/logout')value={};
 else throw Error('Google-only account does not expose email/password/anonymous authentication');
}else if(url.pathname==='/functions/v1/solaris-account'){
 const body=req.postDataJSON();
 if(body.action==='delete_account'){if(req.headers().authorization!=='Bearer '+uid)throw Error('Authentication required');await db.query('delete from auth.users where id=$1',[uid]);authUsers.delete(uid);value={deleted:true};}
 else throw Error('Google-only account function does not provide password login');
}else if(url.pathname.startsWith('/storage/')){const path=url.pathname.split('solaris-avatars/')[1];if(req.method()==='POST'){photos.set(path,req.postDataBuffer());value={};}else if(req.method()==='DELETE'){photos.delete(path);value={};}else{await route.fulfill({status:photos.has(path)?200:404,body:photos.get(path)??Buffer.alloc(0),contentType:'image/jpeg'});return;}}else{if(req.headers().authorization!=='Bearer '+uid)throw Error('Authentication required');const b=req.postDataJSON();value=await rpc(uid,b.action,b.args,authMethod);}await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});}catch(e){await route.fulfill({status:e.status??403,contentType:'application/json',body:JSON.stringify({message:e.message,code:e.code})});}});
 await ctx.route('https://accounts.google.com/**',async route=>{const source=new URL(route.request().url()),code=source.searchParams.get('solaris_fixture_code'),proof=oauthCodes.get(code);assert(proof&&proof.uid===uid,'Only the context-owned synthetic Google flow is allowed');proof.providerReached=true;const returned=new URL(source.searchParams.get('solaris_fixture_redirect'));assert.equal(returned.origin,base);returned.searchParams.set('code',code);await route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><title>Isolated Google return fixture</title><script>location.replace('+JSON.stringify(returned.href)+')</script>'});});
 await ctx.route('https://api.github.com/repos/**/releases',route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
}
async function signInWithGoogle(page,{userID,nickname}={}){
 await page.locator('#google-login').waitFor({state:'visible'});
 assert.equal(await page.locator('#login,#email-register,#recover,#verify,input[type=password]').count(),0,'Onboarding must expose only Google authentication');
 const requested=page.waitForRequest(r=>r.url().endsWith('/auth/v1/token?grant_type=pkce'));
 await page.locator('#google-login').click();const request=await requested;assert.match(request.postDataJSON().code_verifier,/^[A-Za-z0-9_-]{64}$/);
 if(userID){await page.locator('#register').waitFor({state:'visible'});await page.locator('#register [name=user_id]').fill(userID);await page.locator('#register [name=nickname]').fill(nickname);await page.locator('#register button.primary').click();}
 await page.locator('#workspace').waitFor({state:'visible'});assert(await page.locator('#auth-pending').isHidden());
}
async function verifyGoogleAccountOnly(page){
 await page.getByRole('button',{name:'내 프로필',exact:true}).click();await page.locator('#dialog [data-action=profile-tab][data-id=account]').click();
 await page.getByRole('button',{name:'Google 계정 사용 중',exact:true}).waitFor();assert(await page.getByRole('button',{name:'Google 계정 사용 중',exact:true}).isDisabled());
 assert.equal(await page.locator('#dialog input[type=password],#password-edit,#recovery-link,#link-verify,#dialog [data-action=google-link]').count(),0);
 assert.equal(await page.locator('#dialog [data-profile-pane=account] input,#dialog [data-profile-pane=account] form').count(),0,'Google account settings must be read-only');
 await page.locator('#dialog-close').click();
}
// Playwright's page-side poller constructs a Function, which the real app CSP
// correctly rejects. Keep predicates on page.evaluate and waiting in Node.
async function waitProbe(page,predicate,label,timeout=30000,arg){
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){if(await page.evaluate(predicate,arg))return;await new Promise(resolve=>setTimeout(resolve,100));}
 assert.fail('Timed out waiting for '+label);
}
async function submitProfile(page){
 const original=await page.locator('#profile-edit').elementHandle();
 try{await page.locator('#profile-edit button').click();await waitProbe(page,form=>!form.isConnected,'completed profile save and refreshed form',30000,original);}
 finally{await original.dispose();}
}
async function verifyScriptCSP(page,path){
 const policy=await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
 const script=policy.split(';').find(d=>d.trim().startsWith('script-src '));
 assert(script?.includes("'self'"));assert(!script.includes("'unsafe-eval'"));
 if(path.includes('/Unified/'))assert(script.includes("'sha256-"),'Bundled scripts must retain their exact CSP hash');
 // Evaluate the probe on a later page task, outside DevTools execution.
 await page.evaluate(()=>{window.scriptCSPProbeResult=null;setTimeout(()=>{try{new Function('return true')();window.scriptCSPProbeResult=false;}catch(e){window.scriptCSPProbeResult=e.name==='EvalError';}},0);});
 await waitProbe(page,()=>window.scriptCSPProbeResult!==null,'script CSP enforcement');
 assert.equal(await page.evaluate(()=>window.scriptCSPProbeResult),true,'The actual document must block unsafe eval');
 (results.scriptCSP??=[]).push({path,unsafeEvalBlocked:true,bundledHashRequired:path.includes('/Unified/')});
}
async function profileSaveClosedBeforeResponse(page,ctx,uid){
 await page.getByRole('button',{name:'내 프로필',exact:true}).click();
 const nickname='지연 저장 '+uid.slice(0,6);await page.locator('#profile-edit [name=nickname]').fill(nickname);
 const endpoint='https://*.supabase.co/rest/v1/rpc/solaris_action';let release,started;
 const held=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
 const isSave=r=>r.url().endsWith('/rest/v1/rpc/solaris_action')&&r.postDataJSON()?.action==='profile'&&r.postDataJSON()?.args?.nickname===nickname;
 const hold=async route=>{if(isSave(route.request())){started();await gate;}await route.fallback();};await ctx.route(endpoint,hold);
 try{
  const saved=page.waitForResponse(r=>isSave(r.request())&&r.status()===200);
  await page.locator('#profile-edit button').click();await held;
  await page.locator('#dialog-close').click();await page.locator('#dialog').waitFor({state:'hidden'});
  release();const response=await saved;await response.finished();
  await waitProbe(page,nickname=>document.querySelector('#self-profile')?.textContent.includes(nickname),'late profile save reflected in live account',30000,nickname);
  assert(await page.locator('#dialog').isHidden(),'A closed profile editor must not reopen after a late save');
  assert.equal((await rpc(uid,'profile')).nickname,nickname,'Closing the modal must not discard the acknowledged profile save');
  await page.getByRole('button',{name:'내 프로필',exact:true}).click();assert.equal(await page.locator('#profile-edit [name=nickname]').inputValue(),nickname);await page.locator('#dialog-close').click();
  return{passed:true,closedWhileRPCPending:true,lateResponseDoesNotReopen:true,acknowledgedSavePreserved:true,profileCanBeOpenedAgain:true};
 }finally{release();await ctx.unroute(endpoint,hold);}
}
async function savedGooglePasswordSessionRecovery(path){
 const uid=randomUUID(),other=randomUUID(),user=fixtureGoogleUser(uid),id='restore_'+uid.slice(0,8);
 authUsers.set(uid,user);authUsers.set(other,fixtureGoogleUser(other));await seedUser(uid);await seedUser(other);
 const profile=await rpc(uid,'profile',{user_id:id,nickname:'복구 보존 계정',bio:'기존 계정 소개'});await rpc(other,'profile',{user_id:'stored_friend_'+other.slice(0,8),nickname:'저장된 친구'});
 await rpc(uid,'friend_request',{target:other});await rpc(other,'friend_accept',{target:uid});const server=await rpc(uid,'server_create',{name:'Google 재로그인 보존 서버'}),before=await rpc(uid,'sync',{cursor:0});
 const ctx=await browser.newContext({viewport:{width:1280,height:900}});contexts.push(ctx);await installFixture(ctx,uid,{authMethod:'password'});
 const page=await ctx.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(base+'/shared/index.html');await page.locator('#google-login').waitFor({state:'visible'});
  await page.evaluate(async({uid,user})=>{const{Ledger}=await import('/shared/platform.mjs');await new Ledger().set('auth',{access_token:uid,refresh_token:'fixture-only',expires_at:Date.now()/1000+3600,user});},{uid,user});
  const rejected=page.waitForResponse(r=>r.url().endsWith('/rest/v1/rpc/solaris_action')&&r.request().postDataJSON()?.action==='profile'&&r.status()===403);
  await page.goto(base+path);const response=await rejected,body=await response.json();assert.equal(body.code,'42501');assert.equal(body.message,'Authentication required','The actual SQL OAuth guard must reject the stored password-authenticated session');
  await page.locator('#google-login').waitFor({state:'visible'});await waitProbe(page,()=>!document.querySelector('#google-login').disabled,'Google reauthentication after server session rejection');
  assert(await page.locator('#workspace').isHidden());assert(await page.locator('#register').isHidden());
  assert.equal(await page.evaluate(async()=>{const{Ledger}=await import('/shared/platform.mjs');return new Ledger().get('auth');}),null,'The rejected local session must be retired');
  assert.equal((await rpc(uid,'profile')).uid,uid);assert((await rpc(uid,'sync',{cursor:0})).servers.some(s=>s.id===server.id),'Session rejection must preserve server data');
  await signInWithGoogle(page);assert.equal(await page.evaluate(async()=>{const{Ledger}=await import('/shared/platform.mjs');return(await new Ledger().get('auth')).user.id;}),uid);
  const after=await rpc(uid,'sync',{cursor:0});assert.equal(after.me.uid,uid);assert.equal(after.me.user_id,profile.user_id);assert.equal(after.me.nickname,profile.nickname);assert.equal(after.me.bio,profile.bio);
  assert.deepEqual(after.friends.map(f=>f.profile.uid).sort(),before.friends.map(f=>f.profile.uid).sort());assert.deepEqual(after.servers.map(s=>s.id).sort(),before.servers.map(s=>s.id).sort());
  const lateSave=await profileSaveClosedBeforeResponse(page,ctx,uid);
  return{recovery:{path,passed:true,actualSQLOAuth42501:true,rejectedLocalSessionCleared:true,googleLoginReachable:true,sameUIDAndProfilePreserved:true,friendsAndOwnedServerPreserved:true,realGoogleAccount:false},lateSave:{path,...lateSave}};
 }finally{await ctx.close();contexts.splice(contexts.indexOf(ctx),1);pages.splice(pages.indexOf(page),1);}
}
async function account65Deletion(){
 const uid=randomUUID(),id='delete_'+uid.slice(0,8),user=fixtureGoogleUser(uid,'delete@example.test');
 authUsers.set(uid,user);await seedUser(uid);await rpc(uid,'profile',{user_id:id,nickname:'삭제 확인 계정'});
 const own=await rpc(uid,'server_create',{name:'탈퇴 소유 서버'}),ctx=await browser.newContext({viewport:{width:1280,height:900}});contexts.push(ctx);await installFixture(ctx,uid);
 const p=await ctx.newPage();pages.push(p);p.on('pageerror',e=>errors.push(e.message));
 try{
  await p.goto(base+'/shared/index.html');await signInWithGoogle(p);
  const openDeletion=async()=>{await p.getByRole('button',{name:'내 프로필',exact:true}).click();await p.locator('#dialog [data-action=profile-tab][data-id=account]').click();await p.locator('#dialog [data-action=account-delete]').click();};
  await openDeletion();await p.locator('#delete-account-form input').fill('wrong_id');await p.locator('#delete-account-form button').click();await p.locator('#error').filter({hasText:'ID를 정확히'}).waitFor();assert.equal((await rpc(uid,'profile')).uid,uid);await p.locator('#dialog-close').click();
  const endpoint='https://*.supabase.co/functions/v1/solaris-account',fail=route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'삭제 시작 전 일시 오류',code:'account_delete_incomplete',deletionStarted:false})});
  await ctx.route(endpoint,fail);await openDeletion();await p.locator('#delete-account-form input').fill(id);await p.locator('#delete-account-form button').click();await p.locator('#error').filter({hasText:'삭제 시작 전'}).waitFor();await p.locator('#workspace').waitFor({state:'visible'});assert.equal((await rpc(uid,'profile')).uid,uid);await ctx.unroute(endpoint,fail);
  const partial=async route=>{await db.query('insert into solaris_private.account_deletions(uid) values($1)',[uid]);await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'삭제 정리를 다시 시도하세요.',code:'account_delete_incomplete',deletionStarted:true})});};
  await ctx.route(endpoint,partial);await openDeletion();await p.locator('#delete-account-form input').fill(id);await p.locator('#delete-account-form button').click();
  const retry=p.locator('#deletion-pending-panel [data-action=account-delete-confirm]');await retry.waitFor({state:'visible'});assert(await p.locator('#workspace').isHidden());
  await p.keyboard.press('Escape');assert(await retry.isVisible(),'Closing a dialog must not remove the deletion retry');assert(await p.locator('#google-login').isHidden());assert(await p.locator('#register').isHidden());
  const retained=await p.evaluate(async uid=>{const{Ledger}=await import('/shared/platform.mjs'),ledger=new Ledger();return{uid:(await ledger.get('auth'))?.user.id,pending:await ledger.get('delete-pending:'+uid)};},uid);assert.equal(retained.uid,uid,'Partial deletion retains only the same account session for cleanup retry');assert.equal(retained.pending,true);
  await ctx.unroute(endpoint,partial);let profileRequests=0;const observe=r=>{if(r.url().endsWith('/rest/v1/rpc/solaris_action')&&r.postDataJSON()?.action==='profile')profileRequests++;};ctx.on('request',observe);
  await p.reload();await retry.waitFor({state:'visible'});assert(await p.locator('#workspace').isHidden());assert(await p.locator('#google-login').isHidden());ctx.off('request',observe);assert.equal(profileRequests,0,'Pending deletion must be restored before private profile requests');
  assert.equal(await p.evaluate(async()=>{const{Ledger}=await import('/shared/platform.mjs');return(await new Ledger().get('auth'))?.user.id;}),uid);
  await retry.click();await p.locator('#onboarding-status').filter({hasText:'계정 탈퇴가 완료'}).waitFor();assert.equal((await db.query('select count(*)::int n from auth.users where id=$1',[uid])).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from solaris_private.servers where id=$1',[own.id])).rows[0].n,0);assert.equal(await p.locator('#self-profile').textContent(),'');assert.equal(await p.evaluate(async()=>{const{Ledger}=await import('/shared/platform.mjs');return new Ledger().get('auth');}),null);
  assert.equal(await p.evaluate(async uid=>{const{Ledger}=await import('/shared/platform.mjs');return new Ledger().get('delete-pending:'+uid);},uid),null);assert(await p.locator('#deletion-pending-panel').isHidden());
  await p.reload();await p.locator('#google-login').waitFor({state:'visible'});assert(await p.locator('#workspace').isHidden());assert.equal(await p.locator('#register').isHidden(),true);
  return{passed:true,wrongConfirmationPreservesAccount:true,preCleanupFailurePreservesUID:true,partialCleanupRetrySameUID:true,retrySurvivesEscapeAndReload:true,pendingMarkerCleared:true,noPrivateProfileUntilCleanup:true,ownedServerDeleted:true,protectedSessionCleared:true,deletedUIDRemoved:true,postDeletionGoogleOnboarding:true,edgeFunctionMock:true};
 }finally{await ctx.close();contexts.splice(contexts.indexOf(ctx),1);pages.splice(pages.indexOf(p),1);}
}
async function presence65(a,b){
 for(const[status,publicStatus]of[['away','away'],['dnd','dnd'],['invisible','offline'],['online','online']]){
  await a.locator('#self-status').click();await a.locator('#dialog [data-action=presence-set][data-id='+status+']').click();
  await b.locator('#panel .presence.'+publicStatus).waitFor({state:'visible'});
  const visible=(await rpc(uids[1],'sync',{cursor:0})).friends.find(f=>f.profile.uid===uids[0]);assert.equal(visible.status,'accepted');assert.equal(visible.presence_status,publicStatus);assert.equal(visible.online,status!=='invisible');assert(!('presence_preference'in visible.profile));assert(!('last_seen'in visible.profile));
 }
 return{passed:true,onlineAwayDndInvisible:true,hiddenAppearsOffline:true,friendRelationshipUnchanged:true,privatePreferenceAndLastSeenHidden:true};
}
async function navigation65(a,own){
 await a.locator('#server-rail [data-action=friends]').click();
 const endpoint='https://*.supabase.co/rest/v1/rpc/solaris_action';let release,started;const held=new Promise(r=>started=r),gate=new Promise(r=>release=r);
 const hold=async route=>{if(route.request().postDataJSON()?.action==='channel_enter'){started();await gate;}await route.fallback();};await contexts[0].route(endpoint,hold);
 try{
  await a.locator('#servers [data-id="'+own.id+'"]').click();await held;
  await a.locator('#channels [data-action=friend]').first().click();release();await a.locator('#panel[data-page=direct]').waitFor();await a.locator('#scope-title').filter({hasText:'지구'}).waitFor();
  const synced=await rpc(uids[0],'sync',{cursor:0});assert(synced.members.filter(m=>m.profile.uid===uids[0]).every(m=>!m.channel_id),'Late channel enter must be followed by leave before the chosen DM');assert(!(await a.locator('#messages').textContent()).includes('채널 전용'));
 }finally{release();await contexts[0].unroute(endpoint,hold);}
 await a.locator('#servers [data-id="'+own.id+'"]').click();await a.locator('#panel[data-page=channel]').waitFor();const current=await a.locator('#channels .active').getAttribute('data-id');
 await a.locator('.side-navigation [data-action=transfers]').click();await a.locator('#panel[data-page=transfers]').waitFor();await a.locator('#channels [data-id="'+current+'"]').click();await a.locator('#panel[data-page=channel]').waitFor();assert.equal(await a.locator('#channels .active').getAttribute('data-id'),current);
 await a.locator('#server-rail [data-action=friends]').click();await a.getByRole('button',{name:'지구 개인 메시지',exact:true}).click();
 return{passed:true,lateChannelEnterCannotReplaceDM:true,backendChannelLeft:true,sameChannelRestoresViewFromTransfers:true};
}
// Geometry checks complement the screenshots: document overflow alone misses
// clipped header actions, covered composers and unreachable modal content.
async function captureResponsive(page,name,{conversation=false,dialog=false,touch=false}={}){
 if(dialog)await page.locator('#dialog-close').scrollIntoViewIfNeeded();
 const measurement=await page.evaluate(({conversation,dialog,touch})=>{
  const rect=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
  const visible=n=>n&&!n.hidden&&getComputedStyle(n).display!=='none'&&n.getClientRects().length>0;
  const failures=[],record={viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,dialog,conversation,touch};
  const bounds=(n,label)=>{if(!visible(n)){failures.push(label+' hidden');return null;}const r=rect(n);if(r.x< -1||r.right>innerWidth+1||r.y< -1||r.bottom>innerHeight+1)failures.push(label+' outside viewport');return r;};
  const overlap=(a,b)=>Math.min(a.right,b.right)-Math.max(a.x,b.x)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>1;
  if(document.documentElement.scrollWidth>innerWidth+1)failures.push('document horizontal overflow');
  if(dialog){
   const modal=document.querySelector('#dialog'),r=bounds(modal,'dialog');record.modal=r;
   if(visible(modal)){
    if(modal.scrollWidth>modal.clientWidth+1)failures.push('dialog horizontal overflow');
    const scrollable=[modal,...modal.querySelectorAll('*')].filter(n=>visible(n)&&n.scrollHeight>n.clientHeight+1&&/auto|scroll/.test(getComputedStyle(n).overflowY));
    record.scrollContainers=scrollable.map(n=>({id:n.id,className:n.className,height:n.clientHeight,scrollHeight:n.scrollHeight}));
    record.close=bounds(document.querySelector('#dialog-close'),'dialog close');
    record.fields=[...modal.querySelectorAll('input:not([type=file]),textarea,select')].filter(visible).map(n=>({name:n.name,...rect(n)}));
    if(record.fields.some(n=>n.x<r.x-1||n.right>r.right+1||n.width<100))failures.push('dialog field clipped or too narrow');
   }
  }else{
   const header=document.querySelector('.stage-header');record.header=bounds(header,'stage header');
   const controls=[...header.querySelectorAll('button')].filter(visible).filter(n=>!n.closest('#friend-tabs'));
   record.headerControls=controls.map(n=>({label:n.getAttribute('aria-label')||n.textContent.trim(),...bounds(n,'header '+(n.getAttribute('aria-label')||n.id))}));
   const title=bounds(document.querySelector('#scope-title'),'conversation title');
   if(conversation&&title.width<40)failures.push('conversation title squeezed below 40px');
   for(let i=0;i<record.headerControls.length;i++){
    const current=record.headerControls[i];
    if(overlap(current,title))failures.push('header control covers title: '+current.label);
    for(const other of record.headerControls.slice(i+1))if(overlap(current,other))failures.push('header controls overlap: '+current.label+' / '+other.label);
   }
   if(touch){
    const targets=[...controls,...document.querySelectorAll('#mobile-tabs button,#panel .friend-row [data-action=friend],#panel .friend-row [data-action=friend-menu]')].filter(visible);
    record.touchTargets=targets.map(n=>({label:n.getAttribute('aria-label')||n.textContent.trim(),...rect(n)}));
    for(const n of record.touchTargets)if(n.width<43.5||n.height<43.5)failures.push('touch target smaller than 44px: '+n.label);
    record.friendTabs=[...document.querySelectorAll('#friend-tabs button')].filter(visible).map(n=>({label:n.textContent,...rect(n)}));
    if(record.friendTabs.some(n=>n.height<43.5))failures.push('friend tab smaller than 44px');
   }
   if(conversation){
    record.composer=bounds(document.querySelector('#chat'),'composer');
    record.messageField=bounds(document.querySelector('#chat textarea'),'message field');
    if(record.messageField.width<100)failures.push('message field squeezed below 100px');
    record.attach=bounds(document.querySelector('#compose-attach'),'file attach');record.send=bounds(document.querySelector('#chat-send'),'message send');
    if(overlap(record.attach,record.messageField)||overlap(record.send,record.messageField))failures.push('composer controls cover message field');
    const tabs=document.querySelector('#mobile-tabs');if(visible(tabs)){record.bottomTabs=rect(tabs);if(overlap(record.composer,record.bottomTabs))failures.push('bottom tabs cover composer');}
   }
  }
  record.failures=failures;return record;
 },{conversation,dialog,touch});
 (results.responsiveGeometry??=[]).push({name,...measurement});
 await page.screenshot({path:join(out,name+'.png'),fullPage:true});
 assert.deepEqual(measurement.failures,[],name+': '+measurement.failures.join('; '));
 return measurement;
}
async function responsiveExistingActions(page){
 const cases=[];
 for(const[device,width,height]of[['windows',1280,900],['ipad',1024,768],['small-desktop',860,720],['phone',390,844]]){
  const phone=width<=760;await page.setViewportSize({width,height});
  await page.locator(phone?'#mobile-tabs [data-action=mobile-friends]':'#server-rail [data-action=friends]').click();
  await page.locator('#friend-tabs [data-action=friend-filter][data-id=all]').click();
  await page.locator('#panel [data-action=friend]').first().waitFor({state:'visible'});
  await captureResponsive(page,device,{touch:phone});
  // The broad identity target and compact message icon must both retain the
  // same conversation navigation after the friend row is restyled.
  for(const target of['.friend-row-main','.friend-action-group [data-action=friend]']){
   await page.locator('#panel '+target).first().click();await page.locator('#panel[data-page=direct]').waitFor();
   await page.locator(phone?'#mobile-tabs [data-action=mobile-friends]':'#server-rail [data-action=friends]').click();
   await page.locator('#friend-tabs [data-action=friend-filter][data-id=all]').click();
  }
  const menuAction=page.locator('#panel [data-action=friend-menu]').first(),anchor=await menuAction.boundingBox(),menuUID=await menuAction.getAttribute('data-id');
  assert(anchor,'The menu trigger must have a visible target');await menuAction.click();
  await page.locator('#dialog').waitFor({state:'visible'});const menuGeometry=await captureResponsive(page,'friend-menu-'+device,{dialog:true});
  const anchored=await page.locator('#dialog').evaluate(n=>n.classList.contains('anchored-context'));
  assert.equal(anchored,!phone,'Only desktop menus should use the trigger anchor');
  if(!phone){
   const popup=menuGeometry.modal;
   assert(Math.abs(popup.right-(anchor.x+anchor.width))<=8,'Desktop menu must align near its trigger right edge');
   const below=popup.y-(anchor.y+anchor.height),above=anchor.y-popup.bottom;
   assert(below>=-1&&below<=12||above>=-1&&above<=12,'Desktop menu must open below or flip directly above the trigger');
  }
  await page.keyboard.press('Escape');await page.locator('#dialog').waitFor({state:'hidden'});
  // Hiding the dialog is synchronous; its close event restores focus on a
  // later browser task. Observe that completion instead of racing the event.
  await waitProbe(page,uid=>document.activeElement?.dataset.action==='friend-menu'&&document.activeElement.dataset.id===uid,
                  'Escape returns focus to the original friend menu',5000,menuUID);
  assert.equal(await menuAction.evaluate(n=>document.activeElement===n),true,'Escape must restore focus to the original menu trigger');
  await menuAction.click();await page.locator('#dialog').waitFor({state:'visible'});
  if(!phone){
   // Desktop menus now close on an outside click. That close must reset the
   // same popup state and restore focus before opening the menu again.
   await page.mouse.click(8,height-8);await page.locator('#dialog').waitFor({state:'hidden'});
   await waitProbe(page,uid=>document.activeElement?.dataset.action==='friend-menu'&&document.activeElement.dataset.id===uid,
                   'Outside close returns focus to the original friend menu',5000,menuUID);
   assert.equal(await menuAction.evaluate(n=>document.activeElement===n),true,'Outside close must restore the menu trigger focus');
   await menuAction.click();await page.locator('#dialog').waitFor({state:'visible'});
  }
  await page.locator('#dialog [data-action=friend]').click();await page.locator('#panel[data-page=direct]').waitFor();
  await page.locator('#messages .message-row').last().scrollIntoViewIfNeeded();
  await captureResponsive(page,'dm-'+device,{conversation:true,touch:phone});
  await page.locator('#session-more').click();await page.locator('#dialog [data-action=quality-details]').click();
  await page.locator('#quality-details').waitFor();await captureResponsive(page,'diagnostics-'+device,{dialog:true});await page.locator('#dialog-close').click();
  const members=page.locator('[data-action=toggle-people]'),membersVisible=await members.isVisible();
  if(membersVisible){
   await members.click();assert.equal(await members.getAttribute('aria-expanded'),'true');
   const people=await page.locator('#people').boundingBox();assert(people&&people.x>=0&&people.x+people.width<=width+1);
   await page.screenshot({path:join(out,'people-'+device+'.png'),fullPage:true});
   await page.locator('[data-action=close-people]').click();assert.equal(await members.getAttribute('aria-expanded'),'false');
   assert.equal(await page.locator('body').evaluate(n=>n.contains(document.activeElement)&&document.activeElement.dataset.action==='toggle-people'),true);
  }
  await page.locator(phone?'#mobile-tabs [data-action=mobile-profile]':'[data-action=settings]').click();
  await page.locator('#dialog [data-action=profile-tab][data-id=profile]').click();
  await page.locator('#profile-edit').waitFor();await captureResponsive(page,'profile-'+device,{dialog:true});
  await page.locator('#avatar-file').scrollIntoViewIfNeeded();
  const upload=await page.locator('.upload-photo-button').boundingBox();assert(upload&&upload.y>=0&&upload.y+upload.height<=height+1,'profile upload must be reachable by scrolling');
  await page.locator('#dialog [data-action=profile-tab][data-id=account]').click();
  await page.getByRole('button',{name:'Google 계정 사용 중',exact:true}).waitFor();assert(await page.getByRole('button',{name:'Google 계정 사용 중',exact:true}).isDisabled());assert.equal(await page.locator('#password-edit,#recovery-link,#link-verify,#dialog input[type=password],#dialog [data-action=google-link]').count(),0);await captureResponsive(page,'account-'+device,{dialog:true});
  await page.locator('#dialog [data-action=account-delete]').scrollIntoViewIfNeeded();
  const deletion=await page.locator('#dialog [data-action=account-delete]').boundingBox();assert(deletion&&deletion.y>=0&&deletion.y+deletion.height<=height+1,'account deletion must be reachable by scrolling');
  await page.locator('#dialog [data-action=settings]').click();await page.locator('#settings-edit').waitFor();
  await captureResponsive(page,'settings-'+device,{dialog:true});
  assert.equal(await page.locator('#dialog').evaluate(n=>getComputedStyle(n).resize),phone?'none':'both');
  await page.locator('#dialog-close').click();
  await page.locator(phone?'#mobile-tabs [data-action=mobile-files]':'.side-navigation [data-action=transfers]').click();
  await page.locator('#stage[data-page=transfers]').waitFor();await captureResponsive(page,'files-'+device,{touch:phone});
  cases.push({device,width,height,contextPopup:{anchor,dialog:menuGeometry.modal,anchored,escapeReturnsFocus:true,outsideClickReturnsFocus:phone?null:true},
              friendRowAndIconOpenConversation:true,friendMenuOpensConversation:true,conversationDiagnosticsReachable:true,peopleCloseReturnsFocus:membersVisible?true:null,
              profileAndAccountScrollReachable:true,settingsAndTransferNavigation:true});
 }
 await page.setViewportSize({width:1280,height:900});
 results.responsiveExistingFeatureActions={passed:true,physicalDevices:false,cases};
}
async function acceptIncomingScreenRequest(page){
 await page.locator('#incoming-request').waitFor({state:'visible'});
 await page.locator('#incoming-request').click();
 assert.equal(await page.locator('#header-actions [data-action=toggle-people]').getAttribute('aria-expanded'),'true',
              'The actual request banner must open the consent panel');
 assert.equal(await page.locator('#people').isVisible(),true,
              'The consent panel must remain visible on the friends page after opening it');
 await page.locator('#requests').getByRole('button',{name:'수락',exact:true}).click();
 await page.locator('#incoming-request').waitFor({state:'hidden'});
}
async function installNativeAuthProbe(ctx,{state,verifier,platform='ios',uid=null,providerError=false}){
 await ctx.addInitScript(({state,verifier,platform,uid,user,providerError})=>{
  const flow={kind:uid?'google-link':'google',base:platform==='windows'?'http://127.0.0.1:43854/auth/callback':'solaris://auth/callback',state,verifier,email:null,uid,expires:Date.now()+600000};
  const session=uid?{user,access_token:uid,refresh_token:'fixture-only',expires_at:Date.now()/1000+3600}:null;
  const vault=new Map([['session',JSON.stringify(session)],['auth-flow',JSON.stringify(flow)]]),calls=[];
  const emit=detail=>window.dispatchEvent(new CustomEvent('solaris-native',{detail}));let heldResume=false,pendingReturn=null;
  const returned=flow.base+'?solaris_state='+state+(providerError?'&error=oauth_callback_error&error_code=identity_already_exists':'&code=fixture-cold-code');
  window.authProbe={calls,resumeHeld:false,sessionReads:0,acknowledgements:0};
  window.authProbeSavedSession=()=>JSON.parse(vault.get('session')??'null');
  window.authProbeSavedFlow=()=>JSON.parse(vault.get('auth-flow')??'null');
  window.authProbePendingReturn=()=>pendingReturn;
  window.deliverAuthCallback=()=>{pendingReturn=returned;emit({type:'auth-callback',url:returned});};
  window.recoverAuthOnForeground=()=>{pendingReturn=returned;if(platform==='windows')window.dispatchEvent(new Event('focus'));else{emit({type:'lifecycle',state:'background'});emit({type:'lifecycle',state:'foreground'});}};
  window.webkit={messageHandlers:{solaris:{postMessage(m){
   calls.push(m.command);let result=true;
   if(m.command==='platform')result={platform,nativeReceive:true};
   if(m.command==='vaultGet'){result=vault.get(m.args.key)??null;if(m.args.key==='session')window.authProbe.sessionReads++;}
   if(m.command==='vaultSet')vault.set(m.args.key,m.args.value);
   if(m.command==='authTake')result=pendingReturn;
   if(m.command==='authAck'){window.authProbe.acknowledgements++;result=pendingReturn===m.args.url;if(result)pendingReturn=null;}
   if(m.command==='authCancel')pendingReturn=null;
   if(m.command==='authListen'&&!heldResume){heldResume=true;window.authProbe.resumeHeld=true;window.releaseAuthResume=()=>{window.authProbe.resumeHeld=false;emit({requestId:m.requestId,result:true});};return;}
   if(m.command==='mediaStatus')result={active:false};
   queueMicrotask(()=>emit({requestId:m.requestId,result}));
  }}}};
 },{state,verifier,platform,uid,user:uid?authUsers.get(uid):null,providerError});
}
async function coldNativeAuthReturn(path,{failExchange=false,failBeforeResume=false,platform='ios',foregroundReturn=false}={}){
 const uid=randomUUID(),state=randomUUID(),verifier='fixture-protected-verifier-'.repeat(3);
 authUsers.set(uid,fixtureGoogleUser(uid));
 await seedUser(uid);await rpc(uid,'profile',{user_id:'cold_'+uid.slice(0,8),nickname:'복귀 계정'});
 const ctx=await browser.newContext({viewport:{width:390,height:844}});contexts.push(ctx);await installFixture(ctx,uid);
 let releasePKCE,exchangeStarted,exchangeCalls=0;
 const blockedPKCE=new Promise(resolve=>releasePKCE=resolve),startedPKCE=new Promise(resolve=>exchangeStarted=resolve);
 await ctx.route(/\/auth\/v1\/token\?grant_type=pkce$/,async route=>{
  exchangeCalls++;assert.equal(route.request().postDataJSON().code_verifier,verifier);exchangeStarted();await blockedPKCE;
  if(failExchange)await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'fixture authentication failed',code:'invalid_grant'})});
  else await route.fallback();
 });
 await installNativeAuthProbe(ctx,{state,verifier,platform});
 const p=await ctx.newPage();pages.push(p);p.on('pageerror',e=>errors.push(e.message));
 try{
  await p.goto(base+path);await waitProbe(p,()=>window.authProbe?.resumeHeld,'native startup resume');
  // The callback starts exchanging its protected PKCE verifier while startup
  // is still awaiting resume(). Release resume/boot before the token response.
  const requested=p.waitForRequest(r=>r.url().endsWith('/auth/v1/token?grant_type=pkce'));
  await p.evaluate(viaForeground=>{if(viaForeground)window.recoverAuthOnForeground();else window.deliverAuthCallback();},foregroundReturn);await requested;await startedPKCE;
  if(failBeforeResume){releasePKCE();await p.locator('#error').filter({hasText:'fixture authentication failed'}).waitFor({state:'visible'});}
  await p.evaluate(()=>window.releaseAuthResume());await p.locator('#onboarding').waitFor({state:'visible'});releasePKCE();
  if(failExchange){
   await p.locator('#error').filter({hasText:'fixture authentication failed'}).waitFor({state:'visible'});
   assert(await p.locator('#auth-pending').isHidden());assert.equal(await p.locator('#google-login').isEnabled(),true);
   assert.match(await p.locator('#onboarding-status').textContent(),/다시 시도/);
   assert.equal(await p.evaluate(()=>window.authProbeSavedSession()),null);assert.equal(await p.evaluate(()=>window.authProbeSavedFlow()),null);
   await p.locator('#google-login').click();await p.locator('#auth-pending').waitFor({state:'visible'});
   assert(await p.evaluate(()=>window.authProbe.calls.includes('authOpen')));
   assert.notEqual(await p.evaluate(()=>window.authProbeSavedFlow().state),state);
   const freshState=await p.evaluate(()=>window.authProbeSavedFlow().state);
   await p.evaluate(()=>window.deliverAuthCallback());
   await waitProbe(p,()=>window.authProbePendingReturn()===null,'retired failure callback acknowledgement');
   assert.equal(await p.evaluate(()=>window.authProbeSavedFlow().state),freshState,'An old failed callback must not erase a fresh Google request');
   assert(await p.locator('#auth-pending').isVisible());assert.equal(exchangeCalls,1);
  }else{
   await p.locator('#workspace').waitFor({state:'visible'});assert(await p.locator('#error').isHidden());assert(await p.locator('#auth-pending').isHidden());
   assert.equal(await p.evaluate(()=>window.authProbeSavedSession().user.id),uid);
   assert.equal(await p.evaluate(()=>window.authProbeSavedFlow()),null);
   await p.evaluate(()=>window.deliverAuthCallback());await p.locator('#workspace').waitFor({state:'visible'});assert.equal(exchangeCalls,1);
  }
  await waitProbe(p,()=>window.authProbe.acknowledgements>0&&window.authProbePendingReturn()===null,'processed callback acknowledgement');
  assert.equal(await p.evaluate(()=>window.authProbe.sessionReads),1,'Startup must not reread the vault and invalidate the callback exchange');
  return{path,platform,passed:true,retiredFailureCannotCancelFreshRequest:failExchange,failureThenFreshRetry:failExchange,failureBeforeResume:failBeforeResume,recoveredViaForeground:foregroundReturn,processedReturnAcknowledged:true};
 }finally{releasePKCE();await ctx.close();contexts.splice(contexts.indexOf(ctx),1);pages.splice(pages.indexOf(p),1);}
}
async function nativeLinkedIdentityFailure(path,platform='ios'){
 const uid=randomUUID(),state=randomUUID(),verifier='fixture-protected-verifier-'.repeat(3);
 authUsers.set(uid,fixtureGoogleUser(uid));
 await seedUser(uid);const profile=await rpc(uid,'profile',{user_id:'linked_'+uid.slice(0,8),nickname:'연결 유지 계정'});
 const server=await rpc(uid,'server_create',{name:'기존 계정 서버'});
 const ctx=await browser.newContext({viewport:{width:390,height:844}});contexts.push(ctx);await installFixture(ctx,uid);
 await installNativeAuthProbe(ctx,{state,verifier,platform,uid,providerError:true});
 let exchangeCalls=0;ctx.on('request',r=>{if(r.url().includes('/auth/v1/token?grant_type=pkce'))exchangeCalls++;});
 const p=await ctx.newPage();pages.push(p);p.on('pageerror',e=>errors.push(e.message));
 try{
  await p.goto(base+path);await waitProbe(p,()=>window.authProbe?.resumeHeld,'native startup resume');await p.evaluate(()=>window.deliverAuthCallback());
  await p.locator('#error').filter({hasText:'이미 Solaris 계정에 연결'}).waitFor({state:'visible'});assert(await p.locator('#auth-pending').isHidden());
  assert.match(await p.locator('#error').textContent(),/로그아웃하고 첫 화면의 Google 로그인/);
  await p.evaluate(()=>window.releaseAuthResume());await p.locator('#workspace').waitFor({state:'visible'});
  await waitProbe(p,()=>window.authProbe.acknowledgements>0&&window.authProbePendingReturn()===null,'provider error acknowledgement');
  assert.equal(exchangeCalls,0,'Provider errors must never exchange a code or switch accounts');
  assert.equal(await p.evaluate(()=>window.authProbeSavedSession().user.id),uid);assert.equal(await p.evaluate(()=>window.authProbeSavedFlow()),null);
  await p.evaluate(()=>window.deliverAuthCallback());assert.match(await p.locator('#error').textContent(),/이미 Solaris 계정에 연결/);
  assert.equal(await p.evaluate(()=>window.authProbe.calls.includes('authCancel')),false,'Conflict must not cancel or sign out the current account');
  assert.equal((await rpc(uid,'profile')).user_id,profile.user_id);assert((await rpc(uid,'sync',{cursor:0})).servers.some(s=>s.id===server.id));
  await p.getByRole('button',{name:'내 프로필',exact:true}).click();await p.locator('#dialog-content').getByRole('button',{name:'내 계정',exact:true}).click();
  assert.equal(await p.getByRole('button',{name:'Google 계정 사용 중',exact:true}).isDisabled(),true);
  assert.equal(await p.locator('#dialog [data-action=google-link],#password-edit,#recovery-link').count(),0);
  return{path,platform,passed:true,identityConflictVisible:true,processedReturnAcknowledged:true,originalAccountAndServerPreserved:true,verifiedGoogleIdentityDisablesLink:true};
 }finally{await ctx.close();contexts.splice(contexts.indexOf(ctx),1);pages.splice(pages.indexOf(p),1);}
}
try{browser=await chromium.launch({headless:true,...(process.env.SOLARIS_BROWSER_EXECUTABLE?{executablePath:process.env.SOLARIS_BROWSER_EXECUTABLE}:{})});for(let i=0;i<2;i++){
 const uid=randomUUID();uids.push(uid);authUsers.set(uid,fixtureGoogleUser(uid));await seedUser(uid);
 const ctx=await browser.newContext({viewport:{width:1280,height:900}});contexts.push(ctx);await installFixture(ctx,uid);
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));pages.push(p);const path=i?'/ios/App/Resources/Unified/unified.html':'/shared/index.html';await p.goto(base+path);await verifyScriptCSP(p,path);
 await p.locator('#google-login').waitFor({state:'visible'});assert(await p.locator('#register').isHidden());assert.equal(await rpc(uid,'profile'),null,'A signed-out page must not create an ID profile');
 if(i){
  const requested=p.waitForRequest(r=>r.url().endsWith('/auth/v1/token?grant_type=pkce'));await p.locator('#google-login').click();await requested;await p.locator('#register').waitFor({state:'visible'});
  await p.locator('#register [name=user_id]').fill('alice');await p.locator('#register [name=nickname]').fill('지구');await p.locator('#register button.primary').click();await p.locator('#error').waitFor({state:'visible'});assert.equal(await rpc(uid,'profile'),null,'Duplicate ID rejection must not claim another profile');
  await p.locator('#register [name=user_id]').fill('bob');await p.locator('#register button.primary').click();await p.locator('#workspace').waitFor({state:'visible'});
 }else await signInWithGoogle(p,{userID:'alice',nickname:'솔라'});
 assert.equal((await rpc(uid,'profile')).uid,uid);
 (results.googleOnlyOnboarding??={passed:true,realGoogleAccount:false,pkceChallengeVerified:true,newIDClaimAfterGoogle:true,duplicateIDCannotTakeAnotherProfile:true,cases:[]}).cases.push({path,uidPreserved:true});
 }
 const[a,b]=pages;
 // A Google account can cancel sign-out without losing its current UID.
 await a.getByRole('button',{name:'설정',exact:true}).click();await a.locator('#dialog [data-action=logout]').click();await a.getByText(/같은 Google 계정으로 다시 로그인/).waitFor();await a.getByRole('button',{name:'취소',exact:true}).click();assert(await a.locator('#workspace').isVisible());assert.equal((await rpc(uids[0],'profile')).uid,uids[0]);if(await a.locator('#dialog').isVisible())await a.locator('#dialog-close').click();results.googleLogoutVisibleAndCancelable=true;
 await a.getByRole('button',{name:'친구 추가',exact:true}).click();await a.locator('#friend-search input').fill('bob');await new Promise(r=>setTimeout(r,2500));assert.equal(await a.locator('#friend-search input').inputValue(),'bob');await a.locator('#friend-search button').click();await a.getByRole('button',{name:'친구 요청 보내기',exact:true}).click();await b.getByRole('button',{name:'대기 중',exact:true}).click();await b.getByRole('button',{name:'수락',exact:true}).click();await a.getByRole('button',{name:'모두',exact:true}).click();await b.getByRole('button',{name:'모두',exact:true}).click();await a.locator('#panel [data-action=friend-menu]').first().click();await a.getByRole('button',{name:'화면공유 요청',exact:true}).click();await acceptIncomingScreenRequest(b);await a.locator('#scope-title').filter({hasText:'지구'}).waitFor();assert((await rpc(uids[1],'sync',{cursor:0})).sessions.some(s=>s.state==='accepted'&&s.a===uids[0]&&s.b===uids[1]||s.state==='accepted'&&s.a===uids[1]&&s.b===uids[0]));results.accountFriendsDirect=true;
 await a.getByRole('button',{name:'내 프로필',exact:true}).click();await a.locator('#profile-edit [name=nickname]').fill('태양');await a.locator('#profile-edit textarea').fill('태양처럼 밝게 🌞');await submitProfile(a);await a.locator('#dialog-close').click();await b.locator('#panel strong').filter({hasText:'태양'}).waitFor();await a.getByRole('button',{name:'내 프로필',exact:true}).click();await a.locator('#avatar-file').setInputFiles({name:'profile.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH4sAAAAASUVORK5CYII=','base64')});await a.locator('#dialog').waitFor({state:'hidden'});await b.locator('#panel img').waitFor();assert.equal(photos.size,1);results.profileAvatar=true;results.presence65=await presence65(a,b);
 await a.reload();await a.locator('#workspace').waitFor({state:'visible'});results.restartPersistence=true;
 await a.getByRole('button',{name:'설정',exact:true}).click();await a.locator('select[name=updateChannel]').selectOption('stable');await a.locator('input[name=maxReceive]').fill('3');await a.getByRole('button',{name:'설정 저장',exact:true}).click();results.settings=true;
 await a.getByRole('button',{name:'설정',exact:true}).click();await a.getByRole('button',{name:'프로필',exact:true}).click();await a.locator('#profile-edit').waitFor();await a.getByRole('button',{name:'앱 설정',exact:true}).click();await a.locator('#settings-edit').waitFor();assert.equal(await a.locator('#dialog').evaluate(n=>getComputedStyle(n).resize),'both');await a.getByRole('button',{name:'업데이트 확인',exact:true}).click();await a.getByText('선택한 업데이트 채널에 공개된 버전이 없습니다.',{exact:true}).waitFor();await a.locator('#dialog-close').click();
 await a.getByRole('button',{name:'대화 메뉴',exact:true}).click();await a.getByRole('button',{name:'연결 및 화면공유 상태',exact:true}).click();await a.locator('#quality-details').waitFor();await a.getByText('화면을 시청하면 실제 FPS와 네트워크 상태가 여기에 표시됩니다.',{exact:true}).waitFor();const downloadPromise=a.waitForEvent('download');await a.getByRole('button',{name:'진단 파일 저장',exact:true}).click();assert.match((await downloadPromise).suggestedFilename(),/^Solaris-diagnostics-.*\.json$/);assert(!await a.locator('#diagnostic-json').textContent().then(t=>/fixture-access|fixture-only|fixture-password/.test(t)));await a.locator('#dialog-close').click();assert(await a.locator('#compose-attach').isVisible());results.unifiedSettingsAndUsableDiagnostics=true;

 assert.equal(await a.locator('#quality').count(),0);assert.equal(await b.locator('#panel .presence.online').count(),1);assert.equal(await a.locator('#self-profile .presence.online').count(),1);results.highQualityOnlyAndPresence=true;
 const created=await rpc(uids[0],'server_create',{name:'Solaris UI test'}),serverID=created.id;const state=await rpc(uids[0],'sync',{cursor:0}),server=state.servers.find(s=>s.id===serverID);await rpc(uids[1],'server_join',{invite:server.invite});
 await b.getByRole('button',{name:'Solaris UI test',exact:true}).click();await b.locator('#channels [data-action="channel"]').first().click();assert.equal(await b.locator('#server-tools [data-action="server-leave"]').count(),0);assert.equal(await b.locator('#channels [data-action="server-leave"]').count(),0);
 await b.locator('#server-tools [data-action=server-invite]').click();await b.locator('#server-invite-code').waitFor();assert.equal(await b.locator('#server-invite-code').inputValue(),server.invite);assert(await b.locator('#server-invite-code').getAttribute('readonly')!==null);await b.getByRole('button',{name:'초대코드 복사',exact:true}).click();await b.locator('#invite-status').filter({hasText:/복사/}).waitFor();await b.locator('#dialog-close').click();results.memberInvite65={passed:true,memberCanOpenStableCode:true,copyOrSelectFallbackReachable:true};
 await b.getByRole('button',{name:'서버 메뉴',exact:true}).click();const leave=b.getByRole('button',{name:'서버 탈퇴',exact:true});assert(await leave.evaluate(n=>n.closest('.danger-zone')&&n.classList.contains('danger')));await leave.click();await b.getByRole('button',{name:'취소',exact:true}).click();assert((await rpc(uids[1],'sync',{cursor:0})).servers.some(s=>s.id===serverID));await b.getByRole('button',{name:'서버 탈퇴',exact:true}).click();await b.locator('#confirm-action').click();await b.locator('#dialog').waitFor({state:'hidden'});assert(!(await rpc(uids[1],'sync',{cursor:0})).servers.some(s=>s.id===serverID));results.serverLeaveSeparatedAndConfirmed=true;
 // Google relogin retains the UID, mutable display ID, friends and direct consent.
 await verifyGoogleAccountOnly(a);results.googleAccountSettingsReadOnly=true;
 await a.getByRole('button',{name:'내 프로필',exact:true}).click();await a.locator('#profile-edit [name=user_id]').fill('alice_google');await submitProfile(a);assert.equal((await rpc(uids[0],'profile')).uid,uids[0]);
 const retainedBefore=await rpc(uids[0],'sync',{cursor:0});
 await a.locator('#dialog [data-action=profile-tab][data-id=account]').click();
 const offline=route=>route.abort('internetdisconnected');await contexts[0].route('https://*.supabase.co/**',offline);await a.getByRole('button',{name:'로그아웃',exact:true}).click();await a.locator('#confirm-action').click();await a.locator('#google-login').waitFor({state:'visible'});await a.getByText(/서버의 로그인 종료 확인은 받지 못했습니다/).waitFor();assert.equal(await a.locator('#self-profile').textContent(),'');assert.equal(await a.locator('#messages').textContent(),'');assert.equal(await a.locator('#channels').textContent(),'');await a.reload();await a.locator('#google-login').waitFor({state:'visible'});assert(await a.locator('#workspace').isHidden());await contexts[0].unroute('https://*.supabase.co/**',offline);results.offlineLogoutClearsPrivateUIAndStaysSignedOut=true;
 await signInWithGoogle(a);await a.locator('#scope-title').filter({hasText:'지구'}).waitFor();const restored=await rpc(uids[0],'sync',{cursor:0});
 assert.equal(restored.me.uid,uids[0]);assert.equal(restored.me.user_id,'alice_google');assert.deepEqual(restored.friends.map(f=>f.profile.uid).sort(),retainedBefore.friends.map(f=>f.profile.uid).sort());assert.deepEqual(restored.sessions.map(v=>v.id).sort(),retainedBefore.sessions.map(v=>v.id).sort());
 await verifyGoogleAccountOnly(a);results.googleReloginSameUID={passed:true,idProfilePreserved:true,friendsAndConsentPreserved:true};
 results.googlePKCEWithSimulatedProvider={passed:true,realGoogleAccount:false,connectedLinkDisabled:true,readOnlyAccount:true,noEmailPasswordControls:true,reloginSameUID:true};
 // A selected DM is a dedicated conversation, and channel changes preserve privacy.
 await b.getByRole('button',{name:'태양 개인 메시지',exact:true}).click();await a.locator('#chat textarea').fill('친구 전용 메시지');await a.locator('#chat-send').click();await b.locator('#messages').filter({hasText:'친구 전용 메시지'}).waitFor();
 await a.getByRole('button',{name:'서버 만들기',exact:true}).click();await a.locator('#server-create-form input').fill('함께하는 공간');await a.locator('#server-create-form button').click();
 await a.locator('#scope-title').filter({hasText:'일반'}).waitFor();assert(!(await a.locator('#messages').textContent()).includes('친구 전용 메시지'));
 const createdState=await rpc(uids[0],'sync',{cursor:0}),own=createdState.servers.find(s=>s.name==='함께하는 공간');assert(own&&own.owner===uids[0]);assert(createdState.members.some(m=>m.profile.uid===uids[0]&&m.server_id===own.id&&m.channel_id));
 await a.getByRole('button',{name:'서버 메뉴',exact:true}).click();await a.locator('#dialog').getByRole('button',{name:'채널 만들기',exact:true}).click();await a.locator('#channel-create-form input').fill('게임');await a.locator('#channel-create-form button').click();await a.locator('#channel-create-form').waitFor({state:'hidden'});await a.locator('#dialog-close').click();await a.locator('#channels [data-action=channel]').filter({hasText:'게임'}).click();await a.locator('#scope-title').filter({hasText:'게임'}).waitFor();
 await a.getByRole('button',{name:'친구',exact:true}).first().click();await a.getByRole('button',{name:'지구 개인 메시지',exact:true}).click();await a.locator('#panel[data-page=direct]').waitFor();assert((await a.locator('#messages').textContent()).includes('친구 전용 메시지'));
 const left=await rpc(uids[0],'sync',{cursor:0});assert(left.members.filter(m=>m.profile.uid===uids[0]).every(m=>!m.channel_id));results.serverCreateChannelAndDMNavigation=true;results.navigation65=await navigation65(a,own);
 // A friend DM does not need screen-sharing consent, and survives offline delivery.
 const session=(await rpc(uids[0],'sync',{cursor:0})).sessions.find(x=>x.state==='accepted');if(session)await rpc(uids[0],'session_end',{id:session.id});
 await a.getByRole('button',{name:'지구 개인 메시지',exact:true}).click();await a.locator('.compact-session').waitFor({state:'hidden'});
 await a.locator('#chat textarea').fill('화면 연결 없이');await a.locator('#chat textarea').press('Shift+Enter');await a.locator('#chat textarea').pressSequentially('둘째 줄');await a.locator('#chat textarea').press('Enter');
 await b.locator('#messages .message-text').filter({hasText:'둘째 줄'}).waitFor();assert.equal(await a.locator('#chat textarea').inputValue(),'');
 assert((await b.locator('#messages .message-text').filter({hasText:'둘째 줄'}).textContent()).includes('\n'));results.dmWithoutScreenSessionAndMultiline=true;
 await b.goto('about:blank');await a.locator('#chat textarea').fill('오프라인 친구에게 남긴 메시지');await a.locator('#chat textarea').press('Enter');
 await a.locator('#messages .message-row:not(.sending)').filter({hasText:'오프라인 친구에게 남긴 메시지'}).waitFor();
 await b.goto(base+'/ios/App/Resources/Unified/unified.html');await b.locator('#workspace').waitFor({state:'visible'});await b.getByRole('button',{name:'태양 개인 메시지',exact:true}).click();await b.locator('#messages').filter({hasText:'오프라인 친구에게 남긴 메시지'}).waitFor();
 await a.reload();await a.locator('#workspace').waitFor({state:'visible'});await a.locator('#messages').filter({hasText:'오프라인 친구에게 남긴 메시지'}).waitFor();results.offlineDMPersistsAndReloads=true;
 await b.locator('#chat textarea').fill('반가워! 여기서 대화를 이어가자.');await b.locator('#chat textarea').press('Enter');await a.locator('#messages .message-text').filter({hasText:'여기서 대화를 이어가자.'}).waitFor();results.bidirectionalDM=true;
 // Inject only the native bridge, then exercise production Media cleanup and app UI.
 // Native platform capture/fullscreen itself is not tested by this browser fixture.
 await a.evaluate(async()=>{
  const{Media}=await import('/shared/media.mjs'),{Bridge}=await import('/shared/platform.mjs');
  const watch=Media.prototype.watch,platform=Media.prototype.platform,call=Bridge.prototype.call;window.nativeProbeCalls=[];window.dispatchEvent(new CustomEvent('solaris-native',{detail:{type:'window-state',platform:'ios'}}));
  window.pendingNativeStop=new Promise(resolve=>window.finishNativeStop=resolve);
  Media.prototype.platform=async()=>({platform:'ios',nativeReceive:true});
  Media.prototype.watch=function(b){window.nativeProbe=this;this.bridge.native=true;return watch.call(this,b)};
  Bridge.prototype.call=async function(command,args){nativeProbeCalls.push({command,args});
   if(command==='mediaReceiveStop')return pendingNativeStop;
   if(command==='mediaReceiveFullscreen'){const cover=document.createElement('div');cover.id='native-fullscreen-probe';cover.style.cssText='position:fixed;inset:0;background:black;z-index:9999';document.body.append(cover);}
   if(command==='fullscreen'&&!args.enabled)document.getElementById('native-fullscreen-probe')?.remove();
   return true;
  };
  window.restoreNativeProbe=()=>{Media.prototype.watch=watch;Media.prototype.platform=platform;Bridge.prototype.call=call;nativeProbe.bridge.native=false;};
 });
 const personal=await rpc(uids[0],'session_request',{target:uids[1]});await rpc(uids[1],'session_accept',{id:personal.id});
 const nativeBroadcast=await rpc(uids[1],'broadcast_start',{scope_kind:'direct',scope_id:personal.id,transport:'replaykit'});await rpc(uids[1],'broadcast_touch',{id:nativeBroadcast.id});
 await a.locator('#video-'+nativeBroadcast.id+' video').waitFor({state:'visible'});
 await a.evaluate(async id=>{const receiver=nativeProbe.nativeReceivers.get(id);await nativeProbe.nativeEvent({type:'media-receiver-stats',id,connectionID:receiver.connectionID,stats:{active:true,state:'connected',frames:12,fps:60,width:1920,height:1080,qualityMeasured:false}});await nativeProbe.tick();},nativeBroadcast.id);
 const zoomViewport=a.locator('#video-'+nativeBroadcast.id+' .video-viewport');await zoomViewport.hover();await a.mouse.wheel(0,-500);await waitProbe(a,id=>Number(document.querySelector('#video-'+id+' .video-viewport').dataset.zoom)>100,'wheel video zoom',30000,nativeBroadcast.id);await a.locator('#video-'+nativeBroadcast.id).getByRole('button',{name:'화면 확대 초기화',exact:true}).click();await waitProbe(a,id=>document.querySelector('#video-'+id+' .video-viewport').dataset.zoom==='100','video zoom reset',30000,nativeBroadcast.id);results.zoom65={passed:true,wheelChangesZoom:true,resetReturnsFit:true,physicalPinch:false};
 await a.locator('#video-'+nativeBroadcast.id).getByRole('button',{name:'전체화면',exact:true}).click();await a.locator('#native-fullscreen-probe').waitFor();
 await a.evaluate(id=>nativeProbe.failWatch(id,new Error('Injected native connection failure')),nativeBroadcast.id);
 assert.equal(await a.locator('#native-fullscreen-probe').count(),0);assert.equal(await a.locator('#video-'+nativeBroadcast.id+' video').count(),0);
 await a.locator('#video-'+nativeBroadcast.id).getByRole('button',{name:'다시 시청',exact:true}).waitFor();
 assert(!(await a.locator('#share').isDisabled()));await a.locator('#chat textarea').fill('실패 후에도 입력 가능');
 await a.getByRole('button',{name:'내 프로필',exact:true}).click();await a.locator('#dialog').waitFor();await a.locator('#dialog-close').click();
 await a.evaluate(()=>{finishNativeStop(true);restoreNativeProbe();});await rpc(uids[1],'broadcast_stop',{id:nativeBroadcast.id});await rpc(uids[0],'session_end',{id:personal.id});
 results.failureRestoresVideoControlsAndTouchWithDelayedNativeStop={passed:true,nativeBridgeInjected:true,physicalDevice:false};
 await a.getByRole('button',{name:'지구 개인 메시지',exact:true}).click();
 // Unchanged polling preserves the live form and its focus.
 await a.getByRole('button',{name:'친구',exact:true}).first().click();await a.getByRole('button',{name:'친구 추가',exact:true}).click();await a.locator('#friend-search input').fill('typing');const stable=await a.locator('#friend-search input').evaluate(n=>{n.dataset.probe='retained';return n.dataset.probe;});await new Promise(r=>setTimeout(r,2500));assert.equal(await a.locator('#friend-search input').getAttribute('data-probe'),stable);assert.equal(await a.locator('#friend-search input').inputValue(),'typing');results.stablePollingDOM=true;

 await a.setViewportSize({width:390,height:844});await a.getByRole('button',{name:'채널 목록 열기',exact:true}).click();await a.getByRole('button',{name:'내 프로필',exact:true}).first().waitFor({state:'visible'});await a.locator('#nav-scrim').click({position:{x:378,y:90}}).catch(async()=>{await a.locator('#nav-toggle').click();});assert.equal(await a.locator('#nav-toggle').getAttribute('aria-expanded'),'false');results.mobileDrawer=true;await a.setViewportSize({width:1280,height:900});
 // A separate touch context uses actual coarse-pointer media queries.
 const touch=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,storageState:await contexts[0].storageState({indexedDB:true})});contexts.push(touch);await installFixture(touch,uids[0]);const mobile=await touch.newPage();pages.push(mobile);mobile.on('pageerror',e=>errors.push(e.message));await mobile.goto(base+'/shared/index.html');await mobile.locator('#workspace').waitFor({state:'visible'});
 await mobile.locator('#mobile-tabs [data-action=mobile-menu]').click();await mobile.getByRole('button',{name:'지구 개인 메시지',exact:true}).click();const composer=mobile.locator('#chat textarea');await composer.fill('모바일 첫 줄');await composer.press('Enter');assert.equal(await composer.inputValue(),'모바일 첫 줄\n');await composer.type('둘째 줄');await mobile.locator('#chat-send').click();await mobile.locator('#messages').filter({hasText:'모바일 첫 줄\n둘째 줄'}).waitFor();assert.equal(await composer.inputValue(),'');assert.equal(await composer.evaluate(n=>n.style.height),'auto');assert(await mobile.locator('#share').isVisible());assert(await mobile.locator('#share').isEnabled());assert.match(await mobile.locator('#share').getAttribute('aria-label'),/화면공유/);assert.equal(await mobile.locator('#share').getAttribute('title'),await mobile.locator('#share').getAttribute('aria-label'));assert.equal(await mobile.locator('#share .ui-icon').count(),1);assert(await mobile.locator('#compose-attach').isVisible());await mobile.locator('#mobile-tabs [data-action=mobile-menu]').click();await mobile.keyboard.press('Escape');assert.equal(await mobile.locator('#nav-toggle').getAttribute('aria-expanded'),'false');results.mobileShareLabelAndDrawerEscape=true;
 await mobile.locator('#mobile-tabs [data-action=mobile-profile]').click();await mobile.locator('#profile-edit [name=bio]').fill('🌞'.repeat(190));assert.equal(await mobile.locator('.field-counter').textContent(),'190 / 190');await captureResponsive(mobile,'profile-touch-phone',{dialog:true});await submitProfile(mobile);await mobile.locator('#dialog-close').click();assert.equal((await rpc(uids[0],'profile')).bio,'🌞'.repeat(190));await captureResponsive(mobile,'dm-touch-phone',{conversation:true,touch:true});results.mobileTouchComposerAndProfile={passed:true,physicalDevice:false};
 await touch.close();contexts.splice(contexts.indexOf(touch),1);pages.pop();
 // Exercise shared Windows controls against an injected bridge, including an
 // event that arrives before the command reply and a native Escape/F11 exit.
 const win=await browser.newContext({viewport:{width:1280,height:900},storageState:await contexts[0].storageState({indexedDB:true})});contexts.push(win);await installFixture(win,uids[0]);
 await win.addInitScript(({uid,user})=>{
  const vault=new Map([['session',JSON.stringify({access_token:uid,refresh_token:'fixture-only',expires_at:Date.now()/1000+3600,user})]]);let state={platform:'windows',state:'normal',fullscreen:false};window.windowProbeCalls=[];
  const emit=detail=>window.dispatchEvent(new CustomEvent('solaris-native',{detail}));
  window.SolarisNative={postMessage(raw){const m=JSON.parse(raw);window.windowProbeCalls.push({command:m.command,args:m.args});let result=true;
   if(m.command==='vaultGet')result=vault.get(m.args.key)??null;
   if(m.command==='vaultSet')vault.set(m.args.key,m.args.value);
   if(m.command==='platform'||m.command==='windowState')result={...state};
   if(m.command==='authTake')result=null;
   if(m.command==='windowMaximize'){state.state=state.state==='maximized'?'normal':'maximized';result={...state};}
   if(m.command==='windowMinimize'){state.state='minimized';result={...state};}
   if(m.command==='fullscreen'){state.fullscreen=!!m.args.enabled;result={...state};}
   if(['windowMaximize','windowMinimize','fullscreen'].includes(m.command))queueMicrotask(()=>emit({type:'window-state',...state}));
   queueMicrotask(()=>emit({requestId:m.requestId,result}));
  }};
 },{uid:uids[0],user:authUsers.get(uids[0])});
 const windows=await win.newPage();pages.push(windows);windows.on('pageerror',e=>errors.push(e.message));await windows.goto(base+'/shared/index.html');await windows.locator('#workspace').waitFor({state:'visible'});await windows.getByRole('button',{name:'창 최대화',exact:true}).click();await windows.getByRole('button',{name:'창 이전 크기로 복원',exact:true}).click();await windows.getByRole('button',{name:'앱 전체화면',exact:true}).click();assert.equal(await windows.locator('#window-fullscreen').getAttribute('aria-pressed'),'true');
 await windows.evaluate(()=>{document.body.classList.add('viewing-fullscreen');document.getElementById('viewing').classList.add('native-fullscreen');window.dispatchEvent(new CustomEvent('solaris-native',{detail:{type:'window-state',platform:'windows',state:'normal',fullscreen:false}}));});
 assert.equal(await windows.locator('#window-fullscreen').getAttribute('aria-pressed'),'false');assert.equal(await windows.locator('#viewing').evaluate(n=>n.classList.contains('native-fullscreen')),false);assert.equal(await windows.locator('body').evaluate(n=>n.classList.contains('viewing-fullscreen')),false);await windows.getByRole('button',{name:'창 최소화',exact:true}).click();await windows.getByRole('button',{name:'창 닫기',exact:true}).click();const windowCalls=await windows.evaluate(()=>windowProbeCalls.map(c=>c.command));assert(windowCalls.includes('windowMinimize')&&windowCalls.includes('windowClose')&&windowCalls.filter(c=>c==='windowMaximize').length===2);await windows.evaluate(()=>window.dispatchEvent(new CustomEvent('solaris-native',{detail:{type:'window-state',platform:'windows',state:'normal',fullscreen:false,systemTitlebar:true}})));assert(await windows.locator('#window-controls').isHidden());results.systemTitlebar65={passed:true,duplicateSharedControlsHidden:true,nativeWindowButtonsTestedSeparately:true};await windows.screenshot({path:join(out,'windows-controls.png'),fullPage:true});results.windowsControlsAndNativeFullscreenExit={passed:true,nativeBridgeInjected:true,physicalWindow:false};await win.close();contexts.splice(contexts.indexOf(win),1);pages.pop();
 const diskEvidence=await a.evaluate(async()=>{
  const{DiskFiles,Ledger}=await import('/shared/platform.mjs');const root=await navigator.storage.getDirectory(),handle=await root.getFileHandle('solaris-disk-probe',{create:true}),id=crypto.randomUUID(),disk=new DiskFiles({native:false},new Ledger('disk-ui-probe'));
  await disk.remember(id,{handle,source:false,size:6,extent:0});await disk.write(id,0,new Uint8Array([97,98,99]));const partialHash=await disk.hash(id);
  const restored=new DiskFiles({native:false},new Ledger('disk-ui-probe'));await restored.write(id,3,new Uint8Array([100,101,102]));await restored.finish(id,'original',6);const result={partialHash,bytes:await(await handle.getFile()).text(),size:(await restored.check(id)).size};await root.removeEntry('solaris-disk-probe');return result;
 });assert.equal(diskEvidence.bytes,'abcdef');assert.equal(diskEvidence.size,6);assert.equal(diskEvidence.partialHash,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');results.browserDiskCheckpoint=diskEvidence;
 await a.evaluate(()=>localStorage.setItem('solaris-settings','{broken'));await a.reload();await a.locator('#workspace').waitFor({state:'visible'});await a.getByRole('button',{name:'설정',exact:true}).click();assert.equal(await a.locator('input[name=maxReceive]').inputValue(),'4');await a.locator('#dialog-close').click();results.corruptSettingsPreserveAccount=true;
 await responsiveExistingActions(a);
  results.coldNativeGoogleReturnDuringStartup={passed:true,nativeBridgeInjected:true,physicalDevice:false,realGoogleAccount:false,cases:[await coldNativeAuthReturn('/shared/index.html'),await coldNativeAuthReturn('/ios/App/Resources/Unified/unified.html'),await coldNativeAuthReturn('/shared/index.html',{failExchange:true}),await coldNativeAuthReturn('/ios/App/Resources/Unified/unified.html',{failExchange:true}),await coldNativeAuthReturn('/shared/index.html',{failExchange:true,failBeforeResume:true}),await coldNativeAuthReturn('/shared/index.html',{foregroundReturn:true}),await coldNativeAuthReturn('/shared/index.html',{platform:'android',foregroundReturn:true}),await coldNativeAuthReturn('/shared/index.html',{platform:'windows',foregroundReturn:true})]};
  results.nativeLinkedIdentityFailures={passed:true,nativeBridgeInjected:true,physicalDevice:false,realGoogleAccount:false,cases:[await nativeLinkedIdentityFailure('/shared/index.html'),await nativeLinkedIdentityFailure('/ios/App/Resources/Unified/unified.html')]};
  results.account65Deletion=await account65Deletion();const recovered=[await savedGooglePasswordSessionRecovery('/shared/index.html'),await savedGooglePasswordSessionRecovery('/ios/App/Resources/Unified/unified.html')];results.googleStoredPasswordSessionRecovery={passed:true,cases:recovered.map(c=>c.recovery)};results.profileSaveClosedBeforeResponse={passed:true,cases:recovered.map(c=>c.lateSave)};assert(!authRequests.some(r=>['/auth/v1/signup','/auth/v1/verify','/auth/v1/recover','/auth/v1/otp','/auth/v1/resend','/auth/v1/user/identities/authorize'].includes(r.path)||r.path==='/auth/v1/token'&&!['pkce','refresh_token'].includes(r.grant)||r.path==='/auth/v1/user'&&r.method!=='GET'),'UI must never call removed password/email/anonymous authentication');results.googleOnlyAuthRequests={passed:true,noEmailPasswordAnonymousRequests:true,isolatedProvider:true};if(errors.length)throw Error(errors.join('; '));results.success=true;console.log('PASS: canonical and bundled UI, secure account, native cold-return PKCE race, friend/session consent, profile/avatar, persisted restart, settings, responsive layouts');
}catch(e){results.success=false;results.error=e.message;console.error(e);process.exitCode=1;for(const[i,p]of pages.entries())await p.screenshot({path:join(out,'failure'+i+'.png'),fullPage:true}).catch(()=>{});}finally{results.errors=errors;await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));for(const c of contexts)await c.close();await browser?.close();await db.close();await new Promise(r=>host.close(r));}
