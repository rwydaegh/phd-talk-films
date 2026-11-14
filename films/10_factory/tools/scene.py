"""Scene descriptions for the two factory films -> film/data/scene10.json, scene27.json.

Film 10 = chapter 3, configuration 1 (collocated vs distributed): a closed concrete hall 50 x 50 x 10 m,
metal cuboids (2 x 0.5 m footprint, variable height) on a regular 5 m grid with 30 % removed at random,
a 5 x 5 patch array 1 m below the ceiling facing the floor, either collocated at the centre (0.5 lambda
spacing) or distributed on a 10 m grid. Receivers at 1.75 m, 2.5 / 7.5 / 12.5 m from the collocated BS;
the worker stands at Rx 2 (7.5 m) and faces the BS. 28 GHz band (27.9 GHz).

Film 27 = chapter 5, the LOS/NLOS factory: 40 x 20 x 5 m, a 16 x 16 URA at (-13, 0, 3) m with 10 deg
downtilt, 26 scatterers of seed 0 (aegis data/studio/scene/los_seed0.json, the realisation behind the
6.27x Pareto figure), the worker at served position 4 (14 m), device at the chest. 28 GHz.
"""
import json
import math
from pathlib import Path

import numpy as np

D = Path(__file__).resolve().parent.parent / 'film' / 'data'
F10 = 27.9e9
F27 = 28.0e9
C0 = 299792458.0


def scene10(seed=7):
    rng = np.random.default_rng(seed)
    L, H = 50.0, 10.0
    lam = C0 / F10
    worker = [25.0, 32.5, 0.0]
    machines = []
    nodes = [(5.0 * i, 5.0 * j) for i in range(1, 10) for j in range(1, 10)]
    keep = rng.random(len(nodes)) > 0.30
    for (x, y), k in zip(nodes, keep):
        if not k: continue
        if math.hypot(x - worker[0], y - worker[1]) < 2.4: continue
        h = float(rng.uniform(2.0, 4.5))
        yaw = float(rng.choice([0.0, math.pi / 2]))
        machines.append({'c': [x, y, h / 2], 's': [2.0, 0.5, h], 'yaw': yaw})
    z_el = H - 1.0
    dis = [[5.0 + 10.0 * i, 5.0 + 10.0 * j, z_el] for j in range(5) for i in range(5)]
    d = lam / 2
    col = [[25.0 + (i - 2) * d, 25.0 + (j - 2) * d, z_el] for j in range(5) for i in range(5)]
    return {
        'film': 10, 'freq': F10, 'lam': lam, 'room': [[0, 0, 0], [L, L, H]],
        'wall': {'eps': 7.0, 'sigma': 0.015}, 'machineMat': 'metal',
        'machines': machines, 'col': col, 'dis': dis, 'elementTilt': 'down',
        'worker': {'pos': worker, 'face': -90.0},     # faces -y, towards the collocated BS at (25, 25)
        'rx': {'sep': [2.5, 7.5, 12.5], 'height': 1.75},
    }


def scene27():
    src = json.loads((D / 'ch5_los_seed0.json').read_text())
    Lx, Ly, Lz = src['room_dims']
    machines = [{'c': s['center'], 's': s['size'], 'yaw': s['yaw_rad']} for s in src['scatterers']]
    lam = C0 / F27
    ue = src['ue_positions'][4]
    return {
        'film': 27, 'freq': F27, 'lam': lam, 'room': [[-Lx / 2, -Ly / 2, 0], [Lx / 2, Ly / 2, Lz]],
        'wall': {'eps': 7.0, 'sigma': 0.015}, 'machineMat': 'metal',
        'machines': machines,
        'ura': {'centre': src['bs_position'], 'n': 16, 'tilt': src['bs_tilt_deg'], 'facing': [1, 0, 0], 'd': lam / 2},
        'worker': {'pos': [ue[0], ue[1], 0.0], 'face': 180.0},   # faces -x, towards the array
        'ueSep': src['ue_separations_m'][4],
    }


if __name__ == '__main__':
    for name, s in (('scene10.json', scene10()), ('scene27.json', scene27())):
        (D / name).write_text(json.dumps(s, indent=1))
        print(name, len(s['machines']), 'machines')
