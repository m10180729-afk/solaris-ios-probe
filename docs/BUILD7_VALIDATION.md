# Build 7 validation — 2026-09-18

| Check | Result in this environment |
|---|---|
| Download stasel/WebRTC 153.0.0 ZIP and match Package.swift checksum | PASS; actual release downloaded |
| Extract iOS arm64 slice and verify binary/header/module-map paths | PASS; actual framework inspected |
| python3 scripts/check_project.py | PASS |
| python3 -m unittest discover -s tests -p 'test_*.py' -v | PASS, 19 tests (project graph and IPA fixtures) |
| python3 -m unittest discover -s receiver -p 'test_*.py' -v | PASS, 9 tests |
| node scripts/check_viewer.mjs | PASS |
| node --test tests/screen_receiver.test.mjs | PASS, 12 tests |
| bash -n scripts/build_ios.sh UPLOAD_GIT_BASH.sh | PASS |
| node scripts/screen_browser_test.mjs | BLOCKED: browser executable absent; attempted Chromium download timed out |
| bash scripts/build_ios.sh | BLOCKED: explicitly exits on this Linux environment; Xcode is not installed |
| Real XcodeGen project generation and its validation | NOT RUN HERE; required macOS CI gate |
| Swift import/typecheck/link, otool/lipo and actual IPA checks | NOT RUN HERE; required macOS CI gates |
| GitHub macOS run for this exact change | NOT RUN; no authenticated GitHub connection at handoff |
| AltStore installation / real iPad ReplayKit screen transmission | NOT VERIFIED |

The 19 project tests include rejection of the previous package productRef embed,
nonexistent real source, BUILT_PRODUCTS_DIR pseudo-source, duplicate host embedding,
missing extension link, wrong framework destination, wrong device slice, checksum
mismatch, missing framework in an IPA and duplicate framework in the host app.
Minimal Mach-O headers and synthetic Xcode project graphs are fixtures, not a runnable IPA or a generated project.

No tests were skipped to turn the CI green. Browser integration remains required
in GitHub Actions; the macOS job independently checks generated and built outputs.
Only a successful run for this new commit can establish that the IPA build passed.
