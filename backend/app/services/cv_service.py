import logging
import os

from PIL import Image, UnidentifiedImageError

logger = logging.getLogger(__name__)

MODEL_ID = "openai/clip-vit-base-patch32"

processor = None
model = None
device = None
CV_MODEL_LOADED = False


# ============================================================
# LOAD CLIP
# ============================================================

try:
    import torch

    from transformers import (
        AutoModelForZeroShotImageClassification,
        AutoProcessor,
    )

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    CV_MODEL_LOADED = True

except Exception as error:

    logger.warning(
        f"CLIP dependencies unavailable: {error}"
    )

    CV_MODEL_LOADED = False


# ============================================================
# INCIDENT TYPES
# ============================================================

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
            "Road closed or blocked",
            "Unrelated random image",
        ],

        "prompts": [

            (
                "a normal dry house, dry road, clear street, green lawn, "
                "or safe area with no flood water and no waterlogging"
            ),

            (
                "an active flood with flood water, "
                "waterlogging, submerged roads, "
                "or a flooded area"
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
            "Road closed or blocked",
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
            "Road closed or blocked",
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
            "Road closed or blocked",
            "Unrelated random image",
        ],

        "prompts": [

            (
                "a clear road, normal dry street, normal house, "
                "or safe area with no mud, rocks, debris, or landslide"
            ),

            (
                "an active landslide, mudslide, mud, rocks, "
                "soil, rubble, or landslide debris blocking "
                "a road or area"
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
            "Road closed or blocked",
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
            "Road closed or blocked",
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
            "Road closed or blocked",
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

    global processor
    global model

    if not CV_MODEL_LOADED:
        return None, None

    if processor is None or model is None:

        logger.info(
            f"Loading CLIP model: {MODEL_ID}"
        )

        processor = AutoProcessor.from_pretrained(
            MODEL_ID
        )

        model = (
            AutoModelForZeroShotImageClassification
            .from_pretrained(MODEL_ID)
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


# ============================================================
# GENERIC CLIP CLASSIFICATION
# ============================================================

def classify_image(
    image,
    labels,
    prompts,
):

    image_processor, clip_model = get_model()

    if (
        image_processor is None
        or clip_model is None
    ):
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

        outputs = clip_model(
            **inputs
        )

        probabilities = (
            outputs
            .logits_per_image[0]
            .softmax(dim=0)
        )

    detections = [

        {
            "label": label,
            "confidence": round(
                score * 100,
                2,
            ),
        }

        for label, score in zip(
            labels,
            probabilities.cpu().tolist(),
        )
    ]

    detections.sort(
        key=lambda detection:
            detection["confidence"],
        reverse=True,
    )

    return detections


# ============================================================
# INCIDENT TYPE CLASSIFICATION
# ============================================================

def classify_incident_type(image):

    """
    Independently classify what kind of incident is visible
    in the uploaded image.

    This is VERY important for resolution validation.

    Example:

        Original incident:
            Blocked Road

        Uploaded proof:
            Flood

    This function can return:

        Flood: 72%
        Blocked Road: 15%
        ...
    """

    detections = classify_image(
        image,
        INCIDENT_TYPES,
        INCIDENT_TYPE_PROMPTS,
    )

    if not detections:
        return None

    return detections


# ============================================================
# INITIAL INCIDENT VERIFICATION
# ============================================================

def verify_incident_image(image_path):
    """CV analysis for a newly reported incident image."""
    is_valid, width, height, image_format = get_image_details(image_path)

    if not is_valid:

        return {

            "status":
                "invalid_image",

            "confidence_score":
                0.0,

            "detected_labels":
                [],

            "detections":
                [],

            "model":
                "CLIP Zero-Shot Image Classifier",

            "message":
                "The uploaded file is not a valid image.",
        }

    if not CV_MODEL_LOADED:

        return {

            "status":
                "pending_review",

            "confidence_score":
                0.0,

            "detected_labels":
                ["Image received"],

            "detections":
                [],

            "image_width":
                width,

            "image_height":
                height,

            "image_format":
                image_format,

            "model":
                "Computer Vision Unavailable",

            "message":
                "Image is valid but CV is unavailable.",
        }

    try:

        with Image.open(
            image_path
        ) as source_image:

            image = source_image.convert(
                "RGB"
            )

            detections = classify_incident_type(
                image
            )

        if not detections:

            return {

                "status":
                    "pending_review",

                "confidence_score":
                    0.0,

                "detected_labels":
                    [],

                "detections":
                    [],

                "model":
                    "CLIP Zero-Shot Image Classifier",

                "message":
                    "CV could not analyse this image.",
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

        logger.error(
            f"Initial incident CV error: {error}"
        )

        return {

            "status":
                "pending_review",

            "confidence_score":
                0.0,

            "detected_labels":
                [],

            "detections":
                [],

            "model":
                "CLIP Zero-Shot Image Classifier",

            "message":
                "CV could not analyse this image.",
        }


# ============================================================
# RESOLUTION PROOF VERIFICATION
# ============================================================

def verify_resolution_proof(image_path, incident_type):
    """
    Automatic proof verification.

    Normal dry house/road/clear scene -> approved.
    Very clear active incident -> rejected.
    Cat/dog/selfie/food/document -> rejected.
    """

    is_valid, width, height, image_format = (
        get_image_details(image_path)
    )

    if not is_valid:

        return {

            "status":
                "invalid_image",

            "confidence_score":
                0.0,

            "detected_labels":
                [],

            "detections":
                [],

            "model":
                "CLIP Resolution Proof Verifier",

            "message":
                "The uploaded proof is not a valid image.",
        }

    # ========================================================
    # NORMALIZE INCIDENT TYPE
    # ========================================================

    original_incident_type = (
        str(incident_type or "Other")
        .strip()
    )

    if original_incident_type not in RESOLUTION_PROMPTS:

        original_incident_type = "Other"

    # ========================================================
    # CV AVAILABILITY
    # ========================================================

    if not CV_MODEL_LOADED:

        return {

            "status":
                "needs_new_proof",

            "confidence_score":
                0.0,

            "detected_labels":
                [],

            "detections":
                [],

            "model":
                "Computer Vision Unavailable",

            "message":
                "Computer vision is unavailable.",
        }

    try:

        # ====================================================
        # OPEN IMAGE
        # ====================================================

        with Image.open(
            image_path
        ) as source_image:

            image = source_image.convert(
                "RGB"
            )

            # =================================================
            # STAGE 1
            #
            # WHAT KIND OF INCIDENT IS ACTUALLY IN THE IMAGE?
            # =================================================

            incident_detections = (
                classify_incident_type(
                    image
                )
            )

            if not incident_detections:

                return {

                    "status":
                        "needs_new_proof",

                    "confidence_score":
                        0.0,

                    "detected_labels":
                        [],

                    "detections":
                        [],

                    "model":
                        "CLIP Resolution Proof Verifier",

                    "message":
                        (
                            "Computer Vision could not "
                            "identify the uploaded scene."
                        ),
                }

            detected_incident = (
                incident_detections[0]
            )

            detected_type = (
                detected_incident["label"]
            )

            detected_type_confidence = (
                detected_incident["confidence"]
                / 100
            )

            # =================================================
            # FIND ORIGINAL INCIDENT CONFIDENCE
            # =================================================

            original_confidence = 0.0

            for detection in incident_detections:

                if (
                    detection["label"]
                    == original_incident_type
                ):

                    original_confidence = (
                        detection["confidence"]
                        / 100
                    )

                    break

            # =================================================
            # PRINT EVERYTHING FOR DEBUGGING
            # =================================================

            print("\n")
            print("==============================================")
            print("       CV RESOLUTION TYPE CHECK")
            print("==============================================")

            print(
                "Original incident:",
                original_incident_type,
            )

            print(
                "Detected image type:",
                detected_type,
            )

            print(
                "Detected confidence:",
                round(
                    detected_type_confidence * 100,
                    2,
                ),
                "%",
            )

            print(
                "Original-type confidence:",
                round(
                    original_confidence * 100,
                    2,
                ),
                "%",
            )

            print(
                "All incident detections:"
            )

            for detection in incident_detections:

                print(
                    f"  {detection['label']}: "
                    f"{detection['confidence']}%"
                )

            print("==============================================")
            print("\n")

            # =================================================
            # STAGE 1A
            #
            # IF A DIFFERENT REAL DISASTER IS STRONGLY
            # DETECTED, REJECT.
            #
            # Example:
            #
            # Original:
            #     Blocked Road
            #
            # Uploaded:
            #     Flood
            #
            # Detected:
            #     Flood 72%
            #
            # => REJECT
            # =================================================

            if (
                detected_type
                != original_incident_type
                and detected_type
                != "No Incident"
                and detected_type_confidence
                >= TYPE_MISMATCH_REJECT_CONFIDENCE
            ):

                return {

                    "status":
                        "rejected",

                    "confidence_score":
                        round(
                            detected_type_confidence,
                            4,
                        ),

                    "detected_labels":
                        [detected_type],

                    "detected_type":
                        detected_type,

                    "expected_type":
                        original_incident_type,

                    "detections":
                        incident_detections,

                    "image_width":
                        width,

                    "image_height":
                        height,

                    "image_format":
                        image_format,

                    "model":
                        "CLIP Resolution Proof Verifier",

                    "reason":
                        "incident_type_mismatch",

                    "message":
                        (
                            "Proof rejected. The uploaded "
                            f"image appears to show "
                            f"'{detected_type}', while the "
                            f"original incident was "
                            f"'{original_incident_type}'. "
                            "Please upload proof related "
                            "to the original incident."
                        ),
                }

            # =================================================
            # STAGE 2
            #
            # NOW CHECK WHETHER THE ORIGINAL HAZARD IS ACTIVE
            # OR CLEARED.
            # =================================================

            config = RESOLUTION_PROMPTS[
                original_incident_type
            ]

            resolution_detections = (
                classify_image(
                    image,
                    config["labels"],
                    config["prompts"],
                )
            )

        if not resolution_detections:

            return {

                "status":
                    "needs_new_proof",

                "confidence_score":
                    0.0,

                "detected_labels":
                    [],

                "detections":
                    incident_detections,

                "model":
                    "CLIP Resolution Proof Verifier",

                "message":
                    (
                        "Computer Vision could not "
                        "analyse the resolution proof."
                    ),
            }

        # ====================================================
        # RESOLUTION PREDICTION
        # ====================================================

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

        # ====================================================
        # CASE 1
        #
        # RANDOM / UNRELATED IMAGE
        # ====================================================

        if (
            resolution_label
            == "Unrelated random image"
            and resolution_confidence
            >= UNRELATED_REJECT_CONFIDENCE
        ):

            return {

                **result,
                "status": "rejected",
                "message": (
                    f"Proof rejected: uploaded image is unrelated "
                    f"to the {incident_type} incident."
                ),
            }

        # ====================================================
        # CASE 2
        #
        # ACTIVE HAZARD
        # ====================================================

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
            resolution_label
            in active_labels
            and resolution_confidence
            >= ACTIVE_HAZARD_REJECT_CONFIDENCE
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

    # ========================================================
    # UNEXPECTED CV ERROR
    # ========================================================

    except Exception as error:

        logger.error(
            "Proof CV verification error: "
            f"{error}"
        )

        return {

            "status":
                "needs_new_proof",

            "confidence_score":
                0.0,

            "detected_labels":
                [],

            "detections":
                [],

            "model":
                "CLIP Resolution Proof Verifier",

            "message":
                (
                    "Computer Vision could not "
                    "verify this proof image."
                ),
        }