# Film 14: New York

```
GPU=1 python capture.py --out film14.mp4 --width 3840 --height 2160 --fps 30 --sub 4 --crf 17 --preset slow --q '&film=nyc'
```

## Missing files

| File | Contents | How to make it |
|---|---|---|
| `film/assets/tiles/wtc/` | Google 3D Tiles near the World Trade Center | `python ../../tools/fetch_tiles.py film/assets/tiles/wtc 40.7113 -74.0132 280` |
| `film/assets/tiles/lm/` | Google 3D Tiles of Lower Manhattan, for the wide shots | `python ../../tools/fetch_tiles.py film/assets/tiles/lm 40.7113 -74.0132 1300` |
| `film/assets/human/smplx_neutral.*` | SMPL-X body | `tools/smplx_body.py` in [`10_factory`](../10_factory), then copy here |
| `film/assets/mixamo/Y Bot.fbx`, `Walking.fbx`, `Talking On Phone.fbx` | Mixamo character and clips (free Adobe account) | Download as FBX, with skin, 30 fps |

The tile set from the API changes over time. If the street moved, run `python tools/prep_tiles.py` and adjust `film/data/route.json`.
