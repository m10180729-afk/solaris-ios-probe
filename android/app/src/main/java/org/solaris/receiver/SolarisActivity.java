package org.solaris.receiver;
import android.app.*;import android.content.*;import android.net.Uri;import android.os.*;import android.view.*;import android.webkit.*;import android.widget.*;import androidx.webkit.WebViewAssetLoader;import org.json.*;import java.util.concurrent.*;

public final class SolarisActivity extends Activity{
 private static final String ORIGIN="https://appassets.androidplatform.net/assets/";
 private WebView web;private FrameLayout webContainer;private final AuthCallbacks authCallbacks=new AuthCallbacks();private int rendererRestarts;private NativeDiagnostics nativeDiagnostics;private boolean destroyed;private DiskBridge disk;private final ExecutorService io=Executors.newSingleThreadExecutor();
 private String pickerRequest,pickerCommand;private JSONObject pickerArgs;private View custom;private WebChromeClient.CustomViewCallback customCallback;private ValueCallback<Uri[]> photoCallback;
 @Override public void onCreate(Bundle saved){super.onCreate(saved);getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);disk=new DiskBridge(this);nativeDiagnostics=new NativeDiagnostics(this);stopLegacyProjection();createWeb();captureAuth(getIntent());if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},10);}
 private void captureAuth(Intent intent){String value=authCallbacks.capture(intent==null?null:intent.getDataString());if(intent!=null)intent.setData(value==null?null:Uri.parse(value));if(value==null)return;try{emit(new JSONObject().put("type","auth-callback").put("url",value));}catch(JSONException ignored){}}
 private void clearAuthIntent(String acknowledged){Intent intent=getIntent();if(intent!=null&&(acknowledged==null||acknowledged.equals(intent.getDataString())))intent.setData(null);}
 @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);captureAuth(intent);}
 private void createWeb(){web=new WebView(this);web.setBackgroundColor(0xff0d1016);WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setMediaPlaybackRequiresUserGesture(false);s.setAllowFileAccess(false);s.setAllowContentAccess(false);WebViewAssetLoader loader=new WebViewAssetLoader.Builder().addPathHandler("/assets/",new WebViewAssetLoader.AssetsPathHandler(this)).build();
  web.setWebViewClient(new WebViewClient(){@Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){return loader.shouldInterceptRequest(r.getUrl());}@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return !r.getUrl().toString().startsWith(ORIGIN);}
 @Override public boolean onRenderProcessGone(WebView failed,RenderProcessGoneDetail detail){
  nativeDiagnostics.record("webview-renderer",new Exception(detail.didCrash()?"Renderer crashed":"Renderer removed by Android"));
  if(failed!=web){failed.destroy();return true;}
  exitVideoFullscreen();web=null;if(failed.getParent() instanceof android.view.ViewGroup parent)parent.removeView(failed);failed.destroy();
  if(++rendererRestarts<=2&&!destroyed){createWeb();}else{stopLegacyProjection();LinearLayout panel=new LinearLayout(SolarisActivity.this);panel.setOrientation(LinearLayout.VERTICAL);TextView text=new TextView(SolarisActivity.this);text.setText("영상 화면을 복구하지 못했습니다. Android System WebView를 업데이트한 뒤 다시 시도하세요.");Button retry=new Button(SolarisActivity.this);retry.setText("Solaris 다시 열기");retry.setOnClickListener(v->{rendererRestarts=0;createWeb();});panel.addView(text);panel.addView(retry);setContentView(panel);}return true;
 }});
  web.setWebChromeClient(new WebChromeClient(){@Override public void onPermissionRequest(PermissionRequest r){r.deny();}@Override public void onShowCustomView(View v,CustomViewCallback cb){if(custom!=null){cb.onCustomViewHidden();return;}custom=v;customCallback=cb;setContentView(v);fullscreen(true);}@Override public void onHideCustomView(){exitVideoFullscreen();}@Override public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> cb,FileChooserParams p){if(photoCallback!=null)photoCallback.onReceiveValue(null);photoCallback=cb;startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE),45);return true;}});
  web.addJavascriptInterface(new JavascriptAPI(),"SolarisNative");
  getWindow().setDecorFitsSystemWindows(false);getWindow().setNavigationBarContrastEnforced(false);
  getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
  webContainer=new FrameLayout(this);webContainer.setBackgroundColor(0xff17171c);
  webContainer.addView(web,new FrameLayout.LayoutParams(-1,-1));setContentView(webContainer);applyInsets(webContainer);web.loadUrl(ORIGIN+"index.html");
 }
 private void applyInsets(View view){view.setOnApplyWindowInsetsListener((v,insets)->{
  int types=WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()|WindowInsets.Type.ime();
  android.graphics.Insets safe=insets.getInsets(types);
  // Resize the actual WebView bounds: WebView padding does not constrain CSS fixed bars.
  v.setPadding(safe.left,safe.top,safe.right,safe.bottom);
  return new WindowInsets.Builder(insets).setInsets(types,android.graphics.Insets.NONE).build();
 });view.requestApplyInsets();}
 public final class JavascriptAPI{@JavascriptInterface public void postMessage(String json){try{JSONObject m=new JSONObject(json);runOnUiThread(()->command(m));}catch(JSONException ignored){}}}
 private void exitVideoFullscreen(){
  // Clear the callback before invoking it: WebView may reenter onHideCustomView.
  WebChromeClient.CustomViewCallback callback=customCallback;boolean hadView=custom!=null;custom=null;customCallback=null;
  if(hadView&&web!=null&&!destroyed){setContentView(webContainer);applyInsets(webContainer);}fullscreen(false);
  if(callback!=null)callback.onCustomViewHidden();
 }
 private void fullscreen(boolean enabled){WindowInsetsController controller=getWindow().getInsetsController();if(controller==null)return;if(enabled)controller.hide(WindowInsets.Type.systemBars());else controller.show(WindowInsets.Type.systemBars());}
 void emit(JSONObject value){runOnUiThread(()->{if(destroyed)return;if(web!=null)web.evaluateJavascript("window.dispatchEvent(new CustomEvent('solaris-native',{detail:"+value+"}))",null);});}
 private void reply(String id,Object value,Exception e){try{JSONObject r=new JSONObject().put("requestId",id);if(e!=null)r.put("error",e.getMessage());else r.put("result",value==null?JSONObject.NULL:value);emit(r);}catch(JSONException ignored){}}
 private void command(JSONObject m){String id=m.optString("requestId"),cmd=m.optString("command");JSONObject a=m.optJSONObject("args");final JSONObject args=a==null?new JSONObject():a;try{if(!m.optString("type").equals("solaris-command")||web==null||!ORIGIN.concat("index.html").equals(web.getUrl()))return;
  if(cmd.equals("platform")){reply(id,ReceiveOnlyMedia.platform(BuildConfig.VERSION_NAME),null);return;}
  if(cmd.equals("diagnostics")){JSONObject d=(JSONObject)disk.command("diagnostics",new JSONObject());d.put("screen",ReceiveOnlyMedia.status()).put("nativeErrors",nativeDiagnostics.read()).put("rendererRestarts",rendererRestarts);reply(id,d,null);return;}
  if(cmd.equals("mediaStatus")){reply(id,ReceiveOnlyMedia.status(),null);return;}
  if(cmd.equals("authListen")){reply(id,true,null);return;}
  if(cmd.equals("copyText")){String text=args.getString("text");if(text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>65536)throw new Exception("복사할 내용을 확인하세요.");getSystemService(ClipboardManager.class).setPrimaryClip(ClipData.newPlainText("Solaris",text));reply(id,true,null);return;}
  if(cmd.equals("authTake")){reply(id,authCallbacks.peek(),null);return;}
  if(cmd.equals("authAck")){String url=args.optString("url");boolean acknowledged=authCallbacks.acknowledge(url);if(acknowledged)clearAuthIntent(url);reply(id,acknowledged,null);return;}
  if(cmd.equals("authCancel")){authCallbacks.cancel();clearAuthIntent(null);reply(id,true,null);return;}
  if(cmd.equals("authOpen")){String url=args.getString("url");if(!AuthUrls.allowed(url))throw new Exception("Invalid authentication URL");startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE));reply(id,true,null);return;}
  if(cmd.startsWith("media")){if(cmd.equals("mediaStart")||cmd.equals("mediaStop"))stopLegacyProjection();if(cmd.equals("mediaStop"))exitVideoFullscreen();reply(id,ReceiveOnlyMedia.command(cmd),null);return;}
  if(cmd.equals("fullscreen")){if(args.optBoolean("enabled"))fullscreen(true);else exitVideoFullscreen();reply(id,true,null);return;}
  if(cmd.equals("pickFile")||cmd.equals("createReceiver")){if(pickerRequest!=null)throw new Exception("파일 선택이 진행 중입니다.");pickerRequest=id;pickerCommand=cmd;pickerArgs=args;Intent in=new Intent(cmd.equals("pickFile")?Intent.ACTION_OPEN_DOCUMENT:Intent.ACTION_CREATE_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);if(cmd.equals("createReceiver"))in.putExtra(Intent.EXTRA_TITLE,DiskBridge.safeName(args.getString("name")));startActivityForResult(in,43);return;}
  if(cmd.equals("openExternal")){String url=args.getString("url");if(!url.startsWith("https://github.com/m10180729-afk/solaris-ios-probe/releases/"))throw new Exception("Invalid update URL");startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)));reply(id,true,null);return;}
  if(cmd.equals("notify")){NotificationManager manager=getSystemService(NotificationManager.class);manager.createNotificationChannel(new NotificationChannel("solaris-transfers","Solaris 파일 전송",NotificationManager.IMPORTANCE_DEFAULT));if(Build.VERSION.SDK_INT<33||checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)==android.content.pm.PackageManager.PERMISSION_GRANTED){PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,SolarisActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);manager.notify((args.optString("title")+args.optString("body")).hashCode(),new Notification.Builder(this,"solaris-transfers").setSmallIcon(android.R.drawable.ic_menu_share).setContentTitle(args.optString("title")).setContentText(args.optString("body")).setContentIntent(open).setAutoCancel(true).build());}reply(id,true,null);return;}if(cmd.equals("exportLog")){startActivity(Intent.createChooser(new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,args.getString("text")),"진단 내보내기"));reply(id,true,null);return;}if(cmd.equals("exportFile")){disk.exportFile(args.getString("id"));reply(id,true,null);return;}
  io.execute(()->{try{reply(id,disk.command(cmd,args),null);}catch(Exception e){reply(id,null,e);}});
 }catch(Exception e){reply(id,null,e);}}
 // Stop the old component by name without loading or shipping its sender code.
 // Updating an APK ends its process, but this also clears any legacy notification.
 private void stopLegacyProjection(){
  try{stopService(new Intent().setClassName(getPackageName(),getPackageName()+".ProjectionService"));}catch(SecurityException error){nativeDiagnostics.record("legacy-projection-stop",error);}
  NotificationManager manager=getSystemService(NotificationManager.class);if(manager!=null)manager.cancel(551);
 }
 @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);
 if(request==43){String id=pickerRequest,cmd=pickerCommand;JSONObject a=pickerArgs;pickerRequest=null;if(result!=RESULT_OK||data==null){reply(id,null,cmd.equals("pickFile")?null:new Exception("수신 취소"));return;}Uri uri=data.getData();try{getContentResolver().takePersistableUriPermission(uri,data.getFlags()&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION));}catch(SecurityException ignored){}io.execute(()->{try{reply(id,cmd.equals("pickFile")?disk.source(uri):disk.receiver(uri,a),null);}catch(Exception e){reply(id,null,e);}});}
 if(request==45&&photoCallback!=null){photoCallback.onReceiveValue(result==RESULT_OK&&data!=null?new Uri[]{data.getData()}:null);photoCallback=null;}}
 @Override public void onBackPressed(){if(custom!=null){exitVideoFullscreen();return;}if(web!=null){web.evaluateJavascript("(()=>{const d=document.querySelector('dialog[open]');if(d){d.close();return true;}if(document.fullscreenElement){document.exitFullscreen();return true;}const f=document.querySelector('#viewing.native-fullscreen');if(f){f.querySelector('[data-action=fullscreen]')?.click();return true;}const people=document.querySelector('#workspace.people-open');if(people){document.querySelector('[data-action=toggle-people]')?.click();return true;}const w=document.querySelector('#workspace.nav-open');if(w){document.querySelector('[data-action=close-nav]')?.click();return true;}return false;})()",value->{if(!"true".equals(value))moveTaskToBack(true);});return;}super.onBackPressed();}
 private void lifecycle(String state){try{emit(new JSONObject().put("type","lifecycle").put("state",state));}catch(JSONException ignored){}}
 @Override protected void onStart(){super.onStart();lifecycle("foreground");}
 @Override protected void onStop(){lifecycle("background");super.onStop();}
 @Override protected void onDestroy(){exitVideoFullscreen();destroyed=true;stopLegacyProjection();io.shutdown();if(web!=null){web.destroy();web=null;}super.onDestroy();}
}
