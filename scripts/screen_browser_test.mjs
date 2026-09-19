// Real browser video/ICE/decoder integration against an isolated mock signal server.
// The sender is a canvas WebRTC peer, NOT ReplayKit. No real credentials are used.
import {createServer} from 'node:http';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
let chromium;
try { ({chromium}=require('playwright')); }
catch {
  if(!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw Error('Install playwright before running this test.');
  ({chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright'));
}
const html=readFileSync(new URL('../ios/App/Resources/solaris-p2p.html',import.meta.url),'utf8');
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser, page, sender;
const errors=[];
let work=Promise.resolve();
try {
  browser=await chromium.launch({headless:true,args:[
    '--disable-background-timer-throttling','--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows','--disable-features=WebRtcHideLocalIpsWithMdns']});
  const context=await browser.newContext();
  // Both peers use local host candidates only; this test needs no public STUN.
  // This override affects the fixture context, never the shipped receiver.
  await context.addInitScript(()=>{
    const RealPeer=window.RTCPeerConnection;
    window.RTCPeerConnection=class extends RealPeer {
      constructor(config){super({...config,iceServers:[]});}
    };
  });
  page=await context.newPage();
  sender=await context.newPage();
  await sender.goto('http://127.0.0.1:'+server.address().port+'/synthetic-sender');
  page.on('pageerror',e=>errors.push(e.message));
  sender.on('pageerror',e=>errors.push('sender: '+e.message));
  let inbox=[],sequence=0;
  await page.route('https://test.supabase.co/rest/v1/solaris_signals**',async route=>{
    const request=route.request(),url=new URL(request.url());
    const headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS',
      'access-control-allow-headers':'apikey,content-type,prefer'};
    if(request.method()==='OPTIONS') { await route.fulfill({status:204,headers,body:''});return; }
    if(request.method()==='POST') {
      const row=request.postDataJSON();
      // A real signaling server ACKs storage, it doesn't wait for the remote
      // peer's ICE gathering. The previous fixture held POST open against the
      // receiver's 8-second HTTP timeout. Serialize sender work after the ACK.
      await route.fulfill({status:201,headers,body:''});
      work=work.then(async()=>{
      if(row.kind==='offer') {
        const results=await sender.evaluate(async envelope=>{
          if(window.peer) window.peer.close();
          window.stream?.getTracks().forEach(t=>t.stop());
          if(window.drawTimer) clearInterval(window.drawTimer);
          document.body.replaceChildren();
          const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1324;
          document.body.append(canvas);
          const ctx=canvas.getContext('2d');let frame=0;
          const draw=()=>{
            ctx.fillStyle=++frame%2?'#187dd1':'#139878';ctx.fillRect(0,0,canvas.width,canvas.height);
            ctx.fillStyle='white';ctx.font='32px sans-serif';ctx.fillText('Solaris test '+frame,40,180);
          };
          draw();
          window.drawTimer=setInterval(draw,66);
          window.stream=canvas.captureStream(15);
          const peer=new RTCPeerConnection({iceServers:[]});window.peer=peer;
          peer.addTrack(window.stream.getVideoTracks()[0],window.stream);
          peer.ondatachannel=e=>{
            const dc=e.channel;
            dc.onopen=()=>dc.send(JSON.stringify({version:'0.3.2',build:'23',sessionID:envelope.sessionID,
              state:'synthetic sender',framesSubmitted:1,lastError:''}));
            dc.onmessage=async event=>{
              const request=JSON.parse(event.data);
              if(request.type!=='quality'||request.sessionID!==envelope.sessionID) return;
              const limit=request.qualityID==='720p30'?1280:1920;
              // Synthetic sender implements the quality command by resizing
              // its canvas. This tests the data channel and real decoder,
              // not ReplayKit's or iOS's quality controls.
              canvas.width=limit;canvas.height=Math.floor(limit*1324/1920/2)*2;
              draw();
              dc.send(JSON.stringify({version:'0.3.2',build:'23',sessionID:envelope.sessionID,
                state:'synthetic quality acknowledgement',qualityID:request.qualityID,
                settingsRequestID:request.requestID,targetFPS:request.qualityID==='720p30'?30:60}));
            };
          };
          const candidates=[];
          peer.onicecandidate=e=>{if(e.candidate)candidates.push(e.candidate.toJSON());};
          await peer.setRemoteDescription({type:'offer',sdp:envelope.sdp});
          await peer.setLocalDescription(await peer.createAnswer());
          if(peer.iceGatheringState!=='complete') await new Promise((resolve,reject)=>{
            const timeout=setTimeout(()=>reject(Error('Synthetic sender ICE timeout')),10000);
            peer.addEventListener('icegatheringstatechange',()=>{
              if(peer.iceGatheringState==='complete'){clearTimeout(timeout);resolve();}
            });
          });
          return {answer:peer.localDescription.toJSON(),candidates};
        },row.payload);
        const wrap=(kind,payload)=>({id:++sequence,kind,payload:{...payload,
          sessionID:row.payload.sessionID,protocol:'screen-v031',source:'replaykit'}});
        inbox=[
          wrap('answer',{...results.answer,source:'webview'}), // ignored competitor
          ...results.candidates.map(c=>wrap('ice',c)), // intentionally precede SDP
          wrap('answer',results.answer),
          wrap('answer',results.answer) // intentionally duplicated
        ];
        // wrap adds source, so explicitly override competitor after construction.
        inbox[0].payload.source='webview';
      } else if(row.kind==='ice') {
        await sender.evaluate(c=>window.peer.addIceCandidate(c),{
          candidate:row.payload.candidate,sdpMid:row.payload.sdpMid,sdpMLineIndex:row.payload.sdpMLineIndex});
      }
      }).catch(e=>{errors.push('fixture: '+e.stack);console.error(e);});
    } else {
      const cursor=Number((url.searchParams.get('id')||'gt.0').slice(3));
      const session=(url.searchParams.get('payload->>sessionID')||'eq.').slice(3);
      await route.fulfill({status:200,headers,contentType:'application/json',
        body:JSON.stringify(inbox.filter(r=>r.id>cursor&&r.payload.sessionID===session))});
    }
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.fill('#supabaseUrl','https://test.supabase.co');
  await page.fill('#anonKey','sb_publishable_TEST_ONLY');
  await page.fill('#roomId','browser-test');
  for(let run=0;run<2;run++) {
    await page.selectOption('#qualityPreset','native60');
    await page.selectOption('#codecMode','vp8');
    await page.click('#startBtn');
    await page.waitForFunction(()=>document.getElementById('summary').textContent.includes('화면 수신 확인'),null,{timeout:30000});
    const report=await page.evaluate(()=>JSON.parse(diagnostic()));
    const fixtureReport=await sender.evaluate(async()=>{
      const stats=Array.from((await window.peer.getStats()).values());
      const source=stats.find(r=>r.type==='media-source'&&r.kind==='video');
      const outbound=stats.find(r=>r.type==='outbound-rtp'&&(r.kind==='video'||r.mediaType==='video'));
      return {sourceWidth:source?.width||0,sourceHeight:source?.height||0,
        framesEncoded:outbound?.framesEncoded||0,encodedWidth:outbound?.frameWidth||0,
        encodedHeight:outbound?.frameHeight||0};
    });
    assert.ok(report.framesDecoded>0);
    // Validate the synthetic source separately from the negotiated encoding.
    // WebRTC congestion control may initially encode 1920x1324 input at a
    // smaller resolution; requiring the receiver to be exactly 1920 wide
    // incorrectly turns normal adaptation into a CI failure.
    assert.deepEqual([fixtureReport.sourceWidth,fixtureReport.sourceHeight],[1920,1324]);
    assert.ok(fixtureReport.framesEncoded>0);
    assert.ok(report.video.width>0&&report.video.height>0);
    assert.equal(report.answer,true);
    assert.doesNotMatch(JSON.stringify(report),/sb_publishable_TEST_ONLY/);
    console.log('PASS: real Chromium video decoded and played; run',run+1,
      'frames',report.framesDecoded,'source',`${fixtureReport.sourceWidth}x${fixtureReport.sourceHeight}`,
      'encoded',`${fixtureReport.encodedWidth}x${fixtureReport.encodedHeight}`);
    await page.selectOption('#qualityPreset','720p30');
    await page.click('#applyQualityBtn');
    await page.waitForFunction(()=>document.getElementById('qualityState').textContent.includes('송신기 적용 확인: 720p30'),null,{timeout:10000});
    // A canvas capture track is not a ReplayKit capture track, and Chromium
    // does not guarantee that a resize is reflected as a new track size on
    // every platform.  The application-level acknowledgement is the stable
    // integration contract here; iPad output size is verified by its RTP stats.
    console.log('PASS: real data-channel quality request acknowledged');
    await page.click('#stopBtn');
  }
  await work;
  assert.deepEqual(errors,[]);
  await context.close();
} catch(error) {
  mkdirSync('build/browser-diagnostics',{recursive:true});
  const report={error:String(error),errors};
  if(page) {
    report.receiver=await page.evaluate(()=>typeof diagnostic==='function'?diagnostic():document.body.innerText).catch(String);
    await page.screenshot({path:'build/browser-diagnostics/receiver.png',fullPage:true}).catch(()=>{});
  }
  if(sender) report.sender=await sender.evaluate(async()=>({
    connection:window.peer?.connectionState,ice:window.peer?.iceConnectionState,
    signaling:window.peer?.signalingState,
    stats:window.peer?Array.from((await window.peer.getStats()).values()):[]
  })).catch(String);
  writeFileSync('build/browser-diagnostics/report.json',JSON.stringify(report,null,2));
  console.error(JSON.stringify(report,null,2));
  throw error;
} finally {
  if(browser) await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
