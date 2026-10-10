using Concentus;
using Concentus.Enums;
using NAudio.Wave;
using Solaris.Transport;

namespace SolarisNativeHost;

// WASAPI loopback captures the default playback device, never the microphone.
// Windows' shared audio engine converts the mix to 48kHz interleaved stereo.
internal sealed class SystemAudioCapture : IDisposable
{
    private WasapiLoopbackCapture? capture;
    private readonly Action<byte[], long> output;
    private readonly Action<string> onError;
    private readonly StereoPcmBuffer pcm = new();
    private CancellationTokenSource? cancel;
    private Task? worker;
    private long capturedBytes, encodedPackets, silencePackets;
    private string error = "";
    internal SystemAudioCapture(Action<byte[], long> output, Action<string> onError) { this.output = output; this.onError = onError; }
    internal void Start()
    {
        capture = new WasapiLoopbackCapture { WaveFormat = new WaveFormat(48000, 16, 2) };
        capture.DataAvailable += (_, e) => {
            Interlocked.Add(ref capturedBytes, e.BytesRecorded);
            try { pcm.Append(e.Buffer.AsSpan(0, e.BytesRecorded)); }
            catch (Exception ex) { error = ex.Message; onError(error); }
        };
        capture.RecordingStopped += (_, e) => { if (e.Exception != null) { error = e.Exception.Message; onError(error); } };
        capture.StartRecording();
        cancel = new CancellationTokenSource(); var token = cancel.Token;
        worker = Task.Run(async () => {
            try {
                using var encoder = OpusCodecFactory.CreateEncoder(48000, 2, OpusApplication.OPUS_APPLICATION_AUDIO);
                encoder.Bitrate = 256000; encoder.UseVBR = true; encoder.Complexity = 5;
                encoder.UseInbandFEC = true; encoder.PacketLossPercent = 5;
                var samples = new short[960 * 2]; var encoded = new byte[4096];
                long next = RtpViewer.NowUs;
                while (!token.IsCancellationRequested) {
                    long waitUs = next - RtpViewer.NowUs;
                    if (waitUs > 1000) { await Task.Delay((int)Math.Max(1, waitUs / 1000), token); continue; }
                    if (RtpViewer.NowUs - next > 100_000) next = RtpViewer.NowUs;
                    pcm.Read20ms(samples);
                    bool silent = samples.All(x => x == 0);
                    int length = encoder.Encode(samples, 960, encoded, encoded.Length);
                    output(encoded.AsSpan(0, length).ToArray(), next);
                    Interlocked.Increment(ref encodedPackets); if (silent) Interlocked.Increment(ref silencePackets);
                    next += 20_000;
                }
            } catch (OperationCanceledException) { }
            catch (Exception e) { error = e.Message; onError(error); }
        });
    }
    internal object Snapshot() { return new { format = "WASAPI loopback 48000Hz S16 stereo → Opus 256kbps", capturedBytes, encodedPackets, silencePackets, overflowBytes = pcm.OverflowBytes, underrunPackets = pcm.UnderrunPackets, bufferedMilliseconds = pcm.BufferedMilliseconds, lastError = error }; }
    public void Dispose() { cancel?.Cancel(); capture?.StopRecording(); capture?.Dispose(); capture = null; }
}
