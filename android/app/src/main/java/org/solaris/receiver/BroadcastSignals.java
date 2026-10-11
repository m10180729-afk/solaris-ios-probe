package org.solaris.receiver;

import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.*;

// The foreground capture must not depend on a background WebView's JS timers.
// Inbox cursors are independent: this reader handles only this broadcast.
final class BroadcastSignals implements AutoCloseable {
 interface Vault { JSONObject load() throws Exception; void save(JSONObject session) throws Exception; }
 interface Listener {
  void snapshot(String broadcast,JSONObject value);
  void signal(JSONObject envelope);
  void ended(String broadcast,String reason);
  void error(Exception error);
 }
 interface Transport { Object request(JSONObject context,String path,JSONObject body,String authorization)throws Exception; }
 private final Vault vault;private final Listener listener;
 private final Transport transport;
 private final ScheduledExecutorService network=Executors.newSingleThreadScheduledExecutor();
 private volatile String active;private volatile boolean closed;
 private JSONObject context;private long cursor,lastTouch,lastError;private JSONObject session;
 BroadcastSignals(Vault vault,Listener listener){this(vault,listener,null);}
 BroadcastSignals(Vault vault,Listener listener,Transport transport){this.vault=vault;this.listener=listener;this.transport=transport;network.scheduleWithFixedDelay(this::poll,1,1,TimeUnit.SECONDS);}
 void start(JSONObject args)throws Exception{
  if(closed)throw new IOException("화면공유 엔진이 종료되었습니다.");
  String url=args.getString("url"),key=args.getString("key"),id=args.getString("id");
  UUID.fromString(id);UUID.fromString(args.getString("uid"));JSONObject scope=args.getJSONObject("scope");UUID.fromString(scope.getString("id"));
  if(!url.matches("https://[a-z0-9]+\\.supabase\\.co")||!key.startsWith("sb_publishable_")||!scope.getString("kind").matches("direct|channel"))throw new IOException("유효하지 않은 화면공유 인증 설정");
  JSONObject copy=new JSONObject(args.toString());active=id;
  network.execute(()->{context=copy;cursor=0;lastTouch=0;session=null;});
 }
 private boolean current(String id){return !closed&&id!=null&&id.equals(active);}
 private void poll(){
  String id=active;if(!current(id)||context==null||!id.equals(context.optString("id")))return;
  try{
   ensure();if(!current(id))return;
   if(System.currentTimeMillis()-lastTouch>10000){
    Object alive=rpc("broadcast_touch",new JSONObject().put("id",id));
    if(!current(id))return;
    if(!Boolean.TRUE.equals(alive)){active=null;listener.ended(id,"화면공유 권한 또는 방송 상태가 종료되었습니다.");return;}
    lastTouch=System.currentTimeMillis();
   }
   JSONObject snapshot=(JSONObject)rpc("sync",new JSONObject().put("cursor",cursor));
   if(!current(id))return;listener.snapshot(id,snapshot);
   JSONArray signals=snapshot.optJSONArray("signals");JSONObject scope=context.getJSONObject("scope");
   if(signals!=null)for(int i=0;i<signals.length();i++){
    JSONObject envelope=signals.getJSONObject(i);cursor=Math.max(cursor,envelope.optLong("id"));JSONObject p=envelope.optJSONObject("payload");
    if(p!=null&&id.equals(p.optString("broadcast"))&&scope.getString("kind").equals(envelope.optString("scope_kind"))&&scope.getString("id").equals(envelope.optString("scope_id")))listener.signal(envelope);
   }
  }catch(SecurityException e){if(current(id)){active=null;listener.ended(id,e.getMessage());}}
  catch(Exception e){if(current(id)&&System.currentTimeMillis()-lastError>10000){lastError=System.currentTimeMillis();listener.error(e);}}
 }
 void send(String id,String recipient,JSONObject payload){
  if(!current(id))return;
  network.execute(()->{if(!current(id)||context==null||!id.equals(context.optString("id")))return;try{
   ensure();JSONObject scope=context.getJSONObject("scope");
   rpc("signal",new JSONObject().put("scope_kind",scope.getString("kind")).put("scope_id",scope.getString("id")).put("recipient",recipient).put("payload",payload));
  }catch(Exception e){if(current(id))listener.error(e);}});
 }
 private void ensure()throws Exception{
  JSONObject latest=vault.load();String uid=context.getString("uid");
  if(latest==null||!uid.equals(latest.getJSONObject("user").optString("id")))throw new SecurityException("화면공유 계정이 변경되었습니다.");
  if(session==null||latest.optDouble("expires_at")>=session.optDouble("expires_at"))session=latest;
  if(session.optDouble("expires_at")*1000>System.currentTimeMillis()+90000)return;
  JSONObject refreshed=(JSONObject)request("/auth/v1/token?grant_type=refresh_token",new JSONObject().put("refresh_token",session.getString("refresh_token")),false);
  if(!uid.equals(refreshed.getJSONObject("user").optString("id")))throw new SecurityException("갱신된 계정이 일치하지 않습니다.");
  if(!refreshed.has("expires_at"))refreshed.put("expires_at",System.currentTimeMillis()/1000+refreshed.optLong("expires_in",3600));
  latest=vault.load();if(latest!=null&&!uid.equals(latest.getJSONObject("user").optString("id")))throw new SecurityException("화면공유 계정이 변경되었습니다.");
  if(latest!=null&&latest.optDouble("expires_at")>refreshed.optDouble("expires_at"))session=latest;
  else{session=refreshed;vault.save(session);}
 }
 private Object rpc(String action,JSONObject args)throws Exception{return request("/rest/v1/rpc/solaris_action",new JSONObject().put("action",action).put("args",args),true);}
 private Object request(String path,JSONObject body,boolean authorized)throws Exception{
  if(transport!=null)return transport.request(context,path,body,authorized?"Bearer "+session.getString("access_token"):null);
  HttpURLConnection connection=(HttpURLConnection)new URL(context.getString("url")+path).openConnection();
  connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(5000);connection.setReadTimeout(5000);connection.setRequestMethod("POST");connection.setDoOutput(true);
  connection.setRequestProperty("Content-Type","application/json");connection.setRequestProperty("apikey",context.getString("key"));
  if(authorized)connection.setRequestProperty("Authorization","Bearer "+session.getString("access_token"));
  byte[] request=body.toString().getBytes(StandardCharsets.UTF_8);connection.setFixedLengthStreamingMode(request.length);
  try{
   try(OutputStream out=connection.getOutputStream()){out.write(request);}
   int code=connection.getResponseCode();
   if(code==401||code==403)throw new SecurityException("화면공유 신호 권한이 종료되었습니다. "+code);
   if(code<200||code>=300)throw new IOException("화면공유 신호 서버 응답 "+code);
   try(InputStream in=connection.getInputStream();ByteArrayOutputStream result=new ByteArrayOutputStream()){
    byte[] block=new byte[16384];int n;
    while((n=in.read(block))!=-1){if(result.size()+n>2*1024*1024)throw new IOException("신호 응답 크기 초과");result.write(block,0,n);}
    return new JSONTokener(result.toString("UTF-8")).nextValue();
   }
  }finally{connection.disconnect();}
 }
 void stop(){active=null;}
 @Override public void close(){active=null;closed=true;network.shutdownNow();}
}
