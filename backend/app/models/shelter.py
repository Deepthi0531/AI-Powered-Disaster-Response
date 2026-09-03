from datetime import datetime
import mongoengine as me


class Shelter(me.Document):
    meta = {
        "collection": "shelters",
        "strict": False,  # Prevents schema exceptions on legacy fields
    }

    name = me.StringField(required=True, max_length=150)
    location_name = me.StringField(max_length=255)

    # Make coordinates optional so MongoEngine won't crash on existing null records
    latitude = me.FloatField(required=False, default=0.0)
    longitude = me.FloatField(required=False, default=0.0)

    total_beds = me.IntField(default=0)
    available_beds = me.IntField(default=0)
    image_url = me.StringField(max_length=255)
    facilities = me.StringField(default="Water, Emergency Shelter, Power")
    status = me.StringField(default="Safe")
    risk_level = me.StringField(default="Low Risk")
    created_at = me.DateTimeField(default=datetime.utcnow)
    created_by_role = me.StringField(default="user")

    # Dynamic fields for schema compatibility
    location = me.DictField()
    contact = me.StringField()
    occupied_beds = me.IntField(default=0)
    total_capacity = me.IntField(default=0)

    def to_dict(self):
        # Fallback to location coordinates if root latitude/longitude are missing or None
        lat = self.latitude
        lng = self.longitude

        if (lat is None or lng is None) and self.location and isinstance(self.location, dict):
            coords = self.location.get("coordinates", [])
            if len(coords) >= 2:
                lng = coords[0]
                lat = coords[1]

        # Convert to float safely with fallback to 0.0
        try:
            lat = float(lat) if lat is not None else 0.0
        except (ValueError, TypeError):
            lat = 0.0

        try:
            lng = float(lng) if lng is not None else 0.0
        except (ValueError, TypeError):
            lng = 0.0

        total = self.total_beds if self.total_beds else (self.total_capacity or 0)
        available = (
            self.available_beds
            if self.available_beds is not None
            else max(0, total - (self.occupied_beds or 0))
        )

        return {
            "id": str(self.id),
            "_id": str(self.id),
            "name": self.name,
            "location_name": self.location_name or "",
            "latitude": lat,
            "longitude": lng,
            "lat": lat,
            "lng": lng,
            "total_beds": total,
            "available_beds": available,
            "image_url": self.image_url,
            "facilities": self.facilities,
            "status": self.status,
            "risk_level": self.risk_level,
            "created_at": (
                self.created_at.strftime("%Y-%m-%d %H:%M")
                if self.created_at
                else None
            ),
            "created_by_role": self.created_by_role,
        }