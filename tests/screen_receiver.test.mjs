// Execute the shipped receiver script with controlled transport/peer doubles.
// These tests verify signaling/lifecycle logic, not an iPad or codec.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';

const html=readFileSync(new URL('../ios/App/Resources/solaris-p2p.html',import.meta.url),'utf8');
const source=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
function harness(options={}) {
  const elements=new Map(), requests=[], intervals=new Map(), storage=new Map();
  let serial=0, response=async()=>({ok:true,status:200,json:async()=>[]});
  const element=id=>{
    if(!elements.has(id)) elements.set(id,{textContent:'',value:'',className:'',disabled:false,
      srcObject:null,paused:true,readyState:0,videoWidth:0,videoHeight:0,
      play(){this.paused=false;return Promise.resolve();},pause(){this.paused=true;},select(){}});
    return elements.get(id);
  };
  class Peer {
    signalingState='stable';connectionState='new';iceConnectionState='new';
    remoteDescription=null; remoteCalls=0; candidates=[]; closed=false;
    report=new Map();
    addTransceiver(kind,options){this.transceiver={kind,...options,setCodecPreferences(list){this.codecs=list;}};return this.transceiver;}
    createDataChannel(){return {readyState:'open',sent:[],send(text){this.sent.push(JSON.parse(text));},close(){}};}
    async createOffer(){return {type:'offer',sdp:'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n'};}
    async setLocalDescription(d){this.localDescription={...d,toJSON:()=>d};this.signalingState='have-local-offer';}
    async setRemoteDescription(d){this.remoteCalls++;this.remoteDescription=d;this.signalingState='stable';}
    async addIceCandidate(c){assert.ok(this.remoteDescription,'ICE must wait for SDP');this.candidates.push(c);}
    async getStats(){return this.report;}
    close(){this.closed=true;}
  }
  const codecs=[{mimeType:'video/H264',sdpFmtpLine:'profile-level-id=42e01f;packetization-mode=1'},
    {mimeType:'video/rtx'},{mimeType:'video/VP8'},{mimeType:'video/VP9'},{mimeType:'video/red'},{mimeType:'video/ulpfec'}];
  const context=vm.createContext({console,URL,AbortController,crypto:webcrypto,RTCPeerConnection:Peer,
    RTCRtpReceiver:options.noCapabilities?undefined:{getCapabilities(){return {codecs};}},
    MediaStream:class {constructor(tracks){this.tracks=tracks;}},
    setTimeout,clearTimeout,setInterval:fn=>{intervals.set(++serial,fn);return serial;},
    clearInterval:id=>intervals.delete(id),
    document:{getElementById:element},window:{addEventListener(){}},navigator:{},
    localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    fetch:async(url,options)=>{requests.push({url:new URL(url),...options});return response(url,options);}
  });
  vm.runInContext(source+'\nglobalThis.probe={start,stop,handle,poll,measure,diagnostic,validConfig,tuneScreenOfferSDP,selectCodecs,firstVideoCodec,recoverVideo,applyQuality,get active(){return active;}};',context);
  element('supabaseUrl').value='https://test.supabase.co';
  element('anonKey').value='sb_publishable_TEST_ONLY';
  element('roomId').value='same-room';
  return {api:context.probe,element,requests,intervals,codecs,setResponse:fn=>{response=fn;}};
}
function row(s,kind,p={},id=1) {
  return {id,kind,payload:{protocol:'screen-v031',source:'replaykit',sessionID:s.id,...p}};
}
test('screen-only room, recvonly video, API key header and new session',async()=>{
  const h=harness();await h.api.start();const s=h.api.active;
  assert.equal(s.config.transport,'same-room-screen-v031');
  assert.equal(s.pc.transceiver.direction,'recvonly');
  const post=h.requests.find(r=>r.method==='POST');
  assert.equal(post.headers.apikey,'sb_publishable_TEST_ONLY');
  assert.equal(post.headers.Authorization,undefined);
  assert.equal(JSON.parse(post.body).payload.source,'windows');
  assert.ok(h.requests.find(r=>r.method==='GET').url.searchParams.get('payload->>sessionID').includes(s.id));
  h.api.stop();await h.api.start();assert.notEqual(h.api.active.id,s.id);h.api.stop();
});
test('early ICE waits for answer; duplicate answers are ignored',async()=>{
  const h=harness();await h.api.start();const s=h.api.active;
  await h.api.handle(s,row(s,'ice',{candidate:'candidate:1',sdpMid:'0',sdpMLineIndex:0}));
  assert.equal(s.pc.candidates.length,0);assert.equal(s.pending.length,1);
  await h.api.handle(s,row(s,'answer',{sdp:'video-answer'}));
  await h.api.handle(s,row(s,'answer',{sdp:'duplicate'}));
  assert.equal(s.pc.remoteCalls,1);assert.equal(s.pc.candidates.length,1);h.api.stop();
});
test('old web callee, wrong session, wrong protocol never win the answer',async()=>{
  const h=harness();await h.api.start();const s=h.api.active;
  for(const p of [{source:'webview'},{sessionID:'old-session'},{protocol:'old'}]) {
    await h.api.handle(s,row(s,'answer',{sdp:'wrong',...p}));
  }
  assert.equal(s.pc.remoteCalls,0);assert.equal(s.accepted,false);h.api.stop();
});
test('concurrent polling is serialized; a failed poll can recover',async()=>{
  const h=harness();await h.api.start();const s=h.api.active;
  let resolve;h.setResponse(()=>new Promise(r=>{resolve=r;}));
  const before=h.requests.length,p=h.api.poll(s);await h.api.poll(s);
  assert.equal(h.requests.length,before+1);
  resolve({ok:false,status:403});await p;
  assert.match(h.element('log').textContent,/HTTP 403/);
  h.setResponse(async()=>({ok:true,status:200,json:async()=>[]}));
  await h.api.poll(s);assert.equal(h.element('signalState').textContent,'정상');h.api.stop();
});
test('stopping an in-flight start does not show a false startup failure',async()=>{
  const h=harness();let reject;
  h.setResponse(()=>new Promise((_,r)=>{reject=r;}));
  const starting=h.api.start();
  while(!reject) await Promise.resolve();
  const s=h.api.active;h.api.stop();reject(new Error('cancelled'));await starting;
  assert.equal(h.api.active,null);assert.equal(s.pc.closed,true);
  assert.doesNotMatch(h.element('summary').textContent,/시작 실패/);
  assert.equal(h.intervals.size,0);
});
test('stale response after restart cannot change the new connection',async()=>{
  const h=harness();await h.api.start();const old=h.api.active;
  h.api.stop();await h.api.start();const next=h.api.active;
  await h.api.handle(old,row(old,'answer',{sdp:'stale'}));
  assert.equal(next.accepted,false);assert.equal(next.pc.remoteCalls,0);h.api.stop();
});
test('POST failure releases connection and enables retry',async()=>{
  const h=harness();h.setResponse(async()=>({ok:false,status:401}));
  await h.api.start();assert.equal(h.api.active,null);
  assert.equal(h.element('startBtn').disabled,false);
  assert.match(h.element('summary').textContent,/HTTP 401/);
});
test('track without stream is attached and played',async()=>{
  const h=harness();await h.api.start();const s=h.api.active;
  const track={kind:'video'};s.pc.ontrack({track,streams:[]});
  assert.equal(h.element('remoteVideo').srcObject.tracks[0],track);
  assert.equal(h.element('remoteVideo').paused,false);h.api.stop();
});
test('connected peer alone is not screen success; decoded frames and playback are required',async()=>{
  const h=harness();await h.api.start();const s=h.api.active;
  s.pc.connectionState='connected';await h.api.measure(s);
  assert.doesNotMatch(h.element('summary').textContent,/화면 수신 확인/);
  const video=h.element('remoteVideo');video.readyState=4;video.paused=false;video.videoWidth=640;video.videoHeight=360;
  s.pc.report=new Map([['in',{type:'inbound-rtp',kind:'video',framesDecoded:20,bytesReceived:4096}]]);
  await h.api.measure(s);assert.match(h.element('summary').textContent,/화면 수신 확인/);
  s.lastProgress=Date.now()-10000;await h.api.measure(s);
  assert.match(h.element('summary').textContent,/멈췄습니다/);h.api.stop();
});
test('diagnostic copy excludes configuration credentials',async()=>{
  const h=harness();await h.api.start();
  const text=h.api.diagnostic();assert.doesNotMatch(text,/sb_publishable_TEST_ONLY|test\.supabase\.co/);
  assert.match(text,/screen-v031/);h.api.stop();
});
test('invalid keys, URLs and room IDs do not start network work',async()=>{
  for(const [id,value] of [['anonKey','sb_secret_bad'],['anonKey','sb_publishable_'],
    ['supabaseUrl','https://example.com'],['roomId','x'],['roomId','x/y']]) {
    const h=harness();h.element(id).value=value;await h.api.start();assert.equal(h.requests.length,0);
  }
});
test('offer is posted before locally queued ICE',async()=>{
  const h=harness();h.setResponse(async(url,options)=>{
    if(options.method==='POST' && JSON.parse(options.body).kind==='offer') {
      h.api.active.pc.onicecandidate({candidate:{toJSON:()=>({candidate:'local-ice'})}});
    }
    return {ok:true,status:200,json:async()=>[]};
  });
  await h.api.start();
  assert.deepEqual(h.requests.filter(r=>r.method==='POST').map(r=>JSON.parse(r.body).kind),['offer','ice']);
  h.api.stop();
});
test('real CRLF SDP changes only video bandwidth, is idempotent and keeps fmtp intact',()=>{
  const h=harness();
  const input=['v=0','m=audio 9 UDP/TLS/RTP/SAVPF 111','c=IN IP4 0.0.0.0','b=AS:64',
    'a=rtpmap:111 opus/48000/2','m=video 9 UDP/TLS/RTP/SAVPF 96 97 98',
    'c=IN IP4 0.0.0.0','b=AS:1000','b=TIAS:1000000','a=rtpmap:96 H264/90000',
    'a=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f',
    'a=rtpmap:97 rtx/90000','a=fmtp:97 apt=96','a=rtpmap:98 VP8/90000',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel','c=IN IP4 0.0.0.0',''].join('\r\n');
  const result=h.api.tuneScreenOfferSDP(input);
  assert.notEqual(result,input); // The old escaped parser returned input unchanged.
  assert.equal((result.match(/b=TIAS:60000000/g)||[]).length,1);
  assert.ok(result.includes('b=AS:64\r\n'));
  assert.ok(result.includes('a=fmtp:97 apt=96\r\n'));
  assert.ok(result.includes('profile-level-id=42e033\r\n'));
  assert.ok(!result.includes('profile-level-id=42e01f\r\n'));
  assert.equal(h.api.tuneScreenOfferSDP(result),result);
  assert.equal(h.api.tuneScreenOfferSDP(input.replace(/\r\n/g,'\n')),result);
  assert.equal(h.api.firstVideoCodec(result),'H264');
});
test('default offers H264 only; explicit VP8 offers VP8 only plus repair codecs',async()=>{
  const h=harness();await h.api.start();const s=h.api.active;
  assert.equal(s.pc.transceiver.codecs[0].mimeType,'video/H264');
  assert.equal(s.pc.transceiver.codecs.filter(c=>/^video\/(H264|VP8|VP9)$/i.test(c.mimeType)).map(c=>c.mimeType).join(','),'video/H264');
  h.api.selectCodecs(s.pc.transceiver,'vp8');
  assert.equal(s.pc.transceiver.codecs[0].mimeType,'video/VP8');
  assert.equal(s.pc.transceiver.codecs.filter(c=>/^video\/(H264|VP8|VP9)$/i.test(c.mimeType)).map(c=>c.mimeType).join(','),'video/VP8');
  assert.ok(s.pc.transceiver.codecs.some(c=>c.mimeType==='video/rtx'));
  h.api.stop();
});
test('missing codec API refuses silent browser-default negotiation',async()=>{
  const h=harness({noCapabilities:true});await h.api.start();
  assert.equal(h.api.active,null);assert.match(h.element('summary').textContent,/코덱 고정을 지원하지 않습니다/);
});
test('connected H264 with zero frames reports failure without hidden VP8 downgrade',async()=>{
  const h=harness();await h.api.start();const s=h.api.active,session=s.id;
  await h.api.handle(s,row(s,'answer',{sdp:'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 H264/90000\r\n'}));
  s.pc.connectionState='connected';s.connectedAt=Date.now()-12000;
  s.senderDiagnostic={build:'24',framesSubmitted:60};
  await h.api.measure(s);
  assert.equal(s.revision,0);assert.equal(s.id,session);
  assert.equal(s.recoveryAttempted,true);assert.equal(s.codecPreference,'H264 only (hardware required)');
  const offers=h.requests.filter(r=>r.method==='POST'&&JSON.parse(r.body).kind==='offer');
  assert.equal(offers.length,1);
  assert.match(h.element('summary').textContent,/자동 저하하지 않았습니다/);
  h.api.stop();
});
test('working H264 video is not renegotiated',async()=>{
  const h=harness();await h.api.start();const s=h.api.active;
  s.pc.signalingState='stable';s.accepted=true;s.pc.connectionState='connected';
  s.connectedAt=Date.now()-12000;s.answerCodec='H264';
  s.senderDiagnostic={build:'24',framesSubmitted:60};
  s.pc.report=new Map([['v',{type:'inbound-rtp',kind:'video',framesDecoded:30,bytesReceived:10000}]]);
  await h.api.measure(s);assert.equal(s.recoveryAttempted,false);h.api.stop();
});
test('video timeout distinguishes zero bytes from decoder failure',async()=>{
  const h=harness();await h.api.start();const s=h.api.active;
  s.accepted=true;s.track=true;s.started=Date.now()-20000;
  await h.api.measure(s);assert.match(h.element('summary').textContent,/0바이트/);
  s.pc.report=new Map([['v',{type:'inbound-rtp',kind:'video',framesDecoded:0,bytesReceived:1234}]]);
  await h.api.measure(s);assert.match(h.element('summary').textContent,/도착했지만 디코딩/);h.api.stop();
});
test('quality is saved and acknowledged by request ID, not merely by local selection',async()=>{
  const h=harness();h.element('qualityPreset').value='720p30';await h.api.start();const s=h.api.active;
  const offer=JSON.parse(h.requests.find(r=>r.method==='POST').body);
  assert.equal(offer.payload.qualityID,'720p30');
  h.api.applyQuality();assert.match(h.element('qualityState').textContent,/확인 대기/);
  const request=s.dc.sent.at(-1);
  const diagnostic={version:'0.3.2',build:'24',sessionID:s.id,qualityID:'720p30',targetFPS:30};
  s.dc.onmessage({data:JSON.stringify({...diagnostic,settingsRequestID:'old'})});
  assert.doesNotMatch(h.element('qualityState').textContent,/송신기 적용 확인:/);
  s.dc.onmessage({data:JSON.stringify({...diagnostic,settingsRequestID:request.requestID})});
  assert.match(h.element('qualityState').textContent,/송신기 적용 확인: 720p30/);
  h.api.stop();
});
