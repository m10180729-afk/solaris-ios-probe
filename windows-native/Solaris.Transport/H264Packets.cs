namespace Solaris.Transport;

// RFC 6184, packetization-mode=1. Each access unit has one timestamp and
// only its final packet has M=1. No application fragmentation/data channel.
public static class H264Packets
{
    public static IReadOnlyList<byte[]> Split(byte[] annexB, int mtu = 1150)
    {
        if (mtu < 64) throw new ArgumentOutOfRangeException(nameof(mtu));
        var nals = new List<(int Start, int End)>();
        int start = -1;
        for (int i = 0; i + 2 < annexB.Length; i++)
        {
            if (annexB[i] != 0 || annexB[i + 1] != 0) continue;
            int prefix = annexB[i + 2] == 1 ? 3 : i + 3 < annexB.Length && annexB[i + 2] == 0 && annexB[i + 3] == 1 ? 4 : 0;
            if (prefix == 0) continue;
            if (start >= 0 && i > start) nals.Add((start, i));
            start = i + prefix;
            i += prefix - 1;
        }
        if (start >= 0 && start < annexB.Length) nals.Add((start, annexB.Length));
        var result = new List<byte[]>();
        foreach (var nal in nals)
        {
            var type = annexB[nal.Start] & 31;
            if (type == 9 || type == 12) continue; // AUD/filler have no decoder content.
            int size = nal.End - nal.Start;
            if (size <= mtu) { result.Add(annexB[nal.Start..nal.End]); continue; }
            for (int pos = nal.Start + 1; pos < nal.End;)
            {
                int len = Math.Min(mtu - 2, nal.End - pos);
                var payload = new byte[len + 2];
                payload[0] = (byte)((annexB[nal.Start] & 0xe0) | 28);
                payload[1] = (byte)(type | (pos == nal.Start + 1 ? 0x80 : 0) | (pos + len == nal.End ? 0x40 : 0));
                Buffer.BlockCopy(annexB, pos, payload, 2, len);
                result.Add(payload); pos += len;
            }
        }
        return result;
    }
}
