import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';

const html=readFileSync(new URL('../ios/App/Resources/solaris-desktop.html',import.meta.url),'utf8');
const source=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];

function harness(){
  const elements=new Map(),storage=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{value:'',textContent:'',className:'',disabled:false,hidden:false,style:{},
      scrollTop:0,scrollHeight:0,muted:false,srcObject:null,pause(){},play(){return Promise.resolve();},select(){}});
    return elements.get(id);
  };
  const context=vm.createContext({console,URL,URLSearchParams,AbortController,crypto:webcrypto,
    performance:{now:()=>1000},setTimeout,clearTimeout,setInterval,clearInterval,
    document:{getElementById:element},window:{addEventListener(){}},navigator:{clipboard:{writeText:async()=>{}}},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    RTCRtpSender:{getCapabilities:()=>({codecs:[]})},RTCRtpReceiver:{getCapabilities:()=>({codecs:[]})},
    RTCPeerConnection:class{},MediaStream:class{}});
  vm.runInContext(source+'\nglobalThis.probe={validConfig,tuneDesktopSDP,diagnostic,measure,selectMode,MODES,sendNativeAccessUnit,nativeBitrateControl,nextNativeBitrate,stop,setActive:s=>active=s};',context);
  element('supabaseUrl').value='https://test.supabase.co';
  element('anonKey').value='sb_publishable_TEST_ONLY';
  element('roomId').value='same-room';
  return{api:context.probe,element};
}

test('desktop signaling uses an isolated room and publishable key validation',()=>{
  const h=harness();
  assert.equal(h.api.validConfig().transport,'same-room-desktop-v1');
  h.element('anonKey').value='sb_secret_forbidden';
  assert.throws(()=>h.api.validConfig(),/Publishable key/);
});

test('compatibility desktop SDP requests H264 level 5.1, 40Mbps video and stereo Opus',()=>{
  const h=harness();
  const input=['v=0','m=audio 9 UDP/TLS/RTP/SAVPF 111','c=IN IP4 0.0.0.0',
    'a=rtpmap:111 opus/48000/2','m=video 9 UDP/TLS/RTP/SAVPF 96',
    'c=IN IP4 0.0.0.0','a=rtpmap:96 H264/90000',
    'a=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f',''].join('\r\n');
  const result=h.api.tuneDesktopSDP(input,h.api.MODES.compatibility60);
  assert.match(result,/b=TIAS:40000000/);
  assert.match(result,/profile-level-id=42e033/);
  assert.match(result,/x-google-start-bitrate=12000/);
  assert.match(result,/x-google-min-bitrate=6000/);
  assert.match(result,/x-google-max-bitrate=40000/);
  assert.match(result,/stereo=1;sprop-stereo=1;maxaveragebitrate=256000/);
});

test('hardware 120 mode retains the complete 1080p120 capture budget',()=>{
  const h=harness();
  const input=['v=0','m=video 9 UDP/TLS/RTP/SAVPF 96','c=IN IP4 0.0.0.0',
    'a=rtpmap:96 H264/90000','a=fmtp:96 packetization-mode=1;profile-level-id=42e01f',''].join('\r\n');
  const result=h.api.tuneDesktopSDP(input,h.api.MODES.hardware120);
  assert.match(result,/b=TIAS:80000000/);
  assert.match(result,/x-google-start-bitrate=35000/);
  assert.match(result,/x-google-min-bitrate=18000/);
  assert.match(result,/x-google-max-bitrate=80000/);
  assert.match(source,/getDisplayMedia/);
  assert.match(source,/width:\{ideal:1920,max:1920\}/);
  assert.match(source,/height:\{ideal:1080,max:1080\}/);
  assert.match(source,/maxFramerate=mode\.fps/);
  assert.match(source,/maxBitrate=mode\.maxBitrate/);
  assert.match(source,/degradationPreference=mode\.degradationPreference/);
  assert.match(source,/direction:'sendonly'/);
  assert.match(source,/systemAudio:'include'/);
  assert.doesNotMatch(source,/getUserMedia/);
  assert.match(source,/핵심 \$\{mode\.label\} 정책으로 재시도/);
});

test('mode UI separates Solaris hardware and compatibility paths',()=>{
  assert.match(html,/Solaris 하드웨어 1080p60/);
  assert.match(html,/Solaris 하드웨어 1080p120/);
  assert.match(html,/호환 1080p60/);
  assert.match(source,/webcodecs-h264/);
  assert.match(source,/hardwareAcceleration:'prefer-hardware'/);
  assert.match(source,/native-start/);
  assert.match(source,/sharedbufferreceived/);
  assert.match(source,/releaseBuffer\(sharedBuffer\)/);
  assert.doesNotMatch(source,/VideoEncoder\.isConfigSupported/);
  assert.doesNotMatch(source,/solaris-native:\/\//);
});

test('software H264 is reported as a sender bottleneck',async()=>{
  const h=harness();
  const report=new Map([
    ['v',{id:'v',type:'outbound-rtp',kind:'video',codecId:'h',mediaSourceId:'src',
      framesEncoded:18,bytesSent:5000,frameWidth:1920,frameHeight:1080,
      totalEncodeTime:.5,encoderImplementation:'OpenH264',powerEfficientEncoder:false}],
    ['h',{type:'codec',mimeType:'video/H264'}],
    ['src',{type:'media-source',framesPerSecond:18}]
  ]);
  const session={role:'sender',pc:{getStats:async()=>report},lastStatsAt:0,
    encodeSeconds:0,encodeFrames:0};
  h.api.setActive(session);
  await h.api.measure(session);
  assert.match(h.element('summary').textContent,/OpenH264 CPU/);
  assert.equal(h.element('summary').className,'bad');
});

test('desktop receiver answers offered media sections without a duplicate video m-line',()=>{
  assert.match(source,/setRemoteDescription\(\{type:'offer',sdp:p\.sdp\}\)/);
  assert.match(source,/getTransceivers\(\)/);
  assert.doesNotMatch(source,/addTransceiver\('video',\{direction:'recvonly'\}\)/);
});

test('diagnostics omit Supabase URL and publishable key',()=>{
  const h=harness();
  const report=h.api.diagnostic();
  assert.doesNotMatch(report,/test\.supabase\.co|sb_publishable_TEST_ONLY/);
  assert.match(report,/desktop-v1/);
});

test('receiver diagnostics keep a viewer identity distinct from the broadcast session',()=>{
  const h=harness();
  h.api.setActive({id:'broadcast-session',viewerID:'viewer-a',role:'receiver',config:{room:'room-one'},pc:{connectionState:'connected',signalingState:'stable'},stats:{frames:3}});
  const report=JSON.parse(h.api.diagnostic());
  assert.equal(report.session,'broadcast-session');
  assert.equal(report.viewerID,'viewer-a');
  assert.equal(report.role,'receiver');
});

test('native transport waits for a keyframe after queue saturation',()=>{
  const h=harness(),sent=[];
  const session={nativeChannel:{readyState:'open',bufferedAmount:768*1024-100,send:p=>sent.push(p)},nativeStats:{frames:0,dropped:0,bytes:0,queueHighWaterBytes:0,resyncDrops:0,awaitingKeyFrame:false}};
  h.api.sendNativeAccessUnit(session,new Uint8Array(20*1024),false,10);
  assert.equal(sent.length,0);
  assert.equal(session.nativeStats.dropped,1);
  assert.equal(session.nativeStats.awaitingKeyFrame,true);
  session.nativeChannel.bufferedAmount=0;
  h.api.sendNativeAccessUnit(session,new Uint8Array(20*1024),false,20);
  assert.equal(sent.length,0);
  assert.equal(session.nativeStats.resyncDrops,1);
  h.api.sendNativeAccessUnit(session,new Uint8Array(20*1024),true,30);
  assert.equal(sent.length,2);
  assert.equal(session.nativeStats.frames,1);
  assert.equal(session.nativeStats.awaitingKeyFrame,false);
  assert.equal(session.nativeStats.queueHighWaterBytes,20*1024+48);
});

test('native diagnostics expose the ICE route and warn only on observed queue saturation',async()=>{
  const h=harness();
  const report=new Map([
    ['pair',{id:'pair',type:'candidate-pair',state:'succeeded',nominated:true,
      localCandidateId:'local',remoteCandidateId:'remote',availableOutgoingBitrate:265212,
      currentRoundTripTime:1.98}],
    ['local',{id:'local',type:'local-candidate',candidateType:'srflx',networkType:'wifi',protocol:'udp'}],
    ['remote',{id:'remote',type:'remote-candidate',candidateType:'srflx',protocol:'udp'}]
  ]);
  const s={role:'sender',mode:{...h.api.MODES.hardware60,transport:'webcodecs-h264'},pc:{getStats:async()=>report,connectionState:'connected'},
    stream:{getVideoTracks:()=>[{getSettings:()=>({width:1920,height:1080,frameRate:60})}]},
    nativeChannel:{readyState:'open',bufferedAmount:419901},
    nativeStats:{frames:25,bytes:1000000,dropped:12,queueHighWaterBytes:700000,nativeEncodedFPS:0},
    nativeStatus:'stopped',lastStatsAt:0,lastFrames:0,lastBytes:0,previousTransportDrops:10};
  h.api.setActive(s);
  await h.api.measure(s);
  assert.equal(s.stats.availableOutgoingMbps,.265212);
  assert.equal(s.stats.localCandidateType,'srflx');
  assert.equal(s.stats.remoteCandidateType,'srflx');
  assert.equal(s.stats.iceProtocol,'udp');
  assert.match(h.element('summary').textContent,/송신 대기열 포화/);
  assert.equal(h.element('summary').className,'bad');
  s.nativeStats.dropped=12;s.previousTransportDrops=12;
  await h.api.measure(s);
  assert.doesNotMatch(h.element('summary').textContent,/송신 대기열 포화/);
});

test('native bitrate falls after sustained congestion and rises only after a quiet interval',()=>{
  const h=harness(),c=h.api.nativeBitrateControl(h.api.MODES.hardware60,0);
  for(let t=1000;t<=12000;t+=1000){
    const target=h.api.nextNativeBitrate(c,1_500_000,t*4,t);
    if(t<10000)assert.equal(target,null);
    else if(t===10000)assert.equal(target,7);
  }
  assert.equal(c.targetMbps,7);
  for(let t=13000;t<=57000;t+=1000){
    const target=h.api.nextNativeBitrate(c,0,48,t);
    if(t<57000)assert.equal(target,null);
    else assert.equal(target,9);
  }
  assert.equal(c.restarts,2);
});

test('diagnostic survives stopping and keeps the last session',()=>{
  const h=harness();const s={id:'last-session',role:'sender',config:{room:'test-room'},mode:h.api.MODES.hardware60,
    pc:{connectionState:'connected',signalingState:'stable',close(){}},
    stream:{getVideoTracks:()=>[{getSettings:()=>({width:1920,height:1080})}],getAudioTracks:()=>[{}],getTracks:()=>[]},
    nativeStats:{encoderImplementation:'Intel Quick Sync'},stats:{frames:500,fps:58},history:[{time:1000,frames:500}]};
  h.api.setActive(s);h.api.stop();
  const report=JSON.parse(h.api.diagnostic());
  assert.equal(report.session,'last-session');
  assert.equal(report.actual.frames,500);
  assert.equal(report.audioTracks,1);
  assert.equal(report.stopped,true);
});


test('stats use the active RTP codec and distinguish capture from encoded FPS',async()=>{
  const h=harness();
  const report=new Map([
    ['v',{id:'v',type:'outbound-rtp',kind:'video',codecId:'h',mediaSourceId:'src',
      framesEncoded:21,bytesSent:6000,frameWidth:1920,frameHeight:1080,
      totalEncodeTime:.42,encoderImplementation:'test encoder'}],
    ['h',{type:'codec',mimeType:'video/H264'}],
    ['repair',{type:'codec',mimeType:'video/rtx'}],
    ['src',{type:'media-source',framesPerSecond:120}]
  ]);
  const session={role:'sender',pc:{getStats:async()=>report},lastStatsAt:0,
    encodeSeconds:0,encodeFrames:0};
  h.api.setActive(session);
  await h.api.measure(session);
  assert.equal(session.stats.codec,'H264');
  assert.equal(session.stats.captureActualFPS,120);
  assert.equal(session.stats.encodeMilliseconds,20);
  assert.equal(session.history.length,1);
  assert.doesNotMatch(h.element('summary').textContent,/실측 성공/);
});
