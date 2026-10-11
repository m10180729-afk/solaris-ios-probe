package org.solaris.receiver;
import android.app.*;import android.content.*;import android.os.*;
public final class ProjectionService extends Service{
 static Runnable startCallback;
 @Override public int onStartCommand(Intent intent,int flags,int startId){NotificationManager n=getSystemService(NotificationManager.class);n.createNotificationChannel(new NotificationChannel("solaris-screen","Solaris 화면공유",NotificationManager.IMPORTANCE_LOW));Notification note=new Notification.Builder(this,"solaris-screen").setSmallIcon(android.R.drawable.ic_menu_view).setContentTitle("Solaris 화면공유 중").setContentText("화면공유 중지는 Solaris에서 선택하세요.").setOngoing(true).build();startForeground(551,note,android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);Runnable r=startCallback;startCallback=null;if(r!=null)r.run();return START_NOT_STICKY;}
 @Override public IBinder onBind(Intent i){return null;}
}
