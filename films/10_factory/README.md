# Films 10 and 27: the factory hall

One scene gives two films. Film 10 shows a distributed array and the field inside the head. Film 27 shows a beam that moves off the body.

```
GPU=1 python capture.py --out film10.mp4 --width 3840 --height 2160 --fps 30 --sub 2 --crf 17 --preset slow --q '&film=10'
GPU=1 python capture.py --out film27.mp4 --width 3840 --height 2160 --fps 30 --sub 2 --crf 17 --preset slow --q '&film=27'
```

The hall, the rays and the precoders are included (`film/data/scene*.json`, `paths*.json`). To make them again: `python tools/scene.py`, then `python tools/trace.py 10` and `python tools/trace.py 27`.

## Missing files

| File | Contents | How to make it |
|---|---|---|
| `film/assets/human/smplx_neutral.*` | SMPL-X body (free registration, non-commercial, https://smpl-x.is.tue.mpg.de) | `SMPLX_NPZ=/path/to/smplx_neutral_tensors.npz python tools/smplx_body.py` |
| `film/assets/mixamo/Y Bot.fbx`, `Idle.fbx`, `Talking On Phone.fbx` | Mixamo character and clips (free Adobe account, https://www.mixamo.com) | Download as FBX, with skin, 30 fps |
| `film/data/pose10.bin`, `pose27.bin`, `*_arm.bin` | The posed worker | `python tools/dump_pose.py 10` and `27` (needs the two rows above) |
| `film/data/vox10*` | Voxels of the posed head | `python tools/voxels.py` |
| `film/data/head_vox.*` | Duke's head and neck (IT'IS Virtual Population) | `PHANTOM_CACHE=/path/to/cache python tools/prep_head.py` |
| `film/data/slice10.*` | 2D FDTD field in a slice through the head | `python tools/fdtd2d.py` |

For `PHANTOM_CACHE`, see [`tools/phantoms`](../../tools/phantoms).
