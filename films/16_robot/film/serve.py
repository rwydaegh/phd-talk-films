"""Serve film/ on a free localhost port and launch Chromium (SwiftShader locally, real GPU with GPU=1)."""
import functools, http.server, os, threading
from pathlib import Path
ROOT = Path(__file__).resolve().parent
if os.environ.get('GPU'):
    CHROMIUM_ARGS = (["--use-angle=gl-egl", "--use-gl=angle", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--no-sandbox"]
                     if os.environ.get('ANGLE') == 'egl' else
                     ["--use-angle=vulkan", "--enable-features=Vulkan", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--no-sandbox"])
else:
    CHROMIUM_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"]

def start_server():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
        def end_headers(self):
            self.send_header('Cache-Control', 'no-store'); super().end_headers()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]

def open_page(pw, port, w, h, query=""):
    b = pw.chromium.launch(args=CHROMIUM_ARGS, headless=True)
    try:
        pg = b.new_page(viewport={"width": w, "height": h})
        pg.on("pageerror", lambda e: print("PAGE ERROR", e, flush=True))
        pg.on("console", lambda m: print("console:", m.text[:2000], flush=True) if m.type in ("error", "warning") else None)
        pg.goto(f"http://127.0.0.1:{port}/film.html?w={w}&h={h}{query}")
        pg.wait_for_function("window.renderReady === true || window.renderError", timeout=900_000)
        err = pg.evaluate("window.renderError || null")
        if err: raise RuntimeError(err)
    except BaseException:
        b.close(); raise
    return b, pg
