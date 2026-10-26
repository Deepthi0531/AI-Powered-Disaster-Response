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

    logger.warning(
        f"CLIP dependencies unavailable: {error}"
    )

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

    global processor
    global model

    if not CV_MODEL_LOADED:
        return None, None

    if processor is None or model is None:
        processor = AutoProcessor.from_pretrained(MODEL_ID)

        model = AutoModelForZeroShotImageClassification.from_pretrained(
            MODEL_ID
        )

        model.to(device)

        model.eval()

        logger.info(
            f"CLIP loaded on device: {device}"
        )

    return processor, model


# ============================================================
# IMAGE VALIDATION
# ============================================================

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
    if not os.path.exists(image_path):
        return False, None, None, None

    try:

        with Image.open(image_path) as image:
            image.verify()

        with Image.open(image_path) as image:
            return (
                True,
                image.size[0],
                image.size[1],
                image.format,
            )

    except UnidentifiedImageError:

        return False, None, None, None

    except Exception as error:

        logger.error(
            f"Image validation error: {error}"
        )

        return False, None, None, None


def classify_image(image, labels, prompts):
    image_processor, clip_model = get_model()

    if not image_processor or not clip_model:
        return None

    inputs = image_processor(
        text=prompts,
        images=image,
        return_tensors="pt",
        padding=True,
    )

    inputs = {
        key: value.to(device)
        for key, value in inputs.items()
    }

    with torch.no_grad():
        outputs = clip_model(**inputs)
        probabilities = outputs.logits_per_image[0].softmax(dim=0)

    detections = [
        {
            "label": label,
            "confidence": round(score * 100, 2),
        }
        for label, score in zip(
            labels,
            probabilities.cpu().tolist(),
        )
    ]

    detections.sort(
        key=lambda detection: detection["confidence"],
        reverse=True,
    )

    return detections


def verify_incident_image(image_path):
    """Screen a newly submitted incident image."""

    is_valid, width, height, image_format = get_image_details(image_path)

    if not is_valid:

        return {
            "status": "invalid_image",
            "confidence_score": 0.0,
            "detected_labels": [],
            "detections": [],
            "model": "CLIP Zero-Shot Image Classifier",
            "message": "The uploaded file is not a valid image.",
        }

    if not CV_MODEL_LOADED:

        return {
            "status": "pending_review",
            "confidence_score": 0.0,
            "detected_labels": ["Image received"],
            "detections": [],
            "image_width": width,
            "image_height": height,
            "image_format": image_format,
            "model": "Computer Vision Unavailable",
            "message": "Image is valid but CV is unavailable.",
        }

    try:
        with Image.open(image_path) as source_image:
            image = source_image.convert("RGB")

            detections = classify_image(
                image,
                INCIDENT_TYPES,
                INCIDENT_PROMPTS,
            )

        if not detections:
            return {
                "status": "pending_review",
                "confidence_score": 0.0,
                "detected_labels": [],
                "detections": [],
                "model": "CLIP Zero-Shot Image Classifier",
                "message": "CV could not analyse this image.",
            }

        prediction = detections[0]

        return {
            "status": "pending_review",
            "confidence_score": round(
                prediction["confidence"] / 100,
                4,
            ),
            "detected_labels": [prediction["label"]],
            "detections": detections,
            "image_width": width,
            "image_height": height,
            "image_format": image_format,
            "model": "CLIP Zero-Shot Image Classifier",
            "message": (
                f"Computer Vision prediction: "
                f"{prediction['label']} "
                f"({prediction['confidence']}%)."
            ),
        }

    except Exception as error:
        logger.error(f"Initial incident CV error: {error}")

        return {
            "status": "pending_review",
            "confidence_score": 0.0,
            "detected_labels": [],
            "detections": [],
            "model": "CLIP Zero-Shot Image Classifier",
            "message": "CV could not analyse this image.",
        }


# ============================================================
# RESOLUTION PROOF VERIFICATION
# ============================================================

def verify_resolution_proof(image_path, incident_type):
    """
    Verify proof submitted for an active incident.

    Clear, safe and open scene -> approved.
    Active disaster -> rejected.
    Road closure, barricade or detour -> rejected.
    Random unrelated image -> rejected.
    Low-confidence result -> needs a clearer proof image.
    """

    is_valid, width, height, image_format = get_image_details(image_path)

    if not is_valid:

        return {
            "status": "invalid_image",
            "confidence_score": 0.0,
            "detected_labels": [],
            "detections": [],
            "model": "CLIP Resolution Proof Verifier",
            "message": "The uploaded proof is not a valid image.",
        }

    # ========================================================
    # NORMALIZE INCIDENT TYPE
    # ========================================================

    original_incident_type = (
        str(incident_type or "Other")
        .strip()
    )

    if incident_type not in RESOLUTION_PROMPTS:
        incident_type = "Other"

    if not CV_MODEL_LOADED:

        return {
            "status": "needs_new_proof",
            "confidence_score": 0.0,
            "detected_labels": [],
            "detections": [],
            "model": "Computer Vision Unavailable",
            "message": "Computer vision is unavailable.",
        }

    try:
        with Image.open(image_path) as source_image:
            image = source_image.convert("RGB")

            config = RESOLUTION_PROMPTS[incident_type]

            detections = classify_image(
                image,
                config["labels"],
                config["prompts"],
            )

        if not detections:
            return {
                "status": "needs_new_proof",
                "confidence_score": 0.0,
                "detected_labels": [],
                "detections": [],
                "model": "CLIP Resolution Proof Verifier",
                "message": "CV could not analyse this proof image.",
            }

        best_result = detections[0]

        label = best_result["label"]
        confidence = best_result["confidence"] / 100

        result = {
            "confidence_score": round(confidence, 4),
            "detected_labels": [label],
            "detections": detections,
            "image_width": width,
            "image_height": height,
            "image_format": image_format,
            "model": "CLIP Resolution Proof Verifier",
            "incident_type": incident_type,
            "mode": "Safety_First_Resolution_Proof_Check",
        }

        if (
            label == "Unrelated random image"
            and confidence >= UNRELATED_REJECT_CONFIDENCE
        ):
            return {
                **result,
                "status": "rejected",
                "reason": "unrelated_image",
                "message": (
                    "Proof rejected: the uploaded image appears "
                    "unrelated to the incident."
                ),
            }

        if (
            label == "Road closed or blocked"
            and confidence >= ROAD_CLOSED_REJECT_CONFIDENCE
        ):
            return {
                **result,
                "status": "rejected",
                "reason": "road_still_closed",
                "message": (
                    "Proof rejected: the road still appears closed "
                    "or blocked. Upload an image showing that the "
                    "area is fully open and safe."
                ),
            }

        active_labels = [
            "Active flood",
            "Active blocked road",
            "Active structural damage",
            "Active landslide",
            "Active fire",
            "Active fallen tree hazard",
            "Active emergency scene",
        ]

        if (
            label in active_labels
            and confidence >= ACTIVE_HAZARD_REJECT_CONFIDENCE
        ):
            return {
                **result,
                "status": "rejected",
                "reason": "hazard_still_active",
                "message": (
                    "Proof rejected: computer vision indicates "
                    f"that the {incident_type} hazard may still "
                    "be active."
                ),
            }

        clear_labels = [
            "Clear flood scene",
            "Clear blocked road scene",
            "Clear structural damage scene",
            "Clear landslide scene",
            "Clear fire scene",
            "Clear fallen tree scene",
            "Clear emergency scene",
        ]

        if (
            label in clear_labels
            and confidence >= CLEAR_SCENE_APPROVE_CONFIDENCE
        ):

            return {

                **result,
                "status": "approved",
                "reason": "clear_scene_verified",
                "message": (
                    "Proof accepted: computer vision verified "
                    f"a clear and safe {incident_type} scene "
                    f"with {best_result['confidence']}% confidence."
                ),
            }

        return {
            **result,
            "status": "needs_new_proof",
            "reason": "uncertain_scene",
            "message": (
                "Proof needs a clearer image. Computer vision could "
                "not confidently verify that the location is open "
                "and safe."
            ),
        }

    # ========================================================
    # UNEXPECTED CV ERROR
    # ========================================================

    except Exception as error:
        logger.error(f"Proof CV verification error: {error}")

        return {
            "status": "needs_new_proof",
            "confidence_score": 0.0,
            "detected_labels": [],
            "detections": [],
            "model": "CLIP Resolution Proof Verifier",
            "message": "CV could not verify this proof image.",
        }