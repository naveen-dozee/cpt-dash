#!/usr/bin/env python3
"""Lightweight static file server with MDB query proxy for the CPT notes dashboard."""

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = 8770
DEFAULT_LIMIT = "2000"
HTML_VIEW_RE = re.compile(
    r"^/api/cpt-notes/([0-9a-f-]{36})/html/view$",
    re.IGNORECASE,
)

MDB_ENDPOINT = ""
MDB_NOTES_PATH = ""
API_ENDPOINT = ""
API_TOKEN = ""
STAGE = "sit"

STAGE_DEFAULTS = {
    "sit": {
        "MDB_ENDPOINT": "http://mdb.dozee.int",
        "MDB_NOTES_COLLECTION": "notes-sit",
        "API_ENDPOINT": "http://api-sit.dozee.int",
    },
    "prod": {
        "MDB_ENDPOINT": "http://mdb.dozee.int",
        "MDB_NOTES_COLLECTION": "notes",
        "API_ENDPOINT": "http://api.dozee.int",
    },
}


def _load_env_file(path: Path, *, override: bool) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if not key:
            continue
        if override:
            os.environ[key] = value
        else:
            os.environ.setdefault(key, value)


def load_env() -> None:
    global STAGE
    root = Path(__file__).resolve().parent
    _load_env_file(root / ".env", override=False)
    STAGE = os.getenv("STAGE", "sit")
    _load_env_file(root / f".env.{STAGE}", override=True)


def stage_default(key: str) -> str:
    return STAGE_DEFAULTS.get(STAGE, STAGE_DEFAULTS["sit"])[key]


def mdb_notes_query_path() -> str:
    database = os.getenv("MDB_DATABASE", "dozee")
    collection = os.getenv("MDB_NOTES_COLLECTION", stage_default("MDB_NOTES_COLLECTION"))
    return f"/api/{database}/{collection}/query"


def init_config() -> None:
    global MDB_ENDPOINT, MDB_NOTES_PATH, API_ENDPOINT, API_TOKEN
    load_env()
    MDB_ENDPOINT = os.getenv("MDB_ENDPOINT", stage_default("MDB_ENDPOINT"))
    MDB_NOTES_PATH = mdb_notes_query_path()
    API_ENDPOINT = os.getenv("API_ENDPOINT", stage_default("API_ENDPOINT")).rstrip("/")
    API_TOKEN = os.getenv("API_TOKEN", "")


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.dirname(os.path.abspath(__file__)), **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/cpt-notes":
            self._proxy_cpt_notes(parsed.query)
            return
        html_match = HTML_VIEW_RE.match(parsed.path)
        if html_match:
            self._proxy_html_view(html_match.group(1))
            return
        if parsed.path == "/api/config":
            self._send_json(
                200,
                {
                    "stage": STAGE,
                    "mdb_endpoint": MDB_ENDPOINT,
                    "mdb_notes_path": MDB_NOTES_PATH,
                    "api_endpoint": API_ENDPOINT,
                },
            )
            return
        super().do_GET()

    def _proxy_cpt_notes(self, query_string: str):
        params = urllib.parse.parse_qs(query_string, keep_blank_values=True)
        mdb_params = []

        for key in ("filter", "span", "limit", "sort", "order", "datespan"):
            for value in params.get(key, []):
                mdb_params.append((key, value))

        if not any(k == "limit" for k, _ in mdb_params):
            mdb_params.append(("limit", DEFAULT_LIMIT))

        url = f"{MDB_ENDPOINT}{MDB_NOTES_PATH}?{urllib.parse.urlencode(mdb_params)}"
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(body)
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode("utf-8", errors="replace")
            self._send_json(exc.code, {"error": err_body or exc.reason})
        except Exception as exc:
            self._send_json(502, {"error": str(exc)})

    def _proxy_html_view(self, report_ref_id: str) -> None:
        url = f"{API_ENDPOINT}/api/v1/cpt/notes/{report_ref_id}/html/get"
        headers = {"Accept": "application/json"}
        if API_TOKEN:
            headers["Authorization"] = f"Bearer {API_TOKEN}"
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=120) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode("utf-8", errors="replace")
            self._send_json(exc.code, {"error": err_body or exc.reason})
            return
        except Exception as exc:
            self._send_json(502, {"error": str(exc)})
            return

        html = payload.get("Html") or payload.get("html")
        if not html:
            self._send_json(404, {"error": "Response did not contain Html"})
            return

        body = _wrap_html_fragment(html, report_ref_id).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        if args and isinstance(args[0], str) and args[0].startswith("GET /api/"):
            super().log_message(fmt, *args)


def _wrap_html_fragment(fragment: str, report_ref_id: str) -> str:
    trimmed = fragment.lstrip()
    lowered = trimmed.lower()
    if lowered.startswith("<!doctype") or lowered.startswith("<html"):
        return fragment
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>CPT Note {report_ref_id}</title>
</head>
<body>
{fragment}
</body>
</html>
"""


def bind_server(start_port: int, attempts: int = 10) -> tuple[ThreadingHTTPServer, int]:
    last_error = None
    for offset in range(attempts):
        port = start_port + offset
        try:
            server = ThreadingHTTPServer(("", port), DashboardHandler)
            server.allow_reuse_address = True
            return server, port
        except OSError as exc:
            if exc.errno != 48:  # Address already in use
                raise
            last_error = exc
    raise SystemExit(
        f"Ports {start_port}-{start_port + attempts - 1} are in use. "
        f"Stop the existing server or change PORT in server.py.\n"
        f"Last error: {last_error}"
    )


def main():
    init_config()
    server, port = bind_server(PORT)
    if port != PORT:
        print(f"Port {PORT} is in use; using {port} instead.")
    print(f"CPT notes dashboard: http://localhost:{port}")
    print(f"Stage: {STAGE}")
    print(f"MDB endpoint: {MDB_ENDPOINT}{MDB_NOTES_PATH}")
    print(f"API endpoint: {API_ENDPOINT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
