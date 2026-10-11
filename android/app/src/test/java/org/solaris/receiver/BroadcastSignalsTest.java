package org.solaris.receiver;

import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

// Exercises the production polling/authentication code without a WebView.
// Transport is injected; these results do not claim device/network capture.
public class BroadcastSignalsTest {
 private static final String UID=UUID.randomUUID().toString(),SCOPE=UUID.randomUUID().toString();
 private JSONObject context(String id)throws Exception{return new JSONObject().put("id",id).put("uid",UID).put("url","https://fixture.supabase.co").put("key","sb_publishable_fixture").put("scope",new JSONObject().put("kind","direct").put("id",SCOPE));}
 private JSONObject session(String uid,boolean expired)throws Exception{return new JSONObject().put("user",new JSONObject().put("id",uid)).put("access_token","fixture-access").put("refresh_token","fixture-refresh").put("expires_at",System.currentTimeMillis()/1000+(expired?0:3600));}
 private JSONObject envelope(String broadcast,String kind,String scope)throws Exception{return new JSONObject().put("id",1).put("scope_kind",kind).put("scope_id",scope).put("sender",UUID.randomUUID().toString()).put("payload",new JSONObject().put("type","media-join").put("broadcast",broadcast));}
 private static final class Listener implements BroadcastSignals.Listener {
  final CountDownLatch delivered=new CountDownLatch(1),ended=new CountDownLatch(1);
  final List<JSONObject> signals=new CopyOnWriteArrayList<>();final AtomicInteger snapshots=new AtomicInteger();final List<Exception> errors=new CopyOnWriteArrayList<>();
  public void snapshot(String id,JSONObject value){snapshots.incrementAndGet();}
  public void signal(JSONObject value){signals.add(value);delivered.countDown();}
  public void ended(String id,String reason){ended.countDown();}
  public void error(Exception error){errors.add(error);}
 }
 private BroadcastSignals.Vault vault(AtomicReference<JSONObject> stored){return new BroadcastSignals.Vault(){public JSONObject load(){return stored.get();}public void save(JSONObject value){stored.set(value);}};}
 @Test public void nativePollingFiltersScopeAndRefreshesProtectedSession()throws Exception{
  String id=UUID.randomUUID().toString();AtomicReference<JSONObject> stored=new AtomicReference<>(session(UID,true));AtomicInteger refreshes=new AtomicInteger();Listener listener=new Listener();
  try(BroadcastSignals signals=new BroadcastSignals(vault(stored),listener,(ctx,path,body,authorization)->{
   if(path.startsWith("/auth/")){assertNull(authorization);assertEquals("fixture-refresh",body.getString("refresh_token"));refreshes.incrementAndGet();return session(UID,false).put("access_token","fixture-renewed");}
   assertEquals("Bearer fixture-renewed",authorization);
   if(body.getString("action").equals("broadcast_touch"))return Boolean.TRUE;
   return new JSONObject().put("signals",new JSONArray().put(envelope(UUID.randomUUID().toString(),"direct",SCOPE)).put(envelope(id,"channel",SCOPE)).put(envelope(id,"direct",UUID.randomUUID().toString())).put(envelope(id,"direct",SCOPE)));
  })){
   signals.start(context(id));assertTrue(listener.delivered.await(5,TimeUnit.SECONDS));assertEquals(1,listener.signals.size());assertEquals(id,listener.signals.get(0).getJSONObject("payload").getString("broadcast"));assertEquals(1,refreshes.get());assertEquals("fixture-renewed",stored.get().getString("access_token"));assertTrue(listener.errors.toString(),listener.errors.isEmpty());
  }
 }
 @Test public void accountChangeStopsPublisherBeforeAnotherAuthenticatedRequest()throws Exception{
  AtomicReference<JSONObject> stored=new AtomicReference<>(session(UUID.randomUUID().toString(),false));AtomicInteger calls=new AtomicInteger();Listener listener=new Listener();
  try(BroadcastSignals signals=new BroadcastSignals(vault(stored),listener,(ctx,path,body,authorization)->{calls.incrementAndGet();return Boolean.TRUE;})){
   signals.start(context(UUID.randomUUID().toString()));assertTrue(listener.ended.await(5,TimeUnit.SECONDS));assertEquals(0,calls.get());assertEquals(0,listener.snapshots.get());
  }
 }
 @Test public void responseFromReplacedBroadcastCannotAttachToNewCapture()throws Exception{
  String old=UUID.randomUUID().toString(),current=UUID.randomUUID().toString();AtomicReference<JSONObject> stored=new AtomicReference<>(session(UID,false));Listener listener=new Listener();CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
  try(BroadcastSignals signals=new BroadcastSignals(vault(stored),listener,(ctx,path,body,authorization)->{
   if(body.getString("action").equals("broadcast_touch"))return Boolean.TRUE;
   String id=ctx.getString("id");if(id.equals(old)){entered.countDown();assertTrue(release.await(5,TimeUnit.SECONDS));}
   return new JSONObject().put("signals",new JSONArray().put(envelope(id,"direct",SCOPE)));
  })){
   signals.start(context(old));assertTrue(entered.await(5,TimeUnit.SECONDS));signals.start(context(current));release.countDown();assertTrue(listener.delivered.await(5,TimeUnit.SECONDS));assertEquals(1,listener.snapshots.get());assertEquals(1,listener.signals.size());assertEquals(current,listener.signals.get(0).getJSONObject("payload").getString("broadcast"));
  }finally{release.countDown();}
 }
 @Test public void rejectedBroadcastLeaseEndsWithoutConsumingInbox()throws Exception{
  AtomicReference<JSONObject> stored=new AtomicReference<>(session(UID,false));Listener listener=new Listener();AtomicInteger requests=new AtomicInteger();
  try(BroadcastSignals signals=new BroadcastSignals(vault(stored),listener,(ctx,path,body,authorization)->{requests.incrementAndGet();return Boolean.FALSE;})){
   signals.start(context(UUID.randomUUID().toString()));assertTrue(listener.ended.await(5,TimeUnit.SECONDS));assertEquals(1,requests.get());assertEquals(0,listener.snapshots.get());
  }
 }
 @Test public void insecureProjectUrlRejectedBeforeNetwork()throws Exception{
  Listener listener=new Listener();AtomicReference<JSONObject> stored=new AtomicReference<>(session(UID,false));
  try(BroadcastSignals signals=new BroadcastSignals(vault(stored),listener,(ctx,path,body,authorization)->{fail("must not request");return null;})){
   assertThrows(IOException.class,()->signals.start(context(UUID.randomUUID().toString()).put("url","http://fixture.supabase.co")));
  }
 }
}
