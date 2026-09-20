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
    if(!elements.has(id))elements.set(id,{value:'',textContent:'',className:'',disabled:false,hidden:false,
      scrollTop:0,scrollHeight:0,muted:false,srcObject:null,pause(){},play(){return Promise.resolve();},select(){}});
    return elements.get(id);
  };
  const context=vm.createContext({console,URL,URLSearchParams,AbortController,crypto:webcrypto,
    performance:{now:()=>1000},setTimeout,clearTimeout,setInterval,clearInterval,
    document:{getElementById:element},window:{addEventListener(){}},navigator:{clipboard:{writeText:async()=>{}}},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    RTCRtpSender:{getCapabilities:()=>({codecs:[]})},RTCRtpReceiver:{getCapabilities:()=>({codecs:[]})},
    RTCPeerConnection:class{},MediaStream:class{}});
  vm.runInContext(source+'\nglobalThis.probe={validConfig,tuneDesktopSDP,diagnostic,measure,setActive:s=>active=s};',context);
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

test('desktop SDP requests H264 level 5.1, 80Mbps video and stereo Opus',()=>{
  const h=harness();
  const input=['v=0','m=audio 9 UDP/TLS/RTP/SAVPF 111','c=IN IP4 0.0.0.0',
    'a=rtpmap:111 opus/48000/2','m=video 9 UDP/TLS/RTP/SAVPF 96',
    'c=IN IP4 0.0.0.0','a=rtpmap:96 H264/90000',
    'a=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f',''].join('\r\n');
  const result=h.api.tuneDesktopSDP(input);
  assert.match(result,/b=TIAS:80000000/);
  assert.match(result,/profile-level-id=42e033/);
  assert.match(result,/stereo=1;sprop-stereo=1;maxaveragebitrate=256000/);
});

test('single desktop build contains the complete 1080p120 sender and receiver policy',()=>{
  assert.match(source,/getDisplayMedia/);
  assert.match(source,/width:\{ideal:1920,max:1920\}/);
  assert.match(source,/height:\{ideal:1080,max:1080\}/);
  assert.match(source,/frameRate:\{ideal:120,max:120\}/);
  assert.match(source,/e\.maxFramerate=120/);
  assert.match(source,/e\.maxBitrate=80000000/);
  assert.match(source,/direction:'sendonly'/);
  assert.match(source,/systemAudio:'include'/);
  assert.doesNotMatch(source,/getUserMedia/);
  assert.match(source,/핵심 1080p120 정책으로 재시도/);
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
