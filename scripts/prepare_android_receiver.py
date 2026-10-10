"""Generate Android receiver assets from the same web clients shipped elsewhere."""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
out = root / 'android/app/src/main/assets'
out.mkdir(parents=True, exist_ok=True)
windows = (root / 'ios/App/Resources/solaris-desktop.html').read_text()
assert "BUILD_NUMBER='54'" in windows
windows = windows.replace('<title>Solaris Windows 화면공유', '<title>Solaris Android 화면 수신')
windows = windows.replace('</body>', '''<script>
// Receiver-only Android surface. The Windows GPU sender lives in SolarisNativeHost.exe.
document.querySelector('section.card').hidden = true;
document.getElementById('sendBtn').hidden = true;
document.getElementById('systemAudio').closest('label').hidden = true;
document.getElementById('receiveBtn').textContent = 'Windows 화면 받기';
</script></body>''')
(out / 'windows.html').write_text(windows)
ipad = (root / 'ios/App/Resources/solaris-p2p.html').read_text()
assert "BUILD_NUMBER = '54'" in ipad
(out / 'ipad.html').write_text(ipad)
print('Android receiver assets prepared: Windows and iPad modes, build54')
