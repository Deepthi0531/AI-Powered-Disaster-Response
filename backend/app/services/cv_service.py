import logging
import os

from PIL import Image, UnidentifiedImageError

logger = logging.getLogger(__name__)

# --------------------------------------------------
# Incident-report CV categories
# --------------------------------------------------

INCIDENT_TYPES = [
    "Flood",
    "Blocked Road",
    "Structural Damage",
    "Landslide",
    "Fire",
    "Fallen Tree",
    "Other",
    "No Incident",
]

INCIDENT_PROMPTS = [
    "a photo of a flood, waterlogging, or a flooded road",
    "a photo of a road blocked by debris, rocks, vehicles, or obstacles",
    "a photo of structural damage, a damaged building, or a collapsed building",
    "a photo of a landslide, mudslide, or rocks on a road",
    "a photo of a fire, burning building, wildfire, or flames",
    "a photo of a fallen tree blocking a road",
    "a photo of another natural disaster or emergency incident",
    "a normal photo with no emergency, no damage, and no disaster",
]

MODEL_ID = "openai/clip-vit-base-patch32"

processor = None
model = None
device = None
CV_MODEL_LOADED = False

# --------------------------------------------------
# Model loading
# --------------------------------------------------

try:
    import torch
    from transformers import (
        AutoModelForZeroShotImageClassification,
        AutoProcessor,
    )

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    CV_MODEL_LOADED = True
    logger.info("CLIP computer vision dependencies loaded.")

except Exception as error:
    logger.warning(f"CLIP dependencies unavailable: {error}")
    CV_MODEL_LOADED = False


def get_model():
    """Load CLIP only when it is first needed."""
    global processor, model

    if not CV_MODEL_LOADED:
        return None, None

    if processor is None or model is None:
        processor = AutoProcessor.from_pretrained(MODEL_ID)
        model = AutoModelForZeroShotImageClassification.from_pretrained(
            MODEL_ID
        )
        model.to(device)
        model.eval()

    return processor, model


def is_valid_image(image_path):
    """Check that the uploaded file is a genuine image."""
    if not os.path.exists(image_path):
        return False, None, None, None

    try:
        with Image.open(image_path) as image:
            image.verify()

        with Image.open(image_path) as image:
            image = image.convert("RGB")
            width, height = image.size
            image_format = image.format

        return True, width, height, image_format

    except UnidentifiedImageError:
        return False, None, None, None

    except Exception as error:
        logger.error(f"Image validation error: {error}")
        return False, None, None, None


def classify_image(image, labels, prompts):
    """Run CLIP zero-shot classification for supplied labels/prompts."""
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

    detections = []

    for label, score in zip(labels, probabilities.cpu().tolist()):
        detections.append({
            "label": label,
            "confidence": round(score * 100, 2),
        })

    detections.sort(
        key=lambda detection: detection["confidence"],
        reverse=True,
    )

    return detections


def verify_incident_image(image_path):
    """
    Analyses an incident-report image.
    This is used when a citizen initially reports an emergency.
    """

    is_valid, width, height, image_format = is_valid_image(image_path)

    if not is_valid:
        return {
            "status": "invalid_image",
            "confidence_score": 0.0,
            "detected_labels": [],
            "detections": [],
            "model": "CLIP Zero-Shot Image Classifier",
            "message": "The uploaded file is not a valid image.",
        }

    try:
        with Image.open(image_path) as source_image:
            image = source_image.convert("RGB")

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
                    "message": (
                        "Image is valid, but the CV model is unavailable. "
                        "The report remains pending."
                    ),
                }

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
                    "image_width": width,
                    "image_height": height,
                    "image_format": image_format,
                    "model": "CLIP Zero-Shot Image Classifier",
                    "message": "Image analysis could not complete.",
                }

            predicted_incident = detections[0]["label"]
            confidence_score = detections[0]["confidence"] / 100

            return {
                "status": "pending_review",
                "confidence_score": round(confidence_score, 4),
                "detected_labels": [predicted_incident],
                "detections": detections,
                "image_width": width,
                "image_height": height,
                "image_format": image_format,
                "model": "CLIP Zero-Shot Image Classifier",
                "mode": "ZeroShot_Transformers",
                "message": (
                    f"Computer vision prediction: {predicted_incident} "
                    f"({detections[0]['confidence']}%)."
                ),
            }

    except Exception as error:
        logger.error(f"Incident CV inference error: {error}")

        return {
            "status": "pending_review",
            "confidence_score": 0.0,
            "detected_labels": [],
            "detections": [],
            "model": "CLIP Zero-Shot Image Classifier",
            "message": "Image analysis could not complete.",
        }


# --------------------------------------------------
# Automatic resolution-proof verification
# --------------------------------------------------

RESOLUTION_PROMPTS = {
    "Flood": {
        "labels": [
            "Resolved flood scene",
            "Active flood",
            "Unrelated image",
        ],
        "prompts": [
            "a dry cleared road after flooding, no flood water, no waterlogging",
            "an active flood, flood water, waterlogging, or a flooded road",
            "a cat, dog, selfie, food, document, indoor photo, or unrelated random image",
        ],
    },
    "Blocked Road": {
        "labels": [
            "Resolved blocked road",
            "Active blocked road",
            "Unrelated image",
        ],
        "prompts": [
            "a clear open road with no debris and no obstruction",
            "a road blocked by debris, rocks, fallen objects, or vehicles",
            "a cat, dog, selfie, food, document, indoor photo, or unrelated random image",
        ],
    },
    "Structural Damage": {
        "labels": [
            "Resolved structural damage",
            "Active structural damage",
            "Unrelated image",
        ],
        "prompts": [
            "a safe repaired building or a cleared safe area after structural damage",
            "a damaged building, collapsed building, broken structure, or unsafe structural damage",
            "a cat, dog, selfie, food, document, indoor photo, or unrelated random image",
        ],
    },
    "Landslide": {
        "labels": [
            "Resolved landslide",
            "Active landslide",
            "Unrelated image",
        ],
        "prompts": [
            "a cleared road after a landslide, with no mud, rocks, or debris blocking it",
            "an active landslide, mudslide, rocks, mud, or debris blocking a road",
            "a cat, dog, selfie, food, document, indoor photo, or unrelated random image",
        ],
    },
    "Fire": {
        "labels": [
            "Resolved fire scene",
            "Active fire",
            "Unrelated image",
        ],
        "prompts": [
            "a safe fire aftermath with no flames, no smoke, and no active fire",
            "an active fire, flames, burning building, wildfire, or heavy smoke",
            "a cat, dog, selfie, food, document, indoor photo, or unrelated random image",
        ],
    },
    "Fallen Tree": {
        "labels": [
            "Resolved fallen tree scene",
            "Active fallen tree hazard",
            "Unrelated image",
        ],
        "prompts": [
            "a clear road after a fallen tree has been removed",
            "a fallen tree blocking a road, path, vehicle, or building",
            "a cat, dog, selfie, food, document, indoor photo, or unrelated random image",
        ],
    },
    "Other": {
        "labels": [
            "Resolved emergency scene",
            "Active emergency scene",
            "Unrelated image",
        ],
        "prompts": [
            "a safe cleared area after an emergency or natural disaster",
            "an active emergency, active natural disaster, visible danger, or damage",
            "a cat, dog, selfie, food, document, indoor photo, or unrelated random image",
        ],
    },
}

# A result must be strong before automatic resolution.
AUTO_RESOLVE_CONFIDENCE = 0.60

# Reject clearly unrelated photos or an active hazard.
REJECT_CONFIDENCE = 0.45


def verify_resolution_proof(image_path, incident_type):
    """
    Automatically verifies a proof image for ANY incident type.

    Result statuses:
    - approved: incident can be marked RESOLVED automatically.
    - rejected: proof is unrelated or hazard is still active.
    - needs_new_proof: CV is unsure; incident remains active.
    - invalid_image: invalid/corrupt image.
    """

    is_valid, width, height, image_format = is_valid_image(image_path)

    if not is_valid:
        return {
            "status": "invalid_image",
            "confidence_score": 0.0,
            "detected_labels": [],
            "detections": [],
            "model": "CLIP Resolution Proof Verifier",
            "message": "The uploaded proof is not a valid image.",
        }

    incident_type = incident_type or "Other"

    if incident_type not in RESOLUTION_PROMPTS:
        incident_type = "Other"

    proof_config = RESOLUTION_PROMPTS[incident_type]

    # Do not auto-resolve if computer vision cannot run.
    if not CV_MODEL_LOADED:
        return {
            "status": "needs_new_proof",
            "confidence_score": 0.0,
            "detected_labels": [],
            "detections": [],
            "image_width": width,
            "image_height": height,
            "image_format": image_format,
            "model": "Computer Vision Unavailable",
            "message": (
                "Proof image is valid, but CV is unavailable. "
                "The incident remains active; upload another proof later."
            ),
        }

    try:
        with Image.open(image_path) as source_image:
            image = source_image.convert("RGB")

            detections = classify_image(
                image,
                proof_config["labels"],
                proof_config["prompts"],
            )

            if not detections:
                return {
                    "status": "needs_new_proof",
                    "confidence_score": 0.0,
                    "detected_labels": [],
                    "detections": [],
                    "image_width": width,
                    "image_height": height,
                    "image_format": image_format,
                    "model": "CLIP Resolution Proof Verifier",
                    "message": (
                        "Computer vision could not analyse this proof. "
                        "Please upload a clearer photo."
                    ),
                }

            best_result = detections[0]
            label = best_result["label"]
            confidence = best_result["confidence"] / 100

            base_result = {
                "confidence_score": round(confidence, 4),
                "detected_labels": [label],
                "detections": detections,
                "image_width": width,
                "image_height": height,
                "image_format": image_format,
                "model": "CLIP Resolution Proof Verifier",
                "incident_type": incident_type,
                "mode": "Automatic_Resolution_Proof_Check",
            }

            if (
                label == "Unrelated image"
                and confidence >= REJECT_CONFIDENCE
            ):
                return {
                    **base_result,
                    "status": "rejected",
                    "message": (
                        "Proof rejected: the uploaded photo appears unrelated "
                        f"to the {incident_type} incident."
                    ),
                }

            if (
                label == "Active flood"
                or label == "Active blocked road"
                or label == "Active structural damage"
                or label == "Active landslide"
                or label == "Active fire"
                or label == "Active fallen tree hazard"
                or label == "Active emergency scene"
            ):
                if confidence >= REJECT_CONFIDENCE:
                    return {
                        **base_result,
                        "status": "rejected",
                        "message": (
                            "Proof rejected: computer vision indicates that "
                            f"the {incident_type} hazard may still be active."
                        ),
                    }

            resolved_labels = [
                "Resolved flood scene",
                "Resolved blocked road",
                "Resolved structural damage",
                "Resolved landslide",
                "Resolved fire scene",
                "Resolved fallen tree scene",
                "Resolved emergency scene",
            ]

            if (
                label in resolved_labels
                and confidence >= AUTO_RESOLVE_CONFIDENCE
            ):
                return {
                    **base_result,
                    "status": "approved",
                    "message": (
                        f"Proof accepted: computer vision verified a resolved "
                        f"{incident_type} scene with "
                        f"{best_result['confidence']}% confidence."
                    ),
                }

            return {
                **base_result,
                "status": "needs_new_proof",
                "message": (
                    "Proof image is unclear. The incident remains active. "
                    "Please upload a clearer photo showing the resolved area."
                ),
            }

    except Exception as error:
        logger.error(f"Resolution-proof CV error: {error}")

        return {
            "status": "needs_new_proof",
            "confidence_score": 0.0,
            "detected_labels": [],
            "detections": [],
            "model": "CLIP Resolution Proof Verifier",
            "message": (
                "Computer vision could not verify this proof. "
                "Please upload another clear image."
            ),
        }