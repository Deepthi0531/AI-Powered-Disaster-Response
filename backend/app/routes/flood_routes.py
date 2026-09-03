import math
import os
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests
from flask import Blueprint, jsonify, request
from werkzeug.utils import secure_filename

from predict import predict_flood_risk
from app.models import Shelter  # Imported MongoEngine model

flood_bp = Blueprint("flood", __name__)

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_PATH = BASE_DIR / "data" / "flood_test_data.csv"
UPLOAD_FOLDER = BASE_DIR / "uploads"

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

if DATA_PATH.exists():
    df = pd.read_csv(DATA_PATH)
else:
    df = pd.DataFrame()


def allowed_file(filename):
    return (
        "." in filename
        and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS
    )


def calculate_haversine_distance(lat1, lon1, lat2, lon2):
    """Calculates the exact great-circle distance between two points in km."""
    R = 6371.0  # Earth radius in kilometers

    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)

    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return round(R * c, 2)


def find_nearest_location(latitude, longitude):
    if df.empty:
        raise ValueError("Flood dataset not loaded.")

    distances = (df["latitude"] - latitude) ** 2 + (
        df["longitude"] - longitude
    ) ** 2
    nearest_index = distances.idxmin()
    return df.loc[nearest_index]


def fetch_live_rainfall_mm_hr(lat, lon):
    try:
        url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&hourly=precipitation&current_weather=true"
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            hourly_precip = data.get("hourly", {}).get("precipitation", [])
            if hourly_precip:
                return float(hourly_precip[0])
    except Exception as e:
        print(f"Live weather API error: {e}")
    return None


def get_area_name(lat, lon):
    try:
        url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=json"
        headers = {"User-Agent": "AIDisasterResponsePlatform/1.0"}
        res = requests.get(url, headers=headers, timeout=5)
        if res.status_code == 200:
            address = res.json().get("address", {})
            return (
                address.get("village")
                or address.get("town")
                or address.get("city")
                or address.get("county")
                or "Local Zone"
            )
    except Exception as e:
        print(f"Reverse geocode failed: {e}")
    return "Regional"


def fetch_nearby_institutions(lat, lon, radius_m=15000):
    """Fetches schools, hospitals, and community centers via Overpass API with fallbacks."""
    endpoints = [
        "https://overpass-api.de/api/interpreter",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    ]

    overpass_query = f"""
    [out:json][timeout:8];
    (
      node["amenity"="school"](around:{radius_m},{lat},{lon});
      node["amenity"="hospital"](around:{radius_m},{lat},{lon});
      node["amenity"="community_centre"](around:{radius_m},{lat},{lon});
      way["amenity"="school"](around:{radius_m},{lat},{lon});
      way["amenity"="hospital"](around:{radius_m},{lat},{lon});
    );
    out center 25;
    """

    headers = {
        "User-Agent": "AIDisasterResponsePlatform/1.0",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    }

    shelters = []
    for url in endpoints:
        try:
            response = requests.post(
                url, data={"data": overpass_query}, headers=headers, timeout=6
            )
            if response.status_code == 200:
                data = response.json()
                for elem in data.get("elements", []):
                    shelter_lat = elem.get("lat") or elem.get("center", {}).get(
                        "lat"
                    )
                    shelter_lon = elem.get("lon") or elem.get("center", {}).get(
                        "lon"
                    )
                    tags = elem.get("tags", {})
                    name = tags.get("name") or tags.get("name:en")

                    if shelter_lat and shelter_lon and name:
                        shelters.append({
                            "id": str(elem.get("id")),
                            "name": name,
                            "lat": float(shelter_lat),
                            "lon": float(shelter_lon),
                            "type": tags.get("amenity", "school")
                            .replace("_", " ")
                            .capitalize(),
                            "is_admin": False,
                        })
                if shelters:
                    return shelters
        except Exception:
            continue

    area_label = get_area_name(lat, lon)
    return [
        {
            "id": "shelter_dyn_1",
            "name": f"{area_label} Central Emergency Refuge",
            "lat": lat + 0.015,
            "lon": lon + 0.012,
            "type": "Relief Center",
            "is_admin": False,
        },
        {
            "id": "shelter_dyn_2",
            "name": f"{area_label} Community High School Shelter",
            "lat": lat - 0.022,
            "lon": lon - 0.018,
            "type": "School Shelter",
            "is_admin": False,
        },
        {
            "id": "shelter_dyn_3",
            "name": f"{area_label} North District Relief Hall",
            "lat": lat + 0.031,
            "lon": lon - 0.025,
            "type": "Community Refuge",
            "is_admin": False,
        },
        {
            "id": "shelter_dyn_4",
            "name": f"{area_label} Red Cross Evacuation Hub",
            "lat": lat - 0.018,
            "lon": lon + 0.029,
            "type": "Evacuation Hub",
            "is_admin": False,
        },
        {
            "id": "shelter_dyn_5",
            "name": f"{area_label} Stadium Disaster Refuge",
            "lat": lat + 0.038,
            "lon": lon + 0.032,
            "type": "Sports Complex",
            "is_admin": False,
        },
        {
            "id": "shelter_dyn_6",
            "name": f"{area_label} Medical Center Safe Haven",
            "lat": lat - 0.033,
            "lon": lon - 0.035,
            "type": "Hospital",
            "is_admin": False,
        },
    ]


@flood_bp.route("/predict-flood", methods=["POST"])
def predict_flood():
    try:
        data = request.get_json(silent=True) or {}

        latitude = float(data["latitude"])
        longitude = float(data["longitude"])

        sample = find_nearest_location(latitude, longitude)
        live_rainfall = fetch_live_rainfall_mm_hr(latitude, longitude)

        rainfall_intensity = (
            live_rainfall
            if live_rainfall is not None
            else float(
                data.get(
                    "historical_rainfall_intensity_mm_hr",
                    sample["historical_rainfall_intensity_mm_hr"],
                )
            )
        )

        result = predict_flood_risk(
            latitude=latitude,
            longitude=longitude,
            elevation_m=float(data.get("elevation_m", sample["elevation_m"])),
            land_use=sample["land_use"],
            soil_group=sample["soil_group"],
            drainage_density_km_per_km2=float(
                sample["drainage_density_km_per_km2"]
            ),
            storm_drain_proximity_m=float(sample["storm_drain_proximity_m"])
            if pd.notna(sample["storm_drain_proximity_m"])
            else None,
            storm_drain_type=sample["storm_drain_type"],
            historical_rainfall_intensity_mm_hr=rainfall_intensity,
        )

        return (
            jsonify({
                "status": "success",
                "risk_level": result["risk"],
                "low_probability": result["low_probability"],
                "medium_probability": result["medium_probability"],
                "high_probability": result["high_probability"],
                "live_rainfall_mm_hr": live_rainfall,
                "input_location": {
                    "latitude": latitude,
                    "longitude": longitude,
                },
            }),
            200,
        )

    except Exception as e:
        return jsonify({"error": str(e)}), 400


@flood_bp.route("/predict-shelters-risk", methods=["POST"])
def predict_shelters_risk():
    try:
        data = request.get_json(silent=True) or {}
        lat = float(data.get("lat") or data.get("latitude"))
        lng = float(data.get("lng") or data.get("longitude"))

        # 1. Fetch live rainfall rate
        live_rainfall = fetch_live_rainfall_mm_hr(lat, lng)

        # 2. Extract Admin Shelters using MongoEngine
        admin_shelters_raw = []
        try:
            db_shelters = Shelter.objects()
            for s in db_shelters:
                s_dict = s.to_dict()
                s_lat = float(s_dict.get("latitude", 0.0))
                s_lng = float(s_dict.get("longitude", 0.0))

                dist = calculate_haversine_distance(lat, lng, s_lat, s_lng)
                total_cap = s_dict.get("total_beds", "N/A")
                avail_beds = s_dict.get("available_beds", 0)
                occ = max(0, total_cap - avail_beds) if isinstance(total_cap, int) else 0

                admin_shelters_raw.append({
                    "id": f"admin_{s_dict.get('id')}",
                    "name": f"⭐ {s_dict.get('name', 'Shelter')} (Official)",
                    "lat": s_lat,
                    "lon": s_lng,
                    "type": "Admin Registered Shelter",
                    "capacity": f"{total_cap} beds ({occ} occupied)",
                    "distance_km": dist,
                    "is_admin": True,
                })
        except Exception as db_err:
            print(f"MongoEngine query error when fetching shelters: {db_err}")

        # 3. Fetch Overpass dynamic public shelters
        public_shelters_raw = fetch_nearby_institutions(
            lat, lng, radius_m=15000
        )

        # Combine datasets
        all_candidate_shelters = admin_shelters_raw + public_shelters_raw

        # 4. Run ML Risk Evaluation
        admin_evaluated = []
        public_evaluated = []
        seen_ids = set()

        for shelter in all_candidate_shelters:
            try:
                shelter_id = shelter.get("id")
                if shelter_id in seen_ids:
                    continue
                seen_ids.add(shelter_id)

                s_lat = shelter["lat"]
                s_lon = shelter["lon"]

                distance_km = shelter.get(
                    "distance_km",
                    calculate_haversine_distance(lat, lng, s_lat, s_lon),
                )

                sample = find_nearest_location(s_lat, s_lon)
                rainfall_intensity = (
                    live_rainfall
                    if live_rainfall is not None
                    else float(sample["historical_rainfall_intensity_mm_hr"])
                )

                ml_res = predict_flood_risk(
                    latitude=s_lat,
                    longitude=s_lon,
                    elevation_m=float(sample["elevation_m"])
                    if pd.notna(sample["elevation_m"])
                    else None,
                    land_use=sample["land_use"],
                    soil_group=sample["soil_group"],
                    drainage_density_km_per_km2=float(
                        sample["drainage_density_km_per_km2"]
                    ),
                    storm_drain_proximity_m=float(
                        sample["storm_drain_proximity_m"]
                    )
                    if pd.notna(sample["storm_drain_proximity_m"])
                    else None,
                    storm_drain_type=sample["storm_drain_type"],
                    historical_rainfall_intensity_mm_hr=rainfall_intensity,
                )

                item = {
                    "id": shelter["id"],
                    "name": shelter["name"],
                    "lat": s_lat,
                    "lon": s_lon,
                    "type": shelter.get("type", "Relief Shelter"),
                    "capacity": shelter.get("capacity", "N/A"),
                    "distance_km": distance_km,
                    "risk_level": ml_res["risk"],
                    "high_probability": ml_res["high_probability"],
                    "is_safe": ml_res["risk"].lower() != "high",
                    "is_admin": shelter.get("is_admin", False),
                }

                if shelter.get("is_admin"):
                    admin_evaluated.append(item)
                else:
                    public_evaluated.append(item)

            except Exception as inner_e:
                print(f"Shelter evaluation error: {inner_e}")
                continue

        # Sort each list by distance independently
        admin_evaluated.sort(key=lambda x: x["distance_km"])
        public_evaluated.sort(key=lambda x: x["distance_km"])

        # Prioritize admin shelters, filling remainder with public options up to 15
        final_shelters = admin_evaluated + public_evaluated[
            : max(0, 15 - len(admin_evaluated))
        ]

        return (
            jsonify({
                "status": "success",
                "count": len(final_shelters),
                "data": final_shelters,
            }),
            200,
        )

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@flood_bp.route("/shelters/report", methods=["POST"])
def report_shelter():
    try:
        # Extract data cleanly whether passed as Form Data or JSON Payload
        if request.form:
            data = request.form.to_dict()
        else:
            data = request.get_json(silent=True) or {}

        name = data.get("name") or data.get("shelter_name") or data.get("title")
        if not name:
            return jsonify({
                "status": "error",
                "message": "Shelter name is required."
            }), 400

        address = data.get("address") or data.get("location_name", "")
        facilities = data.get("facilities", "Water, Emergency Shelter, Power")

        # Safe Parsing Helpers
        def safe_int(val, default):
            try:
                return int(val) if val is not None and str(val).strip() != "" else default
            except (ValueError, TypeError):
                return default

        def safe_float(val, default):
            try:
                return float(val) if val is not None and str(val).strip() != "" else default
            except (ValueError, TypeError):
                return default

        total_beds = safe_int(data.get("total_beds") or data.get("totalBeds"), 100)
        available_beds = safe_int(data.get("available_beds") or data.get("availableBeds"), total_beds)

        lat = safe_float(data.get("latitude") or data.get("lat"), 0.0)
        lng = safe_float(data.get("longitude") or data.get("lng") or data.get("lon"), 0.0)

        image_url = None
        if "image" in request.files:
            file = request.files["image"]
            if file and file.filename != "" and allowed_file(file.filename):
                original_filename = secure_filename(file.filename)
                filename = f"shelter_{uuid.uuid4().hex}_{original_filename}"
                filepath = os.path.join(UPLOAD_FOLDER, filename)
                file.save(filepath)
                image_url = f"uploads/{filename}"

        # Instantiate MongoEngine document
        shelter_doc = Shelter(
            name=name.strip(),
            location_name=address.strip(),
            latitude=lat,
            longitude=lng,
            total_beds=total_beds,
            available_beds=available_beds,
            facilities=facilities.strip(),
            image_url=image_url,
            created_by_role="user"
        )

        # Save via MongoEngine
        shelter_doc.save()

        return jsonify({
            "status": "success",
            "message": "Shelter submitted successfully.",
            "data": shelter_doc.to_dict()
        }), 201

    except Exception as e:
        print("\n================ EXCEPTION IN /shelters/report ================")
        traceback.print_exc()
        print("=================================================================\n")
        return jsonify({"status": "error", "message": str(e)}), 500