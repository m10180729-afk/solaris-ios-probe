using Microsoft.Win32;
using System.Diagnostics;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace SolarisNativeHost;

internal static class Program
{
    internal const string Version = "0.3.2 build39";

    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Contains("--self-test", StringComparer.OrdinalIgnoreCase))
        {
            Environment.Exit(SelfTest.Run());
            return;
        }

        ApplicationConfiguration.Initialize();
        ProtocolRegistration.RegisterCurrentExecutable();
        Application.Run(new MainForm(args));
    }
}

internal sealed record GpuInfo(string Name, string DriverVersion, int Width, int Height, int RefreshRate)
{
    internal bool IsHardwareEncoderCandidate =>
        Name.Contains("NVIDIA", StringComparison.OrdinalIgnoreCase) ||
        Name.Contains("GeForce", StringComparison.OrdinalIgnoreCase) ||
        Name.Contains("Radeon", StringComparison.OrdinalIgnoreCase) ||
        Name.Contains("Intel", StringComparison.OrdinalIgnoreCase);
}

internal sealed record HostSnapshot(
    IReadOnlyList<GpuInfo> Gpus,
    bool EngineBundled,
    bool EngineRunning,
    bool WebUiReachable,
    string EnginePath,
    string Recommendation,
    string Warning);

internal static class NativeDiagnostics
{
    internal static async Task<HostSnapshot> InspectAsync()
    {
        var gpus = await ReadGpusAsync();
        var apolloPath = FindBundledEngine();
        var installed = apolloPath.Length > 0;
        var running = Process.GetProcessesByName("apollo").Length > 0 ||
                      Process.GetProcessesByName("sunshine").Length > 0;
        var webUi = await PortOpenAsync("127.0.0.1", 47990);
        var best = gpus.OrderByDescending(g => g.RefreshRate).FirstOrDefault();
        var candidate = gpus.Any(g => g.IsHardwareEncoderCandidate);
        var highRefresh = best?.RefreshRate >= 100;
        var recommendation = candidate && highRefresh
            ? "1080p120 네이티브 권장"
            : candidate ? "1080p60 네이티브 권장 · 120Hz 디스플레이 확인"
            : "1080p60 호환 모드 권장 · 지원 GPU를 확인하세요";
        var warning = !installed ? "내장 네이티브 엔진이 없습니다. Actions의 portable 아티팩트를 다시 받으세요."
            : !running ? "내장 네이티브 엔진이 대기 중입니다."
            : !webUi ? "네이티브 엔진이 시작 중입니다. 잠시 뒤 새로고침하세요."
            : "Solaris 네이티브 호스트 준비됨 · iPad 수신기에서 페어링하세요.";
        return new(gpus, installed, running, webUi, apolloPath, recommendation, warning);
    }

    private static async Task<IReadOnlyList<GpuInfo>> ReadGpusAsync()
    {
        const string command = "$ErrorActionPreference='Stop'; Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,CurrentHorizontalResolution,CurrentVerticalResolution,CurrentRefreshRate | ConvertTo-Json -Compress";
        var result = await ProcessRunner.CaptureAsync("powershell.exe", $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"{command}\"");
        if (result.ExitCode != 0 || string.IsNullOrWhiteSpace(result.Output)) return Array.Empty<GpuInfo>();
        try
        {
            using var document = JsonDocument.Parse(result.Output.Trim());
            var roots = document.RootElement.ValueKind == JsonValueKind.Array
                ? document.RootElement.EnumerateArray().ToArray()
                : new[] { document.RootElement };
            return roots.Select(ReadGpu).Where(g => g.Name.Length > 0).ToArray();
        }
        catch { return Array.Empty<GpuInfo>(); }
    }

    private static GpuInfo ReadGpu(JsonElement element)
    {
        static string Text(JsonElement e, string name) => e.TryGetProperty(name, out var v) ? v.ToString() : "";
        static int Number(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.TryGetInt32(out var n) ? n : 0;
        return new(Text(element, "Name"), Text(element, "DriverVersion"), Number(element, "CurrentHorizontalResolution"), Number(element, "CurrentVerticalResolution"), Number(element, "CurrentRefreshRate"));
    }

    internal static string FindBundledEngine()
    {
        var engine = Path.Combine(AppContext.BaseDirectory, "engine");
        var candidates = new[]
        {
            Path.Combine(engine, "sunshine.exe"),
            Path.Combine(engine, "apollo.exe")
        };
        var direct = candidates.FirstOrDefault(File.Exists);
        if (direct is not null) return direct;
        if (!Directory.Exists(engine)) return "";
        return Directory.EnumerateFiles(engine, "*.exe", SearchOption.AllDirectories)
            .FirstOrDefault(path => Path.GetFileName(path).Equals("sunshine.exe", StringComparison.OrdinalIgnoreCase) ||
                                    Path.GetFileName(path).Equals("apollo.exe", StringComparison.OrdinalIgnoreCase)) ?? "";
    }

    private static async Task<bool> PortOpenAsync(string host, int port)
    {
        using var client = new TcpClient();
        try { await client.ConnectAsync(host, port).WaitAsync(TimeSpan.FromMilliseconds(500)); return true; }
        catch { return false; }
    }
}

internal static class ApolloController
{
    internal static void Start()
    {
        var executable = NativeDiagnostics.FindBundledEngine();
        if (executable.Length == 0) throw new InvalidOperationException("Solaris 내장 엔진을 찾지 못했습니다. portable 아티팩트 전체를 압축 해제했는지 확인하세요.");
        var startInfo = new ProcessStartInfo(executable)
        {
            UseShellExecute = true,
            Verb = "runas",
            WorkingDirectory = Path.GetDirectoryName(executable) ?? AppContext.BaseDirectory
        };
        Process.Start(startInfo);
    }

    internal static void Stop()
    {
        foreach (var name in new[] { "apollo", "sunshine" })
            foreach (var process in Process.GetProcessesByName(name))
                try { if (!process.CloseMainWindow()) process.Kill(false); } catch { }
    }
    internal static void OpenSettings() => Process.Start(new ProcessStartInfo("https://localhost:47990") { UseShellExecute = true });

    internal static void AllowFirewall()
    {
        var executable = NativeDiagnostics.FindBundledEngine();
        if (executable.Length == 0) throw new InvalidOperationException("Solaris 내장 엔진을 찾지 못했습니다.");
        var escaped = executable.Replace("\"", "\\\"");
        ProcessRunner.StartVisibleElevated("netsh.exe", $"advfirewall firewall add rule name=\"Solaris Native Host\" dir=in action=allow program=\"{escaped}\" enable=yes profile=private");
    }
}

internal static class ProtocolRegistration
{
    internal static void RegisterCurrentExecutable()
    {
        if (Environment.ProcessPath is not { Length: > 0 } executable) return;
        using var key = Registry.CurrentUser.CreateSubKey(@"Software\Classes\solaris-native");
        key.SetValue("", "URL:Solaris Native Host");
        key.SetValue("URL Protocol", "");
        using var command = key.CreateSubKey(@"shell\open\command");
        command.SetValue("", $"\"{executable}\" \"%1\"");
    }
}

internal static class ProcessRunner
{
    internal sealed record Result(int ExitCode, string Output, string Error);

    internal static Result Capture(string file, string args) => CaptureAsync(file, args).GetAwaiter().GetResult();

    internal static async Task<Result> CaptureAsync(string file, string args)
    {
        try
        {
            using var process = new Process { StartInfo = new(file, args) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true } };
            process.Start();
            var output = process.StandardOutput.ReadToEndAsync();
            var error = process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(12));
            return new(process.ExitCode, await output, await error);
        }
        catch (Exception e) { return new(-1, "", e.Message); }
    }

    internal static bool StartVisibleElevated(string file, string args)
    {
        try { Process.Start(new ProcessStartInfo(file, args) { UseShellExecute = true, Verb = "runas" }); return true; }
        catch (System.ComponentModel.Win32Exception e) when (e.NativeErrorCode == 1223) { return false; }
    }
}

internal static class SelfTest
{
    internal static int Run()
    {
        var failures = new List<string>();
        if (!Program.Version.Contains("build39")) failures.Add("version");
        if (NativeDiagnostics.FindBundledEngine().Length == 0 && Directory.Exists(Path.Combine(AppContext.BaseDirectory, "engine")))
            failures.Add("bundled-engine-layout");
        var nvidia = new GpuInfo("NVIDIA GeForce RTX 3060", "test", 1920, 1080, 120);
        if (!nvidia.IsHardwareEncoderCandidate) failures.Add("nvidia-detection");
        var unknown = new GpuInfo("Microsoft Basic Display Adapter", "test", 1920, 1080, 60);
        if (unknown.IsHardwareEncoderCandidate) failures.Add("fallback-detection");
        Console.WriteLine(failures.Count == 0 ? "PASS: SolarisNativeHost self-test" : "FAIL: " + string.Join(',', failures));
        return failures.Count == 0 ? 0 : 1;
    }
}
