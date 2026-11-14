"""Render stills: still.py OUTPREFIX W H t1 [t2 ...]  (env Q='&sub=4' adds query)"""
import base64, os, sys, time
from playwright.sync_api import sync_playwright
import serve
out, W, H = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]); ts = [float(x) for x in sys.argv[4:]]
srv, port = serve.start_server()
with sync_playwright() as pw:
    b, pg = serve.open_page(pw, port, W, H, os.environ.get('Q', ''))
    try:
        for t in ts:
            t0 = time.monotonic()
            b64 = pg.evaluate("([t]) => captureFrame(t, 'png')", [t])
            p = f"{out}_{t:06.2f}.png"; open(p, 'wb').write(base64.b64decode(b64))
            print(p, f"{time.monotonic()-t0:.1f}s", flush=True)
    finally:
        b.close(); srv.shutdown()
