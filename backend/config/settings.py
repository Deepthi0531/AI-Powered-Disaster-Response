"""Application configuration loaded from environment variables."""
import os


class Config:
    SECRET_KEY: str = os.getenv("SECRET_KEY", "dev-secret-key")
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "dev-jwt-secret")
    JWT_EXPIRY_HOURS: int = int(os.getenv("JWT_EXPIRY_HOURS", 24))

    MONGO_URI: str = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
    MONGO_DB_NAME: str = os.getenv("MONGO_DB_NAME", "disaster_response")

    # SQLAlchemy database URI
    SQLALCHEMY_DATABASE_URI: str = os.getenv(
        "DATABASE_URL",
        f"sqlite:///{os.path.join(os.path.dirname(os.path.dirname(__file__)), 'app.db')}",
    )
    SQLALCHEMY_TRACK_MODIFICATIONS: bool = False

    CORS_ORIGINS: list = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")

    # Upload folder for incident images
    UPLOAD_FOLDER: str = os.path.join(
        os.path.dirname(os.path.dirname(__file__)), "uploads"
    )
    MAX_CONTENT_LENGTH: int = 16 * 1024 * 1024  # 16 MB


class DevelopmentConfig(Config):
    FLASK_DEBUG: bool = True


class ProductionConfig(Config):
    FLASK_DEBUG: bool = False


_config_map = {
    "development": DevelopmentConfig,
    "production": ProductionConfig,
}


def get_config() -> Config:
    env = os.getenv("FLASK_ENV", "development")
    return _config_map.get(env, DevelopmentConfig)()