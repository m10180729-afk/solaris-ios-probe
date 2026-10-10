using Solaris.Transport;

static class SchedulingTests
{
    public static async Task CheckRealTimer(Action<bool,string> check)
    {
        var pacer = new PacketPacer(18, RtpViewer.NowUs);
        long began = RtpViewer.NowUs; int sent = 0;
        while (sent < 4_500_000) {
            long wait = pacer.Reserve(1200, RtpViewer.NowUs);
            if (wait == 0) sent += 1200;
            else await Task.Delay((int)Math.Max(1, (wait + 999) / 1000));
        }
        double mbps = sent * 8.0 / (RtpViewer.NowUs - began);
        check(mbps >= 15 && mbps < 19, $"real OS timer pacing {mbps:F2}Mbps (18Mbps target)");
    }
    public static void Run(Action<bool,string> check)
    {
        var clock = new ConstantFrameClock(60);
        var ticks = Enumerable.Range(0, 60).Select(_ => clock.Next(1_000_000)).ToArray();
        check(ticks.Distinct().Count() == 60 && ticks[^1] - ticks[0] == 983333,
            "60 batched access units retain distinct CFR media timestamps");
        // A 420KB IDR every 0.5s with 15KB deltas is 13.68Mbps before overhead.
        // Model a timer that wakes only on 16ms boundaries, including during IDR.
        var backlog = new VideoBacklog(18); var pacer = new PacketPacer(18, 0);
        long now = 0, next = 0, sent = 0, created = 0, sleepUntil = 0, inFlight = 0;
        int maxQueue = 0;
        for (; now < 10_000_000; now += 1000) {
            while (next <= now && created < 540) {
                bool key = created % 30 == 0;
                backlog.Add(new VideoUnit(new byte[key ? 420000 : 15000], key, next), now);
                created++; next = created * 1_000_000 / 60;
            }
            maxQueue = Math.Max(maxQueue, backlog.Count);
            if (now < sleepUntil) continue;
            while (true) {
                if (inFlight == 0) {
                    var unit = backlog.Take(now); if (unit == null) break;
                    inFlight = unit.Data.Length;
                }
                int size = (int)Math.Min(1100, inFlight);
                long wait = pacer.Reserve(size + 64, now);
                if (wait > 0) { sleepUntil = ((now + wait + 15999) / 16000) * 16000; break; }
                inFlight -= size;
                if (inFlight == 0) sent++;
            }
        }
        check(maxQueue > 3 && backlog.Drops == 0 && sent == created && sent == 540,
            $"large-IDR + 16ms timer: all {sent} frames sent, max queue {maxQueue}, zero resync drops");
        // Low-latency bound is still enforced for real overload; only a valid
        // keyframe suffix may survive. No dependent deltas leak after loss.
        var overloaded = new VideoBacklog(18);
        overloaded.Add(new(new byte[1000], true, 0), 0);
        overloaded.Add(new(new byte[950000], false, 1), 1);
        overloaded.Add(new(new byte[100], false, 2), 2);
        check(overloaded.WaitingKey && overloaded.Count == 0 && overloaded.Drops == 3,
            "overload discards broken dependency chain and gates deltas");
        overloaded.Add(new(new byte[1000], true, 3), 3);
        check(overloaded.Take(4)?.Key == true && !overloaded.WaitingKey,
            "fresh IDR resumes after overload without reconnecting");
        var expired = new VideoBacklog(18);
        expired.Add(new(new byte[100], true, 0), 0);
        expired.Add(new(new byte[100], false, 200000), 200000);
        expired.Add(new(new byte[100], true, 350000), 350000);
        expired.Add(new(new byte[100], false, 360000), 360000);
        check(expired.Take(410000)?.Key == true && expired.Count == 1 && expired.Drops == 2,
            "expired prefix replaced by newest complete IDR dependency chain");
        var idlePacer = new PacketPacer(18, 0);
        int burst = 0; while (idlePacer.Reserve(1200, 20_000_000) == 0) burst += 1200;
        check(burst <= 45000 && burst > 40000, "long idle cannot accumulate unlimited packet burst credit");
    }
}
