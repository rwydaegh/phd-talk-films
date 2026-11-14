"""LaTeX glyphs for the film overlay: prep_tex.py WORKDIR -> film/assets/tex_NAME.png (white on transparent, NewCM, 1200 dpi)."""
import subprocess, sys
from pathlib import Path
W = Path(sys.argv[1]); OUT = Path(__file__).resolve().parents[1] / "film" / "assets"
SRC = {"n": r"\hat{\symbf n}", "k": r"\hat{\symbf k}"}
T = r"""\documentclass[border=1pt]{standalone}\usepackage{xcolor}\usepackage{unicode-math}
\setmathfont{NewCMMath-Book.otf}\begin{document}\color{white}$%s$\end{document}"""
for k, s in SRC.items():
    (W / f"{k}.tex").write_text(T % s)
    subprocess.run(["lualatex", "-interaction=nonstopmode", "-halt-on-error", f"{k}.tex"], cwd=W, check=True, capture_output=True)
    subprocess.run(["pdftocairo", "-png", "-transp", "-r", "1200", "-singlefile", f"{k}.pdf", str(OUT / f"tex_{k}")], cwd=W, check=True)
    print(OUT / f"tex_{k}.png")
