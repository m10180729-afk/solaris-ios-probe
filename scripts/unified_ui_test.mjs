// Real UI/IndexedDB, isolated SQL backend. No public account or network capture.
import{chromium}from'playwright';import{PGlite}from'@electric-sql/pglite';import{createServer}from'node:http';import{readFile,mkdir,writeFile}from'node:fs/promises';import{randomUUID}from'node:crypto';import{join,extname}from'node:path';import assert from'node:assert/strict';
const out='build/ui-evidence';await mkdir(out,{recursive:true});const db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`);await db.exec(await readFile('backend/001_solaris.sql','utf8'));await db.exec(await readFile('backend/003_build60_dm.sql','utf8'));await db.exec(await readFile('backend/004_build61_accounts_broadcast.sql','utf8'));let serial=Promise.resolve();const rpc=(uid,action,args={})=>{const r=serial.then(async()=>{await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);return(await db.query('select public.solaris_action($1,$2::jsonb) result',[action,JSON.stringify(args)])).rows[0].result});serial=r.catch(()=>{});return r;};
const host=createServer(async(req,res)=>{try{const name=new URL(req.url,'http://local').pathname;if(name.includes('..')||!name.startsWith('/shared/')&&!name.startsWith('/ios/App/Resources/Unified/')){res.writeHead(404).end();return;}res.setHeader('Content-Type',extname(name)==='.mjs'?'text/javascript':extname(name)==='.css'?'text/css':'text/html');res.end(await readFile(join(process.cwd(),name)));}catch{res.writeHead(404).end();}});await new Promise(r=>host.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+host.address().port;let browser;const contexts=[],pages=[],uids=[],errors=[],photos=new Map(),authUsers=new Map(),passwords=new Map(),results={};
async function installFixture(ctx,uid){await ctx.route('https://*.supabase.co/**',async route=>{try{const req=route.request(),url=new URL(req.url());let value;if(url.pathname.startsWith('/auth/v1/')){
 const body=req.method()==='GET'?{}:req.postDataJSON()??{},user=authUsers.get(uid),makeSession=()=>({access_token:uid,refresh_token:'fixture-only',expires_at:Date.now()/1000+3600,user});
 if(url.pathname==='/auth/v1/user'){
  if(req.method()==='PUT'){if(body.email)user.email=body.email;if(body.password)passwords.set(uid,body.password);}value=user;
 }else if(url.pathname==='/auth/v1/user/identities/authorize'){
  value={url:'https://accounts.google.com/o/oauth2/v2/auth?solaris_fixture_redirect='+encodeURIComponent(url.searchParams.get('redirect_to'))};
 }else if(url.pathname==='/auth/v1/token'){
  if(url.searchParams.get('grant_type')==='pkce'){user.identities=[{provider:'google'}];user.is_anonymous=false;value=makeSession();}
  else {if(body.email!==user.email||body.password!==passwords.get(uid))throw Error('Invalid login credentials');value=makeSession();}
 }else if(url.pathname==='/auth/v1/verify'){
  if(body.type==='email_change'){user.email=body.email;user.email_confirmed_at=new Date().toISOString();user.is_anonymous=false;}value=makeSession();
 }else if(url.pathname==='/auth/v1/signup'){
  if(body.email){user.email=body.email;user.email_confirmed_at=new Date().toISOString();user.is_anonymous=false;user.user_metadata=body.data;passwords.set(uid,body.password);}value=makeSession();
 }else value={};
}else if(url.pathname.startsWith('/storage/')){const path=url.pathname.split('solaris-avatars/')[1];if(req.method()==='POST'){photos.set(path,req.postDataBuffer());value={};}else if(req.method()==='DELETE'){photos.delete(path);value={};}else{await route.fulfill({status:photos.has(path)?200:404,body:photos.get(path)??Buffer.alloc(0),contentType:'image/jpeg'});return;}}else{const b=req.postDataJSON();value=await rpc(uid,b.action,b.args);}await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});}catch(e){await route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({message:e.message})});}});
 await ctx.route('https://accounts.google.com/**',async route=>{const source=new URL(route.request().url()),returned=new URL(source.searchParams.get('solaris_fixture_redirect'));returned.searchParams.set('code','fixture-oauth-code');await route.fulfill({status:302,headers:{Location:returned.href},body:''});});
 await ctx.route('https://api.github.com/repos/**/releases',route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
}
async function installNativeAuthProbe(ctx,{state,verifier,platform='ios',uid=null,providerError=false}){
 await ctx.addInitScript(({state,verifier,platform,uid,providerError})=>{
  const flow={kind:uid?'google-link':'google',base:platform==='windows'?'http://127.0.0.1:43854/auth/callback':'solaris://auth/callback',state,verifier,email:null,uid,expires:Date.now()+600000};
  const session=uid?{user:{id:uid,is_anonymous:true,identities:[]},access_token:uid,refresh_token:'fixture-only',expires_at:Date.now()/1000+3600}:null;
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
 },{state,verifier,platform,uid,providerError});
}
async function coldNativeAuthReturn(path,{failExchange=false,failBeforeResume=false,platform='ios',foregroundReturn=false}={}){
 const uid=randomUUID(),state=randomUUID(),verifier='fixture-protected-verifier-'.repeat(3);
 authUsers.set(uid,{id:uid,identities:[{provider:'google'}],is_anonymous:false});
 await db.query('insert into auth.users values($1)',[uid]);await rpc(uid,'profile',{user_id:'cold_'+uid.slice(0,8),nickname:'복귀 계정'});
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
  await p.goto(base+path);await p.waitForFunction(()=>window.authProbe?.resumeHeld);
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
   assert.equal(await p.evaluate(()=>window.authProbeSavedSession()),null);
   await p.locator('#google-login').click();await p.locator('#auth-pending').waitFor({state:'visible'});
   assert(await p.evaluate(()=>window.authProbe.calls.includes('authOpen')));
   assert.notEqual(await p.evaluate(()=>window.authProbeSavedFlow().state),state);
  }else{
   await p.locator('#workspace').waitFor({state:'visible'});assert(await p.locator('#error').isHidden());assert(await p.locator('#auth-pending').isHidden());
   assert.equal(await p.evaluate(()=>window.authProbeSavedSession().user.id),uid);
   assert.equal(await p.evaluate(()=>window.authProbeSavedFlow()),null);
   await p.evaluate(()=>window.deliverAuthCallback());await p.locator('#workspace').waitFor({state:'visible'});assert.equal(exchangeCalls,1);
  }
  await p.waitForFunction(()=>window.authProbe.acknowledgements>0&&window.authProbePendingReturn()===null);
  assert.equal(await p.evaluate(()=>window.authProbe.sessionReads),1,'Startup must not reread the vault and invalidate the callback exchange');
  return{path,platform,passed:true,failureThenFreshRetry:failExchange,failureBeforeResume:failBeforeResume,recoveredViaForeground:foregroundReturn,processedReturnAcknowledged:true};
 }finally{releasePKCE();await ctx.close();contexts.splice(contexts.indexOf(ctx),1);pages.splice(pages.indexOf(p),1);}
}
async function nativeLinkedIdentityFailure(path,platform='ios'){
 const uid=randomUUID(),state=randomUUID(),verifier='fixture-protected-verifier-'.repeat(3);
 authUsers.set(uid,{id:uid,identities:[],is_anonymous:true});
 await db.query('insert into auth.users values($1)',[uid]);const profile=await rpc(uid,'profile',{user_id:'linked_'+uid.slice(0,8),nickname:'연결 유지 계정'});
 const server=await rpc(uid,'server_create',{name:'기존 계정 서버'});
 const ctx=await browser.newContext({viewport:{width:390,height:844}});contexts.push(ctx);await installFixture(ctx,uid);
 await installNativeAuthProbe(ctx,{state,verifier,platform,uid,providerError:true});
 let exchangeCalls=0;ctx.on('request',r=>{if(r.url().includes('/auth/v1/token?grant_type=pkce'))exchangeCalls++;});
 const p=await ctx.newPage();pages.push(p);p.on('pageerror',e=>errors.push(e.message));
 try{
  await p.goto(base+path);await p.waitForFunction(()=>window.authProbe?.resumeHeld);await p.evaluate(()=>window.deliverAuthCallback());
  await p.locator('#error').filter({hasText:'이미 Solaris 계정에 연결'}).waitFor({state:'visible'});assert(await p.locator('#auth-pending').isHidden());
  assert.match(await p.locator('#error').textContent(),/로그아웃하고 첫 화면의 Google 로그인/);
  await p.evaluate(()=>window.releaseAuthResume());await p.locator('#workspace').waitFor({state:'visible'});
  await p.waitForFunction(()=>window.authProbe.acknowledgements>0&&window.authProbePendingReturn()===null);
  assert.equal(exchangeCalls,0,'Provider errors must never exchange a code or switch accounts');
  assert.equal(await p.evaluate(()=>window.authProbeSavedSession().user.id),uid);assert.equal(await p.evaluate(()=>window.authProbeSavedFlow().state),state);
  assert.equal(await p.evaluate(()=>window.authProbe.calls.includes('authCancel')),false,'Conflict must not cancel or sign out the current account');
  assert.equal((await rpc(uid,'profile')).user_id,profile.user_id);assert((await rpc(uid,'sync',{cursor:0})).servers.some(s=>s.id===server.id));
  await p.getByRole('button',{name:'내 프로필',exact:true}).click();await p.locator('#dialog-content').getByRole('button',{name:'내 계정',exact:true}).click();
  assert.equal(await p.getByRole('button',{name:'Google 계정 연결',exact:true}).isEnabled(),true);
  // The durable session initially lacks Google; the account tab must verify
  // identities with the server instead of offering a redundant linking flow.
  await p.locator('#dialog-close').click();authUsers.get(uid).identities=[{provider:'google'}];
  await p.getByRole('button',{name:'내 프로필',exact:true}).click();await p.locator('#dialog-content').getByRole('button',{name:'내 계정',exact:true}).click();
  assert.equal(await p.getByRole('button',{name:'Google 연결됨',exact:true}).isDisabled(),true);assert.equal(await p.getByRole('button',{name:'Google 계정 연결',exact:true}).count(),0);
  return{path,platform,passed:true,identityConflictVisible:true,processedReturnAcknowledged:true,originalAccountAndServerPreserved:true,verifiedGoogleIdentityDisablesLink:true};
 }finally{await ctx.close();contexts.splice(contexts.indexOf(ctx),1);pages.splice(pages.indexOf(p),1);}
}
try{browser=await chromium.launch({headless:true,...(process.env.SOLARIS_BROWSER_EXECUTABLE?{executablePath:process.env.SOLARIS_BROWSER_EXECUTABLE}:{})});for(let i=0;i<2;i++){const uid=randomUUID();uids.push(uid);authUsers.set(uid,{id:uid,is_anonymous:true});await db.query('insert into auth.users values($1)',[uid]);const ctx=await browser.newContext({viewport:{width:1280,height:900}});contexts.push(ctx);await installFixture(ctx,uid);const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));pages.push(p);await p.goto(base+(i?'/ios/App/Resources/Unified/unified.html':'/shared/index.html'));await p.getByRole('button',{name:'계정 만들기',exact:true}).first().click();
 if(i){await p.locator('#email-register [name=user_id]').fill('bob');await p.locator('#email-register [name=nickname]').fill('지구');await p.locator('#email-register [name=email]').fill('bob@example.test');await p.locator('#email-register [name=password]').fill('fixture-bob-password');await p.locator('#email-register button.primary').click();results.emailSignupWithoutAnonymous=true;}
 else{await p.getByRole('button',{name:'ID로 빠르게 시작',exact:true}).click();await p.locator('#register input[name=user_id]').fill('alice');await p.locator('#register input[name=nickname]').fill('솔라');await p.locator('#register button').click();}await p.locator('#workspace').waitFor({state:'visible'});}
 const[a,b]=pages;
 // An ID-only account has a visible sign-out action with an explicit recovery warning.
 await a.locator('.account-quick-actions [data-action=logout]').click();await a.getByText(/계정에 다시 접근하지 못할 수/).waitFor();await a.getByRole('button',{name:'취소',exact:true}).click();assert(await a.locator('#workspace').isVisible());assert.equal((await rpc(uids[0],'profile')).uid,uids[0]);results.anonymousLogoutVisibleAndCancelable=true;
 await a.getByRole('button',{name:'친구 추가',exact:true}).click();await a.locator('#friend-search input').fill('bob');await new Promise(r=>setTimeout(r,2500));assert.equal(await a.locator('#friend-search input').inputValue(),'bob');await a.locator('#friend-search button').click();await a.getByRole('button',{name:'친구 요청 보내기',exact:true}).click();await b.getByRole('button',{name:'대기 중',exact:true}).click();await b.getByRole('button',{name:'수락',exact:true}).click();await a.getByRole('button',{name:'모두',exact:true}).click();await b.getByRole('button',{name:'모두',exact:true}).click();await a.locator('#panel [data-action=friend-menu]').first().click();await a.getByRole('button',{name:'화면공유 요청',exact:true}).click();await b.locator('#incoming-request').waitFor({state:'visible'});await b.locator('#incoming-request').click();await b.locator('#requests').getByRole('button',{name:'수락',exact:true}).click();await a.locator('#scope-title').filter({hasText:'지구'}).waitFor();results.accountFriendsDirect=true;
 await a.getByRole('button',{name:'내 프로필',exact:true}).click();await a.locator('#profile-edit [name=nickname]').fill('태양');await a.locator('#profile-edit textarea').fill('태양처럼 밝게 🌞');await a.locator('#profile-edit button').click();await a.locator('#dialog-close').click();await b.locator('#panel strong').filter({hasText:'태양'}).waitFor();await a.getByRole('button',{name:'내 프로필',exact:true}).click();await a.locator('#avatar-file').setInputFiles({name:'profile.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH4sAAAAASUVORK5CYII=','base64')});await a.locator('#dialog').waitFor({state:'hidden'});await b.locator('#panel img').waitFor();assert.equal(photos.size,1);results.profileAvatar=true;
 await a.reload();await a.locator('#workspace').waitFor({state:'visible'});results.restartPersistence=true;
 await a.getByRole('button',{name:'설정',exact:true}).click();await a.locator('select[name=updateChannel]').selectOption('stable');await a.locator('input[name=maxReceive]').fill('3');await a.getByRole('button',{name:'설정 저장',exact:true}).click();results.settings=true;
 await a.getByRole('button',{name:'설정',exact:true}).click();await a.getByRole('button',{name:'프로필',exact:true}).click();await a.locator('#profile-edit').waitFor();await a.getByRole('button',{name:'앱 설정',exact:true}).click();await a.locator('#settings-edit').waitFor();assert.equal(await a.locator('#dialog').evaluate(n=>getComputedStyle(n).resize),'both');await a.getByRole('button',{name:'업데이트 확인',exact:true}).click();await a.getByText('선택한 업데이트 채널에 공개된 버전이 없습니다.',{exact:true}).waitFor();await a.locator('#dialog-close').click();
 await a.getByRole('button',{name:'대화 메뉴',exact:true}).click();await a.getByRole('button',{name:'연결 및 화면공유 상태',exact:true}).click();await a.locator('#quality-details').waitFor();await a.getByText('화면을 시청하면 실제 FPS와 네트워크 상태가 여기에 표시됩니다.',{exact:true}).waitFor();const downloadPromise=a.waitForEvent('download');await a.getByRole('button',{name:'진단 파일 저장',exact:true}).click();assert.match((await downloadPromise).suggestedFilename(),/^Solaris-diagnostics-.*\.json$/);assert(!await a.locator('#diagnostic-json').textContent().then(t=>/fixture-access|fixture-only|fixture-password/.test(t)));await a.locator('#dialog-close').click();assert(await a.locator('#compose-attach').isVisible());results.unifiedSettingsAndUsableDiagnostics=true;

 assert.equal(await a.locator('#quality').count(),0);assert.equal(await b.locator('#panel .presence.online').count(),1);assert.equal(await a.locator('#self-profile .presence.online').count(),1);results.highQualityOnlyAndPresence=true;
 const created=await rpc(uids[0],'server_create',{name:'Solaris UI test'}),serverID=created.id;const state=await rpc(uids[0],'sync',{cursor:0}),server=state.servers.find(s=>s.id===serverID);await rpc(uids[1],'server_join',{invite:server.invite});
 await b.getByRole('button',{name:'Solaris UI test',exact:true}).click();await b.locator('#channels [data-action="channel"]').first().click();assert.equal(await b.locator('#server-tools [data-action="server-leave"]').count(),0);assert.equal(await b.locator('#channels [data-action="server-leave"]').count(),0);
 await b.getByRole('button',{name:'서버 메뉴',exact:true}).click();const leave=b.getByRole('button',{name:'서버 탈퇴',exact:true});assert(await leave.evaluate(n=>n.closest('.danger-zone')&&n.classList.contains('danger')));await leave.click();await b.getByRole('button',{name:'취소',exact:true}).click();assert((await rpc(uids[1],'sync',{cursor:0})).servers.some(s=>s.id===serverID));await b.getByRole('button',{name:'서버 탈퇴',exact:true}).click();await b.locator('#confirm-action').click();await b.locator('#dialog').waitFor({state:'hidden'});assert(!(await rpc(uids[1],'sync',{cursor:0})).servers.some(s=>s.id===serverID));results.serverLeaveSeparatedAndConfirmed=true;
 // Account upgrade retains the UID, friends and accepted direct session.
 await a.getByRole('button',{name:'내 프로필',exact:true}).click();
 await a.locator('#dialog-content').getByRole('button',{name:'내 계정',exact:true}).click();await a.locator('#recovery-link input').fill('alice@example.test');await a.locator('#recovery-link button').click();
 await a.locator('#link-verify [name=token]').fill('424242');await a.locator('#link-verify button').click();
 await a.locator('#password-edit input').fill('fixture-password');await a.locator('#password-edit button').click();
 await a.getByRole('button',{name:'내 프로필',exact:true}).click();await a.locator('#dialog-content').getByRole('button',{name:'내 계정',exact:true}).click();
 const offline=route=>route.abort('internetdisconnected');await contexts[0].route('https://*.supabase.co/**',offline);await a.getByRole('button',{name:'로그아웃',exact:true}).click();await a.locator('#confirm-action').click();await a.locator('#login').waitFor({state:'visible'});await a.getByText(/서버의 로그인 종료 확인은 받지 못했습니다/).waitFor();assert.equal(await a.locator('#self-profile').textContent(),'');assert.equal(await a.locator('#messages').textContent(),'');assert.equal(await a.locator('#channels').textContent(),'');await a.reload();await a.locator('#login').waitFor({state:'visible'});assert(await a.locator('#workspace').isHidden());await contexts[0].unroute('https://*.supabase.co/**',offline);results.offlineLogoutClearsPrivateUIAndStaysSignedOut=true;
 await a.locator('#login [name=email]').fill('alice@example.test');await a.locator('#login [name=password]').fill('wrong-password');await a.locator('#login button.primary').click();await a.locator('#error').waitFor({state:'visible'});assert(await a.locator('#workspace').isHidden());
 await a.locator('#login [name=password]').fill('fixture-password');await a.locator('#login button.primary').click();await a.locator('#workspace').waitFor({state:'visible'});await a.locator('#scope-title').filter({hasText:'지구'}).waitFor();assert.equal((await rpc(uids[0],'profile')).user_id,'alice');results.emailPasswordLoginSameUID=true;
 // Simulated provider: production PKCE flow and redirect reload, no real Google login.
 await a.getByRole('button',{name:'내 프로필',exact:true}).click();await a.locator('#dialog-content').getByRole('button',{name:'내 계정',exact:true}).click();
 await Promise.all([a.waitForNavigation({waitUntil:'domcontentloaded'}),a.getByRole('button',{name:'Google 계정 연결',exact:true}).click()]);
 await a.locator('#workspace').waitFor({state:'visible'});await a.getByRole('button',{name:'내 프로필',exact:true}).click();await a.locator('#dialog-content').getByRole('button',{name:'내 계정',exact:true}).click();await a.getByRole('button',{name:'Google 연결됨',exact:true}).waitFor();assert.equal(await a.getByRole('button',{name:'Google 연결됨',exact:true}).isDisabled(),true);assert.equal((await rpc(uids[0],'profile')).uid,uids[0]);await a.locator('#dialog-close').click();results.googlePKCEWithSimulatedProvider={passed:true,realGoogleAccount:false,connectedLinkDisabled:true};
 // A selected DM is a dedicated conversation, and channel changes preserve privacy.
 await b.getByRole('button',{name:'태양 개인 메시지',exact:true}).click();await a.locator('#chat textarea').fill('친구 전용 메시지');await a.locator('#chat-send').click();await b.locator('#messages').filter({hasText:'친구 전용 메시지'}).waitFor();
 await a.getByRole('button',{name:'서버 만들기',exact:true}).click();await a.locator('#server-create-form input').fill('함께하는 공간');await a.locator('#server-create-form button').click();
 await a.locator('#scope-title').filter({hasText:'일반'}).waitFor();assert(!(await a.locator('#messages').textContent()).includes('친구 전용 메시지'));
 const createdState=await rpc(uids[0],'sync',{cursor:0}),own=createdState.servers.find(s=>s.name==='함께하는 공간');assert(own&&own.owner===uids[0]);assert(createdState.members.some(m=>m.profile.uid===uids[0]&&m.server_id===own.id&&m.channel_id));
 await a.getByRole('button',{name:'서버 메뉴',exact:true}).click();await a.locator('#dialog').getByRole('button',{name:'채널 만들기',exact:true}).click();await a.locator('#channel-create-form input').fill('게임');await a.locator('#channel-create-form button').click();await a.locator('#dialog-close').click();await a.locator('#channels [data-action=channel]').filter({hasText:'게임'}).click();await a.locator('#scope-title').filter({hasText:'게임'}).waitFor();
 await a.getByRole('button',{name:'친구',exact:true}).first().click();await a.getByRole('button',{name:'지구 개인 메시지',exact:true}).click();await a.locator('#panel[data-page=direct]').waitFor();assert((await a.locator('#messages').textContent()).includes('친구 전용 메시지'));
 const left=await rpc(uids[0],'sync',{cursor:0});assert(left.members.filter(m=>m.profile.uid===uids[0]).every(m=>!m.channel_id));results.serverCreateChannelAndDMNavigation=true;
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
  const watch=Media.prototype.watch,platform=Media.prototype.platform,call=Bridge.prototype.call;window.nativeProbeCalls=[];
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
 await a.locator('#video-'+nativeBroadcast.id).getByRole('button',{name:'전체화면',exact:true}).click();await a.locator('#native-fullscreen-probe').waitFor();
 await a.evaluate(id=>nativeProbe.failWatch(id,new Error('Injected native connection failure')),nativeBroadcast.id);
 assert.equal(await a.locator('#native-fullscreen-probe').count(),0);assert.equal(await a.locator('#video-'+nativeBroadcast.id+' video').count(),0);
 await a.locator('#video-'+nativeBroadcast.id).getByRole('button',{name:'다시 시청',exact:true}).waitFor();
 assert(!(await a.locator('#share').isDisabled()));await a.locator('#chat textarea').fill('실패 후에도 입력 가능');
 await a.getByRole('button',{name:'내 프로필',exact:true}).click();await a.locator('#dialog').waitFor();await a.locator('#dialog-close').click();
 await a.evaluate(()=>{finishNativeStop(true);restoreNativeProbe();});await rpc(uids[1],'broadcast_stop',{id:nativeBroadcast.id});await rpc(uids[0],'session_end',{id:personal.id});
 results.failureRestoresVideoControlsAndTouchWithDelayedNativeStop={passed:true,nativeBridgeInjected:true,physicalDevice:false};
 await a.getByRole('button',{name:'지구 개인 메시지',exact:true}).click();
 for(const[device,width,height]of [['dm-windows',1280,900],['dm-ipad',1024,768],['dm-phone',390,844]]){await a.setViewportSize({width,height});await a.locator('#messages .message-row').last().scrollIntoViewIfNeeded();await a.screenshot({path:join(out,device+'.png'),fullPage:true});assert(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'DM overflow on '+device);}
 await a.setViewportSize({width:1280,height:900});
 // Unchanged polling preserves the live form and its focus.
 await a.getByRole('button',{name:'친구',exact:true}).first().click();await a.getByRole('button',{name:'친구 추가',exact:true}).click();await a.locator('#friend-search input').fill('typing');const stable=await a.locator('#friend-search input').evaluate(n=>{n.dataset.probe='retained';return n.dataset.probe;});await new Promise(r=>setTimeout(r,2500));assert.equal(await a.locator('#friend-search input').getAttribute('data-probe'),stable);assert.equal(await a.locator('#friend-search input').inputValue(),'typing');results.stablePollingDOM=true;

 await a.setViewportSize({width:390,height:844});await a.getByRole('button',{name:'채널 목록 열기',exact:true}).click();await a.getByRole('button',{name:'내 프로필',exact:true}).first().waitFor({state:'visible'});await a.locator('#nav-scrim').click({position:{x:378,y:90}}).catch(async()=>{await a.locator('#nav-toggle').click();});assert.equal(await a.locator('#nav-toggle').getAttribute('aria-expanded'),'false');results.mobileDrawer=true;await a.setViewportSize({width:1280,height:900});
 // A separate touch context uses actual coarse-pointer media queries.
 const touch=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,storageState:await contexts[0].storageState({indexedDB:true})});contexts.push(touch);await installFixture(touch,uids[0]);const mobile=await touch.newPage();pages.push(mobile);mobile.on('pageerror',e=>errors.push(e.message));await mobile.goto(base+'/shared/index.html');await mobile.locator('#workspace').waitFor({state:'visible'});
 await mobile.locator('#mobile-tabs [data-action=mobile-menu]').click();await mobile.getByRole('button',{name:'지구 개인 메시지',exact:true}).click();const composer=mobile.locator('#chat textarea');await composer.fill('모바일 첫 줄');await composer.press('Enter');assert.equal(await composer.inputValue(),'모바일 첫 줄\n');await composer.type('둘째 줄');await mobile.locator('#chat-send').click();await mobile.locator('#messages').filter({hasText:'모바일 첫 줄\n둘째 줄'}).waitFor();assert.equal(await composer.inputValue(),'');assert.equal(await composer.evaluate(n=>n.style.height),'auto');assert(await mobile.locator('#share .button-label').isVisible());assert(await mobile.locator('#compose-attach').isVisible());await mobile.locator('#mobile-tabs [data-action=mobile-menu]').click();await mobile.keyboard.press('Escape');assert.equal(await mobile.locator('#nav-toggle').getAttribute('aria-expanded'),'false');results.mobileShareLabelAndDrawerEscape=true;
 await mobile.locator('#mobile-tabs [data-action=mobile-profile]').click();await mobile.locator('#profile-edit [name=bio]').fill('🌞'.repeat(190));assert.equal(await mobile.locator('.field-counter').textContent(),'190 / 190');await mobile.locator('#profile-edit button').click();await mobile.locator('#dialog-close').click();assert.equal((await rpc(uids[0],'profile')).bio,'🌞'.repeat(190));assert(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await mobile.screenshot({path:join(out,'dm-touch-phone.png'),fullPage:true});results.mobileTouchComposerAndProfile={passed:true,physicalDevice:false};
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
 assert.equal(await windows.locator('#window-fullscreen').getAttribute('aria-pressed'),'false');assert.equal(await windows.locator('#viewing').evaluate(n=>n.classList.contains('native-fullscreen')),false);assert.equal(await windows.locator('body').evaluate(n=>n.classList.contains('viewing-fullscreen')),false);await windows.getByRole('button',{name:'창 최소화',exact:true}).click();await windows.getByRole('button',{name:'창 닫기',exact:true}).click();const windowCalls=await windows.evaluate(()=>windowProbeCalls.map(c=>c.command));assert(windowCalls.includes('windowMinimize')&&windowCalls.includes('windowClose')&&windowCalls.filter(c=>c==='windowMaximize').length===2);await windows.screenshot({path:join(out,'windows-controls.png'),fullPage:true});results.windowsControlsAndNativeFullscreenExit={passed:true,nativeBridgeInjected:true,physicalWindow:false};await win.close();contexts.splice(contexts.indexOf(win),1);pages.pop();
 const diskEvidence=await a.evaluate(async()=>{
  const{DiskFiles,Ledger}=await import('/shared/platform.mjs');const root=await navigator.storage.getDirectory(),handle=await root.getFileHandle('solaris-disk-probe',{create:true}),id=crypto.randomUUID(),disk=new DiskFiles({native:false},new Ledger('disk-ui-probe'));
  await disk.remember(id,{handle,source:false,size:6,extent:0});await disk.write(id,0,new Uint8Array([97,98,99]));const partialHash=await disk.hash(id);
  const restored=new DiskFiles({native:false},new Ledger('disk-ui-probe'));await restored.write(id,3,new Uint8Array([100,101,102]));await restored.finish(id,'original',6);const result={partialHash,bytes:await(await handle.getFile()).text(),size:(await restored.check(id)).size};await root.removeEntry('solaris-disk-probe');return result;
 });assert.equal(diskEvidence.bytes,'abcdef');assert.equal(diskEvidence.size,6);assert.equal(diskEvidence.partialHash,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');results.browserDiskCheckpoint=diskEvidence;
 await a.evaluate(()=>localStorage.setItem('solaris-settings','{broken'));await a.reload();await a.locator('#workspace').waitFor({state:'visible'});await a.getByRole('button',{name:'설정',exact:true}).click();assert.equal(await a.locator('input[name=maxReceive]').inputValue(),'4');await a.locator('#dialog-close').click();results.corruptSettingsPreserveAccount=true;
 for(const[device,width,height]of [['windows',1280,900],['ipad',1024,768],['phone',390,844]]){await a.setViewportSize({width,height});await a.screenshot({path:join(out,device+'.png'),fullPage:true});assert(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal overflow on '+device);}
  results.coldNativeGoogleReturnDuringStartup={passed:true,nativeBridgeInjected:true,physicalDevice:false,realGoogleAccount:false,cases:[await coldNativeAuthReturn('/shared/index.html'),await coldNativeAuthReturn('/ios/App/Resources/Unified/unified.html'),await coldNativeAuthReturn('/shared/index.html',{failExchange:true}),await coldNativeAuthReturn('/ios/App/Resources/Unified/unified.html',{failExchange:true}),await coldNativeAuthReturn('/shared/index.html',{failExchange:true,failBeforeResume:true}),await coldNativeAuthReturn('/shared/index.html',{foregroundReturn:true}),await coldNativeAuthReturn('/shared/index.html',{platform:'android',foregroundReturn:true}),await coldNativeAuthReturn('/shared/index.html',{platform:'windows',foregroundReturn:true})]};
  results.nativeLinkedIdentityFailures={passed:true,nativeBridgeInjected:true,physicalDevice:false,realGoogleAccount:false,cases:[await nativeLinkedIdentityFailure('/shared/index.html'),await nativeLinkedIdentityFailure('/ios/App/Resources/Unified/unified.html')]};
  if(errors.length)throw Error(errors.join('; '));results.success=true;console.log('PASS: canonical and bundled UI, secure account, native cold-return PKCE race, friend/session consent, profile/avatar, persisted restart, settings, responsive layouts');
}catch(e){results.success=false;results.error=e.message;console.error(e);process.exitCode=1;for(const[i,p]of pages.entries())await p.screenshot({path:join(out,'failure'+i+'.png'),fullPage:true}).catch(()=>{});}finally{results.errors=errors;await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));for(const c of contexts)await c.close();await browser?.close();await db.close();await new Promise(r=>host.close(r));}
