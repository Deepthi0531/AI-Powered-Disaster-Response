# 🚨 AI Disaster Response & Emergency Alert Platform

An interactive, AI-powered real-time emergency alert and hazard mapping platform. This application empowers citizens to report local disasters (such as floods, landslides, and fallen trees), dynamically visualizes severe alerts within a localized radius using interactive maps, and provides seamless verification and resolution workflows.

---

## 🌟 Key Features

* **Interactive Emergency Map:** Leverages Leaflet maps to plot real-time incidents and display interactive radius-based location filters (e.g., 15 km filter).
* **Custom Animated Map Pins:** Custom CSS-based pulsing map markers ensure reliable location pin rendering across modern UI frameworks.
* **Reverse Geocoding:** Automatically translates raw latitude/longitude coordinates into clean, human-readable city, suburb, and area names via OpenStreetMap's Nominatim API.
* **Live GPS Location:** Automatically centers the map on the user's current GPS location upon initial page load.
* **Citizen Proof Verification & Resolution:** Allows users or authorities to resolve active hazards directly by uploading a proof image, automatically updating the backend database.
* **Dynamic Media Serving:** Integrates image uploads for reports with server-side static asset serving.
* **Severity Color-Coding:** Incidents are categorized and visually flagged by severity level (High, Medium, Info).

---

## 🛠️ Tech Stack

### **Frontend**
* **Framework:** React.js (Vite)
* **Mapping:** Leaflet & React-Leaflet
* **HTTP Client:** Axios
* **Styling:** CSS3 / Custom Styled Components

### **Backend**
* **Framework:** Python (Flask / FastAPI)
* **Database:** MongoDB / PostgreSQL (Geospatial querying support)
* **Reverse Geocoding:** OpenStreetMap Nominatim API

---

## 🚀 Getting Started

### Prerequisites
Make sure you have the following installed on your system:
* [Node.js](https://nodejs.org/) (v16+)
* [Python](https://www.python.org/) (v3.10+)
* [Git](https://git-scm.com/)

---

### 📥 Installation & Setup

#### 1. Clone the Repository
```bash
git clone [https://github.com/your-username/AI-Disaster-Response.git](https://github.com/your-username/AI-Disaster-Response.git)
cd AI-Disaster-Response

2. Backend Setup
# Navigate to backend directory
cd backend

# Create a virtual environment
python -m venv venv

# Activate virtual environment
# On Windows (Command Prompt):
venv\Scripts\activate
# On Windows (PowerShell):
.\venv\Scripts\Activate.ps1
# On macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run the backend server
python run.py

3. Frontend Setup
# Navigate to frontend directory (from project root)
cd frontend

# Install Node dependencies
npm install

# Start development server
npm run dev

📂 Project Structure
AI-Disaster-Response/
├── backend/
│   ├── app/
│   │   ├── models/          # Database models (User, Incident, Shelter)
│   │   ├── routes/          # API Endpoint routes (incidents, auth, alerts)
│   │   ├── services/        # Business logic & ML integration
│   │   └── utils/           # Database helpers & auth middleware
│   ├── uploads/             # Server storage for incident & resolution images
│   └── run.py               # Application entry point
├── frontend/
│   ├── src/
│   │   ├── api/             # Axios API base configuration
│   │   ├── components/      # Reusable UI components
│   │   └── pages/           # Application views (Alerts, AdminDashboard, etc.)
│   └── package.json
├── .gitignore
└── README.md