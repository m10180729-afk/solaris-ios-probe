namespace SolarisNativeHost;

// Fullscreen can be reset during logout, viewer cleanup, or a WebView event even
// before it was entered. Keep restoration idempotent so those resets never turn
// the ordinary window into a borderless popup.
internal sealed class WindowController
{
    private readonly Form form;
    private readonly Action<object> emit;
    private bool fullscreen;
    private FormWindowState savedState;
    private FormBorderStyle savedBorder;
    private Rectangle savedBounds;

    internal WindowController(Form form, Action<object> emit)
    {
        this.form = form;
        this.emit = emit;
        form.Resize += (_, _) => Publish();
    }

    internal bool IsFullscreen => fullscreen;
    internal object Snapshot() => new
    {
        platform = "windows",
        state = form.WindowState switch
        {
            FormWindowState.Maximized => "maximized",
            FormWindowState.Minimized => "minimized",
            _ => "normal"
        },
        fullscreen
    };

    private void Publish() => emit(new
    {
        type = "window-state",
        platform = "windows",
        state = form.WindowState switch
        {
            FormWindowState.Maximized => "maximized",
            FormWindowState.Minimized => "minimized",
            _ => "normal"
        },
        fullscreen
    });

    internal void SetFullscreen(bool enabled)
    {
        if (enabled == fullscreen) return;
        if (enabled)
        {
            savedState = form.WindowState == FormWindowState.Minimized ? FormWindowState.Normal : form.WindowState;
            savedBorder = form.FormBorderStyle;
            savedBounds = form.WindowState == FormWindowState.Normal ? form.Bounds : form.RestoreBounds;
            fullscreen = true;
            form.WindowState = FormWindowState.Normal;
            form.FormBorderStyle = FormBorderStyle.None;
            form.Bounds = Screen.FromControl(form).Bounds;
            form.WindowState = FormWindowState.Maximized;
        }
        else
        {
            fullscreen = false;
            form.WindowState = FormWindowState.Normal;
            form.FormBorderStyle = savedBorder;
            if (!savedBounds.IsEmpty) form.Bounds = savedBounds;
            form.WindowState = savedState;
        }
        Publish();
    }

    internal void Minimize()
    {
        SetFullscreen(false);
        form.WindowState = FormWindowState.Minimized;
        Publish();
    }

    internal void ToggleMaximize()
    {
        SetFullscreen(false);
        form.WindowState = form.WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
        Publish();
    }
}
