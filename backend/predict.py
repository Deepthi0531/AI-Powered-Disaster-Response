import os
import logging
import joblib
import pandas as pd
import math

# Set up logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --------------------------------------------------
# Safe ML Component Loader (Includes LabelEncoder)
# --------------------------------------------------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

MODEL_PATH = os.path.join(BASE_DIR, "models", "flood_risk_xgb_model.pkl")
PREPROCESSOR_PATH = os.path.join(BASE_DIR, "models", "flood_risk_preprocessor.pkl")
LABEL_ENCODER_PATH = os.path.join(BASE_DIR, "models", "flood_risk_label_encoder.pkl")
THRESHOLD_PATH = os.path.join(BASE_DIR, "models", "high_risk_threshold.pkl")

model = None
preprocessor = None
label_encoder = None
HIGH_THRESHOLD = 0.5
MODEL_LOADED = False

try:
    if (
        os.path.exists(MODEL_PATH)
        and os.path.exists(PREPROCESSOR_PATH)
        and os.path.exists(LABEL_ENCODER_PATH)
    ):
        model = joblib.load(MODEL_PATH)
        preprocessor = joblib.load(PREPROCESSOR_PATH)
        label_encoder = joblib.load(LABEL_ENCODER_PATH)

        if os.path.exists(THRESHOLD_PATH):
            HIGH_THRESHOLD = joblib.load(THRESHOLD_PATH)

        MODEL_LOADED = True
        logger.info(
            f"Flood risk ML model, preprocessor, and label encoder loaded successfully. "
            f"Target classes: {list(label_encoder.classes_)}"
        )
    else:
        logger.warning(
            "ML model components missing in models/. Using rule-based fallback mode."
        )
except Exception as e:
    logger.warning(f"ML components failed to load: {e}")
    logger.info("Activating rule-based fallback mechanism.")
    MODEL_LOADED = False


# --------------------------------------------------
# Nepal Geographic Boundary
# --------------------------------------------------

# Approximate outer boundary of Nepal.
# Used only for the demonstration-region override.
NEPAL_BOUNDARY = [
    (26.35, 80.05),
    (27.00, 80.10),
    (28.00, 80.25),
    (29.00, 80.60),
    (30.00, 81.00),
    (30.90, 82.00),
    (30.45, 83.00),
    (30.00, 84.00),
    (29.50, 85.00),
    (29.00, 86.00),
    (28.50, 87.00),
    (28.00, 88.00),
    (27.50, 88.20),
    (27.00, 88.15),
    (26.50, 87.50),
    (26.35, 86.50),
    (26.35, 85.50),
    (26.35, 84.50),
    (26.35, 83.50),
    (26.35, 82.50),
    (26.35, 81.50),
    (26.35, 80.50),
]


def _point_inside_polygon(latitude, longitude, polygon):
    """
    Check whether a geographic point lies inside a polygon.
    Uses the ray-casting algorithm.
    """

    x = float(longitude)
    y = float(latitude)

    inside = False

    j = len(polygon) - 1

    for i in range(len(polygon)):
        yi = polygon[i][0]
        xi = polygon[i][1]

        yj = polygon[j][0]
        xj = polygon[j][1]

        if ((yi > y) != (yj > y)):
            intersection_x = (
                (xj - xi) * (y - yi) / ((yj - yi) + 1e-12)
            ) + xi

            if x < intersection_x:
                inside = not inside

        j = i

    return inside


def _is_inside_nepal(latitude, longitude):
    """Return True when coordinates fall inside the Nepal demo boundary."""

    try:
        return _point_inside_polygon(
            float(latitude),
            float(longitude),
            NEPAL_BOUNDARY
        )
    except (TypeError, ValueError):
        return False


# --------------------------------------------------
# Nepal Demo Region Profiles
# --------------------------------------------------

NEPAL_DEMO_REGIONS = [
    {
        "name": "Kathmandu",
        "latitude": 27.7172,
        "longitude": 85.3240,
        "radius_km": 45,
        "risk": "Medium",
        "low": 0.22,
        "medium": 0.58,
        "high": 0.20,
    },
    {
        "name": "Pokhara",
        "latitude": 28.2096,
        "longitude": 83.9856,
        "radius_km": 45,
        "risk": "High",
        "low": 0.08,
        "medium": 0.16,
        "high": 0.76,
    },
    {
        "name": "Chitwan",
        "latitude": 27.5291,
        "longitude": 84.3542,
        "radius_km": 40,
        "risk": "High",
        "low": 0.06,
        "medium": 0.10,
        "high": 0.84,
    },
    {
        "name": "Biratnagar",
        "latitude": 26.4525,
        "longitude": 87.2718,
        "radius_km": 45,
        "risk": "High",
        "low": 0.04,
        "medium": 0.08,
        "high": 0.88,
    },
    {
        "name": "Birgunj",
        "latitude": 27.0104,
        "longitude": 84.8770,
        "radius_km": 40,
        "risk": "Medium",
        "low": 0.18,
        "medium": 0.64,
        "high": 0.18,
    },
    {
        "name": "Janakpur",
        "latitude": 26.7271,
        "longitude": 85.9407,
        "radius_km": 40,
        "risk": "High",
        "low": 0.05,
        "medium": 0.14,
        "high": 0.81,
    },
    {
        "name": "Butwal",
        "latitude": 27.7006,
        "longitude": 83.4484,
        "radius_km": 40,
        "risk": "Medium",
        "low": 0.20,
        "medium": 0.61,
        "high": 0.19,
    },
    {
        "name": "Nepalgunj",
        "latitude": 28.0500,
        "longitude": 81.6167,
        "radius_km": 45,
        "risk": "High",
        "low": 0.07,
        "medium": 0.14,
        "high": 0.79,
    },
    {
        "name": "Dharan",
        "latitude": 26.8124,
        "longitude": 87.2830,
        "radius_km": 40,
        "risk": "Medium",
        "low": 0.25,
        "medium": 0.55,
        "high": 0.20,
    },
    {
        "name": "Dhangadhi",
        "latitude": 28.6833,
        "longitude": 80.6000,
        "radius_km": 45,
        "risk": "High",
        "low": 0.05,
        "medium": 0.09,
        "high": 0.86,
    },
]


def _haversine_distance_km(lat1, lon1, lat2, lon2):
    """Calculate distance between two geographic coordinates in kilometres."""

    R = 6371.0

    lat1 = math.radians(float(lat1))
    lon1 = math.radians(float(lon1))
    lat2 = math.radians(float(lat2))
    lon2 = math.radians(float(lon2))

    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1)
        * math.cos(lat2)
        * math.sin(dlon / 2) ** 2
    )

    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return R * c


def _get_nepal_demo_risk(latitude, longitude):
    """
    Return a city/region-specific demo risk profile.

    If the point is inside Nepal but not close to one of the
    predefined regions, use the nearest Nepal regional profile.
    """

    if not _is_inside_nepal(latitude, longitude):
        return None

    nearest_region = None
    nearest_distance = float("inf")

    for region in NEPAL_DEMO_REGIONS:
        distance = _haversine_distance_km(
            latitude,
            longitude,
            region["latitude"],
            region["longitude"]
        )

        if distance < nearest_distance:
            nearest_distance = distance
            nearest_region = region

    if nearest_region is None:
        return None

    # Use the nearest predefined regional profile.
    return {
        "risk": nearest_region["risk"],
        "low_probability": nearest_region["low"],
        "medium_probability": nearest_region["medium"],
        "high_probability": nearest_region["high"],
        "mode": "Nepal_Demo_Regional_Override",
        "region": nearest_region["name"],
        "distance_from_region_km": round(nearest_distance, 2),
    }


# --------------------------------------------------
# Comprehensive Multi-Factor Heuristic Fallback Engine
# --------------------------------------------------

def _evaluate_heuristic_flood_risk(
    elevation_m,
    land_use,
    soil_group,
    drainage_density_km_per_km2,
    storm_drain_proximity_m,
    historical_rainfall_intensity_mm_hr
):
    score = 0.0

    # 1. Historical Rainfall Intensity
    rainfall = float(historical_rainfall_intensity_mm_hr or 0)

    if rainfall >= 75:
        score += 0.35
    elif rainfall >= 45:
        score += 0.25
    elif rainfall >= 25:
        score += 0.15
    elif rainfall >= 10:
        score += 0.05

    # 2. Elevation / Topography
    elevation = float(elevation_m or 100)

    if elevation <= 10:
        score += 0.25
    elif elevation <= 25:
        score += 0.18
    elif elevation <= 50:
        score += 0.10
    elif elevation <= 100:
        score += 0.03

    # 3. Land Use / Surface Runoff Potential
    land_use_str = str(land_use).lower() if land_use else ""

    if any(
        k in land_use_str
        for k in [
            "urban",
            "built-up",
            "built_up",
            "commercial",
            "industrial",
            "paved"
        ]
    ):
        score += 0.15
    elif any(
        k in land_use_str
        for k in ["residential", "suburban"]
    ):
        score += 0.10
    elif any(
        k in land_use_str
        for k in ["agriculture", "farmland"]
    ):
        score += 0.05

    # 4. Soil Hydrologic Group & Infiltration
    soil_str = str(soil_group).upper() if soil_group else ""

    if "D" in soil_str or "CLAY" in soil_str:
        score += 0.10
    elif "C" in soil_str or "SILT" in soil_str:
        score += 0.07
    elif "B" in soil_str or "LOAM" in soil_str:
        score += 0.03

    # 5. Drainage Density
    drainage_density = float(
        drainage_density_km_per_km2 or 0
    )

    if drainage_density < 0.5:
        score += 0.08
    elif drainage_density < 1.5:
        score += 0.04

    # 6. Storm Drain Proximity
    proximity = float(storm_drain_proximity_m or 500)

    if proximity > 300:
        score += 0.07
    elif proximity > 100:
        score += 0.03

    if score >= 0.55:
        risk = "High"

        high_p = round(
            min(0.95, 0.65 + (score - 0.55)),
            4
        )

        med_p = round(
            (1.0 - high_p) * 0.7,
            4
        )

        low_p = round(
            1.0 - high_p - med_p,
            4
        )

    elif score >= 0.30:
        risk = "Medium"

        med_p = round(
            min(0.85, 0.55 + (score - 0.30)),
            4
        )

        high_p = round(
            (1.0 - med_p) * 0.5,
            4
        )

        low_p = round(
            1.0 - med_p - high_p,
            4
        )

    else:
        risk = "Low"

        low_p = round(
            max(0.60, 0.90 - score),
            4
        )

        med_p = round(
            (1.0 - low_p) * 0.7,
            4
        )

        high_p = round(
            1.0 - low_p - med_p,
            4
        )

    return {
        "risk": risk,
        "low_probability": low_p,
        "medium_probability": med_p,
        "high_probability": high_p,
        "mode": "Enhanced_Rule_Based_Fallback",
        "heuristic_score": round(score, 4)
    }


# --------------------------------------------------
# Unified Prediction Function
# --------------------------------------------------

def predict_flood_risk(
    latitude,
    longitude,
    elevation_m,
    land_use,
    soil_group,
    drainage_density_km_per_km2,
    storm_drain_proximity_m,
    storm_drain_type,
    historical_rainfall_intensity_mm_hr
):
    """
    Predict flood risk for a geographical location.

    Nepal locations use a demonstration regional override.
    Other locations use the existing XGBoost ML model
    and heuristic fallback.
    """

    # --------------------------------------------------
    # Nepal Demonstration Override
    # --------------------------------------------------

    nepal_result = _get_nepal_demo_risk(
        latitude,
        longitude
    )

    if nepal_result is not None:
        logger.info(
            f"Nepal regional demo override applied: "
            f"{nepal_result['region']} -> {nepal_result['risk']}"
        )

        return nepal_result

    # --------------------------------------------------
    # Existing XGBoost ML Prediction
    # --------------------------------------------------

    if MODEL_LOADED:
        try:
            input_df = pd.DataFrame([{
                "latitude": latitude,
                "longitude": longitude,
                "elevation_m": elevation_m,
                "land_use": land_use,
                "soil_group": soil_group,
                "drainage_density_km_per_km2":
                    drainage_density_km_per_km2,
                "storm_drain_proximity_m":
                    storm_drain_proximity_m,
                "storm_drain_type": storm_drain_type,
                "historical_rainfall_intensity_mm_hr":
                    historical_rainfall_intensity_mm_hr
            }])

            # Feature Engineering
            input_df["runoff_index"] = (
                input_df["historical_rainfall_intensity_mm_hr"]
                / (input_df["elevation_m"] + 1.0)
            )

            input_df["drainage_inefficiency"] = (
                input_df["storm_drain_proximity_m"]
                / (
                    input_df["drainage_density_km_per_km2"]
                    + 0.1
                )
            )

            processed_data = preprocessor.transform(
                input_df
            )

            raw_pred = model.predict(
                processed_data
            )[0]

            probabilities = model.predict_proba(
                processed_data
            )[0]

            # Decode numeric prediction
            risk_label = label_encoder.inverse_transform(
                [raw_pred]
            )[0]

            # Map probabilities
            prob_dict = {
                str(cls): round(float(prob), 4)
                for cls, prob in zip(
                    label_encoder.classes_,
                    probabilities
                )
            }

            low_prob = prob_dict.get("Low", 0.0)
            med_prob = prob_dict.get("Medium", 0.0)
            high_prob = prob_dict.get("High", 0.0)

            # High risk threshold override
            if high_prob >= HIGH_THRESHOLD:
                risk_label = "High"

            return {
                "risk": risk_label,
                "low_probability": low_prob,
                "medium_probability": med_prob,
                "high_probability": high_prob,
                "mode": "ML_XGBoost"
            }

        except Exception as e:
            logger.error(
                f"Error during ML inference, "
                f"defaulting to enhanced fallback: {e}"
            )

    # --------------------------------------------------
    # Existing Heuristic Fallback
    # --------------------------------------------------

    return _evaluate_heuristic_flood_risk(
        elevation_m=elevation_m,
        land_use=land_use,
        soil_group=soil_group,
        drainage_density_km_per_km2=
            drainage_density_km_per_km2,
        storm_drain_proximity_m=
            storm_drain_proximity_m,
        historical_rainfall_intensity_mm_hr=
            historical_rainfall_intensity_mm_hr
    )