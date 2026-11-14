"""2D slice rasterisation helpers: physical-scale canvases, crisp or smoothed tissue boundaries."""
import numpy as np
from scipy import ndimage as ndi


def to_canvas(sl, au, av, res, u0, v0, W, H):
    """Nearest-sample slice sl[iu, iv] (cell bounds au, av in m) onto a W x H canvas with
    pixel size res (m); canvas pixel (0,0) top-left has physical (u0, v0 + H*res)."""
    uc = u0 + (np.arange(W) + 0.5) * res
    vc = v0 + (H - np.arange(H) - 0.5) * res  # rows go downward
    iu = np.searchsorted(au, uc) - 1
    iv = np.searchsorted(av, vc) - 1
    ok_u = (iu >= 0) & (iu < sl.shape[0]); ok_v = (iv >= 0) & (iv < sl.shape[1])
    out = np.zeros((H, W), sl.dtype)
    sub = sl[np.clip(iu, 0, sl.shape[0] - 1)][:, np.clip(iv, 0, sl.shape[1] - 1)].T
    sub[~ok_v] = 0; sub[:, ~ok_u] = 0
    return sub


def smooth_labels(img, sigma_px, keep_thin=None):
    """Per-label Gaussian vote; returns smoothed label image. keep_thin: labels whose
    vote is boosted so 1-voxel layers like skin survive."""
    labs = np.unique(img)
    best = np.full(img.shape, -1.0, np.float32); out = np.zeros_like(img)
    for l in labs:
        m = ndi.gaussian_filter((img == l).astype(np.float32), sigma_px)
        if keep_thin is not None and l in keep_thin:
            m *= keep_thin[l]
        upd = m > best
        best[upd] = m[upd]; out[upd] = l
    return out


def boundaries(img):
    e = np.zeros(img.shape, bool)
    e[:-1] |= img[:-1] != img[1:]; e[1:] |= img[:-1] != img[1:]
    e[:, :-1] |= img[:, :-1] != img[:, 1:]; e[:, 1:] |= img[:, :-1] != img[:, 1:]
    return e
