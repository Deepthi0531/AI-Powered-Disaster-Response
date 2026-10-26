from datetime import datetime


def archive_and_delete(mongo_db, incident, proof_url, how, cv=None):
    """Copy the incident to `resolved_incidents` (audit trail), then delete it from `incidents`."""
    doc = dict(incident)
    doc["original_id"] = str(doc.pop("_id"))
    doc.update({
        "resolved_at": datetime.utcnow(),
        "resolved_by": how,  # "cv" or "admin"
        "resolution_proof_url": proof_url,
        "resolution_cv": cv,
    })
    mongo_db.resolved_incidents.insert_one(doc)
    mongo_db.incidents.delete_one({"_id": incident["_id"]})