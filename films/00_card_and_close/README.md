# Card and film 34

One scene gives two films: the invitation card as a loop, and the closing shot from the child back to the card.

```
GPU=1 python capture.py --out card.mp4    --width 3840 --height 2160 --fps 30 --sub 4 --crf 17 --preset slow --q '&film=card'
GPU=1 python capture.py --out film34.mp4  --width 3840 --height 2160 --fps 30 --sub 4 --crf 17 --preset slow --q '&film=f34'
```

## Missing files

| File | Contents | How to make it |
|---|---|---|
| `film/assets/child.bin`, `child.json` | Thelonious (IT'IS Virtual Population) with per-vertex antenna visibility | `tools/bake_child.py` and `tools/pack_child.py` in [`01_plane_wave`](../01_plane_wave), then copy the two files here |
