using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Diagnostics;
using System.Text.Json;

namespace SolarisNativeHost;

internal sealed class MainForm : Form
{
    private readonly NativeH264Capture capture;
    private long captureRequest;
    private int pendingFramePosts;
    private int awaitingKeyFrame = 1;
    private long hostQueueDrops;
    private readonly WebView2 browser = new() { Dock = DockStyle.Fill };
    private readonly Label status = new()
    {
        Dock = DockStyle.Top,
        Height = 34,
        TextAlign = ContentAlignment.MiddleLeft,
        Padding = new Padding(12, 0, 0, 0),
        Text = "Solaris 화면공유를 준비하는 중…"
    };

    internal MainForm()
    {
        capture = new NativeH264Capture(PostNativeFrame, (state, message, detail) =>
        {
            if (state == "metrics")
                message += $" · hostDrops {Interlocked.Read(ref hostQueueDrops)} · hostQueue {Volatile.Read(ref pendingFramePosts)}";
            PostNativeStatus(state, message, detail);
        });
        Text = $"Solaris Windows 화면공유 · {Program.Version}";
        MinimumSize = new Size(960, 720);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(16, 20, 27);
        ForeColor = Color.White;
        Controls.Add(browser);
        Controls.Add(status);
        Shown += async (_, _) => await InitializeAsync();
        FormClosed += (_, _) => capture.Dispose();
    }

    private async Task InitializeAsync()
    {
        try
        {
            var webRoot = SolarisContent.PrepareWebRoot();
            var userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Solaris", "WebView2");
            var options = new CoreWebView2EnvironmentOptions(
                "--autoplay-policy=no-user-gesture-required --enable-features=WebRtcAllowH264HighProfile");
            var environment = await CoreWebView2Environment.CreateAsync(null, userData, options);
            await browser.EnsureCoreWebView2Async(environment);
            browser.CoreWebView2.Settings.AreDevToolsEnabled = true;
            browser.CoreWebView2.Settings.IsStatusBarEnabled = false;
            browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            browser.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            browser.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "solaris.local", webRoot, CoreWebView2HostResourceAccessKind.DenyCors);
            browser.CoreWebView2.ProcessFailed += (_, eventArgs) =>
                status.Text = $"Windows 웹 엔진 오류: {eventArgs.ProcessFailedKind} · Solaris를 다시 실행하세요.";
            browser.CoreWebView2.NavigationCompleted += (_, eventArgs) =>
                status.Text = eventArgs.IsSuccess
                    ? "Solaris 준비 완료 · 모드를 선택하고 ‘Windows 화면 보내기’를 누르세요."
                    : $"Solaris 페이지 열기 실패: {eventArgs.WebErrorStatus}";
            browser.CoreWebView2.Navigate("https://solaris.local/solaris-desktop.html");
        }
        catch (Exception error)
        {
            status.Text = "Solaris 시작 실패";
            MessageBox.Show(this,
                "Windows의 Microsoft Edge WebView2 시스템 구성 요소를 확인한 뒤 다시 실행하세요.\n\n" + error.Message,
                "Solaris", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs eventArgs)
    {
        try
        {
            using var message = JsonDocument.Parse(eventArgs.WebMessageAsJson);
            var root = message.RootElement;
            var type = root.TryGetProperty("type", out var typeValue) ? typeValue.GetString() : null;
            if (type == "native-stop")
            {
                Interlocked.Increment(ref captureRequest);
                Interlocked.Exchange(ref awaitingKeyFrame, 1);
                capture.Stop();
                PostNativeStatus("stopped", "네이티브 송신 중지", null);
                return;
            }
            if (type != "native-start") return;
            var request = Interlocked.Increment(ref captureRequest);
            Interlocked.Exchange(ref awaitingKeyFrame, 1);
            var fps = root.TryGetProperty("fps", out var fpsValue) ? fpsValue.GetInt32() : 60;
            var startMbps = root.TryGetProperty("startMbps", out var startValue) ? startValue.GetInt32() : 25;
            var maxMbps = root.TryGetProperty("maxMbps", out var maxValue) ? maxValue.GetInt32() : 60;
            try
            {
                await capture.StartAsync(new NativeCaptureOptions(fps, startMbps, maxMbps));
            }
            catch (Exception error) when (request != Interlocked.Read(ref captureRequest))
            {
                // A newer start/stop superseded this encoder probe.
            }
            catch (Exception error)
            {
                capture.Stop();
                PostNativeStatus("error", "네이티브 H.264 송신 시작 실패", error.Message);
            }
        }
        catch (Exception error)
        {
            PostNativeStatus("error", "네이티브 H.264 송신 시작 실패", error.Message);
        }
    }

    private void PostNativeFrame(byte[] frame, bool keyFrame, long timestampUs, string encoder)
    {
        if (IsDisposed || browser.CoreWebView2 is null) return;
        if (FramePostPolicy.DropBeforeQueue(Volatile.Read(ref awaitingKeyFrame) != 0, keyFrame, 0))
        {
            Interlocked.Increment(ref hostQueueDrops);
            return;
        }
        if (FramePostPolicy.DropBeforeQueue(false, keyFrame, Interlocked.Increment(ref pendingFramePosts)))
        {
            Interlocked.Decrement(ref pendingFramePosts);
            Interlocked.Exchange(ref awaitingKeyFrame, 1);
            Interlocked.Increment(ref hostQueueDrops);
            return;
        }
        var request = Interlocked.Read(ref captureRequest);
        void Post()
        {
            try
            {
                var ageUs = Stopwatch.GetTimestamp() * 1_000_000L / Stopwatch.Frequency - timestampUs;
                if (FramePostPolicy.DropAtUi(request == Interlocked.Read(ref captureRequest), ageUs,
                    Volatile.Read(ref awaitingKeyFrame) != 0, keyFrame))
                {
                    Interlocked.Exchange(ref awaitingKeyFrame, 1);
                    Interlocked.Increment(ref hostQueueDrops);
                    return;
                }
                if (keyFrame) Interlocked.Exchange(ref awaitingKeyFrame, 0);
                using var shared = browser.CoreWebView2.Environment.CreateSharedBuffer((ulong)frame.LongLength);
                using (var output = shared.OpenStream()) output.Write(frame);
                var metadata = JsonSerializer.Serialize(new
                {
                    type = "native-h264-frame",
                    keyFrame,
                    timestampUs,
                    encoder,
                    width = 1920,
                    height = 1080
                });
                browser.CoreWebView2.PostSharedBufferToScript(
                    shared,
                    CoreWebView2SharedBufferAccess.ReadOnly,
                    metadata);
            }
            catch (Exception error)
            {
                PostNativeStatus("error", "네이티브 프레임 전달 실패", error.Message);
            }
            finally
            {
                Interlocked.Decrement(ref pendingFramePosts);
            }
        }
        try { if (InvokeRequired) BeginInvoke(Post); else Post(); }
        catch (InvalidOperationException) { Interlocked.Decrement(ref pendingFramePosts); }
    }

    private void PostNativeStatus(string state, string message, string? detail)
    {
        if (IsDisposed || browser.CoreWebView2 is null) return;
        void Post()
        {
            var json = JsonSerializer.Serialize(new { type = "native-status", state, message, detail });
            browser.CoreWebView2.PostWebMessageAsJson(json);
            status.Text = detail is null ? message : $"{message} · {detail}";
        }
        if (InvokeRequired) BeginInvoke(Post); else Post();
    }
}
