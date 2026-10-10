package org.solaris.receiver;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.LinearLayout;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;

public final class MainActivity extends Activity {
    private WebView web;
    private String mode = "windows";
    private static final String ORIGIN = "https://appassets.androidplatform.net/assets/";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xff10141b);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
        LinearLayout choices = new LinearLayout(this);
        Button windows = new Button(this); windows.setText("Windows 화면 받기");
        Button ipad = new Button(this); ipad.setText("iPad 화면 받기");
        choices.addView(windows, new LinearLayout.LayoutParams(0, -2, 1));
        choices.addView(ipad, new LinearLayout.LayoutParams(0, -2, 1));
        root.addView(choices);
        web = new WebView(this);
        web.setBackgroundColor(0xff10141b);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !request.getUrl().toString().startsWith(ORIGIN);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
        });
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        windows.setOnClickListener(v -> load("windows"));
        ipad.setOnClickListener(v -> load("ipad"));
        load(state == null ? "windows" : state.getString("mode", "windows"));
    }
    private void load(String selected) {
        if (web == null) return;
        if (!selected.equals(mode)) web.evaluateJavascript("if (typeof stop === 'function') stop()", null);
        mode = selected;
        web.loadUrl(ORIGIN + (selected.equals("ipad") ? "ipad.html" : "windows.html"));
    }
    @Override protected void onSaveInstanceState(Bundle out) {
        out.putString("mode", mode); super.onSaveInstanceState(out);
    }
    @Override protected void onDestroy() {
        if (web != null) { web.evaluateJavascript("if (typeof stop === 'function') stop()", null); web.destroy(); web = null; }
        super.onDestroy();
    }
}
