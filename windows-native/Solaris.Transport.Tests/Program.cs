using System.Net;
using System.Text;
using System.Text.Json;
using System.Diagnostics;
using Concentus;
using Concentus.Enums;
using SIPSorcery.Net;
using Solaris.Transport;
using SolarisNativeHost;

static void Check(bool value, string message) { if (!value) throw new Exception(message); Console.WriteLine("PASS " + message); }
SchedulingTests.Run(Check);
await SchedulingTests.CheckRealTimer(Check);
var bytes = new List<byte>();
bytes.AddRange(new byte[] {0,0,0,1,0x67,0x42,0xe0,0x2a,0,0,1,0x68,0x44,0,0,1,0x65});
bytes.AddRange(Enumerable.Repeat((byte)0x55, 8000));
var packets = H264Packets.Split(bytes.ToArray());
Check(packets.All(p => p.Length <= 1150), "RTP payload MTU bound");
Check(packets[0][0] == 0x67 && packets[1][0] == 0x68, "SPS/PPS retained before IDR");
Check((packets[2][1] & 0x80) != 0 && (packets[^1][1] & 0x40) != 0, "FU-A start and end flags");
Check(packets.Skip(2).Sum(p=>p.Length-2) == 8000, "FU-A preserves all NAL bytes");
Check(H264Packets.Split(new byte[]{0,0,1,9,0x10}).Count == 0, "AUD omitted from RTP");
var units = new List<(byte[] Data,bool Key)>();var parser = new AnnexBAccessUnitParser((d,k)=>units.Add((d,k)));
byte[] stream = [0,0,0,1,9,0x10,0,0,1,0x65,0x11,0x22,0,0,0,1,9,0x10,0,0,1,0x41,0x33];
foreach (byte b in stream) parser.Append(new byte[]{b});parser.Complete();
Check(units.Count==2&&units[0].Key&&!units[1].Key,"pipe boundary splits preserve access units");
var lateUnits=new List<byte[]>();var lateParser=new AnnexBAccessUnitParser((d,k)=>{if(k)lateUnits.Add(d);});
lateParser.Append(new byte[]{0,0,1,9,0x10,0,0,1,0x67,0x42,0xe0,0x2a,0,0,1,0x68,0x44,0,0,1,0x65,0x11,0,0,1,9,0x10,0,0,1,0x65,0x22});lateParser.Complete();
Check(lateUnits.Count==2&&H264Packets.Split(lateUnits[1]).Take(2).Select(p=>p[0]&31).SequenceEqual(new[]{7,8}),"late viewer IDR carries cached SPS/PPS");
var ring = new StereoPcmBuffer(); var audioFrame = new short[1920];
byte[] stereo = Enumerable.Range(0,960).SelectMany(_=>new byte[]{0x34,0x12,0x78,0x56}).ToArray();
ring.Append(stereo.AsSpan(0,1920));Check(!ring.Read20ms(audioFrame),"partial PCM is retained without partial packet consumption");
ring.Append(stereo.AsSpan(1920));ring.Append(stereo);
Check(ring.Read20ms(audioFrame)&&audioFrame[0]==0x1234&&audioFrame[1]==0x5678&&audioFrame[^2]==0x1234,"stereo sample order and full packet preserved");
Check(ring.Read20ms(audioFrame)&&!ring.Read20ms(audioFrame)&&ring.UnderrunPackets==1,"audio underrun re-primes instead of splicing partial PCM");
for(int i=0;i<12;i++)ring.Append(stereo);
Check(ring.BufferedMilliseconds<=200&&ring.OverflowBytes%4==0,"audio buffer bounded with stereo alignment");
if (args.Contains("--unit-only")) return;
using(var probe = new RtpViewer(Guid.NewGuid().ToString(),true,useStun:false)) {
    var offer=await probe.CreateOffer();
    Check(offer.Contains("m=video")&&offer.Contains("H264/90000")&&offer.Contains("opus/48000/2"),"native SDP contains H264 and stereo Opus tracks");
    Check(!offer.Contains("m=application"),"native video does not use SCTP data channel");
    Check(offer.Contains("a=rtcp-fb:96 nack"),"RTP NACK and PLI advertised");
}
if (!args.Contains("--serve")) return;
var path=args[Array.IndexOf(args,"--serve")+1];
var accessUnits=new List<VideoUnit>();var fixtureParser=new AnnexBAccessUnitParser((d,k)=>accessUnits.Add(new(d,k,0)));
fixtureParser.Append(File.ReadAllBytes(path));fixtureParser.Complete();
// Valid unregistered-user-data SEI exercises large IDR wire size without
// changing picture content or depending on a particular hardware encoder.
if (args.Contains("--large-idr")) {
    accessUnits = accessUnits.Select(u => {
        if (!u.Key || u.Data.Length >= 420000) return u;
        int length = Math.Max(16, 420000 - u.Data.Length);
        var sei = new List<byte> {0,0,0,1,6,5};
        for (int remain=length; remain>=255; remain-=255) sei.Add(255);
        sei.Add((byte)(length%255));
        sei.AddRange(Enumerable.Repeat((byte)0xab, length)); sei.Add(0x80);
        sei.AddRange(u.Data);
        return u with {Data=sei.ToArray()};
    }).ToList();
}
Console.WriteLine($"Fixture frames={accessUnits.Count} maxIDR={accessUnits.Where(u=>u.Key).Max(u=>u.Data.Length)}");
var peers=new Dictionary<string,RtpViewer>();var gate=new object();
using var server=new HttpListener();server.Prefixes.Add("http://127.0.0.1:18950/");server.Start();
using var tokenSource=new CancellationTokenSource();
var pump=Task.Run(async()=>{
    using var encoder=OpusCodecFactory.CreateEncoder(48000,2,OpusApplication.OPUS_APPLICATION_AUDIO);encoder.Bitrate=128000;
    var pcm=new short[1920];var outAudio=new byte[4096];long audioIndex=0,frameIndex=0;long began=RtpViewer.NowUs;
    while(!tokenSource.IsCancellationRequested){
        long now=RtpViewer.NowUs;
        if(now-began>=frameIndex*1_000_000/60){
            var source=accessUnits[(int)(frameIndex%accessUnits.Count)];var unit=source with{TimestampUs=began+frameIndex*1_000_000/60};
            lock(gate)foreach(var p in peers.Values)p.Enqueue(unit);frameIndex++;
        }
        if(now-began>=audioIndex*20_000){
            for(int i=0;i<960;i++){pcm[2*i]=(short)(Math.Sin((audioIndex*960+i)*2*Math.PI*440/48000)*4000);pcm[2*i+1]=(short)(Math.Sin((audioIndex*960+i)*2*Math.PI*660/48000)*4000);}
            int len=encoder.Encode(pcm,960,outAudio,outAudio.Length);var chunk=outAudio.AsSpan(0,len).ToArray();
            lock(gate)foreach(var p in peers.Values)p.SendAudio(chunk,now);audioIndex++;
        }
        await Task.Delay(1);
    }
});
Console.WriteLine("RTP_TEST_READY");
while(true){
    var ctx=await server.GetContextAsync();string route=ctx.Request.Url!.AbsolutePath;string id=ctx.Request.QueryString["id"]??"a";object result=new{};
    try {
        if(route=="/offer"){
            RtpViewer peer;lock(gate){if(peers.Remove(id,out var old))old.Dispose();peer=new RtpViewer(Guid.NewGuid().ToString(),true,useStun:false);peers[id]=peer;}
            result=new{type="offer",sdp=await peer.CreateOffer(),connectionID=peer.ConnectionID};
        }else if(route=="/answer"){
            using var reader=new StreamReader(ctx.Request.InputStream);using var json=JsonDocument.Parse(await reader.ReadToEndAsync());
            peers[id].Answer(json.RootElement.GetProperty("sdp").GetString()!);
        }else if(route=="/ice"){
            using var reader=new StreamReader(ctx.Request.InputStream);using var json=JsonDocument.Parse(await reader.ReadToEndAsync());
            var body=json.RootElement;
            peers[id].Ice(new RTCIceCandidateInit{candidate=body.GetProperty("candidate").GetString(),sdpMid=body.GetProperty("sdpMid").GetString(),sdpMLineIndex=body.GetProperty("sdpMLineIndex").GetUInt16()});
        }else if(route=="/stats"){lock(gate)result=peers.ToDictionary(x=>x.Key,x=>x.Value.Snapshot());}
        else if(route=="/close"){lock(gate)if(peers.Remove(id,out var peer))peer.Dispose();}
        else if(route=="/done"){ctx.Response.Close();break;}
        else {ctx.Response.ContentType="text/html";var page=Encoding.UTF8.GetBytes("<!doctype html><video autoplay muted playsinline></video>");ctx.Response.OutputStream.Write(page);ctx.Response.Close();continue;}
        ctx.Response.ContentType="application/json";var payload=JsonSerializer.SerializeToUtf8Bytes(result);await ctx.Response.OutputStream.WriteAsync(payload);ctx.Response.Close();
    }catch(Exception e){ctx.Response.StatusCode=500;await ctx.Response.OutputStream.WriteAsync(Encoding.UTF8.GetBytes(e.ToString()));ctx.Response.Close();}
}
tokenSource.Cancel();lock(gate)foreach(var peer in peers.Values)peer.Dispose();await pump;
