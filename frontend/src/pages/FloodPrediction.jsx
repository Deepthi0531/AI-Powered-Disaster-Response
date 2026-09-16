import { useState, useEffect, useRef } from 'react';
import API from '../api/axios';

function AnimatedProbability({ label, value, color, delay }) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setWidth((value || 0) * 100), 100 + delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return (
    <div style={{ marginBottom: '0.75rem', animationDelay: `${delay}ms` }} className="animate-fade-in-up">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{label}</span>
        <span style={{ fontSize: '0.85rem', fontWeight: 700, color }}>
          {((value || 0) * 100).toFixed(1)}%
        </span>
      </div>
      <div className="probability-bar" style={{ height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
        <div
          className="probability-bar-fill"
          style={{ width: `${width}%`, height: '100%', background: color, transition: 'width 0.8s ease-out' }}
        />
      </div>
    </div>
  );
}

function RiskBadge({ risk }) {
  const level = risk?.toLowerCase() || 'low';
  const colors = {
    high: '#ef4444',
    medium: '#f59e0b',
    low: '#10b981',
  };
  const activeColor = colors[level] || '#10b981';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 12px',
        borderRadius: '999px',
        fontSize: '0.8rem',
        fontWeight: 700,
        backgroundColor: `${activeColor}20`,
        color: activeColor,
        border: `1px solid ${activeColor}40`,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: activeColor }} />
      {risk || 'Low'} Risk
    </span>
  );
}

export default function FloodPrediction() {
  const [formData, setFormData] = useState({
    latitude: '',
    longitude: '',
    location_name: '',
  });

  const [prediction, setPrediction] = useState(null);
  const [loading, setLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [geocodingLoading, setGeocodingLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showResult, setShowResult] = useState(false);
  const resultRef = useRef(null);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const getCurrentLocation = () => {
    setErrorMessage('');
    setPrediction(null);
    setShowResult(false);
    setLocationLoading(true);

    if (!navigator.geolocation) {
      setErrorMessage('Geolocation is not supported by this browser.');
      setLocationLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setFormData((prev) => ({
          ...prev,
          latitude: position.coords.latitude.toFixed(6),
          longitude: position.coords.longitude.toFixed(6),
        }));
        setLocationLoading(false);
      },
      () => {
        setErrorMessage('Unable to get location access.');
        setLocationLoading(false);
      },
      { enableHighAccuracy: true }
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage('');
    setPrediction(null);
    setShowResult(false);

    let lat = formData.latitude ? Number(formData.latitude) : null;
    let lng = formData.longitude ? Number(formData.longitude) : null;

    try {
      if ((!lat || !lng) && formData.location_name && formData.location_name.trim()) {
        setGeocodingLoading(true);
        const geoResponse = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
            formData.location_name
          )}&format=json&limit=1`
        );
        const geoData = await geoResponse.json();
        setGeocodingLoading(false);

        if (geoData && geoData.length > 0) {
          lat = parseFloat(geoData[0].lat);
          lng = parseFloat(geoData[0].lon);

          setFormData((prev) => ({
            ...prev,
            latitude: lat.toFixed(6),
            longitude: lng.toFixed(6),
          }));
        } else {
          setErrorMessage(`Could not find coordinates for "${formData.location_name}".`);
          setLoading(false);
          return;
        }
      }

      if (lat === null || lng === null || isNaN(lat) || isNaN(lng)) {
        setErrorMessage('Please enter a valid location name or latitude and longitude.');
        setLoading(false);
        return;
      }

      const response = await API.post('/predict-flood', {
        latitude: lat,
        longitude: lng,
        location_name: formData.location_name || '',
      });

      setPrediction(response.data?.data || response.data);
      setShowResult(true);
    } catch (error) {
      setErrorMessage(
        error.response?.data?.error ||
          error.response?.data?.message ||
          'Failed to analyze risk. Ensure backend is running.'
      );
    } finally {
      setGeocodingLoading(false);
      setLoading(false);
    }
  };

  return (
    <div className="dashboard-page">
      <section className="dashboard-intro">
        <div>
          <p className="eyebrow">ML RISK ASSESSMENT</p>
          <h1>Flood Risk Prediction</h1>
        </div>
      </section>

      <section className="dashboard-section">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2rem', alignItems: 'start' }}>
          <div style={{ maxWidth: '450px', width: '100%' }}>
            <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#94a3b8' }}>
                  Location Name (Optional)
                </label>
                <input
                  type="text"
                  name="location_name"
                  value={formData.location_name}
                  onChange={handleChange}
                  placeholder="e.g. Mysuru or search area"
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    backgroundColor: '#0f172a',
                    color: '#ffffff',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#94a3b8' }}>
                  Latitude
                </label>
                <input
                  type="number"
                  step="any"
                  name="latitude"
                  value={formData.latitude}
                  onChange={handleChange}
                  placeholder="Enter latitude"
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    backgroundColor: '#0f172a',
                    color: '#ffffff',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#94a3b8' }}>
                  Longitude
                </label>
                <input
                  type="number"
                  step="any"
                  name="longitude"
                  value={formData.longitude}
                  onChange={handleChange}
                  placeholder="Enter longitude"
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    backgroundColor: '#0f172a',
                    color: '#ffffff',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={getCurrentLocation}
                  disabled={locationLoading || loading || geocodingLoading}
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: '8px',
                    backgroundColor: '#1e293b',
                    color: '#ffffff',
                    border: '1px solid #334155',
                    cursor: 'pointer',
                  }}
                >
                  {locationLoading ? 'Getting Location...' : 'Use Current Location'}
                </button>

                <button
                  type="submit"
                  className="primary-button"
                  disabled={loading || locationLoading || geocodingLoading}
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: '8px',
                    backgroundColor: '#2563eb',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {loading || geocodingLoading ? 'Processing Model...' : 'Calculate Flood Risk'}
                </button>
              </div>
            </form>

            {errorMessage && (
              <div className="animate-fade-in alert alert-error" style={{ marginTop: '1rem', color: '#ef4444', fontSize: '0.9rem' }}>
                {errorMessage}
              </div>
            )}

            <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid rgba(148,163,184,0.1)' }}>
              <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
                QUICK LOCATIONS
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {[
                  { name: 'Kathmandu', lat: 27.7172, lng: 85.324 },
                  { name: 'Pokhara', lat: 28.2096, lng: 83.9856 },
                  { name: 'Chitwan', lat: 27.5291, lng: 84.3542 },
                  { name: 'Biratnagar', lat: 26.4525, lng: 87.2718 },
                ].map((loc) => (
                  <button
                    key={loc.name}
                    type="button"
                    onClick={() => {
                      setFormData({ latitude: String(loc.lat), longitude: String(loc.lng), location_name: loc.name });
                      setPrediction(null);
                      setShowResult(false);
                    }}
                    style={{
                      padding: '5px 12px',
                      borderRadius: '8px',
                      fontSize: '0.78rem',
                      border: '1px solid rgba(148,163,184,0.15)',
                      background: 'rgba(255,255,255,0.03)',
                      color: '#94a3b8',
                      cursor: 'pointer',
                    }}
                  >
                    {loc.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div ref={resultRef}>
            {loading && (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                Running ML inference...
              </div>
            )}

            {!loading && prediction && showResult && (
              <div
                style={{
                  backgroundColor: '#0f172a',
                  border: '1px solid rgba(148, 163, 184, 0.2)',
                  borderRadius: '16px',
                  padding: '1.5rem',
                  maxWidth: '450px',
                  width: '100%',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
                  <div>
                    <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.25rem', color: '#ffffff' }}>Risk Assessment</h2>
                    <p style={{ margin: 0, color: '#64748b', fontSize: '0.8rem' }}>
                      {prediction.latitude ?? formData.latitude}, {prediction.longitude ?? formData.longitude}
                    </p>
                  </div>
                  <RiskBadge risk={prediction.risk_level} />
                </div>

                <AnimatedProbability
                  label="Low Risk"
                  value={prediction.low_probability}
                  color="#10b981"
                  delay={100}
                />
                <AnimatedProbability
                  label="Medium Risk"
                  value={prediction.medium_probability}
                  color="#f59e0b"
                  delay={200}
                />
                <AnimatedProbability
                  label="High Risk"
                  value={prediction.high_probability}
                  color="#ef4444"
                  delay={300}
                />

                <div
                  style={{
                    marginTop: '1.25rem',
                    padding: '0.75rem 1rem',
                    borderRadius: '10px',
                    background: 'rgba(148, 163, 184, 0.05)',
                    border: '1px solid rgba(148, 163, 184, 0.08)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Prediction Mode</span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#94a3b8' }}>
                    {prediction.mode || 'ML Model'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}