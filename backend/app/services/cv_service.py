import logging
import os
import re
from datetime import datetime, timedelta, timezone

from PIL import Image, ImageOps, UnidentifiedImageError

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

PROOF_UNRELATED_REJECT = 0.45
PROOF_ROAD_CLOSED_REJECT = 0.45
PROOF_HAZARD_STILL = 0.60        # total hazard probability -> still active
PROOF_HAZARD_GONE = 0.35         # at or below -> hazard cleared
PROOF_SCENE_OK = 0.80            # image-to-image similarity: same place
PROOF_SCENE_BAD = 0.60           # below this: different place -> reject


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
    global processor, model

    if not CV_MODEL_LOADED:
        return None, None

    if processor is None or model is None:
        processor = CLIPProcessor.from_pretrained(MODEL_ID)
        model = CLIPModel.from_pretrained(MODEL_ID)
        model.to(device)
        model.eval()

    return processor, model


def _tensor(x):
    if torch.is_tensor(x):
        return x
    return getattr(x, "pooler_output", x[0])


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


def _capture_time(image):
    try:
        exif = image.getexif()
        raw = None
        try:
            raw = exif.get_ifd(0x8769).get(36867)  # DateTimeOriginal
        except Exception:
            pass
        raw = raw or exif.get(36867) or exif.get(306)
        if raw:
            return datetime.strptime(str(raw).strip(), "%Y:%m:%d %H:%M:%S")
    except Exception:
        pass
    return None


def _load_rgb(image_path):
    """Returns (RGB image, capture time or None). EXIF is read before transpose."""
    with Image.open(image_path) as source:
        taken = _capture_time(source)
        image = ImageOps.exif_transpose(source).convert("RGB")
    return image, taken


def _to_local(dt):
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone().replace(tzinfo=None)


def _target_key(incident_type, custom_text):
    """Returns (probability key, custom text). key None = any hazard counts."""
    if incident_type in HAZARD_PROMPTS:
        return incident_type, None
    text = (custom_text or "").strip()
    if incident_type and incident_type != "Other" and not text:
        text = re.sub(r"[^A-Za-z0-9 ]", " ", incident_type).strip()
    if text:
        return "Custom", text
    return None, None


def _hazard_total(probs):
    return sum(p for n, p in probs.items() if n in HAZARD_PROMPTS or n == "Custom")


def _target_prob(probs, key):
    return probs[key] if key else _hazard_total(probs)


def _irrelevant_total(probs):
    return sum(probs.get(n, 0.0) for n in IRRELEVANT_PROMPTS)


def _top_of(probs, names):
    names = [n for n in names if n in probs]
    return max(names, key=lambda n: probs[n])


# ------------------------------------------------------------------
# 1. New incident report
# ------------------------------------------------------------------
def verify_incident_image(image_path, incident_type=None, custom_type=None,
                          known_hashes=None):
    """
    Screen a newly submitted incident image against the SELECTED type.

    status: approved | pending_review (admin) | rejected | invalid_image
    known_hashes: iterable of (incident_id, phash_hex) already in the DB.
    """
    is_valid, width, height, image_format = get_image_details(image_path)
    meta = {
        "image_width": width,
        "image_height": height,
        "image_format": image_format,
        "model": "CLIP Zero-Shot Image Classifier",
        "incident_type": incident_type,
    }

    if not is_valid:
        return {
            **meta,
            "status": "invalid_image",
            "reason": "invalid_image",
            "confidence_score": 0.0,
            "detected_labels": [],
            "detections": [],
            "message": "The uploaded file is not a valid image.",
        }

    if not CV_MODEL_LOADED:
        return {
            **meta,
            "status": "pending_review",
            "reason": "cv_unavailable",
            "confidence_score": 0.0,
            "detected_labels": ["Image received"],
            "detections": [],
            "message": "Image is valid but CV is unavailable - sent to admin.",
        }

    try:
        image, taken = _load_rgb(image_path)
        key, custom = _target_key(incident_type, custom_type)
        probs = _classify(
            _embed_image(image),
            _group_vectors(custom),
            exclude=("road_closed",),
        )

        target = _target_prob(probs, key)
        irrelevant = _irrelevant_total(probs) + probs.get("normal_scene", 0.0)
        top_irrelevant = _top_of(probs, list(IRRELEVANT_PROMPTS))
        other_hazards = [h for h in HAZARD_PROMPTS if h != key]
        top_other = _top_of(probs, other_hazards)
        shown_type = custom or incident_type or "incident"

        # past-photo / duplicate checks
        is_past, photo_note, age = False, None, None
        if taken:
            age = datetime.now() - taken
            if age > timedelta(hours=MAX_PHOTO_AGE_HOURS):
                is_past = True
                photo_note = f"Past photo - captured on {taken:%d %b %Y, %H:%M}"

        phash, duplicate_of = None, None
        if imagehash is not None:
            ph = imagehash.phash(image)
            phash = str(ph)
            for incident_id, hex_hash in known_hashes or []:
                try:
                    if ph - imagehash.hex_to_hash(hex_hash) <= DUPLICATE_HASH_DISTANCE:
                        duplicate_of = incident_id
                        break
                except Exception:
                    continue

        result = {
            **meta,
            "confidence_score": round(target, 4),
            "detected_labels": [_detections(probs, 1)[0]["label"]],
            "detections": _detections(probs),
            "is_past_photo": is_past,
            "photo_note": photo_note,
            "captured_at": taken.isoformat() if taken else None,
            "has_capture_time": taken is not None,
            "phash": phash,
            "duplicate_of": duplicate_of,
        }

        if irrelevant >= UNRELATED_REJECT:
            what = IRRELEVANT_TEXT.get(top_irrelevant, "a normal scene with no incident")
            if probs.get("normal_scene", 0.0) > probs[top_irrelevant]:
                what = "a normal scene with no incident"
            return {
                **result,
                "status": "rejected",
                "reason": "unrelated_image",
                "message": (
                    f"Report rejected: this looks like {what}, not a photo of "
                    f"{shown_type}. Upload a clear photo of the incident."
                ),
            }

        if probs[top_other] >= MISMATCH_REJECT and target < 0.20:
            return {
                **result,
                "status": "rejected",
                "reason": "type_mismatch",
                "message": (
                    f"Report rejected: the photo looks like {top_other}, which "
                    f"does not match the selected type ({shown_type})."
                ),
            }

        if target < MIN_TARGET:
            return {
                **result,
                "status": "rejected",
                "reason": "no_incident_visible",
                "message": f"Report rejected: no visible evidence of {shown_type}.",
            }

        if duplicate_of:
            return {
                **result,
                "status": "pending_review",
                "reason": "duplicate_image",
                "message": "This image was already used in another report - sent to admin.",
            }

        if age and age > timedelta(days=MAX_PAST_PHOTO_DAYS):
            return {
                **result,
                "status": "pending_review",
                "reason": "very_old_photo",
                "message": "Photo is very old - sent to admin for review.",
            }

        if target >= ACCEPT_THRESHOLD:
            return {
                **result,
                "status": "approved",
                "reason": "matches_incident",
                "message": (
                    f"Photo matches {shown_type} "
                    f"({round(target * 100, 1)}% confidence)."
                ),
            }

        return {
            **result,
            "status": "pending_review",
            "reason": "low_confidence",
            "message": "Low confidence - sent to admin for manual review.",
        }

    except Exception as error:
        logger.error(f"Incident CV error: {error}")
        return {
            **meta,
            "status": "pending_review",
            "reason": "cv_error",
            "confidence_score": 0.0,
            "detected_labels": [],
            "detections": [],
            "message": "CV could not analyse this image - sent to admin.",
        }


# ------------------------------------------------------------------
# 2. Resolution proof
# ------------------------------------------------------------------
def verify_resolution_proof(image_path, incident_type, custom_type=None,
                            original_image_path=None, incident_created_at=None):
    """
    Verify the proof photo for an active incident.

    status: approved (delete incident) | pending_review (admin) | rejected | invalid_image

    Approved ONLY when ALL hold: it is a fresh photo, not the reported photo,
    it shows the SAME place, the hazard is gone, no road closure, not unrelated.
    Anything unsure goes to the admin instead of being auto-approved.
    """
    is_valid, width, height, image_format = get_image_details(image_path)
    meta = {
        "image_width": width,
        "image_height": height,
        "image_format": image_format,
        "model": "CLIP Resolution Proof Verifier",
        "incident_type": incident_type,
        "mode": "Strict_Resolution_Proof_Check",
    }

    if not is_valid:
        return {
            **meta,
            "status": "invalid_image",
            "reason": "invalid_image",
            "confidence_score": 0.0,
            "detected_labels": [],
            "detections": [],
            "message": "The uploaded proof is not a valid image.",
        }

    if not CV_MODEL_LOADED:
        return {
            **meta,
            "status": "pending_review",
            "reason": "cv_unavailable",
            "confidence_score": 0.0,
            "detected_labels": [],
            "detections": [],
            "message": "Computer vision is unavailable - sent to admin.",
        }

    try:
        proof, taken = _load_rgb(image_path)
        key, custom = _target_key(incident_type, custom_type)
        proof_vec = _embed_image(proof)
        probs = _classify(proof_vec, _group_vectors(custom))

        hazard = _hazard_total(probs)
        unrelated = _irrelevant_total(probs)
        road_closed = probs.get("road_closed", 0.0)
        top_irrelevant = _top_of(probs, list(IRRELEVANT_PROMPTS))
        shown_type = custom or incident_type or "incident"

        similarity = None
        reused = False
        if original_image_path and os.path.exists(original_image_path):
            original, _ = _load_rgb(original_image_path)
            similarity = float(proof_vec @ _embed_image(original))
            if imagehash is not None:
                reused = (
                    imagehash.phash(proof) - imagehash.phash(original)
                    <= DUPLICATE_HASH_DISTANCE
                )

        result = {
            **meta,
            "confidence_score": round(1 - hazard, 4),
            "detected_labels": [_detections(probs, 1)[0]["label"]],
            "detections": _detections(probs),
            "hazard_score": round(hazard, 4),
            "scene_similarity": None if similarity is None else round(similarity, 4),
            "captured_at": taken.isoformat() if taken else None,
            "has_capture_time": taken is not None,
        }

        def reject(reason, message):
            return {**result, "status": "rejected", "reason": reason, "message": message}

        if reused:
            return reject("same_photo_reused",
                          "Proof rejected: this is the same photo that was reported. "
                          "Upload a new photo taken now.")

        if taken:
            if datetime.now() - taken > timedelta(hours=MAX_PHOTO_AGE_HOURS):
                return reject("proof_too_old",
                              f"Proof rejected: photo was captured on "
                              f"{taken:%d %b %Y, %H:%M}. Upload a recent photo.")
            created = _to_local(incident_created_at)
            if created and taken < created:
                return reject("proof_before_report",
                              "Proof rejected: photo was taken before the incident "
                              "was reported.")

        if unrelated >= PROOF_UNRELATED_REJECT:
            what = IRRELEVANT_TEXT.get(top_irrelevant, "an unrelated image")
            return reject("unrelated_image",
                          f"Proof rejected: this looks like {what}, not the "
                          "incident location.")

        if road_closed >= PROOF_ROAD_CLOSED_REJECT:
            return reject("road_still_closed",
                          "Proof rejected: the road still appears closed or blocked. "
                          "Upload an image showing the area open and safe.")

        if hazard >= PROOF_HAZARD_STILL:
            return reject("hazard_still_active",
                          f"Proof rejected: the {shown_type} hazard may still be "
                          "active in this photo.")

        if similarity is not None and similarity < PROOF_SCENE_BAD:
            return reject("different_location",
                          "Proof rejected: this photo does not match the reported "
                          "location.")

        if (
            similarity is not None
            and similarity >= PROOF_SCENE_OK
            and hazard <= PROOF_HAZARD_GONE
            and unrelated < 0.25
            and road_closed < 0.25
        ):
            return {
                **result,
                "status": "approved",
                "reason": "clear_scene_verified",
                "message": (
                    f"Proof accepted: same location, {shown_type} hazard cleared "
                    f"({round(similarity * 100, 1)}% scene match)."
                ),
            }

        return {
            **result,
            "status": "pending_review",
            "reason": "uncertain_scene",
            "message": "Not confident enough to verify - sent to admin for review.",
        }

    except Exception as error:
        logger.error(f"Proof CV verification error: {error}")
        return {
            **meta,
            "status": "pending_review",
            "reason": "cv_error",
            "confidence_score": 0.0,
            "detected_labels": [],
            "detections": [],
            "message": "CV could not verify this proof - sent to admin.",
        }