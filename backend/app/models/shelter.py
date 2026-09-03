from datetime import datetime
import mongoengine as me


class Shelter(me.Document):
    meta = {"collection": "shelters"}

    name = me.StringField(required=True, max_length=150)
    location_name = me.StringField(max_length=255)
    latitude = me.FloatField(required=True)
    longitude = me.FloatField(required=True)
    total_beds = me.IntField(default=0)
    available_beds = me.IntField(default=0)
    image_url = me.StringField(max_length=255)
    facilities = me.StringField(default="Water, Emergency Shelter, Power")
    status = me.StringField(default="Safe")
    risk_level = me.StringField(default="Low Risk")
    created_at = me.DateTimeField(default=datetime.utcnow)
    created_by_role = me.StringField(default="user")

    def to_dict(self):
        return {
            "id": str(self.id),
            "_id": str(self.id),
            "name": self.name,
            "location_name": self.location_name,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "lat": self.latitude,
            "lng": self.longitude,
            "total_beds": self.total_beds,
            "available_beds": self.available_beds,
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