import config from './config.mjs';
import {API} from './api.mjs';
import {Bridge,Ledger,DiskFiles,VERSION,readSettings} from './platform.mjs';
import {Media,qualityGrade} from './media.mjs';
import {Transfers} from './files.mjs';
import {AppLifecycle} from './lifecycle.mjs';
import {DiagnosticLog,sanitizeDiagnostics} from './diagnostics.mjs';

const $=s=>document.querySelector(s), bridge=new Bridge(), ledger=new Ledger();
const api=new API(config,bridge,ledger), disk=new DiskFiles(bridge);
const emptySnapshot=()=>({friends:[],servers:[],channels:[],members:[],sessions:[],broadcasts:[],blocks:[],signals:[]});
let media,files,snapshot=emptySnapshot(),scope=null,server=null,friend=null,page='friends';
let friendFilter='all',cursor=0,polling=false,pollPromise=null,timer,lastPoll=0,log,lifecycle,loadedUID,booting=false;
let settings=readSettings(localStorage.getItem('solaris-settings')),diagnostics={},conversations={},uiKey='',searchDraft='';
let verification={type:'email',reset:false},nativeFullscreen=false,chatSave=Promise.resolve();
const avatarCache=new Map(),autoWatchDisabled=new Set(),autoWatchAttempt=new Map();

function el(tag,text=null,attrs={}){
 const n=document.createElement(tag);if(text!==null)n.textContent=text;
 for(const[k,v]of Object.entries(attrs))if(k==='class')n.className=v;else n.setAttribute(k,v);
 return n;
}
function button(text,action,id,attrs={}){
 const danger=['server-leave','server-delete','channel-delete','friend-remove','block','file-cancel','file-reject'].includes(action);
 return el('button',text,{type:'button','data-action':action,...(id?{'data-id':id}:{}),...attrs,class:[attrs.class??'',danger?'danger':''].filter(Boolean).join(' ')});
}
function error(e){
 let text=e.message??String(e);
 if(/Anonymous sign-ins are disabled/i.test(text))text='ID로 시작하려면 익명 인증을 활성화해야 합니다. 이메일 계정 만들기는 익명 인증 없이 사용할 수 있어요.';
 if(/Could not find the function.*solaris_action/i.test(text))text='서버에 Solaris 데이터베이스 설정이 필요합니다. 소스에 포함된 backend/001_solaris.sql을 Supabase SQL Editor에서 실행하세요.';
 log?.record('error',{message:text});$('#error').textContent=text;$('#error').hidden=false;
}
async function run(fn,control){
 try{$('#error').hidden=true;if(control)control.disabled=true;await fn();}
 catch(e){error(e);}finally{if(control?.isConnected)control.disabled=false;}
}
function identity(p={},online){
 const wrap=el('div',null,{class:'row'}),avatar=el('span',null,{class:'avatar-wrap'});
 const av=el('span',p.nickname?.[0]??'S',{class:'avatar'}),info=el('div',null,{class:'identity'});
 avatar.append(av);if(typeof online==='boolean')avatar.append(el('span',null,{class:'presence '+(online?'online':'offline'),role:'img','aria-label':online?'온라인':'오프라인',title:online?'온라인':'오프라인'}));
 info.append(el('strong',p.nickname??'참여자'),el('div','@'+(p.user_id??''),{class:'muted'}));wrap.append(avatar,info);
 if(p.avatar_path){
  const path=p.avatar_path,load=avatarCache.get(path)??api.avatarURL(path).catch(()=>null);avatarCache.set(path,load);
  Promise.resolve(load).then(url=>{if(url&&wrap.isConnected)av.replaceWith(el('img',null,{src:url,class:'avatar',alt:(p.nickname??'사용자')+' 프로필'}));});
 }
 return wrap;
}
function modal(title,body){
 $('#dialog-content').replaceChildren(el('h1',title),body);if(!$('#dialog').open)$('#dialog').showModal();
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
 $('#onboarding').hidden=false;$('#workspace').hidden=true;$('#onboarding-status').textContent=status;
 const active=mode==='signup'?'email-register':mode==='quick'||mode==='claim'?'register':mode==='recover'||mode==='reset'?'recover':mode==='verify'?'verify':'login';
 for(const f of $('#onboarding').querySelectorAll('form'))f.hidden=f.id!==active;
 for(const b of $('.auth-tabs').children)b.classList.toggle('active',b.dataset.action==='auth-'+mode);
 $('#onboarding').dataset.mode=mode;
 $('#quick-help').textContent=mode==='claim'?'로그인이 완료되었습니다. 사용할 고유 ID와 닉네임을 설정하세요.':'이 기기에 계정이 저장됩니다. 내 프로필에서 이메일과 비밀번호를 연결하면 다른 기기에서도 로그인할 수 있어요.';
}
function conversationKey(s=scope,f=friend){return s?.kind==='channel'?'channel:'+s.id:f?'friend:'+f.uid:'activity';}
function renderMessages(){
 const host=$('#messages'),items=conversations[conversationKey()]??[];host.replaceChildren();
 for(const item of items){const row=el('div',null,{class:'message'+(item.author?'':' system-message')});if(item.author)row.append(el('strong',item.author));row.append(document.createTextNode(item.text));host.append(row);}
}
function message(text,author=null,key=conversationKey()){
 const list=conversations[key]??[];list.push({text:String(text).slice(0,2000),author,time:Date.now()});conversations[key]=list.slice(-100);
 const uid=loadedUID,data=structuredClone(conversations);
 if(uid)chatSave=chatSave.then(()=>ledger.set('messages:'+uid,data)).catch(error);
 if(key===conversationKey())renderMessages();
}
function closeNav(){
 $('#workspace').classList.remove('nav-open');$('#nav-toggle').setAttribute('aria-expanded','false');$('#nav-scrim').hidden=true;
}
function showSelf(online){
 if(!snapshot.me)return;const host=$('#self-profile'),key=JSON.stringify([snapshot.me.nickname,snapshot.me.user_id,snapshot.me.avatar_path,online]);
 if(host.dataset.identity!==key){host.replaceChildren(identity(snapshot.me,online));host.dataset.identity=key;}
}
function friendRecord(uid){return snapshot.friends.find(f=>f.profile.uid===uid);}
function sessionFor(uid){return snapshot.sessions.find(s=>s.state!=='ended'&&[s.a,s.b].includes(uid));}
function selectedScope(){if(scope)return scope;if(friend)return{kind:'friend',id:friend.uid};throw new Error('친구 또는 채널을 먼저 선택하세요.');}
function activeSession(s){return snapshot.sessions.find(x=>x.id===s?.id&&x.state==='accepted');}
function persistNavigation(){if(loadedUID)ledger.set('navigation:'+loadedUID,{server,friend:friend?.uid,page,channel:scope?.kind==='channel'?scope.id:null}).catch(error);}
async function leaveChannel(){
 if(scope?.kind!=='channel')return;const previous=scope;
 if(media.broadcast?.scope.kind==='channel'&&media.broadcast.scope.id===previous.id)await media.stop();
 await api.rpc('channel_leave');scope=null;
}
async function selectFriend(uid){
 const f=friendRecord(uid);if(!f||f.status!=='accepted')throw new Error('수락된 친구 관계가 필요합니다.');
 await leaveChannel();
 if(media.broadcast?.scope.kind==='direct'&&media.broadcast.scope.id!==sessionFor(uid)?.id)await media.stop();
 friend=f.profile;server=null;page='direct';
 const s=sessionFor(uid);scope=s?.state==='accepted'?{kind:'direct',id:s.id}:null;
 closeNav();uiKey='';render();persistNavigation();
}
async function enterChannel(id){
 const c=snapshot.channels.find(c=>c.id===id);if(!c)throw new Error('채널을 찾을 수 없습니다.');
 if(scope?.kind==='channel'&&scope.id===id){page='channel';uiKey='';closeNav();render();return;}
 if(media.broadcast)await media.stop();
 await api.rpc('channel_enter',{id});server=c.server_id;scope={kind:'channel',id};friend=null;page='channel';
 closeNav();uiKey='';await poll();render();persistNavigation();
}
async function selectServer(id){
 if(!snapshot.servers.some(s=>s.id===id))throw new Error('서버에 참여해 주세요.');
 const c=snapshot.channels.find(c=>c.server_id===id);
 if(c)await enterChannel(c.id);else{await leaveChannel();server=id;friend=null;scope=null;page='channel';uiKey='';render();persistNavigation();}
}
async function pollOnce(){
 if(polling||!api.session||!media)return;polling=true;
 try{
  const next=await api.rpc('sync',{cursor});if(api.session?.user?.id!==loadedUID)return;snapshot=next;
  if(friend){const f=friendRecord(friend.uid);if(f?.status==='accepted')friend=f.profile;else{friend=null;scope=null;page='friends';}}
  if(server&&!snapshot.servers.some(s=>s.id===server)){server=null;scope=null;page='friends';}
  if(scope?.kind==='channel'&&!snapshot.channels.some(c=>c.id===scope.id)){await media.stop();scope=null;page=server?'channel':'friends';}
  if(friend){const s=sessionFor(friend.uid);const before=scope;scope=s?.state==='accepted'?{kind:'direct',id:s.id}:null;if(before?.kind==='direct'&&!scope)message('개인 연결이 종료되었습니다.');}
  for(const signal of next.signals??[]){try{await handle(signal);}catch(e){error(e);}cursor=Math.max(cursor,signal.id);}
  lastPoll=Date.now();$('#connection').textContent='온라인 · '+VERSION;showSelf(true);
  await media.update(snapshot);await files.reconcile(snapshot);
  if(Date.now()-(files.lastRecovery??0)>5000){files.lastRecovery=Date.now();await files.reconnect();}
  if(scope?.kind==='direct')for(const b of snapshot.broadcasts.filter(b=>b.scope_kind==='direct'&&b.scope_id===scope.id&&b.publisher!==loadedUID)){
   if(!media.watching.has(b.id)&&!autoWatchDisabled.has(b.id)&&Date.now()-(autoWatchAttempt.get(b.id)??0)>5000){
    autoWatchAttempt.set(b.id,Date.now());try{await media.watch(b);video({id:b.id});}catch(e){error(e);}
   }
  }
  render();
 }catch(e){$('#connection').textContent='재연결 중';showSelf(false);if(Date.now()-lastPoll>15000)error(e);}
 finally{polling=false;}
}
async function boot(){
 if(booting)return;booting=true;
 try{
  if(!api.session)await api.init();if(!api.session){showAuth();return;}
  let me=await api.rpc('profile');
  if(!me){
   const m=api.session.user?.user_metadata??{};
   if(m.solaris_user_id&&m.solaris_nickname){try{me=await api.rpc('profile',{user_id:m.solaris_user_id,nickname:m.solaris_nickname});}catch(e){if(/duplicate|unique/i.test(e.message)){showAuth('claim','이미 사용 중인 ID입니다. 새 고유 ID를 선택하세요.');$('#register [name=nickname]').value=m.solaris_nickname;return;}throw e;}}
   if(!me){showAuth('claim');return;}
  }
  clearInterval(timer);media?.close();files?.close();await log?.flush();await chatSave;
  loadedUID=me.uid;snapshot=emptySnapshot();snapshot.me=me;scope=null;server=null;friend=null;cursor=0;page='friends';uiKey='';
  conversations=await ledger.get('messages:'+me.uid)??{};diagnostics={};autoWatchDisabled.clear();autoWatchAttempt.clear();$('#videos').replaceChildren();
  log=new DiagnosticLog(ledger,me.uid);await log.load();log.record('app-start',{version:VERSION});
  media=new Media(api,bridge,settings);files=new Transfers(api,disk,ledger,media.ice,()=>!!media.broadcast||media.watching.size>0);await files.init();
  media.addEventListener('error',e=>error(e.detail));
  media.addEventListener('broadcast',e=>{
   const b=e.detail;log.record(b?.pending?'broadcast-preparing':b?'broadcast-start':'broadcast-stop',{transport:b?.transport});
   if(b){scope=b.scope;page=scope.kind==='channel'?'channel':'direct';if(scope.kind==='channel'){server=snapshot.channels.find(c=>c.id===scope.id)?.server_id??server;friend=null;}else{const s=activeSession(scope);if(s)friend=friendRecord(s.a===loadedUID?s.b:s.a)?.profile??friend;server=null;}}
   message(b?.pending?'시스템 화면공유 시작을 기다리고 있습니다.':b?'화면공유를 시작했습니다.':'화면공유를 종료했습니다.');uiKey='';render();
  });
  media.addEventListener('track',e=>video(e.detail));
  media.addEventListener('removed',e=>{document.getElementById('video-'+e.detail)?.remove();uiKey='';render();});
  media.addEventListener('quality',e=>{
   const q=document.getElementById('quality-'+e.detail.id);
   if(q){q.replaceChildren(el('span',null,{class:'quality-dot '+e.detail.grade.color}),document.createTextNode(e.detail.grade.text+' · '+e.detail.stats.width+'×'+e.detail.stats.height+' · '+e.detail.stats.fps.toFixed(1)+'fps'));q.title=(e.detail.stats.codec??'')+' · RTT '+Math.round(e.detail.stats.rtt)+'ms';}
   diagnostics[e.detail.id]=e.detail.stats;
  });
  media.addEventListener('diagnostics',e=>diagnostics.native=e.detail);
  files.addEventListener('change',e=>{
   if(e.detail.state==='failed'&&!files.failureNotifications?.has(e.detail.id)){files.failureNotifications??=new Set();files.failureNotifications.add(e.detail.id);notify('파일 전송 실패',e.detail.name);message(e.detail.name+' 전송 실패 · 이어받기를 확인하세요.');}
   if(page==='transfers'&&!files.renderTimer)files.renderTimer=setTimeout(()=>{files.renderTimer=null;renderTransfers();},250);
   updateBadges();
  });
  files.addEventListener('offer',e=>{message(e.detail.name+' 파일 전송 요청이 도착했습니다.');page='transfers';uiKey='';renderTransfers();render();notify('파일 수신 요청',e.detail.name);});
  files.addEventListener('complete',e=>{log.record('file-complete',{direction:e.detail.direction,size:e.detail.size});message(e.detail.name+' 전송 완료 · SHA-256 확인');notify('파일 전송 완료',e.detail.name);});
  files.addEventListener('error',e=>error(e.detail));
  $('#onboarding').hidden=true;$('#workspace').hidden=false;await poll();
  const saved=await ledger.get('navigation:'+me.uid);
  if(!media.broadcast&&saved?.friend&&friendRecord(saved.friend)?.status==='accepted')await selectFriend(saved.friend);
  else if(!media.broadcast&&saved?.channel&&snapshot.channels.some(c=>c.id===saved.channel))await enterChannel(saved.channel);
  else if(!media.broadcast&&saved?.server&&snapshot.servers.some(s=>s.id===saved.server))await selectServer(saved.server);
  if(saved?.page==='transfers'){page='transfers';renderTransfers();}
  render();timer=setInterval(poll,2000);
 }catch(e){showAuth('login','계정 데이터는 유지되어 있습니다. 네트워크를 확인하거나 기존 계정으로 로그인하세요.');error(e);}
 finally{booting=false;}
}
async function notify(title,body){if(bridge.native)await bridge.call('notify',{title,body}).catch(()=>{});}
async function handle(s){
 const v=s.payload;if(v.type==='chat'){
  if(typeof v.text==='string'&&v.text.length<=2000){
   const p=friendRecord(s.sender)?.profile??snapshot.members.find(m=>m.profile.uid===s.sender)?.profile;
   message(v.text,p?.nickname??'참여자',s.scope_kind==='channel'?'channel:'+s.scope_id:'friend:'+s.sender);
  }return;
 }
 if(v.type.startsWith('file-')||v.type==='rtc'&&v.peer?.startsWith('files:'))await files.handle(s);else await media.handle(s);
}
function displayKey(){
 return JSON.stringify({snapshot,page,friend:friend?.uid,server,scope,friendFilter,watching:[...media.watching.keys()],broadcast:media.broadcast?.id,preparing:media.broadcast?.pending},(key,value)=>['last_seen','updated_at','created_at','signals','rate_limits'].includes(key)?undefined:value);
}
function updateBadges(){
 if(!files)return;const n=[...files.records.values()].filter(r=>['offered','accepted','transferring','paused'].includes(r.state)).length;
 $('#transfer-count').hidden=!n;$('#transfer-count').textContent=n;
}
function render(){
 if(!snapshot.me||!media)return;showSelf(Date.now()-lastPoll<15000);updateBadges();
 const key=displayKey();if(key===uiKey)return;uiKey=key;
 const current=snapshot.servers.find(s=>s.id===server),accepted=snapshot.friends.filter(f=>f.status==='accepted');
 const rail=$('#servers');rail.replaceChildren();
 for(const s of snapshot.servers)rail.append(button(s.name.slice(0,2),'server',s.id,{class:server===s.id?'active':'',title:s.name,'aria-label':s.name,'aria-pressed':String(server===s.id)}));
 $('.home-icon').classList.toggle('active',!server);
 $('#server-title').textContent=current?.name??'개인 메시지';$('#channel-section-title').textContent=current?'화면공유 채널':'개인 메시지';
 const tools=$('#server-tools');tools.replaceChildren();if(current)tools.append(button('⌄','server-settings',server,{'aria-label':'서버 메뉴',title:'서버 메뉴'}));
 $('#channel-add').hidden=!current||current.owner!==loadedUID;$('#channel-add').dataset.id=server??'';
 const cc=$('#channels');cc.replaceChildren();
 if(current)for(const c of snapshot.channels.filter(c=>c.server_id===server)){
  const live=snapshot.broadcasts.filter(b=>b.scope_kind==='channel'&&b.scope_id===c.id),selected=scope?.kind==='channel'&&scope.id===c.id;
  const row=button(null,'channel',c.id,{class:selected?'active':'','aria-current':selected?'page':'false',title:c.name});
  row.append(el('span','#',{class:'channel-symbol'}),el('span',c.name,{class:'channel-name'}));
  if(live.length)row.append(el('span','LIVE '+live.length,{class:'live-label'}));cc.append(row);
 }else for(const f of accepted){const row=button(null,'friend',f.profile.uid,{class:'dm '+(friend?.uid===f.profile.uid?'active':''),'aria-label':f.profile.nickname+' 개인 메시지'});row.append(identity(f.profile,f.online));cc.append(row);}
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
  const row=identity(m.profile,m.online),b=snapshot.broadcasts.find(b=>b.publisher===m.profile.uid&&media.watching.has(b.id)),stat=b?diagnostics[b.id]:null;
  if(stat){const grade=qualityGrade(stat);row.append(el('span',null,{class:'quality-dot '+grade.color,title:grade.text,'aria-label':grade.text}));}
  people.append(row);
 }
 if(!people.childElementCount)people.append(el('p','온라인 사용자가 없습니다.',{class:'muted'}));
 const requests=snapshot.sessions.filter(s=>s.state==='requested'&&s.requester!==loadedUID),req=$('#requests');req.replaceChildren();
 for(const s of requests){const f=friendRecord(s.requester),row=identity(f?.profile,f?.online);row.append(button('수락','session-accept',s.id,{class:'primary'}),button('거절','session-reject',s.id,{class:'danger'}));req.append(row);}
 if(!requests.length)req.append(el('p','새로운 요청이 없습니다.',{class:'muted'}));$('#request-count').hidden=!requests.length;$('#request-count').textContent=requests.length;
 $('#scope-title').textContent=page==='transfers'?'파일 전송':page==='channel'?(snapshot.channels.find(c=>c.id===scope?.id)?.name??current?.name??'채널'):page==='direct'?friend?.nickname??'개인 메시지':'친구';
 $('#scope-symbol').textContent=page==='channel'?'#':page==='transfers'?'⇄':page==='direct'?'@':'♧';
 $('#scope-status').textContent=page==='direct'?(scope?'화면공유 연결됨 · 서로 동시에 공유할 수 있어요.':friendRecord(friend?.uid)?.online?'온라인 · 화면공유를 요청해 보세요.':'오프라인 · 화면공유와 파일 전송은 상대방이 접속하면 사용할 수 있어요.'):page==='channel'?'이 채널에서 화면과 파일을 공유하세요.':page==='transfers'?'원본 파일 · 전송 수락 · 이어받기 · SHA-256 확인':'친구와 간편하게 화면과 파일을 공유하세요.';
 $('#friend-tabs').hidden=page!=='friends';
 const tabs=$('#friend-tabs');tabs.replaceChildren();for(const [id,text]of [['online','온라인'],['all','모두'],['pending','대기 중'],['blocked','차단 목록'],['add','친구 추가']])tabs.append(button(text,'friend-filter',id,{class:(friendFilter===id?'active ':'')+(id==='add'?'add-friend':'')}));
 $('#session-controls').hidden=!scope&&!friend&&!media.broadcast;
 $('#share').hidden=!!media.broadcast;$('#stop').hidden=!media.broadcast;$('#share').disabled=!scope;
 document.querySelector('[data-action="send-file"]').disabled=!scope&&!friend;
 document.querySelector('[data-action="end-session"]').disabled=!scope;
 $('#chat input').disabled=!scope&&!friend;$('#chat button').disabled=!scope&&!friend;
 $('#chat input').placeholder=friend?'@'+friend.nickname+'에게 메시지 보내기':scope?.kind==='channel'?'#'+$('#scope-title').textContent+'에 메시지 보내기':'친구나 채널을 선택하세요.';
 $('#messages-title').textContent=friend?'개인 메시지':'연결 및 전송 메시지';
 const connection=$('#sidebar-connection');connection.hidden=!scope;connection.replaceChildren();if(scope)connection.append(el('span','● '+(scope.kind==='direct'?'개인 연결':'# '+$('#scope-title').textContent)),button('✕','end-session',null,{'aria-label':'현재 연결 종료'}));
 if(page==='friends')renderFriends();else if(page==='direct')renderDirect();else if(page==='channel')renderChannel();
 refreshVideoIdentities();renderMessages();
}
function emptyState(title,text){
 const n=el('div',null,{class:'empty-state'});n.append(el('div','◉',{class:'empty-mark'}),el('h2',title),el('p',text));return n;
}
function renderFriends(){
 const prior=$('#friend-search input'),draft=prior?.value??searchDraft,focused=prior===document.activeElement,start=prior?.selectionStart,end=prior?.selectionEnd;
 const panel=$('#panel');panel.dataset.page='friends';panel.replaceChildren();
 const form=el('form',null,{id:'friend-search'});form.append(el('input',null,{name:'user_id',placeholder:'친구의 고유 ID로 추가하기',required:'true','aria-label':'친구 고유 ID'}),el('button','검색',{class:'primary'}));panel.append(form);
 const input=form.querySelector('input');input.value=draft;input.oninput=()=>searchDraft=input.value;
 if(focused){input.focus({preventScroll:true});input.setSelectionRange(start??draft.length,end??draft.length);}
 if(friendFilter==='add'){panel.append(emptyState('친구 추가','중복될 수 있는 닉네임 대신 고유 ID로 친구를 찾아보세요.'));return;}
 if(friendFilter==='blocked'){
  panel.append(el('h2','차단한 사용자 — '+snapshot.blocks.length));
  for(const p of snapshot.blocks){const row=identity(p);row.append(button('차단 해제','unblock',p.uid));panel.append(row);}
  if(!snapshot.blocks.length)panel.append(emptyState('차단한 사용자가 없습니다.','친구 메뉴에서 사용자 차단을 관리할 수 있어요.'));return;
 }
 const friends=snapshot.friends.filter(f=>friendFilter==='pending'?f.status!=='accepted':friendFilter==='online'?f.status==='accepted'&&f.online:true);
 panel.append(el('h2',(friendFilter==='pending'?'대기 중':friendFilter==='online'?'온라인':'친구')+' — '+friends.length));
 for(const f of friends){
  const row=identity(f.profile,f.status==='accepted'?f.online:undefined),actions=el('div',null,{class:'row-actions'});
  if(f.status==='accepted')actions.append(button('메시지','friend',f.profile.uid),button('화면공유 요청','session-request',f.profile.uid,{class:'primary'}),button('파일 보내기','friend-file',f.profile.uid,{class:'file-action'}));
  else if(f.requester===loadedUID)actions.append(el('span','보낸 친구 요청',{class:'muted'}),button('취소','friend-cancel',f.profile.uid));
  else actions.append(button('수락','friend-accept',f.profile.uid,{class:'primary'}),button('거절','friend-reject',f.profile.uid));
  row.append(actions,button('⋯','friend-menu',f.profile.uid,{class:'row-menu','aria-label':f.profile.nickname+' 친구 메뉴'}));panel.append(row);
 }
 if(!friends.length)panel.append(emptyState('함께할 친구를 찾아보세요.','위의 검색창에서 고유 ID로 친구 요청을 보낼 수 있어요.'));
}
function renderDirect(){
 const panel=$('#panel');panel.dataset.page='direct';panel.replaceChildren();if(!friend)return;
 const profile=el('div',null,{class:'dm-profile'});profile.append(identity(friend,friendRecord(friend.uid)?.online));panel.append(profile);
 const s=sessionFor(friend.uid),banner=el('div',null,{class:'session-banner'});
 if(s?.state==='accepted')banner.append(el('div','화면공유 연결됨',{class:'banner-title'}),el('p','아래 화면공유 버튼을 누르면 내 화면을 공유할 수 있어요. 상대방이 공유하면 자동으로 연결합니다.',{class:'muted'}));
 else if(s?.state==='requested'){
  banner.append(el('div',s.requester===loadedUID?'화면공유 요청을 보냈어요.':'화면공유 요청이 도착했어요.',{class:'banner-title'}));
  if(s.requester===loadedUID)banner.append(el('p','상대방이 수락하면 연결됩니다.',{class:'muted'}),button('요청 취소','session-cancel',s.id));
  else banner.append(button('수락','session-accept',s.id,{class:'primary'}),button('거절','session-reject',s.id,{class:'danger'}));
 }else banner.append(el('div','친구와 화면을 공유해 보세요.',{class:'banner-title'}),el('p','화면공유는 상대방이 수락한 뒤 시작됩니다. 메시지와 파일 전송은 친구 관계에서 사용할 수 있어요.',{class:'muted'}),button('화면공유 요청','session-request',friend.uid,{class:'primary'}));
 panel.append(banner);
}
function renderChannel(){
 const panel=$('#panel');panel.dataset.page='channel';panel.replaceChildren();
 const c=snapshot.channels.find(c=>c.id===scope?.id);
 if(!c){panel.append(emptyState('채널을 선택하세요.','서버의 채널에서 화면과 파일을 공유할 수 있어요.'));return;}
 const live=snapshot.broadcasts.filter(b=>b.scope_kind==='channel'&&b.scope_id===c.id&&b.publisher!==loadedUID);
 const members=snapshot.members.filter(m=>m.channel_id===c.id);
 panel.append(el('h2','현재 채널 — 참여자 '+members.length+'명 · 방송 '+live.length+'개'));
 if(!live.length&&!media.broadcast)panel.append(emptyState('# '+c.name+'에 오신 것을 환영해요.','화면공유를 시작하거나 접속한 참여자에게 파일을 보내 보세요.'));
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
function video({id,stream}){
 let card=document.getElementById('video-'+id);
 if(!card){
  const b=snapshot.broadcasts.find(b=>b.id===id),head=el('div',null,{class:'video-head'});
  card=el('article',null,{id:'video-'+id,class:'video-card'});
  const who=identity(b?.profile,true);who.classList.add('broadcast-identity');
  head.append(who,el('span','연결 중',{id:'quality-'+id,class:'quality'}),button('확대','focus',id),button('전체화면','fullscreen',id),button('시청 중지','unwatch',id));
  card.append(head,el('div','화면을 연결하는 중입니다…',{class:'video-waiting'}),el('video',null,{autoplay:'true',playsinline:'true',controls:'true'}));$('#videos').append(card);
 }
 if(stream){
  card.querySelector('.video-waiting')?.remove();const v=card.querySelector('video');
  if(v.srcObject!==stream){v.srcObject=stream;v.play().catch(()=>message('영상의 재생 버튼을 눌러주세요.'));}
 }
}
async function fullscreen(id){
 const viewing=$('#viewing');document.getElementById('video-'+id)?.classList.add('focused');
 if(document.fullscreenElement){await document.exitFullscreen();return;}
 if(nativeFullscreen){nativeFullscreen=false;viewing.classList.remove('native-fullscreen');await bridge.call('fullscreen',{enabled:false});return;}
 try{if(viewing.requestFullscreen){await viewing.requestFullscreen();return;}}catch{}
 if(bridge.native){nativeFullscreen=true;viewing.classList.add('native-fullscreen');await bridge.call('fullscreen',{enabled:true});}
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
  body.append(el('h2','서버 관리'),el('p','초대코드: '+srv.invite),button('초대코드 복사','copy-invite',id),button('초대코드 갱신','server-invite',id),button('서버 이름 변경','server-rename',id),el('h2','채널 관리'),button('채널 만들기','channel-create',id));
  for(const c of snapshot.channels.filter(c=>c.server_id===id)){const row=el('div',null,{class:'row'});row.append(el('strong','# '+c.name),button('이름 변경','channel-rename',c.id),button(c.files_enabled?'파일 전송 끄기':'파일 전송 켜기','channel-files',c.id),button('채널 삭제','channel-delete',c.id));body.append(row);}
 }else body.append(el('p','서버 참여자로 화면공유와 파일 전송을 이용할 수 있어요.',{class:'muted'}));
 const danger=el('section',null,{class:'danger-zone'});
 danger.append(el('h2',srv.owner===loadedUID?'서버 삭제':'서버 탈퇴'),el('p',srv.owner===loadedUID?'서버와 모든 채널이 삭제됩니다.':'탈퇴 후 다시 참여하려면 초대코드가 필요합니다.',{class:'muted'}),srv.owner===loadedUID?button('서버 삭제','server-delete',id):button('서버 탈퇴','server-leave',id));body.append(danger);modal(srv.name+' · 서버 메뉴',body);
}
async function profileModal(){
 const user=await api.account(),body=el('div');body.append(identity(snapshot.me));
 const edit=el('form',null,{id:'profile-edit',class:'stack-form'});edit.append(field('닉네임','nickname',{value:snapshot.me.nickname,maxlength:'32',required:'true'}),el('button','닉네임 저장',{class:'primary'}));
 body.append(edit,el('h2','프로필 사진'),el('input',null,{type:'file',accept:'image/jpeg,image/png,image/webp',id:'avatar-file'}),button('사진 삭제','avatar-delete'),el('h2','로그인 및 계정 복구'));
 body.append(el('p',user.email_confirmed_at?'인증된 이메일: '+user.email:user.email?'이메일 인증 대기: '+user.email:'이 기기에 저장된 계정입니다. 이메일을 연결하면 다른 기기에서 같은 계정으로 로그인할 수 있어요.',{class:'muted'}));
 if(!user.email_confirmed_at){
  const rec=el('form',null,{id:'recovery-link',class:'stack-form'});rec.append(field('복구 이메일','email',{type:'email',value:user.email??'',required:'true'}),el('button','이메일 인증 보내기',{class:'primary'}));body.append(rec);
  const verify=el('form',null,{id:'link-verify',class:'stack-form'});verify.append(field('인증할 이메일','email',{type:'email',value:user.email??'',required:'true'}),field('이메일 인증 코드','token',{autocomplete:'one-time-code',required:'true'}),el('button','이메일 연결 완료'));body.append(verify);
 }else{
  const pw=el('form',null,{id:'password-edit',class:'stack-form'});pw.append(field('로그인 비밀번호 설정 / 변경','password',{type:'password',minlength:'8',autocomplete:'new-password',required:'true'}),el('button','비밀번호 저장',{class:'primary'}));
  body.append(pw,el('p','이메일과 비밀번호로 로그인하면 친구·서버·프로필이 그대로 유지됩니다.',{class:'muted'}),button('로그아웃','logout',null,{class:'danger'}));
 }
 modal('내 프로필',body);
}
async function action(a,id){
 if(a.startsWith('auth-')){showAuth(a.slice(5));return;}
 if(a==='toggle-nav'){const on=$('#workspace').classList.toggle('nav-open');$('#nav-toggle').setAttribute('aria-expanded',String(on));$('#nav-scrim').hidden=!on;return;}
 if(a==='close-nav'){closeNav();return;}
 if(a==='toggle-people'){const on=$('#workspace').classList.toggle('people-open');document.querySelector('[data-action=toggle-people]').setAttribute('aria-expanded',String(on));return;}
 if(a==='friends'){
  await leaveChannel();if(media.broadcast)await media.stop();server=null;friend=null;scope=null;page='friends';uiKey='';closeNav();render();persistNavigation();return;
 }
 if(a==='friend-filter'){friendFilter=id;uiKey='';render();return;}
 if(a==='transfers'){page='transfers';renderTransfers();uiKey='';closeNav();render();persistNavigation();return;}
 if(a==='friend'){await selectFriend(id);await poll(true);return;}
 if(a==='server'){await selectServer(id);return;}
 if(a==='channel'){await enterChannel(id);return;}
 if(a==='watch'){
  const b=snapshot.broadcasts.find(b=>b.id===id);if(!b)throw new Error('방송이 종료되었습니다.');
  autoWatchDisabled.delete(id);await media.watch(b);video({id});uiKey='';render();return;
 }
 if(a==='unwatch'){autoWatchDisabled.add(id);await media.unwatch(id);uiKey='';render();return;}
 if(a==='focus'){document.getElementById('video-'+id)?.classList.toggle('focused');return;}
 if(a==='fullscreen'){await fullscreen(id);return;}
 if(a==='share'){const s=selectedScope();if(s.kind==='friend')throw new Error('친구의 화면공유 요청 수락을 기다리세요.');await media.start(s);return;}
 if(a==='stop'){await media.stop();return;}
 if(a==='session-request'){
  await selectFriend(id);const current=sessionFor(id);
  if(current?.state==='accepted'){scope={kind:'direct',id:current.id};uiKey='';render();return;}
  if(!friendRecord(id)?.online)throw new Error('친구가 온라인 상태일 때 화면공유를 요청할 수 있어요.');
  if(current?.requester!==loadedUID&&current?.state==='requested'){await action('session-accept',current.id);return;}
  await api.rpc('session_request',{target:id});message('화면공유 요청을 보냈습니다. 상대방 수락을 기다리세요.');await poll(true);return;
 }
 if(a==='session-accept'){
  const s=snapshot.sessions.find(s=>s.id===id);if(!s)throw new Error('요청이 종료되었습니다.');
  const other=s.a===loadedUID?s.b:s.a;await api.rpc('session_accept',{id});await selectFriend(other);await poll(true);return;
 }
 if(a==='session-reject'||a==='session-cancel'){await api.rpc(a==='session-cancel'?'session_end':'session_reject',{id});await poll(true);return;}
 if(a==='end-session'){
  const selected=scope;if(!selected)return;
  if(media.broadcast?.scope.id===selected.id)await media.stop();
  if(selected.kind==='direct')await api.rpc('session_end',{id:selected.id});else await api.rpc('channel_leave');
  for(const [bid,w]of media.watching)if(w.broadcast.scope_id===selected.id)await media.unwatch(bid);
  scope=null;if(selected.kind==='channel'){page='friends';server=null;friend=null;}await poll(true);uiKey='';render();persistNavigation();return;
 }
 if(a==='friend-file'){await selectFriend(id);await sendFile(id,{kind:'friend',id});return;}
 if(a==='send-file'){
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
  const f=friendRecord(id);if(!f)return;const body=el('div');body.append(identity(f.profile,f.online),button('프로필 보기','friend-profile',id));
  const danger=el('section',null,{class:'danger-zone'});danger.append(el('h2','친구 관계 관리'));
  if(f.status==='accepted')danger.append(button('친구 삭제','friend-remove',id));danger.append(button('사용자 차단','block',id));body.append(danger);modal('친구 메뉴',body);return;
 }
 if(a==='friend-profile'){modal('친구 프로필',identity(friendRecord(id)?.profile));return;}
 if(a==='server-create'){formModal('서버 만들기','server-create-form',[{label:'서버 이름',name:'name',attrs:{maxlength:'100',required:'true',placeholder:'친구들과 함께할 공간'}}],'서버 만들기');return;}
 if(a==='server-join'){formModal('서버에 참여하기','server-join-form',[{label:'초대코드',name:'invite',attrs:{required:'true',placeholder:'서버 소유자에게 받은 초대코드'}}],'서버 참여');return;}
 if(a==='channel-create'){formModal('채널 만들기','channel-create-form',[{label:'채널 이름',name:'name',attrs:{maxlength:'64',required:'true',placeholder:'화면공유 채널 이름'}}],'채널 만들기',{server:id});return;}
 if(a==='server-settings'){serverSettings(id);return;}
 if(a==='copy-invite'){await navigator.clipboard.writeText(snapshot.servers.find(s=>s.id===id).invite);message('초대코드를 복사했습니다.');return;}
 if(a==='server-rename'){formModal('서버 이름 변경','server-rename-form',[{label:'서버 이름',name:'name',attrs:{value:snapshot.servers.find(s=>s.id===id).name,maxlength:'100',required:'true'}}],'저장',{server:id});return;}
 if(a==='channel-rename'){const c=snapshot.channels.find(c=>c.id===id);formModal('채널 이름 변경','channel-rename-form',[{label:'채널 이름',name:'name',attrs:{value:c.name,maxlength:'64',required:'true'}}],'저장',{server:c.server_id,channel:id});return;}
 if(a==='channel-files'){const c=snapshot.channels.find(c=>c.id===id);await api.rpc('channel_update',{server_id:c.server_id,id,files_enabled:!c.files_enabled});await poll(true);serverSettings(c.server_id);return;}
 if(a==='server-invite'){if(!await confirmAction('초대코드 갱신','기존 초대코드는 사용할 수 없게 됩니다. 새 초대코드를 만들까요?'))return;await api.rpc('server_invite',{server_id:id});await poll(true);serverSettings(id);return;}
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
 if(a==='logout'){
  const user=await api.account();if(!user.email_confirmed_at)throw new Error('이메일을 인증한 뒤 로그아웃하세요. 기기 계정을 잃지 않도록 보호합니다.');
  if(!await confirmAction('로그아웃','이 기기에서 로그아웃할까요? 다시 로그인하면 친구와 서버가 복원됩니다.'))return;
  if(scope?.kind==='channel')await leaveChannel();await media.stop();for(const [id]of media.watching)await media.unwatch(id);
  await files.suspend();files.close();media.close();files=null;media=null;clearInterval(timer);await log.flush();await chatSave;try{await api.logout();}catch(e){await boot();throw e;}
  snapshot=emptySnapshot();loadedUID=null;conversations={};scope=null;server=null;friend=null;$('#videos').replaceChildren();closeNav();showAuth();return;
 }
 if(a==='settings'){const body=el('div'),f=el('form',null,{id:'settings-edit'});f.append(el('input',null,{name:'maxReceive',type:'number',min:'1',max:'5',value:settings.maxReceive??4}),el('input',null,{name:'turnURL',placeholder:'TURN URL (선택)',value:settings.iceServers?.find(s=>s.username)?.urls??''}),el('input',null,{name:'turnUser',placeholder:'TURN 사용자',autocomplete:'off'}),el('input',null,{name:'turnCredential',type:'password',placeholder:'TURN 인증 (선택)',autocomplete:'off'}),el('button','설정 저장'));const duplicate=el('label','동일한 파일의 중복 전송 방지');const checkbox=el('input',null,{type:'checkbox',name:'preventDuplicates'});checkbox.checked=settings.preventDuplicates??true;duplicate.append(checkbox);f.prepend(duplicate);const channel=el('select',null,{name:'updateChannel'});for(const [value,label]of [['stable','안정 버전'],['test','테스트 버전 포함']]){const option=el('option',label,{value});option.selected=settings.updateChannel===value;channel.append(option);}f.append(channel);body.append(el('p','동시 시청 수 · TURN 설정'),f,button('업데이트 확인','update'),button('진단 내보내기','diagnostics'),el('p','화면공유는 고화질·60fps를 기본으로 요청하며 실제 출력은 기기와 네트워크 성능에 따릅니다. 직접 연결이 어려운 네트워크에서는 별도 TURN이 필요할 수 있습니다.',{class:'muted'}));modal('설정',body);return;}
 if(a==='diagnostics'){await log.flush();const value=sanitizeDiagnostics({history:log.snapshot(),version:VERSION,reconnects:media.reconnects,platform:navigator.userAgent,media:diagnostics,files:[...files.records.values()].map(r=>({state:r.state,bytes:r.offset,size:r.size,error:r.error})),native:bridge.native?await bridge.call('diagnostics'):null});const body=el('div');body.append(el('pre',JSON.stringify(value,null,2)));modal('민감정보를 제외한 진단',body);if(bridge.native)await bridge.call('exportLog',{text:JSON.stringify(value,null,2)});return;}
 if(a==='update'){const r=await fetch('https://api.github.com/repos/'+config.repository+'/releases',{redirect:'error'});if(!r.ok)throw new Error('업데이트 정보를 읽지 못했습니다.');const list=await r.json(),release=list.find(r=>!r.draft&&(settings.updateChannel==='test'||!r.prerelease));const body=el('div');if(!release)body.append(el('p','공식 배포된 버전이 없습니다. 현재 '+VERSION));else{body.append(el('h2',release.tag_name),el('p',release.body??''));for(const a of release.assets){if(a.browser_download_url.startsWith('https://github.com/'+config.repository+'/releases/download/'))body.append(button(a.name,'update-download',a.browser_download_url));}body.append(el('p','설치된 플랫폼의 파일을 선택하세요. iOS는 AltStore 재서명이 필요합니다. 계정 데이터는 앱을 삭제하지 않고 업데이트하면 유지됩니다.',{class:'muted'}));}modal('업데이트',body);return;}if(a==='update-download'){if(!id.startsWith('https://github.com/'+config.repository+'/releases/download/'))throw new Error('잘못된 업데이트 주소');await bridge.call('openExternal',{url:id});return;}
}

document.addEventListener('click',e=>{
 const b=e.target.closest('[data-action]');if(b&&!b.disabled)run(()=>action(b.dataset.action,b.dataset.id),b);
});
$('#dialog-close').onclick=()=>$('#dialog').close();
$('#dialog').addEventListener('close',()=>{if(!$('#dialog').open)$('#dialog-content').replaceChildren();});
document.addEventListener('submit',e=>{
 e.preventDefault();const form=e.target,data=Object.fromEntries(new FormData(form)),control=form.querySelector('button[type=submit],button:not([type])');
 run(async()=>{
  switch(form.id){
   case 'login':await api.login(data.email,data.password);form.querySelector('[name=password]').value='';await boot();break;
   case 'email-register':{
    const value=await api.registerEmail(data.email,data.password,data);form.querySelector('[name=password]').value='';
    if(value.confirmationRequired){verification={type:'signup',reset:false};localStorage.setItem('solaris-verification',JSON.stringify(verification));$('#verify [name=email]').value=data.email;showAuth('verify','가입 이메일의 인증 링크를 연 뒤 로그인하거나, 이메일 인증 코드를 입력하세요.');}
    else{try{await api.rpc('profile',{user_id:data.user_id,nickname:data.nickname});}catch(e){showAuth('claim','가입한 계정은 유지되어 있습니다. 사용할 고유 ID를 다시 설정하세요.');$('#register [name=nickname]').value=data.nickname;throw e;}await boot();}
    break;
   }
   case 'register':if(!api.session)await api.signup();await api.rpc('profile',data);await boot();break;
   case 'recover':{
    const reset=$('#onboarding').dataset.mode==='reset';if(reset)await api.passwordReset(data.email);else await api.emailOTP(data.email);
    verification={type:reset?'recovery':'email',reset};localStorage.setItem('solaris-verification',JSON.stringify(verification));$('#verify [name=email]').value=data.email;showAuth('verify','이메일의 인증 코드를 입력하세요.');break;
   }
   case 'verify':{
    await api.verifyAccount(data.email,data.token,verification.type);localStorage.removeItem('solaris-verification');await boot();
    if(verification.reset)formModal('새 비밀번호 설정','password-edit',[{label:'새 비밀번호','name':'password',attrs:{type:'password',minlength:'8',autocomplete:'new-password',required:'true'}}],'비밀번호 저장');break;
   }
   case 'friend-search':{
    const p=await api.rpc('search',data);if(!p)throw new Error('사용자를 찾지 못했습니다.');
    if(p.uid===loadedUID)throw new Error('내 ID입니다. 친구의 고유 ID를 입력하세요.');
    const row=identity(p);row.append(button('친구 요청 보내기','friend-request-send',p.uid,{class:'primary'}));modal('검색 결과',row);break;
   }
   case 'profile-edit':await api.rpc('profile',data);$('#dialog').close();await poll(true);break;
   case 'recovery-link':
    await api.recoverEmail(data.email);$('#link-verify [name=email]').value=data.email;
    message('이메일로 보낸 인증 코드를 입력해 계정 연결을 완료하세요.');form.append(el('p','이메일로 인증을 보냈습니다. 아래에 받은 코드를 입력하세요.',{class:'form-help'}));break;
   case 'link-verify':await api.verifyEmailLink(data.email,data.token);await api.account();message('기존 계정에 복구 이메일을 연결했습니다. 비밀번호를 설정하면 다른 기기에서도 로그인할 수 있어요.');await profileModal();break;
   case 'password-edit':await api.setPassword(data.password);form.querySelector('[name=password]').value='';$('#dialog').close();message('로그인 비밀번호를 저장했습니다.');break;
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
     const turn={urls:data.turnURL,username:data.turnUser,credential:data.turnCredential};settings.iceServers=[{urls:'stun:stun.l.google.com:19302'},turn];await bridge.call('vaultSet',{key:'turn',value:JSON.stringify(turn)});
    }
    localStorage.setItem('solaris-settings',JSON.stringify({...settings,iceServers:undefined}));media.settings=settings;files.iceServers=media.ice;$('#dialog').close();break;
   }
   case 'chat':{
    const s=selectedScope(),text=data.message.trim();if(!text)return;
    const targets=s.kind==='channel'?snapshot.members.filter(m=>m.channel_id===s.id&&m.profile.uid!==loadedUID&&m.online).map(m=>m.profile.uid):[friend.uid];
    for(const target of targets)await api.signal(s,target,{type:'chat',text});message(text,snapshot.me.nickname);form.reset();break;
   }
  }
 },control);
});
document.addEventListener('change',e=>{if(e.target.id!=='avatar-file')return;run(async()=>{const f=e.target.files[0];if(!f)return;if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>10*1024*1024)throw new Error('10MB 이하 PNG·JPEG·WebP 이미지를 선택하세요.');const url=URL.createObjectURL(f),image=new Image();try{image.src=url;await image.decode();const scale=Math.min(1,512/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.85));if(!blob||blob.size>524288)throw new Error('사진 변환 실패');const path=snapshot.me.uid+'/'+crypto.randomUUID()+'.jpg';await api.avatar(path,blob);const old=snapshot.me.avatar_path;await api.rpc('profile',{avatar_path:path});if(old)await api.avatar(old);$('#dialog').close();await poll();}finally{URL.revokeObjectURL(url);}});});

document.addEventListener('fullscreenchange',()=>{if(bridge.native&&!document.fullscreenElement){nativeFullscreen=false;$('#viewing').classList.remove('native-fullscreen');bridge.call('fullscreen',{enabled:false}).catch(()=>{});}});
globalThis.addEventListener('online',()=>poll());
api.addEventListener('auth',()=>{
 if(files&&files.ownerUID!==api.session?.user?.id)files.close();
 if(api.session&&media)media.refreshAuth().catch(error);
});
globalThis.addEventListener('pagehide',()=>{log?.flush().catch(()=>{});files?.close();media?.close();});
await run(async()=>{
 try{const saved=JSON.parse(localStorage.getItem('solaris-verification')??'null');if(saved&&['email','signup','recovery'].includes(saved.type))verification=saved;}catch{}
 if(bridge.native){const t=await bridge.call('vaultGet',{key:'turn'});if(t)settings.iceServers=[{urls:'stun:stun.l.google.com:19302'},JSON.parse(t)];}
 lifecycle=new AppLifecycle({bridge,getTransfers:()=>files,onForeground:poll,onRestore:boot,onError:error});await lifecycle.start();await boot();
});
