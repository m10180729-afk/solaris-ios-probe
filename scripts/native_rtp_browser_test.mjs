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
server.stdout.on('data',d=>serverLog+=d);server.stderr.on('data',d=>serverLog+=d);
async function waitUntil(fn,message,ms=20000){const start=Date.now();while(Date.now()-start<ms){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error(message);}
const base='http://127.0.0.1:18950';
try{
  await waitUntil(()=>{if(server.exitCode!==null)throw Error(serverLog);return serverLog.includes('RTP_TEST_READY');},'native server startup');
  browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
  const pages=[];
  async function connect(id){
    const page=await browser.newPage();pages.push(page);await page.goto(base);await page.setContent(html);
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
}catch(e){writeFileSync(new URL('build/rtp-diagnostics/failure.txt',root),e.stack+'\n'+serverLog);throw e;}
finally{await browser?.close();await fetch(base+'/done').catch(()=>{});server.kill();writeFileSync(new URL('build/rtp-diagnostics/native.log',root),serverLog);}
