// Real SRTP interoperability gate. FFmpeg's generated test video is a fixture,
// not evidence of Windows GPU capture throughput or iPad display performance.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const dll=new URL('windows-native/Solaris.Transport.Tests/bin/Release/net8.0/Solaris.Transport.Tests.dll',root).pathname;
const fixture=new URL('build/rtp-fixture.h264',root).pathname;
const html=readFileSync(new URL('ios/App/Resources/solaris-desktop.html',root),'utf8');
mkdirSync(new URL('build/rtp-diagnostics/',root),{recursive:true});
const server=spawn(process.env.DOTNET||'dotnet',[dll,'--serve',fixture],{cwd:root,stdio:['ignore','pipe','pipe']});
let serverLog='',browser;
const pages=[];
const browserEvents=[];
server.stdout.on('data',d=>serverLog+=d);server.stderr.on('data',d=>serverLog+=d);
async function waitUntil(fn,message,ms=20000){const start=Date.now();while(Date.now()-start<ms){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error(message);}
const base='http://127.0.0.1:18950';
try{
  await waitUntil(()=>{if(server.exitCode!==null)throw Error(serverLog);return serverLog.includes('RTP_TEST_READY');},'native server startup');
  // Playwright's bundled Chromium on Linux is built without proprietary H.264.
  // Use actual Chrome for the codec interoperability gate.
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
  const codecProbe=await browser.newPage();pages.push(codecProbe);
  const h264=await codecProbe.evaluate(()=>RTCRtpReceiver.getCapabilities('video').codecs.filter(c=>c.mimeType.toLowerCase()==='video/h264'));
  if(!h264.length)throw Error('The test browser does not support H.264; install Chrome for Testing before running the RTP gate');
  await codecProbe.close();pages.pop();
  async function connect(id){
    const page=await browser.newPage();pages.push(page);
    page.on('pageerror',e=>browserEvents.push({id,error:e.stack}));
    page.on('console',m=>{if(m.type()==='error')browserEvents.push({id,error:m.text()});});
    await page.goto(base);await page.setContent(html);
    await page.evaluate(async id=>{
      globalThis.testID=id;
      active=baseSession({url:location.origin,key:'test',room:'test',transport:'test'},'receiver');
      active.id='integration';active.rtp=true;
      sendSignal=async(s,kind,p)=>{
        if(kind==='ice'){await fetch('/ice?id='+testID,{method:'POST',body:JSON.stringify(p)});return;}
        if(kind==='answer'&&p.sdp){const res=await fetch('/answer?id='+testID,{method:'POST',body:JSON.stringify(p)});if(!res.ok)throw Error(await res.text());}
        if(p.action==='recover')globalThis.testRecoveryRequested=true;
      };
      globalThis.offerGeneration=0;
      globalThis.getNewOffer=async()=>{
        const res=await fetch('/offer?id='+testID);if(!res.ok)throw Error(await res.text());const offer=await res.json();
        await handleRtpSignal(active,'offer',{...offer,protocol:PROTOCOL,source:'windows-desktop',sessionID:active.id,viewerID:active.viewerID,generation:++offerGeneration,videoTransport:'native-rtp'});
      };
      await getNewOffer();
    },id);return page;
  }
  async function stats(page){return page.evaluate(async()=>{await measureRtp(active);return{...active.stats,peer:active.pc.connectionState,sdp:active.pc.remoteDescription?.sdp};});}
  const a=await connect('a'),b=await connect('b');
  for(const page of [a,b])await waitUntil(async()=>{const s=await stats(page);return s.framesDecoded>=60&&s.width===1920&&s.height===1080&&s.audio.bytesReceived>1000;},'H264 video and Opus audio must decode on both viewers',30000);
  const initialA=await stats(a),initialB=await stats(b);
  assert.doesNotMatch(initialA.sdp,/m=application/,'media must not use DataChannel');
  assert.match(initialA.sdp,/nack pli/);assert.match(initialA.sdp,/opus\/48000\/2/);
  // Force loss of one peer. Production watchdog must request recovery; the
  // unaffected viewer must continue without capture/encoder restart.
  await fetch(base+'/close?id=a');
  await a.evaluate(()=>{active.rtpOfferAt=Date.now()-20000;active.lastRtpFrameAt=Date.now()-20000;});
  await waitUntil(async()=>{await stats(a);return a.evaluate(()=>!!globalThis.testRecoveryRequested);},'receiver watchdog did not request recovery',20000);
  await a.evaluate(()=>getNewOffer());
  await waitUntil(async()=>{const s=await stats(a);return s.framesDecoded>=60;},'replacement peer did not resume decoding',30000);
  const finalB=await stats(b);assert.ok(finalB.framesDecoded>initialB.framesDecoded+60,'other viewer continued during recovery');
  const native=await (await fetch(base+'/stats')).json();
  for(const v of Object.values(native))assert.equal(v.lastError,'');
  writeFileSync(new URL('build/rtp-diagnostics/result.json',root),JSON.stringify({initialA,initialB,finalA:await stats(a),finalB,native},null,2));
  console.log('PASS: actual H264/Opus SRTP decode, two viewers, production receiver watchdog and peer replacement');
}catch(e){
  const snapshots=await Promise.all(pages.map(async(page,index)=>{
    try{return{index,...await page.evaluate(async()=>{
      const report=await active?.pc?.getStats();
      const mediaLines=sdp=>sdp?.split(/\r?\n/).filter(line=>/^(m=|a=(rtpmap|fmtp|rtcp-fb|mid|sendonly|recvonly|inactive))/i.test(line));
      return {peer:active?.pc?.connectionState,ice:active?.pc?.iceConnectionState,signaling:active?.pc?.signalingState,
        stats:active?.stats,log:document.querySelector('#log')?.textContent,
        inbound:[...(report?.values()||[])].filter(v=>v.type==='inbound-rtp'||v.type==='transport'||v.type==='candidate-pair').map(v=>({type:v.type,kind:v.kind,state:v.state,nominated:v.nominated,framesDecoded:v.framesDecoded,bytesReceived:v.bytesReceived,packetsReceived:v.packetsReceived,packetsLost:v.packetsLost})),
        remoteMedia:mediaLines(active?.pc?.remoteDescription?.sdp),localMedia:mediaLines(active?.pc?.localDescription?.sdp)};
    })};}catch(error){return{index,error:String(error)};}
  }));
  const native=await fetch(base+'/stats').then(r=>r.json()).catch(error=>({error:String(error)}));
  writeFileSync(new URL('build/rtp-diagnostics/failure.json',root),JSON.stringify({error:e.stack,snapshots,native,browserEvents,serverLog},null,2));
  throw e;
}
finally{await browser?.close();await fetch(base+'/done').catch(()=>{});server.kill();writeFileSync(new URL('build/rtp-diagnostics/native.log',root),serverLog);}
