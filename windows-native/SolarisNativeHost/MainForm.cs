using System.Diagnostics;
using System.Drawing;
using System.Text;

namespace SolarisNativeHost;

internal sealed class MainForm : Form
{
    private readonly Label status = new() { AutoSize = true, MaximumSize = new Size(780, 0), Font = new Font("Segoe UI", 10) };
    private readonly TextBox details = new() { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill, Font = new Font("Consolas", 10), BackColor = Color.FromArgb(16, 24, 36), ForeColor = Color.White };
    private readonly Button refresh = MakeButton("진단 새로고침");
    private readonly Button firewall = MakeButton("최초 방화벽 허용");
    private readonly Button start = MakeButton("네이티브 호스트 시작");
    private readonly Button stop = MakeButton("호스트 중지");
    private readonly Button settings = MakeButton("Apollo 설정 열기");
    private readonly Button copy = MakeButton("1080p120 시험 설정 복사");

    internal MainForm(string[] args)
    {
        Text = $"Solaris Native Host · {Program.Version}";
        MinimumSize = new Size(820, 620);
        BackColor = Color.FromArgb(16, 20, 27);
        ForeColor = Color.White;
        StartPosition = FormStartPosition.CenterScreen;

        var title = new Label { Text = "Solaris 네이티브 화면공유", AutoSize = true, Font = new Font("Segoe UI", 22, FontStyle.Bold), ForeColor = Color.White };
        var intro = new Label { Text = "설치 없는 Solaris 단일 실행형 호스트 · GPU 하드웨어 인코딩 · 시스템 소리 · 마이크 제외", AutoSize = true, MaximumSize = new Size(780, 0), ForeColor = Color.LightGray };
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, WrapContents = true };
        buttons.Controls.AddRange(new Control[] { refresh, firewall, start, stop, settings, copy });
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(22), RowCount = 5, ColumnCount = 1 };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.Controls.Add(title, 0, 0); layout.Controls.Add(intro, 0, 1); layout.Controls.Add(status, 0, 2); layout.Controls.Add(buttons, 0, 3); layout.Controls.Add(details, 0, 4);
        Controls.Add(layout);

        refresh.Click += async (_, _) => await RefreshAsync();
        firewall.Click += (_, _) => RunAction(ApolloController.AllowFirewall, "Solaris 네이티브 호스트를 Windows 개인 네트워크 방화벽에 허용했습니다.");
        start.Click += (_, _) => RunAction(ApolloController.Start, "호스트 시작을 요청했습니다. 3초 후 상태를 다시 확인합니다.", true);
        stop.Click += (_, _) => RunAction(ApolloController.Stop, "호스트 중지를 요청했습니다.", true);
        settings.Click += (_, _) => RunAction(ApolloController.OpenSettings, "Solaris 네이티브 엔진 설정 페이지를 열었습니다.");
        copy.Click += (_, _) => CopyProfile();
        Shown += async (_, _) => { await RefreshAsync(); HandleProtocol(args); };
    }

    private static Button MakeButton(string text) => new() { Text = text, AutoSize = true, Height = 42, FlatStyle = FlatStyle.System, Margin = new Padding(4) };

    private async Task RefreshAsync()
    {
        SetBusy(true); status.Text = "PC와 Solaris 내장 네이티브 엔진을 진단하는 중…";
        var snapshot = await NativeDiagnostics.InspectAsync();
        var builder = new StringBuilder();
        builder.AppendLine($"Solaris {Program.Version}");
        builder.AppendLine($"내장 엔진 포함: {(snapshot.EngineBundled ? "예" : "아니오")}");
        builder.AppendLine($"내장 엔진 실행: {(snapshot.EngineRunning ? "예" : "아니오")}");
        builder.AppendLine($"설정 페이지: {(snapshot.WebUiReachable ? "응답" : "대기/미실행")}");
        if (snapshot.EnginePath.Length > 0) builder.AppendLine($"실행 파일: {snapshot.EnginePath}");
        builder.AppendLine(); builder.AppendLine("GPU/디스플레이");
        if (snapshot.Gpus.Count == 0) builder.AppendLine("- 진단 실패: PowerShell/CIM 정보를 읽지 못했습니다.");
        foreach (var gpu in snapshot.Gpus) builder.AppendLine($"- {gpu.Name} · {gpu.Width}×{gpu.Height} {gpu.RefreshRate}Hz · 드라이버 {gpu.DriverVersion}");
        builder.AppendLine(); builder.AppendLine("판정"); builder.AppendLine(snapshot.Recommendation); builder.AppendLine(snapshot.Warning);
        builder.AppendLine(); builder.AppendLine("중요: 실제 NVENC/Quick Sync/AMF 사용 여부는 스트리밍 중 수신 통계와 Solaris 엔진 로그로 최종 확인합니다. 내장 엔진은 Apollo GPLv3 코어를 사용하며 별도 설치하지 않습니다.");
        details.Text = builder.ToString(); status.Text = snapshot.Recommendation + " · " + snapshot.Warning; SetBusy(false);
    }

    private void SetBusy(bool busy) { refresh.Enabled = !busy; firewall.Enabled = !busy; start.Enabled = !busy; stop.Enabled = !busy; settings.Enabled = !busy; }

    private void RunAction(Action action, string message, bool refreshAfter = false)
    {
        try { action(); status.Text = message; if (refreshAfter) _ = DelayedRefreshAsync(); }
        catch (Exception e) { MessageBox.Show(this, e.Message, "Solaris", MessageBoxButtons.OK, MessageBoxIcon.Error); }
    }

    private async Task DelayedRefreshAsync() { await Task.Delay(3000); await RefreshAsync(); }

    private void CopyProfile()
    {
        const string profile = "Solaris Windows→iPad 네이티브 시험\r\n해상도: 1920×1080\r\nFPS: 120\r\n코덱: HEVC 우선, 문제 시 H.264\r\n비트레이트: 50Mbps 시작, 80Mbps 상한\r\n오디오: 시스템 소리 스테레오\r\n마이크: 끔\r\n클라이언트: Moonlight iOS\r\n판정: 수신 100fps 이상·하드웨어 인코더·프레임 드롭 1% 미만";
        Clipboard.SetText(profile); status.Text = "1080p120 시험 설정을 복사했습니다.";
    }

    private void HandleProtocol(string[] args)
    {
        if (!args.Any(a => a.StartsWith("solaris-native:", StringComparison.OrdinalIgnoreCase))) return;
        status.Text = "Solaris 웹 화면에서 네이티브 모드를 요청했습니다. 내장 엔진 시작 버튼을 누르세요.";
        Activate(); BringToFront();
    }
}
