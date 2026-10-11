"""Optional Linux C# compilation gate when MSBuild is unavailable; not a Windows installer build.
Usage: python3 scripts/local_compile_csharp.py DOTNET_ROOT NUGET_EXTRACTED_ROOT
Normal CI uses dotnet build/publish instead. Reference packages must match project pins.
"""
from pathlib import Path
import sys,subprocess,json,shutil
root=Path(__file__).resolve().parents[1];dotnet=Path(sys.argv[1]);packages=Path(sys.argv[2]);out=root/'build/csharp-check';out.mkdir(parents=True,exist_ok=True)
framework=list((dotnet/'packs/Microsoft.NETCore.App.Ref').glob('*/ref/net8.0'))[-1]
refs=list(framework.glob('*.dll'))
for p in packages.iterdir():
    lib=p/'lib'
    if p.name.startswith('microsoft.web.webview2'):
        refs+=list((lib/'net462').glob('*.dll'));continue
    for name in ('net8.0','net7.0','net6.0','net5.0','netstandard2.1','netstandard2.0','netcoreapp3.1','netcoreapp3.0','net472','net462','net461'):
        if (lib/name).is_dir():refs+=list((lib/name).glob('*.dll'));break
unique={}
for r in reversed(refs):unique[r.name]=r
refs=list(unique.values())
compiler=list((dotnet/'sdk').glob('*/Roslyn/bincore/csc.dll'))[-1]
implicit=out/'Implicit.cs';implicit.write_text('global using System;global using System.Collections.Generic;global using System.Linq;global using System.Threading;global using System.Threading.Tasks;global using System.IO;global using System.Net.Http;')
def compile(name,sources,references,extra=()):
    rsp=out/(name+'.rsp');rsp.write_text('\n'.join(['-nologo','-nullable:enable','-langversion:12','-target:library','-out:'+str(out/(name+'.dll'))]+['-r:'+str(r) for r in references]+[str(implicit)]+[str(s) for s in sources]+list(extra)))
    subprocess.run([str(dotnet/'dotnet'),str(compiler),'@'+str(rsp)],check=True)
compile('Solaris.Transport',sorted((root/'windows-native/Solaris.Transport').glob('*.cs')),refs)
windowrefs=list((packages/'microsoft.windowsdesktop.app.ref.8.0.31/ref/net8.0').glob('*.dll'))
winimplicit=out/'Windows.cs';winimplicit.write_text('global using System.Windows.Forms;global using System.Drawing;namespace SolarisNativeHost { internal static class ApplicationConfiguration { internal static void Initialize() { Application.SetHighDpiMode(HighDpiMode.SystemAware);Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false); } } }')
compile('SolarisNativeHost',list((root/'windows-native/SolarisNativeHost').glob('*.cs'))+[winimplicit],refs+windowrefs+[out/'Solaris.Transport.dll'],['-target:winexe']+['-resource:'+str(p)+',SolarisNativeHost.app.'+p.name for p in (root/'shared').iterdir() if p.is_file()]+['-resource:'+str(root/'ios/App/Resources/solaris-desktop.html')+',SolarisNativeHost.solaris-desktop.html'])
compile('Solaris.Transport.Tests',list((root/'windows-native/Solaris.Transport.Tests').glob('*.cs'))+[root/'windows-native/SolarisNativeHost/NativeH264Capture.cs'],refs+[out/'Solaris.Transport.dll'],['-target:exe'])
for r in refs:
    if packages in r.parents:shutil.copyfile(r,out/r.name)
(out/'Solaris.Transport.Tests.runtimeconfig.json').write_text(json.dumps({'runtimeOptions':{'tfm':'net8.0','framework':{'name':'Microsoft.NETCore.App','version':'8.0.31'}}}))
print('PASS: C# source compiled with pinned references; Windows publishing/installation is not verified.')
subprocess.run([str(dotnet/'dotnet'),str(out/'Solaris.Transport.Tests.dll'),'--unit-only'],check=True)
