package org.solaris.receiver;
import org.junit.Test;
import static org.junit.Assert.*;
public class AuthUrlsTest {
 @Test public void externalBrowserURLsRejectLookalikes(){
  assertTrue(AuthUrls.allowed("https://lfwjkaipghctigswxoxq.supabase.co/auth/v1/authorize?provider=google"));
  assertTrue(AuthUrls.allowed("https://accounts.google.com/o/oauth2/v2/auth"));
  for(String value:new String[]{"https://accounts.google.com.evil.test/o/oauth2/auth","https://user@accounts.google.com/o/oauth2/auth","http://accounts.google.com/o/oauth2/auth","https://accounts.google.com:444/o/oauth2/auth","https://lfwjkaipghctigswxoxq.supabase.co/other"})assertFalse(value,AuthUrls.allowed(value));
 }
 @Test public void callbacksRequireExactPrivateSchemeAndNoFragment(){
  assertTrue(AuthUrls.callback("solaris://auth/callback?solaris_state=fixture&code=fixture"));
  for(String value:new String[]{"solaris://other/callback?code=x","solaris://auth/callback/extra?code=x","solaris://auth:123/callback?code=x","solaris://user@auth/callback?code=x","solaris://auth/callback#access_token=x","https://auth/callback",null})assertFalse(String.valueOf(value),AuthUrls.callback(value));
 }
}
