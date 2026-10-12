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
