using System.Reflection;

namespace SolarisNativeHost;

internal static class Program
{
    internal const string Version = "0.3.2 build46";

    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Contains("--self-test", StringComparer.OrdinalIgnoreCase))
        {
            Environment.Exit(SelfTest.Run());
            return;
        }
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}

internal static class SolarisContent
{
    internal const string FileName = "solaris-desktop.html";

    internal static string PrepareWebRoot()
    {
        var root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Solaris", "build46", "www");
        Directory.CreateDirectory(root);
        var output = Path.Combine(root, FileName);
        using var source = OpenEmbeddedPage();
        using var memory = new MemoryStream();
        source.CopyTo(memory);
        var bytes = memory.ToArray();
        if (!File.Exists(output) || !File.ReadAllBytes(output).SequenceEqual(bytes))
            File.WriteAllBytes(output, bytes);
        return root;
    }

    internal static Stream OpenEmbeddedPage()
    {
        var assembly = Assembly.GetExecutingAssembly();
        var name = assembly.GetManifestResourceNames()
            .SingleOrDefault(value => value.EndsWith(FileName, StringComparison.OrdinalIgnoreCase));
        return name is null
            ? throw new InvalidOperationException("Solaris 화면공유 페이지가 실행 파일에 포함되지 않았습니다.")
            : assembly.GetManifestResourceStream(name)
                ?? throw new InvalidOperationException("Solaris 화면공유 페이지를 열 수 없습니다.");
    }
}

internal static class SelfTest
{
    internal static int Run()
    {
        try
        {
            using var page = SolarisContent.OpenEmbeddedPage();
            using var reader = new StreamReader(page);
            var html = reader.ReadToEnd();
            var parsed = new List<(byte[] Data, bool Key)>();
            var parser = new AnnexBAccessUnitParser((data, key) => parsed.Add((data, key)));
            parser.Append(new byte[]
            {
                0,0,0,1,0x09,0x10, 0,0,0,1,0x67,0x42,0,0x2a, 0,0,0,1,0x65,1,2,3,
                0,0,0,1,0x09,0x10, 0,0,0,1,0x41,4,5,6
            });
            parser.Complete();
            var lowRate = NativeH264Capture.EncoderCandidates(new NativeCaptureOptions(60, 4, 6)).First().Arguments;
            var valid = Program.Version.Contains("build46", StringComparison.Ordinal) &&
                        html.Contains("BUILD_NUMBER='46'", StringComparison.Ordinal) &&
                        html.Contains("webcodecs-h264", StringComparison.Ordinal) &&
                        html.Contains("native-start", StringComparison.Ordinal) &&
                        parsed.Count == 2 && parsed[0].Key && !parsed[1].Key &&
                        lowRate.Contains("-b:v 4M -maxrate 6M", StringComparison.Ordinal) &&
                        !html.Contains("solaris-native://", StringComparison.OrdinalIgnoreCase) &&
                        !html.Contains("ClassicOldSong", StringComparison.OrdinalIgnoreCase);
            Console.WriteLine(valid
                ? "PASS: Solaris build46 native hardware sender self-test"
                : "FAIL: embedded sender/version check");
            return valid ? 0 : 1;
        }
        catch (Exception error)
        {
            Console.WriteLine("FAIL: " + error.Message);
            return 1;
        }
    }
}
