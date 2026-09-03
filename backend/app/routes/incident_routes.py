import os
import uuid
import math
from datetime import datetime

from flask import Blueprint, request, jsonify
from werkzeug.utils import secure_filename

from app.services.cv_service import verify_incident_image
from app.services.weather_service import verify_with_weather


UPLOAD_FOLDER = os.path.join(
    os.path.dirname(__file__),
    '..',
    '..',
    'uploads'
)

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}

# Two reports within this distance are considered the same incident.
INCIDENT_MATCH_RADIUS_METERS = 10

os.makedirs(UPLOAD_FOLDER, exist_ok=True)


def allowed_file(filename):
    return (
        "." in filename
        and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS
    )


def calculate_distance_meters(lat1, lon1, lat2, lon2):
    """
    Calculate the geographical distance between two coordinates
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


def init_incident_routes(db):
    incident_bp = Blueprint('incident_bp', __name__)

    @incident_bp.route('/incidents/report', methods=['POST'])
    def report_incident():
        if 'image' not in request.files:
            return jsonify({
                "status": "error",
                "message": "Please upload an incident image."
            }), 400

        file = request.files['image']

        if file.filename == '':
            return jsonify({
                "status": "error",
                "message": "Please select an image file."
            }), 400

        if not allowed_file(file.filename):
            return jsonify({
                "status": "error",
                "message": "Only JPG, JPEG, PNG, and WEBP images are allowed."
            }), 400

        incident_type = request.form.get('type', 'Flood')

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
                "message": "Invalid incident type."
            }), 400

        description = request.form.get('description', '').strip()
        severity = request.form.get('severity', 'Medium')
        reporter_id = request.form.get('reporter_id', 'anonymous')

        if len(description) > 500:
            return jsonify({
                "status": "error",
                "message": "Description must be 500 characters or fewer."
            }), 400

        if severity not in ["Low", "Medium", "High"]:
            return jsonify({
                "status": "error",
                "message": "Invalid severity level."
            }), 400

        latitude = request.form.get('latitude')
        longitude = request.form.get('longitude')

        if not latitude or not longitude:
            return jsonify({
                "status": "error",
                "message": "Current location is required."
            }), 400

        try:
            latitude = float(latitude)
            longitude = float(longitude)
        except ValueError:
            return jsonify({
                "status": "error",
                "message": "Invalid location coordinates."
            }), 400

        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            return jsonify({
                "status": "error",
                "message": "Location coordinates are outside the valid range."
            }), 400

        original_filename = secure_filename(file.filename)
        filename = f"{uuid.uuid4().hex}_{original_filename}"
        filepath = os.path.join(UPLOAD_FOLDER, filename)

        file.save(filepath)

        # Computer-vision incident-type prediction.
        cv_result = verify_incident_image(filepath)

        if cv_result.get("status") == "invalid_image":
            if os.path.exists(filepath):
                os.remove(filepath)

            return jsonify({
                "status": "error",
                "message": cv_result.get(
                    "message",
                    "The uploaded file is not a valid image."
                )
            }), 400

        # Weather data is supporting information only.
        weather_result = verify_with_weather(
            latitude,
            longitude,
            incident_type
        )

        # AI and weather results do not automatically approve a citizen report.
        incident_status = "PENDING"
        cv_result["status"] = "pending_review"

        # ---------------------------------------------------------
        # DUPLICATE INCIDENT DETECTION
        # ---------------------------------------------------------
        #
        # Check existing incidents of the same type that are not
        # rejected. If one is within 10 meters, treat this report
        # as another confirmation of the same incident.
        # ---------------------------------------------------------

        existing_incidents = db.incidents.find({
            "type": incident_type,
            "status": {"$in": ["PENDING", "VERIFIED"]}
        })

        matching_incident = None
        matching_distance = None

        for existing in existing_incidents:
            existing_coordinates = (
                existing.get("location", {}).get("coordinates", [])
            )

            if len(existing_coordinates) != 2:
                continue

            existing_longitude = existing_coordinates[0]
            existing_latitude = existing_coordinates[1]

            try:
                distance = calculate_distance_meters(
                    latitude,
                    longitude,
                    float(existing_latitude),
                    float(existing_longitude)
                )
            except (TypeError, ValueError):
                continue

            if distance <= INCIDENT_MATCH_RADIUS_METERS:
                matching_incident = existing
                matching_distance = distance
                break

        # ---------------------------------------------------------
        # EXISTING INCIDENT FOUND
        # ---------------------------------------------------------
        if matching_incident:
            current_upcount = matching_incident.get("upcount", 1)

            try:
                current_upcount = int(current_upcount)
            except (TypeError, ValueError):
                current_upcount = 1

            new_upcount = current_upcount + 1

            # Community confidence is based on the number of
            # citizen reports confirming the same incident.
            if new_upcount >= 4:
                community_confidence = "High"
            elif new_upcount >= 2:
                community_confidence = "Medium"
            else:
                community_confidence = "Low"

            update_data = {
                "$set": {
                    "upcount": new_upcount,
                    "community_confidence": community_confidence,
                    "updated_at": datetime.utcnow()
                }
            }

            db.incidents.update_one(
                {"_id": matching_incident["_id"]},
                update_data
            )

            # The uploaded image belongs to a duplicate report and
            # is not needed as a separate incident image.
            if os.path.exists(filepath):
                os.remove(filepath)

            return jsonify({
                "status": "success",
                "message": (
                    "Your report matched an existing incident. "
                    "The incident confirmation count has been increased."
                ),
                "incident_id": str(matching_incident["_id"]),
                "duplicate": True,
                "upcount": new_upcount,
                "community_confidence": community_confidence,
                "matching_distance_meters": round(matching_distance, 2),
                "verification": {
                    "cv": cv_result,
                    "weather": weather_result,
                    "overall_status": matching_incident.get(
                        "status",
                        "PENDING"
                    )
                }
            }), 200

        # ---------------------------------------------------------
        # NEW INCIDENT
        # ---------------------------------------------------------

        incident_doc = {
            "reporter_id": reporter_id,
            "type": incident_type,
            "severity": severity,
            "description": description,
            "image_url": f"uploads/{filename}",
            "original_filename": original_filename,
            "location": {
                "type": "Point",
                "coordinates": [longitude, latitude]
            },
            "image_details": {
                "format": cv_result.get("image_format"),
                "width": cv_result.get("image_width"),
                "height": cv_result.get("image_height")
            },
            "cv_verification": {
                "status": cv_result.get("status", "pending_review"),
                "confidence_score": cv_result.get(
                    "confidence_score",
                    0.0
                ),
                "detected_labels": cv_result.get(
                    "detected_labels",
                    []
                ),
                "detections": cv_result.get(
                    "detections",
                    []
                ),
                "model": cv_result.get(
                    "model",
                    "CLIP Zero-Shot Incident Classifier"
                ),
                "message": cv_result.get("message", "")
            },
            "weather_verification": weather_result,
            "overall_confidence": "Pending admin review",

            # New incident starts with one citizen report.
            "upcount": 1,

            # Community confidence starts at Low.
            "community_confidence": "Low",

            "status": incident_status,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }

        inserted_id = db.incidents.insert_one(incident_doc).inserted_id

        return jsonify({
            "status": "success",
            "message": (
                "Incident submitted successfully. "
                "AI prediction is saved and awaiting admin review."
            ),
            "incident_id": str(inserted_id),
            "duplicate": False,
            "upcount": 1,
            "community_confidence": "Low",
            "verification": {
                "cv": cv_result,
                "weather": weather_result,
                "overall_status": incident_status
            }
        }), 201

    @incident_bp.route('/incidents/verified', methods=['GET'])
    def get_verified_incidents():
        incidents = list(db.incidents.find({
            "status": "VERIFIED"
        }))

        for incident in incidents:
            incident['_id'] = str(incident['_id'])

        return jsonify({
            "status": "success",
            "data": incidents
        }), 200

    return incident_bp