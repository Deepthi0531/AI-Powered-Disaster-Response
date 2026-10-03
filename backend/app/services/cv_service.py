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

    device = torch.device(
        "cuda" if torch.cuda.is_available() else "cpu"
    )

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


# ============================================================
# INCIDENT CLASSIFICATION PROMPTS
#
# IMPORTANT:
# This classification is independent of the original
# incident type.
#
# Therefore:
#
# Blocked Road incident + Flood image
#
# can actually become:
#
# detected_type = Flood
#
# instead of being forced into "Blocked Road".
# ============================================================

INCIDENT_TYPE_PROMPTS = [

    (
        "a photograph showing flood water, flooding, "
        "waterlogging, submerged roads, or a flooded area"
    ),

    (
        "a photograph showing a road blocked by debris, "
        "rocks, vehicles, objects, rubble, or obstacles"
    ),

    (
        "a photograph showing structural damage, "
        "a damaged building, collapsed building, "
        "broken structure, or unsafe building"
    ),

    (
        "a photograph showing a landslide, mudslide, "
        "mud, rocks, soil, or landslide debris"
    ),

    (
        "a photograph showing fire, flames, smoke from fire, "
        "a burning building, wildfire, or another active fire"
    ),

    (
        "a photograph showing a fallen tree, "
        "tree lying across a road, path, vehicle, or building"
    ),

    (
        "a photograph showing another natural disaster, "
        "emergency, accident, or dangerous situation"
    ),

    (
        "a normal safe scene with no flood, no blocked road, "
        "no structural damage, no landslide, no fire, "
        "no fallen tree, and no visible emergency"
    ),
]


# ============================================================
# RESOLUTION PROMPTS
# ============================================================

RESOLUTION_PROMPTS = {

    "Flood": {

        "labels": [
            "Clear flood scene",
            "Active flood",
            "Unrelated random image",
        ],

        "prompts": [

            (
                "a normal dry area, dry road, dry house, "
                "clear street, or safe area with no flood water "
                "and no waterlogging"
            ),

            (
                "an active flood with flood water, "
                "waterlogging, submerged roads, "
                "or a flooded area"
            ),

            (
                "a cat, dog, pet, selfie, food, document, "
                "screenshot, indoor object, or unrelated "
                "random image"
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
                "a clear open road with no debris, "
                "no rocks, no fallen objects, no blockage, "
                "and vehicles able to pass normally"
            ),

            (
                "a road blocked by debris, rocks, rubble, "
                "vehicles, fallen objects, tree branches, "
                "mud, or other obstacles"
            ),

            (
                "a cat, dog, pet, selfie, food, document, "
                "screenshot, indoor object, or unrelated "
                "random image"
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
                "a normal safe building, repaired building, "
                "undamaged building, intact walls, intact roof, "
                "or safe area with no structural damage"
            ),

            (
                "a damaged building, collapsed building, "
                "broken walls, damaged roof, broken structure, "
                "or unsafe structural damage"
            ),

            (
                "a cat, dog, pet, selfie, food, document, "
                "screenshot, indoor object, or unrelated "
                "random image"
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
                "a clear road or clear area with no mud, "
                "no rocks, no landslide debris, and no soil "
                "blocking the road"
            ),

            (
                "an active landslide, mudslide, mud, rocks, "
                "soil, rubble, or landslide debris blocking "
                "a road or area"
            ),

            (
                "a cat, dog, pet, selfie, food, document, "
                "screenshot, indoor object, or unrelated "
                "random image"
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
                "a normal safe building or clear area with "
                "no flames, no fire, and no visible smoke"
            ),

            (
                "an active fire with flames, burning building, "
                "wildfire, smoke, or visible burning objects"
            ),

            (
                "a cat, dog, pet, selfie, food, document, "
                "screenshot, indoor object, or unrelated "
                "random image"
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
                "a clear road with no fallen tree, "
                "no branches blocking the road, and a safe "
                "area after the fallen tree has been removed"
            ),

            (
                "a fallen tree blocking a road, path, "
                "vehicle, building, or other area"
            ),

            (
                "a cat, dog, pet, selfie, food, document, "
                "screenshot, indoor object, or unrelated "
                "random image"
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
                "a normal safe house, normal road, clear area, "
                "and a scene with no disaster and no emergency"
            ),

            (
                "an active emergency, natural disaster, "
                "visible danger, serious accident, or serious damage"
            ),

            (
                "a cat, dog, pet, selfie, food, document, "
                "screenshot, indoor object, or unrelated "
                "random image"
            ),
        ],
    },
}


# ============================================================
# THRESHOLDS
# ============================================================

# If another disaster type is detected with at least this
# confidence, we reject the resolution proof.
#
# Example:
#
# Original = Blocked Road
# Detected  = Flood 72%
#
# => REJECT
#
TYPE_MISMATCH_REJECT_CONFIDENCE = 0.35


# If the "No Incident" class is sufficiently strong, the image
# can potentially represent a cleared scene.
NO_INCIDENT_ACCEPT_CONFIDENCE = 0.35


# Random unrelated images are rejected above this confidence.
UNRELATED_REJECT_CONFIDENCE = 0.45


# Active hazard needs strong evidence before rejection.
ACTIVE_HAZARD_REJECT_CONFIDENCE = 0.65


# ============================================================
# MODEL
# ============================================================

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

    """
    CV analysis for a newly reported incident image.
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

            "status":
                "pending_review",

            "confidence_score":
                round(
                    prediction["confidence"] / 100,
                    4,
                ),

            "detected_labels":
                [prediction["label"]],

            "detected_type":
                prediction["label"],

            "detections":
                detections,

            "image_width":
                width,

            "image_height":
                height,

            "image_format":
                image_format,

            "model":
                "CLIP Zero-Shot Image Classifier",

            "message":
                (
                    "Computer Vision prediction: "
                    f"{prediction['label']} "
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

def verify_resolution_proof(
    image_path,
    incident_type,
):

    """
    Verify whether an uploaded image is valid proof
    that an incident has been resolved.

    IMPORTANT TWO-STAGE PROCESS:

    Stage 1:
        Determine what type of incident is actually visible.

    Stage 2:
        Determine whether the original incident is still active
        or has been cleared.

    This prevents:

        Blocked Road incident
                    +
        Flood image
                    =
        WRONG APPROVAL

    """

    # ========================================================
    # IMAGE VALIDATION
    # ========================================================

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

        best_resolution = (
            resolution_detections[0]
        )

        resolution_label = (
            best_resolution["label"]
        )

        resolution_confidence = (
            best_resolution["confidence"]
            / 100
        )

        # ====================================================
        # RESULT OBJECT
        # ====================================================

        result = {

            "confidence_score":
                round(
                    resolution_confidence,
                    4,
                ),

            "detected_labels":
                [resolution_label],

            "detections":
                resolution_detections,

            "incident_type":
                original_incident_type,

            "detected_type":
                detected_type,

            "detected_type_confidence":
                round(
                    detected_type_confidence,
                    4,
                ),

            "expected_type":
                original_incident_type,

            "incident_type_matches":
                (
                    detected_type
                    == original_incident_type
                    or detected_type
                    == "No Incident"
                ),

            "image_width":
                width,

            "image_height":
                height,

            "image_format":
                image_format,

            "model":
                "CLIP Resolution Proof Verifier",

            "mode":
                "Two_Stage_Resolution_Verification",
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

                "status":
                    "rejected",

                "reason":
                    "unrelated_image",

                "message":
                    (
                        "Proof rejected. The uploaded "
                        "image appears to be unrelated "
                        "to the incident."
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

                "status":
                    "rejected",

                "reason":
                    "hazard_still_active",

                "message":
                    (
                        "Proof rejected. Computer Vision "
                        "strongly indicates that the "
                        f"{original_incident_type} hazard "
                        "may still be active."
                    ),
            }

        # ====================================================
        # CASE 3
        #
        # ANOTHER INCIDENT IS DETECTED BUT BELOW THE HARD
        # MISMATCH THRESHOLD.
        #
        # If the image is clearly NOT a clean scene, be
        # conservative instead of automatically approving.
        # ====================================================

        if (
            detected_type
            != original_incident_type
            and detected_type
            != "No Incident"
        ):

            return {

                **result,

                "status":
                    "needs_new_proof",

                "reason":
                    "uncertain_incident_type",

                "message":
                    (
                        "Computer Vision detected a scene "
                        "that does not clearly match the "
                        "original incident. Please upload "
                        "clearer resolution proof."
                    ),
            }

        # ====================================================
        # CASE 4
        #
        # NO INCIDENT + CLEAR SCENE
        #
        # This is what we want for a resolved incident.
        #
        # Example:
        #
        # Blocked Road
        #       ↓
        # Clear road
        #       ↓
        # No Incident detected
        #       ↓
        # Clear blocked-road scene
        #       ↓
        # APPROVE
        # ====================================================

        if (
            detected_type
            == "No Incident"
            and resolution_label
            == "Clear blocked road scene"
            and original_incident_type
            == "Blocked Road"
        ):

            return {

                **result,

                "status":
                    "approved",

                "reason":
                    "incident_cleared",

                "message":
                    (
                        "Proof accepted. The image shows "
                        "a clear road with no visible "
                        "road blockage."
                    ),
            }

        if (
            detected_type
            == "No Incident"
            and resolution_label
            == "Clear flood scene"
            and original_incident_type
            == "Flood"
        ):

            return {

                **result,

                "status":
                    "approved",

                "reason":
                    "incident_cleared",

                "message":
                    (
                        "Proof accepted. The image shows "
                        "a clear scene with no visible "
                        "flooding or waterlogging."
                    ),
            }

        if (
            detected_type
            == "No Incident"
            and resolution_label
            == "Clear structural damage scene"
            and original_incident_type
            == "Structural Damage"
        ):

            return {

                **result,

                "status":
                    "approved",

                "reason":
                    "incident_cleared",

                "message":
                    (
                        "Proof accepted. The image shows "
                        "a normal safe structure with no "
                        "obvious structural damage."
                    ),
            }

        if (
            detected_type
            == "No Incident"
            and resolution_label
            == "Clear landslide scene"
            and original_incident_type
            == "Landslide"
        ):

            return {

                **result,

                "status":
                    "approved",

                "reason":
                    "incident_cleared",

                "message":
                    (
                        "Proof accepted. The image shows "
                        "a clear area with no visible "
                        "landslide debris."
                    ),
            }

        if (
            detected_type
            == "No Incident"
            and resolution_label
            == "Clear fire scene"
            and original_incident_type
            == "Fire"
        ):

            return {

                **result,

                "status":
                    "approved",

                "reason":
                    "incident_cleared",

                "message":
                    (
                        "Proof accepted. The image shows "
                        "no visible flames or active fire."
                    ),
            }

        if (
            detected_type
            == "No Incident"
            and resolution_label
            == "Clear fallen tree scene"
            and original_incident_type
            == "Fallen Tree"
        ):

            return {

                **result,

                "status":
                    "approved",

                "reason":
                    "incident_cleared",

                "message":
                    (
                        "Proof accepted. The image shows "
                        "a clear area with no visible "
                        "fallen-tree obstruction."
                    ),
            }

        # ====================================================
        # CASE 5
        #
        # OTHER INCIDENT
        # ====================================================

        if (
            original_incident_type
            == "Other"
            and detected_type
            == "No Incident"
            and resolution_label
            == "Clear emergency scene"
        ):

            return {

                **result,

                "status":
                    "approved",

                "reason":
                    "incident_cleared",

                "message":
                    (
                        "Proof accepted. The image shows "
                        "a clear scene with no visible "
                        "emergency."
                    ),
            }

        # ====================================================
        # CASE 6
        #
        # EVERYTHING ELSE IS NOT SAFE ENOUGH TO APPROVE
        #
        # This is deliberate.
        #
        # Previously your code did:
        #
        #     anything not rejected
        #            ↓
        #         APPROVED
        #
        # That was dangerous.
        #
        # Now:
        #
        #     anything not clearly approved
        #            ↓
        #       NEEDS NEW PROOF
        # ====================================================

        return {

            **result,

            "status":
                "needs_new_proof",

            "reason":
                "insufficient_resolution_evidence",

            "message":
                (
                    "Computer Vision could not confidently "
                    "verify that the incident has been "
                    "resolved. Please upload a clearer "
                    "photo of the affected area."
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