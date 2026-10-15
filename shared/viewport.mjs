// A single visible viewport owns app sizing. Native IME avoidance and WebKit
// visualViewport can report the same obstruction; take their minimum, never sum.
export function appViewport({width,height,visualHeight=height,offsetTop=0,scale=1,baseline=height,editable=false,native}){
 const finite=(value,fallback)=>Number.isFinite(value)&&value>0?value:fallback;
 const available=Math.min(finite(height,1),scale===1?finite(visualHeight,height):height,finite(native?.height,height));
 const keyboard=!!editable&&(native?.keyboard===true||baseline-available>120);
 return{width,height:available,top:scale===1?Math.max(0,Number.isFinite(offsetTop)?offsetTop:0):0,keyboard};
}
export class AppViewport {
 constructor({window=globalThis,document=globalThis.document,bridge,onChange=()=>{}}={}){
  Object.assign(this,{window,document,bridge,onChange});this.baseline=window.innerHeight;this.width=window.innerWidth;
  this.update=()=>{if(this.frame)return;this.frame=this.window.requestAnimationFrame(()=>{this.frame=null;this.apply();});};
  this.nativeEvent=e=>{if(e.detail?.type==='viewport'){this.native=e.detail;this.update();}};
  window.visualViewport?.addEventListener('resize',this.update);window.visualViewport?.addEventListener('scroll',this.update);
  window.addEventListener('resize',this.update);document.addEventListener('focusin',this.update);document.addEventListener('focusout',this.update);bridge?.addEventListener('event',this.nativeEvent);this.apply();
 }
 apply(){
  const w=this.window,v=w.visualViewport,editable=!!this.document.activeElement?.matches('input,textarea,[contenteditable=true]');
  if(this.width!==w.innerWidth){this.width=w.innerWidth;this.baseline=w.innerHeight;this.native=null;}
  if(!editable)this.baseline=Math.max(this.baseline,w.innerHeight,v?.height??0);
  const value=appViewport({width:w.innerWidth,height:w.innerHeight,visualHeight:v?.height,offsetTop:v?.offsetTop,scale:v?.scale??1,baseline:this.baseline,editable,native:this.native});
  const root=this.document.documentElement;root.style.setProperty('--app-height',value.height+'px');root.style.setProperty('--viewport-top',value.top+'px');
  this.document.body.classList.toggle('keyboard-open',value.keyboard);this.onChange(value);
 }
 close(){const w=this.window;w.visualViewport?.removeEventListener('resize',this.update);w.visualViewport?.removeEventListener('scroll',this.update);w.removeEventListener('resize',this.update);this.document.removeEventListener('focusin',this.update);this.document.removeEventListener('focusout',this.update);this.bridge?.removeEventListener('event',this.nativeEvent);if(this.frame)w.cancelAnimationFrame(this.frame);}
}
