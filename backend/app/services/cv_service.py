import logging
import os

from PIL import Image, UnidentifiedImageError

logger = logging.getLogger(__name__)

MODEL_ID = "openai/clip-vit-base-patch32"

processor = None
model = None
device = None
CV_MODEL_LOADED = False


try:
    import torch
    from transformers import (
        AutoModelForZeroShotImageClassification,
        AutoProcessor,
    )

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    CV_MODEL_LOADED = True

except Exception as error:
    logger.warning(f"CLIP dependencies unavailable: {error}")
    CV_MODEL_LOADED = False


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
    "a photo of flood water, waterlogging, or a flooded road",
    "a photo of a blocked road with debris, rocks, or obstacles",
    "a photo of structural damage or a collapsed building",
    "a photo of a landslide, mudslide, rocks, or mud on a road",
    "a photo of fire, flames, wildfire, or a burning building",
    "a photo of a fallen tree blocking a road",
    "a photo of another natural disaster or emergency",
    "a normal image with no disaster and no emergency",
]


RESOLUTION_PROMPTS = {
    "Flood": {
        "labels": [
            "Clear flood scene",
            "Active flood",
            "Unrelated random image",
        ],
        "prompts": [
            (
                "a normal dry house, dry road, clear street, green lawn, "
                "or safe area with no flood water and no waterlogging"
            ),
            (
                "an active flood, flood water, waterlogging, "
                "or a flooded road"
            ),
            (
                "a cat, dog, pet, selfie, food, document, screenshot, "
                "or unrelated random object"
            ),
        ],
    },
    "Blocked Road": {
        "labels": [
            "Clear blocked road scene",
            "Active blocked road",
            "Unrelated random image",
        ],
        "prompts": [
            (
                "a clear open road, normal dry street, normal house, "
                "or safe area with no debris and no obstruction"
            ),
            (
                "a road blocked by debris, rocks, vehicles, "
                "fallen objects, or obstacles"
            ),
            (
                "a cat, dog, pet, selfie, food, document, screenshot, "
                "or unrelated random object"
            ),
        ],
    },
    "Structural Damage": {
        "labels": [
            "Clear structural damage scene",
            "Active structural damage",
            "Unrelated random image",
        ],
        "prompts": [
            (
                "a normal safe house, repaired building, undamaged building, "
                "or clear safe area with no structural damage"
            ),
            (
                "a damaged building, collapsed building, broken structure, "
                "or unsafe structural damage"
            ),
            (
                "a cat, dog, pet, selfie, food, document, screenshot, "
                "or unrelated random object"
            ),
        ],
    },
    "Landslide": {
        "labels": [
            "Clear landslide scene",
            "Active landslide",
            "Unrelated random image",
        ],
        "prompts": [
            (
                "a clear road, normal dry street, normal house, "
                "or safe area with no mud, rocks, debris, or landslide"
            ),
            (
                "an active landslide, mudslide, mud, rocks, "
                "or debris blocking a road"
            ),
            (
                "a cat, dog, pet, selfie, food, document, screenshot, "
                "or unrelated random object"
            ),
        ],
    },
    "Fire": {
        "labels": [
            "Clear fire scene",
            "Active fire",
            "Unrelated random image",
        ],
        "prompts": [
            (
                "a normal safe house, normal building, clear area, "
                "or safe scene with no fire, no smoke, and no flames"
            ),
            (
                "an active fire, flames, burning building, "
                "wildfire, or heavy smoke"
            ),
            (
                "a cat, dog, pet, selfie, food, document, screenshot, "
                "or unrelated random object"
            ),
        ],
    },
    "Fallen Tree": {
        "labels": [
            "Clear fallen tree scene",
            "Active fallen tree hazard",
            "Unrelated random image",
        ],
        "prompts": [
            (
                "a clear road, normal dry street, normal house, "
                "or safe area after a fallen tree has been removed"
            ),
            (
                "a fallen tree blocking a road, path, "
                "vehicle, or building"
            ),
            (
                "a cat, dog, pet, selfie, food, document, screenshot, "
                "or unrelated random object"
            ),
        ],
    },
    "Other": {
        "labels": [
            "Clear emergency scene",
            "Active emergency scene",
            "Unrelated random image",
        ],
        "prompts": [
            (
                "a normal safe house, normal dry road, clear area, "
                "or safe scene with no disaster and no emergency"
            ),
            (
                "an active emergency, natural disaster, "
                "visible danger, or serious damage"
            ),
            (
                "a cat, dog, pet, selfie, food, document, screenshot, "
                "or unrelated random object"
            ),
        ],
    },
}

# Random pet/selfie/document images are rejected at 45%.
UNRELATED_REJECT_CONFIDENCE = 0.45

# Only very confident active hazards are rejected.
# Normal house/normal road images will be treated as clear scenes.
ACTIVE_HAZARD_REJECT_CONFIDENCE = 0.80


def get_model():
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
        logger.error(f"Image validation error: {error}")
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
    """CV analysis for a newly reported incident image."""
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
            "confidence_score": round(prediction["confidence"] / 100, 4),
            "detected_labels": [prediction["label"]],
            "detections": detections,
            "image_width": width,
            "image_height": height,
            "image_format": image_format,
            "model": "CLIP Zero-Shot Image Classifier",
            "message": (
                f"Computer Vision prediction: {prediction['label']} "
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


def verify_resolution_proof(image_path, incident_type):
    """
    Automatic proof verification.

    Normal dry house/road/clear scene -> approved.
    Very clear active incident -> rejected.
    Cat/dog/selfie/food/document -> rejected.
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
            "mode": "Automatic_Resolution_Proof_Check",
        }

        if (
            label == "Unrelated random image"
            and confidence >= UNRELATED_REJECT_CONFIDENCE
        ):
            return {
                **result,
                "status": "rejected",
                "message": (
                    f"Proof rejected: uploaded image is unrelated "
                    f"to the {incident_type} incident."
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
                "message": (
                    f"Proof rejected: computer vision strongly indicates "
                    f"that the {incident_type} hazard may still be active."
                ),
            }

        # Clear/normal home or road is automatically accepted here.
        return {
            **result,
            "status": "approved",
            "message": (
                f"Proof accepted: computer vision verified a clear "
                f"{incident_type} scene with "
                f"{best_result['confidence']}% confidence."
            ),
        }

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