// Execute the shipped receiver script with controlled transport/peer doubles.
// These tests verify signaling/lifecycle logic, not an iPad or codec.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';

const html=readFileSync(new URL('../ios/App/Resources/solaris-p2p.html',import.meta.url),'utf8');
const source=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
function harness() {
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
    addTransceiver(kind,options){this.transceiver={kind,...options};}
    createDataChannel(){return {close(){}};}
    async createOffer(){return {type:'offer',sdp:'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n'};}
    async setLocalDescription(d){this.localDescription={...d,toJSON:()=>d};this.signalingState='have-local-offer';}
    async setRemoteDescription(d){this.remoteCalls++;this.remoteDescription=d;this.signalingState='stable';}
    async addIceCandidate(c){assert.ok(this.remoteDescription,'ICE must wait for SDP');this.candidates.push(c);}
    async getStats(){return this.report;}
    close(){this.closed=true;}
  }
  const context=vm.createContext({console,URL,AbortController,crypto:webcrypto,RTCPeerConnection:Peer,
    MediaStream:class {constructor(tracks){this.tracks=tracks;}},
    setTimeout,clearTimeout,setInterval:fn=>{intervals.set(++serial,fn);return serial;},
    clearInterval:id=>intervals.delete(id),
    document:{getElementById:element},window:{addEventListener(){}},navigator:{},
    localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    fetch:async(url,options)=>{requests.push({url:new URL(url),...options});return response(url,options);}
  });
  vm.runInContext(source+'\nglobalThis.probe={start,stop,handle,poll,measure,diagnostic,validConfig,get active(){return active;}};',context);
  element('supabaseUrl').value='https://test.supabase.co';
  element('anonKey').value='sb_publishable_TEST_ONLY';
  element('roomId').value='same-room';
  return {api:context.probe,element,requests,intervals,setResponse:fn=>{response=fn;}};
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
