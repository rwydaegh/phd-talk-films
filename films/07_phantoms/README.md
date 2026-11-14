# Film 7: four body models

```
GPU=1 python capture.py --out film07.mp4 --width 3840 --height 2160 --fps 30 --sub 4 --crf 17 --preset slow
```

## Missing files

All of `film/assets/ph/` is left out. It holds tissue labels, body volumes, glass shells and cut images of Duke, Ella, Eartha and Thelonious from the IT'IS Virtual Population (licence from https://itis.swiss).

With the Sim4Life exports (`<name>/*_Input.h5` per phantom, 3 mm voxels):

```
export VIP_H5_DIR=/path/to/phantom_voxels PHANTOM_CACHE=/path/to/cache
python prep/build.py
python prep/upsample.py
```

`build.py` uses the loaders in [`tools/phantoms`](../../tools/phantoms).
