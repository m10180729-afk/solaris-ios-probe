using System.Text.Json;
using SolarisNativeHost;

internal static class RtpAdapterTests
{
    private const string Viewer = "11111111-1111-4111-8111-111111111111";
    private const string Other = "22222222-2222-4222-8222-222222222222";
    private static JsonElement Message(string type, string session = "broadcast", string viewer = Viewer, string connection = "") =>
        JsonSerializer.SerializeToElement(new { type, session, viewerID = viewer, connectionID = connection });
    private static JsonElement Snapshot(Build54RtpAdapter adapter) => JsonSerializer.SerializeToElement(adapter.Snapshot());
    private static string Connection(Build54RtpAdapter adapter, string viewer = Viewer) =>
        Snapshot(adapter).GetProperty("peers").EnumerateArray().Single(p => p.GetProperty("viewerID").GetString() == viewer).GetProperty("connectionID").GetString()!;
    private static TaskCompletionSource<bool> Deferred() => new(TaskCreationOptions.RunContinuationsAsynchronously);
    private static (Build54RtpAdapter Adapter, FakeEngine Engine, List<JsonElement> Events) Fixture()
    {
        var events = new List<JsonElement>(); FakeEngine? engine = null;
        var adapter = new Build54RtpAdapter(value => events.Add(JsonSerializer.SerializeToElement(value)), emit => engine = new FakeEngine(emit));
        return (adapter, engine!, events);
    }
    internal static async Task Run(Action<bool, string> check)
    {
        {
            var (adapter, engine, _) = Fixture(); using (adapter) {
                await adapter.Command(Message("rtp-start", "old")); await adapter.Command(Message("rtp-start", "new"));
                int before = engine.Commands.Count; await adapter.Command(Message("rtp-stop", "old"));
                var state = Snapshot(adapter);
                check(state.GetProperty("active").GetBoolean() && state.GetProperty("id").GetString() == "new" && engine.Commands.Count == before,
                    "stale stop cannot clear or reach the replacement broadcast");
            }
        }
        {
            var (adapter, engine, events) = Fixture(); using (adapter) {
                await adapter.Command(Message("rtp-start")); await adapter.Command(Message("rtp-join")); var old = Connection(adapter);
                await adapter.Command(Message("rtp-recover", connection: old)); var current = Connection(adapter);
                int before = engine.Commands.Count; await adapter.Command(Message("rtp-leave", connection: old));
                await adapter.Command(Message("rtp-answer", connection: old)); await adapter.Command(Message("rtp-recover", connection: old));
                check(current != old && Connection(adapter) == current && engine.Commands.Count == before,
                    "stale leave, answer and recover cannot erase or reach the new connection");
                int count = events.Count; engine.Signal("broadcast", Viewer, old, generation: 1);
                check(Connection(adapter) == current && events.Count == count,
                    "late older ICE generation cannot replace the current peer snapshot or reach the app");
                count = events.Count;
                engine.BeforePeer = () => { engine.Signal("broadcast", Viewer, current, generation: 2); return Task.CompletedTask; };
                await adapter.Command(Message("rtp-leave", connection: current));
                check(Snapshot(adapter).GetProperty("peers").GetArrayLength() == 0,
                    "current connection leave still disposes and removes its own peer");
                engine.Signal("broadcast", Viewer, current, generation: 2);
                check(Snapshot(adapter).GetProperty("peers").GetArrayLength() == 0 && events.Count == count,
                    "ICE during or after leave cannot resurrect the disposed peer");
                await adapter.Command(Message("rtp-join"));
                check(Connection(adapter) != current,
                    "a real later join can publish a newer generation after the viewer leaves");
            }
        }
        {
            var (adapter, engine, _) = Fixture(); using (adapter) {
                var started = Deferred(); var release = Deferred();
                engine.BeforeStart = async session => { if (session == "old") { started.SetResult(true); await release.Task; } };
                var old = adapter.Command(Message("rtp-start", "old")); await started.Task;
                var next = adapter.Command(Message("rtp-start", "new"));
                check(Snapshot(adapter).GetProperty("id").GetString() == "old" && engine.Commands.Count == 1,
                    "queued start cannot overwrite wrapper state while the older encoder is still probing");
                release.SetResult(true); await Task.WhenAll(old, next);
                check(Snapshot(adapter).GetProperty("id").GetString() == "new" && Snapshot(adapter).GetProperty("active").GetBoolean(),
                    "serialized replacement start publishes only its final running state");
            }
        }
        foreach (var command in new[] { "rtp-answer", "rtp-ice" }) {
            var (adapter, engine, events) = Fixture(); using (adapter) {
                await adapter.Command(Message("rtp-start")); await adapter.Command(Message("rtp-join")); await adapter.Command(Message("rtp-join", viewer: Other));
                string current = Connection(adapter), other = Connection(adapter, Other); engine.FailPeer = true;
                await adapter.Command(Message(command, connection: current)); var failure = events[^1];
                check(failure.GetProperty("type").GetString() == "media-peer-error" && failure.GetProperty("code").GetString() == "native_peer_command_failed" &&
                    failure.GetProperty("viewerID").GetString() == Viewer && failure.GetProperty("connectionID").GetString() == current && !failure.ToString().Contains("fixture-secret") &&
                    Snapshot(adapter).GetProperty("active").GetBoolean() && Connection(adapter, Other) == other,
                    command + " failure isolates the viewer and preserves the publisher and other viewer");
            }
        }
        {
            var (adapter, engine, events) = Fixture(); using (adapter) {
                await adapter.Command(Message("rtp-start")); await adapter.Command(Message("rtp-join"));
                var started = Deferred(); var release = Deferred(); engine.BeforePeer = async () => { started.SetResult(true); await release.Task; };
                var handling = adapter.Command(Message("rtp-answer", connection: Connection(adapter))); await started.Task;
                engine.Status("broadcast", "error", "네이티브 영상 읽기 실패", "capture stopped");
                check(!Snapshot(adapter).GetProperty("active").GetBoolean() && events[^1].GetProperty("type").GetString() == "rtp-status",
                    "real encoder failure remains fatal even while a peer command is pending");
                release.SetResult(true); await handling;
            }
        }
        {
            var (adapter, engine, _) = Fixture(); using (adapter) {
                engine.FailStart = true; bool failed = false;
                try { await adapter.Command(Message("rtp-start")); } catch (IOException) { failed = true; }
                check(failed && !Snapshot(adapter).GetProperty("active").GetBoolean(), "encoder start failure still rejects and leaves the sender inactive");
            }
        }
        {
            var (adapter, engine, events) = Fixture(); using (adapter) {
                await adapter.Command(Message("rtp-start", "new")); int before = events.Count;
                engine.Status("old", "error", "네이티브 영상 읽기 실패", "old capture");
                check(Snapshot(adapter).GetProperty("active").GetBoolean() && events.Count == before, "former broadcast events cannot stop or corrupt the current publisher");
            }
        }
        {
            var (adapter, engine, events) = Fixture(); var started = Deferred(); var release = Deferred();
            engine.BeforeStart = async _ => { started.SetResult(true); await release.Task; };
            var starting = adapter.Command(Message("rtp-start")); await started.Task; adapter.Dispose(); release.SetResult(true); await starting;
            check(engine.Disposed && !Snapshot(adapter).GetProperty("active").GetBoolean() && Snapshot(adapter).GetProperty("id").ValueKind == JsonValueKind.Null && events.Count == 0,
                "dispose during an encoder probe suppresses all late running events");
        }
    }

    // Models the original engine's session/CID guards and exact command error
    // event, without launching capture or opening a socket in lifecycle tests.
    private sealed class FakeEngine(Action<object> emit) : IBuild54RtpEngine
    {
        internal readonly List<JsonElement> Commands = new();
        private readonly Dictionary<string, string> connections = new();
        private string? session;
        private long generation;
        private readonly SemaphoreSlim commands = new(1);
        internal Func<string, Task>? BeforeStart;
        internal Func<Task>? BeforePeer;
        internal bool FailPeer, FailStart, Disposed;
        internal void Status(string sid, string state, string message, string detail = "") => emit(new { type = "rtp-status", session = sid, state, message, detail });
        internal void Signal(string sid, string viewer, string connection, long generation) => emit(new { type = "rtp-signal", session = sid, viewerID = viewer, connectionID = connection, generation, kind = "ice", payload = new { candidate = "fixture-candidate" } });
        public async Task Command(JsonElement m)
        {
            await commands.WaitAsync();
            try { await Handle(m); } finally { commands.Release(); }
        }
        private async Task Handle(JsonElement m)
        {
            Commands.Add(m.Clone()); string type = m.GetProperty("type").GetString()!, sid = m.GetProperty("session").GetString()!;
            if (type == "rtp-start") {
                if (BeforeStart != null) await BeforeStart(sid); session = sid; connections.Clear();
                Status(sid, FailStart ? "error" : "running", FailStart ? "RTP 처리 오류" : "capture running", "fixture encoder"); return;
            }
            if (sid != session) return;
            if (type == "rtp-stop") { session = null; connections.Clear(); return; }
            string viewer = m.GetProperty("viewerID").GetString()!, connection = m.GetProperty("connectionID").GetString()!;
            if (type is "rtp-join" or "rtp-recover") {
                var next = Guid.NewGuid().ToString(); connections[viewer] = next;
                Signal(sid, viewer, next, ++generation); return;
            }
            if (!connections.TryGetValue(viewer, out var current) || current != connection) return;
            if (BeforePeer != null) await BeforePeer();
            if (FailPeer) { Status(sid, "error", "RTP 처리 오류", "fixture-secret-SDP"); return; }
            if (type == "rtp-leave") connections.Remove(viewer);
        }
        public void Dispose() => Disposed = true;
    }
}
