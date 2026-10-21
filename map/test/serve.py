#!/usr/bin/env python3
"""Local static server with HTTP Range support, for testing map/index.html against the
fixture tiles (PMTiles are read by byte range; Python's stock http.server ignores Range).

    cd map && python3 test/serve.py 3000
    open http://localhost:3000/index.html?manifest=test/manifest.fixture.json

Serves the directory it is started in. No dependencies beyond the standard library."""
import os, re, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class RangeHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        path = self.translate_path(self.path)
        rng = self.headers.get("Range")
        if os.path.isdir(path) or not rng:
            return super().send_head()
        m = re.match(r"bytes=(\d*)-(\d*)$", rng.strip())
        if not m or not os.path.isfile(path):
            return super().send_head()
        size = os.path.getsize(path)
        start = int(m.group(1)) if m.group(1) else max(0, size - int(m.group(2)))
        end = int(m.group(2)) if (m.group(1) and m.group(2)) else size - 1
        end = min(end, size - 1)
        if start > end or start >= size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return None
        f = open(path, "rb")
        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self._range_len = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        n = getattr(self, "_range_len", None)
        if n is None:
            return super().copyfile(source, outputfile)
        remaining = n
        while remaining > 0:
            chunk = source.read(min(65536, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)
        self._range_len = None

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
    print(f"serving {os.getcwd()} on http://localhost:{port}/ (Range supported)")
    ThreadingHTTPServer(("127.0.0.1", port), RangeHandler).serve_forever()
