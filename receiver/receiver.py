"""Solaris 1A LAN receiver. Python 3.10+, standard library only.

Not a production server or WebRTC implementation. Latest JPEG stays in RAM only.
Bind to your PC's RFC1918 IPv4 address; never port-forward this plaintext probe.
"""
from __future__ import annotations

import argparse
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import math
from pathlib import Path
import re
import secrets
import socket
import threading
import time

MAX_FRAME = 1024 * 1024
STALE_SECONDS = 3.0
PRIVATE_NETS = tuple(ipaddress.ip_network(n) for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))


def allowed_ip(value: str) -> bool:
    try:
        address = ipaddress.IPv4Address(value)
        return address.is_loopback or any(address in network for network in PRIVATE_NETS)
    except ipaddress.AddressValueError:
        return False


def dimensions(value: str) -> str:
    if not re.fullmatch(r"[1-9][0-9]{0,4}x[1-9][0-9]{0,4}", value):
        raise ValueError("invalid dimensions")
    return value


class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.frame: bytes | None = None
        self.last = 0.0
        self.sequence = 0
        self.started = 0.0
        self.times: deque[float] = deque(maxlen=256)
        self.meta: dict = {}
        self.session: str | None = None

    def put(self, data: bytes, meta: dict, session: str) -> None:
        now = time.monotonic()
        with self.lock:
            if self.session != session:
                if self.session is not None and now - self.last < STALE_SECONDS:
                    raise ValueError("another sender is active; stop it and wait three seconds")
                self.started = now
                self.times.clear()
                self.sequence = 0
                self.session = session
            self.frame, self.last, self.meta = data, now, meta
            self.sequence += 1
            self.times.append(now)

    def snapshot(self) -> tuple[bytes | None, dict]:
        now = time.monotonic()
        with self.lock:
            age = now - self.last if self.last else None
            if age is not None and age > STALE_SECONDS:
                self.frame = None
            times = [t for t in self.times if now - t <= 5]
            fps = ((len(times) - 1) / (times[-1] - times[0])) if len(times) > 1 and self.frame else 0.0
            result = dict(self.meta, sequence=self.sequence,
                          received_fps=round(fps, 2),
                          frame_age_seconds=round(age, 2) if age is not None else None,
                          receiving=self.frame is not None,
                          duration_seconds=round(now - self.started, 1) if self.started else 0)
            return self.frame, result


class Receiver(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], token: str):
        self.token = token
        self.state = State()
        self.page = Path(__file__).with_name("viewer.html").read_bytes()
        super().__init__(address, Handler)

    def service_actions(self):
        # Discard stale screen bytes even when nobody is polling the viewer.
        self.state.snapshot()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"
    server: Receiver

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, format, *args):
        pass  # Never log tokens, screen payloads or arbitrary request text.

    def reply(self, status: int, data: bytes = b"", content_type: str = "text/plain; charset=utf-8", **headers):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
        for key, value in headers.items():
            self.send_header(key.replace("_", "-"), str(value))
        self.end_headers()
        if data:
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError, socket.timeout):
                pass

    def valid_client(self) -> bool:
        # Reject unexpected Host/Origin to reduce DNS rebinding and cross-origin use.
        host, port = self.server.server_address
        expected = f"{host}:{port}"
        origin = self.headers.get("Origin")
        valid = (allowed_ip(self.client_address[0]) and self.headers.get("Host") == expected
                 and origin in (None, f"http://{expected}"))
        if not valid:
            self.reply(403, b"Private LAN client and matching Host/Origin required")
        return valid

    def authorized(self) -> bool:
        supplied = self.headers.get("X-Solaris-Token", "")
        try:
            valid = secrets.compare_digest(supplied, self.server.token)
        except TypeError:
            valid = False
        if not valid:
            self.reply(401, b"Invalid session token")
        return valid

    def do_GET(self):
        if not self.valid_client():
            return
        if self.path == "/":
            self.reply(200, self.server.page, "text/html; charset=utf-8")
            return
        if self.path not in ("/ping", "/stats", "/frame"):
            self.reply(404)
            return
        if not self.authorized():
            return
        if self.path == "/ping":
            self.reply(200, b'{"probe":"Solaris-1A"}', "application/json")
            return
        frame, stats = self.server.state.snapshot()
        if self.path == "/stats":
            self.reply(200, json.dumps(stats, allow_nan=False).encode(), "application/json")
        elif frame is None:
            self.reply(204)
        else:
            self.reply(200, frame, "image/jpeg", X_Sequence=stats["sequence"])

    def do_POST(self):
        if not self.valid_client() or not self.authorized():
            return
        if self.path != "/frame":
            self.reply(404)
            return
        if self.headers.get("Transfer-Encoding"):
            self.reply(400, b"Chunked uploads are not supported")
            return
        try:
            count = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.reply(400)
            return
        if not 4 < count <= MAX_FRAME:
            self.reply(413, b"Frame must be at most 1 MiB")
            return
        if self.headers.get("Content-Type") != "image/jpeg":
            self.reply(415)
            return
        try:
            session = self.headers.get("X-Solaris-Session", "")
            if not re.fullmatch(r"[A-Za-z0-9-]{16,64}", session):
                raise ValueError("invalid session")
            fps = float(self.headers.get("X-Capture-FPS", "0"))
            if not math.isfinite(fps) or not 0 <= fps <= 240:
                raise ValueError("invalid capture fps")
            meta = {"source": dimensions(self.headers.get("X-Source-Size", "")),
                    "preview": dimensions(self.headers.get("X-Preview-Size", "")),
                    "capture_fps_reported": round(fps, 2)}
        except ValueError:
            self.reply(400, b"Invalid diagnostic metadata")
            return
        try:
            data = self.rfile.read(count)
        except (socket.timeout, ConnectionResetError):
            self.reply(408)
            return
        if len(data) != count or not data.startswith(b"\xff\xd8") or not data.endswith(b"\xff\xd9"):
            self.reply(400, b"Incomplete JPEG")
            return
        try:
            self.server.state.put(data, meta, session)
        except ValueError:
            self.reply(409, b"Another sender is active")
            return
        self.reply(200, b"OK")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="127.0.0.1", help="PC private IPv4 from ipconfig (not 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if not allowed_ip(args.bind) or not 1024 <= args.port <= 65535:
        parser.error("Use a private IPv4 or loopback address and port 1024-65535")
    token = secrets.token_hex(32)
    try:
        server = Receiver((args.bind, args.port), token)
    except OSError as error:
        parser.exit(1, f"Cannot listen: {error}\nCheck ipconfig and use an unused port.\n")
    print("Solaris 1A - PRIVATE LAN / NO AUDIO / <=5fps PREVIEW", flush=True)
    print(f"Receiver and viewer: http://{args.bind}:{args.port}", flush=True)
    print(f"Temporary token (keep private): {token}", flush=True)
    print("Plain HTTP: trusted home Wi-Fi only. No port-forwarding. Ctrl+C to stop.", flush=True)
    if args.bind.startswith("127."):
        print("Loopback mode: phones cannot connect. Use --bind with your PC's LAN IPv4.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped. Screen frames were not saved.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
