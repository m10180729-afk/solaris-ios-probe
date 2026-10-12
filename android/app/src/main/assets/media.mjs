import{applySenderPolicy,tuneDesktopSDP,tuneScreenOfferSDP,selectCodecs,selectAudioCodecs}from'./build54-screen.mjs';
import{uuid,sleep,redact}from'./platform.mjs';
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
 constructor(api,bridge,settings){super();this.api=api;this.ownerUID=api.session.user.id;this.joining=new Map();this.bridge=bridge;this.settings=settings;this.peers=new Map();this.nativePeers=new Map();this.nativeReceivers=new Map();this.meters=new Map();this.watching=new Map();this.early=new Map();this.stream=null;this.broadcast=null;this.snapshot={broadcasts:[]};this.native=bridge.native;this.reconnects=0;this.nativeListener=e=>this.nativeEvent(e.detail);bridge.addEventListener('event',this.nativeListener);this.timer=setInterval(()=>this.tick().catch(e=>this.error(e)),2500);}
 async platform(){return this.platformInfo??=(this.native?await this.bridge.call('platform'):{platform:'browser'});}
 get uid(){return this.ownerUID;}
 get ice(){return this.settings.iceServers??[{urls:['stun:stun.l.google.com:19302','stun:global.stun.twilio.com:3478']}];}
 error(e){this.dispatchEvent(new CustomEvent('error',{detail:e}));}
 emit(type,detail){this.dispatchEvent(new CustomEvent(type,{detail}));}
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
   if(this.native){const p=await this.platform();platform=p.platform;nativeSignaling=p.nativeSignaling===true;}
   this.checkStart(epoch);const q=nativeQuality(platform),transport=platform==='ios'?'replaykit':['windows','android'].includes(platform)?'native':'browser';
   if(transport==='browser'){
    stream=await navigator.mediaDevices.getDisplayMedia({video:{width:{ideal:q.width},height:{ideal:q.height},frameRate:{ideal:q.fps,max:q.fps}},audio:false});
    this.checkStart(epoch);this.stream=stream;stream.getVideoTracks()[0].onended=()=>this.stop().catch(e=>this.error(e));
   }
   created=await this.api.rpc('broadcast_start',{scope_kind:scope.kind,scope_id:scope.id,transport,quality:q,attempt_id:uuid()});
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
  this.nativePeers.clear();this.emit('broadcast',null);
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
  const key=this.uid+':'+b.id,prior=viewerOperations.get(key);
  const task=(async()=>{
   if(prior)await prior.catch(()=>{});if(this.closed)return;
   await this.api.rpc('broadcast_watch',{id:b.id});
   if(this.closed){if(this.api.session?.user?.id===this.uid)await this.api.rpc('broadcast_unwatch',{id:b.id}).catch(()=>{});return;}
   this.watching.set(b.id,{broadcast:b,lastJoin:0,lastFrame:Date.now(),started:Date.now(),retries:0,frames:0});
   try{await this.join(b);}catch(e){this.unwatch(b.id);throw e;}
  })();
  this.joining.set(b.id,task);viewerOperations.set(key,task);
  const finish=()=>{this.joining.delete(b.id);if(viewerOperations.get(key)===task)viewerOperations.delete(key);};task.then(finish,finish);return task;
 }
 async join(b,recover){if(recover)this.emit('state',{id:b.id,state:'reconnecting'});if(b.transport==='replaykit')return this.viewerOffer(b,!!recover);const w=this.watching.get(b.id);if(!w)return;w.lastJoin=Date.now();await this.api.signal({kind:b.scope_kind,id:b.scope_id},b.publisher,{type:recover?'media-recover':'media-join',broadcast:b.id,...(recover??{})});}
 async receiverPeer(b,connectionID){
  const id='media:'+b.id+':'+this.uid,scope={kind:b.scope_kind,id:b.scope_id};
  this.peers.get(id)?.close();this.peers.delete(id);
  const p=this.make(id,b.publisher,scope,b.id);p.nativeConnection=connectionID;p.pc.onnegotiationneeded=null;
  p.pc.onicecandidate=e=>{if(e.candidate)this.api.signal(scope,b.publisher,{type:'native-ice',broadcast:b.id,connectionID,candidate:e.candidate.toJSON()}).catch(e=>this.error(e));};return p;
 }
 async startNativeReceiver(b,connectionID,replayKit){
  const previous=this.nativeReceivers.get(b.id);if(previous?.connectionID===connectionID)return;
  if(previous)await this.bridge.call('mediaReceiveStop',{id:b.id});
  const n={connectionID,stats:null,started:Date.now()};this.nativeReceivers.set(b.id,n);
  try{await this.bridge.call('mediaReceiveStart',{id:b.id,viewerID:this.uid,connectionID,replayKit,iceServers:this.ice});if(!this.closed&&this.watching.has(b.id)&&this.nativeReceivers.get(b.id)===n)this.emit('track',{id:b.id,native:true,stream:null});}
  catch(e){if(this.nativeReceivers.get(b.id)===n){this.nativeReceivers.delete(b.id);this.bridge.call('mediaReceiveStop',{id:b.id,connectionID}).catch(()=>{});}throw e;}
 }
 async viewerOffer(b,recover=false){
  const w=this.watching.get(b.id);if(!w)return;w.lastJoin=Date.now();
  const scope={kind:b.scope_kind,id:b.scope_id},id='media:'+b.id+':'+this.uid;
  if((await this.platform()).nativeReceive){if(this.nativeReceivers.has(b.id)&&!recover)return;await this.startNativeReceiver(b,uuid(),true);return;}
  const existing=this.peers.get(id);
  if(existing&&!recover){if(existing.pc.localDescription)await this.api.signal(scope,b.publisher,{type:'native-receive-offer',broadcast:b.id,connectionID:existing.nativeConnection,sdp:existing.pc.localDescription.sdp});return;}
  const connectionID=uuid(),p=await this.receiverPeer(b,connectionID);
  selectCodecs(p.pc.addTransceiver('video',{direction:'recvonly'}),'h264');selectAudioCodecs(p.pc.addTransceiver('audio',{direction:'recvonly'}));
  const offer=await p.pc.createOffer();await p.pc.setLocalDescription({type:'offer',sdp:tuneScreenOfferSDP(offer.sdp)});
  await this.api.signal(scope,b.publisher,{type:'native-receive-offer',broadcast:b.id,connectionID,sdp:p.pc.localDescription.sdp});
 }
 unwatch(id){
  const w=this.watching.get(id);if(!w)return Promise.resolve();
  const connection=[...this.peers.values()].find(p=>p.broadcast===id&&!p.sending),connectionID=connection?.nativeConnection??this.nativeReceivers.get(id)?.connectionID,epoch=connection?.epoch;
  this.watching.delete(id);const native=this.nativeReceivers.delete(id);this.early.delete(connectionID);
  for(const[k,p]of this.peers)if(p.broadcast===id&&!p.sending){p.close();this.peers.delete(k);this.meters.delete(k);}
  this.emit('removed',id);
  // Never leave a black video, native overlay or fullscreen waiting on HTTP.
  const pending=Promise.allSettled([...(native?[this.bridge.call('mediaReceiveStop',{id,connectionID})]:[]),this.api.rpc('broadcast_unwatch',{id}),this.api.signal({kind:w.broadcast.scope_kind,id:w.broadcast.scope_id},w.broadcast.publisher,{type:'media-leave',broadcast:id,connectionID,epoch})]);
  this.cleanup??=new Map();this.cleanup.set(id,pending);const key=this.uid+':'+id;viewerOperations.set(key,pending);pending.finally(()=>{if(this.cleanup.get(id)===pending)this.cleanup.delete(id);if(viewerOperations.get(key)===pending)viewerOperations.delete(key);});
  return Promise.resolve();
 }
 failWatch(id,error){if(!this.watching.has(id))return;this.unwatch(id);this.emit('view-failed',{id,error});}
 async refreshAuth(){const b=this.broadcast;if(b?.publisher&&b.publisher!==this.uid){await this.stop();return;}if(!b||b.transport!=='replaykit')return;await this.bridge.call('broadcastRefresh',{...b,url:this.api.config.url,key:this.api.config.key,accessToken:this.api.session.access_token,refreshToken:this.api.session.refresh_token,expiresAt:this.api.session.expires_at,uid:this.uid,iceServers:this.ice});}
 async adjust(remote,quality,connectionID){const b=this.broadcast;if(!b)return;const q={...b.quality,mbps:Math.max(Math.min(8,b.quality.mbps),Math.min(b.quality.mbps,Number(quality?.mbps)||b.quality.mbps))};if(b.transport==='native'){if(this.nativePeers.get(remote)!==connectionID)return;await this.bridge.call('mediaQuality',{id:b.id,viewerID:remote,connectionID,quality:q});}else if(b.transport==='browser'){const p=this.peers.get('media:'+b.id+':'+remote);if(!p)return;for(const sender of p.pc.getSenders()){if(sender.track?.kind!=='video')continue;const par=sender.getParameters();if(!par.encodings?.length)continue;par.encodings[0].maxBitrate=q.mbps*1e6;par.encodings[0].maxFramerate=q.fps;par.encodings[0].scaleResolutionDownBy=1;await sender.setParameters(par);}}}
 async update(snapshot){this.snapshot=snapshot;if(this.native&&!this.starting&&!this.broadcast&&snapshot.broadcasts.some(b=>b.publisher===this.uid)){const status=await this.bridge.call('mediaStatus');const own=snapshot.broadcasts.find(b=>b.id===status.id&&b.publisher===this.uid);if(status.active&&own&&!this.starting&&!this.broadcast&&this.api.session?.user?.id===this.uid){this.broadcast={id:own.id,publisher:own.publisher,transport:own.transport,scope:{kind:own.scope_kind,id:own.scope_id},quality:own.quality,nativeSignaling:status.nativeSignaling===true,started:Date.now(),seen:true,pending:false};for(const p of status.peers??[])this.nativePeers.set(p.viewerID,p.connectionID);this.emit('broadcast',this.broadcast);}}if(this.broadcast){if(snapshot.broadcasts.some(b=>b.id===this.broadcast.id)){this.broadcast.seen=true;this.broadcast.missing=0;}else if(this.broadcast.seen){this.broadcast.missing=(this.broadcast.missing??0)+1;if(this.broadcast.missing>=3)await this.stop();}}for(const[id]of this.watching)if(!snapshot.broadcasts.some(b=>b.id===id))await this.unwatch(id);for(const[k,p]of this.peers)if(p.sending&&(!this.broadcast||!viewerAllowed(p.remote,this.broadcast,snapshot))){p.close();this.peers.delete(k);}for(const[remote,cid]of this.nativePeers){if(this.broadcast&&!viewerAllowed(remote,this.broadcast,snapshot)){await this.bridge.call('mediaLeave',{id:this.broadcast.id,viewerID:remote,connectionID:cid});this.nativePeers.delete(remote);}}}
 make(id,remote,scope,broadcast,sending=false){let p=this.peers.get(id);if(p)return p;p=new Peer({id,remote,scope,api:this.api,iceServers:this.ice,polite:this.uid>remote});p.broadcast=broadcast;p.sending=sending;p.transformOffer=sending?tuneDesktopSDP:null;p.addEventListener('track',e=>{const track=e.detail.track;try{if(e.detail.receiver&&'jitterBufferTarget'in e.detail.receiver)e.detail.receiver.jitterBufferTarget=this.watching.get(broadcast)?.broadcast.transport==='replaykit'?750:500;}catch{}p.remoteStream??=e.detail.streams?.[0]??new MediaStream();if(!p.remoteStream.getTracks().some(t=>t.id===track.id))p.remoteStream.addTrack(track);this.emit('track',{id:broadcast,stream:p.remoteStream,track});});p.addEventListener('error',e=>this.error(e.detail));p.addEventListener('state',e=>this.emit('state',{id:broadcast,state:e.detail}));this.peers.set(id,p);this.meters.set(id,new QualityMeter());return p;}
 async handle(s){const v=s.payload,remote=s.sender,scope={kind:s.scope_kind,id:s.scope_kind==='friend'?remote:s.scope_id};if(this.broadcast?.nativeSignaling&&v.broadcast===this.broadcast.id&&['media-join','media-recover','media-leave','media-heartbeat','media-quality','native-answer','native-ice'].includes(v.type))return;if(v.type==='media-quality')return;if(v.type==='media-join'||v.type==='media-recover'){const b=this.broadcast;if(!b||b.id!==v.broadcast)return;if(b.transport==='replaykit')return;if(b.transport==='native'){await this.bridge.call(v.type==='media-recover'?'mediaRecover':'mediaJoin',{id:b.id,viewerID:remote,connectionID:v.connectionID});return;}const id='media:'+b.id+':'+remote;if(v.type==='media-recover'){const existing=this.peers.get(id);if(existing&&existing.epoch!==v.epoch)return;existing?.close();this.peers.delete(id);}const p=this.make(id,remote,b.scope,b.id,true);if(p.pc.getSenders().length===0)for(const t of this.stream.getTracks()){const sender=p.pc.addTrack(t,this.stream);if(t.kind==='video')await applySenderPolicy(sender);}return;}
  if(v.type==='media-leave'){if(this.broadcast?.id!==v.broadcast)return;if(this.broadcast.transport==='native'){if(v.connectionID!==this.nativePeers.get(remote))return;await this.bridge.call('mediaLeave',{id:v.broadcast,viewerID:remote,connectionID:v.connectionID});this.nativePeers.delete(remote);}const id='media:'+v.broadcast+':'+remote;const existing=this.peers.get(id);if(existing&&existing.remoteEpoch!==v.epoch)return;existing?.close();this.peers.delete(id);return;}
  if(v.type==='media-heartbeat'&&this.broadcast?.id===v.broadcast&&this.broadcast.transport==='native'){await this.bridge.call('mediaHeartbeat',{id:v.broadcast,viewerID:remote,connectionID:v.connectionID,fps:v.fps,framesDecoded:v.framesDecoded});return;}
  if(v.type==='native-offer'){
   const w=this.watching.get(v.broadcast);if(!w||w.broadcast.publisher!==remote||w.broadcast.transport==='replaykit')return;
   if((await this.platform()).nativeReceive){await this.startNativeReceiver(w.broadcast,v.connectionID,false);await this.bridge.call('mediaReceiveSignal',{id:v.broadcast,payload:v});for(const candidate of this.early.get(v.connectionID)??[])await this.bridge.call('mediaReceiveSignal',{id:v.broadcast,payload:{type:'native-ice',connectionID:v.connectionID,candidate}});this.early.delete(v.connectionID);return;}
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
   if(m.type==='media-receiver-stats'){n.stats=m.stats;this.emit('state',{id:m.id,state:m.stats?.state});this.emit('diagnostics',redact(m));return;}
   const payload=m.payload??{};const type=m.kind==='viewer-offer'?'native-receive-offer':m.kind==='ice'?'native-ice':'native-answer';
   if(m.kind==='answer'&&!payload.sdp)return;
   await this.api.signal({kind:w.broadcast.scope_kind,id:w.broadcast.scope_id},w.broadcast.publisher,{type,broadcast:m.id,connectionID:m.connectionID,...(m.kind==='ice'?{candidate:payload}:{sdp:payload.sdp})});return;
  }
  const b=this.broadcast;if(!b)return;if(m.type==='rtp-signal'&&m.session===b.id){this.nativePeers.set(m.viewerID,m.connectionID);const v=m.kind==='offer'?{type:'native-offer',broadcast:b.id,connectionID:m.connectionID,sdp:m.payload.sdp}:{type:'native-ice',broadcast:b.id,connectionID:m.connectionID,candidate:m.payload};await this.api.signal(b.scope,m.viewerID,v);}if(m.type==='media-signal'&&m.id===b.id){this.nativePeers.set(m.viewerID,m.payload.connectionID);if(!b.nativeSignaling)await this.api.signal(b.scope,m.viewerID,m.payload);}if(m.type==='rtp-metrics'&&m.session===b.id||m.type==='media-metrics'&&m.id===b.id)this.emit('diagnostics',redact(m));if(m.type==='media-peer-error'&&m.id===b.id)this.error(new Error(m.error??'화면공유 연결 오류'));if(m.type==='media-ended'&&m.id===b.id||m.type==='rtp-status'&&m.session===b.id&&m.state==='error'){if(m.error)this.error(new Error(m.error));if(this.broadcast===b)await this.stop();}}catch(e){this.error(e);}}
 async tick(){if(this.closed||this.ticking)return;this.ticking=true;try{await this.tickOnce();}finally{this.ticking=false;}}
 async tickOnce(){const b=this.broadcast;if(b?.transport==='replaykit'){const status=await this.bridge.call('mediaStatus');if(status.active&&status.id===b.id){if(b.pending){b.pending=false;this.emit('broadcast',b);}}else if(this.broadcast===b&&(!b.pending||Date.now()-b.started>45000))await this.stop();}if(b&&b.transport!=='replaykit'&&!b.nativeSignaling){const alive=await this.api.rpc('broadcast_touch',{id:b.id});if(!alive&&this.broadcast===b)await this.stop();}for(const[id,w]of this.watching){if(this.closed||this.watching.get(id)!==w)continue;if(w.retries>=2&&Date.now()-w.lastFrame>20000){this.failWatch(id,new Error('영상 연결을 복구하지 못했습니다. 다시 시청해 주세요.'));continue;}const n=this.nativeReceivers.get(id);if(n){await this.tickNative(id,w,n);continue;}let p=[...this.peers.values()].find(p=>p.broadcast===id&&!p.sending);if(!p){if(Date.now()-w.lastJoin>5000){if(Date.now()-w.started>20000)w.retries++;await this.join(w.broadcast);}continue;}try{const stats=this.meters.get(p.id).measure(await p.pc.getStats(),p.pc.connectionState);if(stats.frames>w.frames){w.lastFrame=Date.now();w.retries=0;}w.frames=stats.frames;this.emit('quality',{id,stats,grade:qualityGrade(stats)});if(p.nativeConnection)await this.api.signal({kind:w.broadcast.scope_kind,id:w.broadcast.scope_id},w.broadcast.publisher,{type:'media-heartbeat',broadcast:id,connectionID:p.nativeConnection,fps:stats.fps,framesDecoded:stats.frames});if((p.pc.connectionState==='failed'||(p.pc.connectionState==='disconnected'||stats.stalled||stats.frames===0)&&Date.now()-w.lastFrame>20000)&&Date.now()-w.lastJoin>Math.min(30000,3000*2**w.retries)){p.close();this.peers.delete(p.id);this.reconnects++;w.retries++;w.lastFrame=Date.now();await this.join(w.broadcast,{connectionID:p.nativeConnection,epoch:p.remoteEpoch});}}catch(e){this.error(e);}}}
 async tickNative(id,w,n){
  const stats=n.stats??{active:true,state:'connecting',frames:0,fps:0};
  if(stats.frames>w.frames){w.lastFrame=Date.now();w.retries=0;}w.frames=stats.frames;
  this.emit('quality',{id,stats,grade:qualityGrade(stats)});
  await this.api.signal({kind:w.broadcast.scope_kind,id:w.broadcast.scope_id},w.broadcast.publisher,{type:'media-heartbeat',broadcast:id,connectionID:n.connectionID,fps:stats.fps,framesDecoded:stats.frames});
  if((stats.state==='failed'||(stats.state==='disconnected'||stats.stalled||stats.frames===0)&&Date.now()-w.lastFrame>20000)&&Date.now()-w.lastJoin>Math.min(30000,3000*2**w.retries)){
   this.emit('state',{id,state:'reconnecting'});this.nativeReceivers.delete(id);await this.bridge.call('mediaReceiveStop',{id,connectionID:n.connectionID}).catch(()=>{});if(this.watching.get(id)!==w)return;w.retries++;this.reconnects++;w.lastFrame=Date.now();await this.join(w.broadcast,{connectionID:n.connectionID});
  }
 }
 close(){this.startEpoch=(this.startEpoch??0)+1;this.closed=true;clearInterval(this.timer);for(const id of [...this.watching.keys()])this.unwatch(id);for(const t of this.stream?.getTracks()??[]){t.onended=null;t.stop();}this.stream=null;for(const[id]of this.nativeReceivers)this.bridge.call('mediaReceiveStop',{id}).catch(()=>{});this.nativeReceivers.clear();this.bridge.removeEventListener('event',this.nativeListener);for(const p of this.peers.values())p.close();this.peers.clear();this.broadcast=null;}
}
