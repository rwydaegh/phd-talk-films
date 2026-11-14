# Films from my PhD defense talk

This repository has the 4K versions of the films I showed in my PhD defense talk on radio waves and the human body, and the code that renders them.

<p>
<img src="gifs/film01.gif" width="49%" alt="Film 1">
<img src="gifs/film14.gif" width="49%" alt="Film 14">
<img src="gifs/film20.gif" width="49%" alt="Film 20">
<img src="gifs/film29.gif" width="49%" alt="Film 29">
</p>

## Films

All films are 3840 x 2160, 30 fps, H.264 and silent.

| Film | Length | Shows |
|---|---|---|
| [Card](https://github.com/rwydaegh/phd-talk-films/releases/download/v1/card_4k.mp4) | 0:24 | The invitation card as a seamless loop |
| [Film 1](https://github.com/rwydaegh/phd-talk-films/releases/download/v1/film01_plane_wave_4k.mp4) | 2:01 | What a radio wave is and how the body absorbs it |
| [Film 7](https://github.com/rwydaegh/phd-talk-films/releases/download/v1/film07_phantoms_4k.mp4) | 0:41 | Four computer models of the human body, cut open to show their tissues |
| [Film 10](https://github.com/rwydaegh/phd-talk-films/releases/download/v1/film10_factory_4k.mp4) | 1:23 | Antennas in a factory hall send rays to a worker on a phone call |
| [Film 14](https://github.com/rwydaegh/phd-talk-films/releases/download/v1/film14_new_york_4k.mp4) | 0:48 | A pedestrian in New York and the field around her ear |
| [Film 16](https://github.com/rwydaegh/phd-talk-films/releases/download/v1/film16_robot_4k.mp4) | 0:49 | Lab measurements next to the simulated maps |
| [Film 20](https://github.com/rwydaegh/phd-talk-films/releases/download/v1/film20_statue_4k.mp4) | 0:36 | A light on a bust turns into a radio wave with the same pattern |
| [Film 24](https://github.com/rwydaegh/phd-talk-films/releases/download/v1/film24_race_4k.mp4) | 0:15 | A full-wave simulation next to the fast surface method |
| [Film 27](https://github.com/rwydaegh/phd-talk-films/releases/download/v1/film27_beam_4k.mp4) | 0:37 | A beam reaches the phone and moves off the body |
| [Film 29](https://github.com/rwydaegh/phd-talk-films/releases/download/v1/film29_cities_4k.mp4) | 0:44 | Rays traced from a pedestrian, then routes in ten cities |
| [Film 34](https://github.com/rwydaegh/phd-talk-films/releases/download/v1/film34_close_4k.mp4) | 0:34 | The closing shot, from a child back to the invitation card |

## Slides

The [slides](https://github.com/rwydaegh/phd-talk-films/releases/download/v1/phd_talk_slides.pdf) are a PDF with one page per build step. Each film is shown as its last frame. The phasor animation from the slides is a separate [video](https://github.com/rwydaegh/phd-talk-films/releases/download/v1/phasors_animation.mp4).

## Blender files

The films are three.js renders (see [Rendering the films](#rendering-the-films)). The [Blender files](https://github.com/rwydaegh/phd-talk-films/releases/download/v1/blender_files.zip) are the two animated scenes from the invitation.

More about the work:

- The talk: https://phd.rwydaeghe.be/talk/
- The thesis: https://phd.rwydaeghe.be/thesis/

## Rendering the films

The films are three.js scenes that render frame by frame in a headless browser. The code for every film is in [`films/`](films). Each film folder has a README with its exact render command and the data files that are not in this repository.

You need:

- Python 3.11 or newer with [uv](https://docs.astral.sh/uv/)
- ffmpeg
- A GPU with WebGPU support in Chromium. On Linux, an NVIDIA GPU with Vulkan works.

Set up once:

```
uv sync
uv run playwright install chromium
uv run python tools/get_three.py
```

`get_three.py` puts three.js r186 into each film folder. Then render a film from its `film/` folder, for example:

```
cd films/16_robot/film
GPU=1 uv run python capture.py --out film16.mp4 --width 3840 --height 2160 --fps 30 --sub 1 --crf 17 --preset slow
```

`--sub` sets the number of sub-frames for motion blur. Without `GPU=1`, Chromium uses its software renderer. That is slow, but it is good for a quick test at low resolution: `uv run python still.py test 480 270 10` saves the frame at 10 s.

### Data that is not in this repository

Some films use data that I cannot share. You can get it from the source and make the film files with the scripts in each film folder.

| Data | Films | Where to get it |
|---|---|---|
| Photorealistic 3D Tiles | 1, 14, 29 | A Google Maps Platform API key with the Map Tiles API. Then run `tools/fetch_tiles.py`. |
| Virtual Population (Duke, Ella, Eartha, Thelonious) | 1, 7, 10, 20, 24, 27, 29, 34, card | A licence from the IT'IS Foundation, https://itis.swiss |
| SMPL-X body model | 10, 14, 27 | Free registration for non-commercial use, https://smpl-x.is.tue.mpg.de |
| Mixamo character and animations | 10, 14, 27 | A free Adobe account, https://www.mixamo.com |

Film 16 runs with the data in this repository.

## Credit and license

Credit: Robin Wydaeghe, WAVES, Ghent University – imec

The films, slides, Blender files and data are licensed under [CC BY 4.0](LICENSE). The code is licensed under the [MIT License](LICENSE-CODE). three.js is MIT, (c) three.js authors. The fonts are under the SIL Open Font License (see `assets/fonts/NOTICE.txt` in each film). The licenses cover my own work. Third-party data in the films keeps its own terms:

- City buildings in films 1, 14 and 29: Map data ©Google (Photorealistic 3D Tiles)
- Body models in films 1, 7, 10, 20, 24, 29, 34 and the card: IT'IS Foundation, Virtual Population
- Body shapes in films 10, 14 and 27: SMPL-X, Max Planck Institute for Intelligent Systems
- Walking animation in film 14: Mixamo, Adobe
