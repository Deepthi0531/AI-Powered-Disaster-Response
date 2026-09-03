import os
import pickle
from flask import Flask, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
from flask_pymongo import PyMongo

from app.extensions import bcrypt
from app.routes.auth import auth_bp
from app.routes.admin_routes import admin_bp
from app.routes.incident_routes import init_incident_routes
from app.routes.flood_routes import flood_bp
from app.routes.shelter_routes import shelter_bp

load_dotenv()

app = Flask(__name__)
app.url_map.strict_slashes = False
CORS(app, supports_credentials=True)

bcrypt.init_app(app)

app.config['MONGO_URI'] = os.getenv("MONGO_URI", "mongodb://localhost:27017/disaster_guard")
mongo = PyMongo(app)
db = mongo.db

# Store db instance on app.config or attach it so flood_bp can access it cleanly
app.config['DB'] = db

# --- ML MODEL INTEGRATION ---
MODELS_DIR = os.path.join(os.path.dirname(__file__), 'models')
MODEL_PATH = os.path.join(MODELS_DIR, 'flood_risk_xgb_model.pkl')
PREPROCESSOR_PATH = os.path.join(MODELS_DIR, 'flood_risk_preprocessor.pkl')

ml_model = None
preprocessor = None

try:
    if os.path.exists(MODEL_PATH):
        with open(MODEL_PATH, 'rb') as f:
            ml_model = pickle.load(f)
        print("XGBoost model loaded successfully.")
    else:
        print(f"Warning: Model file not found at {MODEL_PATH}")
except Exception as e:
    print(f"Error loading ML model: {e}")

try:
    if os.path.exists(PREPROCESSOR_PATH):
        with open(PREPROCESSOR_PATH, 'rb') as f:
            preprocessor = pickle.load(f)
        print("Preprocessor loaded successfully.")
    else:
        print(f"Warning: Preprocessor file not found at {PREPROCESSOR_PATH}")
except Exception as e:
    print(f"Warning: Preprocessor failed to load ({e}). System will fall back to raw input array.")
    preprocessor = None
# ----------------------------

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'uploads')
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

@app.route('/uploads/<path:filename>')
def serve_uploads(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# Initialize Blueprints
incident_bp = init_incident_routes(db)

# Register Blueprints
app.register_blueprint(auth_bp, url_prefix='/api')
app.register_blueprint(admin_bp, url_prefix='/api')
app.register_blueprint(incident_bp, url_prefix='/api')
app.register_blueprint(flood_bp, url_prefix='/api')
from app.routes.shelter_routes import shelter_bp

if __name__ == "__main__":
    app.run(debug=True, port=5000, use_reloader=False)