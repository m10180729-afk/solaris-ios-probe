using System.Diagnostics;
using SolarisNativeHost;

static void Check(bool condition, string message) { if (!condition) throw new Exception(message); Console.WriteLine("PASS: " + message); }
var options = new NativeCaptureOptions(60, 12, 18);
var candidates = NativeH264Capture.EncoderCandidates(options).ToArray();
Check(candidates.Length == 5 && candidates.Take(4).All(c => !c.Arguments.Contains("libx264")), "Hardware remains first with a CPU compatibility fallback");
var cpu = candidates.Last();
Check(cpu.Arguments.Contains("-c:v libx264") && cpu.Arguments.Contains("-preset ultrafast -tune zerolatency"), "CPU fallback uses bounded low-latency H264");
Check(cpu.Arguments.Contains("-r 60") && cpu.Arguments.Contains("1920:1080") && cpu.Arguments.Contains("format=yuv420p"), "Fallback preserves 1080p60 target with a supported CPU pixel format");
Check(cpu.Arguments.Contains("-bf 0") && cpu.Arguments.Contains("repeat-headers=1") && cpu.Arguments.Contains("aud=1"), "Fallback emits receiver-compatible parameter sets and access-unit delimiters");
Check(NativeH264Capture.OrderEncoders(candidates, cpu.Name).First().Name == cpu.Name, "An already-working CPU encoder does not repeatedly probe unsupported GPUs");
var reason = NativeH264Capture.LastUsefulLine("Cannot load nvcuda.dll\nNothing was written into output file\nConversion failed!");
Check(reason.Contains("nvcuda"), "Diagnostics retain the actual hardware error instead of the empty-output summary");
var emitted=new List<(byte[] Bytes,bool Key)>();var parameterParser=new AnnexBAccessUnitParser((b,k)=>emitted.Add((b,k)));
parameterParser.Append(new byte[]{0,0,0,1,0x67,0x42,0,0,0,1,0x68,0x01,0,0,0,1,0x09,0x10,0,0,0,1,0x65,0x11,0,0,0,1,0x09,0x10,0,0,0,1,0x41,0x22});parameterParser.Complete();
Check(emitted.Count==2 && emitted[0].Key && emitted[0].Bytes.Contains((byte)0x67),"Leading SPS/PPS is retained for IDR but never emitted as a phantom video frame");
if (args.Length > 0) {
    var command = cpu.Arguments.Replace("-f gdigrab -draw_mouse 1 -framerate 60 -i desktop", "-f lavfi -i testsrc2=size=1280x720:rate=60 -frames:v 8");
    using var p = Process.Start(new ProcessStartInfo(args[0], command) { UseShellExecute=false, CreateNoWindow=true, RedirectStandardOutput=true, RedirectStandardError=true })!;
    using var output = new MemoryStream();
    var reading = p.StandardOutput.BaseStream.CopyToAsync(output); var errors = p.StandardError.ReadToEndAsync();
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
    try { await p.WaitForExitAsync(timeout.Token); } catch { p.Kill(true); throw; }
    await reading; var stderr = await errors;
    Check(p.ExitCode == 0, "Real bundled FFmpeg software encode succeeds: " + (p.ExitCode == 0 ? "H264" : stderr));
    var frames=0;var keys=0;var parser=new AnnexBAccessUnitParser((bytes,key)=>{frames++;if(key)keys++;});
    parser.Append(output.ToArray());parser.Complete();Check(frames==8 && keys>0,$"Actual encoded H264 parses into eight access units including IDR (frames={frames}, keys={keys})");
    var encodedBytes=output.ToArray();var splitFrames=0;var splitKeys=0;var split=new AnnexBAccessUnitParser((b,k)=>{splitFrames++;if(k)splitKeys++;});
    split.Append(encodedBytes.AsSpan(0,2));split.Append(encodedBytes.AsSpan(2,3));
    for(var offset=5;offset<encodedBytes.Length;offset+=4093)split.Append(encodedBytes.AsSpan(offset,Math.Min(4093,encodedBytes.Length-offset)));
    split.Complete();Check(splitFrames==frames && splitKeys==keys,"Pipe chunk and split-start-code boundaries preserve the same real video frames");
}
