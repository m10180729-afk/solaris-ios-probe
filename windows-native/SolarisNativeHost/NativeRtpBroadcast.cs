using System.Collections.Concurrent;
using System.Text.Json;
using SIPSorcery.Net;
using Solaris.Transport;

namespace SolarisNativeHost;

internal sealed class NativeRtpBroadcast : IDisposable
{
    private readonly Action<object> emit;
    private readonly ConcurrentDictionary<string, RtpViewer> viewers = new();
    private readonly NativeH264Capture capture;
    private SystemAudioCapture? audio;
    private readonly SemaphoreSlim commands = new(1);
    private readonly System.Threading.Timer metrics;
    private string? session;
    private string encoder = "", lastError = "", status = "idle";
    private long encodedFrames, encodedBytes, lastEncodedUs;
    private double encodedFPS;
    private bool withAudio;
    private int targetMbps = 12;
    private long nextGeneration, startedUs, lastEncoderRestart;
    private int encoderRestarts, reporting;
    private readonly ConcurrentDictionary<string, long> lastViewerSeen = new();

    internal NativeRtpBroadcast(Action<object> emit)
    {
        this.emit = emit;
        capture = new NativeH264Capture((data, key, timestamp, name) => {
            encoder = name; Interlocked.Increment(ref encodedFrames); Interlocked.Add(ref encodedBytes, data.Length); lastEncodedUs = RtpViewer.NowUs;
            var frame = new VideoUnit(data, key, timestamp);
            foreach (var peer in viewers.Values) peer.Enqueue(frame);
        }, (state, message, detail) => {
            if (state == "metrics") {
                var match = System.Text.RegularExpressions.Regex.Match(message, @"output\s+([\d.]+)fps");
                if (match.Success) double.TryParse(match.Groups[1].Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out encodedFPS);
                return;
            }
            status = state; if (state == "error") lastError = detail ?? message;
            emit(new { type = "rtp-status", session, state, message, detail });
        });
        metrics = new System.Threading.Timer(_ => Report(), null, 1000, 1000);
    }
    internal async Task Command(JsonElement message)
    {
        await commands.WaitAsync();
        try {
            string type = message.GetProperty("type").GetString() ?? "";
            string sid = message.TryGetProperty("session", out var s) ? s.GetString() ?? "" : "";
            if (type == "rtp-start") {
                Stop(); session = sid; withAudio = message.TryGetProperty("audio", out var a) && a.GetBoolean();
                targetMbps = 12; encodedFrames = encodedBytes = lastEncodedUs = 0; lastError = "";
                startedUs = RtpViewer.NowUs; lastEncoderRestart = 0; encoderRestarts = 0;
                await capture.StartAsync(new NativeCaptureOptions(60, targetMbps, 18));
                if (withAudio) {
                    try { audio = new SystemAudioCapture((data, ts) => { foreach (var peer in viewers.Values) peer.SendAudio(data, ts); }, err => { lastError = err; emit(new { type = "rtp-status", session, state = "audio-error", message = "시스템 소리 캡처 오류", detail = err }); }); audio.Start(); }
                    catch (Exception e) { audio?.Dispose(); audio = null; withAudio = false; lastError = e.Message; emit(new { type = "rtp-status", session, state = "audio-error", message = "시스템 소리를 시작하지 못했습니다", detail = e.Message }); }
                }
                emit(new { type = "rtp-ready", session, audio = withAudio }); return;
            }
            if (sid != session || session == null) return;
            if (type == "rtp-stop") { Stop(); return; }
            string viewer = message.TryGetProperty("viewerID", out var v) ? v.GetString() ?? "" : "";
            if (!Guid.TryParse(viewer, out _)) return;
            lastViewerSeen[viewer] = RtpViewer.NowUs;
            string cid = message.TryGetProperty("connectionID", out var c) ? c.GetString() ?? "" : "";
            if (type == "rtp-join" || type == "rtp-recover") {
                if (viewers.TryGetValue(viewer, out var old)) {
                    if (type == "rtp-join" || old.ConnectionID != cid) { EmitOffer(old); return; }
                    if (old.ConnectionID != cid) return; // stale recovery must not kill the replacement.
                    viewers.TryRemove(viewer, out _); old.Dispose();
                }
                if (viewers.Count >= 4) { emit(new { type = "rtp-status", session, state = "viewer-limit", message = "시청자는 최대 4명입니다." }); return; }
                var peer = new RtpViewer(viewer, withAudio, 18);
                viewers[viewer] = peer; var currentSession = session; var generation = ++nextGeneration; peer.Generation = generation;
                peer.Signal += (kind, payload) => emit(new { type = "rtp-signal", session = currentSession, viewerID = viewer, connectionID = peer.ConnectionID, generation, kind, payload });
                peer.State += state => emit(new { type = "rtp-peer", session = currentSession, viewerID = viewer, connectionID = peer.ConnectionID, state });
                await peer.CreateOffer();
                EmitOffer(peer);
                return;
            }
            if (!viewers.TryGetValue(viewer, out var selected) || selected.ConnectionID != cid) return;
            if (type == "rtp-heartbeat") {
                if (message.TryGetProperty("fps", out var fps) && fps.TryGetDouble(out var value) &&
                    message.TryGetProperty("framesDecoded", out var frames) && frames.TryGetInt64(out var count)) selected.ReceiverReport(value, count);
            }
            if (type == "rtp-answer") selected.Answer(message.GetProperty("sdp").GetString()!);
            if (type == "rtp-ice") selected.Ice(new RTCIceCandidateInit {
                candidate = message.GetProperty("candidate").GetString(),
                sdpMid = message.TryGetProperty("sdpMid", out var mid) && mid.ValueKind == JsonValueKind.String ? mid.GetString() : "0",
                sdpMLineIndex = message.TryGetProperty("sdpMLineIndex", out var line) && line.TryGetUInt16(out var idx) ? idx : (ushort)0
            });
            if (type == "rtp-leave") { viewers.TryRemove(viewer, out _); selected.Dispose(); lastViewerSeen.TryRemove(viewer, out _); }
        } catch (Exception e) { lastError = e.Message; emit(new { type = "rtp-status", session, state = "error", message = "RTP 처리 오류", detail = e.Message }); }
        finally { commands.Release(); }
    }
    private void EmitOffer(RtpViewer peer)
    {
        if (peer.OfferSDP == null) return;
        emit(new { type = "rtp-signal", session, viewerID = peer.ViewerID, connectionID = peer.ConnectionID,
            generation = peer.Generation, kind = "offer", payload = new { type = "offer", sdp = peer.OfferSDP, videoTransport = "native-rtp", audio = withAudio } });
    }
    private async void Report()
    {
        if (session == null || Interlocked.Exchange(ref reporting, 1) != 0) return;
        try {
        // A stalled encoder is a different failure from one stalled viewer.
        // Retry it at most twice; never restart for congestion or ordinary PLI.
        if (RtpViewer.NowUs - Math.Max(startedUs, lastEncodedUs) > 8_000_000 &&
            encoderRestarts < 2 && RtpViewer.NowUs - lastEncoderRestart > 15_000_000 && await commands.WaitAsync(0)) {
            try {
                if (session != null) {
                    encoderRestarts++; lastEncoderRestart = RtpViewer.NowUs; startedUs = lastEncoderRestart;
                    emit(new { type = "rtp-status", session, state = "encoder-recovery", message = "인코더 출력 정지 감지 · 재시작", detail = encoderRestarts.ToString() });
                    await capture.StartAsync(new NativeCaptureOptions(60, targetMbps, 18));
                }
            } catch (Exception e) { lastError = "encoder restart: " + e.Message; }
            finally { commands.Release(); }
        }
        if (session == null) return;
        foreach (var entry in lastViewerSeen) if (RtpViewer.NowUs - entry.Value > 45_000_000 && viewers.TryRemove(entry.Key, out var expired)) { expired.Dispose(); lastViewerSeen.TryRemove(entry.Key, out _); }
        emit(new { type = "rtp-metrics", session, status, encoderImplementation = encoder, nativeEncodedFPS = RtpViewer.NowUs - lastEncodedUs < 2_000_000 ? encodedFPS : 0,
            nativeEncodedFrames = Interlocked.Read(ref encodedFrames), nativeEncodedBytes = Interlocked.Read(ref encodedBytes),
            videoTransport = "native-rtp", width = 1920, height = 1080, targetFPS = 60, targetMbps, encoderRestarts,
            lastEncodedFrameAgeMilliseconds = lastEncodedUs > 0 ? (RtpViewer.NowUs - lastEncodedUs) / 1000.0 : (double?)null,
            viewers = viewers.Values.Select(x => x.Snapshot()).ToArray(), audio = audio?.Snapshot(), lastError });
        } catch (Exception e) { lastError = "metrics: " + e.Message; }
        finally { Interlocked.Exchange(ref reporting, 0); }
    }
    private void Stop()
    {
        session = null; capture.Stop(); audio?.Dispose(); audio = null;
        foreach (var peer in viewers.Values) peer.Dispose(); viewers.Clear(); lastViewerSeen.Clear(); status = "stopped";
    }
    public void Dispose() { metrics.Dispose(); Stop(); }
}
