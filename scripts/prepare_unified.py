"""Copy the canonical offline app into the mobile bundles. No CDN scripts."""
from pathlib import Path
import shutil
import re,hashlib,base64
root=Path(__file__).resolve().parents[1]
for target in (root/'ios/App/Resources/Unified',root/'android/app/src/main/assets'):
    target.mkdir(parents=True,exist_ok=True)
    for asset in (root/'shared').iterdir():
        if asset.is_file(): shutil.copyfile(asset,target/asset.name)
    # WKWebView local modules have inconsistent file-origin CORS behavior.
    # Bundle into one hash-authorized script; never enable unsafe file access.
    parts=[]
    for name in ('config','sha256','platform','authflow','api','build54-screen','media','files','lifecycle','diagnostics','chat','viewing','icons','app'):
        src=(root/'shared'/f'{name}.mjs').read_text(encoding='utf-8')
        exports=re.findall(r'export (?:async )?(?:function|const|class) (\w+)',src)
        src=re.sub(r"\bimport\s*.*?from\s*['\"][^'\"]+['\"]\s*;",'',src)
        src=src.replace('export default','const config=' )
        src=re.sub(r'\bexport (?=class |async function |function |const )','',src)
        if name=='build54-screen':
            names=','.join(exports)
            src='const {'+names+'}=(()=>{\n'+src+'\nreturn {'+names+'};})();'
        parts.append(src)
    script='(async()=>{\n'+'\n'.join(parts)+'\n})();'
    digest=base64.b64encode(hashlib.sha256(script.encode()).digest()).decode()
    html=(root/'shared/index.html').read_text(encoding='utf-8').replace("script-src 'self'",f"script-src 'self' 'sha256-{digest}'")
    html=html.replace('<link rel="stylesheet" href="app.css">','<style>'+(root/'shared/app.css').read_text(encoding='utf-8')+'</style>')
    html=html.replace('<script type="module" src="app.mjs"></script>','<script>'+script+'</script>')
    (target/'unified.html').write_text(html,encoding='utf-8',newline='\n')
print('Solaris unified assets prepared, build63')
