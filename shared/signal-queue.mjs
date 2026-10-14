// Keep each peer's offer/ICE order without letting one slow peer block sync,
// the broadcast lease, UI or unrelated peers. Backpressure never advances a
// server cursor past a signal that has not been accepted into the bounded queue.
export class SignalQueue {
 constructor({dispatch,onError=()=>{},isCurrent=()=>true,maxPending=512}){Object.assign(this,{dispatch,onError,isCurrent,maxPending});this.lanes=new Map();this.pending=0;this.closed=false;}
 key(s){const p=s.payload??{},family=p.type==='rtc'?p.peer?.startsWith('files:')?'files':p.peer?.startsWith('media:')?'media':'other':p.type?.startsWith('file-')?'files':p.type?.startsWith('media-')||p.type?.startsWith('native-')?'media':'chat';return[s.sender,s.scope_kind,s.scope_id,family,family==='media'?p.broadcast??p.peer?.split(':')[1]??'':''].join(':');}
 enqueue(signal){
  if(this.closed||!this.isCurrent()||this.pending>=this.maxPending)return false;
  const key=this.key(signal),lane=this.lanes.get(key)??[];this.pending++;lane.push(signal);
  if(!this.lanes.has(key)){this.lanes.set(key,lane);this.drain(key,lane);}
  return true;
 }
 async drain(key,lane){
  while(lane.length&&!this.closed&&this.isCurrent()){
   const signal=lane[0];try{await this.dispatch(signal);}catch(error){if(!this.closed&&this.isCurrent())try{this.onError(error);}catch{}}
   if(lane[0]===signal){lane.shift();this.pending--;}
  }
  this.pending-=lane.length;lane.length=0;if(this.lanes.get(key)===lane)this.lanes.delete(key);
 }
 close(){this.closed=true;for(const lane of this.lanes.values()){this.pending-=lane.length;lane.length=0;}this.lanes.clear();}
 snapshot(){return{pending:this.pending,peerLanes:this.lanes.size,maxPending:this.maxPending};}
}
