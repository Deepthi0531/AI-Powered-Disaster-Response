"""Flask application factory."""

import os
from flask import Flask, send_from_directory
from flask_cors import CORS

from config.settings import get_config
from app.extensions import bcrypt, init_mongo, mongo, db

# Route imports
from app.routes.health import health_bp
from app.routes.auth import auth_bp
from app.routes.incident_routes import init_incident_routes
from app.routes.admin_routes import init_admin_routes
from app.routes.alert_routes import init_alert_routes
from app.routes.flood_routes import flood_bp
from app.routes.shelter_routes import shelter_bp


def create_app() -> Flask:
    """Create and configure the Flask application."""
    app = Flask(__name__)

    cfg = get_config()
    app.config.from_object(cfg)

    # Ensure upload directory exists
    os.makedirs(cfg.UPLOAD_FOLDER, exist_ok=True)

    # Serve static uploaded files for frontend/maps
    @app.route("/uploads/<path:filename>")
    def serve_upload(filename):
        return send_from_directory(cfg.UPLOAD_FOLDER, filename)

    # Initialise extensions
    CORS(
        app,
        resources={r"/api/*": {"origins": cfg.CORS_ORIGINS}},
        supports_credentials=True,
    )
    bcrypt.init_app(app)
    db.init_app(app)
    init_mongo(app)

    # Initialise collections, indexes, and database tables inside app context
    with app.app_context():
        db.create_all()

        # Register Incident, Admin & Alert Blueprints
        incident_bp = init_incident_routes(mongo.db)
        admin_bp = init_admin_routes(mongo.db)
        alert_bp = init_alert_routes(mongo.db)

    # Register standard blueprints under /api prefix
    app.register_blueprint(health_bp)
    app.register_blueprint(auth_bp, url_prefix="/api")
    app.register_blueprint(flood_bp, url_prefix="/api")
    app.register_blueprint(incident_bp, url_prefix="/api")
    app.register_blueprint(admin_bp, url_prefix="/api")
    app.register_blueprint(alert_bp, url_prefix="/api")
    app.register_blueprint(shelter_bp, url_prefix="/api")

    return app