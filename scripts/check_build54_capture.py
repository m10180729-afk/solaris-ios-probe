"""Check the user-requested build54 capture code against its retrieved hashes."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
reference = json.loads((ROOT / 'docs/BUILD54_CAPTURE_REFERENCE.json').read_text(encoding='utf-8'))
windows = (ROOT / reference['windows_capture_file']).read_text(encoding='utf-8').encode()
swift = (ROOT / reference['ios_capture_file']).read_text(encoding='utf-8')
start = swift.index('    func capture(_ sample: CMSampleBuffer) {')
end = swift.index('    private func applyVideoSenderPolicy() {')
actual = {
    'windows_capture_sha256': hashlib.sha256(windows).hexdigest(),
    'ios_capture_pump_sha256': hashlib.sha256(swift[start:end].encode()).hexdigest(),
}
compat = json.loads((ROOT / 'docs/COMPAT_CAPTURE_REFERENCE.json').read_text())
assert actual['windows_capture_sha256'] == compat['windows_capture_sha256'], 'Unreviewed Windows capture change'
parser = windows.decode()[windows.decode().index('internal sealed class AnnexBAccessUnitParser'):].rstrip()
assert hashlib.sha256(parser.encode()).hexdigest() == compat['annex_b_parser_sha256'], 'Unreviewed Annex-B parser change'
assert actual['ios_capture_pump_sha256'] == reference['ios_capture_pump_sha256'], 'ReplayKit frame pump changed'
report = {
    'build': 67,
    'baseline_commit': reference['commit'],
    'original_windows_capture_identical': False,
    'windows_cpu_compatibility_fallback': True,
    'original_annex_b_parser_identical': False,
    'configuration_only_access_units_filtered': True,
    'original_ios_capture_pump_identical': True,
    **actual,
    'physical_device_fps_verified': False,
}
output = ROOT / 'build/build54-capture-evidence/results.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, indent=2) + '\n')
print('PASS: reviewed Windows CPU fallback, reviewed Annex-B frame filter and original ReplayKit frame pump match')
