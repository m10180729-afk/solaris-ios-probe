package org.solaris.receiver;
import org.junit.Test;
import static org.junit.Assert.*;

public class AuthCallbacksTest {
 private static final String FIRST="solaris://auth/callback?solaris_state=first&code=fixture-one",SECOND="solaris://auth/callback?solaris_state=second&code=fixture-two";
 @Test public void peekDoesNotConsumeColdStartCallback(){
  AuthCallbacks callbacks=new AuthCallbacks();assertEquals(FIRST,callbacks.capture(FIRST));assertEquals(FIRST,callbacks.peek());assertEquals(FIRST,callbacks.peek());
 }
 @Test public void acknowledgementRequiresExactPendingURL(){
  AuthCallbacks callbacks=new AuthCallbacks();callbacks.capture(FIRST);assertFalse(callbacks.acknowledge("solaris://auth/callback?code=fixture-one&solaris_state=first"));assertEquals(FIRST,callbacks.peek());assertTrue(callbacks.acknowledge(FIRST));assertNull(callbacks.peek());assertFalse(callbacks.acknowledge(FIRST));
 }
 @Test public void staleAcknowledgementCannotEraseNewCallback(){
  AuthCallbacks callbacks=new AuthCallbacks();callbacks.capture(FIRST);callbacks.capture(SECOND);assertFalse(callbacks.acknowledge(FIRST));assertEquals(SECOND,callbacks.peek());assertTrue(callbacks.acknowledge(SECOND));
 }
 @Test public void invalidIncomingURLCannotReplaceValidPendingReturn(){
  AuthCallbacks callbacks=new AuthCallbacks();callbacks.capture(FIRST);assertNull(callbacks.capture("solaris://auth:123/callback?solaris_state=second&code=fixture"));assertNull(callbacks.capture("solaris://auth/callback?code=fixture"));assertNull(callbacks.capture(null));assertEquals(FIRST,callbacks.peek());
 }
 @Test public void cancelClearsWithoutAcknowledgingUnrelatedURL(){
  AuthCallbacks callbacks=new AuthCallbacks();callbacks.capture(FIRST);assertFalse(callbacks.acknowledge(null));callbacks.cancel();assertNull(callbacks.peek());assertFalse(callbacks.acknowledge(FIRST));
 }
 @Test public void providerErrorIsStoredOnlyAsSanitizedReturn(){
  AuthCallbacks callbacks=new AuthCallbacks();String raw="solaris://auth/callback?solaris_state=first#error=server_error&error_code=identity_already_exists&error_description=private-secret&access_token=private-token";String safe="solaris://auth/callback?solaris_state=first&error=oauth_callback_error&error_code=identity_already_exists";
  assertEquals(safe,callbacks.capture(raw));assertEquals(safe,callbacks.peek());assertFalse(callbacks.acknowledge(raw));assertTrue(callbacks.acknowledge(safe));
 }
}
