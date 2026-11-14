"""multistill.py OUT.png W H COLS 'js-setup-expr;t' ...  -> one browser, many stills, tiled into a sheet.
Each arg: 'EXPR|t' where EXPR is JS run before captureFrame(t) (e.g. window.__pose={tt:3}). Env Q adds query."""
import base64, io, os, sys
from playwright.sync_api import sync_playwright
from PIL import Image
import serve
out, W, H, cols = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
items = sys.argv[5:]
srv, port = serve.start_server()
ims = []
with sync_playwright() as pw:
    b, pg = serve.open_page(pw, port, W, H, os.environ.get('Q', ''))
    try:
        for it in items:
            expr, t = it.rsplit('|', 1)
            if expr: pg.evaluate(expr)
            ims.append(Image.open(io.BytesIO(base64.b64decode(pg.evaluate("([t]) => captureFrame(t, 'png')", [float(t)])))).convert('RGB'))
            print('.', end='', flush=True)
    finally:
        b.close(); srv.shutdown()
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (W * min(cols, len(ims)), H * rows))
for i, im in enumerate(ims): sheet.paste(im, ((i % cols) * W, (i // cols) * H))
sheet.save(out); print(out)
