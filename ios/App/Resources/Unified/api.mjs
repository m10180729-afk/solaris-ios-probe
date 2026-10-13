import{redact,requestTimeout}from'./platform.mjs';
import{AuthFlow}from'./authflow.mjs';
export class API extends EventTarget {
 constructor(config,bridge,ledger){super();if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(config.url)||!/^sb_publishable_/.test(config.key))throw new Error('Invalid project configuration');this.config=config;this.bridge=bridge;this.ledger=ledger;this.session=null;this.revision=0;this.saveQueue=Promise.resolve();this.authFlow=new AuthFlow(this);this.deviceId=crypto.randomUUID();}
 async save(){const session=this.session,revision=this.revision;if(session&&!session.expires_at)session.expires_at=Date.now()/1000+(session.expires_in??3600);const next=this.saveQueue.then(async()=>{if(revision!==this.revision||session!==this.session)return;if(this.bridge.native)await this.bridge.call('vaultSet',{key:'session',value:JSON.stringify(session)});else await this.ledger.set('auth',session);this.dispatchEvent(new Event('auth'));});this.saveQueue=next.catch(()=>{});await next;}
 async init(){const revision=++this.revision;let stored=this.bridge.native?await this.bridge.call('vaultGet',{key:'session'}):await this.ledger.get('auth');if(revision!==this.revision)return;this.session=typeof stored==='string'?JSON.parse(stored):stored;if(this.session)await this.ensure();}
 async auth(path,body,bearer=false,options={}){const url=new URL(this.config.url+'/auth/v1/'+path);if(options.redirectTo)url.searchParams.set('redirect_to',options.redirectTo);const token=typeof bearer==='string'?bearer:bearer?this.session?.access_token:null;const r=await fetch(url.href,{method:options.method??(body?'POST':'GET'),headers:{apikey:this.config.key,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:requestTimeout()});const v=await r.json();if(!r.ok){const e=new Error(v.msg||v.message||v.error_description||'인증 실패');e.code=v.code??v.error_code;e.status=r.status;throw e;}return v;}
 async signup(){const revision=++this.revision,session=await this.auth('signup',{});return this.acceptSession(session,revision);}
 async ensure(){if(!this.session)throw new Error('Authentication required');if(this.session.expires_at*1000>Date.now()+90000)return;if(this.bridge.native){const raw=await this.bridge.call('vaultGet',{key:'session'});const s=typeof raw==='string'?JSON.parse(raw):raw;if(s?.user?.id===this.session.user.id&&s.expires_at>this.session.expires_at)this.session=s;}if(this.session.expires_at*1000>Date.now()+90000)return;if(!this.refreshing){const revision=this.revision,uid=this.session.user.id;this.refreshing=(async()=>{const session=await this.auth('token?grant_type=refresh_token',{refresh_token:this.session.refresh_token});if(revision!==this.revision)return;if(session.user?.id!==uid)throw new Error('갱신된 계정이 일치하지 않습니다.');this.session=session;await this.save();})().finally(()=>this.refreshing=null);}await this.refreshing;}
 async rpc(action,args={}){
  const revision=this.revision,uid=this.session?.user?.id;
  const assertCurrent=()=>{if(revision!==this.revision||this.session?.user?.id!==uid)throw new Error('인증 상태가 변경되어 이전 계정 요청이 취소되었습니다. 현재 계정에서 다시 시도하세요.');};
  await this.ensure();assertCurrent();
  if(action==='sync')args={...args,device_id:this.deviceId};
  const r=await fetch(this.config.url+'/rest/v1/rpc/solaris_action',{method:'POST',headers:{apikey:this.config.key,Authorization:'Bearer '+this.session.access_token,'Content-Type':'application/json'},body:JSON.stringify({action,args}),redirect:'error',signal:requestTimeout()});
  const v=await r.json();assertCurrent();
  if(!r.ok)throw new Error(v.message||'서버 요청 실패');return v;
 }
 async emailFlow(kind,email){const f=await this.authFlow.prepare(kind,{email:email.trim()});return{redirectTo:f.redirectTo,challenge:f.challenge};}
 async recoverEmail(email){await this.ensure();const f=await this.emailFlow('email-change',email);return this.auth('user',{email:email.trim(),code_challenge:f.challenge,code_challenge_method:'s256'},true,{method:'PUT',redirectTo:f.redirectTo});}
 async verifyEmailLink(email,token){const uid=this.session?.user?.id,revision=++this.revision,s=await this.auth('verify',{email,token,type:'email_change'});if(revision!==this.revision)return s;if(s.user?.id&&s.user.id!==uid)throw new Error('복구 이메일은 기존 계정의 UID에 연결되어야 합니다.');if(s.access_token){if(!uid||s.user?.id!==uid)throw new Error('복구 이메일은 기존 계정의 UID에 연결되어야 합니다.');this.session=s;await this.save();}return s;}
 async emailOTP(email){const f=await this.emailFlow('email',email);return this.auth('otp',{email:email.trim(),create_user:false,code_challenge:f.challenge,code_challenge_method:'s256'},false,{redirectTo:f.redirectTo});}
 async verifyOTP(email,token){return this.verifyAccount(email,token,'email');}
 async acceptSession(session,revision){if(!session?.access_token||!session?.refresh_token||!session?.user?.id)throw new Error('인증 응답이 유효하지 않습니다. 다시 로그인하세요.');if(revision!==this.revision)return this.session;this.session=session;await this.save();return session;}
 async accountFunction(body,authenticated=false){
  const revision=this.revision,uid=this.session?.user?.id;
  const assertCurrent=()=>{if(authenticated&&(revision!==this.revision||uid!==this.session?.user?.id))throw new Error('계정 요청이 취소되었습니다.');};
  if(authenticated){await this.ensure();assertCurrent();}
  const response=await fetch(this.config.url+'/functions/v1/solaris-account',{method:'POST',headers:{apikey:this.config.key,'Content-Type':'application/json',...(authenticated?{Authorization:'Bearer '+this.session.access_token}:{})},body:JSON.stringify(body),redirect:'error',signal:requestTimeout()});
  const value=await response.json();assertCurrent();
  if(!response.ok){const error=new Error(value.message||'계정 요청을 완료하지 못했습니다.');error.code=value.code;error.status=response.status;error.deletionStarted=value.deletionStarted===true;throw error;}
  return value;
 }
 async login(userID,password){const id=userID.trim().toLowerCase();if(!/^[a-z0-9_]{3,32}$/.test(id))throw new Error('아이디는 영문 소문자, 숫자, 밑줄 3~32자로 입력하세요.');const revision=++this.revision,session=await this.accountFunction({action:'login_id',user_id:id,password});return this.acceptSession(session,revision);}
 async registerEmail(email,password,profile){if(password.length<8)throw new Error('비밀번호는 8자 이상으로 설정하세요.');const id=profile.user_id.trim().toLowerCase();if(!/^[a-z0-9_]{3,32}$/.test(id))throw new Error('아이디는 영문 소문자, 숫자, 밑줄 3~32자로 입력하세요.');const f=await this.emailFlow('signup',email),revision=++this.revision,value=await this.auth('signup',{email:email.trim(),password,data:{solaris_user_id:id,solaris_nickname:profile.nickname},code_challenge:f.challenge,code_challenge_method:'s256'},false,{redirectTo:f.redirectTo});if(value.access_token)return{session:await this.acceptSession(value,revision),confirmationRequired:false};return{confirmationRequired:true,email:email.trim()};}
 changeID(userID){return this.rpc('profile',{user_id:userID.trim().toLowerCase()});}
 setPresence(status){if(!['online','away','dnd','invisible'].includes(status))throw new Error('유효하지 않은 접속 상태입니다.');return this.rpc('presence_set',{status,device_id:this.deviceId});}
 async leavePresence(session=this.session){
  if(!session?.access_token)return false;
  try{return(await fetch(this.config.url+'/rest/v1/rpc/solaris_action',{method:'POST',headers:{apikey:this.config.key,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({action:'presence_leave',args:{device_id:this.deviceId}}),redirect:'error',keepalive:true,signal:requestTimeout(2000)})).ok;}catch{return false;}
 }
 async deleteAccount(){
  const revision=this.revision,uid=this.session?.user?.id;
  try{
   const result=await this.accountFunction({action:'delete_account'},true);
   if(result.deleted!==true)throw new Error('탈퇴 완료 응답을 확인하지 못했습니다. 다시 시도하세요.');
   if(revision!==this.revision||uid!==this.session?.user?.id)throw new Error('계정 요청이 취소되었습니다.');
   await Promise.all([this.clearSession(),this.authFlow.cancel()]);return result;
  }catch(error){
   // A lost successful deletion response may be followed by 401 on retry.
   // Keep credentials on transient failure so server cleanup remains retryable.
   if(error.status===401&&revision===this.revision&&uid===this.session?.user?.id){await Promise.all([this.clearSession(),this.authFlow.cancel()]);error.localSignedOut=true;}
   throw error;
  }
 }
 async verifyAccount(email,token,type='signup'){if(!['signup','email','recovery'].includes(type))throw new Error('유효하지 않은 인증 방식입니다.');const revision=++this.revision,session=await this.auth('verify',{email:email.trim(),token:token.trim(),type});return this.acceptSession(session,revision);}
 async passwordReset(email){const f=await this.emailFlow('recovery',email);return this.auth('recover',{email:email.trim(),code_challenge:f.challenge,code_challenge_method:'s256'},false,{redirectTo:f.redirectTo});}
 async resendVerification(email,type){if(type==='signup'){const f=await this.authFlow.read();if(!f||f.kind!=='signup'||f.email!==email.trim()||Date.now()>f.expires)throw new Error('가입을 시작한 기기에서 인증 메일을 다시 요청하세요. 이미 받은 코드는 직접 입력할 수 있어요.');const url=new URL(f.base);url.searchParams.set('solaris_state',f.state);if(this.bridge.native)await this.bridge.call('authListen',{redirectTo:url.href});return this.auth('resend',{email:email.trim(),type:'signup'},false,{redirectTo:url.href});}if(type==='recovery')return this.passwordReset(email);return this.emailOTP(email);}
 google(link=false){return this.authFlow.google(link);}
 authReturn(url){return this.authFlow.complete(url);}
 authSettings(){return this.auth('settings');}
 async updateUser(value){const revision=this.revision,uid=this.session?.user?.id;await this.ensure();if(revision!==this.revision||this.session?.user?.id!==uid)throw new Error('계정 요청이 취소되었습니다.');const response=await fetch(this.config.url+'/auth/v1/user',{method:'PUT',headers:{apikey:this.config.key,Authorization:'Bearer '+this.session.access_token,'Content-Type':'application/json'},body:JSON.stringify(value),redirect:'error',signal:requestTimeout()});const user=await response.json();if(!response.ok)throw new Error(user.msg||user.message||'계정 변경 실패');if(revision!==this.revision||this.session?.user?.id!==uid)throw new Error('계정 요청이 취소되었습니다.');if(user.id!==uid)throw new Error('계정 UID가 일치하지 않습니다.');this.session={...this.session,user};await this.save();return user;}
 async account(){const revision=this.revision,uid=this.session?.user?.id;await this.ensure();if(revision!==this.revision||this.session?.user?.id!==uid)throw new Error('계정 요청이 취소되었습니다.');const user=await this.auth('user',undefined,true);if(revision!==this.revision||this.session?.user?.id!==uid)throw new Error('계정 요청이 취소되었습니다.');if(user.id!==uid)throw new Error('계정 UID가 일치하지 않습니다.');this.session={...this.session,user};await this.save();return user;}
 async setPassword(password){if(password.length<8)throw new Error('비밀번호는 8자 이상으로 설정하세요.');const user=await this.account();if(!user.email_confirmed_at)throw new Error('이메일 인증을 먼저 완료하세요.');return this.updateUser({password});}
 logout(){
  if(this.loggingOut)return this.loggingOut;
  const session=this.session;
  const task=(async()=>{
   // Invalidate pending login/refresh responses before waiting for the network.
   // Clearing the vault must succeed before reporting that this device signed out.
   const presence=this.leavePresence(session);
   const cleared=Promise.all([this.clearSession(),this.authFlow.cancel()]);
   const revoked=(async()=>{if(!session?.access_token)return true;try{
    const response=await fetch(this.config.url+'/auth/v1/logout?scope=local',{method:'POST',headers:{apikey:this.config.key,Authorization:'Bearer '+session.access_token},redirect:'error',signal:requestTimeout(5000)});
    return response.ok;
   }catch{return false;}})();
   await cleared;await presence;
   return{remoteRevoked:await revoked,hadSession:!!session};
  })();
  this.loggingOut=task.finally(()=>{this.loggingOut=null;});return this.loggingOut;
 }
 async clearSession(){this.revision++;this.session=null;await this.saveQueue;if(this.bridge.native)await this.bridge.call('vaultSet',{key:'session',value:'null'});else await this.ledger.set('auth',null);this.dispatchEvent(new Event('auth'));}
 async avatar(path,blob){await this.ensure();const h={apikey:this.config.key,Authorization:'Bearer '+this.session.access_token};const r=await fetch(this.config.url+'/storage/v1/object/solaris-avatars/'+path,{method:blob?'POST':'DELETE',headers:{...h,...(blob?{'Content-Type':blob.type}:{})},body:blob,redirect:'error',signal:requestTimeout()});if(!r.ok)throw new Error('프로필 사진 저장 실패');}
 async avatarURL(path){await this.ensure();const r=await fetch(this.config.url+'/storage/v1/object/authenticated/solaris-avatars/'+path,{headers:{apikey:this.config.key,Authorization:'Bearer '+this.session.access_token},redirect:'error',signal:requestTimeout()});if(!r.ok)return null;return URL.createObjectURL(await r.blob());}
 async signal(scope,recipient,payload){return this.rpc('signal',{scope_kind:scope.kind,scope_id:scope.id,recipient,payload});}
 diagnostics(){return redact({version:this.config.version,uid:this.session?.user?.id,platform:navigator.userAgent});}
}
