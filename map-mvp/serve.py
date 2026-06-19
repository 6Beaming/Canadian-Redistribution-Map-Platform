#!/usr/bin/env python3
"""Static file server with HTTP Range (byte serving) support for PMTiles."""

from __future__ import annotations

import argparse
import os
import re
import socket
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path


class ByteRangeRequestHandler(SimpleHTTPRequestHandler):
    """Serve static files with Accept-Ranges and 206 Partial Content."""

    def end_headers(self) -> None:
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()

        ctype = self.guess_type(path)
        try:
            file_obj = open(path, "rb")
        except OSError:
            self.send_error(404, self.responses[404][0])
            return None

        file_size = os.fstat(file_obj.fileno()).st_size
        range_header = self.headers.get("Range")

        if range_header:
            match = re.fullmatch(r"bytes=(\d+)-(\d*)", range_header.strip())
            if match:
                start = int(match.group(1))
                end = int(match.group(2)) if match.group(2) else file_size - 1

                if start >= file_size or start > end:
                    self.send_error(416, "Requested Range Not Satisfiable")
                    self.send_header("Content-Range", f"bytes */{file_size}")
                    file_obj.close()
                    return None

                end = min(end, file_size - 1)
                length = end - start + 1

                self.send_response(206)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
                self.send_header("Content-Length", str(length))
                self.end_headers()

                file_obj.seek(start)
                self._range_read_limit = length
                return file_obj

        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(file_size))
        self.end_headers()
        return file_obj

    def copyfile(self, source, outputfile):
        if hasattr(self, "_range_read_limit"):
            remaining = self._range_read_limit
            while remaining > 0:
                chunk = source.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                outputfile.write(chunk)
                remaining -= len(chunk)
            del self._range_read_limit
        else:
            super().copyfile(source, outputfile)


class ExclusiveHTTPServer(HTTPServer):
    """Avoid duplicate binds on Windows (SO_REUSEADDR allows port sharing there)."""

    allow_reuse_address = False


def port_is_available(host: str, port: int) -> bool:
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    except (AttributeError, OSError):
        pass
    try:
        probe.bind((host, port))
        return True
    except OSError:
        return False
    finally:
        probe.close()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Serve map-mvp with PMTiles byte-range support"
    )
    parser.add_argument("--port", "-p", type=int, default=8080)
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Bind address (default: 127.0.0.1 — use this URL in the browser)",
    )
    parser.add_argument(
        "--directory",
        "-d",
        default=".",
        help="Directory to serve (default: current directory)",
    )
    args = parser.parse_args()

    root = Path(args.directory).resolve()
    os.chdir(root)

    if not port_is_available(args.host, args.port):
        print(
            f"ERROR: Port {args.port} on {args.host} is already in use.\n"
            "Stop other servers first (e.g. old `python -m http.server` tabs):\n"
            "  Get-NetTCPConnection -LocalPort 8080 | Select OwningProcess\n"
            "  Stop-Process -Id <pid>\n"
            "Then run: python serve.py",
            file=sys.stderr,
        )
        return 1

    handler = lambda *handler_args, **handler_kwargs: ByteRangeRequestHandler(
        *handler_args, directory=str(root), **handler_kwargs
    )
    server = ExclusiveHTTPServer((args.host, args.port), handler)
    url = f"http://{args.host}:{args.port}/"
    print(f"Serving {root}", flush=True)
    print(f"Open {url} (byte-range enabled for PMTiles)", flush=True)
    if args.host == "127.0.0.1":
        print("Tip: use 127.0.0.1 — not localhost — if you previously ran http.server.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
