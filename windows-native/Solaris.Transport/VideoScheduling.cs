namespace Solaris.Transport;

// One owner (RtpViewer.gate). Bound work in time/bytes, not three frames:
// an ordinary 350KB IDR needs ~156ms at 18Mbps while nine deltas arrive.
public sealed class VideoBacklog
{
    private readonly Queue<(VideoUnit Unit, long Arrival)> queue = new();
    private readonly long maxBytes, maxAgeUs;
    public bool WaitingKey { get; private set; } = true;
    public long Drops { get; private set; }
    public long WaitingKeyDrops { get; private set; }
    public long RecoveryCount { get; private set; }
    public long Bytes { get; private set; }
    public string LastReset { get; private set; } = "startup";
    public int Count => queue.Count;
    public long OldestAgeUs(long now) => queue.TryPeek(out var x) ? Math.Max(0, now - x.Arrival) : 0;
    private static long WireBytes(VideoUnit u) => u.Data.LongLength + (u.Data.LongLength / 1100 + 4) * 64;
    public VideoBacklog(int mbps, int budgetMilliseconds = 400)
    {
        maxAgeUs = budgetMilliseconds * 1000L;
        maxBytes = mbps * maxAgeUs / 8;
    }
    public void Reset(string reason)
    {
        Drops += queue.Count; queue.Clear(); Bytes = 0; WaitingKey = true; LastReset = reason;
    }
    private bool OverBudget(long now) => Bytes > maxBytes || OldestAgeUs(now) > maxAgeUs || queue.Count > 120;
    private void Recover(long now)
    {
        if (!OverBudget(now)) return;
        RecoveryCount++; LastReset = "latency-budget";
        // A newer IDR and all its following deltas form a valid dependency chain.
        // Keep that suffix if it fits; never keep arbitrary 'latest' delta frames.
        var saved = queue.ToArray(); int key = Array.FindLastIndex(saved, x => x.Unit.Key);
        int remove = key > 0 ? key : saved.Length;
        for (int i = 0; i < remove; i++) { Bytes -= WireBytes(queue.Dequeue().Unit); Drops++; }
        if (OverBudget(now)) Reset("latency-budget");
        WaitingKey = queue.Count == 0;
    }
    public void Add(VideoUnit unit, long now)
    {
        if (WaitingKey && !unit.Key) { Drops++; WaitingKeyDrops++; return; }
        if (unit.Key) WaitingKey = false;
        queue.Enqueue((unit, now)); Bytes += WireBytes(unit);
        Recover(now);
    }
    public VideoUnit? Take(long now)
    {
        Recover(now);
        if (!queue.TryDequeue(out var entry)) return null;
        Bytes -= WireBytes(entry.Unit); return entry.Unit;
    }
}

// Shared across frame boundaries AND retransmissions. Timer overshoot earns
// bounded credit; it does not reset the packet schedule or create an unbounded
// catch-up burst. 20ms credit accommodates coarse Windows timers without spin.
public sealed class PacketPacer
{
    private readonly double bytesPerUs, capacity;
    private double credit;
    private long at;
    public PacketPacer(int mbps, long now)
    {
        bytesPerUs = mbps / 8.0; capacity = bytesPerUs * 20_000;
        credit = capacity; at = now;
    }
    public long Reserve(int bytes, long now)
    {
        credit = Math.Min(capacity, credit + Math.Max(0, now - at) * bytesPerUs); at = now;
        if (credit >= bytes) { credit -= bytes; return 0; }
        return (long)Math.Ceiling((bytes - credit) / bytesPerUs);
    }
}

// Raw Annex-B carries no container PTS. The producer explicitly emits CFR,
// therefore each access unit advances the media clock even when pipe reads batch.
public sealed class ConstantFrameClock(int fps)
{
    private long? origin;
    private long index;
    public long Next(long firstArrivalUs)
    {
        origin ??= firstArrivalUs;
        return origin.Value + index++ * 1_000_000 / fps;
    }
}
