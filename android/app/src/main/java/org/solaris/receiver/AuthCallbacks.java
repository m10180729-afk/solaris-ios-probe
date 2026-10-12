package org.solaris.receiver;

/** In-memory callback mailbox: reading cannot race with acknowledging a later return. */
final class AuthCallbacks {
 private String pending;
 synchronized String capture(String raw){String normalized=AuthUrls.normalizeCallback(raw);if(normalized!=null)pending=normalized;return normalized;}
 synchronized String peek(){return pending;}
 synchronized boolean acknowledge(String value){if(pending==null||!pending.equals(value))return false;pending=null;return true;}
 synchronized void cancel(){pending=null;}
}
