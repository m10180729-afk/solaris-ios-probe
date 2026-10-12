using System.Collections.Concurrent;
using System.Text.Json;

namespace SolarisNativeHost;

// Authenticated app bridge around the unmodified build54 capture/RTP engine.
internal sealed class Build54RtpAdapter : IDisposable
{
    private readonly NativeRtpBroadcast engine;
    private readonly ConcurrentDictionary<string, string> peers = new();
    private string? id;
    private volatile bool active;
    private string? error;
    internal Build54RtpAdapter(Action<object> emit)
    {
        engine = new NativeRtpBroadcast(value => {
            var m = JsonSerializer.SerializeToElement(value);
            var type = m.GetProperty("type").GetString();
            if (type == "rtp-status") {
                var state = m.GetProperty("state").GetString();
                if (state == "running") active = true;
                if (state == "error") { active = false; error = m.GetProperty("detail").GetString() ?? "화면공유 시작 실패"; }
            }
            if (type == "rtp-signal") peers[m.GetProperty("viewerID").GetString()!] = m.GetProperty("connectionID").GetString()!;
            emit(value);
        });
    }
    internal async Task Command(JsonElement message)
    {
        var type = message.GetProperty("type").GetString();
        if (type == "rtp-start") { id = message.GetProperty("session").GetString(); active = false; error = null; peers.Clear(); }
        await engine.Command(message);
        if (type == "rtp-start" && error != null) throw new IOException(error);
        if (type == "rtp-stop") { active = false; id = null; peers.Clear(); }
        if (type == "rtp-leave") peers.TryRemove(message.GetProperty("viewerID").GetString() ?? "", out _);
    }
    internal object Snapshot() => new { id, active, peers = peers.Select(p => new { viewerID = p.Key, connectionID = p.Value }).ToArray() };
    public void Dispose() { active = false; engine.Dispose(); peers.Clear(); }
}
