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
    for name in ('config','sha256','platform','api','media','files','lifecycle','diagnostics','app'):
        src=(root/'shared'/f'{name}.mjs').read_text()
        src=re.sub(r"\bimport\s*.*?from\s*['\"][^'\"]+['\"]\s*;",'',src)
        src=src.replace('export default','const config=' )
        src=re.sub(r'\bexport (?=class |function |const )','',src)
        parts.append(src)
    script='(async()=>{\n'+'\n'.join(parts)+'\n})();'
    digest=base64.b64encode(hashlib.sha256(script.encode()).digest()).decode()
    html=(root/'shared/index.html').read_text().replace("script-src 'self'",f"script-src 'self' 'sha256-{digest}'")
    html=html.replace('<link rel="stylesheet" href="app.css">','<style>'+(root/'shared/app.css').read_text()+'</style>')
    html=html.replace('<script type="module" src="app.mjs"></script>','<script>'+script+'</script>')
    (target/'unified.html').write_text(html)
print('Solaris unified assets prepared, build57')
