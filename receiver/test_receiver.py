"""Protocol/security tests only; these do not verify iOS, JPEG decoding or FPS."""
import http.client
import json
from pathlib import Path
import threading
import time
import unittest
from receiver import Receiver, allowed_ip

TOKEN = "a" * 64
# Marker-only payload exercises the HTTP transport, not image decoding.
JPEG = b"\xff\xd8\xff\xe0protocol-test\xff\xd9"


class ReceiverTests(unittest.TestCase):
    def setUp(self):
        self.server = Receiver(("127.0.0.1", 0), TOKEN)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=2)
        connection.request(method, path, body, headers or {})
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def frame_headers(self):
        return {"X-Solaris-Token": TOKEN, "Content-Type": "image/jpeg",
                "X-Solaris-Session": "12345678-abcd-1234-abcd-123456789012",
                "X-Source-Size": "1170x2532", "X-Preview-Size": "333x720", "X-Capture-FPS": "59.8"}

    def test_auth_and_viewer(self):
        self.assertEqual(self.request("GET", "/")[0], 200)
        self.assertEqual(self.request("GET", "/stats")[0], 401)
        self.assertEqual(self.request("GET", "/frame")[0], 401)
        self.assertEqual(self.request("POST", "/frame", JPEG)[0], 401)
        status, headers, _ = self.request("GET", "/ping", headers={"X-Solaris-Token": TOKEN})
        self.assertEqual(status, 200)
        self.assertEqual(headers["Cache-Control"], "no-store")

    def test_upload_stats_and_stale_frame(self):
        self.assertEqual(self.request("POST", "/frame", JPEG, self.frame_headers())[0], 200)
        status, _, data = self.request("GET", "/stats", headers={"X-Solaris-Token": TOKEN})
        stats = json.loads(data)
        self.assertEqual(status, 200)
        self.assertEqual(stats["source"], "1170x2532")
        self.assertEqual(stats["sequence"], 1)
        self.assertNotIn(TOKEN, data.decode())
        self.assertEqual(self.request("GET", "/frame", headers={"X-Solaris-Token": TOKEN})[2], JPEG)
        with self.server.state.lock:
            self.server.state.last = time.monotonic() - 4
        self.assertEqual(self.request("GET", "/frame", headers={"X-Solaris-Token": TOKEN})[0], 204)
        self.assertIsNone(self.server.state.frame)

    def test_bad_requests(self):
        headers = self.frame_headers()
        headers["X-Capture-FPS"] = "nan"
        self.assertEqual(self.request("POST", "/frame", JPEG, headers)[0], 400)
        headers = self.frame_headers()
        headers["Content-Type"] = "text/plain"
        self.assertEqual(self.request("POST", "/frame", JPEG, headers)[0], 415)
        headers = self.frame_headers()
        headers["Content-Length"] = "1048577"
        self.assertEqual(self.request("POST", "/frame", b"", headers)[0], 413)
        self.assertEqual(self.request("GET", "/../README_KO.md")[0], 404)

    def test_origin_host_and_sender_collision(self):
        headers = {"X-Solaris-Token": TOKEN, "Origin": "https://untrusted.invalid"}
        self.assertEqual(self.request("GET", "/stats", headers=headers)[0], 403)
        self.assertEqual(self.request("GET", "/", headers={"Host": "untrusted.invalid"})[0], 403)
        self.request("POST", "/frame", JPEG, self.frame_headers())
        headers = self.frame_headers()
        headers["X-Solaris-Session"] = "99999999-abcd-1234-abcd-123456789012"
        self.assertEqual(self.request("POST", "/frame", JPEG, headers)[0], 409)

    def test_bind_validation(self):
        for address in ("127.0.0.1", "192.168.0.4", "10.0.0.2", "172.16.0.1"):
            self.assertTrue(allowed_ip(address))
        for address in ("0.0.0.0", "8.8.8.8", "172.32.0.1", "example.com", "::1"):
            self.assertFalse(allowed_ip(address))

    def test_real_jpeg_bytes_roundtrip(self):
        # Reuse the supplied logo unchanged. Tests byte transport, not rendering.
        data = (Path(__file__).resolve().parents[1] / "ios/App/Resources/SolarisMark.jpeg").read_bytes()
        self.assertEqual(self.request("POST", "/frame", data, self.frame_headers())[0], 200)
        self.assertEqual(self.request("GET", "/frame", headers={"X-Solaris-Token": TOKEN})[2], data)

    def test_invalid_frame_and_metadata(self):
        for key, value in (("X-Capture-FPS", "inf"), ("X-Capture-FPS", "-1"),
                           ("X-Source-Size", "0x720"), ("X-Solaris-Session", "short"),
                           ("Transfer-Encoding", "chunked")):
            headers = self.frame_headers()
            headers[key] = value
            self.assertEqual(self.request("POST", "/frame", JPEG, headers)[0], 400)
        self.assertEqual(self.request("POST", "/frame", b"not-a-jpeg", self.frame_headers())[0], 400)

    def test_stale_cleanup_and_new_sender(self):
        self.request("POST", "/frame", JPEG, self.frame_headers())
        with self.server.state.lock:
            self.server.state.last = time.monotonic() - 4
        self.server.service_actions()
        self.assertIsNone(self.server.state.frame)
        headers = self.frame_headers()
        headers["X-Solaris-Session"] = "99999999-abcd-1234-abcd-123456789012"
        self.assertEqual(self.request("POST", "/frame", JPEG, headers)[0], 200)
        self.assertEqual(self.server.state.sequence, 1)

    def test_concurrent_uploads(self):
        results = []
        def upload():
            results.append(self.request("POST", "/frame", JPEG, self.frame_headers())[0])
        threads = [threading.Thread(target=upload) for _ in range(6)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=3)
        self.assertEqual(results, [200] * 6)
        self.assertEqual(self.server.state.sequence, 6)


if __name__ == "__main__":
    unittest.main()
