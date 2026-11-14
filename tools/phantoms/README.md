# Phantom loaders

Shared loaders for the IT'IS Virtual Population (Duke, Ella, Eartha, Thelonious). The phantoms need a licence from https://itis.swiss.

- `VIP_H5_DIR`: folder with one subfolder per phantom, each with the Sim4Life `*_Input.h5` export.
- `PHANTOM_CACHE`: folder for the cached voxel labels (`<name>.npz`, written by `load.py` on first use) and for `body_full.npz` (written by `prep3d.py`).
