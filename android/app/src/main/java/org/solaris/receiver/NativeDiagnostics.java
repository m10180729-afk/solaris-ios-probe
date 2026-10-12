package org.solaris.receiver;
import android.content.Context;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;

/** Small local history; never records SDP, candidates or credentials. */
final class NativeDiagnostics {
    private static final Object LOCK = new Object();
    private final File path;
    NativeDiagnostics(Context context) { this(context.getFilesDir()); }
    NativeDiagnostics(File directory) { path = new File(directory, "screen-errors.json"); }
    void record(String stage, Exception error) { synchronized (LOCK) {
        try {
            JSONArray old = read(), next = new JSONArray();
            for (int i = Math.max(0, old.length() - 15); i < old.length(); i++) next.put(old.get(i));
            String message = String.valueOf(error.getMessage()).replaceAll("(?i)Bearer\\s+\\S+|eyJ[A-Za-z0-9_.-]+|sb_(?:secret|publishable)_[A-Za-z0-9_-]+", "[redacted]");
            next.put(new JSONObject().put("at", System.currentTimeMillis()).put("stage", stage).put("error", error.getClass().getSimpleName()).put("message", message.substring(0, Math.min(700, message.length()))));
            File temporary = new File(path + ".tmp");
            try (FileOutputStream out = new FileOutputStream(temporary)) { out.write(next.toString().getBytes(StandardCharsets.UTF_8)); }
            try { Files.move(temporary.toPath(),path.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE); }
            catch (AtomicMoveNotSupportedException ignored) { Files.move(temporary.toPath(),path.toPath(),StandardCopyOption.REPLACE_EXISTING); }
        } catch (Exception ignored) { }
    }
    }
    JSONArray read() { synchronized (LOCK) {
        try (FileInputStream in = new FileInputStream(path)) { byte[] buffer = new byte[32768]; int total=0, count; while(total<buffer.length && (count=in.read(buffer,total,buffer.length-total))>0) total+=count; return new JSONArray(new String(buffer,0,total,StandardCharsets.UTF_8)); }
        catch (Exception ignored) { return new JSONArray(); }
    }
    }
}
