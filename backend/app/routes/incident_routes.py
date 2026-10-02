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

ALLOWED_INCIDENT_TYPES = [
    "Flood",
    "Blocked Road",
    "Structural Damage",
    "Landslide",
    "Fire",
    "Fallen Tree",
    "Other",
]

INCIDENT_MATCH_RADIUS_METERS = 100

os.makedirs(UPLOAD_FOLDER, exist_ok=True)


def allowed_file(filename):
    return (
        "." in filename
        and filename.rsplit(".", 1)[1].lower()
        in ALLOWED_EXTENSIONS
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
            return response.json().get(
                "display_name",
                "Location unavailable",
            )

    except Exception as error:
        print(f"Location lookup error: {error}")

    return "Location unavailable"


def serialize_incident(incident):
    incident["_id"] = str(incident["_id"])
    return incident


def get_incident_query(incident_id):
    if ObjectId.is_valid(incident_id):
        return {
            "_id": ObjectId(incident_id),
        }

    return {
        "_id": incident_id,
    }


def delete_file_safely(filepath):
    try:
        if filepath and os.path.exists(filepath):
            os.remove(filepath)
    except Exception as error:
        print(f"Could not delete file: {error}")


def init_incident_routes(db):
    incident_bp = Blueprint(
        "incident_bp",
        __name__,
    )

    @incident_bp.route("/incidents/report", methods=["POST"])
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
                    "Only JPG, JPEG, PNG, and WEBP "
                    "images are allowed."
                ),
            }), 400

        incident_type = request.form.get("type", "Flood")

        if incident_type not in ALLOWED_INCIDENT_TYPES:
            return jsonify({
                "status": "error",
                "message": "Invalid incident type.",
            }), 400

        description = request.form.get(
            "description",
            "",
        ).strip()

        severity = request.form.get("severity", "Medium")

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

        if severity not in ["Low", "Medium", "High"]:
            return jsonify({
                "status": "error",
                "message": "Invalid severity level.",
            }), 400

        latitude = request.form.get("latitude")
        longitude = request.form.get("longitude")

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

        original_filename = secure_filename(file.filename)

        if not original_filename:
            return jsonify({
                "status": "error",
                "message": "Invalid image filename.",
            }), 400

        filename = f"{uuid.uuid4().hex}_{original_filename}"

        filepath = os.path.join(
            UPLOAD_FOLDER,
            filename,
        )

        try:
            file.save(filepath)

        except Exception as error:
            return jsonify({
                "status": "error",
                "message": "Could not save uploaded image.",
                "error": str(error),
            }), 500

        try:
            cv_result = verify_incident_image(filepath)

        except Exception as error:
            delete_file_safely(filepath)

            return jsonify({
                "status": "error",
                "message": (
                    "Computer Vision could not process "
                    "the incident image."
                ),
                "error": str(error),
            }), 500

        if cv_result.get("status") == "invalid_image":
            delete_file_safely(filepath)

            return jsonify({
                "status": "error",
                "message": cv_result.get(
                    "message",
                    "The uploaded file is not a valid image.",
                ),
            }), 400

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

        existing_incidents = db.incidents.find({
            "type": incident_type,
            "status": {
                "$in": ["PENDING", "VERIFIED"],
            },
        })

        for existing_incident in existing_incidents:
            coordinates = (
                existing_incident.get("location", {})
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
                    existing_incident.get("upcount", 1) + 1
                )

                community_confidence = (
                    get_community_confidence(new_upcount)
                )

                db.incidents.update_one(
                    {
                        "_id": existing_incident["_id"],
                    },
                    {
                        "$set": {
                            "upcount": new_upcount,
                            "community_confidence":
                                community_confidence,
                            "updated_at": datetime.utcnow(),
                        }
                    },
                )

                delete_file_safely(filepath)

                return jsonify({
                    "status": "success",
                    "message": (
                        "This incident was already reported "
                        "nearby. Your report was counted "
                        "as a confirmation."
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

        incident_doc = {
            "reporter_id": reporter_id,
            "type": incident_type,
            "severity": severity,
            "description": description,
            "image_url": f"uploads/{filename}",
            "original_filename": original_filename,
            "location_name": location_name,
            "location": {
                "type": "Point",
                "coordinates": [
                    longitude,
                    latitude,
                ],
            },
            "image_details": {
                "format": cv_result.get("image_format"),
                "width": cv_result.get("image_width"),
                "height": cv_result.get("image_height"),
            },
            "cv_verification": {
                "status": cv_result.get(
                    "status",
                    "pending_review",
                ),
                "confidence_score": cv_result.get(
                    "confidence_score",
                    0.0,
                ),
                "detected_labels": cv_result.get(
                    "detected_labels",
                    [],
                ),
                "detections": cv_result.get(
                    "detections",
                    [],
                ),
                "model": cv_result.get(
                    "model",
                    "Computer Vision Classifier",
                ),
                "message": cv_result.get("message", ""),
            },
            "weather_verification": weather_result,
            "overall_confidence": "Pending review",
            "status": incident_status,
            "upcount": 1,
            "community_confidence": "Low",
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }

        inserted_id = db.incidents.insert_one(
            incident_doc
        ).inserted_id

        return jsonify({
            "status": "success",
            "message": "Incident submitted successfully.",
            "incident_id": str(inserted_id),
            "location_name": location_name,
            "verification": {
                "cv": cv_result,
                "weather": weather_result,
                "overall_status": incident_status,
            },
        }), 201

    @incident_bp.route(
        "/incidents/verified",
        methods=["GET"],
    )
    def get_verified_incidents():
        incidents = list(db.incidents.find({
            "status": "VERIFIED",
        }))

        for incident in incidents:
            serialize_incident(incident)

        return jsonify({
            "status": "success",
            "data": incidents,
        }), 200

    @incident_bp.route(
        "/incidents/resolve/<incident_id>",
        methods=["POST"],
    )
    def resolve_incident(incident_id):
        try:
            if (
                "proof_image" not in request.files
                and "image" not in request.files
            ):
                return jsonify({
                    "status": "error",
                    "message": (
                        "Resolution proof image is required."
                    ),
                }), 400

            file = (
                request.files.get("proof_image")
                or request.files.get("image")
            )

            if not file or file.filename == "":
                return jsonify({
                    "status": "error",
                    "message": "No proof image was selected.",
                }), 400

            if not allowed_file(file.filename):
                return jsonify({
                    "status": "error",
                    "message": (
                        "Only JPG, JPEG, PNG, and WEBP "
                        "proof images are allowed."
                    ),
                }), 400

            query_filter = get_incident_query(incident_id)

            existing_incident = db.incidents.find_one(
                query_filter
            )

            if not existing_incident:
                return jsonify({
                    "status": "error",
                    "message": (
                        "Incident not found in database."
                    ),
                }), 404

            if existing_incident.get("status") == "RESOLVED":
                return jsonify({
                    "status": "error",
                    "message": (
                        "This incident is already resolved."
                    ),
                }), 400

            original_filename = secure_filename(file.filename)

            if not original_filename:
                return jsonify({
                    "status": "error",
                    "message": "Invalid proof image filename.",
                }), 400

            filename = (
                f"proof_{uuid.uuid4().hex}_"
                f"{original_filename}"
            )

            filepath = os.path.join(
                UPLOAD_FOLDER,
                filename,
            )

            file.save(filepath)

            incident_type = existing_incident.get(
                "type",
                "Other",
            )

            proof_result = verify_resolution_proof(
                filepath,
                incident_type,
            )

            if proof_result.get("status") == "invalid_image":
                delete_file_safely(filepath)

                return jsonify({
                    "status": "error",
                    "message": proof_result.get(
                        "message",
                        "The proof file is not a valid image.",
                    ),
                    "verification": proof_result,
                }), 400

            proof_document = {
                "proof_url": f"uploads/{filename}",
                "original_filename": original_filename,
                "submitted_at": datetime.utcnow(),
                "verification": proof_result,
            }

            db.incidents.update_one(
                query_filter,
                {
                    "$push": {
                        "resolution_proofs": proof_document,
                    },
                    "$set": {
                        "last_resolution_proof":
                            proof_document,
                        "updated_at": datetime.utcnow(),
                    },
                },
            )

            if proof_result.get("status") == "approved":
                db.incidents.update_one(
                    query_filter,
                    {
                        "$set": {
                            "status": "RESOLVED",
                            "resolved_at": datetime.utcnow(),
                            "resolution_method": (
                                "Automatic Computer Vision "
                                "proof verification"
                            ),
                            "resolution_cv_verification":
                                proof_result,
                            "last_proof_status": "APPROVED",
                            "updated_at": datetime.utcnow(),
                        }
                    },
                )

                return jsonify({
                    "status": "success",
                    "resolved": True,
                    "message": proof_result.get(
                        "message",
                        (
                            "Proof accepted. Incident "
                            "automatically resolved."
                        ),
                    ),
                    "proof_url": f"uploads/{filename}",
                    "verification": proof_result,
                }), 200

            if proof_result.get("status") == "rejected":
                db.incidents.update_one(
                    query_filter,
                    {
                        "$set": {
                            "status": existing_incident.get(
                                "status",
                                "VERIFIED",
                            ),
                            "last_proof_status": "REJECTED",
                            "last_proof_rejection_reason":
                                proof_result.get(
                                    "message",
                                    (
                                        "Proof rejected by "
                                        "computer vision."
                                    ),
                                ),
                            "updated_at": datetime.utcnow(),
                        }
                    },
                )

                return jsonify({
                    "status": "rejected",
                    "resolved": False,
                    "message": proof_result.get(
                        "message",
                        (
                            "Proof rejected. Incident "
                            "remains active."
                        ),
                    ),
                    "proof_url": f"uploads/{filename}",
                    "verification": proof_result,
                }), 422

            db.incidents.update_one(
                query_filter,
                {
                    "$set": {
                        "status": existing_incident.get(
                            "status",
                            "VERIFIED",
                        ),
                        "last_proof_status":
                            "NEEDS_NEW_PROOF",
                        "updated_at": datetime.utcnow(),
                    }
                },
            )

            return jsonify({
                "status": "needs_new_proof",
                "resolved": False,
                "message": proof_result.get(
                    "message",
                    (
                        "Proof was unclear. Upload a "
                        "clearer image."
                    ),
                ),
                "proof_url": f"uploads/{filename}",
                "verification": proof_result,
            }), 422

        except Exception as error:
            return jsonify({
                "status": "error",
                "message": str(error),
            }), 500

    @incident_bp.route(
        "/predict-shelters-risk",
        methods=["POST"],
    )
    def predict_shelter_risk():
        try:
            shelters = list(db.shelters.find({}))

            for shelter in shelters:
                shelter["_id"] = str(shelter["_id"])

                if (
                    "latitude" not in shelter
                    or shelter["latitude"] is None
                ):
                    coordinates = (
                        shelter.get("location", {})
                        .get("coordinates", [0.0, 0.0])
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
                "status": "success",
                "shelters": shelters,
            }), 200

        except Exception as error:
            return jsonify({
                "status": "error",
                "message": str(error),
            }), 500

    return incident_bp