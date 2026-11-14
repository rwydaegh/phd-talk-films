"""Tissue palette: anatomical-atlas inspired, saturated but calm, no greys."""
import numpy as np

G = {  # group -> (hex, label for legend)
    "skin": ("#e2a882", "Skin"),
    "fat": ("#f7e3a1", "Fat"),
    "muscle": ("#c0434c", "Muscle"),
    "bone": ("#f4ecd6", "Bone"),
    "marrow": ("#eb9a6d", "Marrow"),
    "cartilage": ("#9ec8dc", "Cartilage, tendon"),
    "brain": ("#e39aa4", "Brain"),
    "white": ("#f8dedb", None),
    "deep": ("#cc7a89", None),
    "csf": ("#6fb4dd", "Fluid (CSF)"),
    "nerve": ("#e9c344", "Nerve, spinal cord"),
    "eye": ("#3f78bf", "Eye"),
    "lung": ("#f3b2c0", "Lung"),
    "air": ("#e3f1fa", None),
    "blood": ("#c41e3a", "Heart, blood"),
    "heart": ("#8e1c2d", None),
    "vein": ("#3d5a9e", None),
    "liver": ("#8a3a2c", "Liver"),
    "spleen": ("#6d3a6c", None),
    "kidney": ("#a9473a", "Kidney"),
    "gut": ("#e6957c", "Stomach, intestines"),
    "gutlumen": ("#f2cdb0", None),
    "colonlumen": ("#cfa27a", None),
    "gland": ("#efa75a", None),
    "bladder": ("#e5cb55", None),
    "repro": ("#cf8aa0", None),
    "connective": ("#ebc8b8", None),
    "green": ("#5f8f3e", None),
}

T = {
    "Skin": "skin", "Ear_skin": "skin",
    "Fat": "fat", "SAT": "fat", "Breast": "fat",
    "Muscle": "muscle", "Tongue": "muscle", "Diaphragm": "muscle", "Larynx": "muscle",
    "Pharynx": "muscle", "Esophagus": "gut", "Heart_muscle": "heart",
    "Bone": "bone", "Skull": "bone", "Vertebrae": "bone", "Mandible": "bone", "Patella": "bone", "Teeth": "bone",
    "Marrow_red": "marrow",
    "Cartilage": "cartilage", "Intervertebral_disc": "cartilage", "Meniscus": "cartilage",
    "Ear_cartilage": "cartilage", "Tendon_Ligament": "cartilage",
    "Connective_tissue": "connective",
    "Brain_grey_matter": "brain", "Brain_white_matter": "white", "Cerebellum": "brain",
    "Thalamus": "deep", "Hypothalamus": "deep", "Midbrain": "deep", "Pons": "deep",
    "Medulla_oblongata": "deep", "Hippocampus": "deep", "Pinealbody": "deep", "Hypophysis": "deep",
    "commissura_anterior": "deep", "commissura_posterior": "deep",
    "Commissura_anterior": "deep", "Commissura_posterior": "deep",
    "Cerebrospinal_fluid": "csf", "Spinal_cord": "nerve", "Nerve": "nerve",
    "Eye_vitreous_humor": "eye", "Eye_Sclera": "white", "Eye_lens": "csf", "Cornea": "csf",
    "Lung": "lung", "Trachea": "connective", "Bronchi": "connective",
    "Air_internal": "air", "Trachea_lumen": "air", "Bronchi_lumen": "air", "Esophagus_lumen": "gutlumen",
    "Heart_lumen": "blood", "Artery": "blood", "Blood_vessel": "blood", "Vein": "vein",
    "Liver": "liver", "Gallbladder": "green", "Spleen": "spleen", "Pancreas": "gland",
    "Kidney_cortex": "kidney", "Kidney_medulla": "kidney", "Adrenal_gland": "gland",
    "Thymus": "gland", "Thyroid_gland": "gland",
    "Stomach": "gut", "Stomach_lumen": "gutlumen", "Small_intestine": "gut",
    "Small_intestine_lumen": "gutlumen", "Large_intestine": "gut", "Large_intestine_lumen": "colonlumen",
    "Mucosa": "gut",
    "Bladder": "bladder", "Ureter_Urethra": "bladder", "Prostate": "repro", "Testis": "repro",
    "Epididymis": "repro", "Penis": "skin", "Uterus": "repro", "Ovary": "repro", "Vagina": "repro",
}
# Small per-tissue tweaks so neighbouring tissues of one group stay distinguishable
TWEAK = {"Kidney_medulla": "#c76a52", "Large_intestine": "#d9836c", "Cerebellum": "#d88896",
         "Eye_lens": "#b9dcf2", "Teeth": "#fffaf0", "Tendon_Ligament": "#b7d6e2",
         "Heart_lumen": "#b81d36"}


def hex2rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], float) / 255


def lut(names, bg="#ffffff"):
    out = np.zeros((len(names), 3))
    for i, n in enumerate(names):
        if n == "Background":
            out[i] = hex2rgb(bg)
        elif n in TWEAK:
            out[i] = hex2rgb(TWEAK[n])
        elif n in T:
            out[i] = hex2rgb(G[T[n]][0])
        else:
            raise KeyError(n)
    return out


def group_of(name):
    return T.get(name, "bg")
