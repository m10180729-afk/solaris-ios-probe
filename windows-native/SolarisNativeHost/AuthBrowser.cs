using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;

namespace SolarisNativeHost;

// Loopback returns work for both installed and portable Windows builds.
internal sealed class AuthBrowser(Action<object> emit) : IDisposable
{
    private TcpListener? listener;
    private CancellationTokenSource? cancellation;
    private string? pending;
    private string? state;
    internal static bool Allowed(string value) => Uri.TryCreate(value, UriKind.Absolute, out var u) &&
        u.Scheme == "https" && u.UserInfo.Length == 0 && u.IsDefaultPort &&
        (u.Host == "lfwjkaipghctigswxoxq.supabase.co" && u.AbsolutePath == "/auth/v1/authorize" ||
         u.Host == "accounts.google.com" && u.AbsolutePath.StartsWith("/o/oauth2/", StringComparison.Ordinal));
    internal void Listen(string redirect)
    {
        if (!Uri.TryCreate(redirect, UriKind.Absolute, out var u) || u.Scheme != "http" ||
            u.Host != "127.0.0.1" || u.Port != 43854 || u.AbsolutePath != "/auth/callback" || u.UserInfo.Length != 0)
            throw new IOException("Invalid authentication return URL");
        var next = Query(u, "solaris_state");
        if (!Guid.TryParse(next, out _)) throw new IOException("Invalid authentication state");
        if (state == next && listener is not null) return;
        Cancel();
        var tcp = new TcpListener(IPAddress.Loopback, 43854);
        try { tcp.Start(8); } catch (SocketException) { throw new IOException("로그인 반환 포트를 열지 못했습니다. 다른 Solaris 창을 닫고 다시 시도하세요."); }
        listener = tcp; state = next;
        var cancel = new CancellationTokenSource(TimeSpan.FromHours(1)); cancellation = cancel;
        _ = Receive(tcp, next, cancel.Token);
    }
    private static string? Query(Uri u, string key) => u.Query.TrimStart('?').Split('&')
        .Select(x => x.Split('=', 2)).Where(x => Uri.UnescapeDataString(x[0]) == key)
        .Select(x => x.Length == 2 ? Uri.UnescapeDataString(x[1]) : "").FirstOrDefault();
    private async Task Receive(TcpListener tcp, string expected, CancellationToken token)
    {
        try
        {
            while (!token.IsCancellationRequested)
            {
                using var client = await tcp.AcceptTcpClientAsync(token);
                using var stream = client.GetStream();
                using var limit = CancellationTokenSource.CreateLinkedTokenSource(token); limit.CancelAfter(TimeSpan.FromSeconds(5));
                var request = new StringBuilder(); var bytes = new byte[1024];
                while (request.Length < 16384 && !request.ToString().Contains("\r\n\r\n", StringComparison.Ordinal))
                {
                    var n = await stream.ReadAsync(bytes, limit.Token); if (n == 0) break;
                    request.Append(Encoding.ASCII.GetString(bytes, 0, n));
                }
                var line = request.ToString().Split('\n')[0].Trim().Split(' ');
                var valid = line.Length == 3 && line[0] == "GET" && line[1].StartsWith("/", StringComparison.Ordinal) &&
                    !line[1].StartsWith("//", StringComparison.Ordinal) && Uri.TryCreate("http://127.0.0.1:43854" + line[1], UriKind.Absolute, out _);
                var url = valid ? new Uri("http://127.0.0.1:43854" + line[1]) : null;
                valid = valid && url!.AbsolutePath == "/auth/callback" && url.Fragment.Length == 0 && Query(url, "solaris_state") == expected;
                var html = valid ? "<!doctype html><meta charset=utf-8><title>Solaris</title><p>Solaris로 돌아가 로그인 결과를 확인하세요. 이 창은 닫아도 됩니다.</p>" : "Invalid authentication return";
                var body = Encoding.UTF8.GetBytes(html);
                var header = Encoding.ASCII.GetBytes($"HTTP/1.1 {(valid ? "200 OK" : "400 Bad Request")}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {body.Length}\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'\r\nConnection: close\r\n\r\n");
                await stream.WriteAsync(header, limit.Token); await stream.WriteAsync(body, limit.Token);
                if (!valid) continue;
                Interlocked.Exchange(ref pending, url!.AbsoluteUri);
                emit(new { type = "auth-callback", url = url.AbsoluteUri }); break;
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception) { if (!token.IsCancellationRequested) emit(new { type = "auth-cancelled" }); }
        finally { tcp.Stop(); if (ReferenceEquals(listener, tcp)) { listener = null; state = null; } }
    }
    internal void Open(string url) { if (!Allowed(url)) throw new IOException("Invalid authentication URL"); Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
    internal string? Take() => Interlocked.Exchange(ref pending, null);
    internal void Cancel() { cancellation?.Cancel(); cancellation?.Dispose(); cancellation = null; listener?.Stop(); listener = null; state = null; Interlocked.Exchange(ref pending, null); }
    public void Dispose() => Cancel();
}
