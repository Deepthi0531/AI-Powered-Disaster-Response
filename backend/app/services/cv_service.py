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

    device = torch.device(
        "cuda" if torch.cuda.is_available() else "cpu"
    )
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
    "a photo of a blocked road with debris, rocks, barricades, or obstacles",
    "a photo of structural damage or a collapsed building",
    "a photo of a landslide, mudslide, rocks, or mud on a road",
    "a photo of fire, flames, wildfire, or a burning building",
    "a photo of a fallen tree blocking a road",
    "a photo of another natural disaster or emergency",
    "a normal image with no disaster and no emergency",
]

# Every proof checks four things:
# 1. Clear and safe scene
# 2. Original disaster still active
# 3. Road still closed or blocked
# 4. Random unrelated image
RESOLUTION_PROMPTS = {
    "Flood": {
        "labels": [
            "Clear flood scene",
            "Active flood",
            "Road closed or blocked",
            "Unrelated random image",
        ],
        "prompts": [
            (
                "a normal dry house, open dry road, clear street, "
                "green lawn, or safe area with no flood water, "
                "no waterlogging, no barricades, and no road closure"
            ),
            (
                "an active flood, flood water, waterlogging, "
                "or a flooded road"
            ),
            (
                "a road closed sign, detour sign, traffic barricades, "
                "blocked street, construction barrier, closed road, "
                "or inaccessible road"
            ),
            (
                "a cat, dog, pet, selfie, food, document, screenshot, "
                "indoor object, or unrelated random image"
            ),
        ],
    },

    "Blocked Road": {
        "labels": [
            "Clear blocked road scene",
            "Active blocked road",
            "Road closed or blocked",
            "Unrelated random image",
        ],
        "prompts": [
            (
                "a clear open road, normal dry street, normal house, "
                "or safe area with no debris, no obstruction, "
                "no barricades, and no road closure"
            ),
            (
                "a road blocked by debris, rocks, vehicles, "
                "fallen objects, trees, or obstacles"
            ),
            (
                "a road closed sign, detour sign, traffic barricades, "
                "blocked street, construction barrier, closed road, "
                "or inaccessible road"
            ),
            (
                "a cat, dog, pet, selfie, food, document, screenshot, "
                "indoor object, or unrelated random image"
            ),
        ],
    },

    "Structural Damage": {
        "labels": [
            "Clear structural damage scene",
            "Active structural damage",
            "Road closed or blocked",
            "Unrelated random image",
        ],
        "prompts": [
            (
                "a normal safe house, repaired building, undamaged building, "
                "or clear safe area with no structural damage, "
                "no barricades, and no danger"
            ),
            (
                "a damaged building, collapsed building, broken structure, "
                "unsafe structural damage, or debris"
            ),
            (
                "a road closed sign, detour sign, traffic barricades, "
                "blocked street, construction barrier, closed road, "
                "or inaccessible road"
            ),
            (
                "a cat, dog, pet, selfie, food, document, screenshot, "
                "indoor object, or unrelated random image"
            ),
        ],
    },

    "Landslide": {
        "labels": [
            "Clear landslide scene",
            "Active landslide",
            "Road closed or blocked",
            "Unrelated random image",
        ],
        "prompts": [
            (
                "a clear open road, normal dry street, normal house, "
                "or safe area with no mud, no rocks, no debris, "
                "no road closure, and no barricades"
            ),
            (
                "an active landslide, mudslide, mud, rocks, "
                "or debris blocking a road"
            ),
            (
                "a road closed sign, detour sign, traffic barricades, "
                "blocked street, construction barrier, closed road, "
                "or inaccessible road"
            ),
            (
                "a cat, dog, pet, selfie, food, document, screenshot, "
                "indoor object, or unrelated random image"
            ),
        ],
    },

    "Fire": {
        "labels": [
            "Clear fire scene",
            "Active fire",
            "Road closed or blocked",
            "Unrelated random image",
        ],
        "prompts": [
            (
                "a normal safe house, normal building, clear area, "
                "or safe scene with no fire, no smoke, no flames, "
                "no barricades, and no emergency"
            ),
            (
                "an active fire, flames, burning building, wildfire, "
                "heavy smoke, or dangerous fire scene"
            ),
            (
                "a road closed sign, detour sign, traffic barricades, "
                "blocked street, construction barrier, closed road, "
                "or inaccessible road"
            ),
            (
                "a cat, dog, pet, selfie, food, document, screenshot, "
                "indoor object, or unrelated random image"
            ),
        ],
    },

    "Fallen Tree": {
        "labels": [
            "Clear fallen tree scene",
            "Active fallen tree hazard",
            "Road closed or blocked",
            "Unrelated random image",
        ],
        "prompts": [
            (
                "a clear open road, normal dry street, normal house, "
                "or safe area after a fallen tree has been removed, "
                "with no barricades and no road closure"
            ),
            (
                "a fallen tree blocking a road, path, vehicle, "
                "building, or public area"
            ),
            (
                "a road closed sign, detour sign, traffic barricades, "
                "blocked street, construction barrier, closed road, "
                "or inaccessible road"
            ),
            (
                "a cat, dog, pet, selfie, food, document, screenshot, "
                "indoor object, or unrelated random image"
            ),
        ],
    },

    "Other": {
        "labels": [
            "Clear emergency scene",
            "Active emergency scene",
            "Road closed or blocked",
            "Unrelated random image",
        ],
        "prompts": [
            (
                "a normal safe house, normal dry road, clear area, "
                "or safe scene with no disaster, no emergency, "
                "no barricades, and no road closure"
            ),
            (
                "an active emergency, natural disaster, visible danger, "
                "serious damage, fire, flood, or unsafe hazard"
            ),
            (
                "a road closed sign, detour sign, traffic barricades, "
                "blocked street, construction barrier, closed road, "
                "or inaccessible road"
            ),
            (
                "a cat, dog, pet, selfie, food, document, screenshot, "
                "indoor object, or unrelated random image"
            ),
        ],
    },
}

# Clear unrelated pet/selfie/document images are rejected.
UNRELATED_REJECT_CONFIDENCE = 0.45

# Road Closed / Detour / barricade images must not resolve any incident.
ROAD_CLOSED_REJECT_CONFIDENCE = 0.45

# Active flood, fire, tree, landslide, etc. must be strongly detected.
ACTIVE_HAZARD_REJECT_CONFIDENCE = 0.55

# Accept only when CLIP identifies a clear scene with enough confidence.
CLEAR_SCENE_APPROVE_CONFIDENCE = 0.50


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