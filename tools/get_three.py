"""Put three.js r186 (MIT) into every film's film/vendor folder.

  python tools/get_three.py

The films import ./vendor/three-build/three.module.js and ./vendor/three-jsm/ (see film.html).
"""
import io, shutil, tarfile, urllib.request
from pathlib import Path

URL = 'https://registry.npmjs.org/three/-/three-0.186.0.tgz'
ROOT = Path(__file__).resolve().parents[1]

with urllib.request.urlopen(URL, timeout=120) as r:
    tgz = tarfile.open(fileobj=io.BytesIO(r.read()), mode='r:gz')
members = {m.name: m for m in tgz.getmembers() if m.isfile()}
for film in sorted((ROOT / 'films').glob('*/film')):
    vendor = film / 'vendor'
    shutil.rmtree(vendor, ignore_errors=True)
    for name, m in members.items():
        for src, dst in (('package/build/', 'three-build/'), ('package/examples/jsm/', 'three-jsm/'), ('package/LICENSE', 'LICENSE')):
            if name.startswith(src):
                target = vendor / (dst + name[len(src):])
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(tgz.extractfile(m).read())
    print('three.js r186 ->', vendor.relative_to(ROOT))
