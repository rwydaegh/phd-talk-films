# Films 20 and 24: the statue

One scene gives two films. Film 20 turns a light on a bust into a radio wave. Film 24 compares a full-wave simulation with the fast surface method.

```
GPU=1 python capture.py --out film20.mp4 --width 3840 --height 2160 --fps 30 --sub 3 --crf 17 --preset slow --q '&film=20&sh=4096'
GPU=1 python capture.py --out film24.mp4 --width 3840 --height 2160 --fps 30 --sub 3 --crf 17 --preset slow --q '&film=24&sh=4096'
```

## Missing files

The bust meshes and voxels come from Thelonious (IT'IS Virtual Population). With `PHANTOM_CACHE` set as in [`tools/phantoms`](../../tools/phantoms):

```
python ../../tools/phantoms/prep3d.py          # writes body_full.npz into the cache
python tools/prep_bust.py bust_hi -0.14         # film 20
python tools/prep_bust.py bust_lo -0.30         # film 24
python tools/prep_statue.py bust_st
python tools/prep_voxels.py vox_lo bust_lo -0.30 40 20
```

The LaTeX glyphs (`tex_k.png`, `tex_n.png`) are included. `tools/prep_tex.py` makes them again.
