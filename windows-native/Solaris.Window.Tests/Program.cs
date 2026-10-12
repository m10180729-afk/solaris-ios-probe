using SolarisNativeHost;
using System.Text.Json;

internal static class Program
{
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }

    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        using var form = new Form { FormBorderStyle = FormBorderStyle.Sizable, Bounds = new Rectangle(40, 50, 900, 650) };
        var events = new List<object>();
        var window = new WindowController(form, events.Add);
        var ordinary = form.Bounds;
        window.SetFullscreen(false); window.SetFullscreen(false);
        Check(form.FormBorderStyle == FormBorderStyle.Sizable && form.Bounds == ordinary, "Viewer cleanup stripped the ordinary title bar or resize border");
        Console.WriteLine("PASS: repeated fullscreen cleanup preserves the ordinary resize/title bar");

        window.SetFullscreen(true); window.SetFullscreen(true);
        Check(window.IsFullscreen && form.FormBorderStyle == FormBorderStyle.None, "Fullscreen did not enter");
        window.SetFullscreen(false); window.SetFullscreen(false);
        Check(!window.IsFullscreen && form.FormBorderStyle == FormBorderStyle.Sizable && form.WindowState == FormWindowState.Normal && form.Bounds == ordinary, "Repeated entry overwrote the original window bounds/state");
        Console.WriteLine("PASS: repeated fullscreen entry restores original bounds and window state");

        window.ToggleMaximize(); Check(form.WindowState == FormWindowState.Maximized, "Maximize failed");
        window.SetFullscreen(true); window.SetFullscreen(false);
        Check(form.WindowState == FormWindowState.Maximized && form.FormBorderStyle == FormBorderStyle.Sizable, "Fullscreen forgot an already maximized window");
        window.ToggleMaximize(); Check(form.WindowState == FormWindowState.Normal, "Restore failed");
        Console.WriteLine("PASS: maximize/restore and maximized fullscreen restoration");

        window.SetFullscreen(true); window.Minimize();
        Check(form.WindowState == FormWindowState.Minimized && !window.IsFullscreen && form.FormBorderStyle == FormBorderStyle.Sizable, "Minimize left a borderless fullscreen window");
        using var snapshot = JsonDocument.Parse(JsonSerializer.Serialize(window.Snapshot()));
        Check(snapshot.RootElement.GetProperty("state").GetString() == "minimized" && !snapshot.RootElement.GetProperty("fullscreen").GetBoolean(), "Window bridge state is incorrect");
        Check(events.Count > 0, "No window state notifications");
        Console.WriteLine("PASS: minimize exits fullscreen and reports native state");
        Console.WriteLine("PASS: 4 real WinForms window state regressions; no media capture or interactive UI test.");
    }
}
