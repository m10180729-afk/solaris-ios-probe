"""Check the user-requested build54 capture code against its retrieved hashes."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
reference = json.loads((ROOT / 'docs/BUILD54_CAPTURE_REFERENCE.json').read_text())
windows = (ROOT / reference['windows_capture_file']).read_text().encode()
swift = (ROOT / reference['ios_capture_file']).read_text()
start = swift.index('    func capture(_ sample: CMSampleBuffer) {')
end = swift.index('    private func applyVideoSenderPolicy() {')
actual = {
    'windows_capture_sha256': hashlib.sha256(windows).hexdigest(),
    'ios_capture_pump_sha256': hashlib.sha256(swift[start:end].encode()).hexdigest(),
}
for key, value in actual.items():
    assert value == reference[key], f'Build54 source mismatch: {key}'
report = {
    'build': 60,
    'baseline_commit': reference['commit'],
    'original_windows_capture_identical': True,
    'original_ios_capture_pump_identical': True,
    **actual,
    'physical_device_fps_verified': False,
}
output = ROOT / 'build/build54-capture-evidence/results.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, indent=2) + '\n')
print('PASS: original build54 Windows capture file and ReplayKit frame pump match')
