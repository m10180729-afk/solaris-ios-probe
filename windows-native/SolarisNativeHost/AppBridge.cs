using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace SolarisNativeHost;

internal sealed class AppBridge
{
    private sealed record Entry(string Path, string Name, long Size, long Modified, bool Source, string? Destination);
    private readonly string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Solaris");
    private readonly Form form;
    private readonly Build54RtpAdapter media;
    private readonly Action<string> notify;
    private readonly AuthBrowser auth;
    private readonly SemaphoreSlim diskGate = new(1);
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private Dictionary<string, Entry> entries = new();
    private FormWindowState savedState;
    private FormBorderStyle savedBorder;

    internal AppBridge(Form form, Build54RtpAdapter media, Action<string> notify, Action<object> emit)
    {
        this.form = form; this.media = media; this.notify = notify;
        auth = new AuthBrowser(emit); form.FormClosed += (_, _) => auth.Dispose();
        Directory.CreateDirectory(root);
        try { entries = JsonSerializer.Deserialize<Dictionary<string, Entry>>(File.ReadAllText(Path.Combine(root, "files.json"))) ?? new(); } catch (IOException) { } catch (JsonException) { }
    }
    private void SaveEntries()
    {
        var path = Path.Combine(root, "files.json");
        File.WriteAllText(path + ".tmp", JsonSerializer.Serialize(entries)); File.Move(path + ".tmp", path, true);
    }
    private Entry Get(string id) => Guid.TryParse(id, out _) && entries.TryGetValue(id, out var e) ? e : throw new IOException("파일을 다시 선택하세요.");
    private static string Name(string value)
    {
        value = new string(value.Select(c => Path.GetInvalidFileNameChars().Contains(c) || char.IsControl(c) ? '_' : c).ToArray()).Trim('.', ' ');
        if (value.Length > 160) value = value[..160];
        if (string.IsNullOrWhiteSpace(value) || new[] { "CON", "PRN", "AUX", "NUL", "COM1", "LPT1" }.Contains(Path.GetFileNameWithoutExtension(value).ToUpperInvariant())) value = "download_" + value;
        return value;
    }
    internal async Task<object?> Command(string command, JsonElement a)
    {
        string S(string name) => a.TryGetProperty(name, out var v) ? v.GetString() ?? "" : "";
        if (command == "platform") return new { platform = "windows", version = Program.Version };
        if (command == "mediaStatus") return media.Snapshot();
        if (command == "authListen") { auth.Listen(S("redirectTo")); return true; }
        if (command == "authOpen") { auth.Open(S("url")); return true; }
        if (command == "authTake") return auth.Take();
        if (command == "authCancel") { auth.Cancel(); return true; }
        if (command is "vaultGet" or "vaultSet")
        {
            var key = S("key"); if (key is not ("session" or "turn" or "auth-flow")) throw new IOException("Invalid vault key");
            var path = Path.Combine(root, key + ".protected");
            if (command == "vaultGet") return File.Exists(path) ? Encoding.UTF8.GetString(ProtectedData.Unprotect(await File.ReadAllBytesAsync(path), null, DataProtectionScope.CurrentUser)) : null;
            var value = S("value"); if (value.Length > 65536) throw new IOException("Vault value too large");
            await File.WriteAllBytesAsync(path + ".tmp", ProtectedData.Protect(Encoding.UTF8.GetBytes(value), null, DataProtectionScope.CurrentUser)); File.Move(path + ".tmp", path, true); return true;
        }
        if (command == "pickFile")
        {
            using var dialog = new OpenFileDialog { Title = "전송할 원본 파일", CheckFileExists = true, Multiselect = false, Filter = "모든 파일|*.*" };
            if (dialog.ShowDialog(form) != DialogResult.OK) return null;
            var f = new FileInfo(dialog.FileName); var id = Guid.NewGuid().ToString();
            entries[id] = new(f.FullName, f.Name, f.Length, new DateTimeOffset(f.LastWriteTimeUtc).ToUnixTimeMilliseconds(), true, null); SaveEntries();
            return new { id, name = f.Name, size = f.Length, modified = entries[id].Modified };
        }
        if (command == "createReceiver")
        {
            var id = S("id"); if (!Guid.TryParse(id, out _)) throw new IOException("Invalid transfer ID");
            var name = Name(S("name")); var size = a.GetProperty("size").GetInt64(); if (size < 0 || size > 100L * 1024 * 1024) throw new IOException("Invalid file size");
            using var dialog = new SaveFileDialog { Title = "받을 파일의 저장 위치", FileName = name, Filter = "모든 파일|*.*", OverwritePrompt = true };
            if (dialog.ShowDialog(form) != DialogResult.OK) throw new IOException("수신을 취소했습니다.");
            var partial = dialog.FileName + "." + id + ".solaris-part";
            using (File.Create(partial)) { }
            entries[id] = new(partial, name, size, 0, false, dialog.FileName); SaveEntries(); return new { id, name };
        }
        if (command is "readFile" or "writeFile" or "hashFile" or "fileInfo" or "finishFile" or "discardFile" or "exportFile")
        {
            await diskGate.WaitAsync();
            try
            {
                var id = S("id"); var e = Get(id);
                if (command == "fileInfo") { if (!File.Exists(e.Path)) return null; var f = new FileInfo(e.Path); return new { size = f.Length, modified = new DateTimeOffset(f.LastWriteTimeUtc).ToUnixTimeMilliseconds() }; }
                if (command == "hashFile") { using var stream = new FileStream(e.Path, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, true); return new { sha256 = Convert.ToHexString(await SHA256.HashDataAsync(stream)).ToLowerInvariant() }; }
                if (command == "readFile")
                {
                    var offset = a.GetProperty("offset").GetInt64(); var length = a.GetProperty("length").GetInt32();
                    if (!e.Source || offset < 0 || length < 0 || length > 32768 || offset > e.Size) throw new IOException("Invalid read");
                    using var f = new FileStream(e.Path, FileMode.Open, FileAccess.Read, FileShare.Read, 32768, true);
                    if (f.Length != e.Size || new DateTimeOffset(File.GetLastWriteTimeUtc(e.Path)).ToUnixTimeMilliseconds() != e.Modified) throw new IOException("원본 파일이 변경되었습니다.");
                    f.Position = offset; var bytes = new byte[(int)Math.Min(length, e.Size - offset)]; await f.ReadExactlyAsync(bytes); return new { data = Convert.ToBase64String(bytes) };
                }
                if (command == "writeFile")
                {
                    var bytes = Convert.FromBase64String(S("data")); var offset = a.GetProperty("offset").GetInt64();
                    if (e.Source || bytes.Length > 32768 || offset < 0 || offset + bytes.Length > e.Size) throw new IOException("Invalid write");
                    using var f = new FileStream(e.Path, FileMode.Open, FileAccess.Write, FileShare.Read, 32768, true);
                    if (offset > f.Length) throw new IOException("Noncontiguous write"); f.Position = offset; await f.WriteAsync(bytes); await f.FlushAsync(); return true;
                }
                if (command == "finishFile")
                {
                    if (e.Source || a.GetProperty("size").GetInt64() != e.Size || new FileInfo(e.Path).Length != e.Size) throw new IOException("Incomplete file");
                    if (string.Equals(e.Path, e.Destination, StringComparison.OrdinalIgnoreCase)) return new { id, name = e.Name };
                    File.Move(e.Path, e.Destination!, true); entries[id] = e with { Path = e.Destination! }; SaveEntries(); return new { id, name = e.Name };
                }
                if (command == "discardFile") { if (!e.Source && e.Path.EndsWith(".solaris-part", StringComparison.Ordinal)) File.Delete(e.Path); entries.Remove(id); SaveEntries(); return true; }
                // Reveal the directory; received files are never launched.
                Process.Start(new ProcessStartInfo("explorer.exe", "/select,\"" + e.Path + "\"") { UseShellExecute = true }); return true;
            }
            finally { diskGate.Release(); }
        }
        if (command == "fullscreen")
        {
            var enabled = a.GetProperty("enabled").GetBoolean();
            if (enabled) { savedState = form.WindowState; savedBorder = form.FormBorderStyle; form.FormBorderStyle = FormBorderStyle.None; form.WindowState = FormWindowState.Maximized; }
            else { form.FormBorderStyle = savedBorder; form.WindowState = savedState; } return true;
        }
        if (command == "notify") { notify(S("title") + " · " + S("body")); return true; }
        if (command == "diagnostics") { using var p = Process.GetCurrentProcess(); return new { platform = "windows", os = Environment.OSVersion.VersionString, version = Program.Version, memoryBytes = p.WorkingSet64, cpuSeconds = p.TotalProcessorTime.TotalSeconds, uptimeSeconds = clock.Elapsed.TotalSeconds }; }
        if (command == "exportLog") { using var d = new SaveFileDialog { FileName = "Solaris-diagnostics.json", Filter = "JSON|*.json" }; if (d.ShowDialog(form) == DialogResult.OK) await File.WriteAllTextAsync(d.FileName, S("text")); return true; }
        if (command == "openExternal") { var url = S("url"); if (!url.StartsWith("https://github.com/m10180729-afk/solaris-ios-probe/releases/", StringComparison.Ordinal)) throw new IOException("Invalid update URL"); Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); return true; }
        if (command.StartsWith("media", StringComparison.Ordinal))
        {
            var map = new Dictionary<string, object?> { ["session"] = S("id"), ["viewerID"] = S("viewerID"), ["connectionID"] = S("connectionID") };
            map["type"] = command switch { "mediaStart" => "rtp-start", "mediaStop" => "rtp-stop", "mediaJoin" => "rtp-join", "mediaRecover" => "rtp-recover", "mediaAnswer" => "rtp-answer", "mediaIce" => "rtp-ice", "mediaLeave" => "rtp-leave", "mediaHeartbeat" => "rtp-heartbeat", "mediaQuality" => "rtp-quality", _ => throw new IOException("Unknown media command") };
            foreach (var p in a.EnumerateObject()) map[p.Name] = p.Value.Clone();
            if (command == "mediaStart") map["audio"] = true; // System playback only, never microphone.
            using var json = JsonDocument.Parse(JsonSerializer.Serialize(map)); await media.Command(json.RootElement); return true;
        }
        throw new IOException("Unknown Solaris command");
    }
}
