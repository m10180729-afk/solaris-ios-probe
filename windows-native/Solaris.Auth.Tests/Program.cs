using System.Net.Sockets;
using System.Text;
using SolarisNativeHost;

static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
static void Reject(Action action)
{
    try { action(); } catch (IOException) { return; }
    throw new Exception("Expected authentication redirect to be rejected");
}
static async Task<string> Request(string request)
{
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
    using var tcp = new TcpClient(); await tcp.ConnectAsync("127.0.0.1", 43854, timeout.Token);
    using var stream = tcp.GetStream();
    await stream.WriteAsync(Encoding.ASCII.GetBytes(request + "\r\nHost: 127.0.0.1:43854\r\n\r\n"), timeout.Token);
    using var reader = new StreamReader(stream, Encoding.UTF8);
    return await reader.ReadToEndAsync(timeout.Token);
}
var results = new List<string>(); var events = new List<object>();
using var browser = new AuthBrowser(value => { lock (events) events.Add(value); });
Check(AuthBrowser.Allowed("https://accounts.google.com/o/oauth2/v2/auth"), "Google allowlist");
foreach (var bad in new[] {"https://accounts.google.com.evil.test/o/oauth2/auth", "https://user@accounts.google.com/o/oauth2/auth", "http://accounts.google.com/o/oauth2/auth", "https://accounts.google.com:444/o/oauth2/auth"})
    Check(!AuthBrowser.Allowed(bad), "Unsafe browser URL");
results.Add("browser URL allowlist");
foreach (var bad in new[] {"http://localhost:43854/auth/callback", "http://127.0.0.1:43855/auth/callback", "http://127.0.0.1:43854/other", "http://127.0.0.1:43854/auth/callback?solaris_state=wrong"}) Reject(() => browser.Listen(bad));
results.Add("redirect and nonce validation");
var state = Guid.NewGuid().ToString(); var redirect = "http://127.0.0.1:43854/auth/callback?solaris_state=" + state;
browser.Listen(redirect); browser.Listen(redirect);
using (var second = new AuthBrowser(_ => {})) Reject(() => second.Listen("http://127.0.0.1:43854/auth/callback?solaris_state=" + Guid.NewGuid()));
results.Add("same request is idempotent; another request cannot take the port");
Check((await Request("GET /auth/callback?solaris_state=wrong&code=fake HTTP/1.1")).StartsWith("HTTP/1.1 400"), "Foreign nonce accepted");
Check(browser.Take() is null, "Foreign nonce persisted"); results.Add("foreign nonce rejected");
Check((await Request("GET /other?solaris_state=" + state + "&code=fake HTTP/1.1")).StartsWith("HTTP/1.1 400"), "Wrong callback path accepted");
results.Add("wrong callback path rejected");
Check((await Request("POST /auth/callback?solaris_state=" + state + "&code=fake HTTP/1.1")).StartsWith("HTTP/1.1 400"), "POST accepted");
results.Add("invalid HTTP method rejected");
var relay = await Request("GET /auth/callback?solaris_state=" + state + " HTTP/1.1");
Check(relay.StartsWith("HTTP/1.1 400") && relay.Contains(AuthBrowser.FragmentRelayScript) && relay.Contains("script-src 'sha256-"), "Nonce-only request must relay safely without consuming login");
Check(!AuthBrowser.FragmentRelayScript.Contains('\r'), "Relay CSP text must use the browser's normalized LF on Windows checkout");
Check(browser.Take() is null, "Missing-code callback persisted"); results.Add("missing code does not consume the listener");
Check((await Request("GET /auth/callback?solaris_state=" + state + "&solaris_state=foreign&code=fake HTTP/1.1")).StartsWith("HTTP/1.1 400"), "Duplicate nonce accepted");
results.Add("ambiguous duplicate nonce rejected");
using (var disconnected = new TcpClient()) { await disconnected.ConnectAsync("127.0.0.1", 43854); }
using (var stalled = new TcpClient()) { await stalled.ConnectAsync("127.0.0.1", 43854); await Task.Delay(5500); }
Check((await Request("GET /favicon.ico HTTP/1.1")).StartsWith("HTTP/1.1 400"), "Stalled client stopped listener");
results.Add("closed and timed-out clients do not cancel authentication");
var code = "fixture-private-code";
var response = await Request("GET /auth/callback?solaris_state=" + state + "&code=" + code + " HTTP/1.1");
Check(response.StartsWith("HTTP/1.1 200"), "Callback failed"); Check(!response.Contains(code), "Code reflected into page");
Check(response.Contains("Cache-Control: no-store") && response.Contains("default-src 'none'"), "Callback response headers");
Check(browser.Take() == redirect + "&code=" + code, "Wrong callback stored");
Check(browser.Take() == redirect + "&code=" + code, "Unacknowledged callback lost");
Check(!browser.Ack(redirect + "&code=other") && browser.Take() is not null, "Stale ACK cleared callback");
Check(browser.Ack(redirect + "&code=" + code) && browser.Take() is null, "Acknowledged callback retained");
results.Add("single-use callback with no reflected credentials");
browser.Listen("http://127.0.0.1:43854/auth/callback?solaris_state=" + Guid.NewGuid()); browser.Cancel(); Check(browser.Take() is null, "Cancelled callback persisted");
results.Add("cancellation clears pending returns");
state = Guid.NewGuid().ToString(); redirect = "http://127.0.0.1:43854/auth/callback?solaris_state=" + state;
browser.Listen(redirect);
var failure = await Request("GET /auth/callback?solaris_state=" + state + "&error=provider_error&error_code=identity_already_exists&error_description=fixture-private-description HTTP/1.1");
Check(failure.StartsWith("HTTP/1.1 200"), "Provider failure was not delivered");
Check(browser.Take() == redirect + "&error=oauth_callback_error&error_code=identity_already_exists", "Provider error was not sanitized");
Check(!browser.Take()!.Contains("fixture-private-description"), "Provider details leaked");
Check(browser.Ack(browser.Take()!), "Provider failure ACK failed");
results.Add("provider failure arrives without private fragment details");
state = Guid.NewGuid().ToString(); redirect = "http://127.0.0.1:43854/auth/callback?solaris_state=" + state;
browser.Listen(redirect);
await Request("GET /auth/callback?solaris_state=" + state + "&access_token=fixture-private-token&code=fixture-code HTTP/1.1");
Check(browser.Take() == redirect + "&error=oauth_callback_error&error_code=unsupported_implicit_response", "Token query was accepted or forwarded");
Check(browser.Ack(browser.Take()!), "Token error ACK failed");
results.Add("implicit token query is reported without accepting or exposing tokens");
foreach (var result in results) Console.WriteLine("PASS: " + result);
Console.WriteLine($"PASS: {results.Count} real Windows loopback authentication checks; no live Google login.");
