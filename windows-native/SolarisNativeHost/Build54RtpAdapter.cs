using System.Text.Json;

namespace SolarisNativeHost;

// Authenticated app bridge around the unmodified build54 capture/RTP engine.
internal sealed class Build54RtpAdapter : IDisposable
{
    private readonly IBuild54RtpEngine engine;
    private readonly Action<object> emit;
    private readonly object gate = new();
    private readonly SemaphoreSlim commands = new(1);
    private readonly Dictionary<string, (string ConnectionID, long Generation)> peers = new();
    private readonly Dictionary<string, long> retiredGenerations = new();
    private string? id;
    private bool active, disposed;
    private string? error;
    private JsonElement? currentCommand;

    internal Build54RtpAdapter(Action<object> emit, Func<Action<object>, IBuild54RtpEngine> createEngine)
    {
        this.emit = emit;
        engine = createEngine(Forward);
    }
    private static string Text(JsonElement m, string key) => m.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : "";
    private static bool PeerCommand(string type) => type is "rtp-join" or "rtp-recover" or "rtp-answer" or "rtp-ice" or "rtp-heartbeat" or "rtp-leave" or "rtp-quality";
    private void Forward(object value)
    {
        var m = JsonSerializer.SerializeToElement(value);
        var type = Text(m, "type");
        object outgoing = value;
        lock (gate) {
            if (disposed || Text(m, "session") != id) return;
            if (type == "rtp-status") {
                var state = Text(m, "state");
                // The original command catch shares the encoder's error event.
                // Isolate only that exact catch; a capture failure remains fatal.
                if (state == "error" && Text(m, "message") == "RTP 처리 오류" && currentCommand is { } command && PeerCommand(Text(command, "type"))) {
                    outgoing = new { type = "media-peer-error", id, viewerID = Text(command, "viewerID"), connectionID = Text(command, "connectionID"), command = Text(command, "type"), code = "native_peer_command_failed", error = "이 시청자의 화면공유 연결을 처리하지 못했습니다. 연결을 다시 시도하세요." };
                }
                else {
                    if (state == "running") active = true;
                    if (state == "error") { active = false; error = Text(m, "detail"); if (error.Length == 0) error = "화면공유 시작 실패"; }
                }
            }
            if (type == "rtp-signal") {
                var viewer = Text(m, "viewerID"); var connection = Text(m, "connectionID");
                var generation = m.TryGetProperty("generation", out var g) && g.TryGetInt64(out var n) ? n : 0;
                if (retiredGenerations.TryGetValue(viewer, out var retired) && generation <= retired) return;
                if (peers.TryGetValue(viewer, out var previous) && generation < previous.Generation) return;
                peers[viewer] = (connection, generation);
            }
        }
        emit(outgoing);
    }
    internal async Task Command(JsonElement message)
    {
        // Serialize before changing wrapper state, including slow encoder probes.
        await commands.WaitAsync();
        try {
            var type = Text(message, "type"); var session = Text(message, "session");
            var viewer = Text(message, "viewerID"); var connection = Text(message, "connectionID");
            lock (gate) {
                if (disposed) return;
                if (type == "rtp-start") { id = session; active = false; error = null; peers.Clear(); retiredGenerations.Clear(); }
                else {
                    if (id == null || session != id) return;
                    if (PeerCommand(type)) {
                        if (!Guid.TryParse(viewer, out _)) return;
                        if (type != "rtp-join" && (!peers.TryGetValue(viewer, out var peer) || peer.ConnectionID != connection)) return;
                        // Fence before disposal: already queued ICE can arrive
                        // both during engine.Command and after it returns.
                        if (type == "rtp-leave") retiredGenerations[viewer] = peers[viewer].Generation;
                    }
                }
                currentCommand = message.Clone();
            }
            await engine.Command(message);
            lock (gate) {
                if (disposed || id != session) return;
                if (type == "rtp-start" && error != null) throw new IOException(error);
                if (type == "rtp-stop") { active = false; id = null; peers.Clear(); retiredGenerations.Clear(); }
                if (type == "rtp-leave" && peers.TryGetValue(viewer, out var peer) && peer.ConnectionID == connection) peers.Remove(viewer);
            }
        }
        finally { lock (gate) currentCommand = null; commands.Release(); }
    }
    internal object Snapshot() { lock (gate) return new { id, active, peers = peers.Select(p => new { viewerID = p.Key, connectionID = p.Value.ConnectionID }).ToArray() }; }
    public void Dispose() { lock (gate) { if (disposed) return; disposed = true; active = false; id = null; peers.Clear(); retiredGenerations.Clear(); } engine.Dispose(); }
}

internal interface IBuild54RtpEngine : IDisposable { Task Command(JsonElement message); }
