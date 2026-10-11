package org.solaris.receiver;
import org.junit.Test;
import static org.junit.Assert.*;

public class CaptureEpochTest {
 @Test public void oldStopCannotEndRestartUsingSameBroadcastId(){
  CaptureEpoch gate=new CaptureEpoch();long old=gate.begin();gate.invalidate();long restarted=gate.begin();
  assertFalse(gate.matches(old));assertTrue(gate.matches(restarted));
 }
 @Test public void cancellingBeforeFirstFrameRejectsLateReadyAndResize(){
  CaptureEpoch gate=new CaptureEpoch();long preparing=gate.begin();gate.invalidate();
  assertFalse(gate.matches(preparing));
 }
 @Test public void secondStartInvalidatesPreviouslyConnectedCapture(){
  CaptureEpoch gate=new CaptureEpoch();long connected=gate.begin(),replacement=gate.begin();
  assertFalse(gate.matches(connected));assertTrue(gate.matches(replacement));
 }
}
