package org.solaris.receiver;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** The Android app receives video through WebView; it cannot capture a screen. */
final class ReceiveOnlyMedia {
 static final String START_ERROR="Android는 화면 받기 전용입니다. Windows 또는 iPhone·iPad에서 화면공유를 시작하세요.";
 static JSONObject platform(String version)throws JSONException{
  return new JSONObject().put("platform","android").put("version",version)
   .put("mediaSend",false).put("canPublish",false).put("receiveOnly",true)
   .put("nativeSignaling",false).put("nativeReceive",false).put("systemTitlebar",false);
 }
 static JSONObject status()throws JSONException{
  return new JSONObject().put("id",JSONObject.NULL).put("active",false)
   .put("receiveOnly",true).put("nativeSignaling",false).put("peers",new JSONArray());
 }
 static Object command(String command)throws JSONException{
  if(command.equals("mediaStatus"))return status();
  if(command.equals("mediaStop"))return true;
  if(command.equals("mediaStart"))throw new UnsupportedOperationException(START_ERROR);
  throw new UnsupportedOperationException("Android 화면 송출 명령은 지원하지 않습니다.");
 }
}
