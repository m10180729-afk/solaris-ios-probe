import{redact}from'./platform.mjs';
const safeText=s=>String(s).replace(/\bBearer\s+\S+/gi,'Bearer [redacted]').replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,'[redacted]').replace(/\bsb_(publishable|secret)_[A-Za-z0-9_-]+/g,'[redacted]').slice(0,1024);
export function sanitizeDiagnostics(value){return JSON.parse(JSON.stringify(redact(value),(_,v)=>typeof v==='string'?safeText(v):v));}
export class DiagnosticLog {
 constructor(ledger,uid,{limit=200,maxBytes=65536,now=Date.now}={}){Object.assign(this,{ledger,uid,limit,maxBytes,now});this.entries=[];this.serial=Promise.resolve();}
 get key(){return'diagnostics:'+this.uid;}
 async load(){const value=await this.ledger.get(this.key);this.entries=Array.isArray(value)?value:[];this.trim();}
 trim(){this.entries=this.entries.slice(-this.limit);while(this.entries.length&&new TextEncoder().encode(JSON.stringify(this.entries)).byteLength>this.maxBytes)this.entries.shift();}
 record(type,detail={}){this.entries.push({at:this.now(),type:safeText(type),detail:sanitizeDiagnostics(detail)});this.trim();clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush().catch(()=>{}),500);this.timer.unref?.();}
 async flush(){clearTimeout(this.timer);const value=structuredClone(this.entries);const next=this.serial.then(()=>this.ledger.set(this.key,value));this.serial=next.catch(()=>{});return next;}
 snapshot(){return sanitizeDiagnostics(this.entries);}
}
