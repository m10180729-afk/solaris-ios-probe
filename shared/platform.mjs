import{SHA256}from'./sha256.mjs';
export const MAX_FILE_BYTES=100*1024**2;
export const VERSION='0.4.0-build65';
export function readSettings(text){let v;try{v=JSON.parse(text??'{}');}catch{v={};}if(!v||typeof v!=='object')v={};return{maxReceive:Number.isInteger(v.maxReceive)&&v.maxReceive>=1&&v.maxReceive<=5?v.maxReceive:4,updateChannel:['stable','test'].includes(v.updateChannel)?v.updateChannel:'test',preventDuplicates:v.preventDuplicates!==false};}
export const uuid=()=>crypto.randomUUID();
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function requestTimeout(milliseconds=15000){
 if(globalThis.AbortSignal?.timeout)return AbortSignal.timeout(milliseconds);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new DOMException('서버 응답 시간이 초과되었습니다.','TimeoutError')),milliseconds);
 timer.unref?.();return controller.signal;
}
export const safeName=name=>{let s=String(name).normalize('NFC').replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g,'_').replace(/^[. ]+|[. ]+$/g,'').slice(0,160)||'download';return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(s)?'download_'+s:s;};
export const toBase64=b=>{let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s);};
export const fromBase64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export const redact=value=>JSON.parse(JSON.stringify(value, (k,v)=>/token|password|credential|authorization|publishable|secret|sdp|candidate/i.test(k)?'[redacted]':v));
export class Bridge extends EventTarget {
 constructor(){super();this.pending=new Map();this.native=!!(globalThis.chrome?.webview||globalThis.SolarisNative||globalThis.webkit?.messageHandlers?.solaris);this.receive=this.receive.bind(this);globalThis.chrome?.webview?.addEventListener('message',e=>this.receive(e.data));globalThis.addEventListener?.('solaris-native',e=>this.receive(e.detail));}
 receive(m){if(m?.requestId&&this.pending.has(m.requestId)){const p=this.pending.get(m.requestId);clearTimeout(p.timer);this.pending.delete(m.requestId);m.error?p.reject(new Error(m.error)):p.resolve(m.result);return;}this.dispatchEvent(new CustomEvent('event',{detail:m}));}
 send(m){if(globalThis.chrome?.webview)chrome.webview.postMessage(m);else if(globalThis.SolarisNative)SolarisNative.postMessage(JSON.stringify(m));else if(globalThis.webkit?.messageHandlers?.solaris)webkit.messageHandlers.solaris.postMessage(m);else throw new Error('Native app required');}
 async call(command,args={}){const requestId=uuid();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(requestId);reject(new Error(command+' timed out'));},['finishFile','hashFile'].includes(command)?600000:['pickFile','createReceiver','mediaStart'].includes(command)?120000:30000);this.pending.set(requestId,{resolve,reject,timer});try{this.send({type:'solaris-command',requestId,command,args});}catch(e){clearTimeout(timer);this.pending.delete(requestId);reject(e);}});}
}
export class Ledger {
 constructor(name='solaris-v1'){this.name=name;}
 async open(){if(this.db)return;this.db=await new Promise((resolve,reject)=>{const r=indexedDB.open(this.name,1);r.onupgradeneeded=()=>r.result.createObjectStore('records');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
 async run(mode,fn){await this.open();return new Promise((resolve,reject)=>{const t=this.db.transaction('records',mode),q=fn(t.objectStore('records'));let result;q.onsuccess=()=>result=q.result;t.oncomplete=()=>resolve(result);t.onerror=()=>reject(t.error);});}
 get(k){return this.run('readonly',s=>s.get(k));}set(k,v){return this.run('readwrite',s=>s.put(v,k));}delete(k){return this.run('readwrite',s=>s.delete(k));}all(){return this.run('readonly',s=>s.getAll());}
}
export class DiskFiles {
 constructor(bridge,ledger=new Ledger('solaris-file-handles')){this.bridge=bridge;this.ledger=ledger;this.handles=new Map();}
 async get(id){let v=this.handles.get(id);if(!v){v=await this.ledger.get(id);if(v)this.handles.set(id,v);}return v;}
 async remember(id,v){this.handles.set(id,v);const{writer,...durable}=v;await this.ledger.set(id,durable);}
 async pick(){if(this.bridge.native)return this.bridge.call('pickFile');if(!globalThis.showOpenFilePicker)throw new Error('파일 전송은 설치된 Solaris 앱에서 사용하세요.');const[h]=await showOpenFilePicker();const f=await h.getFile(),id=uuid();await this.remember(id,{handle:h,source:true,size:f.size,modified:f.lastModified});return{id,name:f.name,size:f.size,modified:f.lastModified};}
 async read(id,offset,length){if(this.bridge.native)return fromBase64((await this.bridge.call('readFile',{id,offset,length})).data);const v=await this.get(id);if(!v)throw new Error('원본 파일을 다시 선택하세요.');const f=await v.handle.getFile();if(f.size!==v.size||f.lastModified!==v.modified)throw new Error('원본 파일이 변경되었습니다.');return new Uint8Array(await f.slice(offset,offset+length).arrayBuffer());}
 async create(id,name,size){name=safeName(name);if(this.bridge.native)return this.bridge.call('createReceiver',{id,name,size});if(!globalThis.showSaveFilePicker)throw new Error('디스크 저장을 지원하는 Solaris 앱이 필요합니다.');const handle=await showSaveFilePicker({suggestedName:name}),writer=await handle.createWritable({keepExistingData:false});await this.remember(id,{handle,writer,source:false,size,extent:0});return{id,name};}
 async write(id,offset,data){if(this.bridge.native)return this.bridge.call('writeFile',{id,offset,data:toBase64(data)});const v=await this.get(id);if(!v||v.source)throw new Error('저장 파일을 다시 선택하세요.');if(!v.writer){v.writer=await v.handle.createWritable({keepExistingData:true});v.extent=(await v.handle.getFile()).size;}if(offset>v.extent||offset+data.length>v.size)throw new Error('파일 청크 순서 오류');await v.writer.write({type:'write',position:offset,data});v.extent=Math.max(v.extent,offset+data.length);}
 async flush(id){if(this.bridge.native)return;const v=this.handles.get(id);if(v?.writer){await v.writer.truncate(v.extent);await v.writer.close();v.writer=null;await this.remember(id,v);}}
 async hash(id){if(this.bridge.native)return (await this.bridge.call('hashFile',{id})).sha256;const v=await this.get(id);if(!v)throw new Error('파일에 접근할 수 없습니다.');await this.flush(id);const f=await v.handle.getFile(),h=new SHA256();for(let o=0;o<f.size;o+=32768)h.update(new Uint8Array(await f.slice(o,o+32768).arrayBuffer()));return h.digest();}
 async check(id){if(this.bridge.native)return this.bridge.call('fileInfo',{id});const v=await this.get(id);if(!v)return null;await this.flush(id);const f=await v.handle.getFile();return{size:f.size,modified:f.lastModified};}
 async finish(id,name,size){if(this.bridge.native)return this.bridge.call('finishFile',{id,name:safeName(name),size});await this.flush(id);if((await this.check(id))?.size!==size)throw new Error('Incomplete file');return{id,name};}
 async discard(id){if(this.bridge.native)return this.bridge.call('discardFile',{id});await this.handles.get(id)?.writer?.abort();this.handles.delete(id);await this.ledger.delete(id);}
}
