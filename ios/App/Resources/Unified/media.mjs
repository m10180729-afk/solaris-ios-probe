import{applySenderPolicy,tuneDesktopSDP,tuneScreenOfferSDP,selectCodecs,selectAudioCodecs}from'./build54-screen.mjs';
import{uuid,sleep,redact}from'./platform.mjs';
export const CONNECTION_LIMITS=Object.freeze({peerGrace:15000,publisherGrace:30000,controlTimeout:45000,firstFrameTimeout:30000,recoveryTimeout:45000,retryInterval:5000,maxRecoveries:3});
// One high-quality policy on every platform. Native capture keeps the source's
// aspect ratio and never upscales a smaller display. Congestion affects only
// the requesting peer's bitrate, never the shared source or its frame rate.
export const HIGH_QUALITY=Object.freeze({width:1920,height:1080,fps:60,mbps:12,maxMbps:18,mode:'high',engine:'build54'});
export function nativeQuality(platform){return platform==='ios'?{...HIGH_QUALITY,mbps:28,maxMbps:60,maxLongSide:1920}:{...HIGH_QUALITY};}
export function preferScreenCodec(pc){const codecs=globalThis.RTCRtpReceiver?.getCapabilities?.('video')?.codecs;if(!codecs)return;const h264=codecs.filter(c=>c.mimeType.toLowerCase()==='video/h264');if(!h264.length)return;const rest=codecs.filter(c=>/\/(rtx|red|ulpfec|flexfec-03)$/i.test(c.mimeType));for(const t of pc.getTransceivers?.()??[])if(t.receiver?.track?.kind==='video'&&t.setCodecPreferences)t.setCodecPreferences([...h264,...rest]);}
export class AdaptiveQuality {
 constructor(target){this.target={...HIGH_QUALITY,...target};this.level=0;this.bad=0;this.good=0;}
 sample(s){if(!s||s.frames<10||s.state==='failed'||s.state==='disconnected')return null;const bad=s.loss>3||s.rtt>350||s.jitter>60;this.bad=bad?this.bad+1:0;this.good=!bad&&s.loss<1&&s.rtt<200?this.good+1:0;if(this.bad>=3){this.level=Math.min(3,this.level+1);this.bad=0;this.good=0;}else if(this.good>=8){this.level=Math.max(0,this.level-1);this.good=0;}if(this.sentLevel===this.level)return null;this.sentLevel=this.level;const q=this.target;this.current={...q,mbps:Math.max(Math.min(8,q.mbps),Math.round(q.mbps*[1,.85,.7,.55][this.level]))};return this.current;}
}
export function qualityGrade(s){if(s?.active&&s.frames===0)return{color:'black',text:'첫 영상 대기'};if(s?.qualityMeasured===false&&s.active&&s.frames>0)return{color:'black',text:'영상 수신 중 · 품질 측정 불가'};if(!s||s.state==='disconnected'||s.state==='failed'||!s.active)return{color:'black',text:s?.active===false?'방송 미참여':'연결 끊김 / 측정 불가'};const score=Math.max((s.rtt??0)/80,(s.loss??0)/1.5,(s.jitter??0)/15,s.stalled?10:0);return score<=1?{color:'blue',text:'매우 좋음'}:score<=2?{color:'green',text:'좋음'}:score<=3?{color:'yellow',text:'보통'}:score<=5?{color:'orange',text:'나쁨'}:{color:'red',text:'매우 나쁨'};}
export function safeMediaStats(value){
 const result={};if(!value||typeof value!=='object')return result;
 for(const k of ['fps','frames','width','height','rtt','loss','jitter','encodeMilliseconds','decodeMilliseconds','availableMbps','queueMilliseconds','framesDropped','presentationFPS','fpsLow1','longestFrameMilliseconds','frameGapCount'])if(Number.isFinite(value[k])&&value[k]>=0)result[k]=Math.min(value[k],1e12);
 if(['new','connecting','connected','disconnected','failed','closed','running','active'].includes(value.state))result.state=value.state;
 if(['none','cpu','bandwidth','other'].includes(value.qualityLimitationReason))result.qualityLimitationReason=value.qualityLimitationReason;
 for(const k of ['qualityMeasured','presentationMeasured','stalled'])if(typeof value[k]==='boolean')result[k]=value[k];
 if(typeof value.codec==='string'&&/^video\/(h264|h265|vp8|vp9|av1)$/i.test(value.codec))result.codec=value.codec;
 if(typeof value.encoder==='string'&&/^(h264_(nvenc|qsv|amf)|nvenc|qsv|amf|libx264|NVIDIA NVENC|Intel Quick Sync|AMD AMF|VideoToolbox|hardware|software)$/i.test(value.encoder))result.encoder=value.encoder;
 return result;
}
export function diagnoseQuality(receiver,sender){
 const unknown={state:'unknown',text:'측정 대기'};
 const network=receiver&&receiver.qualityMeasured!==false&&((receiver.loss??0)>3||(receiver.rtt??0)>350||(receiver.jitter??0)>60);
 const encoding=sender&&(sender.qualityLimitationReason==='cpu'||(sender.encodeMilliseconds??0)>24);
 const upload=sender&&(sender.qualityLimitationReason==='bandwidth'||(sender.queueMilliseconds??0)>150);
 const decoding=receiver&&((receiver.decodeMilliseconds??0)>24||(receiver.presentationMeasured&&(receiver.fpsLow1??60)<30));
 const receiverMeasured=receiver&&receiver.frames>0&&(Number.isFinite(receiver.decodeMilliseconds)||receiver.presentationMeasured||receiver.qualityMeasured===true);
 return{sender:!sender||sender.qualityMeasured===false?unknown:{state:encoding||upload?'bad':'good',text:encoding?'인코딩 지연':upload?'송신 전송 지연':'송신 측정 정상'},
  receiver:!receiverMeasured?unknown:{state:decoding?'bad':'good',text:decoding?'디코딩·재생 간격 불안정':'수신 처리 정상'},
  path:receiver?.qualityMeasured===false||!receiver?{state:'unknown',text:'네트워크 측정 불가'}:{state:network?'bad':'good',text:network?'연결 경로 지연·손실':'연결 경로 측정 정상'},
  explanation:network?'왕복 지연·손실만으로 어느 쪽 인터넷이 원인인지 확정할 수 없습니다.':decoding?'수신 기기의 디코딩·재생 지연을 확인하세요.':encoding?'송신 기기의 캡처·인코딩 부하를 확인하세요.':'양쪽 측정값으로 연결 상태를 확인합니다.'};
}
export class SenderMeter {
 constructor(){this.last=null;}
 measure(report,state='connected'){
  let frames=0,bytes=0,encode=0,stamp=0,rtt,loss,availableMbps,width,height,reason;
  report.forEach(s=>{stamp=Math.max(stamp,s.timestamp??0);if(s.type==='outbound-rtp'&&(s.kind==='video'||s.mediaType==='video')){frames+=s.framesEncoded??0;bytes+=s.bytesSent??0;encode+=s.totalEncodeTime??0;width=s.frameWidth;height=s.frameHeight;reason=s.qualityLimitationReason;}
   if(s.type==='remote-inbound-rtp'&&(s.kind==='video'||s.mediaType==='video')){rtt=(s.roundTripTime??0)*1000;loss=(s.fractionLost??0)*100;}
   if(s.type==='candidate-pair'&&s.nominated&&Number.isFinite(s.availableOutgoingBitrate))availableMbps=s.availableOutgoingBitrate/1e6;});
  const p=this.last,dt=p?Math.max(.001,(stamp-p.stamp)/1000):0,d=p?Math.max(0,frames-p.frames):0;
  this.last={stamp,frames,bytes,encode};return safeMediaStats({state,frames,fps:dt?d/dt:0,width,height,rtt,loss,availableMbps,qualityMeasured:!!p,qualityLimitationReason:reason,encodeMilliseconds:d?Math.max(0,encode-p.encode)*1000/d:undefined});
 }
}
export function viewerAllowed(remote,b,snapshot){if(b.scope.kind==='direct')return snapshot.sessions?.some(s=>s.id===b.scope.id&&s.state==='accepted'&&[s.a,s.b].includes(remote))??false;const server=snapshot.channels?.find(c=>c.id===b.scope.id)?.server_id;return !!server&&snapshot.members?.some(m=>m.server_id===server&&m.profile.uid===remote);}
export class QualityMeter {
 constructor(){this.last=null;this.smoothed=null;}
 measure(report,state='connected'){
  let bytes=0,frames=0,lost=0,packets=0,rtt=0,jitter=0,width=0,height=0,stamp=0,dropped=0,decodeTime=0,codec='',decoder='';
  report.forEach(s=>{
   stamp=Math.max(stamp,s.timestamp??0);
   if(s.type==='candidate-pair'&&s.state==='succeeded'&&s.nominated)rtt=(s.currentRoundTripTime??0)*1000;
   if(s.type==='inbound-rtp'&&(s.kind==='video'||s.mediaType==='video')){
    bytes+=s.bytesReceived??0;frames+=s.framesDecoded??0;lost+=s.packetsLost??0;packets+=s.packetsReceived??0;
    dropped+=s.framesDropped??0;decodeTime+=s.totalDecodeTime??0;
    jitter=Math.max(jitter,(s.jitter??0)*1000);width=s.frameWidth??0;height=s.frameHeight??0;
    codec=report.get?.(s.codecId)?.mimeType??codec;decoder=s.decoderImplementation??decoder;
   }
  });
  const prev=this.last,dt=prev?Math.max(.001,(stamp-prev.stamp)/1000):0,decoded=prev?Math.max(0,frames-prev.frames):0;
  const raw={state,active:true,rtt,jitter,loss:prev?Math.max(0,lost-prev.lost)/Math.max(1,packets-prev.packets+lost-prev.lost)*100:0,
   fps:prev?decoded/dt:0,mbps:prev?Math.max(0,bytes-prev.bytes)*8/dt/1e6:0,width,height,frames,codec,decoder,
   framesDropped:prev?Math.max(0,dropped-prev.dropped):0,decodeMilliseconds:decoded?Math.max(0,decodeTime-prev.decodeTime)*1000/decoded:0,
   stalled:!!prev&&frames===prev.frames&&bytes>prev.bytes};
  this.last={stamp,bytes,frames,lost,packets,dropped,decodeTime};
  this.smoothed={...raw,rtt:this.smooth('rtt',rtt),loss:this.smooth('loss',raw.loss),jitter:this.smooth('jitter',jitter)};return this.smoothed;
 }
 smooth(k,v){return this.smoothed?.[k]===undefined?v:this.smoothed[k]*.75+v*.25;}
}
// Perfect negotiation and queued ICE apply to file peers and browser media peers.
export class Peer extends EventTarget {
 constructor({id,remote,scope,api,iceServers,polite}){super();Object.assign(this,{id,remote,scope,api,polite});this.pc=new RTCPeerConnection({iceServers,bundlePolicy:'max-bundle'});this.makingOffer=false;this.ignoreOffer=false;this.settingAnswer=false;this.ice=[];this.serial=Promise.resolve();this.closed=false;this.epoch=uuid();this.remoteEpoch=null;
  this.pc.onicecandidate=e=>{if(e.candidate)this.send({candidate:e.candidate.toJSON()}).catch(e=>this.error(e));};
  this.pc.onnegotiationneeded=()=>this.enqueue(async()=>{try{this.makingOffer=true;if(this.transformOffer){const offer=await this.pc.createOffer();await this.pc.setLocalDescription({type:'offer',sdp:this.transformOffer(offer.sdp)});}else await this.pc.setLocalDescription();await this.send({description:this.pc.localDescription.toJSON()});}finally{this.makingOffer=false;}});
  this.pc.ontrack=e=>this.dispatchEvent(new CustomEvent('track',{detail:e}));
  this.pc.ondatachannel=e=>this.dispatchEvent(new CustomEvent('channel',{detail:e.channel}));
  this.pc.onconnectionstatechange=()=>this.dispatchEvent(new CustomEvent('state',{detail:this.pc.connectionState}));
 }
 error(e){this.dispatchEvent(new CustomEvent('error',{detail:e}));}
 enqueue(fn){const next=this.serial.then(()=>{if(!this.closed)return fn();});this.serial=next.catch(e=>this.error(e));return next;}
 send(v){return this.api.signal(this.scope,this.remote,{type:'rtc',peer:this.id,epoch:this.epoch,...v,...(v.description?.type==='answer'?{replyTo:this.remoteEpoch}:{})});}
 receive(v){return this.enqueue(async()=>{if(v.description){const d=v.description;if(d.type==='answer'&&v.replyTo!==this.epoch)return;const ready=!this.makingOffer&&(this.pc.signalingState==='stable'||this.settingAnswer),collision=d.type==='offer'&&!ready;this.ignoreOffer=!this.polite&&collision;if(this.ignoreOffer)return;this.remoteEpoch=v.epoch;this.settingAnswer=d.type==='answer';try{await this.pc.setRemoteDescription(d);}finally{this.settingAnswer=false;}for(const c of this.ice.splice(0)){if(c.epoch===this.remoteEpoch)await this.pc.addIceCandidate(c.candidate);}if(d.type==='offer'){await this.pc.setLocalDescription(await this.pc.createAnswer());await this.send({description:this.pc.localDescription.toJSON()});}}else if(v.candidate){if(this.ignoreOffer)return;if(this.pc.remoteDescription&&v.epoch===this.remoteEpoch)await this.pc.addIceCandidate(v.candidate);else if(this.ice.length<128)this.ice.push(v);}});}
 close(){this.closed=true;this.pc.close();this.ice=[];}
}
// Serialize a UID’s receiver teardown across WebView/app engine replacements.
const viewerOperations=new Map();
// Native capture teardown must also finish before a replacement engine starts.
const publisherOperations=new WeakMap();
export class Media extends EventTarget {
 constructor(api,bridge,settings){super();this.api=api;this.ownerUID=api.session.user.id;this.joining=new Map();this.bridge=bridge;this.settings=settings;this.peers=new Map();this.nativePeers=new Map();this.nativePeerStates=new Map();this.nativeReceivers=new Map();this.meters=new Map();this.watching=new Map();this.early=new Map();this.stream=null;this.broadcast=null;this.snapshot={broadcasts:[]};this.native=bridge.native;this.reconnects=0;this.disconnectTimers=new Map();this.watchEpochs=new Map();this.senderStats=new Map();this.playbackStats=new Map();this.lastServerContact=Date.now();this.nativeListener=e=>this.nativeEvent(e.detail);bridge.addEventListener('event',this.nativeListener);this.offline=()=>{this.offlineSince??=Date.now();};globalThis.addEventListener?.('offline',this.offline);this.timer=setInterval(()=>this.tick().catch(e=>this.error(e)),2500);this.timer.unref?.();this.controlTimer=setInterval(()=>this.controlTick().catch(e=>this.error(e)),5000);this.controlTimer.unref?.();this.guard=setInterval(()=>this.connectionGuard(),1000);this.guard.unref?.();}
 async platform(){return this.platformInfo??=(this.native?await this.bridge.call('platform'):{platform:'browser'});}
 get uid(){return this.ownerUID;}
 get ice(){return this.settings.iceServers??[{urls:['stun:stun.l.google.com:19302','stun:global.stun.twilio.com:3478']}];}
 error(e){this.dispatchEvent(new CustomEvent('error',{detail:e}));}
 emit(type,detail){this.dispatchEvent(new CustomEvent(type,{detail}));}
 setPlaybackMetrics(id,value){if(this.watching.has(id))this.playbackStats.set(id,safeMediaStats(value));}
 quality(id,value){const stored=this.senderStats.get(id),sender=stored&&Date.now()-stored.at<15000?stored.stats:null;
  const stats={...value,...this.playbackStats.get(id),sender,receiver:safeMediaStats({...value,...this.playbackStats.get(id)}),disposition:diagnoseQuality({...value,...this.playbackStats.get(id)},sender)};
  this.emit('quality',{id,stats,grade:qualityGrade(stats)});return stats;
 }
 endConnections(reason){if(this.closed||(!this.broadcast&&!this.watching.size&&!this.starting))return;this.emit('diagnostics',{event:'connection-ended',reason,controlAgeMilliseconds:Date.now()-this.lastServerContact});
  for(const id of [...this.watching.keys()])this.failWatch(id,new Error(reason));
  if(this.broadcast||this.starting){this.stop().catch(e=>this.error(e));this.error(new Error(reason));}
 }
 liveConnection(){return this.broadcast?.nativeSignaling||this.broadcast?.transport==='replaykit'||[...this.peers.values()].some(p=>!p.closed&&p.pc.connectionState==='connected')||[...this.nativeReceivers.values()].some(n=>n.stats?.active!==false&&n.stats?.state==='connected');}
 connectionGuard(){if(this.closed)return;const now=Date.now();if(globalThis.navigator?.onLine===false)this.offlineSince??=now;else this.offlineSince=null;
  // A blocked stats/decoder promise must not suspend the recovery deadline.
  for(const[id,w]of this.watching){if(w.recoveryStarted!=null&&now-w.recoveryStarted>=CONNECTION_LIMITS.recoveryTimeout)this.failWatch(id,new Error('영상 연결을 복구하지 못해 시청을 종료했습니다.'));else if(!w.frames&&now-w.lastFrame>=CONNECTION_LIMITS.firstFrameTimeout)this.recoverWatch(id);}
  if(this.offlineSince&&now-this.offlineSince>=CONNECTION_LIMITS.peerGrace&&!this.liveConnection())this.endConnections('인터넷 연결이 복구되지 않아 화면공유를 종료했습니다.');
  else if((this.broadcast||this.watching.size)&&now-this.lastServerContact>CONNECTION_LIMITS.controlTimeout&&!this.liveConnection())this.endConnections('서버와 화면공유 연결이 복구되지 않아 종료했습니다.');
 }
 async controlTick(){
  if(this.closed)return;
  // Consent renewal must not wait for a slow native decoder/getStats call.
  for(const[id,w]of this.watching){const n=this.nativeReceivers.get(id),p=[...this.peers.values()].find(p=>p.broadcast===id&&!p.sending),cid=n?.connectionID??p?.nativeConnection??p?.remoteEpoch;
   const stats=w.controlStats&&Date.now()-w.controlStatsAt<10000?w.controlStats:{frames:w.frames??0,fps:0,qualityMeasured:false};
   this.sendHeartbeat(id,w,cid,{...stats,state:n?.stats?.state??p?.pc.connectionState??'connecting'});
  }
  const b=this.broadcast;if(!b||b.transport==='replaykit'||b.nativeSignaling||this.touchingBroadcast===b)return;
  this.touchingBroadcast=b;try{const alive=await this.api.rpc('broadcast_touch',{id:b.id});if(this.broadcast!==b||this.closed)return;this.lastServerContact=Date.now();if(!alive)await this.stop();}finally{if(this.touchingBroadcast===b)this.touchingBroadcast=null;}
 }
 publisherDisconnected(){const b=this.broadcast;if(!b?.hadConnection)return;const key='publisher:'+b.id;
  // Viewers may leave and rejoin an ongoing broadcast without stopping its
  // capture. The independent publisher lease still ends a real outage.
  clearTimeout(this.disconnectTimers.get(key));this.disconnectTimers.delete(key);
 }
 peerState(p,state){this.emit('state',{id:p.broadcast,state});if(this.closed||p.closed||this.peers.get(p.id)!==p)return;
  if(state==='disconnected'&&this.disconnectTimers.has(p.id))return;
  clearTimeout(this.disconnectTimers.get(p.id));this.disconnectTimers.delete(p.id);
  if(state==='connected'){const w=this.watching.get(p.broadcast);if(!p.sending&&w?.frames>0){w.recoveryStarted=null;w.retries=0;}if(p.sending&&this.broadcast?.id===p.broadcast){this.broadcast.hadConnection=true;this.publisherDisconnected();}return;}
  if(!['failed','disconnected','closed'].includes(state))return;
  const end=()=>{if(this.peers.get(p.id)!==p||p.pc.connectionState==='connected')return;this.disconnectTimers.delete(p.id);
   if(p.sending){p.close();this.peers.delete(p.id);this.meters.delete(p.id);this.publisherDisconnected();}
   else if(p.pc.connectionState==='closed')this.failWatch(p.broadcast,new Error('화면공유 연결이 종료되었습니다.'));else this.recoverWatch(p.broadcast);};
  if(state==='disconnected'){const ticket=setTimeout(end,CONNECTION_LIMITS.peerGrace);ticket.unref?.();this.disconnectTimers.set(p.id,ticket);}else end();
 }
 recoverWatch(id){
  const w=this.watching.get(id);if(!w||this.closed||w.recoveryPending)return;
  const now=Date.now();w.recoveryStarted??=now;
  if(now-w.recoveryStarted>=CONNECTION_LIMITS.recoveryTimeout){this.failWatch(id,new Error('화면공유 연결을 복구하지 못해 시청을 종료했습니다.'));return;}
  if(w.lastRecovery!==undefined&&now-w.lastRecovery<CONNECTION_LIMITS.retryInterval||w.retries>=CONNECTION_LIMITS.maxRecoveries)return;
  w.lastRecovery=now;w.retries++;this.reconnects++;this.emit('state',{id,state:'reconnecting'});
  const p=[...this.peers.values()].find(p=>p.broadcast===id&&!p.sending),n=this.nativeReceivers.get(id),b=w.broadcast;
  const task=b.transport==='browser'&&p?.pc.restartIce?Promise.resolve().then(()=>p.pc.restartIce()):this.join(b,{connectionID:n?.connectionID??p?.nativeConnection,epoch:p?.remoteEpoch});
  w.recoveryPending=Promise.resolve(task).catch(e=>{if(this.watching.get(id)===w)this.error(e);}).finally(()=>{if(this.watching.get(id)===w)w.recoveryPending=null;});
 }
 start(scope){
  if(this.closed)return Promise.reject(new Error('종료된 화면공유 엔진입니다.'));
  if(this.starting)return this.starting;
  const epoch=this.startEpoch=(this.startEpoch??0)+1,task=this.startOnce({...scope},epoch);
  this.starting=task;this.emit('starting',true);
  const finish=()=>{if(this.starting===task)this.starting=null;this.emit('starting',false);};task.then(finish,finish);return task;
 }
 checkStart(epoch){if(this.closed||this.startEpoch!==epoch||this.api.session?.user?.id!==this.uid)throw new DOMException('화면공유 시작이 취소되었습니다.','AbortError');}
 async startOnce(scope,epoch){
  await this.stopCurrent();this.checkStart(epoch);
  let platform='browser',nativeSignaling=false,stream=null,created=null;
  try{
   if(this.native){const p=await this.platform();platform=p.platform;nativeSignaling=p.nativeSignaling===true;if(p.canPublish===false||p.mediaSend===false||platform==='android')throw new Error('Android에서는 화면공유를 시청할 수 있습니다. 송출은 Windows 또는 iPad에서 시작하세요.');}
   this.checkStart(epoch);const q=nativeQuality(platform),transport=platform==='ios'?'replaykit':['windows','android'].includes(platform)?'native':'browser';
   if(transport==='browser'){
    stream=await navigator.mediaDevices.getDisplayMedia({video:{width:{ideal:q.width},height:{ideal:q.height},frameRate:{ideal:q.fps,max:q.fps}},audio:false});
    this.checkStart(epoch);this.stream=stream;stream.getVideoTracks()[0].onended=()=>this.stop().catch(e=>this.error(e));
   }
   created=await this.api.rpc('broadcast_start',{scope_kind:scope.kind,scope_id:scope.id,transport,quality:q,attempt_id:uuid()});this.lastServerContact=Date.now();
   this.checkStart(epoch);const b=this.broadcast={id:created.id,publisher:this.uid,scope,quality:q,transport,nativeSignaling,started:Date.now(),pending:transport==='replaykit'};
   if(transport==='replaykit'){
    await this.api.ensure();this.checkStart(epoch);await this.bridge.call('broadcastPrepare',{...b,url:this.api.config.url,key:this.api.config.key,accessToken:this.api.session.access_token,refreshToken:this.api.session.refresh_token,expiresAt:this.api.session.expires_at,uid:this.uid,iceServers:this.ice});this.checkStart(epoch);this.emit('picker',b);
   }else if(transport==='native'){
    await this.api.ensure();this.checkStart(epoch);await this.bridge.call('mediaStart',{id:b.id,quality:q,iceServers:this.ice,...(nativeSignaling?{scope,url:this.api.config.url,key:this.api.config.key,uid:this.uid}:{})});
   }
   this.checkStart(epoch);if(transport!=='replaykit'&&!nativeSignaling){const alive=await this.api.rpc('broadcast_touch',{id:b.id});if(!alive)throw new Error('다른 기기에서 화면공유가 시작되어 이 방송을 종료합니다.');}
   this.checkStart(epoch);this.emit('broadcast',b);return b;
  }catch(e){
   for(const t of stream?.getTracks()??[]){t.onended=null;t.stop();}
   await this.stopCurrent();if(created&&this.api.session?.user?.id===this.uid)await this.api.rpc('broadcast_stop',{id:created.id}).catch(()=>{});throw e;
  }
 }
 async stop(){this.startEpoch=(this.startEpoch??0)+1;await this.stopCurrent();}
 async stopCurrent(){
  const b=this.broadcast;this.broadcast=null;
  for(const t of this.stream?.getTracks()??[]){t.onended=null;t.stop();}this.stream=null;
  for(const[k,p]of this.peers)if(p.sending){p.close();this.peers.delete(k);this.meters.delete(k);}
  this.nativePeers.clear();this.nativePeerStates.clear();for(const[key,ticket]of this.disconnectTimers)if(key.startsWith('publisher:')||key.startsWith('native:')){clearTimeout(ticket);this.disconnectTimers.delete(key);}if(b)this.emit('broadcast',null);
  this.nativeSenderStats=null;this.receiverReadings?.clear();this.nativeGenerations?.clear();
  // A new start waits for the previous native stop, even after UI recovers.
  const before=publisherOperations.get(this.bridge)??Promise.resolve();
  this.publisherCleanup=before.then(async()=>{if(b)await Promise.allSettled([...(b.transport!=='browser'?[this.bridge.call('mediaStop',{id:b.id})]:[]),...(this.api.session?.user?.id===this.uid?[this.api.rpc('broadcast_stop',{id:b.id})]:[])]);});
  publisherOperations.set(this.bridge,this.publisherCleanup);
  await this.publisherCleanup;
  if(publisherOperations.get(this.bridge)===this.publisherCleanup)publisherOperations.delete(this.bridge);
 }
 watch(b){
  if(this.closed||b.publisher===this.uid||this.watching.has(b.id))return Promise.resolve();
  if(this.joining.has(b.id))return this.joining.get(b.id);
  const pending=[...this.joining.keys()].filter(id=>!this.watching.has(id)).length;
  if(this.watching.size+pending>=(this.settings.maxReceive??4))return Promise.reject(new Error('동시 시청 제한에 도달했습니다. 설정에서 변경할 수 있습니다.'));
  const key=this.uid+':'+b.id,prior=viewerOperations.get(key),epoch=(this.watchEpochs.get(b.id)??0)+1;this.watchEpochs.set(b.id,epoch);
  const task=(async()=>{
   if(prior)await prior.catch(()=>{});if(this.closed)return;
   await this.api.rpc('broadcast_watch',{id:b.id});
   this.lastServerContact=Date.now();if(this.closed||this.watchEpochs.get(b.id)!==epoch){if(this.api.session?.user?.id===this.uid)await this.api.rpc('broadcast_unwatch',{id:b.id}).catch(()=>{});return;}
   this.watching.set(b.id,{broadcast:b,lastJoin:0,lastFrame:Date.now(),started:Date.now(),retries:0,frames:0});
   try{await this.join(b);}catch(e){this.unwatch(b.id);throw e;}
  })();
  this.joining.set(b.id,task);viewerOperations.set(key,task);
  const finish=()=>{if(this.joining.get(b.id)===task)this.joining.delete(b.id);if(viewerOperations.get(key)===task)viewerOperations.delete(key);};task.then(finish,finish);return task;
 }
 async join(b,recover){if(recover)this.emit('state',{id:b.id,state:'reconnecting'});if(b.transport==='replaykit')return this.viewerOffer(b,!!recover);const w=this.watching.get(b.id);if(!w)return;w.lastJoin=Date.now();await this.api.signal({kind:b.scope_kind,id:b.scope_id},b.publisher,{type:recover?'media-recover':'media-join',broadcast:b.id,...(recover??{})});}
 async receiverPeer(b,connectionID){
  const id='media:'+b.id+':'+this.uid,scope={kind:b.scope_kind,id:b.scope_id};
  this.peers.get(id)?.close();this.peers.delete(id);
  const p=this.make(id,b.publisher,scope,b.id);p.nativeConnection=connectionID;p.pc.onnegotiationneeded=null;
  p.pc.onicecandidate=e=>{if(e.candidate)this.api.signal(scope,b.publisher,{type:'native-ice',broadcast:b.id,connectionID,candidate:e.candidate.toJSON()}).catch(e=>this.error(e));};return p;
 }
 async startNativeReceiver(b,connectionID,replayKit,w=this.watching.get(b.id)){
  if(this.closed||!w||this.watching.get(b.id)!==w)return false;
  const previous=this.nativeReceivers.get(b.id);if(previous?.connectionID===connectionID)return;
  const epoch=w.receiverEpoch=(w.receiverEpoch??0)+1,current=()=>!this.closed&&this.watching.get(b.id)===w&&w.receiverEpoch===epoch;
  if(previous){this.nativeReceivers.delete(b.id);await this.bridge.call('mediaReceiveStop',{id:b.id,connectionID:previous.connectionID});}
  if(!current())return false;
  const n={connectionID,stats:null,started:Date.now()};this.nativeReceivers.set(b.id,n);
  try{await this.bridge.call('mediaReceiveStart',{id:b.id,viewerID:this.uid,connectionID,replayKit,iceServers:this.ice});if(current()&&this.nativeReceivers.get(b.id)===n){this.emit('track',{id:b.id,native:true,stream:null});return true;}await this.bridge.call('mediaReceiveStop',{id:b.id,connectionID}).catch(()=>{});return false;}
  catch(e){if(this.nativeReceivers.get(b.id)===n){this.nativeReceivers.delete(b.id);this.bridge.call('mediaReceiveStop',{id:b.id,connectionID}).catch(()=>{});}if(current())throw e;return false;}
 }
 async viewerOffer(b,recover=false){
  const w=this.watching.get(b.id);if(!w)return;w.lastJoin=Date.now();
  const scope={kind:b.scope_kind,id:b.scope_id},id='media:'+b.id+':'+this.uid;
  const platform=await this.platform();if(this.closed||this.watching.get(b.id)!==w)return;
  if(platform.nativeReceive){if(this.nativeReceivers.has(b.id)&&!recover)return;await this.startNativeReceiver(b,uuid(),true,w);return;}
  const existing=this.peers.get(id);
  if(existing&&!recover){if(existing.pc.localDescription)await this.api.signal(scope,b.publisher,{type:'native-receive-offer',broadcast:b.id,connectionID:existing.nativeConnection,sdp:existing.pc.localDescription.sdp});return;}
  const connectionID=uuid(),p=await this.receiverPeer(b,connectionID);
  selectCodecs(p.pc.addTransceiver('video',{direction:'recvonly'}),'h264');selectAudioCodecs(p.pc.addTransceiver('audio',{direction:'recvonly'}));
  const offer=await p.pc.createOffer();await p.pc.setLocalDescription({type:'offer',sdp:tuneScreenOfferSDP(offer.sdp)});
  await this.api.signal(scope,b.publisher,{type:'native-receive-offer',broadcast:b.id,connectionID,sdp:p.pc.localDescription.sdp});
 }
 unwatch(id){
  this.watchEpochs.set(id,(this.watchEpochs.get(id)??0)+1);const joining=this.joining.get(id);this.joining.delete(id);
  const w=this.watching.get(id);if(!w)return Promise.resolve();
  const connection=[...this.peers.values()].find(p=>p.broadcast===id&&!p.sending),connectionID=connection?.nativeConnection??this.nativeReceivers.get(id)?.connectionID,epoch=connection?.epoch;
  this.watching.delete(id);const native=this.nativeReceivers.delete(id);this.early.delete(connectionID);this.senderStats.delete(id);this.playbackStats.delete(id);
  for(const[k,p]of this.peers)if(p.broadcast===id&&!p.sending){p.close();this.peers.delete(k);this.meters.delete(k);}
  this.emit('removed',id);
  // Never leave a black video, native overlay or fullscreen waiting on HTTP.
  const pending=Promise.allSettled([...(joining?[joining]:[]),...(native?[this.bridge.call('mediaReceiveStop',{id,connectionID})]:[]),this.api.rpc('broadcast_unwatch',{id}),this.api.signal({kind:w.broadcast.scope_kind,id:w.broadcast.scope_id},w.broadcast.publisher,{type:'media-leave',broadcast:id,connectionID,epoch})]);
  this.cleanup??=new Map();this.cleanup.set(id,pending);const key=this.uid+':'+id;viewerOperations.set(key,pending);pending.finally(()=>{if(this.cleanup.get(id)===pending)this.cleanup.delete(id);if(viewerOperations.get(key)===pending)viewerOperations.delete(key);});
  return Promise.resolve();
 }
 failWatch(id,error){if(!this.watching.has(id))return;this.unwatch(id);this.emit('view-failed',{id,error});}
 async refreshAuth(){const b=this.broadcast;if(b?.publisher&&b.publisher!==this.uid){await this.stop();return;}if(!b||b.transport!=='replaykit')return;await this.bridge.call('broadcastRefresh',{...b,url:this.api.config.url,key:this.api.config.key,accessToken:this.api.session.access_token,refreshToken:this.api.session.refresh_token,expiresAt:this.api.session.expires_at,uid:this.uid,iceServers:this.ice});}
 async adjust(remote,quality,connectionID){const b=this.broadcast;if(!b)return;const q={...b.quality,mbps:Math.max(Math.min(8,b.quality.mbps),Math.min(b.quality.mbps,Number(quality?.mbps)||b.quality.mbps))};if(b.transport==='native'){if(this.nativePeers.get(remote)!==connectionID)return;await this.bridge.call('mediaQuality',{id:b.id,viewerID:remote,connectionID,quality:q});}else if(b.transport==='browser'){const p=this.peers.get('media:'+b.id+':'+remote);if(!p)return;for(const sender of p.pc.getSenders()){if(sender.track?.kind!=='video')continue;const par=sender.getParameters();if(!par.encodings?.length)continue;par.encodings[0].maxBitrate=q.mbps*1e6;par.encodings[0].maxFramerate=q.fps;par.encodings[0].scaleResolutionDownBy=1;await sender.setParameters(par);}}}
 async update(snapshot){this.lastServerContact=Date.now();this.snapshot=snapshot;if(this.native&&!this.starting&&!this.broadcast&&snapshot.broadcasts.some(b=>b.publisher===this.uid)&&(await this.platform()).canPublish!==false){const status=await this.bridge.call('mediaStatus');const own=snapshot.broadcasts.find(b=>b.id===status.id&&b.publisher===this.uid);if(status.active&&own&&!this.starting&&!this.broadcast&&this.api.session?.user?.id===this.uid){this.broadcast={id:own.id,publisher:own.publisher,transport:own.transport,scope:{kind:own.scope_kind,id:own.scope_id},quality:own.quality,nativeSignaling:status.nativeSignaling===true,started:Date.now(),seen:true,pending:false};for(const p of status.peers??[])this.nativePeers.set(p.viewerID,p.connectionID);this.emit('broadcast',this.broadcast);}}if(this.broadcast){if(snapshot.broadcasts.some(b=>b.id===this.broadcast.id)){this.broadcast.seen=true;this.broadcast.missing=0;}else if(this.broadcast.seen){this.broadcast.missing=(this.broadcast.missing??0)+1;if(this.broadcast.missing>=3)await this.stop();}}for(const[id]of this.watching)if(!snapshot.broadcasts.some(b=>b.id===id))await this.unwatch(id);for(const[k,p]of this.peers)if(p.sending&&(!this.broadcast||!viewerAllowed(p.remote,this.broadcast,snapshot))){p.close();this.peers.delete(k);}for(const[remote,cid]of this.nativePeers){if(this.broadcast&&!viewerAllowed(remote,this.broadcast,snapshot)){await this.bridge.call('mediaLeave',{id:this.broadcast.id,viewerID:remote,connectionID:cid});this.nativePeers.delete(remote);}}this.publisherDisconnected();}
 make(id,remote,scope,broadcast,sending=false){let p=this.peers.get(id);if(p)return p;p=new Peer({id,remote,scope,api:this.api,iceServers:this.ice,polite:this.uid>remote});p.broadcast=broadcast;p.sending=sending;p.transformOffer=sending?tuneDesktopSDP:null;p.senderMeter=sending?new SenderMeter():null;p.addEventListener('track',e=>{const track=e.detail.track;try{if(e.detail.receiver&&'jitterBufferTarget'in e.detail.receiver)e.detail.receiver.jitterBufferTarget=this.watching.get(broadcast)?.broadcast.transport==='replaykit'?750:500;}catch{}p.remoteStream??=e.detail.streams?.[0]??new MediaStream();if(!p.remoteStream.getTracks().some(t=>t.id===track.id))p.remoteStream.addTrack(track);this.emit('track',{id:broadcast,stream:p.remoteStream,track});});p.addEventListener('error',e=>this.error(e.detail));p.addEventListener('state',e=>this.peerState(p,e.detail));this.peers.set(id,p);this.meters.set(id,new QualityMeter());return p;}
 async handle(s){if(this.closed)return;const v=s.payload,remote=s.sender,scope={kind:s.scope_kind,id:s.scope_kind==='friend'?remote:s.scope_id};
  if(v.type==='media-sender-stats'){const w=this.watching.get(v.broadcast),p=[...this.peers.values()].find(p=>p.broadcast===v.broadcast&&!p.sending),cid=this.nativeReceivers.get(v.broadcast)?.connectionID??p?.nativeConnection??p?.remoteEpoch;
   if(w?.broadcast.publisher===remote&&cid&&v.connectionID===cid)this.senderStats.set(v.broadcast,{at:Date.now(),stats:safeMediaStats(v.stats)});return;}
  if(v.type==='media-heartbeat'&&this.broadcast?.id===v.broadcast){const p=this.peers.get('media:'+v.broadcast+':'+remote),cid=this.nativePeers.get(remote)??p?.epoch;
   if(cid&&v.connectionID===cid){this.receiverReadings??=new Map();this.receiverReadings.set(remote,{at:Date.now(),stats:safeMediaStats(v.stats??{fps:v.fps,frames:v.framesDecoded})});}}
  if(this.broadcast?.nativeSignaling&&v.broadcast===this.broadcast.id&&['media-join','media-recover','media-leave','media-heartbeat','media-quality','native-answer','native-ice'].includes(v.type))return;if(v.type==='media-quality')return;if(v.type==='media-join'||v.type==='media-recover'){const b=this.broadcast;if(!b||b.id!==v.broadcast)return;if(b.transport==='replaykit')return;if(b.transport==='native'){await this.bridge.call(v.type==='media-recover'?'mediaRecover':'mediaJoin',{id:b.id,viewerID:remote,connectionID:v.connectionID});return;}const id='media:'+b.id+':'+remote;if(v.type==='media-recover'){const existing=this.peers.get(id);if(existing&&existing.epoch!==v.epoch)return;existing?.close();this.peers.delete(id);}const p=this.make(id,remote,b.scope,b.id,true);if(p.pc.getSenders().length===0)for(const t of this.stream.getTracks()){const sender=p.pc.addTrack(t,this.stream);if(t.kind==='video')await applySenderPolicy(sender);}return;}
  if(v.type==='media-leave'){if(this.broadcast?.id!==v.broadcast)return;if(this.broadcast.transport==='native'){if(v.connectionID!==this.nativePeers.get(remote))return;await this.bridge.call('mediaLeave',{id:v.broadcast,viewerID:remote,connectionID:v.connectionID});this.nativePeers.delete(remote);}const id='media:'+v.broadcast+':'+remote;const existing=this.peers.get(id);if(existing&&existing.remoteEpoch!==v.epoch)return;existing?.close();this.peers.delete(id);return;}
  if(v.type==='media-heartbeat'&&this.broadcast?.id===v.broadcast&&this.broadcast.transport==='native'){await this.bridge.call('mediaHeartbeat',{id:v.broadcast,viewerID:remote,connectionID:v.connectionID,fps:v.fps,framesDecoded:v.framesDecoded});return;}
  if(v.type==='native-offer'){
   const w=this.watching.get(v.broadcast);if(!w||w.broadcast.publisher!==remote||w.broadcast.transport==='replaykit')return;
   const platform=await this.platform();if(this.closed||this.watching.get(v.broadcast)!==w)return;
   if(platform.nativeReceive){await this.startNativeReceiver(w.broadcast,v.connectionID,false,w);if(this.watching.get(v.broadcast)!==w||this.nativeReceivers.get(v.broadcast)?.connectionID!==v.connectionID)return;await this.bridge.call('mediaReceiveSignal',{id:v.broadcast,payload:v});for(const candidate of this.early.get(v.connectionID)??[])await this.bridge.call('mediaReceiveSignal',{id:v.broadcast,payload:{type:'native-ice',connectionID:v.connectionID,candidate}});this.early.delete(v.connectionID);return;}
   const id='media:'+v.broadcast+':'+this.uid;let p=this.peers.get(id);
   if(p?.nativeConnection===v.connectionID){if(p.pc.localDescription)await this.api.signal(scope,remote,{type:'native-answer',broadcast:v.broadcast,connectionID:v.connectionID,sdp:p.pc.localDescription.sdp});return;}
   p=await this.receiverPeer(w.broadcast,v.connectionID);await p.pc.setRemoteDescription({type:'offer',sdp:v.sdp});preferScreenCodec(p.pc);
   for(const c of this.early.get(v.connectionID)??[])await p.pc.addIceCandidate(c).catch(e=>this.error(e));this.early.delete(v.connectionID);
   await p.pc.setLocalDescription(await p.pc.createAnswer());await this.api.signal(scope,remote,{type:'native-answer',broadcast:v.broadcast,connectionID:v.connectionID,sdp:p.pc.localDescription.sdp});return;
  }
  if(v.type==='native-receive-answer'){
   const w=this.watching.get(v.broadcast);if(!w||w.broadcast.publisher!==remote||w.broadcast.transport!=='replaykit')return;
   const n=this.nativeReceivers.get(v.broadcast);if(n?.connectionID===v.connectionID){await this.bridge.call('mediaReceiveSignal',{id:v.broadcast,payload:v});return;}
   const p=this.peers.get('media:'+v.broadcast+':'+this.uid);if(!p||p.nativeConnection!==v.connectionID||p.pc.remoteDescription)return;
   await p.pc.setRemoteDescription({type:'answer',sdp:v.sdp});for(const c of this.early.get(v.connectionID)??[])await p.pc.addIceCandidate(c).catch(e=>this.error(e));this.early.delete(v.connectionID);return;
  }
  if(v.type==='native-answer'||v.type==='native-ice'){if(this.broadcast?.id===v.broadcast&&this.broadcast.transport==='native'){await this.bridge.call(v.type==='native-answer'?'mediaAnswer':'mediaIce',{id:v.broadcast,viewerID:remote,connectionID:v.connectionID,sdp:v.sdp,...v.candidate});return;}const w=this.watching.get(v.broadcast);if(!w||w.broadcast.publisher!==remote||v.type!=='native-ice')return;const n=this.nativeReceivers.get(v.broadcast);if(n?.connectionID===v.connectionID){await this.bridge.call('mediaReceiveSignal',{id:v.broadcast,payload:v});return;}const p=this.peers.get('media:'+v.broadcast+':'+this.uid);if(p?.nativeConnection===v.connectionID&&p.pc.remoteDescription)await p.pc.addIceCandidate(v.candidate).catch(e=>this.error(e));else{if(this.early.size>=16&&!this.early.has(v.connectionID))this.early.delete(this.early.keys().next().value);const q=this.early.get(v.connectionID)??[];if(q.length<128)q.push(v.candidate);this.early.set(v.connectionID,q);}return;}
  if(v.type==='rtc'&&v.peer.startsWith('media:')){const parts=v.peer.split(':'),bid=parts[1],viewer=parts[2];const w=this.watching.get(bid);if(w?.broadcast.publisher===remote&&viewer===this.uid){await this.make(v.peer,remote,scope,bid).receive(v);}else if(this.broadcast?.id===bid&&viewer===remote&&this.broadcast.transport==='browser'){const p=this.peers.get(v.peer);if(p)await p.receive(v);}return;}
 }
 async nativeEvent(m){try{
  if(m.type==='media-receiver-signal'||m.type==='media-receiver-stats'){
   const w=this.watching.get(m.id),n=this.nativeReceivers.get(m.id);if(!w||!n||n.connectionID!==m.connectionID)return;
   if(m.type==='media-receiver-stats'){n.stats=m.stats;if(m.stats?.state==='disconnected')n.disconnectedAt??=Date.now();else n.disconnectedAt=null;this.emit('state',{id:m.id,state:m.stats?.state});this.emit('diagnostics',redact(m));if(m.stats?.state==='closed')this.failWatch(m.id,new Error('화면공유 연결이 종료되었습니다.'));else if(m.stats?.state==='failed')this.recoverWatch(m.id);return;}
   const payload=m.payload??{};const type=m.kind==='viewer-offer'?'native-receive-offer':m.kind==='ice'?'native-ice':'native-answer';
   if(m.kind==='answer'&&!payload.sdp)return;
   await this.api.signal({kind:w.broadcast.scope_kind,id:w.broadcast.scope_id},w.broadcast.publisher,{type,broadcast:m.id,connectionID:m.connectionID,...(m.kind==='ice'?{candidate:payload}:{sdp:payload.sdp})});return;
  }
  const b=this.broadcast;if(!b)return;
  if(m.type==='rtp-signal'&&m.session===b.id&&Number.isFinite(m.generation)){this.nativeGenerations??=new Map();if(m.generation<(this.nativeGenerations.get(m.viewerID)??-1))return;this.nativeGenerations.set(m.viewerID,m.generation);}
  if(m.type==='rtp-peer'&&m.session===b.id&&this.nativePeers.get(m.viewerID)===m.connectionID){const key='native:'+m.viewerID;this.nativePeerStates.set(m.viewerID,{connectionID:m.connectionID,state:m.state});
   if(m.state==='connected'){b.hadConnection=true;clearTimeout(this.disconnectTimers.get(key));this.disconnectTimers.delete(key);this.publisherDisconnected();}
   else if(['failed','closed','disconnected'].includes(m.state)){const leave=()=>{if(this.broadcast!==b||this.nativePeers.get(m.viewerID)!==m.connectionID)return;this.disconnectTimers.delete(key);if(this.nativePeerStates.get(m.viewerID)?.state==='connected')return;this.nativePeers.delete(m.viewerID);this.nativePeerStates.delete(m.viewerID);this.bridge.call('mediaLeave',{id:b.id,viewerID:m.viewerID,connectionID:m.connectionID}).catch(()=>{});this.publisherDisconnected();};if(m.state==='disconnected'){if(!this.disconnectTimers.has(key)){const ticket=setTimeout(leave,CONNECTION_LIMITS.peerGrace);ticket.unref?.();this.disconnectTimers.set(key,ticket);}}else{clearTimeout(this.disconnectTimers.get(key));leave();}}}
  if(m.type==='rtp-metrics'&&m.session===b.id)this.nativeSenderStats={at:Date.now(),stats:safeMediaStats({state:'connected',fps:m.nativeEncodedFPS,frames:m.nativeEncodedFrames,width:m.width,height:m.height,encoder:m.encoderImplementation,qualityMeasured:Number.isFinite(m.nativeEncodedFPS)}),viewers:m.viewers??[]};
  if(m.type==='rtp-signal'&&m.session===b.id){this.setNativePeer(m.viewerID,m.connectionID);const v=m.kind==='offer'?{type:'native-offer',broadcast:b.id,connectionID:m.connectionID,sdp:m.payload.sdp}:{type:'native-ice',broadcast:b.id,connectionID:m.connectionID,candidate:m.payload};await this.api.signal(b.scope,m.viewerID,v);}if(m.type==='media-signal'&&m.id===b.id){this.setNativePeer(m.viewerID,m.payload.connectionID);if(!b.nativeSignaling)await this.api.signal(b.scope,m.viewerID,m.payload);}if(m.type==='rtp-metrics'&&m.session===b.id||m.type==='media-metrics'&&m.id===b.id)this.emit('diagnostics',redact(m));if(m.type==='media-peer-error'&&m.id===b.id)this.error(new Error(m.error??'화면공유 연결 오류'));if(m.type==='media-ended'&&m.id===b.id||m.type==='rtp-status'&&m.session===b.id&&m.state==='error'){if(m.error)this.error(new Error(m.error));if(this.broadcast===b)await this.stop();}}catch(e){this.error(e);}}
 setNativePeer(viewerID,connectionID){if(this.nativePeers.get(viewerID)!==connectionID){const key='native:'+viewerID;clearTimeout(this.disconnectTimers.get(key));this.disconnectTimers.delete(key);this.nativePeerStates.delete(viewerID);}this.nativePeers.set(viewerID,connectionID);}
 async tick(){if(this.closed||this.ticking)return;this.ticking=true;try{await this.tickOnce();}finally{this.ticking=false;}}
 async tickOnce(){
  const b=this.broadcast;
  if(b?.transport==='replaykit'){const status=await this.bridge.call('mediaStatus');if(status.active&&status.id===b.id){if(b.pending){b.pending=false;this.emit('broadcast',b);}}else if(this.broadcast===b&&(!b.pending||Date.now()-b.started>45000)){
   const reason=status.id===b.id?status.stopReason:null;this.emit('diagnostics',{event:'native-broadcast-ended',reason:reason??'capture-not-confirmed',diagnosticAgeSeconds:status.diagnosticAgeSeconds});await this.stop();
   const messages={'broadcast-heartbeat-timeout':'서버의 송출 유지 신호가 45초 동안 확인되지 않아 공유를 종료했습니다.','signaling-timeout':'시청자 연결 정보를 받지 못해 공유를 종료했습니다.','broadcast-ended':'서버에서 방송이 종료되었거나 다른 기기에서 새 방송을 시작했습니다.','extension-status-timeout':'iPad 방송 확장의 상태 신호가 중단되었습니다. 연결 상태에서 진단 기록을 확인하세요.'};if(messages[reason])this.error(new Error(messages[reason]));
  }}
  // Start the independent lease renewal before collecting possibly slow stats.
  if(b)this.controlTick().catch(e=>this.error(e));
  if(b&&this.broadcast===b)await this.samplePublisher(b);
  for(const[id,w]of this.watching){
   if(this.closed||this.watching.get(id)!==w)continue;
   if(!w.frames&&Date.now()-w.lastFrame>CONNECTION_LIMITS.firstFrameTimeout)this.recoverWatch(id);
   if(w.recoveryStarted!=null&&Date.now()-w.recoveryStarted>=CONNECTION_LIMITS.recoveryTimeout){this.failWatch(id,new Error('영상 연결을 복구하지 못해 시청을 종료했습니다.'));continue;}
   const n=this.nativeReceivers.get(id);if(n){await this.tickNative(id,w,n);continue;}
   const p=[...this.peers.values()].find(p=>p.broadcast===id&&!p.sending);
   if(!p){if(w.recoveryStarted!=null)this.recoverWatch(id);else if(Date.now()-w.lastJoin>5000)await this.join(w.broadcast);continue;}
   try{const stats=this.meters.get(p.id).measure(await p.pc.getStats(),p.pc.connectionState);if(this.watching.get(id)!==w)continue;
    if(stats.frames>w.frames){w.lastFrame=Date.now();w.retries=0;w.recoveryStarted=null;}else if(stats.frames>0&&stats.state==='connected'&&!stats.stalled){w.retries=0;w.recoveryStarted=null;}w.frames=stats.frames;
    w.controlStats=stats;w.controlStatsAt=Date.now();this.quality(id,stats);this.sendHeartbeat(id,w,p.nativeConnection??p.remoteEpoch,stats);
    if(stats.stalled&&Date.now()-w.lastFrame>CONNECTION_LIMITS.firstFrameTimeout)this.recoverWatch(id);
    if(['failed','disconnected','closed'].includes(p.pc.connectionState))this.peerState(p,p.pc.connectionState);
   }catch(e){this.error(e);}
  }
 }
 sendHeartbeat(id,w,connectionID,stats){if(!connectionID||Date.now()-(w.lastHeartbeat??0)<5000)return;w.lastHeartbeat=Date.now();
  // A viewer can leave while this optional measurement is in flight. Failure
  // must not replace the video with an error; the control watchdog checks loss.
  this.api.signal({kind:w.broadcast.scope_kind,id:w.broadcast.scope_id},w.broadcast.publisher,{type:'media-heartbeat',broadcast:id,connectionID,fps:stats.fps,framesDecoded:stats.frames,stats:safeMediaStats({...stats,...this.playbackStats.get(id)})}).then(()=>{if(this.watching.get(id)===w)this.lastServerContact=Date.now();}).catch(()=>{});
 }
 async samplePublisher(b){
  for(const p of this.peers.values())if(p.sending&&p.broadcast===b.id){try{const stats=p.senderMeter.measure(await p.pc.getStats(),p.pc.connectionState);if(this.broadcast!==b||p.closed)continue;
    const received=this.receiverReadings?.get(p.remote),receiver=received&&Date.now()-received.at<15000?received.stats:null;
    this.emit('sender-quality',{id:b.id,viewerID:p.remote,stats:{...stats,sender:stats,receiver,disposition:diagnoseQuality(receiver,stats)}});
    this.api.signal(b.scope,p.remote,{type:'media-sender-stats',broadcast:b.id,connectionID:p.epoch,stats}).catch(()=>{});
   }catch(e){this.error(e);}}
  const source=this.nativeSenderStats;if(!source||Date.now()-source.at>5000||this.broadcast!==b)return;
  for(const[remote,connectionID]of this.nativePeers){const row=source.viewers.find(v=>v.viewerID===remote&&v.connectionID===connectionID),stats=safeMediaStats({...source.stats,queueMilliseconds:row?.queueOldestMilliseconds,loss:row?.receiverLossPercent});
   const received=this.receiverReadings?.get(remote),receiver=received&&Date.now()-received.at<15000?received.stats:null;
   this.emit('sender-quality',{id:b.id,viewerID:remote,stats:{...stats,sender:stats,receiver,disposition:diagnoseQuality(receiver,stats)}});
   this.api.signal(b.scope,remote,{type:'media-sender-stats',broadcast:b.id,connectionID,stats}).catch(()=>{});}
 }
 async tickNative(id,w,n){
  const stats=n.stats??{active:true,state:'connecting',frames:0,fps:0};
  if(stats.frames>w.frames){w.lastFrame=Date.now();w.retries=0;w.recoveryStarted=null;}else if(stats.frames>0&&stats.state==='connected'&&!stats.stalled){w.retries=0;w.recoveryStarted=null;}w.frames=stats.frames;
  w.controlStats=stats;w.controlStatsAt=Date.now();this.quality(id,stats);this.sendHeartbeat(id,w,n.connectionID,stats);
  if(stats.state==='closed')this.failWatch(id,new Error('화면공유 연결이 종료되었습니다.'));
  else if(stats.state==='failed'||stats.state==='disconnected'&&n.disconnectedAt&&Date.now()-n.disconnectedAt>=CONNECTION_LIMITS.peerGrace)this.recoverWatch(id);
 }
 close(){this.startEpoch=(this.startEpoch??0)+1;this.closed=true;clearInterval(this.timer);clearInterval(this.controlTimer);clearInterval(this.guard);for(const ticket of this.disconnectTimers.values())clearTimeout(ticket);this.disconnectTimers.clear();globalThis.removeEventListener?.('offline',this.offline);for(const id of [...this.watching.keys()])this.unwatch(id);this.stopCurrent().catch(()=>{});for(const[id]of this.nativeReceivers)this.bridge.call('mediaReceiveStop',{id}).catch(()=>{});this.nativeReceivers.clear();this.bridge.removeEventListener('event',this.nativeListener);for(const p of this.peers.values())p.close();this.peers.clear();}
}
