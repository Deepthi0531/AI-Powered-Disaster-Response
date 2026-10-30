import logging
import os
from datetime import datetime

from PIL import Image, UnidentifiedImageError

logger = logging.getLogger(__name__)

MODEL_ID = "openai/clip-vit-base-patch32"

processor = None
model = None
device = None
CV_MODEL_LOADED = False

try:
    import torch
    from transformers import CLIPModel, CLIPProcessor

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    CV_MODEL_LOADED = True
except Exception as error:
    logger.warning(f"CLIP dependencies unavailable: {error}")
    CV_MODEL_LOADED = False

try:
    import imagehash  # optional: duplicate / re-used photo detection
except Exception:
    imagehash = None


# ------------------------------------------------------------------
# Tunable thresholds (test with your own photos and adjust)
# ------------------------------------------------------------------
ACCEPT_THRESHOLD = 0.50          # P(selected type) needed to auto-accept a report
MIN_TARGET = 0.10                # below this nothing relevant is visible -> reject
UNRELATED_REJECT = 0.50          # selfie / screenshot / indoor / pet ... -> reject
MISMATCH_REJECT = 0.60           # clearly a DIFFERENT disaster type -> reject
MAX_PHOTO_AGE_HOURS = 24         # older = "past photo" (accepted, flagged in alert)
MAX_PAST_PHOTO_DAYS = 30         # older than this -> admin review
DUPLICATE_HASH_DISTANCE = 5      # perceptual-hash distance = same image

# True  -> photos with no EXIF capture time go to admin review (flagged)
# False -> same, but you could change the code below to reject instead.
# Gallery downloads / screenshots usually have no EXIF time.
REQUIRE_PHOTO_TIMESTAMP_FOR_AUTO_APPROVE = True

PROOF_UNRELATED_REJECT = 0.45
PROOF_ROAD_CLOSED_REJECT = 0.45
PROOF_HAZARD_STILL = 0.60        # total hazard probability -> still active
PROOF_HAZARD_GONE = 0.35         # at or below -> hazard cleared
PROOF_SCENE_OK = 0.80            # image-to-image similarity: same place
PROOF_SCENE_BAD = 0.60           # below this: different place -> reject
PROOF_NORMAL_SCENE_MIN = 0.50    # used when no original photo is available


# ------------------------------------------------------------------
# Prompt groups. Several prompts per group are averaged (ensembling)
# so every group has equal weight in the softmax.
# ------------------------------------------------------------------
HAZARD_PROMPTS = {
    "Flood": [
        "a photo of a flooded street with water covering the road",
        "a photo of floodwater entering houses",
        "a photo of waterlogging or a river overflowing",
    ],
    "Blocked Road": [
        "a photo of a road blocked by debris, rocks or fallen objects",
        "a photo of a road obstructed by vehicles or barricades",
        "a photo of an impassable blocked road",
    ],
    "Structural Damage": [
        "a photo of a collapsed building with rubble",
        "a photo of a building with cracked or fallen walls",
        "a photo of a badly damaged structure or bridge",
    ],
    "Landslide": [
        "a photo of a landslide with mud and rocks on a road",
        "a photo of a hillside collapse with debris",
        "a photo of soil and boulders that slid down a slope",
    ],
    "Fire": [
        "a photo of a building on fire with flames and smoke",
        "a photo of a wildfire burning",
        "a photo of heavy black smoke and flames",
    ],
    "Fallen Tree": [
        "a photo of a fallen tree lying across a road",
        "a photo of a large tree uprooted and blocking the path",
        "a photo of a tree that fell on a house or car",
    ],
}

# Things that must never be accepted as incident / proof photos.
IRRELEVANT_PROMPTS = {
    "selfie_or_portrait": [
        "a selfie of a person",
        "a portrait photo of a person's face",
        "a profile picture of a person",
    ],
    "screenshot_or_text": [
        "a screenshot of a phone screen",
        "a photo of a document with text",
        "a poster or banner with text",
    ],
    "indoor": [
        "a photo of a living room",
        "a photo inside a house or office",
        "a photo of a bedroom or kitchen",
    ],
    "food_or_object": [
        "a photo of food on a plate",
        "a close-up of an everyday object on a table",
        "a photo of a product",
    ],
    "animal": [
        "a photo of a pet dog",
        "a photo of a cat",
        "a photo of an animal",
    ],
    "cartoon_or_meme": [
        "a cartoon or illustration",
        "a meme image",
        "a logo or icon",
    ],
}

# A clean scene: BAD for a new report, GOOD for a resolution proof.
CLEAN_SCENE_PROMPTS = {
    "normal_scene": [
        "a photo of a normal clean street with no damage",
        "a photo of a calm dry open road",
        "a photo of a normal undamaged area",
    ],
}

ROAD_CLOSED_PROMPTS = {
    "road_closed": [
        "a road closed sign or detour sign",
        "traffic barricades blocking a street",
        "a closed road with construction barriers",
    ],
}

ALL_PROMPTS = {
    **HAZARD_PROMPTS,
    **IRRELEVANT_PROMPTS,
    **CLEAN_SCENE_PROMPTS,
    **ROAD_CLOSED_PROMPTS,
}

LABELS = {
    "selfie_or_portrait": "Selfie / portrait",
    "screenshot_or_text": "Screenshot or text image",
    "indoor": "Indoor photo",
    "food_or_object": "Everyday object",
    "animal": "Animal photo",
    "cartoon_or_meme": "Cartoon / meme",
    "normal_scene": "Normal scene, no incident",
    "road_closed": "Road closed / barricade",
    "Custom": "Custom incident",
}

IRRELEVANT_TEXT = {
    "selfie_or_portrait": "a selfie or portrait",
    "screenshot_or_text": "a screenshot or text image",
    "indoor": "an indoor photo",
    "food_or_object": "an everyday object",
    "animal": "an animal photo",
    "cartoon_or_meme": "a cartoon or meme",
}

_group_cache = {}


# ------------------------------------------------------------------
# Model helpers
# ------------------------------------------------------------------
def get_model():
    global processor
    global model

    if not CV_MODEL_LOADED:
        return None, None

    if processor is None or model is None:
        processor = CLIPProcessor.from_pretrained(MODEL_ID)
        model = CLIPModel.from_pretrained(MODEL_ID)
        model.to(device)
        model.eval()
        logger.info(f"CLIP loaded on device: {device}")

    return processor, model


def _tensor(x):
    """Newer transformers versions may return an output object."""
    if torch.is_tensor(x):
        return x
    pooled = getattr(x, "pooler_output", None)
    if pooled is not None:
        return pooled
    return x[0]


def _embed_text(prompts):
    image_processor, clip_model = get_model()
    inputs = image_processor(text=prompts, return_tensors="pt", padding=True)
    inputs = {k: v.to(device) for k, v in inputs.items()}
    with torch.no_grad():
        emb = _tensor(clip_model.get_text_features(**inputs))
    emb = emb / emb.norm(dim=-1, keepdim=True)
    mean = emb.mean(dim=0)
    return mean / mean.norm()


def _embed_image(image):
    image_processor, clip_model = get_model()
    inputs = image_processor(images=image, return_tensors="pt")
    inputs = {k: v.to(device) for k, v in inputs.items()}
    with torch.no_grad():
        emb = _tensor(clip_model.get_image_features(**inputs))[0]
    return emb / emb.norm()


def _group_vectors(custom_text=None):
    for name, prompts in ALL_PROMPTS.items():
        if name not in _group_cache:
            _group_cache[name] = _embed_text(prompts)

    vectors = dict(_group_cache)

    if custom_text:
        vectors["Custom"] = _embed_text([
            f"a photo of {custom_text}",
            f"a photo showing {custom_text}",
            f"an emergency scene of {custom_text}",
        ])

    return vectors


def _classify(image_vec, vectors, exclude=()):
    names = [n for n in vectors if n not in exclude]
    matrix = torch.stack([vectors[n] for n in names])
    probs = (100.0 * (matrix @ image_vec)).softmax(dim=0).cpu().tolist()
    return dict(zip(names, probs))


def _detections(probs, top=5):
    items = sorted(probs.items(), key=lambda kv: kv[1], reverse=True)[:top]
    return [
        {"label": LABELS.get(name, name), "confidence": round(p * 100, 2)}
        for name, p in items
    ]


# ------------------------------------------------------------------
# Image helpers
# ------------------------------------------------------------------
def get_image_details(image_path):
    if not image_path or not os.path.exists(image_path):
        return False, None, None, None

    try:
        with Image.open(image_path) as image:
            image.verify()

        with Image.open(image_path) as image:
            return True, image.size[0], image.size[1], image.format

    except UnidentifiedImageError:
        return False, None, None, None

    except Exception as error:
        logger.error(f"Image validation error: {error}")
        return False, None, None, None


def _read_capture_time(image_path):
    """Return the EXIF capture time (naive datetime) or None."""
    try:
        with Image.open(image_path) as img:
            exif = img.getexif()
            value = None

            try:
                # 0x8769 = Exif sub-IFD, tag 36867 = DateTimeOriginal
                value = exif.get_ifd(0x8769).get(36867)
            except Exception:
                value = None

            if not value:
                value = exif.get(36867) or exif.get(306)  # 306 = DateTime

            if not value:
                return None

            return datetime.strptime(str(value).strip(), "%Y:%m:%d %H:%M:%S")
    except Exception as error:
        logger.info(f"EXIF read failed: {error}")
        return None


def _compute_phash(image_path):
    if imagehash is None:
        return None
    try:
        with Image.open(image_path) as img:
            return str(imagehash.phash(img.convert("RGB")))
    except Exception as error:
        logger.info(f"phash failed: {error}")
        return None


def _is_duplicate(phash, known_hashes):
    if not phash or not known_hashes or imagehash is None:
        return None

    new_hash = imagehash.hex_to_hash(phash)

    for item in known_hashes:
        try:
            incident_id, old_hash = item
            distance = new_hash - imagehash.hex_to_hash(old_hash)
            if distance <= DUPLICATE_HASH_DISTANCE:
                return incident_id
        except Exception:
            continue

    return None


def _result(status, message, **extra):
    base = {
        "status": status,
        "message": message,
        "confidence_score": 0.0,
        "detected_labels": [],
        "detections": [],
        "model": "CLIP Zero-Shot Image Classifier",
    }
    base.update(extra)
    return base


# ============================================================
# NEW INCIDENT PHOTO VERIFICATION
# ============================================================
def verify_incident_image(
    image_path,
    incident_type="Other",
    custom_type=None,
    known_hashes=None,
):
    """
    Screen a newly submitted incident photo.

    invalid_image  -> not an image
    rejected       -> duplicate, unrelated, no incident visible, wrong type
    approved       -> matches the selected type with enough confidence
    pending_review -> not confident / no timestamp / very old / CV unavailable
    """

    is_valid, width, height, image_format = get_image_details(image_path)

    if not is_valid:
        return _result(
            "invalid_image",
            "The uploaded file is not a valid image.",
        )

    image_info = {
        "image_width": width,
        "image_height": height,
        "image_format": image_format,
    }

    # ---------- re-used photo check ----------
    phash = _compute_phash(image_path)
    duplicate_of = _is_duplicate(phash, known_hashes)

    if duplicate_of:
        return _result(
            "rejected",
            "Photo rejected: this image has already been used for "
            "another report. Please take a new photo.",
            reason="duplicate_image",
            phash=phash,
            **image_info,
        )

    # ---------- photo age check (EXIF) ----------
    captured_at = _read_capture_time(image_path)
    is_past_photo = False
    photo_note = None
    force_review = False

    if captured_at is None:
        is_past_photo = True
        photo_note = (
            "The photo has no capture time, so its age could not be "
            "confirmed."
        )
        if REQUIRE_PHOTO_TIMESTAMP_FOR_AUTO_APPROVE:
            force_review = True
    else:
        age_hours = (datetime.now() - captured_at).total_seconds() / 3600.0

        if age_hours > MAX_PHOTO_AGE_HOURS:
            is_past_photo = True
            days = int(age_hours // 24)
            photo_note = (
                f"This photo was taken about {days} day(s) ago "
                "(past photo)."
                if days >= 1
                else f"This photo was taken {int(age_hours)} hours ago "
                     "(past photo)."
            )

            if age_hours > MAX_PAST_PHOTO_DAYS * 24:
                force_review = True

    extra = {
        **image_info,
        "phash": phash,
        "is_past_photo": is_past_photo,
        "photo_note": photo_note,
        "captured_at": captured_at.isoformat() if captured_at else None,
    }

    if not CV_MODEL_LOADED:
        return _result(
            "pending_review",
            "Image is valid, but computer vision is unavailable. "
            "Sent for admin review.",
            model="Computer Vision Unavailable",
            **extra,
        )

    # ---------- CLIP classification ----------
    try:
        with Image.open(image_path) as source_image:
            image = source_image.convert("RGB")

        custom_text = custom_type if incident_type == "Other" else None
        vectors = _group_vectors(custom_text)
        image_vec = _embed_image(image)

        # road_closed is only meaningful for resolution proofs.
        probs = _classify(image_vec, vectors, exclude=("road_closed",))

        if incident_type in HAZARD_PROMPTS:
            target = incident_type
        elif "Custom" in probs:
            target = "Custom"
        else:
            target = None

        target_p = probs.get(target, 0.0) if target else 0.0

        irrelevant_probs = {
            k: v for k, v in probs.items() if k in IRRELEVANT_PROMPTS
        }
        worst_irrelevant = (
            max(irrelevant_probs, key=irrelevant_probs.get)
            if irrelevant_probs else None
        )
        irrelevant_p = (
            irrelevant_probs[worst_irrelevant] if worst_irrelevant else 0.0
        )

        normal_p = probs.get("normal_scene", 0.0)

        other_hazards = {
            k: v for k, v in probs.items()
            if k in HAZARD_PROMPTS and k != target
        }
        best_other = (
            max(other_hazards, key=other_hazards.get)
            if other_hazards else None
        )
        best_other_p = other_hazards[best_other] if best_other else 0.0

        top = sorted(probs.items(), key=lambda kv: kv[1], reverse=True)[0]

        shared = {
            **extra,
            "confidence_score": round(target_p, 4),
            "detected_labels": [LABELS.get(top[0], top[0])],
            "detections": _detections(probs),
        }

        shown_type = custom_type if incident_type == "Other" else incident_type

        if worst_irrelevant and irrelevant_p >= UNRELATED_REJECT:
            return _result(
                "rejected",
                "Photo rejected: it looks like "
                f"{IRRELEVANT_TEXT[worst_irrelevant]}, not a photo of "
                "an incident.",
                reason="unrelated_image",
                **shared,
            )

        if normal_p >= UNRELATED_REJECT or target_p < MIN_TARGET:
            return _result(
                "rejected",
                f"Photo rejected: no {shown_type} is visible in this photo.",
                reason="no_incident_visible",
                **shared,
            )

        if best_other_p >= MISMATCH_REJECT and best_other_p > target_p:
            return _result(
                "rejected",
                f"Photo rejected: it looks like {best_other}, "
                f"not {shown_type}. Please select the correct type.",
                reason="type_mismatch",
                **shared,
            )

        if target_p >= ACCEPT_THRESHOLD and not force_review:
            return _result(
                "approved",
                f"Photo matches {shown_type} "
                f"({round(target_p * 100, 1)}% confidence).",
                reason="type_verified",
                **shared,
            )

        message = (
            f"Photo could not be confidently matched to {shown_type}. "
            "Sent for admin review."
        )
        if force_review and photo_note:
            message = f"{photo_note} Sent for admin review."

        return _result(
            "pending_review",
            message,
            reason="needs_review",
            **shared,
        )

    except Exception as error:
        logger.exception(f"Incident CV error: {error}")
        return _result(
            "pending_review",
            "CV could not analyse this image. Sent for admin review.",
            **extra,
        )


# ============================================================
# RESOLUTION PROOF VERIFICATION
# ============================================================
def verify_resolution_proof(
    image_path,
    incident_type="Other",
    custom_type=None,
    original_image_path=None,
    incident_created_at=None,
):
    """
    approved         -> hazard gone AND same place as the original photo
    rejected         -> unrelated / road still closed / hazard still there /
                        different place
    pending_review   -> CV unsure -> admin decides
    """

    is_valid, width, height, image_format = get_image_details(image_path)

    if not is_valid:
        return _result(
            "invalid_image",
            "The uploaded proof is not a valid image.",
            model="CLIP Resolution Proof Verifier",
        )

    info = {
        "image_width": width,
        "image_height": height,
        "image_format": image_format,
        "model": "CLIP Resolution Proof Verifier",
        "incident_type": custom_type or incident_type,
    }

    if not CV_MODEL_LOADED:
        return _result(
            "pending_review",
            "Computer vision is unavailable. Proof sent to the admin.",
            **{**info, "model": "Computer Vision Unavailable"},
        )

    try:
        with Image.open(image_path) as source_image:
            image = source_image.convert("RGB")

        custom_text = custom_type if incident_type == "Other" else None
        vectors = _group_vectors(custom_text)
        image_vec = _embed_image(image)
        probs = _classify(image_vec, vectors)

        hazard_names = [
            n for n in probs if n in HAZARD_PROMPTS or n == "Custom"
        ]
        hazard_total = sum(probs[n] for n in hazard_names)

        irrelevant_probs = {
            k: v for k, v in probs.items() if k in IRRELEVANT_PROMPTS
        }
        worst_irrelevant = (
            max(irrelevant_probs, key=irrelevant_probs.get)
            if irrelevant_probs else None
        )
        irrelevant_p = (
            irrelevant_probs[worst_irrelevant] if worst_irrelevant else 0.0
        )

        road_closed_p = probs.get("road_closed", 0.0)
        normal_p = probs.get("normal_scene", 0.0)

        top = sorted(probs.items(), key=lambda kv: kv[1], reverse=True)[0]

        shared = {
            **info,
            "confidence_score": round(1.0 - hazard_total, 4),
            "detected_labels": [LABELS.get(top[0], top[0])],
            "detections": _detections(probs),
            "hazard_probability": round(hazard_total, 4),
            "mode": "Safety_First_Resolution_Proof_Check",
        }

        if worst_irrelevant and irrelevant_p >= PROOF_UNRELATED_REJECT:
            return _result(
                "rejected",
                "Proof rejected: the image looks like "
                f"{IRRELEVANT_TEXT[worst_irrelevant]}, not the "
                "incident location.",
                reason="unrelated_image",
                **shared,
            )

        if road_closed_p >= PROOF_ROAD_CLOSED_REJECT:
            return _result(
                "rejected",
                "Proof rejected: the road still appears closed or "
                "blocked. Upload an image showing the area is open "
                "and safe.",
                reason="road_still_closed",
                **shared,
            )

        if hazard_total >= PROOF_HAZARD_STILL:
            return _result(
                "rejected",
                "Proof rejected: computer vision indicates the "
                "hazard may still be active.",
                reason="hazard_still_active",
                **shared,
            )

        # ---------- hazard looks gone: confirm it is the same place ----------
        if hazard_total <= PROOF_HAZARD_GONE:
            similarity = None

            if original_image_path and os.path.exists(original_image_path):
                try:
                    with Image.open(original_image_path) as original:
                        original_vec = _embed_image(original.convert("RGB"))
                    similarity = float((image_vec @ original_vec).item())
                except Exception as error:
                    logger.info(f"Original image compare failed: {error}")

            if similarity is not None:
                shared["scene_similarity"] = round(similarity, 4)

                if similarity < PROOF_SCENE_BAD:
                    return _result(
                        "rejected",
                        "Proof rejected: this photo does not look like "
                        "the same location as the original report.",
                        reason="different_place",
                        **shared,
                    )

                if similarity >= PROOF_SCENE_OK:
                    return _result(
                        "approved",
                        "Proof accepted: the hazard is gone and the "
                        "location matches the original report.",
                        reason="clear_scene_verified",
                        **shared,
                    )
            elif normal_p >= PROOF_NORMAL_SCENE_MIN:
                return _result(
                    "approved",
                    "Proof accepted: the scene looks clear and safe.",
                    reason="clear_scene_verified",
                    **shared,
                )

        return _result(
            "pending_review",
            "Could not confidently verify this proof. It was sent to "
            "the admin for review.",
            reason="uncertain_scene",
            **shared,
        )

    except Exception as error:
        logger.exception(f"Proof CV verification error: {error}")
        return _result(
            "pending_review",
            "CV could not verify this proof image. Sent to the admin.",
            **info,
        )