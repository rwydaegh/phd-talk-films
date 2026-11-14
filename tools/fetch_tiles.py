"""Download Google Photorealistic 3D Tiles around a site into a folder that the films can load.

  GOOGLE_MAPS_API_KEY=... python tools/fetch_tiles.py OUT_DIR LAT LON RADIUS_M

Writes OUT_DIR/tile_NNNN.glb (the leaf tiles whose bounding box reaches into a vertical cylinder of RADIUS_M around
the site) and OUT_DIR/manifest.json. Needs a Google Maps Platform key with the Map Tiles API enabled.
The tiles stay under Google's terms: keep them for your own rendering and show "Map data ©Google".
"""
import json, math, os, sys, urllib.parse, urllib.request
from pathlib import Path

API = 'https://tile.googleapis.com'
KEY = os.environ.get('GOOGLE_MAPS_API_KEY')
if not KEY:
    sys.exit('Set GOOGLE_MAPS_API_KEY')
out, lat, lon, radius = Path(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4])
HALF_HEIGHT = 3000.0


def ecef(lat, lon, h=0.0):
    a, f = 6378137.0, 1 / 298.257223563
    e2 = f * (2 - f)
    la, lo = math.radians(lat), math.radians(lon)
    n = a / math.sqrt(1 - e2 * math.sin(la) ** 2)
    return [(n + h) * math.cos(la) * math.cos(lo), (n + h) * math.cos(la) * math.sin(lo), (n * (1 - e2) + h) * math.sin(la)]


C = ecef(lat, lon)
UP = [math.cos(math.radians(lat)) * math.cos(math.radians(lon)), math.cos(math.radians(lat)) * math.sin(math.radians(lon)), math.sin(math.radians(lat))]


def reaches(box):
    centre, axes = box[:3], [box[3:6], box[6:9], box[9:12]]
    r = sum(math.sqrt(sum(x * x for x in a)) for a in axes)
    d = [centre[i] - C[i] for i in range(3)]
    along = sum(d[i] * UP[i] for i in range(3))
    across = math.sqrt(max(sum(x * x for x in d) - along * along, 0.0))
    return across - r < radius and abs(along) - r < HALF_HEIGHT


def get(uri, session):
    q = {'key': KEY}
    if session:
        q['session'] = session
    url = urllib.parse.urljoin(API, uri)
    url += ('&' if '?' in url else '?') + urllib.parse.urlencode(q)
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def session_of(uri):
    return urllib.parse.parse_qs(urllib.parse.urlparse(uri).query).get('session', [None])[0]


tiles, requests = [], 0


def walk(tile, session):
    global requests
    if 'box' in tile.get('boundingVolume', {}) and not reaches(tile['boundingVolume']['box']):
        return
    children = tile.get('children', [])
    uri = (tile.get('content') or {}).get('uri')
    if uri:
        session = session_of(uri) or session
        path = urllib.parse.urlparse(uri).path
        if path.endswith('.json'):
            requests += 1
            sub = json.loads(get(path, session))
            walk(sub['root'], session)
        elif not children:
            requests += 1
            data = get(path, session)
            name = f'tile_{len(tiles):04d}.glb'
            (out / name).write_bytes(data)
            tiles.append({'file': name, 'geometric_error': tile.get('geometricError'), 'size': len(data)})
    for child in children:
        walk(child, session)


out.mkdir(parents=True, exist_ok=True)
root = json.loads(get('/v1/3dtiles/root.json', None))
walk(root['root'], None)
(out / 'manifest.json').write_text(json.dumps({'lat': lat, 'lon': lon, 'radius': radius, 'center_ecef': C, 'requests': requests,
                                               'attributions': 'Map data ©Google', 'tiles': tiles}, indent=1))
print(len(tiles), 'tiles,', requests, 'requests,', sum(t['size'] for t in tiles) // 1024, 'KB')
