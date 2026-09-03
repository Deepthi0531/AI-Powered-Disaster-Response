"""Flask extension instances (initialised in the app factory)."""
import threading
from flask_bcrypt import Bcrypt
from flask_sqlalchemy import SQLAlchemy
from mongoengine import connect
from pymongo import MongoClient

bcrypt = Bcrypt()
db = SQLAlchemy()  # SQL database instance

# Module-level client + db for PyMongo, initialised once per process
_client = None
_db = None
_lock = threading.Lock()


class MongoDB:
    def __init__(self):
        self.db = None


mongo = MongoDB()


def init_mongo(app):
    """Initialise PyMongo and MongoEngine connections from app config."""
    global _client, _db
    with _lock:
        if _client is None:
            mongo_uri = app.config["MONGO_URI"]
            db_name = app.config.get("MONGO_DB_NAME", "disaster_response")

            # Initialize PyMongo
            _client = MongoClient(mongo_uri)
            _db = _client[db_name]
            mongo.db = _db

            # Initialize MongoEngine connection
            connect(host=mongo_uri, db=db_name, alias="default")

            # Test connection
            try:
                _client.admin.command("ping")
                print(" Connected successfully to MongoDB Atlas Cloud!")
            except Exception as e:
                print(" Failed to connect to MongoDB Atlas:", e)


def get_db():
    if _db is None:
        raise RuntimeError(
            "MongoDB not initialised. Call init_mongo(app) first."
        )
    return _db