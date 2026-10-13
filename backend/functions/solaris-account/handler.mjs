// Service credentials are injected only into this Edge Function. No external SDK.
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store'};
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const invalidLogin=()=>reply(401,{code:'invalid_credentials',message:'아이디 또는 비밀번호를 확인하세요. 이메일 인증도 필요합니다.'});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
async function input(req){
 if(!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw Error('body');
 const reader=req.body?.getReader();if(!reader)throw Error('body');let size=0,chunks=[];
 try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();throw Error('body');}chunks.push(value);}}finally{reader.releaseLock();}
 const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
 const body=JSON.parse(new TextDecoder().decode(data));if(!body||typeof body!=='object'||Array.isArray(body))throw Error('body');return body;
}
function claims(token){try{return JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}catch{return{};}}
export function createAccountHandler({url,serviceKey,fetchImpl=fetch,now=()=>Date.now(),wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url)||!serviceKey)throw Error('Account service configuration required');
 const upstream=async(path,body,token=serviceKey,method='POST')=>{
  const response=await fetchImpl(url+path,{method,headers:{apikey:serviceKey,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(10000)});
  let value=null;try{value=await response.json();}catch{}
  return{ok:response.ok,status:response.status,value};
 };
 const rpc=(action,args)=>upstream('/rest/v1/rpc/solaris_account_service',{action,args});
 const hashIP=async req=>{
  // This is defense in depth: ID/global counters remain effective even if an
  // intermediary does not overwrite the forwarded address header.
  const ip=(req.headers.get('x-real-ip')||req.headers.get('x-forwarded-for')?.split(',').at(-1)||'unknown').trim().slice(0,200);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(serviceKey),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(ip))),v=>v.toString(16).padStart(2,'0')).join('');
 };
 return async req=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return reply(405,{message:'허용되지 않은 요청입니다.'});
  let body;try{body=await input(req);}catch{return reply(400,{message:'요청을 확인하세요.'});}
  if(body.action==='login_id'){
   const start=now();
   try{
    const id=typeof body.user_id==='string'?body.user_id.trim().toLowerCase():'';
    if(!/^[a-z0-9_]{3,32}$/.test(id)||typeof body.password!=='string'||body.password.length<1||body.password.length>1024)return invalidLogin();
    const lookup=await rpc('login_lookup',{user_id:id,ip_hash:await hashIP(req)});
    if(!lookup.ok||!lookup.value?.allowed)return invalidLogin();
    // Unknown IDs still make a password verification request. Neither mailbox
    // nor provider/existence errors are returned to the unauthenticated caller.
    const email=lookup.value.email||`solaris-missing-${crypto.randomUUID()}@invalid.example`;
    const result=await upstream('/auth/v1/token?grant_type=password',{email,password:body.password});
    const session=result.value;
    if(!result.ok||!lookup.value.uid||session?.user?.id!==lookup.value.uid||!session?.user?.email_confirmed_at||!session.access_token||!session.refresh_token)return invalidLogin();
    return reply(200,session);
   }catch{return reply(503,{code:'account_service_unavailable',message:'로그인을 잠시 후 다시 시도하세요.'});}
   finally{await wait(Math.max(0,500-(now()-start)));}
  }
  if(body.action!=='delete_account')return reply(400,{message:'요청을 확인하세요.'});
  const token=req.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9._-]{1,8192})$/i)?.[1];
  if(!token)return reply(401,{code:'authentication_required',message:'다시 로그인하세요.'});
  let deletionStarted=false;
  try{
   // getUser verifies the JWT. Parsing claims alone never grants authority.
   const current=await upstream('/auth/v1/user',undefined,token,'GET');
   if(!current.ok||!uuid.test(current.value?.id??''))return reply(401,{code:'authentication_required',message:'다시 로그인하세요.'});
   const c=claims(token),uid=current.value.id;
   if(c.sub!==uid||!uuid.test(c.session_id??''))return reply(401,{code:'authentication_required',message:'다시 로그인하세요.'});
   const context=await rpc('delete_context',{uid,session_id:c.session_id});
   if(!context.ok)return reply(401,{code:'authentication_required',message:'다시 로그인하세요.'});
   deletionStarted=!!context.value?.deletionStarted;
   const removePaths=async paths=>{
    if(!Array.isArray(paths)||paths.some(p=>typeof p!=='string'||!p.startsWith(uid+'/')||p.includes('..')))throw Error('storage');
    for(let i=0;i<paths.length;i+=100){
     const removed=await upstream('/storage/v1/object/solaris-avatars',{prefixes:paths.slice(i,i+100)},serviceKey,'DELETE');
     if(!removed.ok)throw Error('storage');
    }
   };
   await removePaths(context.value?.paths);
   const begun=await rpc('delete_begin',{uid,session_id:c.session_id});
   if(!begun.ok)throw Error('deletion');deletionStarted=true;
   // Catch uploads committed between the first listing and tombstone. New
   // requests now fail the Storage session policy; an already running upload
   // that commits even later makes Auth fail safely and remains retryable.
   const remaining=await rpc('delete_context',{uid,session_id:c.session_id});
   if(!remaining.ok)throw Error('storage');await removePaths(remaining.value?.paths);
   // Hard deletion cascades auth.sessions/refresh tokens and runs the domain
   // cleanup trigger. The deleting tombstone already blocks retained JWTs.
   const removed=await upstream('/auth/v1/admin/users/'+uid,{should_soft_delete:false},serviceKey,'DELETE');
   if(!removed.ok)throw Error('deletion');
   return reply(200,{deleted:true});
  }catch{return reply(503,{code:'account_delete_incomplete',deletionStarted,message:deletionStarted?'탈퇴 정리가 완료되지 않았습니다. 같은 기기에서 탈퇴를 다시 시도하세요.':'탈퇴를 완료하지 못했습니다. 잠시 후 다시 시도하세요.'});}
 };
}
