using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace SolarisNativeHost;

internal sealed class MainForm : Form
{
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
        Text = $"Solaris Windows 화면공유 · {Program.Version}";
        MinimumSize = new Size(960, 720);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(16, 20, 27);
        ForeColor = Color.White;
        Controls.Add(browser);
        Controls.Add(status);
        Shown += async (_, _) => await InitializeAsync();
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
}
