// Real browser video/ICE/decoder integration against an isolated mock signal server.
// The sender is a canvas WebRTC peer, NOT ReplayKit. No real credentials are used.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
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
let browser;
try {
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext();
  const page=await context.newPage();
  const sender=await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  let inbox=[],sequence=0;
  await page.route('https://test.supabase.co/rest/v1/solaris_signals**',async route=>{
    const request=route.request(),url=new URL(request.url());
    const headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS',
      'access-control-allow-headers':'apikey,content-type,prefer'};
    if(request.method()==='OPTIONS') { await route.fulfill({status:204,headers,body:''});return; }
    if(request.method()==='POST') {
      const row=request.postDataJSON();
      if(row.kind==='offer') {
        const results=await sender.evaluate(async envelope=>{
          if(window.peer) window.peer.close();
          if(window.drawTimer) clearInterval(window.drawTimer);
          const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
          document.body.append(canvas);
          const ctx=canvas.getContext('2d');let frame=0;
          window.drawTimer=setInterval(()=>{
            ctx.fillStyle=++frame%2?'#187dd1':'#139878';ctx.fillRect(0,0,640,360);
            ctx.fillStyle='white';ctx.font='32px sans-serif';ctx.fillText('Solaris test '+frame,40,180);
          },66);
          window.stream=canvas.captureStream(15);
          const peer=new RTCPeerConnection({iceServers:[]});window.peer=peer;
          peer.addTrack(window.stream.getVideoTracks()[0],window.stream);
          peer.ondatachannel=e=>{
            const dc=e.channel;
            dc.onopen=()=>dc.send(JSON.stringify({version:'0.3.1',sessionID:envelope.sessionID,
              state:'synthetic sender',framesSubmitted:1,lastError:''}));
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
      await route.fulfill({status:201,headers,body:''});
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
    await page.click('#startBtn');
    await page.waitForFunction(()=>document.getElementById('summary').textContent.includes('화면 수신 확인'),null,{timeout:30000});
    const report=await page.evaluate(()=>JSON.parse(diagnostic()));
    assert.ok(report.framesDecoded>0);
    assert.equal(report.video.width,640);
    assert.equal(report.answer,true);
    assert.doesNotMatch(JSON.stringify(report),/sb_publishable_TEST_ONLY/);
    console.log('PASS: real Chromium video decoded and played; run',run+1,'frames',report.framesDecoded);
    await page.click('#stopBtn');
  }
  assert.deepEqual(errors,[]);
  await context.close();
} finally {
  if(browser) await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
