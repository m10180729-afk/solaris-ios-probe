"""Graph fixtures reproduce the old productRef copy failure without requiring Xcode.

The macOS build additionally runs the same validator against the REAL generated
project and runs otool/lipo against the REAL binaries. Fixtures are not a build.
"""
import copy
from pathlib import Path
import plistlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from check_webrtc import check_project_graph
from prepare_webrtc import device_library, prepare, validate_framework


class EmbeddingTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        xc = self.root / "Vendor/WebRTC.xcframework"
        xc.mkdir(parents=True)
        (xc / "Info.plist").write_bytes(plistlib.dumps({}))
        self.graph = {"objects": {
            "group": {"isa": "PBXGroup", "sourceTree": "<group>", "children": ["vendor"]},
            "vendor": {"isa": "PBXGroup", "sourceTree": "<group>", "path": "Vendor", "children": ["rtc"]},
            "rtc": {"isa": "PBXFileReference", "sourceTree": "<group>", "path": "WebRTC.xcframework"},
            "link": {"isa": "PBXBuildFile", "fileRef": "rtc"},
            "embed": {"isa": "PBXBuildFile", "fileRef": "rtc"},
            "links": {"isa": "PBXFrameworksBuildPhase", "files": ["link"]},
            "copies": {"isa": "PBXCopyFilesBuildPhase", "files": ["embed"], "dstSubfolderSpec": 10},
            "extension": {"isa": "PBXNativeTarget", "name": "SolarisBroadcast", "buildPhases": ["links", "copies"]},
            "app": {"isa": "PBXNativeTarget", "name": "SolarisProbe", "buildPhases": []},
        }}

    def test_actual_file_reference_accepted(self):
        check_project_graph(self.graph, self.root)

    def test_old_package_embed_reproduces_missing_product_path(self):
        objects = self.graph["objects"]
        objects["package"] = {"isa": "XCSwiftPackageProductDependency", "productName": "WebRTC"}
        objects["embed"] = {"isa": "PBXBuildFile", "productRef": "package"}
        with self.assertRaisesRegex(ValueError, "Release-iphoneos/WebRTC"):
            check_project_graph(self.graph, self.root)

    def test_built_products_source_rejected(self):
        self.graph["objects"]["rtc"]["sourceTree"] = "BUILT_PRODUCTS_DIR"
        with self.assertRaisesRegex(ValueError, "must exist before build"):
            check_project_graph(self.graph, self.root)

    def test_missing_real_copy_source_rejected(self):
        (self.root / "Vendor/WebRTC.xcframework/Info.plist").unlink()
        with self.assertRaisesRegex(ValueError, "copy source does not exist"):
            check_project_graph(self.graph, self.root)

    def test_duplicate_host_embedding_rejected(self):
        self.graph["objects"]["app"]["buildPhases"] = ["copies"]
        with self.assertRaisesRegex(ValueError, "Duplicate/unneeded"):
            check_project_graph(self.graph, self.root)

    def test_missing_link_rejected(self):
        self.graph["objects"]["extension"]["buildPhases"] = ["copies"]
        with self.assertRaisesRegex(ValueError, "link and embed"):
            check_project_graph(self.graph, self.root)

    def test_wrong_embed_destination_rejected(self):
        self.graph["objects"]["copies"]["dstSubfolderSpec"] = 13
        with self.assertRaisesRegex(ValueError, "must embed in Frameworks"):
            check_project_graph(self.graph, self.root)

    def test_select_device_not_simulator(self):
        device = {"LibraryIdentifier": "ios-arm64", "LibraryPath": "WebRTC.framework",
                  "SupportedPlatform": "ios", "SupportedArchitectures": ["arm64"]}
        sim = dict(device, LibraryIdentifier="ios-arm64-simulator", SupportedPlatformVariant="simulator")
        self.assertEqual(device_library({"AvailableLibraries": [sim, device]}), device)
        with self.assertRaisesRegex(ValueError, "device slice"):
            device_library({"AvailableLibraries": [sim]})

    def test_checksum_mismatch_fails_before_extraction(self):
        archive = self.root / "broken.zip"
        archive.write_bytes(b"not the pinned release")
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            prepare(archive, self.root / "destination")

    def test_sender_advertises_startup_screen_bitrate(self):
        sender = (Path(__file__).resolve().parents[1] /
                  "ios/Broadcast/BroadcastWebRTCSender.swift").read_text()
        self.assertIn("screenAnswerSDP", sender)
        self.assertIn('output.append("b=AS:60000")', sender)
        self.assertIn('sdp: tunedSDP', sender)

    def test_receiver_offer_requests_screen_bitrate_budget(self):
        receiver = (Path(__file__).resolve().parents[1] /
                    "ios/App/Resources/solaris-p2p.html").read_text()
        self.assertIn("tuneScreenOfferSDP", receiver)
        self.assertIn("x-google-start-bitrate=20000", receiver)
        self.assertIn("x-google-min-bitrate=6000", receiver)
        self.assertIn("x-google-max-bitrate=60000", receiver)
        self.assertIn("b=TIAS:60000000", receiver)

    def test_source_format_is_not_reapplied_on_every_frame(self):
        sender = (Path(__file__).resolve().parents[1] /
                  "ios/Broadcast/BroadcastWebRTCSender.swift").read_text()
        self.assertIn("lastOutputFormat", sender)
        self.assertIn("if format != lastOutputFormat", sender)

    def test_sender_uses_screen_cast_source_and_rtp_policy(self):
        sender = (Path(__file__).resolve().parents[1] /
                  "ios/Broadcast/BroadcastWebRTCSender.swift").read_text()
        self.assertIn("videoSource(forScreenCast: true)", sender)
        self.assertIn("RTCRtpSender", sender)
        self.assertIn("maxBitrateBps = NSNumber(value: 60_000_000)", sender)
        self.assertIn("scaleResolutionDownBy = NSNumber(value: 1.0)", sender)
        self.assertIn("RTCDegradationPreference.maintainFramerateAndResolution", sender)
        self.assertIn("encoderPolicy", sender)

    def test_sender_prefers_hardware_friendly_h264(self):
        sender = (Path(__file__).resolve().parents[1] /
                  "ios/Broadcast/BroadcastWebRTCSender.swift").read_text()
        receiver = (Path(__file__).resolve().parents[1] /
                    "ios/App/Resources/solaris-p2p.html").read_text()
        self.assertIn("kRTCH264CodecName", sender)
        self.assertIn("encoderFactory.preferredCodec", sender)
        self.assertIn("preferH264(videoTransceiver)", receiver)
        self.assertIn("setCodecPreferences", receiver)

    def test_sixty_fps_does_not_use_exact_interval_gate(self):
        sender = (Path(__file__).resolve().parents[1] /
                  "ios/Broadcast/BroadcastWebRTCSender.swift").read_text()
        self.assertIn("if quality.fps < 60", sender)
        self.assertIn("submit every ReplayKit callback", sender)
        self.assertIn("pendingFrame", sender)
        self.assertNotIn("guard now - lastFrame >= 1.0 / Double(max(1, quality.fps))", sender)

    def test_receiver_reports_actual_rtp_dimensions_and_changes(self):
        receiver = (Path(__file__).resolve().parents[1] /
                    "ios/App/Resources/solaris-p2p.html").read_text()
        self.assertIn("r.frameWidth", receiver)
        self.assertIn("r.frameHeight", receiver)
        self.assertIn("receiveMbps", receiver)
        self.assertIn("codecReport", receiver)
        self.assertIn("수신 인코딩 해상도 변화", receiver)
        self.assertIn("RTP ${inboundSize}", receiver)
        self.assertIn("senderQueueDrops", receiver)


if __name__ == "__main__":
    unittest.main()
