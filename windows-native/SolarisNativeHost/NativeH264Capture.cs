using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace SolarisNativeHost;

internal sealed record NativeCaptureOptions(int FramesPerSecond, int StartMbps, int MaxMbps);

internal sealed class NativeH264Capture : IDisposable
{
    private readonly Action<byte[], bool, long, string> onFrame;
    private readonly Action<string, string, string?> onStatus;
    private CancellationTokenSource? cancellation;
    private Process? process;
    private int generation;

    internal NativeH264Capture(
        Action<byte[], bool, long, string> onFrame,
        Action<string, string, string?> onStatus)
    {
        this.onFrame = onFrame;
        this.onStatus = onStatus;
    }

    internal bool IsRunning => process is { HasExited: false };

    internal async Task StartAsync(NativeCaptureOptions options)
    {
        Stop();
        var ffmpeg = Path.Combine(AppContext.BaseDirectory, "ffmpeg.exe");
        if (!File.Exists(ffmpeg))
            throw new FileNotFoundException(
                "Solaris Windows 패키지의 ffmpeg.exe가 없습니다. GitHub Actions의 Windows Sender ZIP을 압축 해제한 폴더에서 실행하세요.",
                ffmpeg);

        var localGeneration = Interlocked.Increment(ref generation);
        cancellation = new CancellationTokenSource();
        var token = cancellation.Token;
        var failures = new List<string>();

        foreach (var encoder in EncoderCandidates(options))
        {
            token.ThrowIfCancellationRequested();
            onStatus("probing", $"{encoder.Name} 하드웨어 인코더 확인 중", encoder.Name);
            var firstFrame = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var startInfo = new ProcessStartInfo
            {
                FileName = ffmpeg,
                Arguments = encoder.Arguments,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                StandardOutputEncoding = null,
                StandardErrorEncoding = Encoding.UTF8
            };
            var candidate = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
            var selected = false;
            var stderr = new StringBuilder();
            candidate.ErrorDataReceived += (_, e) =>
            {
                if (!string.IsNullOrWhiteSpace(e.Data))
                {
                    if (stderr.Length > 4000) stderr.Remove(0, Math.Min(2000, stderr.Length));
                    stderr.AppendLine(e.Data);
                }
            };

            try
            {
                if (!candidate.Start()) throw new InvalidOperationException("FFmpeg 프로세스를 시작하지 못했습니다.");
                candidate.BeginErrorReadLine();
                process = candidate;
                var reader = ReadFramesAsync(candidate, encoder.Name, firstFrame, localGeneration, token);
                var winner = await Task.WhenAny(firstFrame.Task, candidate.WaitForExitAsync(token), Task.Delay(8000, token));
                if (winner == firstFrame.Task && firstFrame.Task.Result && !candidate.HasExited)
                {
                    selected = true;
                    onStatus("running", $"{encoder.Name} · 1920×1080 · {options.FramesPerSecond}fps 요청", encoder.Name);
                    _ = reader.ContinueWith(t =>
                    {
                        if (t.IsFaulted && generation == localGeneration && !token.IsCancellationRequested)
                            onStatus("error", "네이티브 영상 읽기 실패", t.Exception?.GetBaseException().Message);
                    }, TaskScheduler.Default);
                    return;
                }
                failures.Add($"{encoder.Name}: {LastUsefulLine(stderr.ToString())}");
                StopProcess(candidate);
                try { await reader.WaitAsync(TimeSpan.FromSeconds(2)); } catch { }
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested)
            {
                StopProcess(candidate);
                throw;
            }
            catch (Exception error)
            {
                failures.Add($"{encoder.Name}: {error.Message}");
                StopProcess(candidate);
            }
            finally
            {
                if (!selected)
                {
                    if (ReferenceEquals(process, candidate)) process = null;
                    candidate.Dispose();
                }
            }
        }

        var detail = string.Join(" | ", failures.Where(value => !string.IsNullOrWhiteSpace(value)));
        throw new InvalidOperationException(
            "이 PC에서 사용할 수 있는 H.264 하드웨어 인코더를 찾지 못했습니다." +
            (detail.Length > 0 ? "\n" + detail : ""));
    }

    internal void Stop()
    {
        Interlocked.Increment(ref generation);
        cancellation?.Cancel();
        cancellation?.Dispose();
        cancellation = null;
        var current = process;
        process = null;
        if (current is not null)
        {
            StopProcess(current);
            current.Dispose();
        }
    }

    private async Task ReadFramesAsync(
        Process source,
        string encoder,
        TaskCompletionSource<bool> firstFrame,
        int localGeneration,
        CancellationToken token)
    {
        var fpsWindowStart = Stopwatch.GetTimestamp();
        var fpsWindowFrames = 0;
        long emittedFrames = 0;
        var parser = new AnnexBAccessUnitParser((bytes, keyFrame) =>
        {
            if (generation != localGeneration || token.IsCancellationRequested) return;
            firstFrame.TrySetResult(true);
            emittedFrames++;
            fpsWindowFrames++;
            var timestampUs = Stopwatch.GetTimestamp() * 1_000_000L / Stopwatch.Frequency;
            onFrame(bytes, keyFrame, timestampUs, encoder);
            var now = Stopwatch.GetTimestamp();
            var elapsed = (now - fpsWindowStart) / (double)Stopwatch.Frequency;
            if (elapsed >= 1)
            {
                var fps = fpsWindowFrames / elapsed;
                onStatus("metrics", $"output {fps:F1}fps · frames {emittedFrames}", encoder);
                fpsWindowStart = now;
                fpsWindowFrames = 0;
            }
        });
        var buffer = new byte[256 * 1024];
        while (!token.IsCancellationRequested)
        {
            var read = await source.StandardOutput.BaseStream.ReadAsync(buffer, token);
            if (read <= 0) break;
            parser.Append(buffer.AsSpan(0, read));
        }
        parser.Complete();
        if (!firstFrame.Task.IsCompleted) firstFrame.TrySetResult(false);
        if (!token.IsCancellationRequested && generation == localGeneration)
            onStatus("stopped", "하드웨어 송신 엔진이 종료되었습니다.", encoder);
    }

    private static IEnumerable<(string Name, string Arguments)> EncoderCandidates(NativeCaptureOptions options)
    {
        var fps = Math.Clamp(options.FramesPerSecond, 30, 120);
        var start = Math.Clamp(options.StartMbps, 8, options.MaxMbps);
        var max = Math.Clamp(options.MaxMbps, start, 100);
        var common = $"-hide_banner -loglevel warning -f gdigrab -draw_mouse 1 -framerate {fps} -i desktop " +
                     "-an -vf \"scale=1920:1080:force_original_aspect_ratio=decrease:flags=fast_bilinear," +
                     "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,format=nv12\" " +
                     $"-profile:v high -level:v 5.1 -b:v {start}M -maxrate {max}M -bufsize {max}M -g {fps} -keyint_min {fps} -force_key_frames \"expr:gte(t,n_forced*1)\" -bf 0 " +
                     "-bsf:v h264_metadata=aud=insert -f h264 pipe:1";
        yield return ("NVIDIA NVENC", $"{common.Replace("-bsf:v", "-c:v h264_nvenc -preset p4 -tune ll -rc vbr -forced-idr 1 -bsf:v")}");
        yield return ("Intel Quick Sync", $"{common.Replace("-bsf:v", "-c:v h264_qsv -preset veryfast -look_ahead 0 -bsf:v")}");
        yield return ("AMD AMF", $"{common.Replace("-bsf:v", "-c:v h264_amf -usage lowlatency_high_quality -quality speed -rc vbr_peak -bsf:v")}");
        yield return ("Windows Media Foundation", $"{common.Replace("-bsf:v", "-c:v h264_mf -hw_encoding 1 -rate_control cbr -bsf:v")}");
    }

    private static string LastUsefulLine(string text)
    {
        var line = text.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
            .LastOrDefault(value => !value.Contains("frame=", StringComparison.OrdinalIgnoreCase));
        return string.IsNullOrWhiteSpace(line) ? "초기 프레임 없음" : line.Trim();
    }

    private static void StopProcess(Process value)
    {
        try { if (!value.HasExited) value.Kill(entireProcessTree: true); } catch { }
    }

    public void Dispose() => Stop();
}

internal sealed class AnnexBAccessUnitParser
{
    private readonly Action<byte[], bool> emit;
    private byte[] pending = Array.Empty<byte>();
    private readonly MemoryStream accessUnit = new();
    private bool keyFrame;

    internal AnnexBAccessUnitParser(Action<byte[], bool> emit) => this.emit = emit;

    internal void Append(ReadOnlySpan<byte> incoming)
    {
        var combined = new byte[pending.Length + incoming.Length];
        pending.CopyTo(combined, 0);
        incoming.CopyTo(combined.AsSpan(pending.Length));
        var starts = FindStartCodes(combined);
        if (starts.Count < 2)
        {
            pending = combined;
            return;
        }
        for (var i = 0; i < starts.Count - 1; i++)
            AcceptNal(combined.AsSpan(starts[i], starts[i + 1] - starts[i]));
        pending = combined[starts[^1]..];
    }

    internal void Complete()
    {
        if (pending.Length > 0) AcceptNal(pending);
        Flush();
        pending = Array.Empty<byte>();
    }

    private void AcceptNal(ReadOnlySpan<byte> nal)
    {
        var prefix = nal.Length >= 4 && nal[0] == 0 && nal[1] == 0 && nal[2] == 0 && nal[3] == 1 ? 4 : 3;
        if (nal.Length <= prefix) return;
        var type = nal[prefix] & 0x1f;
        if (type == 9 && accessUnit.Length > 0) Flush();
        if (type == 5) keyFrame = true;
        accessUnit.Write(nal);
    }

    private void Flush()
    {
        if (accessUnit.Length == 0) return;
        emit(accessUnit.ToArray(), keyFrame);
        accessUnit.SetLength(0);
        keyFrame = false;
    }

    private static List<int> FindStartCodes(ReadOnlySpan<byte> data)
    {
        var result = new List<int>();
        for (var i = 0; i + 3 < data.Length; i++)
        {
            if (data[i] != 0 || data[i + 1] != 0) continue;
            if (data[i + 2] == 1) { result.Add(i); i += 2; }
            else if (i + 3 < data.Length && data[i + 2] == 0 && data[i + 3] == 1) { result.Add(i); i += 3; }
        }
        return result;
    }
}
