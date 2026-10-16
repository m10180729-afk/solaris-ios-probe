package org.solaris.receiver;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.util.*;

/** Auth URLs are opened by the system browser, never by the app WebView. */
public final class AuthUrls {
 public static boolean allowed(String text){try{URI u=new URI(text);if(!"https".equals(u.getScheme())||u.getUserInfo()!=null||u.getPort()!=-1)return false;
  return "lfwjkaipghctigswxoxq.supabase.co".equals(u.getHost())&&"/auth/v1/authorize".equals(u.getPath())||
   "accounts.google.com".equals(u.getHost())&&u.getPath().startsWith("/o/oauth2/");
 }catch(Exception e){return false;}}
 private static final String CALLBACK="solaris://auth/callback";
 private static final Set<String> ERROR_CODES=new HashSet<>(Arrays.asList("identity_already_exists","access_denied","user_cancelled","unsupported_implicit_response","callback_code_missing","oauth_callback_error"));
 public static boolean callback(String text){return normalizeCallback(text)!=null;}
 /** Only query PKCE codes survive. Provider descriptions and implicit tokens never leave native code. */
 public static String normalizeCallback(String text){try{
  if(text==null||text.length()>=16384)return null;
  URI u=new URI(text);
  if(!"solaris".equals(u.getScheme())||!"auth".equals(u.getRawAuthority())||!"/callback".equals(u.getRawPath()))return null;
  Map<String,List<String>> query=parameters(u.getRawQuery()),fragment=parameters(u.getRawFragment());
  List<String> states=query.get("solaris_state");
  if(states==null||states.size()!=1||!states.get(0).matches("[A-Za-z0-9_-]{1,256}"))return null;
  String state=states.get(0),base=CALLBACK+"?solaris_state="+encode(state);
  List<String> errors=combined(query,fragment,"error"),codes=combined(query,fragment,"error_code");
  if(!errors.isEmpty()||!codes.isEmpty()){
   String code="oauth_callback_error";
   if(errors.size()<=1&&codes.size()==1&&ERROR_CODES.contains(codes.get(0)))code=codes.get(0);
   else if(codes.isEmpty()&&errors.size()==1&&ERROR_CODES.contains(errors.get(0)))code=errors.get(0);
   return failure(base,code);
  }
  for(String token:new String[]{"access_token","refresh_token","token_type"})
   if(query.containsKey(token)||fragment.containsKey(token))return failure(base,"unsupported_implicit_response");
  List<String> authCodes=query.get("code");
  if(authCodes==null||authCodes.size()!=1||authCodes.get(0).trim().isEmpty()||authCodes.get(0).length()>4096||authCodes.get(0).matches("(?s).*[\\x00-\\x1f\\x7f].*"))return failure(base,"callback_code_missing");
  return base+"&code="+encode(authCodes.get(0));
 }catch(Exception ignored){return null;}}
 private static String failure(String base,String code){return base+"&error=oauth_callback_error&error_code="+code;}
 private static String encode(String value)throws Exception{return URLEncoder.encode(value,"UTF-8");}
 private static Map<String,List<String>> parameters(String raw)throws Exception{
  Map<String,List<String>> values=new HashMap<>();
  if(raw==null||raw.isEmpty())return values;
  for(String item:raw.split("&",-1)){
   int separator=item.indexOf('=');String key=URLDecoder.decode(separator<0?item:item.substring(0,separator),"UTF-8"),value=URLDecoder.decode(separator<0?"":item.substring(separator+1),"UTF-8");
   values.computeIfAbsent(key,ignored->new ArrayList<>()).add(value);
  }
  return values;
 }
 private static List<String> combined(Map<String,List<String>> query,Map<String,List<String>> fragment,String key){
  List<String> values=new ArrayList<>();if(query.containsKey(key))values.addAll(query.get(key));if(fragment.containsKey(key))values.addAll(fragment.get(key));return values;
 }
}
