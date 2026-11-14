# Film 29: ten cities

```
GPU=1 python capture.py --out film29.mp4 --width 3840 --height 2160 --fps 30 --sub 4 --crf 17 --preset slow
```

The routes, exposure values and rays are included (`film/data/cities.json`, `rays_prague_staromestske_8.json`).

## Missing files

City tiles, one folder per site in `film/assets/tiles/`:

```
python ../../tools/fetch_tiles.py film/assets/tiles/brussels_grandplace 50.84673 4.35247 250
python ../../tools/fetch_tiles.py film/assets/tiles/korenmarkt          51.055   3.722   200
python ../../tools/fetch_tiles.py film/assets/tiles/krakow_rynek        50.06166 19.93727 250
python ../../tools/fetch_tiles.py film/assets/tiles/london_trafalgar    51.508  -0.12805 250
python ../../tools/fetch_tiles.py film/assets/tiles/madrid_plazamayor   40.41552 -3.70744 250
python ../../tools/fetch_tiles.py film/assets/tiles/mexico_zocalo       19.43264 -99.13321 250
python ../../tools/fetch_tiles.py film/assets/tiles/milan_duomo         45.4642  9.19    320
python ../../tools/fetch_tiles.py film/assets/tiles/prague_staromestske 50.08758 14.42134 250
python ../../tools/fetch_tiles.py film/assets/tiles/tokyo_hachiko       35.65947 139.70046 250
python ../../tools/fetch_tiles.py film/assets/tiles/toulouse_capitole   43.60447 1.44422 130
```

The body on the route is Duke (IT'IS Virtual Population) with the absorbed power on his skin:

| File | Format |
|---|---|
| `film/data/duke.bin`, `duke.json` | Duke's skin: Float32 positions, Float32 normals, Uint32 triangle indices. The JSON gives the counts. |
| `film/data/sab.bin` | Float16 per vertex: surface absorbed power in dB re the global maximum, one block per direction (163 blocks) |

These come from an exposure study that is not public yet.
