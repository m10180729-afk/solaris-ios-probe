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

        using (var normal = JsonDocument.Parse(JsonSerializer.Serialize(window.Snapshot())))
            Check(normal.RootElement.GetProperty("systemTitlebar").GetBoolean(), "Ordinary Windows chrome must suppress duplicate web titlebar controls");
        form.WindowState = FormWindowState.Normal;
        events.Clear();
        window.SetFullscreen(true);
        using (var full = JsonDocument.Parse(JsonSerializer.Serialize(window.Snapshot())))
            Check(full.RootElement.GetProperty("fullscreen").GetBoolean() && !full.RootElement.GetProperty("systemTitlebar").GetBoolean(), "Fullscreen snapshot still advertises an OS titlebar");
        Check(events.Count == 1, "A chrome transition published intermediate window snapshots");
        events.Clear();
        window.SetFullscreen(false);
        Check(events.Count == 1, "Fullscreen restoration published intermediate window snapshots");
        using (var restored = JsonDocument.Parse(JsonSerializer.Serialize(events[0])))
            Check(!restored.RootElement.GetProperty("fullscreen").GetBoolean() && restored.RootElement.GetProperty("systemTitlebar").GetBoolean(), "Window event chrome disagrees with restored native chrome");
        Console.WriteLine("PASS: native titlebar visibility and atomic fullscreen/restoration events");
        Console.WriteLine("PASS: 5 real WinForms window state regressions; no media capture or interactive UI test.");
    }
}
