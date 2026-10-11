package org.solaris.receiver;
import org.junit.Test;import static org.junit.Assert.*;
public class CaptureGeometryTest {
 @Test public void portraitIsNotForcedIntoLandscape(){assertArrayEquals(new int[]{1080,2400},CaptureGeometry.fit(1080,2400,2560,1440));}
 @Test public void highDensityDisplayKeepsItsAspect(){int[] s=CaptureGeometry.fit(1440,3200,2560,1440);assertEquals(2560,s[1]);assertEquals(1440.0/3200,(double)s[0]/s[1],.001);}
 @Test public void smallerDisplayIsNotUpscaled(){assertArrayEquals(new int[]{720,1280},CaptureGeometry.fit(720,1280,2560,1440));}
 @Test public void dimensionsAreEven(){int[] s=CaptureGeometry.fit(1081,2401,2560,1440);assertEquals(0,s[0]%2);assertEquals(0,s[1]%2);}
 @Test(expected=IllegalArgumentException.class) public void rejectsEmptyBounds(){CaptureGeometry.fit(0,1080,2560,1440);}
}
