// Real Chromium WebRTC, real PostgreSQL ACLs, and bounded filesystem I/O.
// Supabase HTTP is replaced with the same migration running in PGlite.
// This proves automated interoperability, never native-device capture/FPS.
import{chromium}from'playwright';import{PGlite}from'@electric-sql/pglite';import{createServer}from'node:http';import{readFile,mkdir,open,stat}from'node:fs/promises';import{createHash,randomUUID}from'node:crypto';import{networkInterfaces,cpus,freemem,totalmem}from'node:os';import{monitorEventLoopDelay}from'node:perf_hooks';import{join,extname}from'node:path';import assert from'node:assert/strict';
const root=process.cwd(),out=join(root,'build/unified-evidence');await mkdir(out,{recursive:true});
try{networkInterfaces();}catch(error){const{writeFile}=await import('node:fs/promises');await writeFile(join(out,'results.json'),JSON.stringify({success:false,blocked:true,error:'Network interface discovery denied; real WebRTC ICE cannot be verified in this environment.',detail:error.message},null,2));console.error('BLOCKED: network interface discovery denied; real WebRTC verification is pending.');process.exit(1);}
const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz default now(),is_anonymous boolean not null default false,raw_user_meta_data jsonb default '{}');create table auth.identities(user_id uuid references auth.users(id) on delete cascade,provider text,primary key(user_id,provider));create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`);for(const file of['001_solaris.sql','003_build60_dm.sql','004_build61_accounts_broadcast.sql','005_build65_accounts_presence_invites.sql','006_build66_google_only.sql','007_build67_sharing_resilience.sql'])await db.exec(await readFile('backend/'+file,'utf8'));
let serial=Promise.resolve(),queuedRPCs=0;const rpcStats=new Map(),slowRPCs=[],routeFailures=[];
function rpc(uid,action,args={}){
 const queuedAt=Date.now(),depth=++queuedRPCs;let startedAt;
 const run=serial.then(async()=>{
  startedAt=Date.now();
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[uid,JSON.stringify({sub:uid,session_id:uid,role:'authenticated',amr:[{method:'oauth',timestamp:Math.floor(Date.now()/1000)}]})]);
  return(await db.query('select public.solaris_action($1,$2::jsonb) result',[action,JSON.stringify(args)])).rows[0].result;
 });
 // PGlite uses a shared JWT setting; keep requests serialized and measure the queue.
 serial=run.catch(()=>{});
 const record=error=>{
  queuedRPCs--;const elapsed=Date.now()-queuedAt,queue=(startedAt??Date.now())-queuedAt,execution=elapsed-queue;
  const stats=rpcStats.get(action)??{action,count:0,errors:0,totalMs:0,maxMs:0,maxQueueMs:0,maxExecutionMs:0,maxQueueDepth:0};
  stats.count++;stats.errors+=!!error;stats.totalMs+=elapsed;stats.maxMs=Math.max(stats.maxMs,elapsed);stats.maxQueueMs=Math.max(stats.maxQueueMs,queue);stats.maxExecutionMs=Math.max(stats.maxExecutionMs,execution);stats.maxQueueDepth=Math.max(stats.maxQueueDepth,depth);rpcStats.set(action,stats);
  if(error||elapsed>1000){slowRPCs.push({at:Date.now(),action,elapsedMs:elapsed,queueMs:queue,executionMs:execution,queueDepth:depth,...(action==='signal'?{signalType:args.payload?.type,peer:args.payload?.peer,description:args.payload?.description?.type,candidate:!!args.payload?.candidate}:{}),...(error?{error:error.message}:{})});if(slowRPCs.length>200)slowRPCs.shift();}
 };
 return run.then(value=>{record();return value;},error=>{record(error);throw error;});
}
const users=Array.from({length:6},()=>randomUUID());for(const[ i,uid]of users.entries()){await db.query('insert into auth.users(id) values($1)',[uid]);await db.query("insert into auth.identities(user_id,provider) values($1,'google')",[uid]);await db.query('insert into auth.sessions(id,user_id) values($1,$1)',[uid]);await rpc(uid,'profile',{user_id:'tester'+i,nickname:'참여자 '+i});}
await rpc(users[0],'friend_request',{target:users[1]});await rpc(users[1],'friend_accept',{target:users[0]});
const serverID=(await rpc(users[0],'server_create',{name:'통합 검증'})).id,inv=(await rpc(users[0],'sync')).servers[0].invite;for(const uid of users.slice(1))await rpc(uid,'server_join',{invite:inv});const channel=(await rpc(users[0],'sync')).channels[0].id;for(const uid of users)await rpc(uid,'channel_enter',{id:channel});
const http=createServer(async(req,res)=>{try{let path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(path==='/fixture.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><h1>Solaris WebRTC integration fixture</h1></body></html>');return;}if(!path.startsWith('/shared/')||path.includes('..')){res.writeHead(404).end();return;}const bytes=await readFile(join(root,path));res.setHeader('Content-Type',extname(path)==='.mjs'?'text/javascript':extname(path)==='.css'?'text/css':'text/html');res.end(bytes);}catch{res.writeHead(404).end();}});await new Promise(r=>http.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+http.address().port;
let browser;const contexts=[],pages=[],errors=[],evidence={},diskStats=[],routeTiming=[],routeStats={count:0,maxPreRouteMs:0,maxDatabaseMs:0,maxFulfillMs:0};
const hostCPU=cpus(),eventLoop=monitorEventLoopDelay({resolution:50});eventLoop.enable();
evidence.syntheticSource={width:640,height:360,requestedFPS:60,content:'static background with live moving marker and frame counter',lazyPublisherOnly:true};
evidence.host={cpu:hostCPU[0]?.model,logicalProcessors:hostCPU.length,totalMemory:totalmem(),samples:[]};
let lastCPU=hostCPU,lastUsage=process.cpuUsage(),lastSample=Date.now();
const sampleHost=()=>{
 const now=Date.now(),current=cpus(),usage=process.cpuUsage(),elapsed=now-lastSample;let total=0,idle=0;
 for(let i=0;i<current.length;i++)for(const key of Object.keys(current[i].times)){const delta=current[i].times[key]-(lastCPU[i]?.times[key]??current[i].times[key]);total+=delta;if(key==='idle')idle+=delta;}
 evidence.host.samples.push({at:now,elapsedMs:elapsed,cpuBusyPercent:total?100*(total-idle)/total:0,nodeCPUPercent:elapsed?((usage.user-lastUsage.user)+(usage.system-lastUsage.system))/(elapsed*10):0,freeMemory:freemem(),nodeRSS:process.memoryUsage().rss});if(evidence.host.samples.length>120)evidence.host.samples.shift();lastCPU=current;lastUsage=usage;lastSample=now;
};
const hostTimer=setInterval(sampleHost,2000);
async function sharingLaneAndLeaseRegression(broadcast){
 const publisher=pages[0],viewer=pages[1],started=Date.now();
 await publisher.evaluate(({broadcast,heldViewer,otherViewer})=>{
  const original=engine.handle.bind(engine),originalSignal=api.signal.bind(api);let release,releaseStats;const gate=new Promise(resolve=>release=resolve),statsGate=new Promise(resolve=>releaseStats=resolve),heldStats=new Set();
  window.laneProbe={held:false,released:false,statsReleased:false,heldSenderStats:0,otherHeartbeats:0,beforePolls:syncStats.runs};
  // Artificially aging consent below is not an authorization-negative test.
  // Hold only publisher telemetry destined for that viewer until its consent
  // renews, then deliver every held message through the unchanged real RPC.
  api.signal=(scope,recipient,payload)=>{
   if(recipient!==heldViewer||payload.type!=='media-sender-stats'||payload.broadcast!==broadcast||laneProbe.statsReleased)return originalSignal(scope,recipient,payload);
   laneProbe.heldSenderStats++;const task=statsGate.then(()=>originalSignal(scope,recipient,payload));heldStats.add(task);task.then(()=>heldStats.delete(task),()=>heldStats.delete(task));return task;
  };
  window.releaseSenderStatsProbe=async()=>{laneProbe.statsReleased=true;api.signal=originalSignal;releaseStats();await Promise.allSettled([...heldStats]);};
  engine.handle=async signal=>{
   if(signal.payload.type==='media-heartbeat'&&signal.payload.broadcast===broadcast){
    if(signal.sender===heldViewer&&!laneProbe.released){laneProbe.held=true;await gate;}
    if(signal.sender===otherViewer)laneProbe.otherHeartbeats++;
   }
   return original(signal);
  };
  window.releaseLaneProbe=()=>{laneProbe.released=true;release();engine.handle=original;};
 },{broadcast:broadcast.id,heldViewer:users[1],otherViewer:users[2]});
 try{
  await viewer.evaluate(async id=>{const p=[...engine.peers.values()].find(p=>p.broadcast===id&&!p.sending);await api.signal(p.scope,p.remote,{type:'media-heartbeat',broadcast:id,connectionID:p.remoteEpoch,framesDecoded:1});},broadcast.id);
  await publisher.waitForFunction(()=>laneProbe.held,null,{timeout:20000});
  const before=await viewer.evaluate(async id=>{
   clearInterval(interval);await sync(true);const p=[...engine.peers.values()].find(p=>p.broadcast===id&&!p.sending),original=p.pc.getStats.bind(p.pc);
   let release;const gate=new Promise(resolve=>release=resolve);window.statsProbe={blocked:false,leaseAged:false,beforeSyncRuns:syncStats.runs,postBlockHeartbeatRequests:0,postBlockHeartbeatAcks:0};
   const originalSignal=api.signal.bind(api);api.signal=async(scope,recipient,payload)=>{
    const probed=payload.type==='media-heartbeat'&&payload.broadcast===id&&statsProbe.blocked&&statsProbe.leaseAged;
    if(probed)statsProbe.postBlockHeartbeatRequests++;const result=await originalSignal(scope,recipient,payload);if(probed)statsProbe.postBlockHeartbeatAcks++;return result;
   };
   p.pc.getStats=()=>{statsProbe.blocked=true;return gate;};window.pendingStatsProbe=engine.tick();
   window.releaseStatsProbe=async()=>{api.signal=originalSignal;p.pc.getStats=original;release(await original());await pendingStatsProbe;window.interval=setInterval(()=>sync(),350);};
   return{epoch:p.epoch,frames:tracks.get(id).getVideoPlaybackQuality().totalVideoFrames};
  },broadcast.id);
  await viewer.waitForFunction(()=>statsProbe.blocked,null,{timeout:20000});
  // An existing consent row can be stale while real RTP still flows. With sync
  // paused and getStats held, only the independent viewer heartbeat can renew it.
  await db.query("update solaris_private.viewers set last_seen=now()-interval '46 seconds' where broadcast_id=$1 and uid=$2",[broadcast.id,users[1]]);
  const aged=(await db.query('select last_seen from solaris_private.viewers where broadcast_id=$1 and uid=$2',[broadcast.id,users[1]])).rows[0].last_seen;
  await viewer.evaluate(()=>statsProbe.leaseAged=true);
  const deadline=Date.now()+20000;let lease;
  while(Date.now()<deadline){
   lease=(await db.query('select last_seen,extract(epoch from now()-last_seen)::double precision age from solaris_private.viewers where broadcast_id=$1 and uid=$2',[broadcast.id,users[1]])).rows[0];
   if(lease&&new Date(lease.last_seen)>new Date(aged)&&await viewer.evaluate(()=>statsProbe.postBlockHeartbeatAcks>0))break;await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert(lease&&new Date(lease.last_seen)>new Date(aged),'A blocked getStats call and paused sync must not prevent the viewer heartbeat renewing SQL consent');
  await publisher.evaluate(()=>releaseSenderStatsProbe());
  await publisher.waitForFunction(()=>laneProbe.otherHeartbeats>0&&syncStats.runs>laneProbe.beforePolls+2,null,{timeout:20000});
  const after=await viewer.evaluate(id=>{const p=[...engine.peers.values()].find(p=>p.broadcast===id&&!p.sending);return{epoch:p?.epoch,state:p?.pc.connectionState,watching:engine.watching.has(id),frames:tracks.get(id).getVideoPlaybackQuality().totalVideoFrames,syncRuns:syncStats.runs,beforeSyncRuns:statsProbe.beforeSyncRuns,statsStillBlocked:engine.ticking,postBlockHeartbeatRequests:statsProbe.postBlockHeartbeatRequests,postBlockHeartbeatAcks:statsProbe.postBlockHeartbeatAcks};},broadcast.id);
  assert.equal(after.epoch,before.epoch);assert.equal(after.state,'connected');assert.equal(after.watching,true);assert(after.frames>before.frames,'Real decoded video must continue while telemetry is blocked');assert.equal(after.syncRuns,after.beforeSyncRuns);assert.equal(after.statsStillBlocked,true);
  assert(after.postBlockHeartbeatRequests>=1&&after.postBlockHeartbeatAcks>=1,'A heartbeat must be issued and acknowledged after both getStats blocks and the SQL consent row is aged');
  const lane=await publisher.evaluate(()=>({...laneProbe,afterPolls:syncStats.runs,queue:signalQueue.snapshot(),broadcastActive:!!engine.broadcast}));
  assert.equal(lane.held,true);assert.equal(lane.released,false);assert(lane.otherHeartbeats>0);assert(lane.afterPolls>lane.beforePolls+2);assert(lane.queue.pending>0);assert.equal(lane.broadcastActive,true);
  const publisherLease=(await db.query('select extract(epoch from now()-last_seen)::double precision age from solaris_private.broadcasts where id=$1',[broadcast.id])).rows[0];assert(publisherLease?.age<10,'The publisher lease must renew while its slow incoming peer lane is held');
  assert.equal((await db.query('select count(*)::int count from solaris_private.viewers where broadcast_id=$1',[broadcast.id])).rows[0].count,5);
  return{passed:true,elapsedMs:Date.now()-started,slowPeerLaneHeld:true,siblingHeartbeatDispatched:true,syncContinued:true,statsBlocked:true,viewerSyncPaused:true,staleViewerConsentRenewed:true,publisherLeaseFresh:true,sameEpoch:true,postBlockHeartbeat:true,postBlockHeartbeatRequests:after.postBlockHeartbeatRequests,postBlockHeartbeatAcks:after.postBlockHeartbeatAcks,decodedFrames:after.frames-before.frames,slots:5};
 }finally{
  await publisher.evaluate(async()=>{window.releaseLaneProbe?.();await window.releaseSenderStatsProbe?.();});await viewer.evaluate(async()=>{await window.releaseStatsProbe?.();});
 }
}
try{
 browser=await chromium.launch({headless:true,...(process.env.SOLARIS_BROWSER_EXECUTABLE?{executablePath:process.env.SOLARIS_BROWSER_EXECUTABLE}:{}),args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--autoplay-policy=no-user-gesture-required','--disable-features=WebRtcHideLocalIpsWithMdns']});
 for(const uid of users){const ctx=await browser.newContext();contexts.push(ctx);await ctx.route('https://*.supabase.co/**',async route=>{
  const received=Date.now();let action;
  try{
   const req=route.request();action=req.postDataJSON();const result=await rpc(req.headers().authorization?.slice(7)??uid,action.action,action.args),databaseDone=Date.now();
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result),headers:{'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'X-Fixture-Received-At, X-Fixture-Database-Done-At','X-Fixture-Received-At':String(received),'X-Fixture-Database-Done-At':String(databaseDone)}});
   const timing={at:received,action:action.action,preRouteMs:action.fixtureStartedAt?received-action.fixtureStartedAt:0,databaseMs:databaseDone-received,fulfillMs:Date.now()-databaseDone};routeStats.count++;routeStats.maxPreRouteMs=Math.max(routeStats.maxPreRouteMs,timing.preRouteMs);routeStats.maxDatabaseMs=Math.max(routeStats.maxDatabaseMs,timing.databaseMs);routeStats.maxFulfillMs=Math.max(routeStats.maxFulfillMs,timing.fulfillMs);if(timing.preRouteMs>1000||timing.databaseMs>1000||timing.fulfillMs>1000){routeTiming.push(timing);if(routeTiming.length>200)routeTiming.shift();}
  }catch(e){routeFailures.push({at:Date.now(),action:action?.action,error:e.message});if(routeFailures.length>100)routeFailures.shift();await route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({message:e.message})}).catch(()=>{});}
 });const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/fixture.html');await p.evaluate(async({uid})=>{
  const{Media}=await import('/shared/media.mjs'),{API}=await import('/shared/api.mjs'),{Ledger}=await import('/shared/platform.mjs'),{SignalQueue}=await import('/shared/signal-queue.mjs');const bridge=new EventTarget();bridge.native=false;window.api=new API({url:'https://fixture.supabase.co',key:'sb_publishable_fixture'},bridge,new Ledger());api.session={user:{id:uid,is_anonymous:false,email_confirmed_at:new Date().toISOString(),identities:[{provider:'google',id:uid}],app_metadata:{provider:'google',providers:['google']}},access_token:uid,expires_at:Date.now()/1000+3600};window.engine=new Media(api,bridge,{maxReceive:5,iceServers:[]});window.errors=[];engine.addEventListener('error',e=>errors.push(e.detail.message));window.tracks=new Map();engine.addEventListener('track',e=>{const v=document.createElement('video');v.autoplay=true;v.muted=true;v.srcObject=e.detail.stream;v.dataset.broadcast=e.detail.id;document.body.append(v);v.play();tracks.set(e.detail.id,v);});
  // A moving screen marker proves live frames without repainting six unused
  // full screens. Preserve 640x360 captureStream(60) and the real media policy.
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;document.body.append(canvas);const c=canvas.getContext('2d');c.fillStyle='#24334a';c.fillRect(0,0,640,360);c.fillStyle='white';c.fillText('Solaris live screen',30,40);window.captureFrames=0;
  navigator.mediaDevices.getDisplayMedia=async()=>{window.drawTimer??=setInterval(()=>{c.fillStyle='#24334a';c.fillRect(0,65,640,90);c.fillStyle='#53b96e';c.fillRect((captureFrames*5)%600,70,40,40);c.fillStyle='white';c.fillText('Frame '+captureFrames++,30,140);},1000/60);return canvas.captureStream(60);};
  window.cursor=0;window.syncPromise=null;window.signalFailures=[];window.syncStats={runs:0,errors:0,signals:0,recoveryRuns:0,lastDurationMs:0,maxDurationMs:0};
  window.remember=(list,value)=>{list.push(value);if(list.length>200)list.shift();};
  window.requestTiming=[];window.browserTiming={heartbeats:0,maxTimerLagMs:0};let heartbeatAt=Date.now();setInterval(()=>{const now=Date.now();browserTiming.heartbeats++;browserTiming.maxTimerLagMs=Math.max(browserTiming.maxTimerLagMs,now-heartbeatAt-1000);heartbeatAt=now;},1000);
  const fetchOriginal=window.fetch.bind(window);window.fetch=async(input,options)=>{
   if(!String(input).endsWith('/rest/v1/rpc/solaris_action'))return fetchOriginal(input,options);
   const started=Date.now(),body=JSON.parse(options.body);body.fixtureStartedAt=started;
   try{const result=await fetchOriginal(input,{...options,body:JSON.stringify(body)}),received=Number(result.headers.get('X-Fixture-Received-At')),databaseDone=Number(result.headers.get('X-Fixture-Database-Done-At'));const timing={at:started,action:body.action,elapsedMs:Date.now()-started,status:result.status,...(received?{preRouteMs:received-started,databaseMs:databaseDone-received,postDatabaseMs:Date.now()-databaseDone}:{})};if(timing.elapsedMs>1000)remember(requestTiming,timing);return result;}
   catch(e){remember(requestTiming,{at:started,action:body.action,elapsedMs:Date.now()-started,error:e.message});throw e;}
  };
  window.peerState=p=>({id:p.id,state:p.pc.connectionState,ice:p.pc.iceConnectionState,gathering:p.pc.iceGatheringState,signal:p.pc.signalingState,local:p.pc.localDescription?.type,remote:p.pc.remoteDescription?.type,queued:p.ice.length,closed:p.closed,epoch:p.epoch,remoteEpoch:p.remoteEpoch,makingOffer:p.makingOffer,ignoreOffer:p.ignoreOffer});
  window.peerDiagnostics=async p=>{const result=peerState(p);try{const stats=await p.pc.getStats();let pair;stats.forEach(s=>{if(s.type==='candidate-pair'&&s.state==='succeeded'&&s.nominated)pair=s;});if(pair){const local=stats.get(pair.localCandidateId),remote=stats.get(pair.remoteCandidateId),localAddress=local?.address??local?.ip,remoteAddress=remote?.address??remote?.ip;result.path={localType:local?.candidateType,remoteType:remote?.candidateType,protocol:local?.protocol,sameAddress:!!localAddress&&localAddress===remoteAddress,localLoopback:/^(127\.|::1$)/.test(localAddress??''),remoteLoopback:/^(127\.|::1$)/.test(remoteAddress??''),rttMs:(pair.currentRoundTripTime??0)*1000};}}catch(e){result.statsError=e.message;}return result;};
  // Use the production queue: accepting a peer's signal advances its cursor,
  // while processing that lane may continue independently of polling.
  window.signalQueue=new SignalQueue({isCurrent:()=>!engine.closed,dispatch:async v=>{
   try{if(window.transfer&&(v.payload.type.startsWith('file-')||v.payload.peer?.startsWith('files:')))await transfer.handle(v);else await engine.handle(v);}
   catch(e){remember(signalFailures,{at:Date.now(),id:v.id,type:v.payload.type,peer:v.payload.peer,description:v.payload.description?.type,candidate:!!v.payload.candidate,error:e.message});throw e;}
  },onError:e=>errors.push(e.message)});
  window.pollOnce=async()=>{
   const started=Date.now();syncStats.runs++;
   try{
    const s=await api.rpc('sync',{cursor});window.snapshot=s;
    // Match app.mjs: per-peer work cannot block sync or another peer's lane.
    for(const v of s.signals??[]){
     if(!signalQueue.enqueue(v))break;cursor=Math.max(cursor,v.id);syncStats.signals++;
    }
    await engine.update(s);
    if(window.transfer){await transfer.reconcile(s);if(Date.now()-(transfer.lastRecovery??0)>5000){transfer.lastRecovery=Date.now();syncStats.recoveryRuns++;await transfer.reconnect();}}
   }catch(e){syncStats.errors++;errors.push(e.message);}
   finally{syncStats.lastDurationMs=Date.now()-started;syncStats.maxDurationMs=Math.max(syncStats.maxDurationMs,syncStats.lastDurationMs);}
  };
  window.sync=async(fresh=false)=>{
   if(syncPromise){await syncPromise;if(fresh)return sync();return;}
   const task=pollOnce();window.syncPromise=task;try{await task;}finally{if(syncPromise===task)window.syncPromise=null;}
  };
  window.fixtureState=async()=>({errors,cursor,syncStats,signalFailures,signalQueue:signalQueue.snapshot(),browserTiming,requestTiming,captureFrames,own:engine.broadcast,seen:snapshot?.broadcasts,watching:[...engine.watching.keys()],peers:await Promise.all([...engine.peers.values()].map(peerDiagnostics)),metrics:[...engine.meters.entries()].map(([id,m])=>({id,last:m.last,smoothed:m.smoothed})),transfer:window.transferState?.()});
  window.interval=setInterval(()=>sync(),350);await sync();
 },{uid});pages.push(p);}
 const broadcast=await pages[0].evaluate(async channel=>await engine.start({kind:'channel',id:channel},'auto'),channel);
 for(const p of pages.slice(1))await p.evaluate(async id=>{await sync(true);await engine.watch(snapshot.broadcasts.find(b=>b.id===id));},broadcast.id);
 for(const p of pages.slice(1))await p.waitForFunction(id=>tracks.get(id)?.readyState>=2&&[...engine.meters.values()].some(m=>m.last?.frames>=30),broadcast.id,{timeout:45000});
 evidence.fiveViewers=await Promise.all(pages.slice(1).map(p=>p.evaluate(()=>[...engine.meters.values()].map(m=>m.smoothed))));console.log('PASS: one browser broadcast decoded by five independent browser peers');
 evidence.sharingResilience=await sharingLaneAndLeaseRegression(broadcast);console.log('PASS: independent signal lanes and heartbeat preserve live RTP and existing viewer consent while stats/sync are held');
 const reverse=await pages[1].evaluate(async channel=>await engine.start({kind:'channel',id:channel},'latency'),channel);await pages[0].evaluate(async id=>{await sync(true);await engine.watch(snapshot.broadcasts.find(b=>b.id===id));},reverse.id);await pages[0].waitForFunction(id=>tracks.get(id)?.readyState>=2&&[...engine.meters.values()].some(m=>m.last?.frames>=20),reverse.id,{timeout:30000});evidence.bidirectional=true;console.log('PASS: concurrent reverse broadcast while retaining five original viewers');
 // One peer re-enters; the other four must keep their connections and decoding.
 const before=await pages[3].evaluate(()=>[...engine.peers.values()].map(p=>({id:p.id,frames:engine.meters.get(p.id)?.last?.frames??0,epoch:p.epoch})));
 await pages[2].evaluate(async id=>{await engine.unwatch(id);await engine.watch(snapshot.broadcasts.find(b=>b.id===id));},broadcast.id);await pages[2].waitForFunction(id=>[...engine.peers.values()].some(p=>p.broadcast===id&&p.pc.connectionState==='connected'),broadcast.id,{timeout:30000});const after=await pages[3].evaluate(()=>[...engine.peers.values()].map(p=>({id:p.id,frames:engine.meters.get(p.id)?.last?.frames??0,epoch:p.epoch})));if(after[0]?.epoch!==before[0]?.epoch||after[0].frames<before[0].frames)throw new Error('Unrelated viewer changed during recovery');evidence.isolatedReentry=true;console.log('PASS: re-entry does not replace unrelated viewers');
 const size=8*1024*1024+123,sourcePath=join(out,'source.bin'),targetPath=join(out,'received.bin');const source=await open(sourcePath,'w+');await source.truncate(size);const pattern=Buffer.alloc(65536);for(let i=0;i<pattern.length;i++)pattern[i]=i%251;for(let offset=0;offset<size;offset+=65536)await source.write(pattern,0,Math.min(pattern.length,size-offset),offset);const sink=await open(targetPath,'w+');let sourceHash=createHash('sha256');for(let o=0;o<size;o+=65536){const b=Buffer.alloc(Math.min(65536,size-o));await source.read(b,0,b.length,o);sourceHash.update(b);}const expected=sourceHash.digest('hex');
 for(const[i,p]of pages.slice(0,2).entries()){
  const commands={};diskStats.push({role:i?'receiver':'sender',commands});
  await p.exposeFunction('nativeDisk',async(cmd,a)=>{
   const started=Date.now(),stats=commands[cmd]??={count:0,errors:0,totalMs:0,maxMs:0,bytes:0};stats.count++;
   try{
    if(cmd==='readFile'){const b=Buffer.alloc(a.length),{bytesRead}=await source.read(b,0,b.length,a.offset);stats.bytes+=bytesRead;return{data:b.subarray(0,bytesRead).toString('base64')};}
    if(cmd==='createReceiver'){await sink.truncate(0);return{id:a.id,name:a.name};}
    if(cmd==='writeFile'){const b=Buffer.from(a.data,'base64');await sink.write(b,0,b.length,a.offset);stats.bytes+=b.length;return true;}
    if(cmd==='finishFile'){if((await sink.stat()).size!==a.size)throw new Error('Disk length mismatch');return{id:a.id};}
    if(cmd==='hashFile'){const handle=i?sink:source,hash=createHash('sha256');for(let o=0;o<size;o+=65536){const b=Buffer.alloc(Math.min(65536,size-o));await handle.read(b,0,b.length,o);hash.update(b);}return{sha256:hash.digest('hex')};}
    if(cmd==='fileInfo')return{size:i?(await sink.stat()).size:size};
    if(cmd==='discardFile')return true;
    throw new Error('Unexpected disk command '+cmd);
   }catch(e){stats.errors++;stats.lastError=e.message;throw e;}
   finally{const elapsed=Date.now()-started;stats.totalMs+=elapsed;stats.maxMs=Math.max(stats.maxMs,elapsed);}
  });
  await p.evaluate(async()=>{
   const{DiskFiles,Ledger}=await import('/shared/platform.mjs'),{Transfers}=await import('/shared/files.mjs');const disk=new DiskFiles({native:true,call:(c,a)=>nativeDisk(c,a)});
   window.transfer=new Transfers(api,disk,new Ledger('transfer-test'),[],()=>!!engine.broadcast||engine.watching.size>0);await transfer.init();window.transferEvents=[];const reported=new Map();
   window.transferRecord=r=>({id:r.id,direction:r.direction,state:r.state,offset:r.offset,size:r.size,approved:r.approved,error:r.error,pauseReason:r.pauseReason,pauseOwner:r.pauseOwner,retryable:r.retryable,attempt:r.attempt,lastAnnounced:r.lastAnnounced,hash:r.hash,sourceHash:r.sourceHash,checkpointBytes:r.hashState?.bytes,generation:transfer.generations.get(r.id),ackHandler:typeof r.onAck==='function'});
   window.transferState=()=>({closed:transfer.closed,suspended:transfer.suspended,records:[...transfer.records.values()].map(transferRecord),peers:[...transfer.peers.values()].map(peerState),channels:[...transfer.channels.entries()].map(([id,c])=>({id,label:c.label,state:c.readyState,buffered:c.bufferedAmount,ordered:c.ordered})),receiveQueues:transfer.receiveQueues.size,commits:transfer.commits.size,recentEvents:transferEvents});
   transfer.addEventListener('change',e=>{const r=transferRecord(e.detail),last=reported.get(r.id);if(!last||r.state!==last.state||r.pauseReason!==last.pauseReason||r.error!==last.error||r.offset-last.offset>=512*1024){remember(transferEvents,{at:Date.now(),kind:'change',...r});reported.set(r.id,r);}});
   transfer.addEventListener('offer',e=>transfer.accept(e.detail.id).catch(e=>{errors.push(e.message);remember(transferEvents,{at:Date.now(),kind:'accept-error',error:e.message});}));
   transfer.addEventListener('error',e=>{errors.push(e.detail.message);remember(transferEvents,{at:Date.now(),kind:'peer-error',error:e.detail.message});});
  });
 }
 const transferID=await pages[0].evaluate(async({peer,size})=>(await transfer.offer(peer,{kind:'friend',id:peer},{id:'source',name:'original-video.bin',size,modified:0})).id,{peer:users[1],size});
 const deadline=Date.now()+120000;let paused=false,lastPrinted=0;
 while(Date.now()<deadline){const r=await pages[1].evaluate(id=>{const r=transfer.records.get(id);return r?transferRecord(r):null;},transferID);if(r?.state==='failed')throw new Error('Receiver failed: '+r.error);if(r?.state==='complete')break;if(!paused&&r?.offset>Math.min(size/3,1024*1024)){await pages[1].evaluate(id=>transfer.pause(id),transferID);await pages[1].evaluate(id=>transfer.resume(id),transferID);paused=true;evidence.pauseResume=true;}if(r&&Date.now()-lastPrinted>15000){lastPrinted=Date.now();const sender=await pages[0].evaluate(id=>{const r=transfer.records.get(id);return r?transferRecord(r):null;},transferID);console.log('File transfer',Math.round(r.offset/size*100)+'%',JSON.stringify({receiver:r,sender}));}await new Promise(r=>setTimeout(r,500));}
 evidence.transfers=await Promise.all(pages.slice(0,2).map(p=>p.evaluate(()=>transferState())));
 const receiver=evidence.transfers[1].records.find(r=>r.id===transferID);if(receiver?.state!=='complete'||receiver.hash!==expected)throw new Error('Transfer did not finish with source SHA-256: '+JSON.stringify({state:receiver?.state,offset:receiver?.offset,error:receiver?.error,pauseReason:receiver?.pauseReason}));if(!paused)throw new Error('File completed without exercising pause/resume');const actualHash=createHash('sha256');for(let o=0;o<size;o+=65536){const b=Buffer.alloc(Math.min(65536,size-o));await sink.read(b,0,b.length,o);actualHash.update(b);}if(actualHash.digest('hex')!==expected)throw new Error('Final disk hash mismatch');await source.close();await sink.close();evidence.file={size,sha256:expected,resume:paused,originalBytes:true};console.log('PASS: real DataChannel original-file transfer, pause/resume and disk SHA-256',size);
 evidence.browserErrors=errors;evidence.engineErrors=await Promise.all(pages.map(p=>p.evaluate(()=>errors)));evidence.states=await Promise.all(pages.map(p=>p.evaluate(()=>fixtureState())));evidence.success=true;await pages[0].screenshot({path:join(out,'fixture.png')});
}catch(e){evidence.success=false;evidence.error=e.message;evidence.browserErrors=errors;evidence.states=await Promise.all(pages.map(p=>p.evaluate(()=>fixtureState()).catch(e=>({error:e.message}))));console.error('FAIL:',e.message);console.log(JSON.stringify(evidence.states));process.exitCode=1;}finally{clearInterval(hostTimer);sampleHost();evidence.host.eventLoop={meanMs:eventLoop.mean/1e6,maxMs:eventLoop.max/1e6,p99Ms:eventLoop.percentile(99)/1e6};eventLoop.disable();evidence.rpcStats=[...rpcStats.values()];evidence.slowRPCs=slowRPCs;evidence.routeStats=routeStats;evidence.routeTiming=routeTiming;evidence.routeFailures=routeFailures;evidence.diskStats=diskStats;const{writeFile}=await import('node:fs/promises');await writeFile(join(out,'results.json'),JSON.stringify(evidence,null,2));for(const c of contexts)await c.close();await browser?.close();await db.close();await new Promise(r=>http.close(r));}
