# WebRTC embedding fix — build 7

## Evidence and scope

The previous failure was `lstat(.../Release-iphoneos/WebRTC): No such file or directory` in SolarisBroadcast's copy phase. The framework suffix was missing because the phase referenced an SPM product, not the binary XCFramework file.

Upstream sources inspected:
- https://github.com/stasel/WebRTC/blob/153.0.0/Package.swift
- https://github.com/yonaskolb/XcodeGen/blob/2.44.1/Sources/XcodeGenKit/PBXProjGenerator.swift

XcodeGen's `.package` branch creates `PBXBuildFile(product: packageDependency, ...)` when `embed: true`. Changing `copy.destination` changes the phase, not that product reference. Its `.framework` branch creates a `PBXFileReference` and uses that file in both link and embed phases.

## Binary source and destination

The actual upstream release ZIP was downloaded and its SHA256 matched Package.swift:
`3e3a8946f27510133e3feed04d05fa23505bbe366e977620503bfc7986c2b78f`.

The release contains `WebRTC.xcframework/ios-arm64/WebRTC.framework/WebRTC`, an arm64 Mach-O in a fat container. Its module map exports `framework module WebRTC`. Other slices are simulator, macOS and Catalyst.

`scripts/prepare_webrtc.py` downloads this exact release and verifies the full ZIP checksum. It reads AvailableLibraries and extracts only the iOS device slice, preserving that slice's files and writing XCFramework metadata listing the selected slice. This release intentionally builds for physical iOS devices, not simulators.

Local dependency: `ios/Vendor/WebRTC.xcframework`.
Actual input binary: `ios/Vendor/WebRTC.xcframework/ios-arm64/WebRTC.framework/WebRTC`.
Required final binary: `Payload/SolarisProbe.app/PlugIns/SolarisBroadcast.appex/Frameworks/WebRTC.framework/WebRTC`.

XcodeGen uses `framework: Vendor/WebRTC.xcframework`, `embed: true`, `codeSign: false`; the package dependency and custom copy settings are removed. Xcode processes the XCFramework into the selected device framework. Exact intermediate paths are Xcode-generated and must be checked in the retained build log; they have not been observed in a real build here.

The broadcast extension alone imports WebRTC. The host disables transitive linking and only embeds the extension. The extension's runpath includes `@executable_path/Frameworks`. Ad-hoc signing proceeds framework → extension → app with no App Group entitlement requested. AltStore must still re-sign the result for the device.

## Gates on the macOS runner

1. Download/checksum/structure validation before XcodeGen.
2. Inspect the actual generated project graph with plutil: reject package productRef, nonexistent source, missing/duplicate link/embed, wrong destination or host duplicate. Log the absolute existing copy source.
3. Xcode 16.4 compiles Swift (including `import WebRTC`) and links both targets. `pipefail` preserves xcodebuild failure through tee. No continue-on-error or test disabling is used.
4. Inspect the built app with otool/lipo: dynamic WebRTC dependency, extension-local LC_RPATH, arm64 device binary, matching install name, no duplicate framework.
5. Inspect the actual ZIP/IPA: bundle versions, executable headers, ReplayKit sample-buffer mode and required extension-local WebRTC files.
6. Keep project.pbxproj, xcodebuild.log, dependency and validator logs, and any xcresult even on failure. Only upload the IPA after all gates pass.

These are the criteria for a successful CI build, not evidence that CI has already passed. This environment has no xcodebuild and no authenticated GitHub execution capability. A real generated project and actual IPA have NOT been produced here. Browser and Python fixture tests cannot prove Swift compilation, successful AltStore installation or live ReplayKit transmission.

## Additional consistency fix

The sender already loaded settings from its extension bundle, but the host UI still required App Group storage and the packaging script still requested group entitlements. The host now reads the same bundled values and offers the system broadcast picker without a shared-container gate. It no longer reports a missing shared diagnostic file as a runtime failure. URL, publishable key, room ID and RPBroadcastProcessModeSampleBuffer remain unchanged.

## Changed files

- ios/project.yml
- ios/Config/Probe.entitlements
- ios/App/SolarisProbeApp.swift
- ios/Shared/ProbeShared.swift
- scripts/prepare_webrtc.py (new)
- scripts/check_webrtc.py (new)
- scripts/build_ios.sh
- scripts/check_project.py
- scripts/package_source.py
- tests/test_webrtc_embedding.py (new)
- tests/test_broadcast_package.py
- .github/workflows/build-ios-probe.yml
- .gitignore
- UPLOAD_GIT_BASH.sh
- README.md and docs/STEP3_WEBRTC_SCREEN_KO.md
- docs/BUILD7_WEBRTC_FIX.md and docs/BUILD7_VALIDATION.md (new)

The build is version 0.3.2, build number 7. Receiver protocol stays screen-v031.
