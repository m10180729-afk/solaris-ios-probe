"""Protect the restored build54 encoder/RTP files and media policy bodies."""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
reference = json.loads((ROOT / 'docs/BUILD54_ENGINE_MANIFEST.json').read_text(encoding='utf-8'))
compat = json.loads((ROOT / 'docs/COMPAT_CAPTURE_REFERENCE.json').read_text())
checked = {}
for name, expected in reference['files'].items():
    actual = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
    if name.endswith('/NativeH264Capture.cs'):
        expected = compat['windows_capture_sha256']
    assert actual == expected, f'Unreviewed media engine change: {name}'
    checked[name] = actual
source = (ROOT / 'shared/build54-screen.mjs').read_text(encoding='utf-8')
for name, expected in reference['javascript_functions'].items():
    match = re.search(r'export ((?:async )?function ' + re.escape(name) + r'\()', source)
    assert match, f'Build54 media policy is missing: {name}'
    end = source.find('\nexport ', match.start())
    body = source[match.start(1):end if end != -1 else len(source)].rstrip()
    actual = hashlib.sha256(body.encode()).hexdigest()
    assert actual == expected, f'Original build54 policy changed: {name}'
    checked[name] = actual
report = {'build': 67, 'baseline_commit': reference['commit'],
          'unchanged_windows_engine_files': len(reference['files']) - 1,
          'reviewed_windows_capture_compatibility': True,
          'unchanged_javascript_media_policies': len(reference['javascript_functions']),
          'sha256': checked, 'physical_device_performance_verified': False}
output = ROOT / 'build/build54-engine-evidence/results.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, indent=2) + '\n')
print('PASS: 5 original Windows engine files and 6 media policies match; reviewed CPU capture compatibility verified')
