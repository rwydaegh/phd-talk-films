"""Load IT'IS phantom labels from Sim4Life *_Input.h5 / *_Output.h5 (visual use only)."""
import glob, os, re
import h5py, numpy as np

ROOT = os.environ.get("VIP_H5_DIR", "vip_h5")
CACHE = os.environ.get("PHANTOM_CACHE", "phantom_cache")
PHANTOMS = ["duke", "ella", "eartha", "thelonious"]


def clean(name):
    return re.sub(r"\s*\(.*\)\s*$", "", name).strip()


def _mesh_group(f):
    for g in f["Meshes"].values():
        if "voxels" in g:
            return g
    raise KeyError


def read_labels(path, with_props=False):
    with h5py.File(path, "r") as f:
        g = _mesh_group(f)
        vox = g["voxels"][()]
        idmap = g["id_map"][()]
        axes = [g[f"axis_{c}"][()] for c in "xyz"]
        mats = {}
        for mm in f["AllMaterialMaps"].values():
            for uid, m in mm.items():
                d = {"name": m.attrs["material_name"].decode()}
                for pk, p in m.items():
                    if pk.startswith("Property_"):
                        o = p["_Object"].attrs
                        if "Value" in o and "PropertyName" in o: d[o["PropertyName"].decode()] = float(o["Value"])
                mats[uid] = d
    names, props = [], []
    import uuid as _u
    for row in idmap:
        uid = str(_u.UUID(bytes=bytes(row)))
        m = mats.get(uid)
        if m is None:  # try little-endian layout
            uid = str(_u.UUID(bytes_le=bytes(row)))
            m = mats.get(uid, {"name": "Background"})
        names.append(clean(m["name"]))
        props.append(m)
    return (vox, names, axes, props) if with_props else (vox, names, axes)


def load(ph):
    c = f"{CACHE}/{ph}.npz"
    if os.path.exists(c):
        z = np.load(c, allow_pickle=True)
        return z["labels"], list(z["names"]), [z["ax"], z["ay"], z["az"]]
    p = glob.glob(f"{ROOT}/{ph}/*_Input.h5")[0]
    vox, names, axes = read_labels(p)
    np.savez_compressed(c, labels=vox, names=np.array(names), ax=axes[0], ay=axes[1], az=axes[2])
    return vox, names, axes
