using System.Reflection;

namespace SolarisNativeHost;

internal static class Program
{
    internal const string Version = "0.3.2 build41";

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
            "Solaris", "build41", "www");
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
            var valid = Program.Version.Contains("build41", StringComparison.Ordinal) &&
                        html.Contains("BUILD_NUMBER='41'", StringComparison.Ordinal) &&
                        html.Contains("webcodecs-h264", StringComparison.Ordinal) &&
                        !html.Contains("solaris-native://", StringComparison.OrdinalIgnoreCase) &&
                        !html.Contains("ClassicOldSong", StringComparison.OrdinalIgnoreCase);
            Console.WriteLine(valid
                ? "PASS: Solaris build41 integrated sender self-test"
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
