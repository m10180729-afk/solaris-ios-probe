using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;

namespace SolarisNativeHost;

// Loopback returns work for both installed and portable Windows builds.
internal sealed class AuthBrowser(Action<object> emit) : IDisposable
{
    private TcpListener? listener;
    private CancellationTokenSource? cancellation;
    private string? pending;
    private string? state;
    // URL fragments never reach the loopback HTTP server. This static page
    // converts only an allowlisted failure into a query return; it never sends tokens.
    internal static readonly string FragmentRelayScript = """
    const query=new URLSearchParams(location.search),fragment=new URLSearchParams(location.hash.slice(1));
    const allowed=new Set(['identity_already_exists','access_denied','user_cancelled','unsupported_implicit_response','callback_code_missing','oauth_callback_error']);
    let code='callback_code_missing';
    if(fragment.has('access_token')||fragment.has('refresh_token')||fragment.has('id_token'))code='unsupported_implicit_response';
    else if(fragment.has('error')){const values=fragment.getAll('error_code');code=values.length===1&&allowed.has(values[0])?values[0]:'oauth_callback_error';}
    const result=new URLSearchParams({solaris_state:query.get('solaris_state')??'',error:'oauth_callback_error',error_code:code});
    const target=location.pathname+'?'+result.toString();
    history.replaceState(null,'',target);location.replace(target);
    """.Replace("\r\n", "\n", StringComparison.Ordinal);
    private static string SafeErrorCode(string? value) => value is "identity_already_exists" or "access_denied" or "user_cancelled" or "unsupported_implicit_response" or "callback_code_missing" ? value : "oauth_callback_error";
    internal static bool Allowed(string value) => Uri.TryCreate(value, UriKind.Absolute, out var u) &&
        u.Scheme == "https" && u.UserInfo.Length == 0 && u.IsDefaultPort &&
        (u.Host == "lfwjkaipghctigswxoxq.supabase.co" && u.AbsolutePath == "/auth/v1/authorize" ||
         u.Host == "accounts.google.com" && u.AbsolutePath.StartsWith("/o/oauth2/", StringComparison.Ordinal));
    internal void Listen(string redirect)
    {
        if (!Uri.TryCreate(redirect, UriKind.Absolute, out var u) || u.Scheme != "http" ||
            u.Host != "127.0.0.1" || u.Port != 43854 || u.AbsolutePath != "/auth/callback" || u.UserInfo.Length != 0 || u.Fragment.Length != 0)
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
    private static string? Query(Uri u, string key)
    {
        var values = u.Query.TrimStart('?').Split('&').Select(x => x.Split('=', 2))
            .Where(x => Uri.UnescapeDataString(x[0]) == key)
            .Select(x => x.Length == 2 ? Uri.UnescapeDataString(x[1]) : "").ToArray();
        return values.Length == 1 ? values[0] : null;
    }
    private async Task Receive(TcpListener tcp, string expected, CancellationToken token)
    {
        try
        {
            while (!token.IsCancellationRequested)
            {
                using var client = await tcp.AcceptTcpClientAsync(token);
                // A favicon request, an abandoned connection, or an unrelated
                // local request must not consume the pending login listener.
                try
                {
                    using var stream = client.GetStream();
                    using var limit = CancellationTokenSource.CreateLinkedTokenSource(token); limit.CancelAfter(TimeSpan.FromSeconds(5));
                    var request = new StringBuilder(); var bytes = new byte[1024];
                    while (request.Length < 16384 && !request.ToString().Contains("\r\n\r\n", StringComparison.Ordinal))
                    {
                        var n = await stream.ReadAsync(bytes, limit.Token); if (n == 0) break;
                        request.Append(Encoding.ASCII.GetString(bytes, 0, n));
                    }
                    var raw = request.ToString();
                    var line = raw.Split('\n')[0].Trim().Split(' ');
                    var valid = raw.Length <= 16384 && raw.Contains("\r\n\r\n", StringComparison.Ordinal) && line.Length == 3 &&
                        line[0] == "GET" && (line[2] is "HTTP/1.0" or "HTTP/1.1") &&
                        line[1].StartsWith("/", StringComparison.Ordinal) && !line[1].StartsWith("//", StringComparison.Ordinal) &&
                        Uri.TryCreate("http://127.0.0.1:43854" + line[1], UriKind.Absolute, out _);
                    var url = valid ? new Uri("http://127.0.0.1:43854" + line[1]) : null;
                    var matched = valid && url!.AbsolutePath == "/auth/callback" && url.Fragment.Length == 0 && Query(url, "solaris_state") == expected;
                    var relay = matched && !url!.Query.TrimStart('?').Split('&').Any(x => new[] { "code", "error" }.Contains(Uri.UnescapeDataString(x.Split('=', 2)[0])));
                    var tokenReturn = matched && url!.Query.TrimStart('?').Split('&').Any(x => new[] { "access_token", "refresh_token", "id_token", "token_type", "expires_in", "expires_at" }.Contains(Uri.UnescapeDataString(x.Split('=', 2)[0]), StringComparer.OrdinalIgnoreCase));
                    valid = matched && (tokenReturn || Query(url!, "code") is { Length: > 0 and <= 4096 } || Query(url!, "error") is { Length: > 0 });
                    if (valid)
                        url = tokenReturn || Query(url!, "error") is { Length: > 0 }
                            ? new Uri("http://127.0.0.1:43854/auth/callback?solaris_state=" + Uri.EscapeDataString(expected) + "&error=oauth_callback_error&error_code=" + (tokenReturn ? "unsupported_implicit_response" : SafeErrorCode(Query(url!, "error_code"))))
                            : new Uri("http://127.0.0.1:43854/auth/callback?solaris_state=" + Uri.EscapeDataString(expected) + "&code=" + Uri.EscapeDataString(Query(url!, "code")!));
                    if (valid)
                    {
                        Interlocked.Exchange(ref pending, url!.AbsoluteUri);
                        emit(new { type = "auth-callback", url = url.AbsoluteUri });
                    }
                    var html = valid
                        ? "<!doctype html><html lang=ko><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\"><title>Solaris 로그인</title><style>body{font-family:system-ui,sans-serif;background:#202225;color:#f2f3f5;padding:10vh 24px;text-align:center}h1{font-size:24px}p{line-height:1.7;color:#b5bac1}</style><h1>Solaris로 돌아가세요</h1><p>로그인 결과를 앱으로 전달했어요.<br>Solaris에서 로그인 완료 여부를 확인한 뒤 이 창을 닫아도 됩니다.</p></html>"
                        : relay ? "<!doctype html><html lang=ko><meta charset=utf-8><title>Solaris 로그인</title><p>인증 응답을 확인하고 있습니다.</p><script>" + FragmentRelayScript + "</script></html>"
                        : "Invalid authentication return. Start the login again from Solaris.";
                    var body = Encoding.UTF8.GetBytes(html);
                    var scriptPolicy = relay ? "; script-src 'sha256-" + Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(FragmentRelayScript))) + "'" : "";
                    var header = Encoding.ASCII.GetBytes($"HTTP/1.1 {(valid ? "200 OK" : "400 Bad Request")}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {body.Length}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'{scriptPolicy}\r\nConnection: close\r\n\r\n");
                    try { await stream.WriteAsync(header, limit.Token); await stream.WriteAsync(body, limit.Token); }
                    catch (IOException) when (valid) { }
                    catch (OperationCanceledException) when (valid) { }
                    if (valid) break;
                }
                catch (OperationCanceledException) when (!token.IsCancellationRequested) { }
                catch (IOException) when (!token.IsCancellationRequested) { }
                catch (SocketException) when (!token.IsCancellationRequested) { }
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception) { if (!token.IsCancellationRequested) emit(new { type = "auth-cancelled" }); }
        finally { tcp.Stop(); if (ReferenceEquals(listener, tcp)) { listener = null; state = null; } }
    }
    internal void Open(string url) { if (!Allowed(url)) throw new IOException("Invalid authentication URL"); Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
    internal string? Take() => Volatile.Read(ref pending);
    internal bool Ack(string value)
    {
        var current = Volatile.Read(ref pending);
        return current is not null && string.Equals(current, value, StringComparison.Ordinal) && ReferenceEquals(Interlocked.CompareExchange(ref pending, null, current), current);
    }
    internal void Cancel() { cancellation?.Cancel(); cancellation?.Dispose(); cancellation = null; listener?.Stop(); listener = null; state = null; Interlocked.Exchange(ref pending, null); }
    public void Dispose() => Cancel();
}
