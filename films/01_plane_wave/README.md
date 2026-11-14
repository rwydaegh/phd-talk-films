# Film 1: the plane wave

```
GPU=1 python capture.py --out film01.mp4 --width 3840 --height 2160 --fps 30 --sub 4 --crf 17 --preset slow
```

## Missing files

| File | Contents | How to make it |
|---|---|---|
| `film/assets/tiles/korenmarkt/` | Google Photorealistic 3D Tiles of the Korenmarkt, Ghent | `python ../../tools/fetch_tiles.py film/assets/tiles/korenmarkt 51.055 3.722 200` |
| `film/assets/child.bin`, `child.json` | Thelonious (IT'IS Virtual Population) with per-vertex antenna visibility and ambient occlusion | See below |

To make the child mesh, export Thelonious as a cleaned PLY surface and get `bake.json` (the 120 antenna positions and the camera of the invitation card) from https://phd.rwydaeghe.be/assets/kind/bake.json. Then run, from this folder:

```
export THELONIOUS_PLY=/path/to/thelonious.ply CHILD_BAKE_JSON=/path/to/bake.json
for i in 0 1 2 3; do blender -b --python tools/bake_child.py -- $i 4 bake_out & done; wait
python tools/pack_child.py bake_out
```

`pack_child.py` writes into `film/assets/`. Copy the result to [`00_card_and_close`](../00_card_and_close) too.
