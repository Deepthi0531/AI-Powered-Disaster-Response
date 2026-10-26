from datetime import datetime
from bson.errors import InvalidId
from bson.objectid import ObjectId
from flask import Blueprint, jsonify, request

from app.models.shelter import Shelter
from app.services.resolution import archive_and_delete

admin_bp = Blueprint("admin", __name__)


def _oid(value):
    """Safe ObjectId conversion; returns None for an invalid id."""
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        return None


def init_admin_routes(mongo_db):

    # 1. Admin Login
    @admin_bp.route("/admin/login", methods=["POST"])
    def admin_login():
        data = request.get_json() or {}
        username = data.get("username")
        password = data.get("password")

        # Basic auth check (replace with JWT or hashed DB check as needed)
        if username == "admin" and password == "admin123":
            return (
                jsonify(
                    {
                        "status": "success",
                        "token": "admin-session-token-123",
                        "role": "admin",
                    }
                ),
                200,
            )

        return (
            jsonify(
                {"status": "error", "message": "Invalid admin credentials"}
            ),
            401,
        )

    # 2. Live Dashboard Stats
    @admin_bp.route("/admin/stats", methods=["GET"])
    def get_dashboard_stats():
        total_incidents = mongo_db.incidents.count_documents({})
        pending_incidents = mongo_db.incidents.count_documents(
            {"status": "PENDING"}
        )
        verified_incidents = mongo_db.incidents.count_documents(
            {"status": "VERIFIED"}
        )

        # NEW: resolution proofs waiting for the admin
        pending_resolutions = mongo_db.resolution_requests.count_documents(
            {"status": "PENDING_REVIEW"}
        )

        # Count shelters using MongoEngine
        total_shelters = Shelter.objects.count()

        return (
            jsonify(
                {
                    "total_incidents": total_incidents,
                    "pending_incidents": pending_incidents,
                    "verified_incidents": verified_incidents,
                    "pending_resolutions": pending_resolutions,
                    "needs_review": pending_incidents + pending_resolutions,
                    "total_shelters": total_shelters,
                }
            ),
            200,
        )

    # 3. Incident Management (PyMongo)
    @admin_bp.route("/admin/incidents", methods=["GET"])
    def get_all_incidents():
        status_filter = request.args.get("status")
        query = {}

        if status_filter:
            query["status"] = status_filter

        # CHANGED: newest first
        incidents = list(
            mongo_db.incidents.find(query).sort("created_at", -1)
        )

        for item in incidents:
            item["_id"] = str(item["_id"])

        return jsonify(incidents), 200

    @admin_bp.route(
        "/admin/incidents/<incident_id>/verify", methods=["PATCH"]
    )
    def verify_incident(incident_id):
        data = request.get_json() or {}
        new_status = data.get("status")

        if new_status not in ["VERIFIED", "REJECTED", "PENDING"]:
            return jsonify({"message": "Invalid status"}), 400

        # CHANGED: an invalid id now returns 400 instead of crashing (500)
        oid = _oid(incident_id)

        if oid is None:
            return jsonify({"message": "Invalid incident id"}), 400

        result = mongo_db.incidents.update_one(
            {"_id": oid},
            {
                "$set": {
                    "status": new_status,
                    "updated_at": datetime.utcnow(),
                }
            },
        )

        if result.matched_count == 0:
            return jsonify({"message": "Incident not found"}), 404

        return jsonify({"message": f"Incident updated to {new_status}"}), 200

    # NEW 3b. Resolution proofs the computer vision was not sure about
    @admin_bp.route("/admin/resolution-requests", methods=["GET"])
    def get_resolution_requests():
        status = request.args.get("status", "PENDING_REVIEW")

        items = list(
            mongo_db.resolution_requests.find({"status": status}).sort(
                "created_at", -1
            )
        )

        for item in items:
            item["_id"] = str(item["_id"])

        return jsonify(items), 200

    @admin_bp.route(
        "/admin/resolution-requests/<request_id>", methods=["PATCH"]
    )
    def decide_resolution_request(request_id):
        data = request.get_json() or {}
        action = data.get("action")

        if action not in ("approve", "reject"):
            return (
                jsonify({"message": "action must be 'approve' or 'reject'"}),
                400,
            )

        rid = _oid(request_id)

        if rid is None:
            return jsonify({"message": "Invalid request id"}), 400

        resolution_request = mongo_db.resolution_requests.find_one(
            {"_id": rid}
        )

        if not resolution_request:
            return jsonify({"message": "Request not found"}), 404

        incident = mongo_db.incidents.find_one(
            {"_id": _oid(resolution_request["incident_id"])}
        )

        if action == "approve":
            # archive in `resolved_incidents`, then delete from `incidents`
            if incident:
                archive_and_delete(
                    mongo_db,
                    incident,
                    resolution_request.get("proof_url"),
                    "admin",
                    resolution_request.get("cv"),
                )

            new_status = "APPROVED"

        else:
            # let the user upload another proof
            if incident:
                mongo_db.incidents.update_one(
                    {"_id": incident["_id"]},
                    {"$unset": {"resolution_pending": ""}},
                )

            new_status = "REJECTED"

        mongo_db.resolution_requests.update_one(
            {"_id": rid},
            {
                "$set": {
                    "status": new_status,
                    "decided_at": datetime.utcnow(),
                }
            },
        )

        return (
            jsonify(
                {"message": f"Resolution request {new_status.lower()}"}
            ),
            200,
        )

    # 4. Shelter Management (MongoEngine)

    @admin_bp.route("/admin/shelters", methods=["GET"])
    def get_shelters():
        try:
            shelters = Shelter.objects()

            result = [
                {
                    "id": str(s.id),
                    "name": s.name,
                    "lat": s.latitude,
                    "lng": s.longitude,
                    "latitude": s.latitude,
                    "longitude": s.longitude,
                    "capacity": s.total_beds,
                    "total_beds": s.total_beds,
                    "available_beds": s.available_beds,
                    "occupied_beds": getattr(s, "occupied_beds", 0),
                    "contact": getattr(s, "contact", ""),
                    "image_url": s.image_url,
                    "facilities": s.facilities,
                    "status": s.status,
                    "risk_level": s.risk_level,
                }
                for s in shelters
            ]

            return jsonify(result), 200

        except Exception as e:
            return jsonify({"message": str(e)}), 500

    @admin_bp.route("/admin/shelters", methods=["POST"])
    def add_shelter():
        try:
            data = request.get_json() or {}

            name = data.get("name")
            lat = data.get("lat") or data.get("latitude")
            lng = data.get("lng") or data.get("longitude")

            if not name or lat is None or lng is None:
                return (
                    jsonify(
                        {
                            "message": (
                                "Name, latitude, and longitude are required"
                            )
                        }
                    ),
                    400,
                )

            latitude = float(lat)
            longitude = float(lng)

            total_beds = int(
                data.get("total_beds")
                or data.get("capacity")
                or data.get("total_capacity")
                or 100
            )

            available_beds = int(
                data.get("available_beds", total_beds)
            )

            new_shelter = Shelter(
                name=name.strip(),
                location_name=data.get(
                    "location_name",
                    data.get("address", "")
                ),
                latitude=latitude,
                longitude=longitude,
                location={
                    "type": "Point",
                    "coordinates": [longitude, latitude],
                },
                total_beds=total_beds,
                available_beds=available_beds,
                occupied_beds=int(data.get("occupied_beds", 0)),
                contact=data.get("contact", ""),
                facilities=data.get(
                    "facilities",
                    "Water, Emergency Shelter, Power"
                ),
                image_url=data.get("image_url"),
                created_by_role="admin",
            )

            new_shelter.save()

            return (
                jsonify(
                    {
                        "message": "Shelter added",
                        "id": str(new_shelter.id),
                        "data": new_shelter.to_dict(),
                    }
                ),
                201,
            )

        except (ValueError, TypeError) as e:
            return jsonify({"message": f"Invalid shelter data: {str(e)}"}), 400

        except Exception as e:
            return jsonify({"message": str(e)}), 500

    @admin_bp.route("/admin/shelters/<shelter_id>", methods=["DELETE"])
    def delete_shelter(shelter_id):
        try:
            shelter = Shelter.objects.get(id=shelter_id)

            shelter.delete()

            return jsonify({"message": "Shelter deleted"}), 200

        except Shelter.DoesNotExist:
            return jsonify({"message": "Shelter not found"}), 404

        except Exception as e:
            return jsonify({"message": str(e)}), 500

    # 5. Emergency Alerts Broadcasting (PyMongo)
    @admin_bp.route("/admin/alerts/broadcast", methods=["POST"])
    def broadcast_alert():
        data = request.get_json() or {}

        alert = {
            "region": data.get("region"),
            "severity": data.get(
                "severity", "HIGH"
            ),
            "message": data.get("message"),
            "timestamp": datetime.utcnow(),
        }

        res = mongo_db.alerts.insert_one(alert)

        return (
            jsonify(
                {
                    "message": "Emergency alert broadcasted successfully",
                    "alert_id": str(res.inserted_id),
                }
            ),
            201,
        )

    return admin_bp