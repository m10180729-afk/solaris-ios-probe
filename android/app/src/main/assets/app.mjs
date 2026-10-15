import config from './config.mjs';
import {API} from './api.mjs';
import {Bridge,Ledger,DiskFiles,VERSION,readSettings,requestTimeout} from './platform.mjs';
import {Media,qualityGrade} from './media.mjs';
import {Transfers} from './files.mjs';
import {DirectMessages} from './chat.mjs';
import {clipVideoBounds,resetVideoFullscreen,VideoViewport,NativeLayoutQueue} from './viewing.mjs';
import {SignalQueue} from './signal-queue.mjs';
import {AppLifecycle} from './lifecycle.mjs';
import {AppViewport} from './viewport.mjs';
import {DiagnosticLog,sanitizeDiagnostics} from './diagnostics.mjs';
import {icon} from './icons.mjs';

const $=s=>document.querySelector(s), bridge=new Bridge(), ledger=new Ledger();
const api=new API(config,bridge,ledger), disk=new DiskFiles(bridge);
const emptySnapshot=()=>({friends:[],servers:[],channels:[],members:[],sessions:[],broadcasts:[],blocks:[],signals:[]});
let media,files,dm,signalQueue,snapshot=emptySnapshot(),scope=null,server=null,friend=null,page='friends';
let friendFilter='all',cursor=0,polling=false,pollPromise=null,timer,lastPoll=0,log,lifecycle,loadedUID,booting=false;
let settings=readSettings(localStorage.getItem('solaris-settings')),diagnostics={},conversations={},drafts={},uiKey='',searchDraft='';
let nativeFullscreen=false,fullscreenID=null,messageKey='',chatSave=Promise.resolve();
let providers=null,googleBusy=false,friendListQuery='',authReturnQueue=Promise.resolve(),authReturnSeen=false;const authReturns=new Set();
let loggingOut=false,accountUIEpoch=0,bootPromise=null,signedOutCleanup=null,dialogReturnFocus=null,dialogAnchor=null,windowState={platform:'browser',state:'normal',fullscreen:false};
let navigationEpoch=0,navigationSerial=Promise.resolve(),navigationBusy=false,joinedChannel=null,capabilities={canPublish:true,systemTitlebar:false};
let nativeBackground=false;
let authReadyResolve;const authReady=new Promise(resolve=>authReadyResolve=resolve);
const avatarCache=new Map(),autoWatchDisabled=new Set(),autoWatchAttempt=new Map();
let senderDiagnostics={};
const presenceLabels={online:'온라인',away:'자리비움',dnd:'방해금지',invisible:'숨김',offline:'오프라인'};

function el(tag,text=null,attrs={}){
 const n=document.createElement(tag);if(text!==null)n.textContent=text;
 for(const[k,v]of Object.entries(attrs))if(k==='class')n.className=v;else n.setAttribute(k,v);
 return n;
}
function button(text,action,id,attrs={}){
 const danger=['server-leave','server-delete','channel-delete','friend-remove','block','file-cancel','file-reject'].includes(action);
 const n=el('button',null,{type:'button','data-action':action,...(id?{'data-id':id}:{}),...attrs,class:[attrs.class??'',danger?'danger':''].filter(Boolean).join(' ')});
 const glyph={'friend':'message','friend-menu':'more','member-menu':'more','friend-profile':'user','user-profile':'user','server-settings':'chevron','session-request':'screen','friend-file':'files','channel-file':'files','send-file':'files','watch':'screen','unwatch':'stop','fullscreen':'full','profile':'user','settings':'settings','end-session':'leave','logout':'leave','session-more':'more','quality-details':'signal'}[action];
 if(text&&glyph&&!n.hasAttribute('aria-label'))n.setAttribute('aria-label',text);if(text&&!n.hasAttribute('title'))n.title=text;
 if(text!==null){if(glyph)n.append(icon(glyph,18));if(!['friend-menu','server-settings'].includes(action))n.append(el('span',text,{class:'button-label'}));}return n;
}
function iconAction(text,action,id,glyph,attrs={}){
 const control=button(text,action,id,{...attrs,class:['icon-action',attrs.class??''].filter(Boolean).join(' '),'aria-label':text,title:attrs.title??text});
 control.replaceChildren(icon(glyph,20));return control;
}
function setButtonLabel(n,text,glyph){n.replaceChildren(...(glyph?[icon(glyph,18)]:[]),el('span',text,{class:'button-label'}));n.setAttribute('aria-label',text);n.title=text;}
function error(e){
 let text=e.message??String(e);
 if(e.name==='AbortError'&&/화면공유/.test(text))return;
 if(e.status===429||/rate limit/i.test(text))text='요청이 너무 많아요. 잠시 기다린 뒤 Google 로그인을 다시 시도하세요.';
 if(/provider.*(disabled|not enabled)|Unsupported provider/i.test(text))text='Google 로그인이 아직 설정되지 않았어요. Supabase의 Google 제공자 설정을 확인하세요.';
 if(/Unknown action.*dm_|Unknown Solaris action|Unknown action/i.test(text))text='개인 메시지 업데이트가 필요합니다. Supabase SQL Editor에서 backend/003_build60_dm.sql을 실행하세요.';
 if(/Could not find the function.*solaris_action/i.test(text))text='서버에 Solaris 데이터베이스 설정이 필요합니다. 처음 설정하는 프로젝트는 backend/001_solaris.sql을 실행하세요. 이미 사용 중인 DB는 테이블을 삭제하거나 001을 재실행하지 말고 빌드61 안내의 업데이트 SQL과 스키마 새로고침을 확인하세요.';
 text=String(text).replace(/https?:\/\/\S+/g,'[주소 숨김]');log?.record('error',{message:text});$('#error').replaceChildren(el('span',text),button('닫기','dismiss-error',null,{'aria-label':'오류 안내 닫기'}));$('#error').hidden=false;
}
async function run(fn,control){
 try{$('#error').hidden=true;if(control){control.disabled=true;control.setAttribute('aria-busy','true');}await fn();}
 catch(e){error(e);}finally{if(control?.isConnected){control.disabled=false;control.removeAttribute('aria-busy');if(control.id==='google-login')refreshGoogleLogin();}}
}
function presenceFor(p,online){
 if(online===false)return 'offline';
 const status=p.uid===loadedUID?snapshot.me?.presence_preference:friendRecord(p.uid)?.presence_status??snapshot.members.find(m=>m.profile.uid===p.uid)?.presence_status;
 return status in presenceLabels?status:online?'online':'offline';
}
function identity(p={},online){
 const wrap=el('div',null,{class:'row'}),avatar=el('span',null,{class:'avatar-wrap'});
 const av=el('span',p.nickname?.[0]??'S',{class:'avatar'}),info=el('div',null,{class:'identity'});
 const status=presenceFor(p,online);avatar.append(av);if(typeof online==='boolean')avatar.append(el('span',null,{class:'presence '+status,role:'img','aria-label':presenceLabels[status],title:presenceLabels[status]}));
 info.append(el('strong',p.nickname??'참여자'),el('div','@'+(p.user_id??''),{class:'muted'}));wrap.append(avatar,info);
 if(p.avatar_path){
  const path=p.avatar_path,load=avatarCache.get(path)??api.avatarURL(path).catch(()=>null);avatarCache.set(path,load);
  Promise.resolve(load).then(url=>{if(url&&av.isConnected)av.replaceWith(el('img',null,{src:url,class:'avatar',alt:(p.nickname??'사용자')+' 프로필'}));});
 }
 return wrap;
}
function clearDialogPosition(dialog){
 for(const property of ['position','inset','left','top','right','bottom','margin'])dialog.style.removeProperty(property);
 dialog.classList.remove('anchored-context');
}
function positionContextDialog(){
 const dialog=$('#dialog');if(!dialog.open||!dialog.classList.contains('context-dialog'))return;
 clearDialogPosition(dialog);if(!dialogAnchor||!matchMedia('(min-width:761px)').matches)return;
 const anchor=dialogAnchor.element?.isConnected?dialogAnchor.element.getBoundingClientRect():dialogAnchor.rect;
 if(!anchor?.width||!anchor?.height)return;
 const size=dialog.getBoundingClientRect(),gap=8,clamp=(value,extent,viewport)=>Math.max(gap,Math.min(value,Math.max(gap,viewport-extent-gap)));
 const x=clamp(anchor.right-size.width,size.width,innerWidth),below=anchor.bottom+gap;
 const y=clamp(below+size.height<=innerHeight-gap?below:anchor.top-size.height-gap,size.height,innerHeight);
 Object.assign(dialog.style,{position:'fixed',inset:'auto',margin:'0',left:x+'px',top:y+'px'});dialog.classList.add('anchored-context');
}
globalThis.addEventListener('resize',positionContextDialog);
function modal(title,body,{anchor=null}={}){
 if(loggingOut)return;
 if(!$('#dialog').open)dialogReturnFocus=anchor?.isConnected?anchor:document.activeElement;
 clearDialogPosition($('#dialog'));dialogAnchor=body.classList.contains('context-menu')&&anchor?.getClientRects().length?{element:anchor,rect:anchor.getBoundingClientRect()}:null;
 $('#dialog').style.removeProperty('width');$('#dialog').style.removeProperty('height');
 $('#dialog').classList.toggle('profile-dialog',body.classList.contains('profile-settings')||body.classList.contains('profile-card'));
 $('#dialog').classList.toggle('context-dialog',body.classList.contains('context-menu'));
 $('#dialog-content').replaceChildren(el('h1',title,{id:'dialog-title'}),body);if(!$('#dialog').open)$('#dialog').showModal();
 positionContextDialog();
}
function confirmAction(title,text){
 return new Promise(resolve=>{
  const body=el('div'),actions=el('div',null,{class:'modal-actions'}),cancel=el('button','취소',{type:'button'}),yes=el('button','확인',{type:'button',class:'danger',id:'confirm-action'});
  body.append(el('p',text));actions.append(cancel,yes);body.append(actions);modal(title,body);
  const dialog=$('#dialog');let done=false;
  const finish=value=>{if(done)return;done=true;dialog.removeEventListener('close',closed);dialog.close();resolve(value);};
  const closed=()=>finish(false);dialog.addEventListener('close',closed,{once:true});
  cancel.onclick=()=>finish(false);yes.onclick=()=>finish(true);yes.focus();
 });
}
function field(label,name,attrs={}){
 const node=el('label',label),input=el('input',null,{name,...attrs});node.append(input);return node;
}
function formModal(title,id,fields,submitText,data={}){
 const form=el('form',null,{id,class:'stack-form'});Object.assign(form.dataset,data);
 for(const f of fields)form.append(field(f.label,f.name,f.attrs));
 form.append(el('button',submitText,{class:'primary'}));modal(title,form);
 form.querySelector('input')?.focus();
}
function showAuth(mode='login',status=''){
 $('#onboarding').hidden=false;$('#workspace').hidden=true;$('#mobile-tabs').hidden=true;$('#onboarding-status').textContent=status;
 const pending=api.deletionPending===true,claim=!pending&&mode==='claim';$('#register').hidden=!claim;$('#deletion-pending-panel').hidden=!pending;$('#onboarding').dataset.mode=pending?'deletion':claim?'claim':'google';
 $('#onboarding-title').textContent=pending?'계정 삭제를 완료해 주세요':claim?'프로필을 만들어 주세요':'Solaris에 오신 것을 환영해요';
 $('#google-panel').hidden=claim||pending;$('#google-login').disabled=pending||googleBusy||providers?.external?.google===false;if(pending)$('#auth-pending').hidden=true;
 refreshGoogleLogin();
}
function refreshGoogleLogin(){
 const retained=!!api.session;$('#google-session-recovery').hidden=!retained||$('#google-panel').hidden;
 $('#google-login').disabled=retained||api.deletionPending||googleBusy||providers?.external?.google===false;
}
function conversationKey(s=scope,f=friend){return s?.kind==='channel'?'channel:'+s.id:f?'friend:'+f.uid:'activity';}
function renderMessages(){
 const host=$('#messages'),key=conversationKey(),isDM=page==='direct'&&!!friend;
 const items=isDM?[...(conversations[key]??[]).filter(m=>m.author).map(m=>({...m,legacy:true,created_at:new Date(m.time).toISOString()})),...(dm?.view(friend.uid)??[])]:conversations[key]??[];
 const token=JSON.stringify([key,isDM,items,friend?.nickname,friend?.avatar_path,snapshot.me?.nickname,snapshot.me?.avatar_path]);if(token===messageKey)return;
 const scroll=$('.stage-scroll'),atBottom=scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<90,switching=host.dataset.conversation!==key;
 messageKey=token;host.dataset.conversation=key;host.replaceChildren();
 if(isDM&&dm?.views[friend.uid])host.append(button('최근 대화로 이동','dm-latest',friend.uid,{class:'history-button'}));if(isDM&&items.length&&!dm?.historyEnd[friend.uid])host.append(button('이전 메시지 보기','dm-history',friend.uid,{class:'history-button'}));
 let date='',previous;
 for(const item of items){
  const stamp=new Date(item.created_at??item.time),day=stamp.toLocaleDateString('ko-KR');
  if(day!==date){host.append(el('div',day,{class:'message-date',role:'separator'}));date=day;previous=null;}
  const system=item.legacy?!item.author:!isDM&&!item.author;
  if(system){host.append(el('div',item.text,{class:'system-message'}));previous=null;continue;}
  const sender=item.sender,p=sender===loadedUID?snapshot.me:sender===friend?.uid?friend:friendRecord(sender)?.profile;
  const grouped=sender&&previous?.sender===sender&&stamp-new Date(previous.created_at)<300000;
  const row=el('div',null,{class:'message-row'+(grouped?' grouped':'')+(item.status==='sending'?' sending':''),...(item.id?{'data-message-id':item.id}:{})});
  if(!grouped){const avatar=identity(p??{nickname:item.author??'참여자'}).querySelector('.avatar-wrap');row.append(avatar);}
  const content=el('div',null,{class:'message-content'});
  if(!grouped){const header=el('div',null,{class:'message-author'});header.append(el('strong',p?.nickname??item.author??'참여자'),el('time',stamp.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}),{datetime:stamp.toISOString(),title:stamp.toLocaleString('ko-KR')}));content.append(header);}
  content.append(el('div',item.text,{class:'message-text'}));
  if(item.status==='failed')content.append(el('span','보내지 못했습니다.',{class:'send-failed'}),button('다시 보내기','dm-retry',item.client_id,{class:'retry-message'}));
  else if(item.status==='sending')content.append(el('span','보내는 중…',{class:'send-status'}));
  row.append(content);host.append(row);previous=item;
 }
 if(!items.length&&isDM)host.append(el('p','@'+friend.nickname+'님과의 대화가 시작되는 곳이에요.',{class:'conversation-start'}));
 if(switching||atBottom)requestAnimationFrame(()=>{scroll.scrollTop=scroll.scrollHeight;layoutNativeScreens();});
}
function updateDMNavigation(){
 for(const row of $('#channels').querySelectorAll('.dm')){
  const peer=row.dataset.id,latest=dm?.list(peer).at(-1),preview=row.querySelector('.dm-preview'),badge=row.querySelector('.dm-unread');
  if(preview)preview.textContent=latest?.text??'대화를 시작해 보세요.';
  if(badge){const n=dm?.unread[peer]??0;badge.hidden=!n;badge.textContent=n>99?'99+':n;}
 }
}
function message(text,author=null,key=conversationKey()){
 if(!author&&key.startsWith('friend:'))key='activity';const list=conversations[key]??[];list.push({text:String(text).slice(0,2000),author,time:Date.now()});conversations[key]=list.slice(-100);
 const uid=loadedUID;clearTimeout(message.saveTimer);message.saveTimer=setTimeout(()=>{const data=structuredClone(conversations);if(uid)chatSave=chatSave.then(()=>ledger.set('messages:'+uid,data)).catch(error);},150);
 if(key===conversationKey())renderMessages();
}
function closeNav(){
 $('#workspace').classList.remove('nav-open');$('#nav-toggle').setAttribute('aria-expanded','false');$('#nav-scrim').hidden=true;
}
function closePeople(){
 $('#workspace').classList.remove('people-open');document.querySelector('[data-action=toggle-people]').setAttribute('aria-expanded','false');
}
function updateWindowState(value={}){
 windowState={...windowState,...value};const controls=$('#window-controls');controls.hidden=!bridge.native||windowState.platform!=='windows'||!!windowState.systemTitlebar;
 if(value.fullscreen===false&&windowState.platform==='windows'&&(nativeFullscreen||fullscreenID||document.body.classList.contains('viewing-fullscreen')))exitViewingFullscreen();
 const maximize=$('#window-maximize'),restore=windowState.state==='maximized';maximize.replaceChildren(icon(restore?'restore':'maximize',16));maximize.setAttribute('aria-label',restore?'창 이전 크기로 복원':'창 최대화');maximize.title=maximize.getAttribute('aria-label');
 const full=$('#window-fullscreen');full.setAttribute('aria-pressed',String(windowState.fullscreen));full.setAttribute('aria-label',windowState.fullscreen?'앱 전체화면 종료':'앱 전체화면');full.title=full.getAttribute('aria-label')+' · F11';
}
function renderShareState(){
 const host=$('#share-state');if(!host||!media)return;host.hidden=!media.broadcast&&!media.starting;
 const b=media.broadcast,pending=media.starting||b?.pending;host.classList.toggle('preparing',!!pending);
 const text=pending?(windowState.platform==='android'?'화면공유 준비 중 · Android 승인 창에서 전체 화면 또는 공유할 앱을 선택하세요. 앱만 공유하면 다른 앱으로 전환할 때 영상이 멈출 수 있어요.':'화면공유 준비 중 · 시스템의 공유 승인을 기다리고 있어요.'):'내 화면을 공유하고 있어요. 다른 앱의 알림과 개인정보도 보일 수 있어요.';
 const label=host.querySelector('.share-state-label');if(label.textContent!==text)label.textContent=text;
 setButtonLabel(host.querySelector('[data-action=stop]'),pending?'취소':'공유 중지','stop');
 const measurement=host.querySelector('.share-measurement'),readings=Object.values(senderDiagnostics);if(measurement){measurement.hidden=!readings.length;measurement.textContent=readings.length?'보내는 쪽 · '+(readings[0].disposition?.sender?.text??'측정 대기')+' / 받는 쪽 '+readings.length+'명 · '+(readings.every(s=>s.receiver?.frames>0)?'영상 수신 확인':'수신 측정 대기'):'';}
}
function appendConnectionComparison(card,stats){
 const comparison=el('div',null,{class:'connection-comparison'}),value=stats.disposition;
 for(const[key,label]of[['sender','보내는 쪽'],['receiver','받는 쪽'],['path','연결 경로']]){const item=el('div',null,{class:'connection-chip '+(value?.[key]?.state??'unknown')});item.append(el('strong',label),el('span',value?.[key]?.text??'측정 대기'));comparison.append(item);}
 card.append(comparison);if(value?.explanation)card.append(el('p',value.explanation,{class:'form-help'}));
}
function settingsNavigation(active){
 const nav=el('nav',null,{class:'settings-navigation','aria-label':'사용자 설정'});
 nav.append(el('h2','사용자 설정'));
 for(const[id,text,action]of [['profile','프로필','profile-tab'],['account','내 계정','profile-tab'],['app','앱 설정','settings']])nav.append(button(text,action,action==='profile-tab'?id:null,{class:active===id?'active':'','aria-current':active===id?'page':'false'}));
 nav.append(el('h2','앱 및 연결'),button('연결 상태','quality-details'),el('div',null,{class:'settings-nav-divider'}),button('로그아웃','logout',null,{class:'danger settings-logout'}));
 return nav;
}
function diagnosticSnapshot(){
 const source=media?.stream?.getVideoTracks?.()[0]?.getSettings?.();
 return sanitizeDiagnostics({version:VERSION,platform:windowState.platform,networkOnline:navigator.onLine,at:new Date().toISOString(),sharing:media?.broadcast?{transport:media.broadcast.transport,pending:media.broadcast.pending,target:media.broadcast.quality,source}:null,receiving:diagnostics,recentEvents:log?.snapshot()??[]});
}
function renderQualityDetails(){
 const host=$('#quality-details');if(!host||host.contains(document.activeElement)&&document.activeElement?.id==='diagnostic-json')return;const rawOpen=host.querySelector('details')?.open;host.replaceChildren();
 const summary=el('div',null,{class:'diagnostic-cards'}),finite=(v,suffix='',digits=0)=>Number.isFinite(v)?v.toFixed(digits)+suffix:'측정 불가';
 const item=(label,value)=>{const card=el('div',null,{class:'diagnostic-card'});card.append(el('span',label,{class:'muted'}),el('strong',value));summary.append(card);};
 item('서버 연결',Date.now()-lastPoll<15000?'연결됨':'재연결 중');item('내 화면공유',media?.starting||media?.broadcast?.pending?'준비 중':media?.broadcast?'송출 중':'공유 안 함');
 host.append(summary,el('p','기본 목표는 고화질 · 최대 60fps입니다. 실제 송신·수신·재생 측정은 기기와 화면 움직임에 따라 달라져요.',{class:'form-help'}));
 for(const[uid,stats]of Object.entries(senderDiagnostics)){const card=el('section',null,{class:'quality-reading'}),peer=friendRecord(uid)?.profile??snapshot.members.find(m=>m.profile.uid===uid)?.profile;card.append(el('h2',(peer?.nickname??'시청자')+'에게 보내는 화면'));appendConnectionComparison(card,stats);card.append(el('p','송신 '+(stats.sender?.width&&stats.sender?.height?stats.sender.width+' × '+stats.sender.height:'해상도 측정 대기')+' · '+finite(stats.sender?.fps,'fps',1)+' / 수신 '+finite(stats.receiver?.fps,'fps',1),{class:'form-help'}));host.append(card);}
 const readings=Object.entries(diagnostics).filter(([id])=>id!=='native'&&media?.watching.has(id));
 for(const[id,stats]of readings){
  const b=snapshot.broadcasts.find(b=>b.id===id),card=el('section',null,{class:'quality-reading'});card.append(el('h2',(b?.profile?.nickname??'참여자')+'님의 화면'));
  appendConnectionComparison(card,stats);
  const measured=stats.qualityMeasured!==false&&stats.frames>0,grid=el('dl',null,{class:'quality-metrics'});
  for(const[label,value]of [['해상도',stats.width&&stats.height?stats.width+' × '+stats.height:'측정 불가'],['실제 FPS',stats.frames>0?finite(stats.fps,' fps',1):'첫 영상 대기'],['왕복 지연',measured?finite(stats.rtt,' ms'):'측정 불가'],['패킷 손실',measured?finite(stats.loss,'%',1):'측정 불가'],['지터',measured?finite(stats.jitter,' ms',1):'측정 불가'],['코덱',stats.codec??'측정 불가']])grid.append(el('dt',label),el('dd',value));
  const network=measured&&(stats.rtt>350||stats.loss>3||stats.jitter>60),slow=stats.frames>0&&stats.fps<40;
  grid.append(el('dt','재생 FPS'),el('dd',stats.presentationMeasured?finite(stats.presentationFPS,' fps',1):'측정 대기'),el('dt','하위 1% FPS'),el('dd',stats.presentationMeasured?finite(stats.fpsLow1,' fps',1):'측정 대기'));
  card.append(grid,el('p',network?'지연이나 손실이 높아요. 어느 쪽 인터넷이 원인인지 이 값만으로 확정할 수는 없어요.':slow?'수신 프레임이 낮아요. 송신·수신 측정과 재생 간격을 함께 확인하세요.':measured?'현재 지연과 손실을 함께 확인하세요. 순간 측정값만으로 전체 품질을 판단할 수는 없어요.':'이 수신 경로에서는 네트워크 품질을 아직 측정할 수 없어요.',{class:'form-help'}));host.append(card);
 }
 if(!readings.length)host.append(el('p',media?.broadcast?'내 송출의 상세 기록은 아래 진단에 있어요. 네트워크 원인을 확인하려면 상대방의 실제 수신 FPS·지연·손실도 함께 확인하세요.':'화면을 시청하면 실제 FPS와 네트워크 상태가 여기에 표시됩니다.',{class:'empty-diagnostics muted'}));
 const raw=el('details',null,{class:'advanced-settings'});raw.open=!!rawOpen;raw.append(el('summary','상세 진단 기록'),el('pre',JSON.stringify(diagnosticSnapshot(),null,2),{id:'diagnostic-json',tabindex:'0'}));host.append(raw);
}
function qualityModal(){
 const body=el('div',null,{class:'quality-dialog'});body.append(el('div',null,{id:'quality-details'}));const actions=el('div',null,{class:'diagnostic-actions'});actions.append(button('새로고침','quality-refresh'),button('진단 복사','diagnostics-copy'),button('진단 파일 저장','diagnostics-save'));body.append(actions,el('p',null,{id:'diagnostic-status',role:'status',class:'form-help'}));modal('연결 및 화면공유 상태',body);renderQualityDetails();
}
function showSelf(online){
 if(!snapshot.me)return;const host=$('#self-profile'),key=JSON.stringify([snapshot.me.nickname,snapshot.me.user_id,snapshot.me.avatar_path,online,snapshot.me.presence_preference]);
 if(host.dataset.identity!==key){host.replaceChildren(identity(snapshot.me,online));host.dataset.identity=key;}
 const status=presenceFor(snapshot.me,online),control=$('#self-status');if(control){control.replaceChildren(el('span',null,{class:'presence '+status,'aria-hidden':'true'}));control.setAttribute('aria-label','상태 변경 · '+presenceLabels[status]);control.title=control.getAttribute('aria-label');}
}
function friendRecord(uid){return snapshot.friends.find(f=>f.profile.uid===uid);}
function sessionFor(uid){return snapshot.sessions.find(s=>s.state!=='ended'&&[s.a,s.b].includes(uid));}
async function openDirectShare(uid){
 const epoch=navigationEpoch;await api.rpc('direct_open',{target:uid});await poll(true);
 if(epoch!==navigationEpoch||friend?.uid!==uid)throw new DOMException('화면공유 시작이 취소되었습니다.','AbortError');
 const session=sessionFor(uid);if(session?.state!=='accepted')throw new Error('개인 화면공유 연결을 준비하지 못했습니다. 다시 시도하세요.');
 scope={kind:'direct',id:session.id};uiKey='';render();return scope;
}
function selectedScope(){if(scope)return scope;if(friend)return{kind:'friend',id:friend.uid};throw new Error('친구 또는 채널을 먼저 선택하세요.');}
function activeSession(s){return snapshot.sessions.find(x=>x.id===s?.id&&x.state==='accepted');}
function persistNavigation(){if(loadedUID)ledger.set('navigation:'+loadedUID,{server,friend:friend?.uid,page,channel:scope?.kind==='channel'?scope.id:null}).catch(error);}
async function leaveChannel(){
 const previous=joinedChannel??(scope?.kind==='channel'?scope.id:null);if(!previous)return;
 if(media.broadcast?.scope.kind==='channel'&&media.broadcast.scope.id===previous)await media.stop();
 await api.rpc('channel_leave');joinedChannel=null;if(scope?.kind==='channel'&&scope.id===previous)scope=null;
}
async function leaveOtherViews(next){
 for(const[id,watch]of media.watching)if(watch.broadcast.scope_kind!==next?.kind||watch.broadcast.scope_id!==next?.id)await media.unwatch(id);
}
function navigate(change){
 const request=++navigationEpoch,epoch=accountUIEpoch,uid=loadedUID;
 const current=()=>!loggingOut&&epoch===accountUIEpoch&&request===navigationEpoch&&api.session?.user?.id===uid;
 navigationBusy=true;uiKey='';render();
 const pending=navigationSerial.catch(()=>{}).then(async()=>{if(current())await change(current);});
 navigationSerial=pending.catch(()=>{});return pending.finally(()=>{if(request===navigationEpoch){navigationBusy=false;uiKey='';render();}});
}
async function selectFriend(uid){return navigate(async current=>{
 await leaveChannel();if(!current())return;
 const f=friendRecord(uid);if(!f||f.status!=='accepted')throw new Error('수락된 친구 관계가 필요합니다.');
 friend=f.profile;server=null;page='direct';messageKey='';$('#messages').dataset.conversation='';dm?.select(uid);dm?.history(uid).catch(error);
 const s=sessionFor(uid);scope=s?.state==='accepted'?{kind:'direct',id:s.id}:null;
 await leaveOtherViews(scope);if(!current())return;
 closeNav();uiKey='';render();persistNavigation();
});}
async function enterChannelOnce(id,current){
 const c=snapshot.channels.find(c=>c.id===id);if(!c)throw new Error('채널을 찾을 수 없습니다.');
 if(scope?.kind==='channel'&&scope.id===id&&joinedChannel===id){server=c.server_id;friend=null;page='channel';uiKey='';closeNav();render();persistNavigation();return;}
 if(media.broadcast)await media.stop();
 if(!current())return;await api.rpc('channel_enter',{id});joinedChannel=id;if(!current())return;
 await leaveOtherViews({kind:'channel',id});if(!current())return;
 server=c.server_id;scope={kind:'channel',id};friend=null;page='channel';
 closeNav();uiKey='';await poll();if(current()){render();persistNavigation();}
}
async function enterChannel(id){return navigate(current=>enterChannelOnce(id,current));}
async function selectServer(id){return navigate(async current=>{
 if(!snapshot.servers.some(s=>s.id===id))throw new Error('서버에 참여해 주세요.');
 const c=snapshot.channels.find(c=>c.server_id===id);
 if(c)await enterChannelOnce(c.id,current);else{await leaveChannel();if(!current())return;server=id;friend=null;scope=null;page='channel';uiKey='';render();persistNavigation();}
});}
async function pollOnce(){
 if(polling||loggingOut||!api.session||!media)return;polling=true;
 try{
  const next=await api.rpc('sync',{cursor,dm_cursor:dm?.cursor??0,presence_active:windowState.platform==='windows'||!document.hidden&&!nativeBackground});if(loggingOut||api.session?.user?.id!==loadedUID)return;lastPoll=Date.now();media.lastServerContact=lastPoll;snapshot=next;dm?.merge(next.messages);delete snapshot.messages;
  if(friend){const f=friendRecord(friend.uid);if(f?.status==='accepted')friend=f.profile;else{friend=null;scope=null;page='friends';}}
  if(server&&!snapshot.servers.some(s=>s.id===server)){server=null;scope=null;page='friends';}
  if(scope?.kind==='channel'&&!snapshot.channels.some(c=>c.id===scope.id)){await media.stop();scope=null;page=server?'channel':'friends';}
  if(friend){const s=sessionFor(friend.uid);const before=scope;scope=s?.state==='accepted'?{kind:'direct',id:s.id}:null;if(before?.kind==='direct'&&!scope)message('개인 연결이 종료되었습니다.');}
  for(const signal of next.signals??[]){if(!signalQueue?.enqueue(signal))break;cursor=Math.max(cursor,signal.id);}
  lastPoll=Date.now();$('#connection').textContent='온라인 · '+VERSION;showSelf(true);
  await media.update(snapshot);await files.reconcile(snapshot);
  const liveIDs=new Set(snapshot.broadcasts.map(b=>b.id));for(const id of autoWatchDisabled)if(!liveIDs.has(id))autoWatchDisabled.delete(id);for(const id of autoWatchAttempt.keys())if(!liveIDs.has(id))autoWatchAttempt.delete(id);
  if(Date.now()-(files.lastRecovery??0)>5000){files.lastRecovery=Date.now();await files.reconnect();}
  if(scope)for(const b of snapshot.broadcasts.filter(b=>b.scope_kind===scope.kind&&b.scope_id===scope.id&&b.publisher!==loadedUID)){
   if(media.watching.size+[...media.joining.keys()].filter(id=>!media.watching.has(id)).length>=(settings.maxReceive??4))break;
   if(!media.watching.has(b.id)&&!autoWatchDisabled.has(b.id)&&Date.now()-(autoWatchAttempt.get(b.id)??0)>5000){
    const engine=media,epoch=accountUIEpoch,current=()=>media===engine&&epoch===accountUIEpoch&&scope?.kind===b.scope_kind&&scope?.id===b.scope_id;
    autoWatchAttempt.set(b.id,Date.now());engine.watch(b).then(()=>{if(current()&&engine.watching.has(b.id))video({id:b.id});}).catch(e=>{if(current()){autoWatchAttempt.set(b.id,Date.now()+10000);renderVideoFailure(b.id,e);}}).finally(()=>{if(current()){uiKey='';render();}});
   }
  }
  render();
 }catch(e){if(!loggingOut){if(e.localSignedOut){await recoverSignedOut();}else if(api.session){$('#connection').textContent='재연결 중';showSelf(false);if(Date.now()-lastPoll>15000)error(e);}}}
 finally{polling=false;}
}
async function boot(){
 // Only startup reads the session vault; a second init cancels an active PKCE exchange.
 await authReady;if(loggingOut)return;if(bootPromise){await bootPromise;return boot();}const pending=bootOnce();bootPromise=pending;try{await pending;}finally{if(bootPromise===pending)bootPromise=null;}
}
async function bootOnce(){
 if(booting||loggingOut)return;booting=true;const epoch=accountUIEpoch;let uid;
 const current=()=>!loggingOut&&accountUIEpoch===epoch&&(!uid||api.session?.user?.id===uid);
 try{
  if(!current())return;if(!api.session){showAuth('login',authReturnSeen?$('#onboarding-status').textContent:'');return;}uid=api.session.user.id;
  if(api.deletionPending){await deletionRetryScreen();return;}
  let me=await api.rpc('profile');if(!current())return;
  if(!me){
   const m=api.session.user?.user_metadata??{};
   if(m.solaris_user_id&&m.solaris_nickname){try{me=await api.rpc('profile',{user_id:m.solaris_user_id,nickname:m.solaris_nickname});}catch(e){if(/duplicate|unique/i.test(e.message)){showAuth('claim','이미 사용 중인 ID입니다. 새 고유 ID를 선택하세요.');$('#register [name=nickname]').value=m.solaris_nickname;return;}throw e;}}
   if(!current())return;if(!me){showAuth('claim');return;}
  }
  clearInterval(timer);signalQueue?.close();exitViewingFullscreen();nativeScreens.clear();if(media&&media.ownerUID!==me.uid)await media.stop();media?.close();files?.close();await dm?.close();clearTimeout(message.saveTimer);if(loadedUID)await ledger.set('messages:'+loadedUID,structuredClone(conversations));await log?.flush();await chatSave;
  if(!current())return;
  if(loadedUID!==me.uid){for(const value of avatarCache.values())Promise.resolve(value).then(url=>{if(url)URL.revokeObjectURL(url);});avatarCache.clear();}
  navigationEpoch++;navigationBusy=false;joinedChannel=null;loadedUID=me.uid;snapshot=emptySnapshot();snapshot.me=me;scope=null;server=null;friend=null;cursor=0;page='friends';uiKey='';
  const storedMessages=await ledger.get('messages:'+me.uid)??{};if(!current())return;conversations=storedMessages;messageKey='';drafts={};$('#chat').dataset.conversation='';$('#chat textarea').value='';dm=new DirectMessages(api,ledger,me.uid);await dm.init();if(!current())return;dm.addEventListener('change',()=>{if(current()){updateDMNavigation();renderMessages();}});dm.addEventListener('error',e=>{if(current())error(e.detail);});diagnostics={};autoWatchDisabled.clear();autoWatchAttempt.clear();clearVideos();
  log=new DiagnosticLog(ledger,me.uid);await log.load();if(!current())return;log.record('app-start',{version:VERSION});
  media=new Media(api,bridge,settings);files=new Transfers(api,disk,ledger,media.ice,()=>!!media?.broadcast||!!media?.watching.size);await files.init();if(!current())return;
  const ownedMedia=media,ownedFiles=files,listen=(target,type,handler)=>target.addEventListener(type,e=>{if(current()&&media===ownedMedia&&files===ownedFiles)handler(e);});
  signalQueue=new SignalQueue({dispatch:s=>handle(s,ownedMedia,ownedFiles),isCurrent:()=>current()&&media===ownedMedia&&files===ownedFiles,onError:error});
  listen(media,'error',e=>error(e.detail));
  listen(media,'starting',()=>{uiKey='';render();});
  listen(media,'broadcast',e=>{
   const b=e.detail;if(!b)senderDiagnostics={};log.record(b?.pending?'broadcast-preparing':b?'broadcast-start':'broadcast-stop',{transport:b?.transport});
   if(b){scope=b.scope;page=scope.kind==='channel'?'channel':'direct';if(scope.kind==='channel'){server=snapshot.channels.find(c=>c.id===scope.id)?.server_id??server;friend=null;}else{const s=activeSession(scope);if(s)friend=friendRecord(s.a===loadedUID?s.b:s.a)?.profile??friend;server=null;}}
   message(b?.pending?'시스템 화면공유 시작을 기다리고 있습니다.':b?'화면공유를 시작했습니다.':'화면공유를 종료했습니다.');uiKey='';render();
  });
  listen(media,'track',e=>video(e.detail));
  listen(media,'sender-quality',e=>{senderDiagnostics[e.detail.viewerID]=e.detail.stats;renderShareState();if($('#dialog').open&&$('#quality-details'))renderQualityDetails();});
  listen(media,'state',e=>{if(['failed','disconnected','connecting','reconnecting'].includes(e.detail.state)){const card=document.getElementById('video-'+e.detail.id);if(card&&!card.classList.contains('video-failed')&&!card.querySelector('.video-waiting'))card.append(el('div','화면을 다시 연결하고 있습니다…',{class:'video-waiting'}));layoutNativeScreens();}});
  listen(media,'removed',e=>{nativeScreens.delete(e.detail);if(fullscreenID===e.detail||!media.watching.size)exitViewingFullscreen();removeVideo(e.detail);layoutNativeScreens();delete diagnostics[e.detail];uiKey='';render();});
  listen(media,'view-failed',e=>{autoWatchDisabled.add(e.detail.id);renderVideoFailure(e.detail.id,e.detail.error);});
  listen(media,'quality',e=>{
   const q=document.getElementById('quality-'+e.detail.id);
   if(q){q.replaceChildren(el('span',null,{class:'quality-dot '+e.detail.grade.color}),document.createTextNode(e.detail.grade.text+' · '+(e.detail.stats.width??0)+'×'+(e.detail.stats.height??0)+' · '+(e.detail.stats.fps??0).toFixed(1)+'fps'));q.title=(e.detail.stats.codec??'')+' · RTT '+(Number.isFinite(e.detail.stats.rtt)?Math.round(e.detail.stats.rtt)+'ms':'측정 불가');}
   const v=document.querySelector('#video-'+e.detail.id+' video');if(e.detail.stats.frames>0&&!['failed','disconnected'].includes(e.detail.stats.state)){document.querySelector('#video-'+e.detail.id+' .video-waiting')?.remove();if(v&&e.detail.stats.width&&e.detail.stats.height)v.style.aspectRatio=e.detail.stats.width+'/'+e.detail.stats.height;layoutNativeScreens();}
   diagnostics[e.detail.id]=e.detail.stats;
   const receiver=e.detail.stats.receiver??e.detail.stats,sender=e.detail.stats.sender,state=receiver.state??'connecting',label=document.querySelector('#video-'+e.detail.id+' .receive-state');
   if(label)label.textContent='받는 쪽 · '+({connected:'연결됨',sharing:'수신 중',connecting:'연결 중',reconnecting:'재연결 중',disconnected:'연결 끊김',failed:'연결 실패'}[state]??state)+(receiver.frames>0?' · '+(receiver.fps??0).toFixed(1)+'fps':' · 첫 화면 대기')+(sender?' / 보내는 쪽 · '+(sender.width&&sender.height?sender.width+'×'+sender.height:'해상도 측정 대기')+' · '+(Number.isFinite(sender.fps)?sender.fps.toFixed(1)+'fps':'FPS 측정 대기'):'');
   if($('#dialog').open&&$('#quality-details'))renderQualityDetails();
  });
  listen(media,'diagnostics',e=>{diagnostics.native=e.detail;if($('#dialog').open&&$('#quality-details'))renderQualityDetails();});
  listen(files,'change',e=>{
   if(e.detail.state==='failed'&&!files.failureNotifications?.has(e.detail.id)){files.failureNotifications??=new Set();files.failureNotifications.add(e.detail.id);notify('파일 전송 실패',e.detail.name);message(e.detail.name+' 전송 실패 · 이어받기를 확인하세요.');}
   if(page==='transfers'&&!files.renderTimer)files.renderTimer=setTimeout(()=>{ownedFiles.renderTimer=null;if(current()&&files===ownedFiles)renderTransfers();},250);
   updateBadges();
  });
  listen(files,'offer',e=>{message(e.detail.name+' 파일 전송 요청이 도착했습니다.');page='transfers';uiKey='';renderTransfers();render();notify('파일 수신 요청',e.detail.name);});
  listen(files,'complete',e=>{log.record('file-complete',{direction:e.detail.direction,size:e.detail.size});message(e.detail.name+' 전송 완료 · SHA-256 확인');notify('파일 전송 완료',e.detail.name);});
  listen(files,'error',e=>error(e.detail));
  const restoreEpoch=navigationEpoch;$('#onboarding').hidden=true;$('#workspace').hidden=false;$('#mobile-tabs').hidden=false;await poll();
  if(!current())return;const saved=await ledger.get('navigation:'+me.uid);if(!current())return;
  if(restoreEpoch===navigationEpoch){
   if(!media.broadcast&&saved?.friend&&friendRecord(saved.friend)?.status==='accepted')await selectFriend(saved.friend);
   else if(!media.broadcast&&saved?.channel&&snapshot.channels.some(c=>c.id===saved.channel))await enterChannel(saved.channel);
   else if(!media.broadcast&&saved?.server&&snapshot.servers.some(s=>s.id===saved.server))await selectServer(saved.server);
   if(saved?.page==='transfers'){page='transfers';renderTransfers();}
  }
  if(current()){render();timer=setInterval(poll,2000);}
 }catch(e){if(e.localSignedOut&&!loggingOut&&!api.session)await recoverSignedOut();else if(current()){showAuth('login','계정 데이터는 유지되어 있습니다. 네트워크를 확인하거나 같은 Google 계정으로 다시 로그인하세요.');error(e);}}
 finally{booting=false;}
}
async function notify(title,body){if(bridge.native&&snapshot.me?.presence_preference!=='dnd')await bridge.call('notify',{title,body}).catch(()=>{});}
async function handle(s,activeMedia=media,activeFiles=files){
 const v=s.payload;if(v.type==='chat'){
  if(typeof v.text==='string'&&v.text.length<=2000){
   const p=friendRecord(s.sender)?.profile??snapshot.members.find(m=>m.profile.uid===s.sender)?.profile;
   message(v.text,p?.nickname??'참여자',s.scope_kind==='channel'?'channel:'+s.scope_id:'friend:'+s.sender);
  }return;
 }
 if(v.type.startsWith('file-')||v.type==='rtc'&&v.peer?.startsWith('files:'))await activeFiles?.handle(s);else await activeMedia?.handle(s);
}
function displayKey(){
 return JSON.stringify({snapshot,page,friend:friend?.uid,server,scope,friendFilter,navigationBusy,watching:[...media.watching.keys()],broadcast:media.broadcast?.id,preparing:media.broadcast?.pending},(key,value)=>['last_seen','updated_at','created_at','signals','rate_limits','messages'].includes(key)?undefined:value);
}
function updateBadges(){
 if(!files)return;const n=[...files.records.values()].filter(r=>['offered','accepted','transferring','paused'].includes(r.state)).length;
 $('#transfer-count').hidden=!n;$('#transfer-count').textContent=n;
}
function render(){
 if(loggingOut||!snapshot.me||!media)return;showSelf(Date.now()-lastPoll<15000);updateBadges();renderShareState();
 const key=displayKey();if(key===uiKey)return;uiKey=key;
 const current=snapshot.servers.find(s=>s.id===server),accepted=snapshot.friends.filter(f=>f.status==='accepted');
 const rail=$('#servers');rail.replaceChildren();
 for(const s of snapshot.servers)rail.append(button(s.name.slice(0,2),'server',s.id,{class:server===s.id?'active':'',title:s.name,'aria-label':s.name,'aria-pressed':String(server===s.id)}));
 $('.home-icon').classList.toggle('active',!server);
 $('#server-title').textContent=current?.name??'개인 메시지';$('#channel-section-title').textContent=current?'화면공유 채널':'개인 메시지';
 const tools=$('#server-tools');tools.replaceChildren();if(current)tools.append(iconAction('친구 초대','server-invite',server,'plus'),button('⌄','server-settings',server,{'aria-label':'서버 메뉴',title:'서버 메뉴'}));
 $('#channel-add').hidden=!current||current.owner!==loadedUID;$('#channel-add').dataset.id=server??'';
 const cc=$('#channels');cc.replaceChildren();
 if(current)for(const c of snapshot.channels.filter(c=>c.server_id===server)){
  const live=snapshot.broadcasts.filter(b=>b.scope_kind==='channel'&&b.scope_id===c.id),selected=scope?.kind==='channel'&&scope.id===c.id;
  const row=button(null,'channel',c.id,{class:selected?'active':'','aria-current':selected?'page':'false',title:c.name});
  row.append(el('span','#',{class:'channel-symbol'}),el('span',c.name,{class:'channel-name'}));
  if(live.length)row.append(el('span','LIVE '+live.length,{class:'live-label'}));cc.append(row);
 }else for(const f of accepted){const row=button(null,'friend',f.profile.uid,{class:'dm '+(friend?.uid===f.profile.uid?'active':''),'aria-label':f.profile.nickname+' 개인 메시지'});row.append(identity(f.profile,f.online));row.querySelector('.identity .muted').classList.add('dm-preview');row.append(el('span',null,{class:'dm-unread count-badge',hidden:'true'}));cc.append(row);}
 updateDMNavigation();
 if(!cc.childElementCount)cc.append(el('p',current?'아직 채널이 없습니다.':'친구를 추가하면 여기에 표시됩니다.',{class:'muted'}));
 for(const b of $('.side-navigation').querySelectorAll('button'))b.classList.toggle('active',b.dataset.action===page);
 const liveList=$('#broadcast-list');liveList.replaceChildren();
 for(const b of snapshot.broadcasts.filter(b=>b.publisher!==loadedUID&&(b.scope_kind==='direct'&&friend&&b.publisher===friend.uid||b.scope_kind==='channel'&&snapshot.channels.find(c=>c.id===b.scope_id)?.server_id===server))){
  const row=identity(b.profile,true),c=snapshot.channels.find(c=>c.id===b.scope_id);row.querySelector('.identity').append(el('div',c?'# '+c.name:'개인 화면공유',{class:'muted'}));
  row.append(button(media.watching.has(b.id)?'시청 중지':'화면공유 보기',media.watching.has(b.id)?'unwatch':'watch',b.id));liveList.append(row);
 }
 if(!liveList.childElementCount)liveList.append(el('p','진행 중인 방송이 없습니다.',{class:'muted'}));
 const people=$('#participants');people.replaceChildren();
 const members=server?snapshot.members.filter(m=>m.server_id===server):accepted.filter(f=>f.online);
 $('#participants-title').textContent=server?'서버 참여자 — '+members.length:'온라인 친구 — '+members.length;
 for(const m of members){
  const row=el('div',null,{class:'member-row'}),who=identity(m.profile,m.online),profile=button(null,'user-profile',m.profile.uid,{class:'member-profile','aria-label':m.profile.nickname+' 프로필 보기'}),b=snapshot.broadcasts.find(b=>b.publisher===m.profile.uid&&media.watching.has(b.id)),stat=b?diagnostics[b.id]:null;
  profile.append(...who.childNodes);row.append(profile);
  if(stat){const grade=qualityGrade(stat);row.append(el('span',null,{class:'quality-dot '+grade.color,title:grade.text,'aria-label':grade.text}));}
  if(m.profile.uid!==loadedUID)row.append(iconAction(m.profile.nickname+' 참여자 메뉴','member-menu',m.profile.uid,'more',{class:'member-menu','aria-haspopup':'dialog'}));people.append(row);
 }
 if(!people.childElementCount)people.append(el('p','온라인 사용자가 없습니다.',{class:'muted'}));
 if(page==='direct'&&friend){people.replaceChildren(profileCard(friend,friendRecord(friend.uid)?.online));$('#participants-title').textContent='사용자 프로필';}
 $('#requests').replaceChildren();$('#requests').closest('.request-section').hidden=true;
 $('#request-count').hidden=true;$('#incoming-request').hidden=true;
 $('#scope-title').textContent=page==='transfers'?'파일 전송':page==='channel'?(snapshot.channels.find(c=>c.id===scope?.id)?.name??current?.name??'채널'):page==='direct'?friend?.nickname??'개인 메시지':'친구';
 $('#scope-symbol').replaceChildren(icon(page==='channel'?'hash':page==='transfers'?'files':page==='direct'?'message':'friends',24));
 $('#scope-symbol').hidden=page==='direct'&&!!friend;$('#scope-avatar').hidden=page!=='direct'||!friend;
 if(page==='direct'&&friend){const key=JSON.stringify([friend.uid,friend.avatar_path,friend.nickname,friendRecord(friend.uid)?.online]);if($('#scope-avatar').dataset.identity!==key){$('#scope-avatar').replaceChildren(identity(friend,friendRecord(friend.uid)?.online).querySelector('.avatar-wrap'));$('#scope-avatar').dataset.identity=key;}}
 $('#scope-title').dataset.action=page==='direct'?'friend-profile':'';$('#scope-title').dataset.id=friend?.uid??'';
 $('#scope-status').textContent=page==='direct'?(scope?(capabilities.canPublish?'화면공유 연결됨 · 공유를 시작하거나 상대방 화면을 시청하세요.':'화면공유 수신 연결됨 · 상대방이 공유를 시작하면 화면이 표시돼요.'):friendRecord(friend?.uid)?.online?presenceLabels[friendRecord(friend?.uid)?.presence_status??'online']:'오프라인 · 메시지를 남겨보세요.'):page==='channel'?(capabilities.canPublish?'이 채널에서 화면과 파일을 공유하세요.':'수신 전용 · 방송 중인 화면을 선택해 시청하세요.'):page==='transfers'?'원본 파일 · 전송 수락 · 이어받기 · SHA-256 확인':'친구와 간편하게 화면과 파일을 공유하세요.';
 for(const card of $('#videos').querySelectorAll('.video-failed'))if(!snapshot.broadcasts.some(b=>'video-'+b.id===card.id))card.remove();
 $('#stage').dataset.page=page;$('.messages').hidden=!['direct','channel'].includes(page);$('#chat').hidden=!['direct','channel'].includes(page);if(page!=='direct')dm?.select(null);
 $('#friend-tabs').hidden=page!=='friends';
 const tabs=$('#friend-tabs');tabs.replaceChildren();for(const [id,text]of [['online','온라인'],['all','모두'],['pending','대기 중'],['blocked','차단 목록'],['add','친구 추가']])tabs.append(button(text,'friend-filter',id,{class:(friendFilter===id?'active ':'')+(id==='add'?'add-friend':'')}));
 $('#session-controls').hidden=!scope&&!friend&&!media.broadcast&&!media.starting;
 $('#share').hidden=!capabilities.canPublish||!!media.broadcast||!!media.starting;$('#stop').hidden=!capabilities.canPublish||!media.broadcast&&!media.starting;$('#share').disabled=navigationBusy||(!scope&&!friend)||!!media.starting;setButtonLabel($('#share'),'화면공유 시작','screen');setButtonLabel($('#stop'),media.starting?'시작 취소':'공유 중지','stop');
 $('#compose-attach').disabled=navigationBusy||!scope&&!friend;
 document.querySelector('[data-action="end-session"]').disabled=!scope;
 const compose=conversationKey(),prior=$('#chat').dataset.conversation;if(prior!==compose){if(prior)drafts[prior]=$('#chat textarea').value;$('#chat textarea').value=drafts[compose]??'';$('#chat textarea').style.height='auto';$('#chat').dataset.conversation=compose;}
 $('#chat textarea').disabled=!scope&&!friend;$('#chat-send').disabled=!scope&&!friend;
 $('#chat textarea').placeholder=friend?'@'+friend.nickname+'에게 메시지 보내기':scope?.kind==='channel'?'#'+$('#scope-title').textContent+'에 메시지 보내기':'친구나 채널을 선택하세요.';
 $('#messages-title').textContent=friend?'개인 메시지':'채널 메시지';$('#composer-help').textContent=matchMedia('(pointer: coarse)').matches?'줄바꿈 · 보내기 버튼으로 전송':'Enter로 보내기 · Shift+Enter로 줄바꿈';
 const connection=$('#sidebar-connection');connection.hidden=!scope&&!media.broadcast;connection.replaceChildren();if(scope||media.broadcast)connection.append(el('span','● '+(media.broadcast?'화면 송출 중':scope.kind==='direct'?'화면공유 연결됨':'# '+(snapshot.channels.find(c=>c.id===scope.id)?.name??'채널'))),button('연결 상태','quality-details',null,{'aria-label':'연결 상태 확인'}));
 if(page==='friends')renderFriends();else if(page==='direct')renderDirect();else if(page==='channel')renderChannel();
 const toolbar=$('#session-controls'),header=$('#header-actions')??$('.stage-header');if(['direct','channel'].includes(page)){if(toolbar.parentElement!==header)header.insertBefore(toolbar,header.querySelector('[data-action=toggle-people]'));}else if(toolbar.parentElement===header)$('#stage').insertBefore(toolbar,$('#chat'));
 $('#session-more').disabled=!scope&&!friend;
 for(const b of $('#mobile-tabs').children){const active=b.dataset.action==='mobile-friends'?page==='friends':b.dataset.action==='mobile-files'?page==='transfers':b.dataset.action==='mobile-menu'?['direct','channel'].includes(page):false;b.classList.toggle('active',active);b.setAttribute('aria-current',active?'page':'false');}
 refreshVideoIdentities();renderMessages();
}
function emptyState(title,text){
 const n=el('div',null,{class:'empty-state'});n.append(el('div','◉',{class:'empty-mark'}),el('h2',title),el('p',text));return n;
}
function renderFriends(){
 const panel=$('#panel');panel.dataset.page='friends';const adding=friendFilter==='add';
 let form=panel.querySelector('#friend-search');
 if(!form||form.dataset.mode!==(adding?'add':'filter')){
  form=el('form',null,{id:'friend-search','data-mode':adding?'add':'filter'});
  const input=el('input',null,{name:adding?'user_id':'filter',placeholder:adding?'친구의 고유 ID로 추가하기':'친구 이름 또는 ID 검색','aria-label':adding?'친구 고유 ID':'친구 목록 검색'});input.value=adding?searchDraft:friendListQuery;
  input.addEventListener('input',()=>{if(adding)searchDraft=input.value;else{friendListQuery=input.value;renderFriends();}});form.append(input);
  if(adding){input.required=true;form.append(el('button','검색',{class:'primary'}));}else form.addEventListener('submit',e=>{e.preventDefault();e.stopPropagation();});
 }
 for(const child of [...panel.children])if(child!==form)child.remove();if(form.parentElement!==panel)panel.prepend(form);
 if(friendFilter==='add'){panel.append(emptyState('친구 추가','중복될 수 있는 닉네임 대신 고유 ID로 친구를 찾아보세요.'));return;}
 if(friendFilter==='blocked'){
  panel.append(el('h2','차단한 사용자 — '+snapshot.blocks.length));
  for(const p of snapshot.blocks){const row=identity(p);row.append(button('차단 해제','unblock',p.uid));panel.append(row);}
  if(!snapshot.blocks.length)panel.append(emptyState('차단한 사용자가 없습니다.','친구 메뉴에서 사용자 차단을 관리할 수 있어요.'));return;
 }
 const friends=snapshot.friends.filter(f=>!friendListQuery||[f.profile.nickname,f.profile.user_id].some(v=>v?.toLocaleLowerCase().includes(friendListQuery.toLocaleLowerCase()))).filter(f=>friendFilter==='pending'?f.status==='pending':f.status==='accepted'&&(friendFilter!=='online'||f.online));
 panel.append(el('h2',(friendFilter==='pending'?'대기 중':friendFilter==='online'?'온라인':'친구')+' — '+friends.length));
 for(const f of friends){
  const row=el('div',null,{class:'row friend-row'}),who=identity(f.profile,f.status==='accepted'?f.online:undefined),main=button(null,f.status==='accepted'?'friend':'friend-profile',f.profile.uid,{class:'friend-row-main','aria-label':f.profile.nickname+(f.status==='accepted'?' 대화 열기':' 프로필 보기')}),actions=el('div',null,{class:'row-actions friend-action-group'});
  main.append(...who.childNodes);row.append(main);
  if(f.status==='accepted')actions.append(iconAction(f.profile.nickname+' 메시지 보내기','friend',f.profile.uid,'message'));
  else if(f.requester===loadedUID)actions.append(el('span','보낸 친구 요청',{class:'friend-request-label muted'}),iconAction('취소','friend-cancel',f.profile.uid,'close',{title:f.profile.nickname+'에게 보낸 친구 요청 취소'}));
  else actions.append(iconAction('수락','friend-accept',f.profile.uid,'check',{title:f.profile.nickname+' 친구 요청 수락'}),iconAction('거절','friend-reject',f.profile.uid,'close',{title:f.profile.nickname+' 친구 요청 거절'}));
  actions.append(iconAction(f.profile.nickname+' 친구 메뉴','friend-menu',f.profile.uid,'more',{class:'row-menu','aria-haspopup':'dialog'}));row.append(actions);panel.append(row);
 }
 if(!friends.length)panel.append(emptyState('함께할 친구를 찾아보세요.','친구 추가에서 고유 ID로 친구 요청을 보낼 수 있어요.'));
}
function renderDirect(){
 const panel=$('#panel');panel.dataset.page='direct';panel.replaceChildren();if(!friend)return;
 const profile=el('div',null,{class:'dm-profile'});profile.append(identity(friend,friendRecord(friend.uid)?.online),el('p',friend.bio||'@'+friend.nickname+'님과의 개인 메시지입니다.',{class:'profile-bio muted'}));panel.append(profile);
 panel.append(el('p',capabilities.canPublish?'화면공유 시작을 누르면 이 대화에 내 화면이 바로 표시돼요.':'상대방이 화면공유를 시작하면 이 대화에서 바로 볼 수 있어요.',{class:'share-help muted'}));
}
function renderChannel(){
 const panel=$('#panel');panel.dataset.page='channel';panel.replaceChildren();
 const c=snapshot.channels.find(c=>c.id===scope?.id);
 if(!c){panel.append(emptyState('채널을 선택하세요.','서버의 채널에서 화면과 파일을 공유할 수 있어요.'));return;}
 const live=snapshot.broadcasts.filter(b=>b.scope_kind==='channel'&&b.scope_id===c.id&&b.publisher!==loadedUID);
 const members=snapshot.members.filter(m=>m.channel_id===c.id);
 panel.append(el('h2','현재 채널 — 참여자 '+members.length+'명 · 방송 '+live.length+'개'));
 if(!live.length&&!media.broadcast){const welcome=emptyState('# '+c.name+'에 오신 것을 환영해요.',capabilities.canPublish?'공유를 시작하면 같은 채널의 참여자에게 바로 표시돼요.':'다른 참여자가 화면공유를 시작하면 이곳에 자동으로 표시돼요.');if(capabilities.canPublish)welcome.append(button('내 화면 공유하기','share',null,{class:'primary share-launch'}));panel.append(welcome);}
 for(const b of live){const row=identity(b.profile,true);row.classList.add('broadcast-row');row.append(button(media.watching.has(b.id)?'시청 중지':'화면공유 보기',media.watching.has(b.id)?'unwatch':'watch',b.id,{class:'primary'}));panel.append(row);}
}
async function poll(fresh=false){
 if(pollPromise){await pollPromise;if(!fresh)return;return poll();}
 const pending=pollOnce();pollPromise=pending;try{await pending;}finally{if(pollPromise===pending)pollPromise=null;}
}
const fmt=n=>n>=1024**3?(n/1024**3).toFixed(2)+' GiB':n>=1024**2?(n/1024**2).toFixed(1)+' MiB':Math.round(n/1024)+' KiB';
function renderTransfers(){page='transfers';const p=$('#panel');p.dataset.page='transfers';p.replaceChildren(el('h2','파일 전송 기록'));for(const r of [...files.records.values()].sort((a,b)=>b.updated-a.updated)){const row=el('div',null,{class:'row'}),info=el('div',null,{class:'identity'});info.append(el('strong',r.name),el('div',(r.direction==='send'?'보내기':'받기')+' · '+r.state+' · '+fmt(r.offset)+' / '+fmt(r.size),{class:'muted'}));if(r.error)info.append(el('p',r.error));const progress=el('div',null,{class:'progress'}),bar=el('i');bar.style.width=(r.size?Math.min(100,r.offset/r.size*100):r.state==='complete'?100:0)+'%';progress.append(bar);info.append(progress);const elapsed=Math.max(1,(Date.now()-(r.speedAt??Date.now()))/1000),speed=Math.max(0,r.offset-(r.speedOffset??r.offset))/elapsed;info.append(el('div',fmt(speed)+'/s · '+(speed?Math.ceil((r.size-r.offset)/speed)+'초 남음':'시간 계산 중'),{class:'muted'}));row.append(info);if(r.state==='offered'&&r.direction==='receive')row.append(button('수락','file-accept',r.id),button('거절','file-reject',r.id));if(['accepted','transferring'].includes(r.state))row.append(button('일시정지','file-pause',r.id));if(['paused','failed'].includes(r.state)&&r.retryable!==false){if(r.pauseReason==='manual'&&r.pauseOwner&&r.pauseOwner!==api.session.user.id)row.append(el('span','상대방이 일시정지',{class:'muted'}));else{row.append(button('이어받기','file-resume',r.id));if(r.direction==='send')row.append(button('원본 다시 선택','file-reselect',r.id));}}if(!['complete','cancelled','rejected'].includes(r.state))row.append(button('취소','file-cancel',r.id));if(r.state==='complete'&&r.direction==='receive')row.append(button('저장 / 공유','file-export',r.id));p.append(row);}}
function refreshVideoIdentities(){
 for(const b of snapshot.broadcasts){
  const head=document.querySelector('#video-'+b.id+' .video-head');if(!head)continue;
  const key=JSON.stringify([b.profile.nickname,b.profile.user_id,b.profile.avatar_path]);if(head.dataset.identity===key)continue;
  const who=identity(b.profile,true);who.classList.add('broadcast-identity');head.querySelector('.broadcast-identity')?.replaceWith(who);head.dataset.identity=key;
 }
}
const nativeScreens=new Set();let nativeLayoutHadItems=false;
const videoResize=globalThis.ResizeObserver?new ResizeObserver(()=>layoutNativeScreens()):null;
const nativeLayoutQueue=new NativeLayoutQueue({measure:()=>{
  const workspace=$('#workspace'),blocked=!!document.querySelector('dialog[open]')||workspace.hidden||workspace.classList.contains('nav-open')||workspace.classList.contains('people-open');
  const items=[...nativeScreens].map(id=>{
   const video=document.querySelector('#video-'+id+' video'),r=video?.getBoundingClientRect();if(!r)return{id,visible:false};
   const bounds=[{left:0,top:0,right:innerWidth,bottom:innerHeight}];
   for(let parent=video.parentElement;parent;parent=parent.parentElement){const style=getComputedStyle(parent);if(/auto|scroll|hidden|clip/.test(style.overflow+style.overflowX+style.overflowY))bounds.push(parent.getBoundingClientRect());}
   const clip=clipVideoBounds(r,bounds),ready=!video.closest('.video-card').querySelector('.video-waiting');
   return{id,x:r.x,y:r.y,width:r.width,height:r.height,...clip,visible:!blocked&&ready&&video.getClientRects().length>0&&clip.clipWidth>0&&clip.clipHeight>0};
  });
  if(!items.length&&!nativeLayoutHadItems)return null;nativeLayoutHadItems=items.length>0;return{viewportWidth:innerWidth,items};
 },send:payload=>bridge.call('mediaReceiveLayout',payload)});
function layoutNativeScreens(){if(bridge.native)nativeLayoutQueue.request();}
new MutationObserver(layoutNativeScreens).observe($('#stage'),{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden','style']});
new MutationObserver(layoutNativeScreens).observe($('#workspace'),{attributes:true,attributeFilter:['class','hidden']});
new MutationObserver(layoutNativeScreens).observe($('#dialog'),{attributes:true,attributeFilter:['open']});
window.addEventListener('resize',layoutNativeScreens);document.addEventListener('scroll',layoutNativeScreens,true);
function updateFullscreenLabels(){for(const b of $('#videos').querySelectorAll('[data-action=fullscreen]')){const active=fullscreenID===b.dataset.id&&(!!document.fullscreenElement||nativeFullscreen||nativeScreens.has(fullscreenID));setButtonLabel(b,active?'전체화면 종료':'전체화면','full');b.setAttribute('aria-pressed',String(active));}}
function exitViewingFullscreen(){document.body.classList.remove('viewing-fullscreen');nativeFullscreen=false;fullscreenID=null;resetVideoFullscreen(document,bridge);updateFullscreenLabels();layoutNativeScreens();}
function removeVideo(id){const card=document.getElementById('video-'+id);card?.zoomViewport?.destroy();if(card)videoResize?.unobserve(card.querySelector('video')??card);card?.remove();}
function clearVideos(){for(const card of $('#videos').children)card.zoomViewport?.destroy();$('#videos').replaceChildren();}
function renderVideoFailure(id,e){
 nativeScreens.delete(id);exitViewingFullscreen();removeVideo(id);
 const card=el('article',null,{id:'video-'+id,class:'video-card video-failed',role:'status'});card.append(el('strong','화면공유에 연결하지 못했어요.'),el('p',e?.message??'연결 상태를 확인한 뒤 다시 시도하세요.',{class:'muted'}),button('다시 시청','watch',id,{class:'primary'}));$('#videos').append(card);layoutNativeScreens();
}
function video({id,stream,native=false}){
 let card=document.getElementById('video-'+id);
 if(!card){
  const b=snapshot.broadcasts.find(b=>b.id===id),head=el('div',null,{class:'video-head'});
  card=el('article',null,{id:'video-'+id,class:'video-card'});
  const who=identity(b?.profile,true);who.classList.add('broadcast-identity');
  head.append(who,el('span','연결 중',{id:'quality-'+id,class:'quality'}),iconAction('화면 축소','zoom-out',id,'minus'),button('100%','zoom-reset',id,{class:'zoom-level','aria-label':'화면 확대 초기화'}),iconAction('화면 확대','zoom-in',id,'plus'),button('크게 보기','focus',id),button('전체화면','fullscreen',id),button('시청 중지','unwatch',id));
  const viewport=el('div',null,{class:'video-viewport'}),v=el('video',null,{autoplay:'true',playsinline:'true',controls:'true'});viewport.append(v);
  card.append(head,el('div','화면을 연결하는 중입니다…',{class:'video-waiting'}),viewport,el('p','수신 연결 중',{class:'receive-state',role:'status'}));$('#videos').append(card);
  card.zoomViewport=new VideoViewport(v,{onChange:()=>{const level=card.querySelector('[data-action=zoom-reset]');if(level){level.textContent=viewport.dataset.zoom+'%';level.title='휠·핀치로 확대, 드래그로 이동 · 눌러서 초기화';}layoutNativeScreens();},onFrame:stats=>media?.setPlaybackMetrics?.(id,stats)});
 }
 if(native){nativeScreens.add(id);const v=card.querySelector('video');v.dataset.native='true';videoResize?.observe(v);layoutNativeScreens();}
 if(stream){
  const v=card.querySelector('video');v.onloadeddata=()=>{card.querySelector('.video-waiting')?.remove();layoutNativeScreens();};if(v.readyState>=2)card.querySelector('.video-waiting')?.remove();
  if(v.srcObject!==stream){v.srcObject=stream;v.play().catch(()=>message('영상의 재생 버튼을 눌러주세요.'));}
 }
}
async function fullscreen(id){
 if(fullscreenID===id&&(document.fullscreenElement||nativeFullscreen)){if(document.fullscreenElement)await document.exitFullscreen();exitViewingFullscreen();return;}
 if(fullscreenID===id&&nativeScreens.has(id)&&windowState.platform==='ios'){await bridge.call('mediaReceiveFullscreen',{id,enabled:false});fullscreenID=null;updateFullscreenLabels();return;}
 fullscreenID=id;if(nativeScreens.has(id)&&windowState.platform==='ios'){try{await bridge.call('mediaReceiveFullscreen',{id});updateFullscreenLabels();}catch(e){exitViewingFullscreen();throw e;}return;}
 document.body.classList.add('viewing-fullscreen');const viewing=$('#viewing');document.getElementById('video-'+id)?.classList.add('focused');
 if(document.fullscreenElement){await document.exitFullscreen();return;}
 if(nativeFullscreen){nativeFullscreen=false;viewing.classList.remove('native-fullscreen');await bridge.call('fullscreen',{enabled:false});return;}
 try{const target=document.getElementById('video-'+id);if(target?.requestFullscreen){await target.requestFullscreen();updateFullscreenLabels();return;}}catch{}
 if(bridge.native){nativeFullscreen=true;viewing.classList.add('native-fullscreen');await bridge.call('fullscreen',{enabled:true});updateFullscreenLabels();}
 else document.querySelector('#video-'+id+' video')?.webkitEnterFullscreen?.();
}
async function sendFile(peer,s){
 const online=s.kind==='channel'?snapshot.members.some(m=>m.profile.uid===peer&&m.online&&m.channel_id===s.id):friendRecord(peer)?.online;
 if(!online)throw new Error('수신자가 온라인 상태일 때 파일을 보낼 수 있습니다.');
 const source=await disk.pick();if(!source)return;message('원본 파일의 무결성을 확인하는 중입니다.');
 const result=await files.offer(peer,s,source,{deduplicate:settings.preventDuplicates??true});
 if(result.duplicate)message('같은 친구에게 이미 전송한 파일입니다. 중복 전송을 생략했습니다.');
 page='transfers';renderTransfers();uiKey='';render();persistNavigation();
}
function serverSettings(id){
 const srv=snapshot.servers.find(s=>s.id===id);if(!srv)return;const body=el('div');
 if(srv.owner===loadedUID){
  body.append(el('h2','서버 관리'),button('친구 초대','server-invite',id),button('서버 이름 변경','server-rename',id),el('h2','채널 관리'),button('채널 만들기','channel-create',id));
  for(const c of snapshot.channels.filter(c=>c.server_id===id)){const row=el('div',null,{class:'row'});row.append(el('strong','# '+c.name),button('이름 변경','channel-rename',c.id),button(c.files_enabled?'파일 전송 끄기':'파일 전송 켜기','channel-files',c.id),button('채널 삭제','channel-delete',c.id));body.append(row);}
 }else body.append(button('친구 초대','server-invite',id),el('p','서버 멤버는 누구나 같은 초대코드로 친구를 초대할 수 있어요.',{class:'muted'}));
 const danger=el('section',null,{class:'danger-zone'});
 danger.append(el('h2',srv.owner===loadedUID?'서버 삭제':'서버 탈퇴'),el('p',srv.owner===loadedUID?'서버와 모든 채널이 삭제됩니다.':'탈퇴 후 다시 참여하려면 초대코드가 필요합니다.',{class:'muted'}),srv.owner===loadedUID?button('서버 삭제','server-delete',id):button('서버 탈퇴','server-leave',id));body.append(danger);modal(srv.name+' · 서버 메뉴',body);
}
function profileCard(p,online){
 const card=el('section',null,{class:'profile-card'}),banner=el('div',null,{class:'profile-banner'}),content=el('div',null,{class:'profile-card-content'});
 banner.append(el('span',p?.nickname?.[0]??'S',{class:'profile-banner-letter','aria-hidden':'true'}));card.append(banner);
 content.append(identity(p,online),el('div',null,{class:'profile-divider'}),el('h2','내 소개'),el('p',p?.bio||'아직 소개가 없어요.',{class:'profile-bio'+(p?.bio?'':' muted')}));
 card.append(content);return card;
}
async function profileModal(tab='profile'){
 if(loggingOut||!snapshot.me)return;
 if(tab==='account'){const epoch=accountUIEpoch,uid=loadedUID;await api.account();if(loggingOut||epoch!==accountUIEpoch||api.session?.user?.id!==uid||!snapshot.me)return;}
 const user=api.session?.user??{},body=el('div',null,{class:'profile-settings'}),nav=settingsNavigation(tab),content=el('div',null,{class:'settings-content'});body.append(nav,content);
 const profile=el('section',null,{'data-profile-pane':'profile'});profile.hidden=tab!=='profile';
 const edit=el('form',null,{id:'profile-edit',class:'stack-form'}),preview=profileCard(snapshot.me,true);
 edit.append(field('고유 ID','user_id',{value:snapshot.me.user_id,minlength:'3',maxlength:'32',pattern:'[a-zA-Z0-9_]{3,32}',autocomplete:'username',autocapitalize:'none',spellcheck:'false',required:'true'}),el('p','고유 ID는 친구 검색과 프로필에 사용합니다. 변경해도 Google 로그인과 친구·서버·메시지는 유지됩니다.',{class:'form-help'}),field('표시 이름','nickname',{value:snapshot.me.nickname,maxlength:'32',required:'true'}));
 const label=el('label','내 소개'),bio=el('textarea',null,{name:'bio',rows:'4',maxlength:'380',placeholder:'좋아하는 것, 지금 하고 있는 일… 나를 소개해 보세요.'}),count=el('span',null,{class:'field-counter'});bio.value=snapshot.me.bio??'';label.append(bio,count);edit.append(label);
 const updatePreview=()=>{if(Array.from(bio.value).length>190)bio.value=Array.from(bio.value).slice(0,190).join('');count.textContent=Array.from(bio.value).length+' / 190';preview.querySelector('.profile-bio').textContent=bio.value||'아직 소개가 없어요.';preview.querySelector('.profile-card-content strong').textContent=edit.elements.nickname.value||snapshot.me.nickname;};bio.addEventListener('input',updatePreview);edit.elements.nickname.addEventListener('input',updatePreview);updatePreview();
 edit.append(el('button','변경사항 저장',{class:'primary'}));profile.append(preview,button('상태 변경 · '+presenceLabels[snapshot.me.presence_preference??'online'],'presence-menu',null,{'aria-haspopup':'dialog'}),el('h2','프로필 편집'),edit,el('h2','프로필 사진'));
 const photos=el('div',null,{class:'profile-photo-actions'}),upload=el('label','프로필 사진 변경',{class:'upload-photo-button'});upload.append(el('input',null,{type:'file',accept:'image/jpeg,image/png,image/webp',id:'avatar-file','aria-label':'프로필 사진 변경'}));photos.append(upload,button('사진 삭제','avatar-delete'));profile.append(photos);
 const account=el('section',null,{'data-profile-pane':'account'});account.hidden=tab!=='account';
 account.append(el('h2','Google 계정'),el('p',user.email?'로그인한 Google 계정: '+user.email:'Google 계정으로 로그인했습니다.',{class:'account-summary'}),el('button','Google 계정 사용 중',{type:'button',class:'google-button linked-account',disabled:'true','aria-disabled':'true'}),el('p','모든 기기에서 같은 Google 계정으로 로그인하면 친구·서버·프로필이 유지됩니다. 다른 Google 계정을 사용하려면 로그아웃하세요.',{class:'form-help'}));
 const danger=el('section',null,{class:'danger-zone'});danger.append(el('h2','계정 탈퇴'),el('p','계정과 서버에 저장된 프로필·친구 관계·메시지·소유 서버 및 파일이 삭제됩니다. 복구할 수 없어요.',{class:'form-help'}),button('계정 탈퇴','account-delete',null,{class:'danger'}));account.append(danger);content.append(profile,account);modal('사용자 설정',body);
}
function clearPrivateUI(){
   signalQueue?.close();signalQueue=null;
   snapshot=emptySnapshot();loadedUID=null;conversations={};drafts={};diagnostics={};scope=null;server=null;friend=null;page='friends';uiKey='';messageKey='';cursor=0;lastPoll=0;log=null;googleBusy=false;autoWatchDisabled.clear();autoWatchAttempt.clear();
   for(const value of avatarCache.values())Promise.resolve(value).then(url=>{if(url)URL.revokeObjectURL(url);});avatarCache.clear();
   clearVideos();$('#dialog').close();for(const id of ['videos','messages','panel','channels','servers','participants','requests','broadcast-list','self-profile'])$('#'+id).replaceChildren();
   $('#chat').reset();$('#chat').dataset.conversation='';$('#chat textarea').style.height='auto';$('#share-state').hidden=true;$('#incoming-request').hidden=true;$('#auth-pending').hidden=true;$('#register').reset();localStorage.removeItem('solaris-verification');closeNav();closePeople();
 senderDiagnostics={};joinedChannel=null;$('#scope-title').textContent='';delete $('#scope-title').dataset.id;delete $('#scope-title').dataset.action;$('#scope-avatar').replaceChildren();$('#scope-avatar').removeAttribute('data-identity');$('#self-profile').removeAttribute('data-identity');$('#scope-status').textContent='';$('#sidebar-connection').replaceChildren();$('#server-title').textContent='개인 메시지';$('#server-tools').replaceChildren();$('#channel-add').dataset.id='';$('#chat textarea').placeholder='메시지';
}
async function deletionRetryScreen(mode='deletion',status=''){
 const uid=api.session?.user?.id,revision=api.revision,epoch=++accountUIEpoch,storedUID=loadedUID,ownedMedia=media,ownedFiles=files,ownedDM=dm,ownedLog=log,storedMessages=structuredClone(conversations);
 navigationEpoch++;navigationBusy=false;clearInterval(timer);clearTimeout(message.saveTimer);showAuth(mode,status);$('#dialog').close();
 await Promise.allSettled([ownedMedia?.stop(),ownedFiles?.suspend(),ownedDM?.close(),...(ownedMedia?[...ownedMedia.watching.keys()].map(id=>ownedMedia.unwatch(id)):[])]);
 ownedFiles?.close();ownedMedia?.close();
 await Promise.allSettled([storedUID?ledger.set('messages:'+storedUID,storedMessages):Promise.resolve(),ownedLog?.flush(),chatSave]);
 if(loggingOut||epoch!==accountUIEpoch||revision!==api.revision||api.session?.user?.id!==uid)return false;
 if(files===ownedFiles)files=null;if(media===ownedMedia)media=null;if(dm===ownedDM)dm=null;exitViewingFullscreen();nativeScreens.clear();clearPrivateUI();showAuth(mode,status);return true;
}
function recoverSignedOut(){
 if(loggingOut||api.session)return Promise.resolve(false);
 const revision=api.revision,uid=loadedUID;
 if(signedOutCleanup?.revision===revision&&signedOutCleanup.uid===uid)return signedOutCleanup.promise;
 const cleanup={revision,uid};cleanup.promise=deletionRetryScreen('login','로그인 정보가 만료됐어요. 같은 Google 계정으로 다시 로그인하세요.');signedOutCleanup=cleanup;
 cleanup.promise.then(()=>{if(signedOutCleanup===cleanup)signedOutCleanup=null;},()=>{if(signedOutCleanup===cleanup)signedOutCleanup=null;});return cleanup.promise;
}
async function action(a,id,anchor=null){
 if(loggingOut&&!a.startsWith('window-'))return;
 if(a.startsWith('window-')){
  if(!bridge.native||windowState.platform!=='windows')return;
  if(a==='window-fullscreen'){const enabled=!windowState.fullscreen,value=await bridge.call('fullscreen',{enabled});updateWindowState(value&&typeof value==='object'?value:{fullscreen:enabled});}
  else{const command={'window-minimize':'windowMinimize','window-maximize':'windowMaximize','window-close':'windowClose'}[a];if(command){const value=await bridge.call(command);if(value&&typeof value==='object')updateWindowState(value);}}
  return;
 }
 if(a==='mobile-menu'){await action('toggle-nav');return;}
 if(a==='mobile-friends'){await action('friends');return;}
 if(a==='mobile-files'){await action('transfers');return;}
 if(a==='mobile-profile'){closeNav();await profileModal();return;}
 if(a==='dismiss-error'){$('#error').hidden=true;return;}
 if(a==='profile-tab'){if(id==='account'||!$('#dialog').querySelector('[data-profile-pane]')){await profileModal(id);return;}for(const p of $('#dialog').querySelectorAll('[data-profile-pane]'))p.hidden=p.dataset.profilePane!==id;for(const b of $('#dialog').querySelectorAll('[data-action=profile-tab]')){b.classList.toggle('active',b.dataset.id===id);b.setAttribute('aria-current',b.dataset.id===id?'page':'false');}return;}
 if(a==='account'){await profileModal('account');return;}
 if(a==='presence-menu'){
  const body=el('div',null,{class:'context-menu presence-menu'}),actions=el('div',null,{class:'context-actions'});
  for(const status of ['online','away','dnd','invisible']){const control=button(presenceLabels[status],'presence-set',status,{'aria-pressed':String(snapshot.me.presence_preference===status)});control.prepend(el('span',null,{class:'presence '+status,'aria-hidden':'true'}));actions.append(control);}
  body.append(actions,el('p','숨김은 다른 사람에게 오프라인으로 표시돼요. 방해금지는 앱 알림을 끕니다.',{class:'form-help'}));modal('내 상태',body,{anchor});return;
 }
 if(a==='presence-set'){if(!['online','away','dnd','invisible'].includes(id))return;const epoch=accountUIEpoch,uid=loadedUID;await api.setPresence(id);if(loggingOut||epoch!==accountUIEpoch||api.session?.user?.id!==uid)return;snapshot.me.presence_preference=id;$('#dialog').close();uiKey='';await poll(true);render();return;}
 if(a==='account-delete'){formModal('계정 탈퇴 확인','delete-account-form',[{label:'현재 ID를 입력해 영구 삭제를 확인하세요: '+snapshot.me.user_id,name:'confirm_id',attrs:{required:'true',autocomplete:'off',autocapitalize:'none'}}],'계정 영구 삭제');$('#delete-account-form').prepend(el('p','서버에 저장된 계정 데이터와 소유 서버가 삭제되며 되돌릴 수 없습니다. 기기에 직접 저장한 파일은 별도로 관리하세요.',{class:'account-warning'}));return;}
 if(a==='incoming-requests'){$('#workspace').classList.add('people-open');document.querySelector('[data-action=toggle-people]').setAttribute('aria-expanded','true');$('#requests').scrollIntoView({block:'nearest'});$('#requests button')?.focus();return;}
 if(a==='close-people'){closePeople();document.querySelector('[data-action=toggle-people]').focus();return;}
 if(a==='session-more'){
  const body=el('div',null,{class:'context-menu'}),actions=el('div',null,{class:'context-actions'});actions.append(button('파일 보내기','send-file'),button('연결 및 화면공유 상태','quality-details'));body.append(actions);
  if(scope){const connection=el('section',null,{class:'context-section'});connection.append(button(scope.kind==='channel'?'채널 나가기':'화면공유 연결 종료','end-session',null,{class:'danger'}));body.append(connection);}
  body.append(el('p','메시지는 화면공유 연결을 종료해도 계속 보낼 수 있어요.',{class:'form-help'}));modal('대화 메뉴',body,{anchor});return;
 }
 if(a==='quality-details'||a==='diagnostics'){closeNav();qualityModal();return;}
 if(a==='quality-refresh'){renderQualityDetails();return;}
 if(a==='diagnostics-copy'){
  const value=JSON.stringify(diagnosticSnapshot(),null,2);try{await (bridge.native?bridge.call('copyText',{text:value}):navigator.clipboard.writeText(value));$('#diagnostic-status').textContent='진단을 복사했어요. 인증 토큰과 비밀번호는 포함되지 않습니다.';}catch{const raw=$('#diagnostic-json');raw.closest('details').open=true;const range=document.createRange();range.selectNodeContents(raw);getSelection().removeAllRanges();getSelection().addRange(range);$('#diagnostic-status').textContent='선택한 진단 내용을 복사하세요.';}return;
 }
 if(a==='diagnostics-save'){
  const data=JSON.stringify(diagnosticSnapshot(),null,2),file=new File([data],'Solaris-diagnostics-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',{type:'application/json'});
  if(bridge.native&&['android','ios'].includes(windowState.platform)){if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:'Solaris 진단'});return;}$('#diagnostic-status').textContent='이 기기에서는 진단 복사로 기록을 저장하거나 공유하세요.';return;}
  const url=URL.createObjectURL(file),link=el('a',null,{href:url,download:file.name});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);$('#diagnostic-status').textContent='진단 파일을 저장했어요. 인증 토큰과 비밀번호는 포함되지 않습니다.';return;
 }
 if(a==='update'){
  const response=await fetch('https://api.github.com/repos/'+config.repository+'/releases',{headers:{Accept:'application/vnd.github+json'},redirect:'error',signal:requestTimeout()});if(!response.ok)throw new Error('업데이트 정보를 가져오지 못했어요. 잠시 뒤 다시 시도하세요.');
  const releases=await response.json(),latest=releases.find(r=>!r.draft&&(settings.updateChannel==='test'||!r.prerelease)),body=el('div');body.append(el('p','현재 버전: '+VERSION));
  const current=VERSION.replace(/^v/,''),tag=latest?.tag_name?.replace(/^v/,'');body.append(el('p',!latest?'선택한 업데이트 채널에 공개된 버전이 없습니다.':tag===current?'현재 공개된 버전을 사용하고 있어요.':'최근 공개 버전: '+latest.tag_name+' · '+(latest.name??'')));
  if(latest&&/^https:\/\/github\.com\//.test(latest.html_url))body.append(el('a','배포 안내 보기',{href:latest.html_url,target:'_blank',rel:'noopener noreferrer',class:'release-link'}));modal('업데이트 확인',body);return;
 }
 if(a==='auth-cancel-flow'){await api.authFlow.cancel();googleBusy=false;$('#auth-pending').hidden=true;refreshGoogleLogin();return;}
 if(a==='google-login'){
  if(api.deletionPending){showAuth('deletion');throw new Error('현재 계정의 삭제 정리를 먼저 완료하거나 이 기기에서 로그아웃하세요.');}
  if(googleBusy)return;googleBusy=true;$('#onboarding-status').textContent='';try{await api.google(false);$('#auth-pending').hidden=false;}catch(e){googleBusy=false;throw e;}return;
 }
 if(a==='toggle-nav'){const on=$('#workspace').classList.toggle('nav-open');$('#nav-toggle').setAttribute('aria-expanded',String(on));$('#nav-scrim').hidden=!on;return;}
 if(a==='close-nav'){closeNav();return;}
 if(a==='toggle-people'){const on=$('#workspace').classList.toggle('people-open');document.querySelector('[data-action=toggle-people]').setAttribute('aria-expanded',String(on));return;}
 if(a==='friends'){
  await navigate(async current=>{await leaveChannel();await leaveOtherViews(null);if(!current())return;server=null;friend=null;scope=null;page='friends';uiKey='';closeNav();render();persistNavigation();});return;
 }
 if(a==='friend-filter'){friendFilter=id;uiKey='';render();return;}
 if(a==='transfers'){await navigate(async()=>{page='transfers';renderTransfers();uiKey='';closeNav();render();persistNavigation();});return;}
 if(a==='friend'){$('#dialog').close();await selectFriend(id);await poll(true);return;}
 if(a==='server'){await selectServer(id);return;}
 if(a==='channel'){await enterChannel(id);return;}
 if(a==='watch'){
  const b=snapshot.broadcasts.find(b=>b.id===id);if(!b)throw new Error('방송이 종료되었습니다.');
  autoWatchDisabled.delete(id);document.getElementById('video-'+id)?.classList.contains('video-failed')&&document.getElementById('video-'+id).remove();try{await media.watch(b);video({id});}catch(e){autoWatchDisabled.add(id);renderVideoFailure(id,e);throw e;}uiKey='';render();return;
 }
 if(a==='unwatch'){autoWatchDisabled.add(id);await media.unwatch(id);uiKey='';render();return;}
 if(a==='focus'){document.getElementById('video-'+id)?.classList.toggle('focused');return;}
 if(a==='zoom-in'||a==='zoom-out'||a==='zoom-reset'){const viewport=document.getElementById('video-'+id)?.zoomViewport;if(a==='zoom-reset')viewport?.reset();else viewport?.zoomBy(a==='zoom-in'?1.2:1/1.2);return;}
 if(a==='fullscreen'){await fullscreen(id);return;}
 if(a==='share'){if(!capabilities.canPublish)throw new Error('Android에서는 화면공유를 시청할 수 있어요. 송출은 Windows 또는 iOS에서 시작하세요.');if(navigationBusy)throw new Error('대화 전환이 끝난 뒤 화면공유를 시작하세요.');const selected=selectedScope(),s=selected.kind==='friend'?await openDirectShare(friend.uid):selected;await media.start(s);return;}
 if(a==='dm-retry'){const item=dm.list(friend.uid).find(m=>m.client_id===id);if(item)await dm.send(friend.uid,item.text,id);return;}
 if(a==='dm-latest'){dm.latest(id);await dm.history(id);$('.stage-scroll').scrollTop=$('.stage-scroll').scrollHeight;return;}
 if(a==='dm-history'){const before=dm.view(id).find(m=>m.seq)?.seq,scroll=$('.stage-scroll'),height=scroll.scrollHeight;await dm.history(id,before);scroll.scrollTop+=scroll.scrollHeight-height;return;}
 if(a==='stop'){await media.stop();return;}
 if(a==='session-request'){
  if(!capabilities.canPublish)throw new Error('이 기기는 화면공유 수신 전용입니다. 상대방에게 화면공유를 시작해 달라고 요청하세요.');
  $('#dialog').close();
  await selectFriend(id);await action('share');return;
 }
 if(a==='session-accept'){
  const s=snapshot.sessions.find(s=>s.id===id);if(!s)throw new Error('요청이 종료되었습니다.');
  const other=s.a===loadedUID?s.b:s.a;await api.rpc('session_accept',{id});await selectFriend(other);await poll(true);return;
 }
 if(a==='session-reject'||a==='session-cancel'){await api.rpc(a==='session-cancel'?'session_end':'session_reject',{id});await poll(true);return;}
 if(a==='end-session'){
  $('#dialog').close();
  const selected=scope;if(!selected)return;
  if(media.broadcast?.scope.id===selected.id)await media.stop();
  navigationEpoch++;if(selected.kind==='direct')await api.rpc('session_end',{id:selected.id});else{await api.rpc('channel_leave');joinedChannel=null;}
  for(const [bid,w]of media.watching)if(w.broadcast.scope_id===selected.id)await media.unwatch(bid);
  scope=null;if(selected.kind==='channel'){page='friends';server=null;friend=null;}await poll(true);uiKey='';render();persistNavigation();return;
 }
 if(a==='friend-file'){$('#dialog').close();await selectFriend(id);await sendFile(id,{kind:'friend',id});return;}
 if(a==='send-file'){
  $('#dialog').close();
  const s=selectedScope();
  if(s.kind==='channel'){
   const c=snapshot.channels.find(c=>c.id===s.id);if(!c?.files_enabled)throw new Error('채널 파일 전송이 꺼져 있습니다.');
   const candidates=snapshot.members.filter(m=>m.channel_id===s.id&&m.profile.uid!==loadedUID&&m.online);
   if(!candidates.length)throw new Error('현재 채널에 온라인 수신자가 없습니다.');
   const body=el('div');for(const m of candidates){const row=identity(m.profile,true);row.append(button('이 사용자에게 전송','channel-file',m.profile.uid,{'data-channel':s.id}));body.append(row);}modal('파일을 받을 참여자 선택',body);return;
  }
  if(!friend)throw new Error('친구를 선택하세요.');await sendFile(friend.uid,s);return;
 }
 if(a==='channel-file'){const channel=document.querySelector('[data-id="'+id+'"][data-channel]')?.dataset.channel;$('#dialog').close();await sendFile(id,{kind:'channel',id:channel});return;}
 if(a.startsWith('file-')){
  const op=a.slice(5);
  if(op==='reselect'){const source=await disk.pick();if(source)await files.reselect(id,source);}
  else if(op==='export'){if(bridge.native)await bridge.call('exportFile',{id});else await disk.finish(id,files.records.get(id).name,files.records.get(id).size);}
  else await files[op](id);
  page='transfers';renderTransfers();return;
 }
 if(a==='friend-request-send'){await api.rpc('friend_request',{target:id});$('#dialog').close();await poll(true);return;}
 if(a.startsWith('friend-')&&['remove','accept','reject','cancel'].includes(a.slice(7))||a==='block'||a==='unblock'){
  if(['friend-remove','block'].includes(a)&&!await confirmAction(a==='block'?'사용자 차단':'친구 삭제','이 사용자와의 '+(a==='block'?'친구 요청과 개인 연결을 차단합니다.':'친구 관계를 삭제합니다.')))return;
  await api.rpc(a.replaceAll('-','_'),{target:id});$('#dialog').close();await poll(true);return;
 }
 if(a==='friend-menu'){
  const f=friendRecord(id);if(!f)return;const body=el('div',null,{class:'context-menu'}),actions=el('div',null,{class:'context-actions'});body.append(identity(f.profile,f.online));actions.append(button('프로필 보기','friend-profile',id));
  if(f.status==='accepted'){
   const sharing=button('화면공유 시작','session-request',id),file=button('파일 보내기','friend-file',id);sharing.hidden=!capabilities.canPublish;file.disabled=!f.online;
   if(!f.online){sharing.title='공유를 켜 두면 친구가 이 대화에 들어왔을 때 볼 수 있어요.';file.title='친구가 온라인일 때 파일을 보낼 수 있어요.';}
   actions.append(button('메시지 보내기','friend',id));if(capabilities.canPublish)actions.append(sharing);actions.append(file);
  }body.append(actions);
  const danger=el('section',null,{class:'danger-zone context-section context-actions'});
  if(f.status==='accepted')danger.append(button('친구 삭제','friend-remove',id));danger.append(button('사용자 차단','block',id));body.append(danger);modal('친구 메뉴',body,{anchor});return;
 }
 if(a==='member-menu'){
  if(friendRecord(id)){await action('friend-menu',id,anchor);return;}
  const member=snapshot.members.find(m=>m.server_id===server&&m.profile.uid===id);if(!member)return;
  const body=el('div',null,{class:'context-menu'}),actions=el('div',null,{class:'context-actions'});body.append(identity(member.profile,member.online));actions.append(button('프로필 보기','user-profile',id));
  if(scope?.kind==='channel'&&member.channel_id===scope.id&&id!==loadedUID){
   const channel=snapshot.channels.find(c=>c.id===scope.id),file=button('파일 보내기','channel-file',id,{'data-channel':scope.id});file.disabled=!member.online||!channel?.files_enabled;file.title=!member.online?'온라인 참여자에게 파일을 보낼 수 있어요.':!channel?.files_enabled?'이 채널의 파일 전송이 꺼져 있어요.':'이 참여자에게 원본 파일 보내기';actions.append(file);
  }body.append(actions);modal('참여자 메뉴',body,{anchor});return;
 }
 if(a==='friend-profile'||a==='user-profile'){const p=friendRecord(id)?.profile??snapshot.members.find(m=>m.profile.uid===id)?.profile??(id===loadedUID?snapshot.me:null);if(!p)return;const card=profileCard(p,friendRecord(id)?.online);if(friendRecord(id)?.status==='accepted')card.querySelector('.profile-card-content').append(button('메시지 보내기','friend',id,{class:'primary'}));modal('사용자 프로필',card);return;}
 if(a==='server-create'){formModal('서버 만들기','server-create-form',[{label:'서버 이름',name:'name',attrs:{maxlength:'64',required:'true',placeholder:'친구들과 함께할 공간'}}],'서버 만들기');return;}
if(a==='server-join'){formModal('서버에 참여하기','server-join-form',[{label:'초대코드',name:'invite',attrs:{required:'true',placeholder:'서버 멤버에게 받은 초대코드'}}],'서버 참여');return;}
 if(a==='channel-create'){formModal('채널 만들기','channel-create-form',[{label:'채널 이름',name:'name',attrs:{maxlength:'64',required:'true',placeholder:'화면공유 채널 이름'}}],'채널 만들기',{server:id});return;}
 if(a==='server-settings'){serverSettings(id);return;}
 if(a==='copy-invite'){const value=$('#server-invite-code')?.value??snapshot.servers.find(s=>s.id===id)?.invite;if(!value)throw new Error('초대코드를 다시 불러오세요.');try{await (bridge.native?bridge.call('copyText',{text:value}):navigator.clipboard.writeText(value));if($('#invite-status'))$('#invite-status').textContent='초대코드를 복사했어요. 친구에게 보내세요.';}catch{$('#server-invite-code')?.select();if($('#invite-status'))$('#invite-status').textContent='선택한 초대코드를 직접 복사하세요.';}return;}
 if(a==='server-rename'){formModal('서버 이름 변경','server-rename-form',[{label:'서버 이름',name:'name',attrs:{value:snapshot.servers.find(s=>s.id===id).name,maxlength:'64',required:'true'}}],'저장',{server:id});return;}
 if(a==='channel-rename'){const c=snapshot.channels.find(c=>c.id===id);formModal('채널 이름 변경','channel-rename-form',[{label:'채널 이름',name:'name',attrs:{value:c.name,maxlength:'64',required:'true'}}],'저장',{server:c.server_id,channel:id});return;}
 if(a==='channel-files'){const c=snapshot.channels.find(c=>c.id===id);await api.rpc('channel_update',{server_id:c.server_id,id,files_enabled:!c.files_enabled});await poll(true);serverSettings(c.server_id);return;}
 if(a==='server-invite'){const epoch=accountUIEpoch,uid=loadedUID,srv=snapshot.servers.find(s=>s.id===id);if(!srv)return;const value=await api.rpc('server_invite',{server_id:id});if(loggingOut||epoch!==accountUIEpoch||api.session?.user?.id!==uid)return;const body=el('div',null,{class:'invite-dialog'}),code=el('input',null,{id:'server-invite-code',value:value.code??value.invite,readonly:'true','aria-label':'서버 초대코드'});body.append(el('p','친구에게 이 코드를 보내세요. Solaris의 서버 참여에 입력하면 됩니다.'),code,button('초대코드 복사','copy-invite',id,{class:'primary'}),el('p',null,{id:'invite-status',role:'status',class:'form-help'}));modal(srv.name+' · 친구 초대',body);return;}
 if(a==='server-leave'||a==='server-delete'){
  const srv=snapshot.servers.find(s=>s.id===id);if(!srv)return;
  if(!await confirmAction(a==='server-leave'?'서버 탈퇴':'서버 삭제','“'+srv.name+'” '+(a==='server-leave'?'서버에서 탈퇴할까요? 다시 참여하려면 초대코드가 필요합니다.':'서버와 채널을 삭제할까요?'))){serverSettings(id);return;}
  if(scope?.kind==='channel'&&snapshot.channels.some(c=>c.id===scope.id&&c.server_id===id)){await media.stop();scope=null;}
  await api.rpc(a==='server-leave'?'server_leave':'server_delete',a==='server-leave'?{id}:{server_id:id});
  server=null;friend=null;scope=null;page='friends';closeNav();await poll(true);uiKey='';render();persistNavigation();return;
 }
 if(a==='channel-delete'){
  const c=snapshot.channels.find(c=>c.id===id);if(!c)return;
  if(!await confirmAction('채널 삭제','“'+c.name+'” 채널과 진행 중인 방송을 삭제할까요?'))return;
  await api.rpc('channel_delete',{server_id:c.server_id,id});await poll(true);serverSettings(c.server_id);return;
 }
 if(a==='profile'){await profileModal();return;}
 if(a==='avatar-delete'){const path=snapshot.me.avatar_path;await api.rpc('profile',{avatar_path:null});if(path)await api.avatar(path);await poll(true);$('#dialog').close();return;}
 if(a==='logout'||a==='account-delete-confirm'){
  const deleting=a==='account-delete-confirm';let incomplete=false;
  if(loggingOut)return;
  if(!deleting&&!await confirmAction('로그아웃',api.deletionPending?'계정 삭제 정리는 아직 완료되지 않았어요. 이 기기에서 로그아웃할까요? 같은 Google 계정으로 로그인하면 삭제를 다시 시도할 수 있습니다.':'이 기기에서 로그아웃할까요? 화면공유와 진행 중인 파일 전송은 중지됩니다. 같은 Google 계정으로 다시 로그인하면 친구·서버·메시지가 그대로 돌아옵니다.'))return;
  loggingOut=true;accountUIEpoch++;navigationEpoch++;navigationBusy=false;clearInterval(timer);$('#dialog').close();$('#workspace').inert=true;$('#onboarding').inert=true;showAuth('login',deleting?'화면공유와 전송을 정리하고 계정을 삭제하고 있어요…':'화면공유와 전송을 정리하고 로그아웃하고 있어요…');clearTimeout(message.saveTimer);let result;
  try{
   await Promise.allSettled([api.authFlow.cancel(),pollPromise,bootPromise]);log?.record('account-logout');
   await Promise.allSettled([...(scope?.kind==='channel'?[api.rpc('channel_leave')]:[]),media?.stop(),files?.suspend(),dm?.close(),...(media?[...media.watching.keys()].map(id=>media.unwatch(id)):[])]);
   files?.close();media?.close();files=null;media=null;dm=null;exitViewingFullscreen();nativeScreens.clear();
   await Promise.allSettled([loadedUID?ledger.set('messages:'+loadedUID,structuredClone(conversations)):Promise.resolve(),log?.flush(),chatSave]);
   try{result=deleting?await api.deleteAccount():await api.logout();}catch(e){if(e.localSignedOut)result={localSignedOut:true};else{incomplete=!!e.deletionStarted;throw e;}}
   authReturns.clear();clearPrivateUI();
   showAuth('login',deleting?result?.localSignedOut?'이 계정의 로그인 세션이 종료됐어요. 삭제 완료 여부는 네트워크 복구 후 확인하세요.':'계정 탈퇴가 완료됐어요. 삭제된 계정으로는 다시 로그인할 수 없습니다.':result?.remoteRevoked===false?'이 기기에서 로그아웃했어요. 네트워크 문제로 서버의 로그인 종료 확인은 받지 못했습니다. 다시 로그인할 수 있어요.':'로그아웃했어요. 같은 Google 계정으로 로그인하면 친구·서버·메시지가 유지됩니다.');$('#google-login').focus();
  }finally{
   loggingOut=false;$('#workspace').inert=false;$('#onboarding').inert=false;
   if(api.session&&!media){if(incomplete||api.deletionPending)await deletionRetryScreen();else await boot();}
  }return;
 }
 if(a==='settings'){
  const body=el('div',null,{class:'profile-settings'}),content=el('div',null,{class:'settings-content'}),f=el('form',null,{id:'settings-edit',class:'stack-form'}),saved=settings.iceServers?.find(s=>s.username);body.append(settingsNavigation('app'),content);content.append(el('h2','화면공유와 파일 전송'));
  f.append(field('동시에 볼 화면 수','maxReceive',{type:'number',min:'1',max:'5',value:settings.maxReceive??4}));
  const duplicate=el('label','동일한 파일의 중복 전송 방지'),checkbox=el('input',null,{type:'checkbox',name:'preventDuplicates'});checkbox.checked=settings.preventDuplicates??true;duplicate.prepend(checkbox);f.append(duplicate);
  const channel=el('select',null,{name:'updateChannel'});for(const[value,label]of[['stable','안정 버전'],['test','테스트 버전 포함']]){const option=el('option',label,{value});option.selected=settings.updateChannel===value;channel.append(option);}const channelLabel=el('label','업데이트 채널');channelLabel.append(channel);f.append(channelLabel);
  const advanced=el('details',null,{class:'advanced-settings'});advanced.append(el('summary','고급 연결 설정 · TURN'),el('p','직접 연결이 어려운 네트워크에서 중계 서버를 사용할 수 있어요. 중계 비용은 제공자 정책에 따릅니다.',{class:'form-help'}),field('TURN 주소','turnURL',{placeholder:'turn:relay.example.com:3478',value:saved?.urls??''}),field('TURN 사용자','turnUser',{value:saved?.username??'',autocomplete:'off'}),field('TURN 인증','turnCredential',{type:'password',placeholder:saved?'비워두면 저장된 인증 유지':'인증 비밀 입력',autocomplete:'off'}));f.append(advanced,el('button','설정 저장',{class:'primary'}));
  const tools=el('div',null,{class:'settings-tools'});tools.append(button('업데이트 확인','update'),button('진단 내보내기','diagnostics'));content.append(f,el('h2','앱 정보 · '+VERSION),tools,el('p','화면공유는 고화질·최대 60fps를 기본으로 요청하며 실제 출력은 기기와 네트워크 성능에 따릅니다.',{class:'muted'}));modal('설정',body);return;
 }
}

document.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&!$('#dialog').open){if($('#workspace').classList.contains('nav-open')){e.preventDefault();closeNav();$('#nav-toggle').focus();}else if($('#workspace').classList.contains('people-open')){e.preventDefault();closePeople();document.querySelector('[data-action=toggle-people]').focus();}}
 if((e.key==='Enter'||e.key===' ')&&e.target.getAttribute('role')==='button'&&e.target.dataset.action){e.preventDefault();run(()=>action(e.target.dataset.action,e.target.dataset.id,e.target),e.target);}
});
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-action]');if(b&&!b.disabled)run(()=>action(b.dataset.action,b.dataset.id,b),b);
});
$('#dialog-close').onclick=()=>$('#dialog').close();
$('#dialog').addEventListener('click',e=>{
 const dialog=e.currentTarget;if(e.target!==dialog||!dialog.open||!dialog.classList.contains('context-dialog'))return;
 const bounds=dialog.getBoundingClientRect();if(e.clientX<bounds.left||e.clientX>bounds.right||e.clientY<bounds.top||e.clientY>bounds.bottom)dialog.close();
});
$('#dialog').addEventListener('close',()=>{if(!$('#dialog').open){clearDialogPosition($('#dialog'));dialogAnchor=null;$('#dialog-content').replaceChildren();if(dialogReturnFocus?.isConnected&&!dialogReturnFocus.closest('[hidden]'))dialogReturnFocus.focus();dialogReturnFocus=null;}});
document.addEventListener('submit',e=>{
 e.preventDefault();const form=e.target,data=Object.fromEntries(new FormData(form)),control=form.querySelector('button[type=submit],button:not([type])');
 run(async()=>{
  switch(form.id){
   case 'register':if(!api.session)throw new Error('먼저 Google 계정으로 로그인하세요.');await api.rpc('profile',{user_id:data.user_id.trim().toLowerCase(),nickname:data.nickname.trim()});await boot();break;
   case 'friend-search':{
    const p=await api.rpc('search',data);if(!p)throw new Error('사용자를 찾지 못했습니다.');
    if(p.uid===loadedUID)throw new Error('내 ID입니다. 친구의 고유 ID를 입력하세요.');
    const row=identity(p);row.append(button('친구 요청 보내기','friend-request-send',p.uid,{class:'primary'}));modal('검색 결과',row);break;
   }
   case 'profile-edit':{const epoch=accountUIEpoch,uid=loadedUID;data.user_id=data.user_id.trim().toLowerCase();await api.rpc('profile',data);if(loggingOut||epoch!==accountUIEpoch||api.session?.user?.id!==uid)return;await poll(true);if(!loggingOut&&epoch===accountUIEpoch&&api.session?.user?.id===uid&&form.isConnected&&$('#dialog').open)await profileModal();break;}
   case 'delete-account-form':if(data.confirm_id.trim().toLowerCase()!==snapshot.me.user_id)throw new Error('현재 계정의 ID를 정확히 입력하세요.');await action('account-delete-confirm');break;
   case 'server-create-form':{
    const s=await api.rpc('server_create',{name:data.name.trim()});$('#dialog').close();await poll(true);await selectServer(s.id);break;
   }
   case 'server-join-form':{
    const s=await api.rpc('server_join',{invite:data.invite.trim()});$('#dialog').close();await poll(true);await selectServer(s.id);break;
   }
   case 'server-rename-form':await api.rpc('server_rename',{server_id:form.dataset.server,name:data.name.trim()});$('#dialog').close();await poll(true);break;
   case 'channel-create-form':await api.rpc('channel_create',{server_id:form.dataset.server,name:data.name.trim()});$('#dialog').close();await poll(true);serverSettings(form.dataset.server);break;
   case 'channel-rename-form':await api.rpc('channel_update',{server_id:form.dataset.server,id:form.dataset.channel,name:data.name.trim()});$('#dialog').close();await poll(true);break;
   case 'settings-edit':{
    const n=Number(data.maxReceive);if(!Number.isInteger(n)||n<1||n>5)throw new Error('동시 시청 수는 1–5입니다.');
    settings.maxReceive=n;settings.preventDuplicates=data.preventDuplicates==='on';settings.updateChannel=data.updateChannel??'stable';
    if(data.turnURL){
     if(!/^turns?:[a-z0-9.-]+(:\d+)?(\?transport=(udp|tcp))?$/i.test(data.turnURL))throw new Error('TURN 주소 형식을 확인하세요.');
     const saved=settings.iceServers?.find(s=>s.username),credential=data.turnCredential||(saved?.urls===data.turnURL&&saved?.username===data.turnUser?saved.credential:'');if(!data.turnUser||!credential)throw new Error('TURN 사용자와 인증을 입력하세요.');const turn={urls:data.turnURL,username:data.turnUser,credential};settings.iceServers=[{urls:'stun:stun.l.google.com:19302'},turn];if(bridge.native)await bridge.call('vaultSet',{key:'turn',value:JSON.stringify(turn)});else await ledger.set('turn',JSON.stringify(turn));
    }else{settings.iceServers=[{urls:'stun:stun.l.google.com:19302'}];if(bridge.native)await bridge.call('vaultSet',{key:'turn',value:'null'});else await ledger.set('turn',null);}
    localStorage.setItem('solaris-settings',JSON.stringify({...settings,iceServers:undefined}));media.settings=settings;files.iceServers=media.ice;$('#dialog').close();break;
   }
   case 'chat':{
    const text=data.message.trim();if(!text)return;
    if(page==='direct'&&friend){const peer=friend.uid;form.reset();form.querySelector('textarea').style.height='auto';await dm.send(peer,text);break;}
    const selected=selectedScope(),targets=snapshot.members.filter(m=>m.channel_id===selected.id&&m.profile.uid!==loadedUID&&m.online).map(m=>m.profile.uid);
    for(const target of targets)await api.signal(selected,target,{type:'chat',text});message(text,snapshot.me.nickname);form.reset();form.querySelector('textarea').style.height='auto';break;
   }
  }
 },control);
});
document.addEventListener('change',e=>{if(e.target.id!=='avatar-file')return;run(async()=>{const f=e.target.files[0];if(!f)return;if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>10*1024*1024)throw new Error('10MB 이하 PNG·JPEG·WebP 이미지를 선택하세요.');const url=URL.createObjectURL(f),image=new Image();try{image.src=url;await image.decode();const scale=Math.min(1,512/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.85));if(!blob||blob.size>524288)throw new Error('사진 변환 실패');const path=snapshot.me.uid+'/'+crypto.randomUUID()+'.jpg';await api.avatar(path,blob);const old=snapshot.me.avatar_path;await api.rpc('profile',{avatar_path:path});if(old)await api.avatar(old);$('#dialog').close();await poll();}finally{URL.revokeObjectURL(url);}});});

document.addEventListener('fullscreenchange',()=>{document.body.classList.toggle('viewing-fullscreen',!!document.fullscreenElement||nativeFullscreen);if(!document.fullscreenElement){nativeFullscreen=false;fullscreenID=null;$('#viewing').classList.remove('native-fullscreen');if(bridge.native)bridge.call('fullscreen',{enabled:false}).catch(()=>{});}updateFullscreenLabels();layoutNativeScreens();});
globalThis.addEventListener('online',()=>poll());
globalThis.addEventListener('focus',()=>{if(bridge.native&&lifecycle?.platform==='windows')run(foreground);});
api.addEventListener('auth',()=>{
 refreshGoogleLogin();
 if(!api.session&&!loggingOut&&!$('#workspace').hidden){recoverSignedOut().catch(error);return;}
 if(files&&files.ownerUID!==api.session?.user?.id)files.close();
 if(media&&media.ownerUID!==api.session?.user?.id){const previous=media;previous.stop().catch(error).finally(()=>previous.close());return;}if(api.session&&media)media.refreshAuth().catch(error);
});
globalThis.addEventListener('pagehide',()=>{signalQueue?.close();api.leavePresence?.().catch(()=>{});clearVideos();log?.flush().catch(()=>{});files?.close();media?.close();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)api.leavePresence?.().catch(()=>{});else if(api.session&&!loggingOut)poll();});
async function ackNativeAuthReturn(url){if(bridge.native)await bridge.call('authAck',{url}).catch(()=>{});}
async function foreground(){
 await authReady;if(loggingOut)return;const epoch=accountUIEpoch;
 if(bridge.native){try{const returned=await bridge.call('authTake');if(returned&&!loggingOut&&epoch===accountUIEpoch)await receiveAuthReturn(returned);}catch(e){if(!loggingOut&&epoch===accountUIEpoch)error(e);}}
 await poll();
}
function showAuthReturnFailure(){
 googleBusy=false;$('#auth-pending').hidden=true;refreshGoogleLogin();
 const status='인증을 완료하지 못했어요. 오류 안내를 확인한 뒤 로그인을 다시 시도하세요.';
 $('#onboarding-status').textContent=status;
}
function receiveAuthReturn(url){
 authReturnSeen=true;
 const epoch=accountUIEpoch;
 const task=authReturnQueue.then(async()=>{
  await authReady;if(loggingOut||epoch!==accountUIEpoch)return false;if(authReturns.has(url)){await ackNativeAuthReturn(url);return true;}
  googleBusy=true;$('#auth-pending').hidden=false;$('#google-login').disabled=true;$('#onboarding-status').textContent='';
  await api.authReturn(url);if(loggingOut||epoch!==accountUIEpoch)return false;authReturns.add(url);if(authReturns.size>10)authReturns.delete(authReturns.values().next().value);
  googleBusy=false;$('#auth-pending').hidden=true;localStorage.removeItem('solaris-verification');$('#dialog').close();
  await boot();
  await ackNativeAuthReturn(url);return true;
 });const guarded=task.catch(async e=>{if(loggingOut||epoch!==accountUIEpoch)return false;if(e.authReturnHandled){authReturns.add(url);if(authReturns.size>10)authReturns.delete(authReturns.values().next().value);}showAuthReturnFailure();await ackNativeAuthReturn(url);throw e;});authReturnQueue=guarded.catch(()=>{});return guarded;
}
bridge.addEventListener('event',e=>{if(e.detail?.type==='lifecycle'){nativeBackground=e.detail.state==='background';if(nativeBackground)api.leavePresence?.().catch(()=>{});}if(e.detail?.type==='media-receive-fullscreen'){fullscreenID=e.detail.enabled?e.detail.id:null;updateFullscreenLabels();}if(e.detail?.type==='window-state')updateWindowState(e.detail);if(e.detail?.type==='auth-callback')receiveAuthReturn(e.detail.url).catch(error);if(e.detail?.type==='auth-cancelled')run(async()=>{await api.authFlow.cancel();googleBusy=false;$('#auth-pending').hidden=true;refreshGoogleLogin();});});
await run(async()=>{
 localStorage.removeItem('solaris-verification');
 {const t=bridge.native?await bridge.call('vaultGet',{key:'turn'}):await ledger.get('turn');if(t){try{const saved=JSON.parse(t);if(saved?.urls&&saved.username&&saved.credential)settings.iceServers=[{urls:'stun:stun.l.google.com:19302'},saved];}catch{}}}
 for(const n of document.querySelectorAll('[data-icon]')){const text=n.textContent.trim();n.replaceChildren(icon(n.dataset.icon,20));if(!n.hasAttribute('aria-label')||n.closest('#mobile-tabs'))n.append(el('span',text,{class:'button-label'}));n.title=n.getAttribute('aria-label')??text;}
 const attach=document.querySelector('[data-action=send-file]');attach.id='compose-attach';attach.type='button';attach.className='compose-attach';attach.setAttribute('aria-label','파일 보내기');attach.title='원본 파일 보내기';attach.replaceChildren(icon('plus',20));$('#chat button').id='chat-send';$('#chat-send').type='submit';$('#chat').prepend(attach);
 $('#session-controls .share-actions').append(button('대화 메뉴','session-more',null,{id:'session-more','aria-label':'대화 메뉴',class:'session-more'}));
 const shareState=el('div',null,{id:'share-state',class:'share-state',role:'status',hidden:'true'});shareState.append(icon('screen',18),el('span',null,{class:'share-state-label'}),button('연결 상태','quality-details'),button('공유 중지','stop',null,{class:'danger'}));
 const incoming=button('공유 요청 확인','incoming-requests',null,{id:'incoming-request',class:'incoming-request',hidden:'true'});$('#scope-status').after(shareState,incoming);
 $('#people').prepend(button('참여자 목록 닫기','close-people',null,{'aria-label':'참여자 목록 닫기',class:'people-close'}));
 const navIcons={friends:'friends',transfers:'files'};for(const n of $('.side-navigation').children)n.firstElementChild?.replaceChildren(icon(navIcons[n.dataset.action],22));
 const chatInput=$('#chat textarea');chatInput.addEventListener('input',()=>{drafts[$('#chat').dataset.conversation]=chatInput.value;});
 lifecycle=new AppLifecycle({bridge,getTransfers:()=>files,onForeground:foreground,onRestore:boot,onError:error});await lifecycle.start();
 if(bridge.native){try{const value=await bridge.call('platform');capabilities={...capabilities,...value,canPublish:value?.canPublish??lifecycle.platform!=='android'};}catch{capabilities.canPublish=lifecycle.platform!=='android';}}
 updateWindowState({platform:lifecycle.platform,systemTitlebar:capabilities.systemTitlebar});if(bridge.native&&lifecycle.platform==='windows'){try{updateWindowState(await bridge.call('windowState'));}catch{}}
 try{await api.init();}catch(e){showAuth('login','네트워크를 확인하거나 기존 계정으로 로그인하세요.');error(e);}finally{authReadyResolve();}
 let returned;if(bridge.native){try{returned=await bridge.call('authTake');}catch(e){error(e);}}else if(new URL(location.href).searchParams.has('code')||new URL(location.href).searchParams.has('error')){returned=location.href;history.replaceState({},'',location.pathname);}
 if(returned)await receiveAuthReturn(returned).catch(async e=>{await boot();showAuthReturnFailure();error(e);});else{
  try{if(!authReturnSeen){const pending=await api.authFlow.resume?.();if(!authReturnSeen){googleBusy=!!pending?.kind?.startsWith('google');$('#auth-pending').hidden=!pending;}}}catch(e){error(e);}
  await boot();
 }
 api.authSettings().then(value=>{providers=value;refreshGoogleLogin();}).catch(()=>{});
});

$('#chat textarea').addEventListener('input',e=>{e.target.style.height='auto';e.target.style.height=Math.min(128,e.target.scrollHeight)+'px';});
$('#chat textarea').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&(!matchMedia('(pointer: coarse)').matches||e.ctrlKey||e.metaKey)){e.preventDefault();if(!$('#chat-send').disabled)$('#chat').requestSubmit();}});

let lastViewportHeight=innerHeight;
const appViewportController=new AppViewport({bridge,onChange:value=>{
 layoutNativeScreens();if(value.keyboard&&value.height!==lastViewportHeight&&document.activeElement?.closest('#chat')){const pane=$('.stage-scroll');pane.scrollTop=pane.scrollHeight;}
 lastViewportHeight=value.height;
}});
