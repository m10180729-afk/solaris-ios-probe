package org.solaris.receiver;

import org.junit.Test;
import static org.junit.Assert.*;

public class ProjectionRequestsTest {
 @Test public void cancelledConsentCannotStartReplacementBroadcast(){
  ProjectionRequests requests=new ProjectionRequests();
  ProjectionRequests.Request first=requests.begin("old-ticket","old-broadcast");
  assertSame(first,requests.cancel());
  ProjectionRequests.Request next=requests.begin("new-ticket","new-broadcast");
  assertNotEquals(first.code,next.code);
  assertNull(requests.permission(first.code));
  assertSame(next,requests.permission(next.code));
  assertEquals("new-broadcast",next.broadcast);
 }
 @Test public void consentResultIsConsumedOnlyOnce(){
  ProjectionRequests requests=new ProjectionRequests();
  ProjectionRequests.Request request=requests.begin("ticket","broadcast");
  assertSame(request,requests.permission(request.code));
  assertNull(requests.permission(request.code));
  assertTrue(requests.current(request));
 }
 @Test public void approvedAttemptStaysOwnedUntilFirstCaptureCompletes(){
  ProjectionRequests requests=new ProjectionRequests();
  ProjectionRequests.Request request=requests.begin("ticket","broadcast");
  requests.permission(request.code);
  assertThrows(IllegalStateException.class,()->requests.begin("other","other"));
  assertTrue(requests.complete(request));
  assertFalse(requests.current(request));
  assertNotNull(requests.begin("other","other"));
 }
 @Test public void lateForegroundServiceAndFrameCallbacksCannotCompleteReplacement(){
  ProjectionRequests requests=new ProjectionRequests();
  ProjectionRequests.Request first=requests.begin("old","old");
  requests.permission(first.code);requests.cancel();
  ProjectionRequests.Request next=requests.begin("new","new");
  assertFalse(requests.current(first));
  assertFalse(requests.complete(first));
  assertSame(next,requests.pending());
 }
 @Test public void unrelatedActivityResultsDoNotConsumeConsent(){
  ProjectionRequests requests=new ProjectionRequests();
  ProjectionRequests.Request request=requests.begin("ticket","broadcast");
  assertFalse(ProjectionRequests.permissionCode(43));
  assertNull(requests.permission(43));
  assertSame(request,requests.permission(request.code));
 }
 @Test public void activityRecreationDoesNotReusePreviousConsentCode(){
  ProjectionRequests previous=new ProjectionRequests();
  ProjectionRequests.Request first=previous.begin("old","old");
  ProjectionRequests restored=new ProjectionRequests();restored.restoreNextCode(previous.nextCode());
  ProjectionRequests.Request next=restored.begin("new","new");
  assertNotEquals(first.code,next.code);assertNull(restored.permission(first.code));assertSame(next,restored.permission(next.code));
 }
 @Test public void codesNeverWrapAndMistakeAnOldApprovalForANewOne(){
  ProjectionRequests requests=new ProjectionRequests();
  for(int code=ProjectionRequests.FIRST_CODE;code<=ProjectionRequests.LAST_CODE;code++){
   assertEquals(code,requests.begin("ticket","broadcast").code);requests.cancel();
  }
  assertThrows(IllegalStateException.class,()->requests.begin("ticket","broadcast"));
 }
}
