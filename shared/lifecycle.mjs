// Desktop transfers keep running in minimized windows. Mobile transfers retain
// their durable checkpoints before the OS suspends the WebView.
export class AppLifecycle {
 constructor({bridge,getTransfers,onForeground=async()=>{},onRestore=async()=>{},onError=()=>{},document=globalThis.document,window=globalThis}){
  Object.assign(this,{bridge,getTransfers,onForeground,onRestore,onError,document,window});
  this.serial=Promise.resolve();this.platform='browser';this.background=false;
  this.visibility=()=>this.change(this.document.hidden);
  this.native=e=>{if(e.detail?.type==='lifecycle')this.change(e.detail.state==='background');};
  this.restore=e=>{if(e.persisted)this.queue(this.onRestore);};
 }
 async start(){
  if(this.bridge.native)this.platform=(await this.bridge.call('platform')).platform;
  else if(/Android|iPhone|iPad|iPod/i.test(this.window.navigator?.userAgent??''))this.platform='mobile';
  this.document?.addEventListener('visibilitychange',this.visibility);
  this.bridge.addEventListener('event',this.native);
  this.window.addEventListener?.('pageshow',this.restore);
 }
 queue(fn){const next=this.serial.then(fn);this.serial=next.catch(this.onError);return this.serial;}
 change(background){
  if(!['ios','android','mobile'].includes(this.platform))return this.serial;
  if(background===this.background)return this.serial;
  this.background=background;
  return this.queue(async()=>{
   if(background)await this.getTransfers()?.suspend();
   else{await this.onForeground();await this.getTransfers()?.foreground();}
  });
 }
 close(){this.document?.removeEventListener('visibilitychange',this.visibility);this.bridge.removeEventListener('event',this.native);this.window.removeEventListener?.('pageshow',this.restore);}
}
