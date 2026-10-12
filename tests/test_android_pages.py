"""ELF parsing fixtures test a packaging gate, not runnable Android libraries."""
from pathlib import Path
import importlib.util
import struct
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("android_pages", ROOT / "scripts/check_android_pages.py")
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)


def elf(bits=64, endian="<", alignment=16384, address=256, segment_type=1):
    data = bytearray(512)
    data[:6] = b"\x7fELF" + bytes((2 if bits == 64 else 1, 1 if endian == "<" else 2))
    if bits == 64:
        struct.pack_into(endian + "Q", data, 32, 64)
        struct.pack_into(endian + "HH", data, 54, 56, 1)
        struct.pack_into(endian + "IIQQQQQQ", data, 64, segment_type, 5, 256, address, 0, 32, 32, alignment)
    else:
        struct.pack_into(endian + "I", data, 28, 52)
        struct.pack_into(endian + "HH", data, 42, 32, 1)
        struct.pack_into(endian + "IIIIIIII", data, 52, segment_type, 256, address, 0, 32, 32, 5, alignment)
    return bytes(data)


class AndroidPageTests(unittest.TestCase):
    def test_64bit_16kb_library(self):
        self.assertTrue(checks.elf_loads(elf())["aligned_16kb"])

    def test_32bit_16kb_library_reads_correct_alignment_field(self):
        result = checks.elf_loads(elf(bits=32))
        self.assertTrue(result["aligned_16kb"])
        self.assertEqual(result["bits"], 32)

    def test_big_endian_library(self):
        self.assertTrue(checks.elf_loads(elf(endian=">"))["aligned_16kb"])

    def test_4kb_library_cannot_pass(self):
        self.assertFalse(checks.elf_loads(elf(alignment=4096))["aligned_16kb"])

    def test_offset_and_address_must_match_page_boundary(self):
        self.assertFalse(checks.elf_loads(elf(address=512))["aligned_16kb"])

    def test_alignment_must_be_power_of_two(self):
        self.assertFalse(checks.elf_loads(elf(alignment=20000))["aligned_16kb"])

    def test_truncated_program_headers_rejected(self):
        with self.assertRaisesRegex(ValueError, "program header"):
            checks.elf_loads(elf()[:80])

    def test_missing_load_segment_rejected(self):
        with self.assertRaisesRegex(ValueError, "no LOAD"):
            checks.elf_loads(elf(segment_type=2))

    def test_non_elf_library_rejected(self):
        with self.assertRaisesRegex(ValueError, "Not an ELF"):
            checks.elf_loads(b"fixture")

    def test_one_bad_abi_fails_entire_apk(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "fixture.apk"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("lib/arm64-v8a/libwebrtc.so", elf())
                archive.writestr("lib/x86_64/libwebrtc.so", elf(alignment=4096))
            result = checks.inspect_apk(path)
            self.assertFalse(result["elf_aligned_16kb"])
            self.assertEqual(len(result["libraries"]), 2)
            self.assertFalse(result["physical_device_runtime_verified"])

    def test_native_library_payload_must_be_actual_elf(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "fixture.apk"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("lib/arm64-v8a/libwebrtc.so", b"fixture")
            result = checks.inspect_apk(path)
            self.assertFalse(result["elf_aligned_16kb"])
            self.assertIn("error", result["libraries"][0])

    def test_legacy_32bit_4kb_library_does_not_fail_64bit_gate(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "fixture.apk"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("lib/arm64-v8a/libwebrtc.so", elf())
                archive.writestr("lib/armeabi-v7a/libwebrtc.so", elf(bits=32, alignment=4096))
            result = checks.inspect_apk(path)
            self.assertTrue(result["elf_aligned_16kb"])
            self.assertEqual(result["legacy_32bit_alignment_warnings"], ["lib/armeabi-v7a/libwebrtc.so"])

    def test_32bit_only_apk_cannot_claim_64bit_device_compatibility(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "fixture.apk"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("lib/armeabi-v7a/libwebrtc.so", elf(bits=32))
            self.assertFalse(checks.inspect_apk(path)["elf_aligned_16kb"])

    def test_mislabeled_32bit_library_in_arm64_directory_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "fixture.apk"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("lib/arm64-v8a/libwebrtc.so", elf(bits=32))
            result = checks.inspect_apk(path)
            self.assertFalse(result["elf_aligned_16kb"])
            self.assertIn("does not match", result["libraries"][0]["error"])

    def test_empty_apk_cannot_claim_native_compatibility(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "fixture.apk"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("classes.dex", b"fixture")
            self.assertFalse(checks.inspect_apk(path)["elf_aligned_16kb"])


if __name__ == "__main__":
    unittest.main()
