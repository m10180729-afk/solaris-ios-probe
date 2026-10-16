package org.solaris.receiver;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class ReceiveOnlyMediaTest {
 @Test public void bridgeCannotAdvertiseCaptureOrNativeSender()throws Exception{
  JSONObject platform=ReceiveOnlyMedia.platform("fixture-build65");
  assertEquals("android",platform.getString("platform"));assertEquals("fixture-build65",platform.getString("version"));
  assertTrue(platform.getBoolean("receiveOnly"));assertFalse(platform.getBoolean("canPublish"));
  assertFalse(platform.getBoolean("mediaSend"));assertFalse(platform.getBoolean("nativeSignaling"));
  assertFalse(platform.getBoolean("nativeReceive"));assertFalse(platform.getBoolean("systemTitlebar"));
 }
 @Test public void obsoleteStartFailsWithAnActionableFixedMessage()throws Exception{
  try{ReceiveOnlyMedia.command("mediaStart");fail("Android must never start a sender");}
  catch(UnsupportedOperationException error){assertEquals(ReceiveOnlyMedia.START_ERROR,error.getMessage());}
  assertFalse(ReceiveOnlyMedia.status().getBoolean("active"));
 }
 @Test public void otherSenderCommandsCannotBypassStartRejection()throws Exception{
  for(String command:new String[]{"mediaJoin","mediaRecover","mediaAnswer","mediaIce","mediaHeartbeat","mediaQuality","mediaLeave"}){
   try{ReceiveOnlyMedia.command(command);fail(command+" must not be dispatched to a capture engine");}
   catch(UnsupportedOperationException expected){}
  }
 }
 @Test public void repeatedStopIsSafeAndDoesNotRestoreOldBroadcasts()throws Exception{
  assertEquals(true,ReceiveOnlyMedia.command("mediaStop"));assertEquals(true,ReceiveOnlyMedia.command("mediaStop"));
  JSONObject state=(JSONObject)ReceiveOnlyMedia.command("mediaStatus");
  assertTrue(state.isNull("id"));assertFalse(state.getBoolean("active"));
  assertTrue(state.getBoolean("receiveOnly"));assertEquals(0,state.getJSONArray("peers").length());
 }
}
