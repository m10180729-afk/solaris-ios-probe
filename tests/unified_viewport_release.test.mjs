import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appViewport} from '../shared/viewport.mjs';
import {Media} from '../shared/media.mjs';

test('iPad landscape and portrait keyboards resize the conversation without a phone-only width gate',()=>{
 for(const width of [768,1024,1366]){
  const v=appViewport({width,height:1024,visualHeight:624,offsetTop:0,baseline:1024,editable:true});
  assert.equal(v.height,624);assert.equal(v.keyboard,true);assert.equal(v.top,0);
 }
});
test('native and WebKit keyboard obstructions are not applied twice',()=>{
 const v=appViewport({width:1024,height:1000,visualHeight:700,baseline:1000,editable:true,native:{height:700,keyboard:true}});
 assert.equal(v.height,700);assert(v.keyboard);
});
test('WebKit automatic input pan is compensated while floating keyboard does not shrink the app',()=>{
 assert.equal(appViewport({width:1024,height:1000,visualHeight:650,offsetTop:84,baseline:1000,editable:true}).top,84);
 const floating=appViewport({width:1024,height:1000,baseline:1000,editable:true,native:{height:1000,keyboard:false}});
 assert.equal(floating.height,1000);assert(!floating.keyboard);
});
test('Android native safe bounds and keyboard restoration keep one usable viewport',()=>{
 const hidden=appViewport({width:393,height:780,visualHeight:780,baseline:780});assert.equal(hidden.height,780);
 const shown=appViewport({width:393,height:480,visualHeight:480,baseline:780,editable:true});assert.equal(shown.height,480);assert(shown.keyboard);
 const restored=appViewport({width:393,height:780,visualHeight:780,baseline:780,editable:true});assert(!restored.keyboard);
});
test('pinch zoom and malformed viewport measurements cannot collapse application bounds',()=>{
 assert.equal(appViewport({width:1024,height:1000,visualHeight:500,scale:2,offsetTop:100,baseline:1000,editable:true}).height,1000);
 const bad=appViewport({width:393,height:780,visualHeight:NaN,native:{height:0}});assert.equal(bad.height,780);assert(!bad.keyboard);
});
test('empty cleanup does not emit spurious broadcast ended messages',async()=>{
 const bridge=new EventTarget();bridge.native=false;bridge.call=async()=>true;
 const api={session:{user:{id:'owner'}},rpc:async()=>true,signal:async()=>true};const media=new Media(api,bridge,{}),events=[];
 media.addEventListener('broadcast',e=>events.push(e.detail));
 try{await media.stop();await media.stop();assert.equal(events.length,0);media.broadcast={id:'b',transport:'browser'};await media.stop();await media.stop();assert.deepEqual(events,[null]);}finally{media.close();}
});
test('native sender failure keeps a distinguishable reason instead of another generic ended message',async()=>{
 const bridge=new EventTarget();bridge.native=true;bridge.call=async command=>command==='mediaStatus'?{id:'b',active:false,stopReason:'broadcast-heartbeat-timeout',diagnosticAgeSeconds:45}:true;
 const api={session:{user:{id:'owner'}},rpc:async()=>true,signal:async()=>true};const media=new Media(api,bridge,{}),errors=[],events=[];
 media.addEventListener('error',e=>errors.push(e.detail.message));media.addEventListener('diagnostics',e=>events.push(e.detail));
 try{media.broadcast={id:'b',transport:'replaykit',pending:false,started:Date.now()};await media.tick();assert.equal(media.broadcast,null);assert.match(errors[0],/45초/);assert(events.some(e=>e.reason==='broadcast-heartbeat-timeout'));}finally{media.close();}
});
