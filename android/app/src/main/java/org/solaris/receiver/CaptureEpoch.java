package org.solaris.receiver;
import java.util.concurrent.atomic.AtomicLong;

/** Capture lifecycle token, independent of a reused backend broadcast ID. */
final class CaptureEpoch {
 private final AtomicLong value=new AtomicLong();
 long begin(){return value.incrementAndGet();}
 void invalidate(){value.incrementAndGet();}
 boolean matches(long token){return token==value.get();}
}
