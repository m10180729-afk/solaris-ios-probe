namespace Solaris.Transport;

// Whole stereo frames only: a partial WASAPI callback must never become a
// half-filled Opus packet or swap the L/R channel positions.
public sealed class StereoPcmBuffer
{
    private readonly Queue<byte> bytes = new();
    private readonly object gate = new();
    private bool primed;
    public long OverflowBytes { get; private set; }
    public long UnderrunPackets { get; private set; }
    public double BufferedMilliseconds { get { lock (gate) return bytes.Count / 192.0; } }
    public void Append(ReadOnlySpan<byte> data)
    {
        if (data.Length % 4 != 0) throw new ArgumentException("PCM must contain whole S16 stereo frames.");
        lock (gate) {
            foreach (byte b in data) bytes.Enqueue(b);
            // At most 200ms; discard whole stereo frames, never half a channel.
            while (bytes.Count > 38400) { for (int i=0;i<4;i++) bytes.Dequeue(); OverflowBytes += 4; }
        }
    }
    public bool Read20ms(short[] target)
    {
        if (target.Length != 1920) throw new ArgumentException("Opus packet requires 960 stereo samples.");
        lock (gate) {
            if (!primed && bytes.Count >= 7680) primed = true; // 40ms jitter reserve.
            if (!primed || bytes.Count < 3840) {
                if (primed) { UnderrunPackets++; primed = false; }
                Array.Clear(target); return false;
            }
            for (int i=0;i<target.Length;i++) target[i]=(short)(bytes.Dequeue() | bytes.Dequeue()<<8);
            return true;
        }
    }
}
