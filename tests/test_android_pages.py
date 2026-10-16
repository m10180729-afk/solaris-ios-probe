"""ELF parsing fixtures test a packaging gate, not runnable Android libraries."""
from pathlib import Path
import importlib.util
import json
import struct
import tempfile
import unittest
from unittest.mock import patch
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


def relro_elf(address=256, memory=16128, bits=64, endian="<", file_size=32):
    """Synthetic LOAD/RELRO headers with real vendor virtual-address regressions."""
    offset = address % checks.PAGE_SIZE
    data = bytearray(max(512, offset + file_size))
    data[:6] = b"\x7fELF" + bytes((2 if bits == 64 else 1, 1 if endian == "<" else 2))
    load_memory = max(memory, file_size)
    if bits == 64:
        struct.pack_into(endian + "Q", data, 32, 64)
        struct.pack_into(endian + "HH", data, 54, 56, 2)
        struct.pack_into(endian + "IIQQQQQQ", data, 64, 1, 6, offset, address, 0, file_size, load_memory, 16384)
        struct.pack_into(endian + "IIQQQQQQ", data, 120, 0x6474e552, 4, offset, address, 0, file_size, memory, 1)
    else:
        struct.pack_into(endian + "I", data, 28, 52)
        struct.pack_into(endian + "HH", data, 42, 32, 2)
        struct.pack_into(endian + "IIIIIIII", data, 52, 1, offset, address, 0, file_size, load_memory, 6, 16384)
        struct.pack_into(endian + "IIIIIIII", data, 84, 0x6474e552, offset, address, 0, file_size, memory, 4, 1)
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

    def test_current_arm64_relro_end_is_16kb_aligned(self):
        result = checks.elf_loads(relro_elf(address=11929872, memory=177904))
        self.assertTrue(result["load_aligned_16kb"])
        self.assertTrue(result["relro_present"])
        self.assertTrue(result["relro_aligned_16kb"])
        self.assertTrue(result["aligned_16kb"])
        self.assertEqual(result["relro_segments"][0]["end_address"], 12107776)

    def test_current_x86_64_relro_fails_despite_aligned_loads(self):
        result = checks.elf_loads(relro_elf(address=15819648, memory=261248))
        self.assertTrue(result["load_aligned_16kb"])
        self.assertFalse(result["relro_aligned_16kb"])
        self.assertFalse(result["aligned_16kb"])
        self.assertEqual(result["relro_segments"][0]["end_address"] % 16384, 8192)

    def test_relro_big_endian_32bit_fields(self):
        result = checks.elf_loads(relro_elf(bits=32, endian=">"))
        self.assertTrue(result["relro_aligned_16kb"])
        self.assertEqual(result["bits"], 32)

    def test_relro_file_size_may_exceed_memory_size(self):
        result = checks.elf_loads(relro_elf(address=16352, memory=32, file_size=64))
        self.assertTrue(result["relro_aligned_16kb"])

    def test_relro_truncated_payload_bounds_rejected(self):
        data = bytearray(relro_elf())
        struct.pack_into("<Q", data, 128, len(data) - 16)
        with self.assertRaisesRegex(ValueError, "GNU_RELRO segment bounds"):
            checks.elf_loads(data)

    def test_relro_virtual_address_overflow_rejected(self):
        data = bytearray(relro_elf())
        struct.pack_into("<Q", data, 136, (1 << 64) - 10)
        with self.assertRaisesRegex(ValueError, "GNU_RELRO segment bounds"):
            checks.elf_loads(data)

    def test_relro_outside_load_memory_rejected(self):
        data = bytearray(relro_elf())
        struct.pack_into("<Q", data, 136, 1 << 30)
        with self.assertRaisesRegex(ValueError, "outside LOAD"):
            checks.elf_loads(data)

    def test_absent_relro_alignment_passes_with_security_warning(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "fixture.apk"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("lib/arm64-v8a/libwebrtc.so", elf())
            result = checks.inspect_apk(path, phone_apk=True)
            self.assertTrue(result["elf_aligned_16kb"])
            self.assertEqual(result["missing_relro_security_warnings"], ["lib/arm64-v8a/libwebrtc.so"])

    def test_legacy_32bit_relro_failure_is_only_an_alignment_warning(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "fixture.apk"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("lib/arm64-v8a/libwebrtc.so", relro_elf())
                archive.writestr("lib/armeabi-v7a/libwebrtc.so", relro_elf(bits=32, memory=3840))
            result = checks.inspect_apk(path, phone_apk=True)
            self.assertTrue(result["elf_aligned_16kb"])
            self.assertTrue(result["phone_apk_policy_passed"])
            self.assertEqual(result["legacy_32bit_alignment_warnings"], ["lib/armeabi-v7a/libwebrtc.so"])

    def test_phone_apk_requires_arm64_and_excludes_both_x86_abis(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "fixture.apk"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("lib/arm64-v8a/libwebrtc.so", relro_elf())
                archive.writestr("lib/x86_64/libwebrtc.so", relro_elf())
                archive.writestr("lib/x86/libwebrtc.so", elf(bits=32, alignment=4096))
            result = checks.inspect_apk(path, phone_apk=True)
            self.assertTrue(result["elf_aligned_16kb"])
            self.assertFalse(result["phone_apk_policy_passed"])
            self.assertIn("x86, x86_64", result["phone_apk_policy_errors"][0])

    def test_x86_64_only_apk_cannot_be_distributed_as_phone_apk(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "fixture.apk"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("lib/x86_64/libwebrtc.so", relro_elf())
            result = checks.inspect_apk(path, phone_apk=True)
            self.assertTrue(result["elf_aligned_16kb"])
            self.assertFalse(result["phone_apk_policy_passed"])
            self.assertIn("must contain arm64-v8a", result["phone_apk_policy_errors"][0])

    def test_vendor_x86_64_relro_fails_universal_apk(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "fixture.apk"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("lib/arm64-v8a/libwebrtc.so", relro_elf(address=11929872, memory=177904))
                archive.writestr("lib/x86_64/libwebrtc.so", relro_elf(address=15819648, memory=261248))
            result = checks.inspect_apk(path)
            self.assertTrue(result["elf_load_aligned_16kb"])
            self.assertFalse(result["elf_relro_aligned_16kb"])
            self.assertFalse(result["elf_aligned_16kb"])

    def test_phone_cli_rejects_x86_and_preserves_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            path, output = Path(folder) / "fixture.apk", Path(folder) / "evidence.json"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("lib/x86_64/libwebrtc.so", relro_elf())
            with patch("sys.argv", ["check_android_pages", "--phone-apk", "--apk", str(path), "--output", str(output)]):
                with self.assertRaises(SystemExit) as failure:
                    checks.main()
            self.assertIn("Phone APK must contain arm64-v8a", str(failure.exception))
            self.assertNotIn("no applicable 64-bit", str(failure.exception))
            evidence = json.loads(output.read_text())
            self.assertTrue(evidence["elf_aligned_16kb"])
            self.assertTrue(evidence["relro_alignment_checked_here"])
            self.assertFalse(evidence["phone_apk_policy_passed"])


class ReceiveOnlyAPKTests(unittest.TestCase):
    def test_receive_only_accepts_no_native_libraries(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'fixture.apk'
            with zipfile.ZipFile(path,'w') as z:z.writestr('classes.dex',b'fixture')
            result=checks.inspect_apk(path,phone_apk=True,receive_only=True)
            self.assertTrue(result['receive_only_policy_passed'])
            self.assertFalse(result['native_alignment_required'])
            self.assertEqual(result['libraries'],[])
    def test_receive_only_rejects_even_aligned_native_sender(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'fixture.apk'
            with zipfile.ZipFile(path,'w') as z:z.writestr('lib/arm64-v8a/libwebrtc.so',relro_elf())
            result=checks.inspect_apk(path,phone_apk=True,receive_only=True)
            self.assertFalse(result['receive_only_policy_passed'])
            self.assertFalse(result['phone_apk_policy_passed'])
    def test_default_inspection_still_rejects_empty_native_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'fixture.apk'
            with zipfile.ZipFile(path,'w') as z:z.writestr('classes.dex',b'fixture')
            result=checks.inspect_apk(path,phone_apk=True)
            self.assertFalse(result['elf_aligned_16kb'])
            self.assertFalse(result['phone_apk_policy_passed'])

if __name__ == "__main__":
    unittest.main()
