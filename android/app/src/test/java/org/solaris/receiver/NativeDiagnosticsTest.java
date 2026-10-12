package org.solaris.receiver;

import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;
import java.nio.file.*;
import java.io.File;
import java.util.*;
import java.util.concurrent.*;

public class NativeDiagnosticsTest {
 @Test public void independentCaptureAndActivityWritersKeepEveryStage()throws Exception{
  Path directory=Files.createTempDirectory("solaris-errors-");
  ExecutorService workers=Executors.newFixedThreadPool(4);
  try{
   List<Future<?>> writes=new ArrayList<>();
   for(int index=0;index<12;index++){
    final String stage="stage-"+index;
    writes.add(workers.submit(()->new NativeDiagnostics(directory.toFile()).record(stage,new Exception("failure"))));
   }
   for(Future<?> write:writes)write.get(5,TimeUnit.SECONDS);
   JSONArray history=new NativeDiagnostics(directory.toFile()).read();
   assertEquals(12,history.length());Set<String> stages=new HashSet<>();
   for(int index=0;index<history.length();index++)stages.add(history.getJSONObject(index).getString("stage"));
   assertEquals(12,stages.size());
  }finally{workers.shutdownNow();for(File file:directory.toFile().listFiles())file.delete();Files.delete(directory);}
 }
 @Test public void diagnosticHistoryIsBoundedAndRedactsCredentials()throws Exception{
  Path directory=Files.createTempDirectory("solaris-errors-");
  try{
   NativeDiagnostics diagnostics=new NativeDiagnostics(directory.toFile());
   for(int index=0;index<20;index++)diagnostics.record("capture",new Exception("Bearer access-fixture eyJfake.token sb_publishable_fixture sb_secret_fixture"));
   JSONArray history=diagnostics.read();assertEquals(16,history.length());
   String result=history.toString();assertFalse(result.contains("access-fixture"));assertFalse(result.contains("eyJfake"));assertFalse(result.contains("sb_publishable_fixture"));assertFalse(result.contains("sb_secret_fixture"));assertTrue(result.contains("[redacted]"));
  }finally{for(File file:directory.toFile().listFiles())file.delete();Files.delete(directory);}
 }
}
