import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Media,Peer} from '../shared/media.mjs';
const scope={kind:'channel',id:'11111111-1111-4111-8111-111111111111'};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function fixture(bridge=null){
 const calls=[];bridge??=new EventTarget();bridge.native=true;
 bridge.call??=async(command,args)=>{calls.push({command,args});return command==='platform'?{platform:'windows',nativeSignaling:true}:true;};
 const api={session:{user:{id:'owner'},access_token:'fixture',refresh_token:'fixture'},config:{url:'https://fixture.supabase.co',key:'sb_publishable_fixture'},ensure:async()=>{},async rpc(action,args){calls.push({action,args});return action==='broadcast_start'?{id:args.attempt_id}:true;}};
 const media=new Media(api,bridge,{});clearInterval(media.timer);return{media,api,bridge,calls};
}
test('repeated start clicks create only one broadcast and one capture',async t=>{
 const{media,calls}=fixture();t.after(()=>media.close());const a=media.start(scope),b=media.start(scope);assert.equal(a,b);await a;
 assert.equal(calls.filter(c=>c.action==='broadcast_start').length,1);assert.equal(calls.filter(c=>c.command==='mediaStart').length,1);await media.stop();assert.equal(media.broadcast,null);
});
test('cancel while the start RPC is pending removes its late broadcast',async t=>{
 const{media,api,calls}=fixture();t.after(()=>media.close());const gate=deferred(),ready=deferred();let created;
 api.rpc=async(action,args)=>{calls.push({action,args});if(action==='broadcast_start'){created=args.attempt_id;ready.resolve();await gate.promise;return{id:created};}return true;};
 const pending=media.start(scope);await ready.promise;await media.stop();gate.resolve();await assert.rejects(pending,{name:'AbortError'});assert.equal(media.broadcast,null);assert(calls.some(c=>c.action==='broadcast_stop'&&c.args.id===created));assert(!calls.some(c=>c.command==='mediaStart'));
});
test('an old heartbeat response cannot stop a replacement broadcast',async t=>{
 const{media,api}=fixture();t.after(()=>media.close());const gate=deferred(),ready=deferred();api.rpc=async action=>{if(action==='broadcast_touch'){ready.resolve();return gate.promise;}return true;};
 media.broadcast={id:'old',transport:'browser'};const pending=media.controlTick();await ready.promise;const next={id:'new',transport:'browser'};media.broadcast=next;gate.resolve(false);await pending;assert.equal(media.broadcast,next);
});
test('native stop is serialized across engine replacement using the same bridge',async t=>{
 const bridge=new EventTarget(),gate=deferred(),ready=deferred(),commands=[];bridge.native=true;bridge.call=async(command,args)=>{commands.push({command,args});if(command==='mediaStop'&&args.id==='old'){ready.resolve();await gate.promise;}return command==='platform'?{platform:'windows',nativeSignaling:true}:true;};
 const old=fixture(bridge).media,next=fixture(bridge).media;t.after(()=>{old.close();next.close();});old.broadcast={id:'old',transport:'native'};
 const stopped=old.stop();await ready.promise;const started=next.start(scope);await new Promise(r=>setTimeout(r,10));assert(!commands.some(c=>c.command==='mediaStart'));gate.resolve();await stopped;await started;assert(commands.some(c=>c.command==='mediaStart'));await next.stop();
});
test('late native status cannot adopt the old broadcast during a new start',async t=>{
 const{media,bridge}=fixture();t.after(()=>media.close());const gate=deferred(),ready=deferred();const original=bridge.call;bridge.call=async(command,args)=>{if(command==='mediaStatus'){ready.resolve();return gate.promise;}return original(command,args);};
 const updating=media.update({broadcasts:[{id:'old',publisher:'owner',transport:'native',scope_kind:'channel',scope_id:scope.id}]});await ready.promise;const started=await media.start(scope);gate.resolve({active:true,id:'old'});await updating;assert.equal(media.broadcast.id,started.id);await media.stop();
});
test('a sender receiving an offer answers it instead of generating a second offer',async t=>{
 const original=globalThis.RTCPeerConnection;t.after(()=>globalThis.RTCPeerConnection=original);const operations=[],sent=[];
 globalThis.RTCPeerConnection=class{constructor(){this.signalingState='stable';}async setRemoteDescription(d){this.remoteDescription=d;this.signalingState='have-remote-offer';}async createAnswer(){operations.push('answer');return{type:'answer',sdp:'fixture-answer'};}async createOffer(){throw Error('Offer collision');}async setLocalDescription(d){this.localDescription={...d,toJSON:()=>d};this.signalingState='stable';}close(){}};
 const p=new Peer({id:'media:fixture',remote:'viewer',scope,api:{signal:async(...args)=>sent.push(args)},iceServers:[],polite:true});p.transformOffer=x=>x;
 await p.receive({description:{type:'offer',sdp:'fixture-offer'},epoch:'remote-epoch'});assert.deepEqual(operations,['answer']);assert.equal(sent[0][2].description.type,'answer');assert.equal(sent[0][2].replyTo,'remote-epoch');p.close();
});
