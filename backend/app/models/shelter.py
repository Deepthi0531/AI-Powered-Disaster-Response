from datetime import datetime, timezone
import mongoengine as me


class Shelter(me.Document):
    meta = {
        "collection": "shelters",
        "strict": False,  # Prevents schema exceptions on legacy fields
        "indexes": [
            "created_at",
            [("location", "2dsphere")],  # Geospatial index for location queries
        ],
    }

    # Core details
    name = me.StringField(required=True, max_length=150)
    location_name = me.StringField(max_length=255, default="")

    # Geographic coordinates
    latitude = me.FloatField(required=False, default=0.0)
    longitude = me.FloatField(required=False, default=0.0)
    location = me.DictField()  # GeoJSON format: {"type": "Point", "coordinates": [lng, lat]}

    # Capacity management
    total_beds = me.IntField(default=0)
    available_beds = me.IntField(default=0)
    occupied_beds = me.IntField(default=0)
    total_capacity = me.IntField(default=0)

    # Metadata & status
    image_url = me.StringField(max_length=500)
    facilities = me.StringField(default="Water, Emergency Shelter, Power")
    status = me.StringField(default="Safe")
    risk_level = me.StringField(default="Low Risk")
    contact = me.StringField(default="")

    # Audit & ownership
    created_at = me.DateTimeField(default=lambda: datetime.now(timezone.utc))
    created_by_role = me.StringField(default="user")

    def clean(self):
        """Sanitize and keep capacity & location fields in sync before saving."""
        super().clean()

        # Synchronize total bed values across legacy/new attributes
        if not self.total_beds and self.total_capacity:
            self.total_beds = self.total_capacity
        elif not self.total_capacity and self.total_beds:
            self.total_capacity = self.total_beds

        # Clamp available beds to non-negative boundaries
        if self.available_beds < 0:
            self.available_beds = 0

    def to_dict(self):
        """Serialize MongoEngine model to JSON-compliant dictionary."""
        lat = self.latitude
        lng = self.longitude

        # Extract coordinates from GeoJSON location dictionary if flat lat/lng are unpopulated
        if (lat is None or lng is None or (lat == 0.0 and lng == 0.0)) and isinstance(self.location, dict):
            coords = self.location.get("coordinates", [])
            if len(coords) >= 2:
                lng, lat = coords[0], coords[1]

        # Ensure safe float conversions
        try:
            lat = float(lat) if lat is not None else 0.0
        except (ValueError, TypeError):
            lat = 0.0

        try:
            lng = float(lng) if lng is not None else 0.0
        except (ValueError, TypeError):
            lng = 0.0

        # Calculate bed metrics
        total = self.total_beds if self.total_beds else (self.total_capacity or 0)
        
        if self.available_beds is not None:
            available = max(0, self.available_beds)
        else:
            available = max(0, total - (self.occupied_beds or 0))

        # -------------------------------------------------------------
        # FIXED TIMESTAMP EXTRACTION & ISO UTC FORMATTING
        # -------------------------------------------------------------
        created_dt = self.created_at
        if not created_dt and self.id:
            try:
                # Extract creation time directly from MongoDB ObjectId
                created_dt = self.id.generation_time
            except AttributeError:
                created_dt = None

        formatted_created_at = None
        if created_dt:
            # Ensure ISO format string contains explicit UTC marker 'Z'
            iso_str = created_dt.isoformat()
            if not iso_str.endswith('Z') and '+' not in iso_str:
                iso_str += 'Z'
            formatted_created_at = iso_str
        # -------------------------------------------------------------

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
            "occupied_beds": self.occupied_beds or max(0, total - available),
            "image_url": self.image_url or "",
            "facilities": self.facilities,
            "status": self.status,
            "is_safe": self.status.lower() != "unsafe",
            "risk_level": self.risk_level,
            "contact": self.contact or "",
            "created_at": formatted_created_at,
            "created_by_role": self.created_by_role,
        }