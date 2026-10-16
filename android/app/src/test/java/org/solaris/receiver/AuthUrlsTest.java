package org.solaris.receiver;
import org.junit.Test;
import static org.junit.Assert.*;
public class AuthUrlsTest {
 private static final String BASE="solaris://auth/callback",STATE="87654321-1234-4321-abcd-123456789abc",QUERY=BASE+"?solaris_state="+STATE;
 private static String error(String code){return QUERY+"&error=oauth_callback_error&error_code="+code;}
 @Test public void externalBrowserURLsRejectLookalikes(){
  assertTrue(AuthUrls.allowed("https://lfwjkaipghctigswxoxq.supabase.co/auth/v1/authorize?provider=google"));
  assertTrue(AuthUrls.allowed("https://accounts.google.com/o/oauth2/v2/auth"));
  for(String value:new String[]{"https://accounts.google.com.evil.test/o/oauth2/auth","https://user@accounts.google.com/o/oauth2/auth","http://accounts.google.com/o/oauth2/auth","https://accounts.google.com:444/o/oauth2/auth","https://lfwjkaipghctigswxoxq.supabase.co/other"})assertFalse(value,AuthUrls.allowed(value));
 }
 @Test public void successfulQueryPKCECodeIsPreservedWithoutOtherFields(){
  assertEquals(QUERY+"&code=fixture%2Bcode%2F%25%3D%3F",AuthUrls.normalizeCallback(BASE+"?code=fixture%2Bcode%2F%25%3D%3F&email=private-fixture&solaris_state="+STATE));
 }
 @Test public void callbacksRequireExactPrivateBaseIncludingNoPortOrUserInfo(){
  for(String value:new String[]{"solaris://other/callback","solaris://auth/callback/extra","solaris://auth:123/callback","solaris://auth:/callback","solaris://user@auth/callback","solaris://auth/%63allback","solaris://AUTH/callback","SOLARIS://auth/callback","https://auth/callback",null})assertNull(String.valueOf(value),AuthUrls.normalizeCallback(value==null?null:value+"?solaris_state="+STATE+"&code=fixture"));
 }
 @Test public void callbackStateMustBeOneNonemptyQueryValue(){
  for(String value:new String[]{BASE+"?code=fixture",BASE+"?solaris_state=&code=fixture",QUERY+"&solaris_state=other&code=fixture",QUERY+"&solaris%5fstate=other&code=fixture",BASE+"?code=fixture#solaris_state="+STATE})assertNull(value,AuthUrls.normalizeCallback(value));
 }
 @Test public void identityErrorFragmentBecomesStaticQueryWithoutProviderSecrets(){
  String raw=QUERY+"&code=private-code#error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked+private-description&access_token=private-access&refresh_token=private-refresh&solaris_state=private-fragment-state";
  String safe=AuthUrls.normalizeCallback(raw);
  assertEquals(error("identity_already_exists"),safe);
  for(String secret:new String[]{"private-code","private-description","private-access","private-refresh","private-fragment-state","error_description","access_token","refresh_token","#"})assertFalse(secret,safe.contains(secret));
 }
 @Test public void unknownProviderErrorsNeverEchoUntrustedText(){
  assertEquals(error("oauth_callback_error"),AuthUrls.normalizeCallback(QUERY+"#error=secret-error&error_code=secret-code&error_description=secret-description"));
 }
 @Test public void onlySharedStaticErrorCodesSurvive(){
  for(String code:new String[]{"identity_already_exists","access_denied","user_cancelled","unsupported_implicit_response","callback_code_missing","oauth_callback_error"})assertEquals(error(code),AuthUrls.normalizeCallback(QUERY+"#error=server_error&error_code="+code));
  assertEquals(error("access_denied"),AuthUrls.normalizeCallback(QUERY+"#error=access_denied&error_description=private"));
 }
 @Test public void duplicateProviderErrorFieldsUseGenericStaticError(){
  for(String fields:new String[]{"#error=server_error&error_code=identity_already_exists&error_code=access_denied","&error_code=identity_already_exists#error_code=access_denied","#error=server_error&error=access_denied&error_code=identity_already_exists"})assertEquals(error("oauth_callback_error"),AuthUrls.normalizeCallback(QUERY+fields));
 }
 @Test public void implicitFragmentTokensBecomeUnsupportedErrorWithoutTokens(){
  assertEquals(error("unsupported_implicit_response"),AuthUrls.normalizeCallback(QUERY+"&code=private-code#access_token=private-access&refresh_token=private-refresh&token_type=bearer&expires_in=3600"));
 }
 @Test public void implicitQueryTokensCannotBeMixedWithPKCE(){
  assertEquals(error("unsupported_implicit_response"),AuthUrls.normalizeCallback(QUERY+"&code=private-code&access_token=private-access"));
 }
 @Test public void fragmentPKCECodeIsNotAccepted(){
  assertEquals(error("callback_code_missing"),AuthUrls.normalizeCallback(QUERY+"#code=private-fragment-code"));
 }
 @Test public void missingEmptyDuplicateOrOversizedCodeHasStaticFailure(){
  for(String extra:new String[]{"","&code=","&code=fixture&code=private-duplicate","&code=%00private-code","&code="+"x".repeat(4097)})assertEquals(error("callback_code_missing"),AuthUrls.normalizeCallback(QUERY+extra));
 }
 @Test public void emptyFragmentIsRemovedBeforeNormalQueryValidation(){
  assertEquals(QUERY+"&code=fixture",AuthUrls.normalizeCallback(QUERY+"&code=fixture#"));
  assertEquals(error("callback_code_missing"),AuthUrls.normalizeCallback(QUERY+"#"));
 }
 @Test public void fragmentStateAndUnrelatedFieldsDoNotReplaceQueryState(){
  assertEquals(QUERY+"&code=fixture",AuthUrls.normalizeCallback(QUERY+"&code=fixture#solaris_state=private-fragment-state&error_description=private-description"));
 }
 @Test public void invalidEncodingAndOversizedCallbacksAreRejectedWithoutThrowing(){
  for(String value:new String[]{QUERY+"&code=%",QUERY+"&code=%GG",QUERY+"&code=fixture#bad=%",QUERY+"&padding="+"x".repeat(16384)})assertNull(AuthUrls.normalizeCallback(value));
 }
 @Test public void stateCannotCarryWhitespaceControlsOrArbitrarySecretText(){
  for(String state:new String[]{"space+fixture","%00fixture","Bearer+private","%ED%95%9C","x".repeat(257)})assertNull(AuthUrls.normalizeCallback(BASE+"?solaris_state="+state+"&code=fixture"));
  assertEquals(BASE+"?solaris_state=fixture_state-123&code=fixture",AuthUrls.normalizeCallback(BASE+"?solaris%5fstate=fixture_state-123&code=fixture"));
 }
}
