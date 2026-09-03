import os
import uuid
import math
from datetime import datetime

from bson.objectid import ObjectId
from flask import Blueprint, jsonify, request
from werkzeug.utils import secure_filename

from app.services.cv_service import verify_incident_image
from app.services.weather_service import verify_with_weather


UPLOAD_FOLDER = os.path.join(
    os.path.dirname(__file__), "..", "..", "uploads"
)

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}

# Maximum distance for considering two citizen reports
# to be the same incident.
INCIDENT_MATCH_RADIUS_METERS = 10

os.makedirs(UPLOAD_FOLDER, exist_ok=True)


def allowed_file(filename):
    return (
        "." in filename
        and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS
    )


def calculate_distance_meters(lat1, lon1, lat2, lon2):
    """
    Calculate distance between two latitude/longitude points
    using the Haversine formula.
    """

    earth_radius = 6371000  # meters

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

    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return earth_radius * c


def get_community_confidence(upcount):
    """
    Community confidence based on number of citizen reports.
    """

    if upcount >= 4:
        return "High"
    elif upcount >= 2:
        return "Medium"
    else:
        return "Low"


def init_incident_routes(db):
    incident_bp = Blueprint("incident_bp", __name__)

    # -------------------------------------------------------------------------
    # INCIDENT REPORTING, RETRIEVAL & RESOLUTION
    # -------------------------------------------------------------------------

    @incident_bp.route("/incidents/report", methods=["POST"])
    def report_incident():
        if "image" not in request.files:
            return (
                jsonify({
                    "status": "error",
                    "message": "Please upload an incident image.",
                }),
                400,
            )

        file = request.files["image"]

        if file.filename == "":
            return (
                jsonify({
                    "status": "error",
                    "message": "Please select an image file.",
                }),
                400,
            )

        if not allowed_file(file.filename):
            return (
                jsonify({
                    "status": "error",
                    "message": (
                        "Only JPG, JPEG, PNG, and WEBP images are allowed."
                    ),
                }),
                400,
            )

        incident_type = request.form.get("type", "Flood")

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
            return (
                jsonify(
                    {"status": "error", "message": "Invalid incident type."}
                ),
                400,
            )

        description = request.form.get("description", "").strip()
        severity = request.form.get("severity", "Medium")
        reporter_id = request.form.get("reporter_id", "anonymous")

        if len(description) > 500:
            return (
                jsonify({
                    "status": "error",
                    "message": "Description must be 500 characters or fewer.",
                }),
                400,
            )

        if severity not in ["Low", "Medium", "High"]:
            return (
                jsonify(
                    {"status": "error", "message": "Invalid severity level."}
                ),
                400,
            )

        latitude = request.form.get("latitude")
        longitude = request.form.get("longitude")

        if not latitude or not longitude:
            return (
                jsonify({
                    "status": "error",
                    "message": "Current location is required.",
                }),
                400,
            )

        try:
            latitude = float(latitude)
            longitude = float(longitude)
        except ValueError:
            return (
                jsonify({
                    "status": "error",
                    "message": "Invalid location coordinates.",
                }),
                400,
            )

        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            return (
                jsonify({
                    "status": "error",
                    "message": (
                        "Location coordinates are outside the valid range."
                    ),
                }),
                400,
            )

        original_filename = secure_filename(file.filename)
        filename = f"{uuid.uuid4().hex}_{original_filename}"
        filepath = os.path.join(UPLOAD_FOLDER, filename)

        file.save(filepath)

        # Computer-vision incident-type prediction.
        cv_result = verify_incident_image(filepath)

        if cv_result.get("status") == "invalid_image":
            if os.path.exists(filepath):
                os.remove(filepath)

            return (
                jsonify({
                    "status": "error",
                    "message": cv_result.get(
                        "message", "The uploaded file is not a valid image."
                    ),
                }),
                400,
            )

        # Weather data is supporting information only.
        weather_result = verify_with_weather(
            latitude, longitude, incident_type
        )

        incident_status = "PENDING"
        cv_result["status"] = "pending_review"

        # ---------------------------------------------------------------------
        # CHECK FOR EXISTING INCIDENT
        # ---------------------------------------------------------------------
        #
        # If another citizen has already reported the same incident type
        # within 10 meters, increase the existing incident's upcount instead
        # of creating a duplicate incident.
        #
        # Rejected incidents are intentionally excluded.
        # ---------------------------------------------------------------------

        existing_incidents = db.incidents.find({
            "type": incident_type,
            "status": {
                "$in": ["PENDING", "VERIFIED"]
            }
        })

        for existing_incident in existing_incidents:
            existing_location = existing_incident.get("location", {})
            existing_coordinates = existing_location.get("coordinates", [])

            if len(existing_coordinates) != 2:
                continue

            # GeoJSON coordinates are stored as:
            # [longitude, latitude]
            existing_longitude = existing_coordinates[0]
            existing_latitude = existing_coordinates[1]

            distance = calculate_distance_meters(
                latitude,
                longitude,
                existing_latitude,
                existing_longitude
            )

            if distance <= INCIDENT_MATCH_RADIUS_METERS:

                current_upcount = existing_incident.get("upcount", 1)
                new_upcount = current_upcount + 1

                community_confidence = get_community_confidence(
                    new_upcount
                )

                updated_at = datetime.utcnow()

                db.incidents.update_one(
                    {"_id": existing_incident["_id"]},
                    {
                        "$set": {
                            "upcount": new_upcount,
                            "community_confidence": community_confidence,
                            "updated_at": updated_at,
                        }
                    }
                )

                # The uploaded image is a duplicate report, so it does not
                # need to remain on disk.
                if os.path.exists(filepath):
                    os.remove(filepath)

                return (
                    jsonify({
                        "status": "success",
                        "message": (
                            "This incident has already been reported nearby. "
                            "Your report has been counted as a confirmation."
                        ),
                        "incident_id": str(existing_incident["_id"]),
                        "duplicate": True,
                        "upcount": new_upcount,
                        "community_confidence": community_confidence,
                        "matching_distance_meters": round(distance, 2),
                        "verification": {
                            "cv": cv_result,
                            "weather": weather_result,
                            "overall_status": existing_incident.get(
                                "status", "PENDING"
                            ),
                        },
                    }),
                    200,
                )

        # ---------------------------------------------------------------------
        # CREATE NEW INCIDENT
        # ---------------------------------------------------------------------

        incident_doc = {
            "reporter_id": reporter_id,
            "type": incident_type,
            "severity": severity,
            "description": description,
            "image_url": f"uploads/{filename}",
            "original_filename": original_filename,
            "location": {
                "type": "Point",
                "coordinates": [longitude, latitude],
            },
            "image_details": {
                "format": cv_result.get("image_format"),
                "width": cv_result.get("image_width"),
                "height": cv_result.get("image_height"),
            },
            "cv_verification": {
                "status": cv_result.get("status", "pending_review"),
                "confidence_score": cv_result.get("confidence_score", 0.0),
                "detected_labels": cv_result.get("detected_labels", []),
                "detections": cv_result.get("detections", []),
                "model": cv_result.get(
                    "model", "CLIP Zero-Shot Incident Classifier"
                ),
                "message": cv_result.get("message", ""),
            },
            "weather_verification": weather_result,
            "overall_confidence": "Pending admin review",
            "status": incident_status,

            # Community confirmation fields
            "upcount": 1,
            "community_confidence": "Low",

            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }

        inserted_id = db.incidents.insert_one(incident_doc).inserted_id

        return (
            jsonify({
                "status": "success",
                "message": (
                    "Incident submitted successfully. "
                    "AI prediction is saved and awaiting admin review."
                ),
                "incident_id": str(inserted_id),
                "verification": {
                    "cv": cv_result,
                    "weather": weather_result,
                    "overall_status": incident_status,
                },
            }),
            201,
        )

    @incident_bp.route("/incidents/verified", methods=["GET"])
    def get_verified_incidents():
        incidents = list(db.incidents.find({"status": "VERIFIED"}))

        for incident in incidents:
            incident["_id"] = str(incident["_id"])

        return jsonify({"status": "success", "data": incidents}), 200

    @incident_bp.route("/incidents/resolve/<incident_id>", methods=["POST"])
    def resolve_incident(incident_id):
        try:
            if "proof_image" not in request.files and "image" not in request.files:
                return (
                    jsonify({
                        "status": "error",
                        "message": "Resolution proof image is required.",
                    }),
                    400,
                )

            file = request.files.get("proof_image") or request.files.get("image")

            if not file or file.filename == "":
                return (
                    jsonify({
                        "status": "error",
                        "message": "No file selected.",
                    }),
                    400,
                )

            if not allowed_file(file.filename):
                return (
                    jsonify({
                        "status": "error",
                        "message": "Only JPG, JPEG, PNG, and WEBP images are allowed.",
                    }),
                    400,
                )

            original_filename = secure_filename(file.filename)
            filename = f"proof_{uuid.uuid4().hex}_{original_filename}"
            filepath = os.path.join(UPLOAD_FOLDER, filename)
            file.save(filepath)

            query_filter = {}
            if ObjectId.is_valid(incident_id):
                query_filter = {"_id": ObjectId(incident_id)}
            else:
                query_filter = {"_id": incident_id}

            existing_incident = db.incidents.find_one(query_filter)
            if not existing_incident:
                return (
                    jsonify({
                        "status": "error",
                        "message": "Incident not found in database.",
                    }),
                    404,
                )

            db.incidents.delete_one(query_filter)

            return (
                jsonify({
                    "status": "success",
                    "message": "Incident resolved successfully with proof photo and deleted fromdatabase.",
                    "proof_url": f"uploads/{filename}",
                }),
                200,
            )

        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500

    # -------------------------------------------------------------------------
    # SHELTER RISK PREDICTION
    # -------------------------------------------------------------------------

    @incident_bp.route("/predict-shelters-risk", methods=["POST"])
    def predict_shelter_risk():
        try:
            payload = request.get_json() or {}
            shelters = list(db.shelters.find({}))
            
            for shelter in shelters:
                shelter["_id"] = str(shelter["_id"])
                
                # Extract coordinates safely if missing at root level
                if "latitude" not in shelter or shelter["latitude"] is None:
                    coords = shelter.get("location", {}).get("coordinates", [0.0, 0.0])
                    shelter["latitude"] = float(coords[1]) if len(coords) >= 2 else 0.0
                    shelter["longitude"] = float(coords[0]) if len(coords) >= 2 else 0.0

                if "risk_level" not in shelter:
                    shelter["risk_level"] = "Low"

            return jsonify({"status": "success", "shelters": shelters}), 200
        except Exception as e:
            return jsonify({"status": "error", "message": str(e)}), 500

    return incident_bp