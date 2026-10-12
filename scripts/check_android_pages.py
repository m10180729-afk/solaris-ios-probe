"""Read APK native ELF LOAD alignment for 16-KB devices; never rewrite binaries.

APK ZIP alignment is checked separately by SDK zipalign in CI. This check does
not establish device runtime compatibility or MediaProjection performance.
"""
from pathlib import Path
import argparse
import hashlib
import json
import struct
import zipfile

PAGE_SIZE = 16384
REQUIRED_ABIS = {"arm64-v8a", "x86_64"}
LEGACY_ABIS = {"armeabi-v7a", "x86"}


def elf_loads(data):
    if len(data) < 16 or data[:4] != b"\x7fELF":
        raise ValueError("Not an ELF shared library")
    bits, byte_order = data[4], data[5]
    if bits not in (1, 2) or byte_order not in (1, 2):
        raise ValueError("Unsupported ELF class or byte order")
    endian = "<" if byte_order == 1 else ">"
    minimum, table_at, count_at, entry_at, offset_format, entry_format = (
        (64, 32, 56, 54, "Q", "IIQQQQQQ") if bits == 2
        else (52, 28, 44, 42, "I", "IIIIIIII")
    )
    if len(data) < minimum:
        raise ValueError("Truncated ELF header")
    table = struct.unpack_from(endian + offset_format, data, table_at)[0]
    count = struct.unpack_from(endian + "H", data, count_at)[0]
    entry_size = struct.unpack_from(endian + "H", data, entry_at)[0]
    minimum_entry = struct.calcsize(endian + entry_format)
    if not count or count == 65535 or table < minimum or entry_size < minimum_entry or table + count * entry_size > len(data):
        raise ValueError("Invalid or truncated ELF program header table")
    loads = []
    for index in range(count):
        values = struct.unpack_from(endian + entry_format, data, table + index * entry_size)
        if values[0] != 1:  # PT_LOAD
            continue
        offset, address, size, memory, alignment = (
            (values[2], values[3], values[5], values[6], values[7]) if bits == 2
            else (values[1], values[2], values[4], values[5], values[7])
        )
        if offset + size > len(data) or size > memory:
            raise ValueError("Truncated or invalid ELF LOAD segment")
        loads.append({"offset": offset, "virtual_address": address, "alignment": alignment,
                      "aligned_16kb": alignment >= PAGE_SIZE and alignment & (alignment - 1) == 0
                      and offset % PAGE_SIZE == address % PAGE_SIZE})
    if not loads:
        raise ValueError("ELF contains no LOAD segments")
    return {"bits": 64 if bits == 2 else 32, "load_segments": loads,
            "aligned_16kb": all(segment["aligned_16kb"] for segment in loads)}


def inspect_apk(path):
    libraries = []
    with zipfile.ZipFile(path) as archive:
        entries = [entry for entry in archive.infolist() if entry.filename.startswith("lib/") and entry.filename.endswith(".so")]
        if len({entry.filename for entry in entries}) != len(entries):
            raise ValueError("APK contains duplicate native library paths")
        for entry in entries:
            abi = entry.filename.split("/")[1]
            result = {"path": entry.filename, "abi": abi, "required_16kb": abi in REQUIRED_ABIS}
            try:
                if abi not in REQUIRED_ABIS | LEGACY_ABIS:
                    raise ValueError("Unknown native ABI; alignment requirement needs review")
                if entry.file_size > 250 * 1024 * 1024:
                    raise ValueError("Native library exceeds inspection size limit")
                data = archive.read(entry)
                result.update(elf_loads(data))
                if result["bits"] != (64 if abi in REQUIRED_ABIS else 32):
                    raise ValueError("ELF class does not match native ABI directory")
                result["sha256"] = hashlib.sha256(data).hexdigest()
            except (ValueError, struct.error, zipfile.BadZipFile) as error:
                result.update(aligned_16kb=False, error=str(error))
            libraries.append(result)
    required = [library for library in libraries if library["required_16kb"]]
    integrity = bool(libraries) and not any("error" in library for library in libraries)
    return {"build": 62, "apk": Path(path).name, "page_size": PAGE_SIZE, "libraries": libraries,
            "required_16kb_abis": sorted(REQUIRED_ABIS), "native_elf_integrity": integrity,
            "legacy_32bit_alignment_warnings": [library["path"] for library in libraries
                                               if library["abi"] in LEGACY_ABIS and not library["aligned_16kb"]],
            "elf_aligned_16kb": integrity and bool(required) and all(library["aligned_16kb"] for library in required),
            "requirement_source": "https://developer.android.com/guide/practices/page-sizes#elf-alignment",
            "relro_alignment_checked_here": False,
            "zip_alignment_checked_here": False, "physical_device_runtime_verified": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    result = inspect_apk(args.apk)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    bad = [library["path"] for library in result["libraries"]
           if "error" in library or library["required_16kb"] and not library["aligned_16kb"]]
    if not result["elf_aligned_16kb"]:
        raise SystemExit("FAIL: 16-KB ELF LOAD alignment: " + (", ".join(bad) if bad else "no applicable 64-bit native libraries found"))
    count = sum(library["required_16kb"] for library in result["libraries"])
    print(f"PASS: {count} applicable 64-bit native libraries have 16-KB ELF LOAD alignment (RELRO/runtime unverified)")
    if result["legacy_32bit_alignment_warnings"]:
        print("INFO: legacy 32-bit alignment recorded separately: " + ", ".join(result["legacy_32bit_alignment_warnings"]))


if __name__ == "__main__":
    main()
