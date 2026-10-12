package org.solaris.receiver;
import java.net.URI;

/** Auth URLs are opened by the system browser, never by the app WebView. */
public final class AuthUrls {
 public static boolean allowed(String text){try{URI u=new URI(text);if(!"https".equals(u.getScheme())||u.getUserInfo()!=null||u.getPort()!=-1)return false;
  return "lfwjkaipghctigswxoxq.supabase.co".equals(u.getHost())&&"/auth/v1/authorize".equals(u.getPath())||
   "accounts.google.com".equals(u.getHost())&&u.getPath().startsWith("/o/oauth2/");
 }catch(Exception e){return false;}}
 public static boolean callback(String text){try{URI u=new URI(text);return "solaris".equals(u.getScheme())&&"auth".equals(u.getHost())&&"/callback".equals(u.getPath())&&u.getUserInfo()==null&&u.getPort()==-1&&u.getFragment()==null&&text.length()<16384;}catch(Exception e){return false;}}
}
