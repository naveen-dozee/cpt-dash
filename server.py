#!/usr/bin/env python3
"""Lightweight static file server with MDB query proxy for the CPT notes dashboard."""

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = 8770
DEFAULT_LIMIT = "2000"

MDB_ENDPOINT = ""
MDB_NOTES_PATH = ""


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
    root = Path(__file__).resolve().parent
    stage = os.getenv("STAGE", "sit")
    _load_env_file(root / ".env", override=False)
    _load_env_file(root / f".env.{stage}", override=True)


def mdb_notes_query_path() -> str:
    database = os.getenv("MDB_DATABASE", "dozee")
    collection = os.getenv("MDB_NOTES_COLLECTION", "notes")
    return f"/api/{database}/{collection}/query"


def init_config() -> None:
    global MDB_ENDPOINT, MDB_NOTES_PATH
    load_env()
    MDB_ENDPOINT = os.getenv("MDB_ENDPOINT", "http://mdb-sit.dozee.int")
    MDB_NOTES_PATH = mdb_notes_query_path()


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.dirname(os.path.abspath(__file__)), **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/cpt-notes":
            self._proxy_cpt_notes(parsed.query)
            return
        if parsed.path == "/api/config":
            self._send_json(
                200,
                {
                    "mdb_endpoint": MDB_ENDPOINT,
                    "mdb_notes_path": MDB_NOTES_PATH,
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
    print(f"MDB endpoint: {MDB_ENDPOINT}{MDB_NOTES_PATH}")
    server.serve_forever()


if __name__ == "__main__":
    main()
