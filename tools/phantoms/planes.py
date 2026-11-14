"""One slightly tilted coronal plane per phantom, y = a + b z (metres), through the shins and the heart.
Fractions are of the body's front-back depth, at 15 % and 74 % of body height."""
import numpy as np
from load import load
PLANE_FR = {"duke": (0.30, 0.40), "ella": (0.25, 0.40), "eartha": (0.28, 0.40), "thelonious": (0.19, 0.40)}


def plane(ph, lab=None, ax=None):
    if lab is None:
        lab, _, ax = load(ph)
    cen = [(a[1:] + a[:-1]) / 2 for a in ax]
    b = lab > 0
    yb = np.argwhere(b.any((0, 2))).ravel(); zb = np.argwhere(b.any((0, 1))).ravel()
    ylo, yhi = cen[1][yb[0]], cen[1][yb[-1]]; zlo, zhi = cen[2][zb[0]], cen[2][zb[-1]]
    f1, f2 = PLANE_FR[ph]
    z1, z2 = zlo + 0.15 * (zhi - zlo), zlo + 0.74 * (zhi - zlo)
    y1, y2 = ylo + f1 * (yhi - ylo), ylo + f2 * (yhi - ylo)
    s = (y2 - y1) / (z2 - z1)
    return y1 - s * z1, s  # y = a + s z


def sample(lab, ax, a, s):
    """Labels on the tilted plane: returns sl[ix, iz] picking the voxel that contains y(z)."""
    cen_z = (ax[2][1:] + ax[2][:-1]) / 2
    yi = np.clip(np.searchsorted(ax[1], a + s * cen_z) - 1, 0, lab.shape[1] - 1)
    return lab[:, yi, np.arange(lab.shape[2])], yi
