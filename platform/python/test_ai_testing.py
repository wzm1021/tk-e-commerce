"""Offline contract tests against the installed official SDK; every HTTP call is mocked."""
import base64
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import requests
from ai_testing import execute

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEukAAAAASUVORK5CYII=")

def response(body, status=200):
    r = requests.Response()
    r.status_code = status
    r._content = json.dumps(body).encode()
    return r

class BridgeTests(unittest.TestCase):
    def invoke(self, payload):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            execute({"key": "fl_offline_fixture", **payload})
        return [json.loads(line) for line in out.getvalue().splitlines()]

    def test_real_sdk_create_upload_start_and_receipts(self):
        api, uploads = [], []
        def send(session, method, url, **kwargs):
            api.append((method, url, kwargs))
            self.assertEqual(session.headers["Authorization"], "Bearer fl_offline_fixture")
            self.assertFalse(kwargs["allow_redirects"])
            if url.endswith("/start"):
                return response({"id": "pt_fixture", "status": "queued"})
            self.assertEqual(url, "https://qyzkdesign.com/api/v1/product-tests")
            self.assertEqual(kwargs["headers"]["Idempotency-Key"], "ai:offline:1")
            self.assertEqual(kwargs["json"]["arms"][0]["content_type"], "image/png")
            return response({"id": "pt_fixture", "status": "awaiting_upload", "upload_urls": {
                a: {"url": "https://uploads.example.invalid/" + a, "content_type": "image/png"} for a in ["A", "B"]}})
        def put(url, **kwargs):
            uploads.append(url)
            self.assertEqual(kwargs["headers"], {"Content-Type": "image/png"})
            self.assertEqual(kwargs["data"], PNG)
            return response({})
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "page.png"
            image.write_bytes(PNG)
            with patch.object(requests.Session, "request", send), patch.object(requests, "put", put):
                events = self.invoke({"action": "create", "spec": {"arms": [{"id": "A"}, {"id": "B"}]}, "images": {"A": str(image), "B": str(image)}, "idempotency_key": "ai:offline:1"})
        self.assertEqual(len(uploads), 2)
        self.assertEqual(len(api), 2)
        self.assertEqual([e.get("status") for e in events if e.get("event") == "receipt"], ["awaiting_upload", "queued"])
        self.assertEqual(events[-1]["result"]["status"], "queued")
        self.assertNotIn("fl_offline_fixture", json.dumps(events))

    def test_audience_estimate_get_cancel_use_official_sdk(self):
        called = []
        def send(_session, method, url, **kwargs):
            called.append((method.upper(), url, kwargs))
            return response({"id": "pt_fixture", "status": "cancelled"}) if url.endswith("/cancel") else response({"ok": True})
        with patch.object(requests.Session, "request", send):
            self.invoke({"action": "audience", "market": "amazon_us"})
            self.invoke({"action": "estimate", "spec": {"name": "fixture"}})
            self.invoke({"action": "get", "id": "pt_fixture"})
            self.invoke({"action": "cancel", "id": "pt_fixture"})
        self.assertEqual(called[0][2]["params"], {"market": "amazon_us"})
        self.assertEqual(called[1][2]["json"], {"name": "fixture"})
        self.assertEqual(called[2][2]["params"], {"include": "personas"})
        self.assertTrue(called[3][1].endswith("/pt_fixture/cancel"))

    def test_provider_error_only_exposes_code_and_data_gaps(self):
        def send(*args, **kwargs):
            return response({"error": {"code": "free_tier_limit", "message": "private fl_offline_fixture /provider/path", "details": {"limit": 6}}}, 403)
        with patch.object(requests.Session, "request", send):
            events = self.invoke({"action": "estimate", "spec": {}})
        self.assertEqual(events[-1]["error"], "free_tier_limit")
        self.assertNotIn("private", json.dumps(events))
        self.assertNotIn("fl_offline_fixture", json.dumps(events))

    def test_invalid_image_never_creates_remote_task(self):
        with patch.object(requests.Session, "request", side_effect=AssertionError("network forbidden")):
            events = self.invoke({"action": "create", "spec": {"arms": [{"id": "A"}]}, "images": {}, "idempotency_key": "ai:offline:1"})
        self.assertEqual(events[-1]["error"], "invalid_image")

if __name__ == "__main__":
    unittest.main()
