import{redact,requestTimeout}from'./platform.mjs';
import{AuthFlow}from'./authflow.mjs';
export function googleOnlyError(){const e=new Error('Solaris는 Google 계정으로만 가입하고 로그인할 수 있어요. Google로 계속하기를 눌러주세요.');e.code='google_only';return e;}
export function isGoogleUser(user){
 if(!user?.id||user.is_anonymous===true||!user.email_confirmed_at)return false;
 if(Array.isArray(user.identities))return user.identities.some(identity=>identity.provider==='google');
 return user.app_metadata?.provider==='google'||user.app_metadata?.providers?.includes('google')===true;
}
export class API extends EventTarget {
 constructor(config,bridge,ledger){super();if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(config.url)||!/^sb_publishable_/.test(config.key))throw new Error('Invalid project configuration');this.config=config;this.bridge=bridge;this.ledger=ledger;this.session=null;this.revision=0;this.saveQueue=Promise.resolve();this.authFlow=new AuthFlow(this);this.deviceId=crypto.randomUUID();this.deletionPending=false;}
 async save(){const session=this.session,revision=this.revision;if(session&&!session.expires_at)session.expires_at=Date.now()/1000+(session.expires_in??3600);const next=this.saveQueue.then(async()=>{if(revision!==this.revision||session!==this.session)return;if(this.bridge.native)await this.bridge.call('vaultSet',{key:'session',value:JSON.stringify(session)});else await this.ledger.set('auth',session);this.dispatchEvent(new Event('auth'));});this.saveQueue=next.catch(()=>{});await next;}
 async init(){const revision=++this.revision;let stored=this.bridge.native?await this.bridge.call('vaultGet',{key:'session'}):await this.ledger.get('auth');if(revision!==this.revision)return;this.session=typeof stored==='string'?JSON.parse(stored):stored;if(!this.session)return;if(!isGoogleUser(this.session.user)){await Promise.all([this.clearSession(),this.authFlow.cancel()]);return;}await this.ensure();if(revision!==this.revision||!this.session)return;const current=this.session,pending=await this.ledger.get?.('delete-pending:'+current.user.id);if(revision===this.revision&&this.session===current)this.deletionPending=pending===true;}
 async auth(path,body,bearer=false,options={}){const url=new URL(this.config.url+'/auth/v1/'+path),method=(options.method??(body?'POST':'GET')).toUpperCase(),name=url.pathname.slice('/auth/v1/'.length);
  const allowed=method==='GET'&&!body&&['settings','user'].includes(name)||method==='POST'&&name==='token'&&['pkce','refresh_token'].includes(url.searchParams.get('grant_type'))||method==='GET'&&!body&&name==='user/identities/authorize'&&url.searchParams.get('provider')==='google';
  if(!allowed)throw googleOnlyError();if(options.redirectTo)url.searchParams.set('redirect_to',options.redirectTo);const token=typeof bearer==='string'?bearer:bearer?this.session?.access_token:null;const r=await fetch(url.href,{method,headers:{apikey:this.config.key,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:requestTimeout()});const v=await r.json();if(!r.ok){const e=new Error(v.msg||v.message||v.error_description||'인증 실패');e.code=v.code??v.error_code;e.status=r.status;throw e;}return v;
 }
 async signup(){throw googleOnlyError();}
 async invalidateSession(session,revision,error){
  if(revision!==this.revision||this.session!==session)return;
  await Promise.all([this.clearSession(),this.authFlow.cancel()]);error.localSignedOut=true;
 }
 async ensure(){
  const revision=this.revision,original=this.session;if(!original)throw new Error('Authentication required');
  if(!isGoogleUser(original.user)){await this.clearSession();throw googleOnlyError();}
  if(original.expires_at*1000>Date.now()+90000)return;
  if(this.bridge.native){const raw=await this.bridge.call('vaultGet',{key:'session'});if(revision!==this.revision||this.session!==original)return;const saved=typeof raw==='string'?JSON.parse(raw):raw;
   if(saved?.user?.id===original.user.id&&saved.expires_at>original.expires_at){if(!isGoogleUser(saved.user)){await this.clearSession();throw googleOnlyError();}this.session=saved;}
  }
  if(revision!==this.revision||!this.session||this.session.expires_at*1000>Date.now()+90000)return;
  const current=this.session,uid=current.user.id;
  if(!this.refreshing||this.refreshingOwner?.revision!==revision||this.refreshingOwner?.uid!==uid){
   const task=(async()=>{let session;try{session=await this.auth('token?grant_type=refresh_token',{refresh_token:current.refresh_token});}catch(error){if(error.status===401||error.status===400&&['invalid_grant','invalid_refresh_token','refresh_token_not_found','refresh_token_already_used','session_not_found'].includes(error.code))await this.invalidateSession(current,revision,error);throw error;}if(revision!==this.revision||this.session!==current)return;if(session.user?.id!==uid)throw new Error('갱신된 계정이 일치하지 않습니다.');if(!isGoogleUser(session.user)){await this.clearSession();throw googleOnlyError();}this.session=session;await this.save();})();
   this.refreshingOwner={revision,uid};this.refreshing=task;task.then(()=>{if(this.refreshing===task){this.refreshing=null;this.refreshingOwner=null;}},()=>{if(this.refreshing===task){this.refreshing=null;this.refreshingOwner=null;}});
  }
  await this.refreshing;
 }
 async rpc(action,args={}){
  const revision=this.revision,uid=this.session?.user?.id;
  const assertCurrent=()=>{if(revision!==this.revision||this.session?.user?.id!==uid)throw new Error('인증 상태가 변경되어 이전 계정 요청이 취소되었습니다. 현재 계정에서 다시 시도하세요.');};
  await this.ensure();assertCurrent();
  if(action==='sync')args={...args,device_id:this.deviceId};
  const r=await fetch(this.config.url+'/rest/v1/rpc/solaris_action',{method:'POST',headers:{apikey:this.config.key,Authorization:'Bearer '+this.session.access_token,'Content-Type':'application/json'},body:JSON.stringify({action,args}),redirect:'error',signal:requestTimeout()});
  const v=await r.json();assertCurrent();
  if(!r.ok){const error=new Error(v.message||'서버 요청 실패');error.status=r.status;error.code=v.code;if(r.status===401||v.code==='42501'&&/^Authentication required$/i.test(v.message??''))await this.invalidateSession(this.session,revision,error);throw error;}return v;
 }
 async emailFlow(){throw googleOnlyError();}
 async recoverEmail(){throw googleOnlyError();}
 async verifyEmailLink(){throw googleOnlyError();}
 async emailOTP(){throw googleOnlyError();}
 async verifyOTP(){throw googleOnlyError();}
 async acceptSession(session,revision){if(!session?.access_token||!session?.refresh_token||!session?.user?.id)throw new Error('인증 응답이 유효하지 않습니다. 다시 로그인하세요.');if(revision!==this.revision)return this.session;if(!isGoogleUser(session.user))throw googleOnlyError();const pending=await this.ledger.get?.('delete-pending:'+session.user.id);if(revision!==this.revision)return this.session;this.session=session;this.deletionPending=pending===true;await this.save();return session;}
 async accountFunction(body,authenticated=false){
  if(body?.action==='login_id')throw googleOnlyError();
  const revision=this.revision,uid=this.session?.user?.id;
  const assertCurrent=()=>{if(authenticated&&(revision!==this.revision||uid!==this.session?.user?.id))throw new Error('계정 요청이 취소되었습니다.');};
  if(authenticated){await this.ensure();assertCurrent();}
  const response=await fetch(this.config.url+'/functions/v1/solaris-account',{method:'POST',headers:{apikey:this.config.key,'Content-Type':'application/json',...(authenticated?{Authorization:'Bearer '+this.session.access_token}:{})},body:JSON.stringify(body),redirect:'error',signal:requestTimeout()});
  const value=await response.json();assertCurrent();
  if(!response.ok){const error=new Error(value.message||'계정 요청을 완료하지 못했습니다.');error.code=value.code;error.status=response.status;error.deletionStarted=value.deletionStarted===true;throw error;}
  return value;
 }
 async login(){throw googleOnlyError();}
 async registerEmail(){throw googleOnlyError();}
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
   await this.ledger.set('delete-pending:'+uid,null);if(revision!==this.revision||uid!==this.session?.user?.id)throw new Error('계정 요청이 취소되었습니다.');await Promise.all([this.clearSession(),this.authFlow.cancel()]);return result;
  }catch(error){
   // A lost successful deletion response may be followed by 401 on retry.
   // Keep credentials on transient failure so server cleanup remains retryable.
   if(error.deletionStarted===true&&revision===this.revision&&uid===this.session?.user?.id){this.deletionPending=true;await this.ledger.set('delete-pending:'+uid,true);}
   if(error.status===401&&revision===this.revision&&uid===this.session?.user?.id){await this.ledger.set('delete-pending:'+uid,null);if(revision===this.revision&&uid===this.session?.user?.id){await Promise.all([this.clearSession(),this.authFlow.cancel()]);error.localSignedOut=true;}}
   throw error;
  }
 }
 async verifyAccount(){throw googleOnlyError();}
 async passwordReset(){throw googleOnlyError();}
 async resendVerification(){throw googleOnlyError();}
 google(link=false){return this.authFlow.google(link);}
 authReturn(url){return this.authFlow.complete(url);}
 authSettings(){return this.auth('settings');}
 async updateUser(){throw googleOnlyError();}
 async account(){const revision=this.revision,uid=this.session?.user?.id;await this.ensure();if(revision!==this.revision||this.session?.user?.id!==uid)throw new Error('계정 요청이 취소되었습니다.');const current=this.session;let user;try{user=await this.auth('user',undefined,true);}catch(error){if(error.status===401)await this.invalidateSession(current,revision,error);throw error;}if(revision!==this.revision||this.session?.user?.id!==uid)throw new Error('계정 요청이 취소되었습니다.');if(user.id!==uid)throw new Error('계정 UID가 일치하지 않습니다.');if(!isGoogleUser(user)){await this.clearSession();throw googleOnlyError();}this.session={...this.session,user};await this.save();return user;}
 async setPassword(){throw googleOnlyError();}
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
 async clearSession(){this.revision++;this.session=null;this.deletionPending=false;await this.saveQueue;if(this.bridge.native)await this.bridge.call('vaultSet',{key:'session',value:'null'});else await this.ledger.set('auth',null);this.dispatchEvent(new Event('auth'));}
 async avatar(path,blob){await this.ensure();const h={apikey:this.config.key,Authorization:'Bearer '+this.session.access_token};const r=await fetch(this.config.url+'/storage/v1/object/solaris-avatars/'+path,{method:blob?'POST':'DELETE',headers:{...h,...(blob?{'Content-Type':blob.type}:{})},body:blob,redirect:'error',signal:requestTimeout()});if(!r.ok)throw new Error('프로필 사진 저장 실패');}
 async avatarURL(path){await this.ensure();const r=await fetch(this.config.url+'/storage/v1/object/authenticated/solaris-avatars/'+path,{headers:{apikey:this.config.key,Authorization:'Bearer '+this.session.access_token},redirect:'error',signal:requestTimeout()});if(!r.ok)return null;return URL.createObjectURL(await r.blob());}
 async signal(scope,recipient,payload){return this.rpc('signal',{scope_kind:scope.kind,scope_id:scope.id,recipient,payload});}
 diagnostics(){return redact({version:this.config.version,uid:this.session?.user?.id,platform:navigator.userAgent});}
}
