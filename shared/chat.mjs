import{uuid}from'./platform.mjs';

// One store per signed-in UID. Network retries reuse client_id, so a delayed
// reply cannot duplicate a sent message or write into the next user's ledger.
export class DirectMessages extends EventTarget {
 constructor(api,ledger,uid){super();Object.assign(this,{api,ledger,uid});this.threads={};this.views={};this.historyEnd={};this.unread={};this.cursor=0;this.revision=0;this.savedRevision=0;this.queue=Promise.resolve();this.requests=new Map();this.active=null;this.closed=false;}
 async init(){const saved=await this.ledger.get('dm:'+this.uid);if(saved){this.threads=saved.threads??{};this.unread=saved.unread??{};this.cursor=saved.cursor??0;}for(const list of Object.values(this.threads))for(const m of list)if(m.status==='sending')m.status='failed';}
 view(peer){return this.views[peer]??this.list(peer);}
 latest(peer){delete this.views[peer];this.changed(peer);}
 list(peer){return this.threads[peer]??[];}
 changed(peer){this.revision++;this.dispatchEvent(new CustomEvent('change',{detail:{peer}}));this.scheduleSave();}
 scheduleSave(){if(this.saveTimer||this.closed)return;this.saveTimer=setTimeout(()=>{this.saveTimer=null;this.flush().catch(e=>this.dispatchEvent(new CustomEvent('error',{detail:e})));},150);}
 async flush(){clearTimeout(this.saveTimer);this.saveTimer=null;const work=this.queue.then(async()=>{if(this.savedRevision===this.revision)return;const rev=this.revision;await this.ledger.set('dm:'+this.uid,structuredClone({threads:this.threads,unread:this.unread,cursor:this.cursor}));this.savedRevision=rev;});this.queue=work.catch(()=>{});await work;}
 merge(rows){
  const touched=new Set();
  for(const row of rows??[]){
   if(!row?.id||typeof row.text!=='string'||row.text.length>2000||![row.sender,row.recipient].includes(this.uid))continue;
   const peer=row.sender===this.uid?row.recipient:row.sender,list=this.list(peer),index=list.findIndex(m=>m.id===row.id||m.client_id===row.client_id&&m.sender===row.sender);
   const next={...row,status:'sent'},previous=index<0?null:list[index];
   this.cursor=Math.max(this.cursor,Number(row.seq)||0);
   if(previous?.id===next.id&&previous.status==='sent')continue;
   if(index<0){list.push(next);if(row.recipient===this.uid&&peer!==this.active)this.unread[peer]=(this.unread[peer]??0)+1;}else list[index]=next;
   list.sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)||(Number(a.seq)||0)-(Number(b.seq)||0));
   this.threads[peer]=list.slice(-200);touched.add(peer);
  }
  for(const peer of touched)this.changed(peer);
 }
 select(peer){this.active=peer;if(this.unread[peer]){this.unread[peer]=0;this.changed(peer);}}
 async history(peer,before){
  if(this.closed)return;const key=peer+':'+(before??'latest');if(this.requests.has(key))return this.requests.get(key);
  const task=(async()=>{const rows=await this.api.rpc('dm_history',{target:peer,limit:50,...(before?{before}:{})});if(!this.closed){this.merge(rows);this.historyEnd[peer]=rows.length<50;if(before&&rows.length){const unique=new Map([...rows,...this.view(peer)].map(m=>[m.id??m.client_id,{...m,status:m.status??'sent'}]));this.views[peer]=[...unique.values()].sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)).slice(0,200);this.changed(peer);}}return rows;})();
  this.requests.set(key,task);try{return await task;}finally{this.requests.delete(key);}
 }
 async send(peer,text,clientID=uuid()){
  if(this.closed)throw new Error('대화를 다시 열어주세요.');text=text.trim();if(!text||text.length>2000)throw new Error('메시지는 1–2000자로 입력하세요.');
  const list=this.list(peer),existing=list.find(m=>m.client_id===clientID&&m.sender===this.uid);
  if(existing?.status==='sent')return existing;if(existing?.status==='sending')return;
  const row=existing??{client_id:clientID,sender:this.uid,recipient:peer,text,created_at:new Date().toISOString()};row.status='sending';row.error=null;
  if(!existing){list.push(row);this.threads[peer]=list.slice(-200);}this.changed(peer);await this.flush();
  try{const result=await this.api.rpc('dm_send',{target:peer,client_id:clientID,text:row.text});if(!this.closed)this.merge([result]);return result;}
  catch(e){if(!this.closed&&row.status!=='sent'){row.status='failed';row.error=e.message;this.changed(peer);}throw e;}
 }
 close(){this.closed=true;clearTimeout(this.saveTimer);return this.flush();}
}
