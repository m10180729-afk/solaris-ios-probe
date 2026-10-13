// Native video overlays use the original video bounds, plus a local clipping
// mask. Clipping the bounds themselves would stretch the Metal video surface.
export function clipVideoBounds(rect,bounds){
 let left=rect.left,top=rect.top,right=rect.right,bottom=rect.bottom;
 for(const b of bounds){left=Math.max(left,b.left);top=Math.max(top,b.top);right=Math.min(right,b.right);bottom=Math.min(bottom,b.bottom);}
 return{clipX:Math.max(0,left-rect.left),clipY:Math.max(0,top-rect.top),clipWidth:Math.max(0,right-left),clipHeight:Math.max(0,bottom-top)};
}
export function resetVideoFullscreen(doc,bridge){
 const viewing=doc.querySelector('#viewing');viewing?.classList.remove('native-fullscreen');
 for(const card of doc.querySelectorAll('.video-card.focused'))card.classList.remove('focused');
 if(doc.fullscreenElement)doc.exitFullscreen?.().catch(()=>{});
 for(const video of doc.querySelectorAll('#videos video'))if(video.webkitDisplayingFullscreen)video.webkitExitFullscreen?.();
 if(bridge.native)bridge.call('fullscreen',{enabled:false}).catch(()=>{});
}

const clamp=(v,min,max)=>Math.min(max,Math.max(min,Number.isFinite(v)?v:min));
export function viewportGeometry({scale=1,x=0,y=0,width,height,containerWidth=width,containerHeight=height}){
 scale=clamp(scale,.5,4);
 const mx=Math.max(0,(width*scale-containerWidth)/2),my=Math.max(0,(height*scale-containerHeight)/2);
 return{scale,x:clamp(x,-mx,mx),y:clamp(y,-my,my)};
}
// Presented frame intervals supplement decoded FPS. A bounded rolling window
// includes freezes, while hidden/background playback is deliberately excluded.
export class FrameCadence {
 constructor(limit=600){this.limit=limit;this.reset();}
 reset(){this.last=null;this.intervals=[];}
 note(timestamp){if(!Number.isFinite(timestamp))return;if(this.last!==null&&timestamp>this.last){this.intervals.push(timestamp-this.last);if(this.intervals.length>this.limit)this.intervals.shift();}this.last=timestamp;}
 snapshot(){const values=this.intervals;if(values.length<20)return{presentationMeasured:false,presentedFrames:values.length};
  const sum=values.reduce((a,b)=>a+b,0),tail=[...values].sort((a,b)=>b-a).slice(0,Math.max(1,Math.ceil(values.length*.01)));
  return{presentationMeasured:true,presentedFrames:values.length,presentationFPS:1000*values.length/sum,
   fpsLow1:1000*tail.length/tail.reduce((a,b)=>a+b,0),longestFrameMilliseconds:tail[0],
   frameGapCount:values.filter(n=>n>Math.max(50,sum/values.length*2.5)).length};
 }
}
export class VideoViewport {
 constructor(video,{onChange=()=>{},onFrame=()=>{}}={}){
  this.video=video;this.container=video.parentElement;this.onChange=onChange;this.onFrame=onFrame;
  this.scale=1;this.x=this.y=0;this.pointers=new Map();this.listeners=[];this.cadence=new FrameCadence();
  this.oldTransform=video.style.transform;this.oldOrigin=video.style.transformOrigin;
  this.listen('wheel',e=>{if(!e.deltaY)return;e.preventDefault();const unit=e.deltaMode===1?16:e.deltaMode===2?this.container.clientHeight:1;this.zoomBy(Math.exp(-clamp(e.deltaY*unit,-600,600)*.002),e.clientX,e.clientY);},{passive:false});
  this.listen('pointerdown',e=>{if(e.button!==0||e.target.closest?.('button,input,select,a'))return;this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});this.container.setPointerCapture?.(e.pointerId);});
  this.listen('pointermove',e=>{
   const before=this.pointers.get(e.pointerId);if(!before)return;
   const old=[...this.pointers.values()];this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
   const next=[...this.pointers.values()];
   if(next.length===2){const dist=p=>Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),d=dist(old);if(d>0)this.zoomBy(dist(next)/d,(next[0].x+next[1].x)/2,(next[0].y+next[1].y)/2);}
   else if(next.length===1&&this.scale>1){this.x+=e.clientX-before.x;this.y+=e.clientY-before.y;this.apply();}
  });
  const end=e=>{this.pointers.delete(e.pointerId);};
  this.listen('pointerup',end);this.listen('pointercancel',end);this.listen('lostpointercapture',end);
  this.listen('dblclick',e=>{if(!e.target.closest?.('button,input,select,a'))this.reset();});
  this.observer=globalThis.ResizeObserver?new ResizeObserver(()=>this.apply()):null;this.observer?.observe(this.container);
  this.container.classList.add('zoom-ready');video.style.transformOrigin='center center';this.apply();
  if(video.requestVideoFrameCallback){const frame=(now,metadata)=>{if(this.closed)return;if(video.ownerDocument.hidden)this.cadence.reset();else this.cadence.note(metadata.expectedDisplayTime??now);
    if(!this.lastFrameReport||now-this.lastFrameReport>=1000){this.lastFrameReport=now;this.onFrame(this.cadence.snapshot());}
    this.frameTicket=video.requestVideoFrameCallback(frame);};this.frameTicket=video.requestVideoFrameCallback(frame);}
 }
 listen(type,handler,options){this.container.addEventListener(type,handler,options);this.listeners.push([type,handler,options]);}
 zoomBy(multiplier,clientX,clientY){if(this.closed||!Number.isFinite(multiplier)||multiplier<=0)return;
  const r=this.container.getBoundingClientRect(),px=(clientX??r.left+r.width/2)-r.left-r.width/2,py=(clientY??r.top+r.height/2)-r.top-r.height/2;
  const next=clamp(this.scale*multiplier,.5,4),ratio=next/this.scale;
  this.x=px-(px-this.x)*ratio;this.y=py-(py-this.y)*ratio;this.scale=next;this.apply();
 }
 reset(){this.scale=1;this.x=this.y=0;this.apply();}
 apply(){if(this.closed)return;Object.assign(this,viewportGeometry({scale:this.scale,x:this.x,y:this.y,width:this.video.offsetWidth,height:this.video.offsetHeight,containerWidth:this.container.clientWidth,containerHeight:this.container.clientHeight}));
  this.video.style.transform=`translate3d(${this.x}px,${this.y}px,0) scale(${this.scale})`;
  this.container.dataset.zoom=String(Math.round(this.scale*100));
  if(this.layoutTicket)return;const schedule=globalThis.requestAnimationFrame??(fn=>setTimeout(fn,0));
  this.layoutTicket=schedule(()=>{this.layoutTicket=null;if(!this.closed)this.onChange({scale:this.scale,x:this.x,y:this.y});});
 }
 destroy(){if(this.closed)return;this.closed=true;this.observer?.disconnect();
  for(const[type,handler,options]of this.listeners)this.container.removeEventListener(type,handler,options);
  this.pointers.clear();this.video.cancelVideoFrameCallback?.(this.frameTicket);
  this.video.style.transform=this.oldTransform;this.video.style.transformOrigin=this.oldOrigin;this.container.classList.remove('zoom-ready');
 }
}
