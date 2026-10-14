import{test}from'node:test';import assert from'node:assert/strict';
import{viewportGeometry,FrameCadence}from'../shared/viewing.mjs';
import{Media,safeMediaStats,diagnoseQuality,SenderMeter,CONNECTION_LIMITS}from'../shared/media.mjs';
test('viewport zooms out and clamps pan without modifying capture geometry',()=>{
 assert.deepEqual(viewportGeometry({scale:.2,x:400,y:300,width:1000,height:600}),{scale:.5,x:0,y:0});
 assert.deepEqual(viewportGeometry({scale:8,x:4000,y:-4000,width:1000,height:600}),{scale:4,x:1500,y:-900});
 assert.deepEqual(viewportGeometry({scale:1,x:400,y:300,width:1000,height:600}),{scale:1,x:0,y:0});
});
test('rolling one-percent-low includes presentation freezes and remains bounded',()=>{
 const c=new FrameCadence(300);for(let i=0;i<=300;i++)c.note(i*1000/60);const good=c.snapshot();assert(Math.abs(good.fpsLow1-60)<.01);
 c.note(5500);const poor=c.snapshot();assert(poor.fpsLow1<10);assert.equal(poor.frameGapCount,1);assert.equal(c.intervals.length,300);
 c.reset();assert.equal(c.snapshot().presentationMeasured,false);
});
test('sender measurements are per peer and distinguish encoding from network',()=>{
 const m=new SenderMeter(),report=(timestamp,frames,time,reason)=>new Map([['out',{timestamp,type:'outbound-rtp',kind:'video',framesEncoded:frames,totalEncodeTime:time,frameWidth:1920,frameHeight:1080,qualityLimitationReason:reason}]]);
 m.measure(report(1000,60,.6,'none'));const slow=m.measure(report(2000,90,1.8,'cpu'));assert.equal(slow.fps,30);assert(Math.abs(slow.encodeMilliseconds-40)<.01);
 const diagnosis=diagnoseQuality({frames:90,loss:0,rtt:20,jitter:2,decodeMilliseconds:3},slow);assert.equal(diagnosis.sender.state,'bad');assert.equal(diagnosis.receiver.state,'good');assert.equal(diagnosis.path.state,'good');
 const network=diagnoseQuality({frames:100,loss:8,rtt:400,jitter:2},null);assert.equal(network.sender.state,'unknown');assert.equal(network.path.state,'bad');assert.match(network.explanation,/확정할 수 없습니다/);
});
test('telemetry contains no credentials, arbitrary strings or nonfinite numbers',()=>{
 assert.deepEqual(safeMediaStats({token:'private',sdp:'private',password:'private',fps:NaN,width:-1,state:'Bearer private',codec:{value:'private'}}),{});
 assert.deepEqual(safeMediaStats({fps:60,frames:240,rtt:20,state:'connected'}),{fps:60,frames:240,rtt:20,state:'connected'});
});
test('receiving frames alone cannot claim unmeasured native playback is healthy',()=>{const result=diagnoseQuality({state:'connected',frames:200,qualityMeasured:false},null);assert.equal(result.receiver.state,'unknown');assert.equal(result.sender.state,'unknown');assert.equal(result.path.state,'unknown');});
function fixture(){const calls=[],bridge=new EventTarget();bridge.native=true;bridge.call=async(command,args)=>{calls.push({command,args});return command==='platform'?{platform:'android',canPublish:false}:true;};
 const api={session:{user:{id:'owner'}},rpc:async(action,args)=>{calls.push({action,args});return true;},signal:async()=>true};const media=new Media(api,bridge,{});clearInterval(media.timer);return{media,calls,api,bridge};}
test('repeated polling cannot postpone the last viewer disconnect deadline',()=>{const{media}=fixture();try{media.broadcast={id:'b',transport:'native',hadConnection:true};media.publisherDisconnected();const first=media.disconnectTimers.get('publisher:b');assert(first);for(let i=0;i<30;i++)media.publisherDisconnected();assert.equal(media.disconnectTimers.get('publisher:b'),first);media.nativePeers.set('other','connected');media.publisherDisconnected();assert(!media.disconnectTimers.has('publisher:b'));}finally{media.close();}});
test('a rejected informational heartbeat cannot leave a stale video error',async()=>{const{media,api}=fixture(),errors=[];media.addEventListener('error',e=>errors.push(e.detail));api.signal=async()=>{throw Error('Viewer consent and slot required');};try{const w={broadcast:{scope_kind:'channel',scope_id:'scope',publisher:'other'}};media.watching.set('v',w);media.sendHeartbeat('v',w,'current',{frames:30,fps:60});media.unwatch('v');await new Promise(r=>setTimeout(r,0));assert.equal(errors.length,0);assert.equal(media.watching.size,0);}finally{media.close();}});
test('Android start cannot create a broadcast even with a crafted command',async()=>{const{media,calls}=fixture();try{await assert.rejects(media.start({kind:'channel',id:'scope'}),/Android/);assert(!calls.some(c=>c.action==='broadcast_start'||c.command==='mediaStart'));}finally{media.close();}});
test('stale control contact preserves the recovery window then releases captures and receivers',async()=>{const{media,calls}=fixture();try{const b={id:'b',transport:'native'};media.broadcast=b;media.watching.set('v',{broadcast:{scope_kind:'channel',scope_id:'scope',publisher:'other'}});media.lastServerContact=Date.now()-21000;media.connectionGuard();assert.equal(media.broadcast,b);assert.equal(media.watching.size,1);assert(!calls.some(c=>c.command==='mediaStop'));media.lastServerContact=Date.now()-CONNECTION_LIMITS.controlTimeout-1;media.connectionGuard();assert.equal(media.broadcast,null);assert.equal(media.watching.size,0);await media.publisherCleanup;assert(calls.some(c=>c.command==='mediaStop'));}finally{media.close();}});
test('canceling an in-flight watch does not resurrect a receiver',async()=>{const{media,api}=fixture();let release,started;const pending=new Promise(r=>release=r),ready=new Promise(r=>started=r);api.rpc=async action=>{if(action==='broadcast_watch'){started();await pending;}return true;};try{const watching=media.watch({id:'v',publisher:'other',transport:'native',scope_kind:'channel',scope_id:'scope'});await ready;await media.unwatch('v');release();await watching;assert.equal(media.watching.size,0);}finally{media.close();}});
test('failed native receivers request recovery; explicit close cleans up and stale sender stats stay rejected',async()=>{const{media,api}=fixture(),signals=[];api.signal=async(...args)=>signals.push(args);try{media.watching.set('v',{broadcast:{id:'v',publisher:'other',transport:'native',scope_kind:'channel',scope_id:'scope'},started:Date.now(),lastFrame:Date.now(),retries:0});media.nativeReceivers.set('v',{connectionID:'current'});
 await media.handle({sender:'other',scope_kind:'channel',scope_id:'scope',payload:{type:'media-sender-stats',broadcast:'v',connectionID:'old',stats:{fps:60}}});assert.equal(media.senderStats.size,0);
 await media.nativeEvent({type:'media-receiver-stats',id:'v',connectionID:'current',stats:{state:'failed'}});await media.watching.get('v').recoveryPending;
 assert.equal(media.watching.size,1);assert.equal(media.nativeReceivers.get('v').connectionID,'current');assert.equal(media.reconnects,1);assert(signals.some(([,recipient,payload])=>recipient==='other'&&payload.type==='media-recover'&&payload.connectionID==='current'));
 await media.nativeEvent({type:'media-receiver-stats',id:'v',connectionID:'old',stats:{state:'closed'}});assert.equal(media.watching.size,1);
 await media.nativeEvent({type:'media-receiver-stats',id:'v',connectionID:'current',stats:{state:'closed'}});assert.equal(media.watching.size,0);assert.equal(media.nativeReceivers.size,0);}finally{media.close();}});
