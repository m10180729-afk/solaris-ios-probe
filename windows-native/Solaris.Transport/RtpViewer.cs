using System.Diagnostics;
using System.Collections.Concurrent;
using SIPSorcery.Net;
using SIPSorceryMedia.Abstractions;

namespace Solaris.Transport;

public sealed record VideoUnit(byte[] Data, bool Key, long TimestampUs);
public sealed class RtpViewer : IDisposable
{
    public readonly RTCPeerConnection Peer;
    public readonly string ViewerID;
    public readonly string ConnectionID = Guid.NewGuid().ToString();
    private readonly object gate = new();
    private readonly Queue<VideoUnit> frames = new();
    private readonly SemaphoreSlim ready = new(0, 1);
    private readonly CancellationTokenSource cancel = new();
    private readonly ConcurrentQueue<ushort> retransmit = new();
    private readonly Dictionary<ushort, Cached> cache = new();
    private readonly Queue<(ushort Seq, long At)> cacheOrder = new();
    private readonly List<RTCIceCandidateInit> pendingIce = new();
    private bool remoteReady, waitingKey = true, disposed;
    private ushort sequence = (ushort)Random.Shared.Next(65536);
    private int videoPayload = 96, audioPayload = 111;
    private long sentFrames, sentBytes, packets, drops, retransmits, pli, nack;
    private long lastReportUs, lastFrameUs, snapshotAt, snapshotFrames, snapshotBytes;
    public long Generation { get; set; }
    public string? OfferSDP { get; private set; }
    public double ReceiverFPS { get; set; }
    public long ReceiverFramesDecoded { get; set; }
    private double lossPercent;
    private string error = "";
    private readonly int pacingMbps;
    public event Action<string, object>? Signal;
    public event Action<string>? State;
    public static long NowUs => (long)(Stopwatch.GetTimestamp() * (1_000_000.0 / Stopwatch.Frequency));
    private sealed record Cached(byte[] Payload, uint Timestamp, int Marker, long At);

    public RtpViewer(string viewerID, bool audio, int pacingMbps = 18, bool useStun = true)
    {
        ViewerID = viewerID; this.pacingMbps = Math.Clamp(pacingMbps, 4, 80);
        var config = new RTCConfiguration();
        if (useStun) config.iceServers = new List<RTCIceServer> { new() { urls = "stun:stun.l.google.com:19302" } };
        Peer = new RTCPeerConnection(config);
        Peer.addTrack(new MediaStreamTrack(new List<VideoFormat> {
            new(96, "H264", 90000, "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e02a")
        }, MediaStreamStatusEnum.SendOnly));
        if (audio) Peer.addTrack(new MediaStreamTrack(new List<AudioFormat> {
            new(111, "opus", 48000, 2, "stereo=1;sprop-stereo=1;maxaveragebitrate=256000;useinbandfec=1")
        }, MediaStreamStatusEnum.SendOnly));
        Peer.OnVideoFormatsNegotiated += formats => videoPayload = formats.First().FormatID;
        Peer.OnAudioFormatsNegotiated += formats => audioPayload = formats.First().FormatID;
        Peer.onicecandidate += c => Signal?.Invoke("ice", new { candidate = c.candidate, sdpMid = c.sdpMid, sdpMLineIndex = c.sdpMLineIndex });
        Peer.onconnectionstatechange += state => { lock (gate) { waitingKey = true; frames.Clear(); } State?.Invoke(state.ToString()); };
        Peer.OnReceiveReport += (_, media, report) =>
        {
            Interlocked.Exchange(ref lastReportUs, NowUs);
            if (media != SDPMediaTypesEnum.video) return;
            if (report.ReceiverReport?.ReceptionReports?.FirstOrDefault() is { } rr)
                lossPercent = rr.FractionLost * 100.0 / 256.0;
            var feedback = report.Feedback;
            if (feedback == null) return;
            if (feedback.Header.PacketType == RTCPReportTypesEnum.PSFB && feedback.Header.PayloadFeedbackMessageType == PSFBFeedbackTypesEnum.PLI)
            {
                Interlocked.Increment(ref pli);
                // Encoder emits periodic IDR every 0.5s. Gate deltas until that
                // fresh IDR, never replay an old IDR with newer dependent deltas.
                lock (gate) { waitingKey = true; frames.Clear(); }
            }
            if (feedback.Header.PacketType == RTCPReportTypesEnum.RTPFB && feedback.Header.FeedbackMessageType == RTCPFeedbackTypesEnum.NACK)
            {
                Interlocked.Increment(ref nack);
                if (retransmit.Count < 128) {
                    retransmit.Enqueue(feedback.PID);
                    for (int i = 0; i < 16; i++) if ((feedback.BLP & (1 << i)) != 0) retransmit.Enqueue(unchecked((ushort)(feedback.PID + i + 1)));
                    Wake();
                }
            }
        };
        _ = Task.Run(SendLoop);
    }

    public async Task<string> CreateOffer()
    {
        var offer = Peer.createOffer(null);
        // Advertise the feedback handled below. Keep H.264 format unchanged.
        offer.sdp = offer.sdp.Replace("a=rtpmap:96 H264/90000\r\n", "a=rtpmap:96 H264/90000\r\na=rtcp-fb:96 nack\r\na=rtcp-fb:96 nack pli\r\n");
        await Peer.setLocalDescription(offer);
        OfferSDP = Peer.localDescription.sdp.ToString();
        return OfferSDP;
    }
    public void Answer(string sdp)
    {
        if (remoteReady) return; // Duplicate answer is an acknowledgement retry.
        var result = Peer.setRemoteDescription(new RTCSessionDescriptionInit { type = RTCSdpType.answer, sdp = sdp });
        if (result != SetDescriptionResultEnum.OK) throw new InvalidOperationException("SDP answer: " + result);
        lock (pendingIce) { remoteReady = true; foreach (var c in pendingIce) Peer.addIceCandidate(c); pendingIce.Clear(); }
    }
    public void Ice(RTCIceCandidateInit c)
    {
        lock (pendingIce) { if (remoteReady) Peer.addIceCandidate(c); else if (pendingIce.Count < 128) pendingIce.Add(c); }
    }
    public void Enqueue(VideoUnit unit)
    {
        if (disposed || Peer.connectionState != RTCPeerConnectionState.connected) return;
        lock (gate)
        {
            if (waitingKey && !unit.Key) { drops++; return; }
            if (frames.Count >= 3) { drops += frames.Count; frames.Clear(); waitingKey = true; }
            if (waitingKey && !unit.Key) { drops++; return; }
            if (unit.Key) waitingKey = false;
            frames.Enqueue(unit);
        }
        Wake();
    }
    private void Wake() { try { ready.Release(); } catch (SemaphoreFullException) { } }
    private async Task SendLoop()
    {
        try {
            while (!cancel.IsCancellationRequested) {
                await ready.WaitAsync(cancel.Token);
                // NACK repair stays on this peer's send worker, with bounded age.
                while (retransmit.TryDequeue(out var seq)) {
                    if (cache.TryGetValue(seq, out var c) && NowUs - c.At < 300_000 && Peer.connectionState == RTCPeerConnectionState.connected) {
                        Peer.SendRtpRaw(SDPMediaTypesEnum.video, c.Payload, c.Timestamp, c.Marker, videoPayload, seq); retransmits++;
                    }
                }
                VideoUnit? unit;
                lock (gate) {
                    unit = frames.Count > 0 ? frames.Dequeue() : null;
                    if (frames.Count > 0) Wake();
                    if (unit != null && NowUs - unit.TimestampUs > 200_000) { drops++; waitingKey = true; frames.Clear(); unit = null; }
                }
                if (unit == null || Peer.connectionState != RTCPeerConnectionState.connected) continue;
                var payloads = H264Packets.Split(unit.Data);
                uint timestamp = unchecked((uint)(unit.TimestampUs * 9 / 100));
                long began = NowUs, bytesThisFrame = 0;
                bool complete = payloads.Count > 0;
                for (int i = 0; i < payloads.Count; i++) {
                    if (cancel.IsCancellationRequested || Peer.connectionState != RTCPeerConnectionState.connected) { complete = false; break; }
                    var packet = payloads[i]; int marker = i == payloads.Count - 1 ? 1 : 0;
                    var seq = sequence++;
                    Peer.SendRtpRaw(SDPMediaTypesEnum.video, packet, timestamp, marker, videoPayload, seq);
                    cache[seq] = new(packet, timestamp, marker, NowUs); cacheOrder.Enqueue((seq, NowUs));
                    packets++; sentBytes += packet.Length; bytesThisFrame += packet.Length + 40;
                    // A short per-frame pacer prevents keyframes from being a UDP burst.
                    long waitUs = began + bytesThisFrame * 8 / pacingMbps - NowUs;
                    if (waitUs >= 2000 && i < payloads.Count - 1) await Task.Delay((int)Math.Min(waitUs / 1000, 10), cancel.Token);
                }
                if (complete) { Interlocked.Increment(ref sentFrames); Interlocked.Exchange(ref lastFrameUs, NowUs); }
                while (cacheOrder.Count > 2048 || cacheOrder.TryPeek(out var oldest) && NowUs - oldest.At > 500_000) {
                    var old = cacheOrder.Dequeue(); if (cache.TryGetValue(old.Seq, out var c) && c.At <= old.At) cache.Remove(old.Seq);
                }
            }
        } catch (OperationCanceledException) { }
        catch (Exception e) { error = e.Message; State?.Invoke("send-error"); }
    }
    private readonly object audioGate = new();
    public void SendAudio(byte[] opus, long timestampUs)
    {
        if (disposed || Peer.connectionState != RTCPeerConnectionState.connected || Peer.AudioStream == null) return;
        try { lock (audioGate) Peer.SendRtpRaw(SDPMediaTypesEnum.audio, opus, unchecked((uint)(timestampUs * 48 / 1000)), 0, audioPayload); }
        catch (Exception e) { error = "audio: " + e.Message; State?.Invoke("audio-send-error"); }
    }
    public object Snapshot()
    {
        lock (gate) {
        long now = NowUs, count = Interlocked.Read(ref sentFrames), bytes = Interlocked.Read(ref sentBytes);
        double dt = snapshotAt > 0 ? (now - snapshotAt) / 1_000_000.0 : 0;
        double fps = dt > 0 ? (count - snapshotFrames) / dt : 0;
        double mbps = dt > 0 ? (bytes - snapshotBytes) * 8 / dt / 1_000_000 : 0;
        snapshotAt = now; snapshotFrames = count; snapshotBytes = bytes;
        return new {
            viewerID = ViewerID, connectionID = ConnectionID, generation = Generation, rtpSendFPS = fps, rtpSendMbps = mbps, receiverFPS = ReceiverFPS, receiverFramesDecoded = ReceiverFramesDecoded, peer = Peer.connectionState.ToString(), ice = Peer.iceConnectionState.ToString(),
            rtpFramesSent = Interlocked.Read(ref sentFrames), rtpPayloadBytesSent = Interlocked.Read(ref sentBytes), rtpPacketsSent = Interlocked.Read(ref packets),
            queueFrames = frames.Count, queueOldestMilliseconds = frames.TryPeek(out var first) ? Math.Max(0, (NowUs - first.TimestampUs) / 1000.0) : 0,
            queueDrops = drops, awaitingKeyFrame = waitingKey, retransmittedPackets = retransmits, pliReceived = pli, nackReceived = nack,
            receiverLossPercent = lossPercent, lastRtcpAgeMilliseconds = lastReportUs == 0 ? (double?)null : (NowUs - lastReportUs) / 1000.0,
            lastSentFrameAgeMilliseconds = lastFrameUs == 0 ? (double?)null : (NowUs - lastFrameUs) / 1000.0, lastError = error
        };
        }
    }
    public void Dispose() { if (disposed) return; disposed = true; cancel.Cancel(); Peer.Close("viewer stopped"); }
}
