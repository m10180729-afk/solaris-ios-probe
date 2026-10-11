package org.solaris.receiver;
import android.app.*;import android.content.*;import android.os.*;
public final class ProjectionService extends Service {
 interface Listener { void started(); void failed(Exception error); }
 private static String pendingTicket;
 private static Listener pending;
 static synchronized void arm(String ticket,Listener listener){pendingTicket=ticket;pending=listener;}
 static synchronized void cancel(){pending=null;pendingTicket=null;}
 private static synchronized Listener take(String ticket){if(ticket==null||!ticket.equals(pendingTicket))return null;Listener listener=pending;cancel();return listener;}
 @Override public int onStartCommand(Intent intent,int flags,int startId){
  Listener listener=take(intent==null?null:intent.getStringExtra("ticket"));
  if(listener==null){stopSelf(startId);return START_NOT_STICKY;}
  try{
   NotificationManager manager=getSystemService(NotificationManager.class);
   manager.createNotificationChannel(new NotificationChannel("solaris-screen","Solaris 화면공유",NotificationManager.IMPORTANCE_LOW));
   Notification note=new Notification.Builder(this,"solaris-screen").setSmallIcon(android.R.drawable.ic_menu_view).setContentTitle("Solaris 화면공유 중").setContentText("화면공유 중지는 Solaris에서 선택하세요.").setOngoing(true).build();
   startForeground(551,note,android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);listener.started();
  }catch(Exception error){new NativeDiagnostics(this).record("projection-service",error);listener.failed(error);stopSelf(startId);}
  return START_NOT_STICKY;
 }
 @Override public IBinder onBind(Intent intent){return null;}
}
