#!/usr/bin/env python3
"""ShopperLab local server.

Serves the app on http://localhost:8000 (a secure context, so the webcam works)
and proxies model calls so your Hugging Face token never reaches the browser.

    export HF_TOKEN=hf_xxx        # optional, only needed for the model layer
    python run.py                 # then open http://localhost:8000

Everything else — the store, the tracking, the simulation, the scoring — runs
with no network at all beyond the CDN modules.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
HF_URL = os.environ.get("HF_ROUTER_URL", "https://router.huggingface.co/v1/chat/completions")
PORT = int(os.environ.get("PORT", "8000"))


def read_token():
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")
    if token:
        return token.strip()
    env_path = os.path.join(ROOT, ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line.startswith("HF_TOKEN=") or line.startswith("HUGGINGFACE_HUB_TOKEN="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # the MediaPipe wasm build is happier with these, and they cost nothing locally
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/"):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def do_POST(self):
        if self.path.rstrip("/") != "/api/hf":
            self.send_error(404, "Unknown endpoint")
            return

        token = read_token()
        if not token:
            self._json(
                401,
                {
                    "error": "No Hugging Face token on the server. Set HF_TOKEN in your "
                             "environment or a .env file next to run.py, then restart. "
                             "You can also turn the proxy off in setup and paste a token "
                             "into the page instead."
                },
            )
            return

        length = int(self.headers.get("Content-Length", "0"))
        payload = self.rfile.read(length)

        req = urllib.request.Request(
            HF_URL,
            data=payload,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "User-Agent": "shopperlab/0.1",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                body = resp.read()
                self._raw(resp.status, body)
        except urllib.error.HTTPError as err:
            self._raw(err.code, err.read())
        except Exception as err:  # noqa: BLE001 - surface anything to the browser
            self._json(502, {"error": f"Could not reach the model router: {err}"})

    def _json(self, status, obj):
        self._raw(status, json.dumps(obj).encode("utf-8"))

    def _raw(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    have_token = "yes" if read_token() else "no (model layer will be unavailable)"
    print("ShopperLab")
    print(f"  serving   {ROOT}")
    print(f"  open      http://localhost:{PORT}")
    print(f"  HF token  {have_token}")
    print("  stop      Ctrl-C\n")
    ThreadingHTTPServer(("127.0.0.1", PORT), partial(Handler)).serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")
