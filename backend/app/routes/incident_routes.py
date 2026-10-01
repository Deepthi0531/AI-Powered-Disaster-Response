import math
import os
import uuid
from datetime import datetime

import requests
from bson.objectid import ObjectId
from flask import Blueprint, jsonify, request
from werkzeug.utils import secure_filename

from app.services.cv_service import (
    verify_incident_image,
    verify_resolution_proof,
)
from app.services.weather_service import verify_with_weather


UPLOAD_FOLDER = os.path.join(
    os.path.dirname(__file__),
    "..",
    "..",
    "uploads",
)

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
INCIDENT_MATCH_RADIUS_METERS = 100

os.makedirs(UPLOAD_FOLDER, exist_ok=True)


def allowed_file(filename):
    return (
        "." in filename
        and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS
    )


def calculate_distance_meters(lat1, lon1, lat2, lon2):
    earth_radius = 6371000

    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)

    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1_rad)
        * math.cos(lat2_rad)
        * math.sin(delta_lon / 2) ** 2
    )

    c = 2 * math.atan2(
        math.sqrt(a),
        math.sqrt(1 - a),
    )

    return earth_radius * c


def get_community_confidence(upcount):
    if upcount >= 4:
        return "High"

    if upcount >= 2:
        return "Medium"

    return "Low"


def get_readable_location(latitude, longitude):
    """Convert GPS coordinates into a readable address."""

    try:
        response = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={
                "lat": latitude,
                "lon": longitude,
                "format": "jsonv2",
            },
            headers={
                "User-Agent": "DisasterGuard/1.0",
            },
            timeout=5,
        )

        if response.status_code == 200:
            data = response.json()

            return data.get(
                "display_name",
                "Location unavailable",
            )

    except Exception as error:
        print(
            f"Location lookup error: {error}"
        )

    return "Location unavailable"


def serialize_incident(incident):
    """Convert MongoDB ObjectId into text."""

    incident["_id"] = str(
        incident["_id"]
    )

    return incident


def get_incident_query(incident_id):
    """Create a safe MongoDB incident query."""

    if ObjectId.is_valid(incident_id):
        return {
            "_id": ObjectId(incident_id)
        }

    return {
        "_id": incident_id
    }


def init_incident_routes(db):

    incident_bp = Blueprint(
        "incident_bp",
        __name__,
    )

    # ==================================================
    # 1. REPORT INCIDENT
    # ==================================================

    @incident_bp.route(
        "/incidents/report",
        methods=["POST"],
    )
    def report_incident():

        if "image" not in request.files:
            return jsonify({
                "status": "error",
                "message": "Please upload an incident image.",
            }), 400

        file = request.files["image"]

        if not file or file.filename == "":
            return jsonify({
                "status": "error",
                "message": "Please select an image file.",
            }), 400

        if not allowed_file(file.filename):
            return jsonify({
                "status": "error",
                "message": (
                    "Only JPG, JPEG, PNG, and WEBP images "
                    "are allowed."
                ),
            }), 400

        incident_type = request.form.get(
            "type",
            "Flood",
        )

        allowed_incident_types = [
            "Flood",
            "Blocked Road",
            "Structural Damage",
            "Landslide",
            "Fire",
            "Fallen Tree",
            "Other",
        ]

        if incident_type not in allowed_incident_types:
            return jsonify({
                "status": "error",
                "message": "Invalid incident type.",
            }), 400

        description = request.form.get(
            "description",
            "",
        ).strip()

        severity = request.form.get(
            "severity",
            "Medium",
        )

        reporter_id = request.form.get(
            "reporter_id",
            "anonymous",
        )

        if len(description) > 500:
            return jsonify({
                "status": "error",
                "message": (
                    "Description must be 500 characters "
                    "or fewer."
                ),
            }), 400

        if severity not in [
            "Low",
            "Medium",
            "High",
        ]:
            return jsonify({
                "status": "error",
                "message": "Invalid severity level.",
            }), 400

        latitude = request.form.get(
            "latitude"
        )

        longitude = request.form.get(
            "longitude"
        )

        if not latitude or not longitude:
            return jsonify({
                "status": "error",
                "message": "Current location is required.",
            }), 400

        try:
            latitude = float(latitude)
            longitude = float(longitude)

        except (TypeError, ValueError):
            return jsonify({
                "status": "error",
                "message": "Invalid location coordinates.",
            }), 400

        if not (
            -90 <= latitude <= 90
            and -180 <= longitude <= 180
        ):
            return jsonify({
                "status": "error",
                "message": (
                    "Location coordinates are outside "
                    "the valid range."
                ),
            }), 400

        # --------------------------------------------------
        # Save uploaded image
        # --------------------------------------------------

        original_filename = secure_filename(
            file.filename
        )

        filename = (
            f"{uuid.uuid4().hex}_"
            f"{original_filename}"
        )

        filepath = os.path.join(
            UPLOAD_FOLDER,
            filename,
        )

        file.save(filepath)

        # --------------------------------------------------
        # Computer Vision verification
        # --------------------------------------------------

        try:
            cv_result = verify_incident_image(
                filepath
            )

        except Exception as error:

            print(
                "CV INCIDENT ERROR:",
                repr(error),
            )

            if os.path.exists(filepath):
                os.remove(filepath)

            return jsonify({
                "status": "error",
                "message": (
                    "Computer Vision could not process "
                    "the incident image."
                ),
                "error": str(error),
            }), 500

        if cv_result.get(
            "status"
        ) == "invalid_image":

            if os.path.exists(filepath):
                os.remove(filepath)

            return jsonify({
                "status": "error",
                "message": cv_result.get(
                    "message",
                    "The uploaded file is not a valid image.",
                ),
            }), 400

        # --------------------------------------------------
        # Weather verification
        # --------------------------------------------------

        weather_result = verify_with_weather(
            latitude,
            longitude,
            incident_type,
        )

        location_name = get_readable_location(
            latitude,
            longitude,
        )

        incident_status = "PENDING"

        cv_result["status"] = "pending_review"

        # --------------------------------------------------
        # Check nearby duplicate incidents
        # --------------------------------------------------

        existing_incidents = db.incidents.find({
            "type": incident_type,
            "status": {
                "$in": [
                    "PENDING",
                    "VERIFIED",
                ],
            },
        })

        for existing_incident in existing_incidents:

            coordinates = (
                existing_incident
                .get("location", {})
                .get("coordinates", [])
            )

            if len(coordinates) != 2:
                continue

            existing_longitude = coordinates[0]
            existing_latitude = coordinates[1]

            distance = calculate_distance_meters(
                latitude,
                longitude,
                existing_latitude,
                existing_longitude,
            )

            if distance <= INCIDENT_MATCH_RADIUS_METERS:

                new_upcount = (
                    existing_incident.get(
                        "upcount",
                        1,
                    )
                    + 1
                )

                community_confidence = (
                    get_community_confidence(
                        new_upcount
                    )
                )

                db.incidents.update_one(
                    {
                        "_id": existing_incident["_id"]
                    },
                    {
                        "$set": {
                            "upcount": new_upcount,

                            "community_confidence":
                                community_confidence,

                            "location_name":
                                existing_incident.get(
                                    "location_name",
                                    location_name,
                                ),

                            "updated_at":
                                datetime.utcnow(),
                        }
                    },
                )

                if os.path.exists(filepath):
                    os.remove(filepath)

                return jsonify({
                    "status": "success",

                    "message": (
                        "This incident was already "
                        "reported nearby. Your report "
                        "was counted as a confirmation."
                    ),

                    "incident_id": str(
                        existing_incident["_id"]
                    ),

                    "duplicate": True,

                    "upcount": new_upcount,

                    "community_confidence":
                        community_confidence,

                    "matching_distance_meters":
                        round(distance, 2),

                    "verification": {
                        "cv": cv_result,
                        "weather": weather_result,
                        "overall_status":
                            existing_incident.get(
                                "status",
                                "PENDING",
                            ),
                    },

                }), 200

        # --------------------------------------------------
        # Create new incident
        # --------------------------------------------------

        incident_doc = {

            "reporter_id":
                reporter_id,

            "type":
                incident_type,

            "severity":
                severity,

            "description":
                description,

            "image_url":
                f"uploads/{filename}",

            "original_filename":
                original_filename,

            "location_name":
                location_name,

            "location": {
                "type": "Point",
                "coordinates": [
                    longitude,
                    latitude,
                ],
            },

            "image_details": {
                "format":
                    cv_result.get(
                        "image_format"
                    ),

                "width":
                    cv_result.get(
                        "image_width"
                    ),

                "height":
                    cv_result.get(
                        "image_height"
                    ),
            },

            "cv_verification": {

                "status":
                    cv_result.get(
                        "status",
                        "pending_review",
                    ),

                "confidence_score":
                    cv_result.get(
                        "confidence_score",
                        0.0,
                    ),

                "detected_labels":
                    cv_result.get(
                        "detected_labels",
                        [],
                    ),

                "detections":
                    cv_result.get(
                        "detections",
                        [],
                    ),

                "model":
                    cv_result.get(
                        "model",
                        "Computer Vision Classifier",
                    ),

                "message":
                    cv_result.get(
                        "message",
                        "",
                    ),
            },

            "weather_verification":
                weather_result,

            "overall_confidence":
                "Pending review",

            "status":
                incident_status,

            "upcount":
                1,

            "community_confidence":
                "Low",

            "created_at":
                datetime.utcnow(),

            "updated_at":
                datetime.utcnow(),
        }

        inserted_id = (
            db.incidents
            .insert_one(incident_doc)
            .inserted_id
        )

        return jsonify({

            "status":
                "success",

            "message":
                "Incident submitted successfully.",

            "incident_id":
                str(inserted_id),

            "location_name":
                location_name,

            "verification": {
                "cv":
                    cv_result,

                "weather":
                    weather_result,

                "overall_status":
                    incident_status,
            },

        }), 201

    # ==================================================
    # 2. VERIFIED INCIDENTS
    # ==================================================

    @incident_bp.route(
        "/incidents/verified",
        methods=["GET"],
    )
    def get_verified_incidents():

        incidents = list(
            db.incidents.find({
                "status": "VERIFIED",
            })
        )

        for incident in incidents:
            serialize_incident(
                incident
            )

        return jsonify({
            "status": "success",
            "data": incidents,
        }), 200

    # ==================================================
    # 3. RESOLVE INCIDENT USING CV PROOF
    # ==================================================

    @incident_bp.route(
        "/incidents/resolve/<incident_id>",
        methods=["POST"],
    )
    def resolve_incident(incident_id):

        filepath = None

        try:

            # --------------------------------------------------
            # Check uploaded file
            # --------------------------------------------------

            if (
                "proof_image" not in request.files
                and "image" not in request.files
            ):
                return jsonify({
                    "status": "error",
                    "resolved": False,
                    "message":
                        "Resolution proof image is required.",
                }), 400

            file = request.files.get(
                "proof_image"
            )

            if file is None:
                file = request.files.get(
                    "image"
                )

            if (
                file is None
                or file.filename == ""
            ):
                return jsonify({
                    "status": "error",
                    "resolved": False,
                    "message":
                        "No proof image was selected.",
                }), 400

            # --------------------------------------------------
            # Validate extension
            # --------------------------------------------------

            if not allowed_file(
                file.filename
            ):
                return jsonify({
                    "status": "error",
                    "resolved": False,
                    "message": (
                        "Only JPG, JPEG, PNG, and WEBP "
                        "proof images are allowed."
                    ),
                }), 400

            # --------------------------------------------------
            # Find incident
            # --------------------------------------------------

            query_filter = get_incident_query(
                incident_id
            )

            existing_incident = (
                db.incidents.find_one(
                    query_filter
                )
            )

            if not existing_incident:
                return jsonify({
                    "status": "error",
                    "resolved": False,
                    "message":
                        "Incident not found in database.",
                }), 404

            current_status = (
                existing_incident.get(
                    "status",
                    "VERIFIED",
                )
            )

            if current_status == "RESOLVED":

                return jsonify({
                    "status": "error",
                    "resolved": True,
                    "message":
                        "This incident is already resolved.",
                }), 400

            # --------------------------------------------------
            # Save proof image
            # --------------------------------------------------

            original_filename = secure_filename(
                file.filename
            )

            filename = (
                f"proof_{uuid.uuid4().hex}_"
                f"{original_filename}"
            )

            filepath = os.path.join(
                UPLOAD_FOLDER,
                filename,
            )

            file.save(filepath)

            if not os.path.exists(filepath):

                return jsonify({
                    "status": "error",
                    "resolved": False,
                    "message":
                        "The proof image could not be saved.",
                }), 500

            # --------------------------------------------------
            # Original incident type
            # --------------------------------------------------

            incident_type = (
                existing_incident.get(
                    "type",
                    "Other",
                )
            )

            # --------------------------------------------------
            # CV verification
            # --------------------------------------------------

            print(
                "\n========== CV RESOLUTION =========="
            )

            print(
                "Incident ID:",
                incident_id,
            )

            print(
                "Incident type:",
                incident_type,
            )

            print(
                "Proof image:",
                filepath,
            )

            try:

                proof_result = (
                    verify_resolution_proof(
                        filepath,
                        incident_type,
                    )
                )

            except requests.exceptions.ConnectionError as error:

                print(
                    "CV CONNECTION ERROR:",
                    repr(error),
                )

                if os.path.exists(filepath):
                    os.remove(filepath)

                return jsonify({
                    "status":
                        "cv_unavailable",

                    "resolved":
                        False,

                    "message": (
                        "Computer Vision service is "
                        "unavailable. Please make sure "
                        "the CV service is running."
                    ),

                }), 503

            except requests.exceptions.Timeout as error:

                print(
                    "CV TIMEOUT ERROR:",
                    repr(error),
                )

                if os.path.exists(filepath):
                    os.remove(filepath)

                return jsonify({
                    "status":
                        "cv_unavailable",

                    "resolved":
                        False,

                    "message": (
                        "Computer Vision verification "
                        "timed out. Please try again."
                    ),

                }), 503

            except Exception as error:

                print(
                    "CV VERIFICATION ERROR:",
                    repr(error),
                )

                if os.path.exists(filepath):
                    os.remove(filepath)

                return jsonify({
                    "status":
                        "cv_error",

                    "resolved":
                        False,

                    "message": (
                        "Computer Vision could not "
                        "process the proof image."
                    ),

                    "error":
                        str(error),

                }), 500

            print(
                "CV RESULT:",
                proof_result,
            )

            print(
                "==================================\n"
            )

            # --------------------------------------------------
            # Validate CV response
            # --------------------------------------------------

            if not isinstance(
                proof_result,
                dict,
            ):

                if os.path.exists(filepath):
                    os.remove(filepath)

                return jsonify({
                    "status":
                        "cv_error",

                    "resolved":
                        False,

                    "message": (
                        "Computer Vision returned "
                        "an invalid response."
                    ),

                }), 500

            # --------------------------------------------------
            # Invalid image
            # --------------------------------------------------

            if (
                proof_result.get("status")
                == "invalid_image"
            ):

                if os.path.exists(filepath):
                    os.remove(filepath)

                return jsonify({

                    "status":
                        "invalid_image",

                    "resolved":
                        False,

                    "message":
                        proof_result.get(
                            "message",
                            "The proof file is not "
                            "a valid image.",
                        ),

                    "verification":
                        proof_result,

                }), 400

            # --------------------------------------------------
            # Save proof history
            # --------------------------------------------------

            proof_document = {

                "proof_url":
                    f"uploads/{filename}",

                "original_filename":
                    original_filename,

                "submitted_at":
                    datetime.utcnow(),

                "verification":
                    proof_result,
            }

            db.incidents.update_one(

                query_filter,

                {
                    "$push": {
                        "resolution_proofs":
                            proof_document,
                    },

                    "$set": {
                        "last_resolution_proof":
                            proof_document,

                        "updated_at":
                            datetime.utcnow(),
                    },
                },
            )

            # ==================================================
            # APPROVED
            # ==================================================

            if (
                proof_result.get("status")
                == "approved"
            ):

                db.incidents.update_one(

                    query_filter,

                    {
                        "$set": {

                            "status":
                                "RESOLVED",

                            "resolved_at":
                                datetime.utcnow(),

                            "resolution_method":
                                (
                                    "Automatic Computer "
                                    "Vision proof "
                                    "verification"
                                ),

                            "resolution_cv_verification":
                                proof_result,

                            "last_proof_status":
                                "APPROVED",

                            "updated_at":
                                datetime.utcnow(),
                        }
                    },
                )

                return jsonify({

                    "status":
                        "success",

                    "resolved":
                        True,

                    "message":
                        proof_result.get(
                            "message",
                            "Proof accepted. "
                            "Incident automatically "
                            "resolved.",
                        ),

                    "proof_url":
                        f"uploads/{filename}",

                    "verification":
                        proof_result,

                }), 200

            # ==================================================
            # REJECTED
            # ==================================================

            if (
                proof_result.get("status")
                == "rejected"
            ):

                rejection_reason = (
                    proof_result.get(
                        "message",
                        "Proof rejected by "
                        "Computer Vision.",
                    )
                )

                db.incidents.update_one(

                    query_filter,

                    {
                        "$set": {

                            "status":
                                current_status,

                            "last_proof_status":
                                "REJECTED",

                            "last_proof_rejection_reason":
                                rejection_reason,

                            "updated_at":
                                datetime.utcnow(),
                        }
                    },
                )

                return jsonify({

                    "status":
                        "rejected",

                    "resolved":
                        False,

                    "message":
                        rejection_reason,

                    "proof_url":
                        f"uploads/{filename}",

                    "verification":
                        proof_result,

                }), 422

            # ==================================================
            # NEEDS NEW PROOF
            # ==================================================

            db.incidents.update_one(

                query_filter,

                {
                    "$set": {

                        "status":
                            current_status,

                        "last_proof_status":
                            "NEEDS_NEW_PROOF",

                        "updated_at":
                            datetime.utcnow(),
                    }
                },
            )

            return jsonify({

                "status":
                    "needs_new_proof",

                "resolved":
                    False,

                "message":
                    proof_result.get(
                        "message",
                        "Computer Vision could not "
                        "confidently verify the "
                        "resolution. Please upload "
                        "a clearer image.",
                    ),

                "proof_url":
                    f"uploads/{filename}",

                "verification":
                    proof_result,

            }), 422

        # ==================================================
        # Unexpected backend error
        # ==================================================

        except Exception as error:

            print(
                "RESOLVE INCIDENT ERROR:",
                repr(error),
            )

            if (
                filepath
                and os.path.exists(filepath)
            ):
                try:
                    os.remove(filepath)
                except Exception:
                    pass

            return jsonify({

                "status":
                    "error",

                "resolved":
                    False,

                "message": (
                    "An unexpected server error "
                    "occurred while processing "
                    "the resolution proof."
                ),

                "error":
                    str(error),

            }), 500

    # ==================================================
    # 4. SHELTER RISK
    # ==================================================

    @incident_bp.route(
        "/predict-shelters-risk",
        methods=["POST"],
    )
    def predict_shelter_risk():

        try:

            shelters = list(
                db.shelters.find({})
            )

            for shelter in shelters:

                shelter["_id"] = str(
                    shelter["_id"]
                )

                if (
                    "latitude" not in shelter
                    or shelter["latitude"] is None
                ):

                    coordinates = (
                        shelter
                        .get("location", {})
                        .get(
                            "coordinates",
                            [0.0, 0.0],
                        )
                    )

                    shelter["latitude"] = (
                        float(coordinates[1])
                        if len(coordinates) >= 2
                        else 0.0
                    )

                    shelter["longitude"] = (
                        float(coordinates[0])
                        if len(coordinates) >= 2
                        else 0.0
                    )

                if "risk_level" not in shelter:
                    shelter["risk_level"] = "Low"

            return jsonify({

                "status":
                    "success",

                "shelters":
                    shelters,

            }), 200

        except Exception as error:

            return jsonify({

                "status":
                    "error",

                "message":
                    str(error),

            }), 500

    return incident_bp