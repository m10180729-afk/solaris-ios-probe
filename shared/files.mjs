import{Peer}from'./media.mjs';
import{uuid,safeName,sleep,MAX_FILE_BYTES}from'./platform.mjs';
import{SHA256}from'./sha256.mjs';
export const CHUNK=16*1024-8,WINDOW=8*CHUNK,MAX_BUFFER=512*1024;
export const validOffer=v=>/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v?.id??'')&&typeof v.name==='string'&&v.name.length<=256&&Number.isSafeInteger(v.size)&&v.size>=0&&v.size<=MAX_FILE_BYTES&&(v.sha256===undefined||/^[0-9a-f]{64}$/.test(v.sha256));
export const validCheckpoint=(s,offset)=>s?.bytes===offset&&Array.isArray(s.h)&&s.h.length===8&&s.h.every(n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff)&&Array.isArray(s.tail)&&s.tail.length===offset%64&&s.tail.every(n=>Number.isInteger(n)&&n>=0&&n<=255);
const terminal=r=>['complete','cancelled','rejected'].includes(r.state);
const integrityError=message=>Object.assign(new Error(message),{code:'integrity'});
export class Transfers extends EventTarget {
 constructor(api,disk,ledger,iceServers,mediaActive=()=>false){super();Object.assign(this,{api,disk,ledger,iceServers,mediaActive});this.records=new Map();this.peers=new Map();this.channels=new Map();this.waiters=new Map();this.receiveQueues=new Map();this.generations=new Map();this.commits=new Map();this.closed=false;this.suspended=false;this.ownerUID=api.session.user.id;}
 get uid(){return this.api.session.user.id;}
 emit(r){const dt=Math.max(.001,(Date.now()-(r.speedAt??Date.now()))/1000),speed=Math.max(0,r.offset-(r.speedOffset??r.offset))/dt;this.dispatchEvent(new CustomEvent('change',{detail:{...r,speed,eta:speed?(r.size-r.offset)/speed:null}}));}
 async save(r){r.updated=Date.now();const{onAck,...durable}=r;await this.ledger.set('transfer:'+r.id,durable);this.emit(r);}
 async init(){for(const r of await this.ledger.all())if(r?.id&&r?.direction&&r.owner===this.uid){if(['transferring','verifying','accepted'].includes(r.state)){r.state='paused';r.pauseReason='network';}if(r.size>MAX_FILE_BYTES&&!terminal(r)){r.state='failed';r.retryable=false;r.error='대용량 전송은 더 이상 지원하지 않습니다. 최대 100MiB 파일을 선택하세요.';}this.records.set(r.id,r);}}
 async offer(peer,scope,source,options={}){
  if(!Number.isSafeInteger(source?.size)||source.size<0||source.size>MAX_FILE_BYTES)throw new Error('파일은 최대 100MiB까지 보낼 수 있습니다.');
  if(options.deduplicate??true){const prior=[...this.records.values()].filter(r=>r.direction==='send'&&r.peer===peer&&r.state==='complete'&&r.size===source.size&&r.name===safeName(source.name)&&r.hash);if(prior.length){const hash=await this.disk.hash(source.id),same=prior.find(r=>r.hash===hash);if(same)return{...same,duplicate:true};}}
  const sourceHash=await this.disk.hash(source.id);const r={id:uuid(),owner:this.uid,sourceHash,peer,scope,sourceId:source.id,name:safeName(source.name),size:source.size,modified:source.modified??0,direction:'send',state:'offered',offset:0,hashState:new SHA256().snapshot(),deduplicate:options.deduplicate??true,attempt:uuid()};this.records.set(r.id,r);await this.save(r);await this.announce(r);return r;
 }
 async announce(r){await this.api.signal(r.scope,r.peer,{type:'file-offer',id:r.id,name:r.name,size:r.size,modified:r.modified,sha256:r.sourceHash,deduplicate:r.deduplicate,attempt:r.attempt});r.lastAnnounced=Date.now();await this.save(r);}
 key(remote,scope){return'files:'+([this.uid,remote].sort().join(':'))+':'+(scope.kind==='friend'?'friend':scope.kind+':'+scope.id);}
 peer(remote,scope){const k=this.key(remote,scope);let p=this.peers.get(k);if(p&&(p.closed||['failed','closed'].includes(p.pc.connectionState))){p.close();this.peers.delete(k);p=null;}if(p)return p;p=new Peer({id:k,remote,scope,api:this.api,iceServers:this.iceServers,polite:this.uid>remote});p.addEventListener('channel',e=>this.bind(e.detail,remote));p.addEventListener('error',e=>this.dispatchEvent(new CustomEvent('error',{detail:e.detail})));p.addEventListener('state',e=>{if(this.closed)return;if(['failed','disconnected','closed'].includes(e.detail))for(const r of this.records.values())if(r.peer===remote&&this.key(r.peer,r.scope)===k&&['transferring','accepted'].includes(r.state)){r.state='paused';r.pauseReason='network';r.pauseOwner=null;this.save(r).catch(()=>{});this.wake(r.id);}});this.peers.set(k,p);return p;}
 stopChannel(id){this.generations.set(id,(this.generations.get(id)??0)+1);const c=this.channels.get(id);this.channels.delete(id);c?.close();this.wake(id);}
 bind(c,remote){const id=c.label.startsWith('file:')?c.label.slice(5):null,r=this.records.get(id);if(this.closed||this.suspended||!r||terminal(r)||r.peer!==remote||r.direction==='receive'&&(!r.approved||!['accepted','transferring'].includes(r.state))){c.close();return;}const old=this.channels.get(id);this.generations.set(id,(this.generations.get(id)??0)+1);this.channels.set(id,c);old?.close();c.binaryType='arraybuffer';c.bufferedAmountLowThreshold=64*1024;c.onclose=()=>{if(this.closed||this.channels.get(id)!==c)return;if(['transferring','accepted'].includes(r.state)||r.direction==='send'&&r.state==='verifying'){r.state='paused';r.pauseReason='network';r.pauseOwner=null;this.save(r).catch(()=>{});}this.wake(id);};c.onmessage=e=>{const chain=this.receiveQueues.get(id)??Promise.resolve();this.receiveQueues.set(id,chain.then(()=>this.channels.get(id)===c?this.data(r,c,e.data):null).catch(async e=>{if(this.channels.get(id)!==c||terminal(r))return;r.state='failed';r.error=e.message;r.retryable=e.code!=='integrity';await this.save(r);c.close();this.wake(id);}));};c.onopen=()=>{if(r.direction==='send')this.pump(r,c).catch(async e=>{if(this.channels.get(id)!==c||terminal(r))return;r.state='failed';r.error=e.message;r.retryable=e.code!=='integrity';await this.save(r);});};if(c.readyState==='open')c.onopen();}
 async accept(id){const r=this.records.get(id);if(!r||r.direction!=='receive'||r.state!=='offered')return;await this.disk.create(r.id,r.name,r.size);r.approved=true;r.state='accepted';r.hashState=new SHA256().snapshot();r.offset=0;await this.save(r);this.peer(r.peer,r.scope);await this.api.signal(r.scope,r.peer,{type:'file-accept',id:r.id,offset:r.offset,hashState:r.hashState});}
 async reject(id){const r=this.records.get(id);if(!r||r.direction!=='receive'||r.state!=='offered')return;r.state='rejected';await this.save(r);await this.api.signal(r.scope,r.peer,{type:'file-reject',id});}
 async pause(id,reason='manual'){const r=this.records.get(id);if(!r||!['transferring','accepted'].includes(r.state))return;r.state='paused';r.pauseReason=reason==='background'?'background':'manual';r.pauseOwner=this.uid;await this.save(r);const c=this.channels.get(id);if(c?.readyState==='open')try{c.send(JSON.stringify({type:'pause',reason:r.pauseReason}));}catch{}this.wake(id);await this.receiveQueues.get(id);await this.disk.flush?.(r.direction==='send'?r.sourceId:r.id);await this.save(r);}
 async cancel(id,remote=false){const r=this.records.get(id);if(!r||terminal(r))return;await this.commits.get(id)?.catch(()=>{});if(terminal(r))return;r.state='cancelled';await this.save(r);this.stopChannel(id);await this.receiveQueues.get(id);if(r.direction==='receive')await this.disk.discard(id);if(!remote)await this.api.signal(r.scope,r.peer,{type:'file-cancel',id}).catch(e=>this.dispatchEvent(new CustomEvent('error',{detail:e})));}
 async receiveAccept(r){await this.receiveQueues.get(r.id);if(terminal(r)||this.closed||this.suspended)return;this.stopChannel(r.id);const info=await this.disk.check(r.id);if(!info||info.size<r.offset)throw new Error('부분 다운로드 파일이 없어 이어받을 수 없습니다.');r.state='accepted';r.error=null;r.pauseReason=null;r.pauseOwner=null;r.speedAt=Date.now();r.speedOffset=r.offset;await this.save(r);this.peer(r.peer,r.scope);await this.api.signal(r.scope,r.peer,{type:'file-accept',id:r.id,offset:r.offset,hashState:r.hashState});}
 async resume(id){const r=this.records.get(id);if(this.closed||this.suspended||!r||!['paused','failed'].includes(r.state))return;if(r.retryable===false)throw new Error('무결성 검사에 실패한 전송은 취소한 뒤 새로 전송하세요.');if(r.pauseReason==='manual'&&r.pauseOwner&&r.pauseOwner!==this.uid)throw new Error('상대방이 전송을 일시정지했습니다. 상대방의 재개를 기다리세요.');if(r.direction==='send'){const info=await this.disk.check(r.sourceId);if(!info||info.size!==r.size||r.modified&&info.modified!==undefined&&info.modified!==r.modified)throw new Error('원본 파일에 접근할 수 없습니다. 같은 파일을 다시 선택하세요.');this.stopChannel(id);r.state='offered';r.error=null;r.pauseReason=null;r.pauseOwner=null;r.attempt=uuid();await this.save(r);await this.announce(r);}else if(r.approved)await this.receiveAccept(r);}
 async reselect(id,source){const r=this.records.get(id);if(!r||r.direction!=='send'||!['paused','failed'].includes(r.state))throw new Error('일시정지된 보내기 파일만 다시 선택할 수 있습니다.');if(source.size!==r.size||await this.disk.hash(source.id)!==r.sourceHash)throw new Error('전송을 시작한 원본과 다른 파일입니다.');r.sourceId=source.id;r.modified=source.modified??0;await this.save(r);await this.resume(id);}
 async suspend(){this.suspended=true;for(const r of this.records.values())if(['accepted','transferring'].includes(r.state)){await this.pause(r.id,'background');this.stopChannel(r.id);}}
 async foreground(){this.suspended=false;await this.reconnect();}
 async handle(s){const v=s.payload,scope={kind:s.scope_kind,id:s.scope_kind==='friend'?s.sender:s.scope_id};if(v.type==='rtc'&&v.peer?.startsWith('files:')){if(this.closed||this.suspended||v.peer!==this.key(s.sender,scope))return;await this.peer(s.sender,scope).receive(v);return;}
  if(v.type==='file-offer'){if(!validOffer(v))return;const existing=this.records.get(v.id);if(existing){if(existing.direction!=='receive'||existing.peer!==s.sender||existing.size!==v.size||existing.name!==safeName(v.name)||existing.sourceHash!==v.sha256)return;if(existing.state==='complete'){await this.api.signal(scope,s.sender,{type:'file-complete',id:v.id,hash:existing.hash});return;}if(existing.retryable===false||existing.pauseReason==='manual'&&existing.pauseOwner===this.uid)return;if(existing.approved&&!terminal(existing)&&(existing.attempt!==v.attempt||!['open','connecting'].includes(this.channels.get(v.id)?.readyState))){existing.attempt=v.attempt;await this.receiveAccept(existing);}return;}const r={id:v.id,owner:this.uid,sourceHash:v.sha256,peer:s.sender,scope,name:safeName(v.name),size:v.size,modified:v.modified,direction:'receive',state:'offered',offset:0,hashState:new SHA256().snapshot(),approved:false,deduplicate:v.deduplicate,attempt:v.attempt};this.records.set(r.id,r);await this.save(r);this.dispatchEvent(new CustomEvent('offer',{detail:r}));return;}
  const r=this.records.get(v.id);if(!r||r.peer!==s.sender||terminal(r))return;
  if(v.type==='file-accept'&&r.direction==='send'){if(this.closed||this.suspended||r.pauseReason==='manual'&&r.pauseOwner===this.uid)return;if(!Number.isSafeInteger(v.offset)||v.offset<0||v.offset>r.size||!validCheckpoint(v.hashState,v.offset))return;this.stopChannel(r.id);r.offset=v.offset;r.hashState=v.hashState;r.approved=true;r.state='accepted';r.pauseReason=null;r.pauseOwner=null;await this.save(r);const p=this.peer(r.peer,r.scope),c=p.pc.createDataChannel('file:'+r.id,{ordered:true});this.bind(c,r.peer);return;}
  if(v.type==='file-reject'&&r.direction==='send'){r.state='rejected';await this.save(r);this.stopChannel(r.id);return;}
  if(v.type==='file-cancel'){await this.cancel(r.id,true);return;}
  if(v.type==='file-complete'&&r.direction==='send'&&(r.hash??r.sourceHash)===v.hash)await this.complete(r,v.hash);
 }
 async reconcile(snapshot){for(const r of this.records.values()){if(terminal(r))continue;const allowed=r.scope.kind==='friend'?snapshot.friends.some(f=>f.status==='accepted'&&f.profile.uid===r.peer):r.scope.kind==='direct'?snapshot.sessions.some(s=>s.id===r.scope.id&&s.state==='accepted'):snapshot.channels.some(c=>c.id===r.scope.id&&c.files_enabled)&&snapshot.members.some(m=>m.channel_id===r.scope.id&&m.profile.uid===r.peer)&&snapshot.members.some(m=>m.channel_id===r.scope.id&&m.profile.uid===this.uid);if(!allowed){r.error='친구 또는 채널의 전송 권한이 종료되었습니다.';await this.cancel(r.id,true);}}}
 async reconnect(){if(this.closed||this.suspended)return;for(const r of this.records.values()){if(r.state==='offered'&&r.direction==='send'&&Date.now()-(r.lastAnnounced??0)>30000)await this.announce(r).catch(()=>{});if(r.state==='paused'&&['network','background'].includes(r.pauseReason)&&r.approved)await this.resume(r.id).catch(e=>{r.error=e.message;this.save(r).catch(()=>{});});}}
 async complete(r,hash){if(terminal(r))return;r.hash=hash;r.offset=r.size;r.state='complete';r.error=null;await this.save(r);this.wake(r.id);this.dispatchEvent(new CustomEvent('complete',{detail:r}));}
 wake(id){this.waiters.get(id)?.();this.waiters.delete(id);}
 async wait(id){await new Promise(resolve=>{const finish=()=>{clearTimeout(timer);if(this.waiters.get(id)===finish)this.waiters.delete(id);resolve();};const timer=setTimeout(finish,10000);this.waiters.set(id,finish);});}
 async pace(bytes){const now=Date.now(),duration=bytes/(this.mediaActive()?250:2000),slot=Math.max(now,this.nextSlot??now);this.nextSlot=slot+duration;await sleep(Math.max(0,slot+duration-now));}
 async pump(r,c){if(c.readyState!=='open')return;const generation=this.generations.get(r.id),current=()=>this.channels.get(r.id)===c&&this.generations.get(r.id)===generation;r.state='transferring';r.speedAt=Date.now();r.speedOffset=r.offset;await this.save(r);const hash=new SHA256(r.hashState);let sent=r.offset,ack=r.offset,lastAck=Date.now();const checkpoints=new Map([[sent,hash.snapshot()]]);const onAck=async offset=>{if(!current()||!Number.isSafeInteger(offset)||offset<ack||offset>sent||!checkpoints.has(offset))return;ack=offset;r.offset=offset;r.hashState=checkpoints.get(offset);for(const k of checkpoints.keys())if(k<offset)checkpoints.delete(k);lastAck=Date.now();await this.save(r);this.wake(r.id);};r.onAck=onAck;
  try{while(sent<r.size&&r.state==='transferring'&&c.readyState==='open'&&current()){while((sent-ack>=WINDOW||c.bufferedAmount>MAX_BUFFER)&&r.state==='transferring'&&c.readyState==='open'&&current()){if(Date.now()-lastAck>30000)throw new Error('수신 응답이 중단되었습니다. 이어받기를 사용하세요.');await sleep(10);}if(r.state!=='transferring'||c.readyState!=='open'||!current())break;const bytes=await this.disk.read(r.sourceId,sent,Math.min(CHUNK,r.size-sent));if(!current()||r.state!=='transferring')break;if(!bytes.length)throw new Error('원본 파일이 변경되었습니다.');const packet=new Uint8Array(8+bytes.length);new DataView(packet.buffer).setBigUint64(0,BigInt(sent),false);packet.set(bytes,8);hash.update(bytes);sent+=bytes.length;checkpoints.set(sent,hash.snapshot());c.send(packet);await this.pace(bytes.length);}
   if(r.state!=='transferring'||!current())return;while(ack<sent&&c.readyState==='open'&&r.state==='transferring'&&current()){if(Date.now()-lastAck>30000)throw new Error('수신 응답 시간 초과');await this.wait(r.id);}if(c.readyState!=='open'||r.state!=='transferring'||!current())return;r.hash=hash.digest();if(r.sourceHash&&r.hash!==r.sourceHash)throw new Error('전송 도중 원본 파일이 변경되었습니다.');r.state='verifying';await this.save(r);c.send(JSON.stringify({type:'finish',hash:r.hash,size:r.size}));
  }finally{if(r.onAck===onAck)delete r.onAck;}
 }
 async data(r,c,data){
  if(terminal(r))return;
  const send=value=>{if(c.readyState==='open'||c.readyState===undefined)try{c.send(JSON.stringify(value));}catch{}};
  if(typeof data==='string'){
   if(data.length>4096)throw new Error('Invalid file control packet');
   const v=JSON.parse(data);
   if(v.type==='ack'&&r.direction==='send'){await r.onAck?.(v.offset);return;}
   if(v.type==='pause'){
    if(this.commits.has(r.id))return;
    if(r.pauseReason==='manual'&&r.pauseOwner===this.uid)return;
    r.state='paused';r.pauseReason=v.reason==='background'?'background':'manual';r.pauseOwner=r.peer;
    await this.save(r);this.wake(r.id);return;
   }
   if(v.type==='complete'&&r.direction==='send'&&v.hash===r.hash){await this.complete(r,v.hash);c.close?.();return;}
   if(v.type==='finish'&&r.direction==='receive'&&r.approved&&['accepted','transferring','verifying'].includes(r.state)){
    if(r.offset!==r.size||v.size!==r.size||new SHA256(r.hashState).digest()!==v.hash||r.sourceHash&&r.sourceHash!==v.hash)throw integrityError('SHA-256 무결성 검사 실패 · 취소한 뒤 새로 전송하세요.');
    r.state='verifying';await this.save(r);
    if(this.disk.hash&&await this.disk.hash(r.id)!==v.hash)throw integrityError('저장 파일의 SHA-256 무결성 검사 실패 · 취소한 뒤 새로 전송하세요.');
    if(r.state!=='verifying')return;
    // Once the verified file is being committed, finish wins over a late cancel.
    // A closed transport must never turn a valid saved file into a failed record.
    const commit=(async()=>{await this.disk.finish(r.id,r.name,r.size);await this.complete(r,v.hash);})();
    this.commits.set(r.id,commit);
    try{await commit;}finally{this.commits.delete(r.id);}
    send({type:'complete',hash:v.hash});
    await this.api.signal(r.scope,r.peer,{type:'file-complete',id:r.id,hash:v.hash}).catch(e=>this.dispatchEvent(new CustomEvent('error',{detail:e})));
    return;
   }
   return;
  }
  if(r.direction!=='receive'||!r.approved||!['accepted','transferring'].includes(r.state))return;
  const b=new Uint8Array(data);if(b.length<8||b.length>CHUNK+8)throw new Error('Invalid file packet');
  const offset=Number(new DataView(b.buffer,b.byteOffset,b.byteLength).getBigUint64(0,false));
  if(offset<r.offset){send({type:'ack',offset:r.offset});return;}
  if(offset!==r.offset||offset+b.length-8>r.size)throw new Error('파일 청크 순서 오류');
  if(!r.speedAt){r.speedAt=Date.now();r.speedOffset=r.offset;}
  await this.disk.write(r.id,offset,b.subarray(8));
  if(terminal(r)||this.closed)return;
  r.hashState=new SHA256(r.hashState).update(b.subarray(8)).snapshot();r.offset+=b.length-8;
  if(r.state==='accepted')r.state='transferring';await this.save(r);send({type:'ack',offset:r.offset});
 }
 close(){this.closed=true;for(const id of this.channels.keys())this.stopChannel(id);for(const p of this.peers.values())p.close();}
}
