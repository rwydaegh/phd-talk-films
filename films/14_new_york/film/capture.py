"""Render a time range and pipe JPEG frames into ffmpeg (no frame sequences on disk).
capture.py --out x.mp4 --width 960 --height 540 --fps 30 [--start --end] [--sub 4] [--crf 18]"""
import argparse, base64, os, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
import serve
ap = argparse.ArgumentParser()
ap.add_argument("--start", type=float, default=0.0); ap.add_argument("--end", type=float, default=None)
ap.add_argument("--fps", type=float, default=30); ap.add_argument("--width", type=int, default=960); ap.add_argument("--height", type=int, default=540)
ap.add_argument("--out", required=True); ap.add_argument("--sub", type=int, default=1); ap.add_argument("--crf", default="20")
ap.add_argument("--preset", default="medium"); ap.add_argument("--q", default="")
a = ap.parse_args()
Path(a.out).parent.mkdir(parents=True, exist_ok=True)
srv, port = serve.start_server()
with sync_playwright() as pw:
    b, pg = serve.open_page(pw, port, a.width, a.height, f"&sub={a.sub}{a.q}")
    ff = None
    try:
        end = a.end if a.end is not None else pg.evaluate("window.filmDuration")
        n = int(round((end - a.start) * a.fps))
        ff = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "image2pipe", "-framerate", str(a.fps), "-i", "-",
                               "-c:v", "libx264", "-preset", a.preset, "-crf", a.crf, "-pix_fmt", "yuv420p", "-movflags", "+faststart", a.out], stdin=subprocess.PIPE)
        print(f"{n} frames {a.start}-{end}s at {a.fps} fps {a.width}x{a.height} sub {a.sub}", flush=True)
        t0 = time.monotonic()
        for i in range(n):
            ff.stdin.write(base64.b64decode(pg.evaluate("([t]) => captureFrame(t, 'jpeg', 0.95)", [a.start + i / a.fps])))
            if (i + 1) % 30 == 0: print(f"  {i+1}/{n}  {(time.monotonic()-t0)/(i+1):.2f} s/frame", flush=True)
        ff.stdin.close(); ff.wait()
        print(f"done {n} frames in {time.monotonic()-t0:.0f}s -> {a.out}", flush=True)
    finally:
        b.close()
        if ff and ff.poll() is None: ff.kill()
        srv.shutdown()
