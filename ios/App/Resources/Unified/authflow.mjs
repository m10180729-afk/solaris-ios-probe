// All browser returns use PKCE. Verifiers stay in the protected native vault.
export const MOBILE_AUTH_REDIRECT='solaris://auth/callback';
export const WINDOWS_AUTH_REDIRECT='http://127.0.0.1:43854/auth/callback';
const authBase64=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export function authURLAllowed(value,project){
 try{const u=new URL(value);return !u.username&&!u.password&&u.protocol==='https:'&&(
  u.origin===project&&u.pathname==='/auth/v1/authorize'&&u.searchParams.get('provider')==='google'||
  u.hostname==='accounts.google.com'&&u.port===''&&u.pathname.startsWith('/o/oauth2/'));
 }catch{return false;}
}
export function authReturnAllowed(value,base){
 try{const u=new URL(value),b=new URL(base);return !u.username&&!u.password&&u.protocol===b.protocol&&u.host===b.host&&u.pathname===b.pathname&&!u.hash;}
 catch{return false;}
}
export class AuthFlow {
 constructor(api){this.api=api;this.pending=null;this.serial=Promise.resolve();this.storage=Promise.resolve();this.generation=0;}
 async read(){
  const generation=this.generation;
  await this.storage;
  if(generation!==this.generation)return this.pending;
  if(this.pending)return this.pending;
  const v=this.api.bridge.native?await this.api.bridge.call('vaultGet',{key:'auth-flow'}):await this.api.ledger.get?.('auth-flow');
  if(generation!==this.generation)return this.pending;
  try{this.pending=typeof v==='string'?JSON.parse(v):v??null;}catch{this.pending=null;}
  return this.pending;
 }
 async write(value){
  this.pending=value;
  const next=this.storage.then(()=>this.api.bridge.native?this.api.bridge.call('vaultSet',{key:'auth-flow',value:JSON.stringify(value)}):this.api.ledger.set('auth-flow',value));
  this.storage=next.catch(()=>{});await next;
 }
 async redirect(){
  if(this.api.bridge.native){const p=await this.api.bridge.call('platform');return p.platform==='windows'?WINDOWS_AUTH_REDIRECT:MOBILE_AUTH_REDIRECT;}
  const u=new URL(globalThis.location.href);if(!/^https?:$/.test(u.protocol))throw new Error('로그인은 설치된 Solaris 앱에서 진행하세요.');u.search='';u.hash='';return u.href;
 }
 async prepare(kind,{email=null,uid=this.api.session?.user?.id??null}={}){
  const generation=++this.generation;
  const base=await this.redirect(),state=crypto.randomUUID(),verifier=authBase64(crypto.getRandomValues(new Uint8Array(48)));
  const challenge=authBase64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
  if(generation!==this.generation)throw new Error('로그인 요청이 취소되었습니다.');
  const redirect=new URL(base);redirect.searchParams.set('solaris_state',state);
  const pending={kind,base,state,verifier,email,uid,expires:Date.now()+(kind.startsWith('google')?10:60)*60000};
  try{
   await this.write(pending);
   if(generation!==this.generation)throw new Error('로그인 요청이 취소되었습니다.');
   if(this.api.bridge.native)await this.api.bridge.call('authListen',{redirectTo:redirect.href});
   if(generation!==this.generation)throw new Error('로그인 요청이 취소되었습니다.');
  }catch(error){if(this.pending?.state===state)await this.cancel().catch(()=>{});throw error;}
  return{pending,redirectTo:redirect.href,challenge};
 }
 async resume(){
  const generation=this.generation;
  const f=await this.read();if(!f)return null;
  if(!Number.isFinite(f.expires)||typeof f.kind!=='string'||Date.now()>f.expires||(this.api.session?.user?.id??null)!==f.uid){await this.cancel();return null;}
  const base=await this.redirect();
  if(generation!==this.generation||this.pending?.state!==f.state)return null;
  if(f.base!==base||typeof f.state!=='string'||typeof f.verifier!=='string'){await this.cancel();return null;}
  if(this.api.bridge.native){const redirect=new URL(base);redirect.searchParams.set('solaris_state',f.state);await this.api.bridge.call('authListen',{redirectTo:redirect.href});}
  if(generation!==this.generation)return null;
  return f;
 }
 async google(link=false){
  if(link){
   const revision=this.api.revision,uid=this.api.session?.user?.id;await this.api.ensure();
   if(!uid||revision!==this.api.revision||this.api.session?.user?.id!==uid)throw new Error('계정이 변경되어 Google 연결 요청을 취소했습니다.');
  }else if(this.api.session)throw new Error('내 프로필에서 Google 계정 연결을 이용하세요.');
  const f=await this.prepare(link?'google-link':'google'),query=new URLSearchParams({provider:'google',redirect_to:f.redirectTo,code_challenge:f.challenge,code_challenge_method:'s256'});
  let url=this.api.config.url+'/auth/v1/authorize?'+query;
  try{
   if(link){query.set('skip_http_redirect','true');const r=await this.api.auth('user/identities/authorize?'+query,undefined,true);url=r.url;}
   if(this.pending?.state!==f.pending.state)throw new Error('로그인 요청이 취소되었습니다.');
   if(!authURLAllowed(url,this.api.config.url))throw new Error('Google 로그인 주소를 확인할 수 없습니다.');
   if(this.api.bridge.native)await this.api.bridge.call('authOpen',{url});else globalThis.location.assign(url);
  }catch(error){if(this.pending?.state===f.pending.state)await this.cancel().catch(()=>{});throw error;}
  return f.pending;
 }
 complete(value){const task=this.serial.then(()=>this.consume(value));this.serial=task.catch(()=>{});return task;}
 async consume(value){
  const f=await this.read();if(!f||Date.now()>f.expires)throw new Error('로그인 요청이 만료되었습니다. 다시 시작하세요.');
  if(!authReturnAllowed(value,f.base))throw new Error('잘못된 인증 반환 주소입니다.');
  const u=new URL(value);if(u.searchParams.getAll('solaris_state').length!==1||u.searchParams.get('solaris_state')!==f.state)throw new Error('다른 로그인 요청의 반환입니다. 다시 시작하세요.');
  if(u.searchParams.has('error'))throw new Error('인증이 완료되지 않았습니다. 취소했거나 인증 링크가 만료되었을 수 있어요.');
  const code=u.searchParams.get('code');if(u.searchParams.getAll('code').length!==1||!code||code.length>4096)throw new Error('인증 코드가 없습니다. 이메일의 코드로 인증하거나 다시 요청하세요.');
  if((this.api.session?.user?.id??null)!==f.uid)throw new Error('계정이 변경되어 이전 인증 요청을 취소했습니다.');
  const revision=++this.api.revision,s=await this.api.auth('token?grant_type=pkce',{auth_code:code,code_verifier:f.verifier});
  if(f.uid&&s.user?.id!==f.uid)throw new Error('계정 연결은 기존 UID를 유지해야 합니다.');
  const user=await this.api.auth('user',undefined,s.access_token);if(user.id!==s.user?.id)throw new Error('인증된 계정을 확인하지 못했습니다.');s.user=user;
  if(revision!==this.api.revision||this.pending?.state!==f.state)throw new Error('로그인 요청이 취소되었습니다.');
  await this.api.acceptSession(s,revision);await this.write(null);
  return{kind:f.kind,session:s};
 }
 async cancel(){
  this.generation++;this.api.revision++;
  const cleared=this.write(null),stopped=this.api.bridge.native?this.api.bridge.call('authCancel').catch(()=>{}):Promise.resolve();
  await Promise.all([cleared,stopped]);
 }
}
