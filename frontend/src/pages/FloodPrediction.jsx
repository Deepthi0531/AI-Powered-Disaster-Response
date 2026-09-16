import { useState } from 'react';
import API from '../api/axios';

export default function FloodPrediction() {
  const [formData, setFormData] = useState({
    latitude: '',
    longitude: '',
  });

  const [prediction, setPrediction] = useState(null);
  const [loading, setLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [geocodingLoading, setGeocodingLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

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
        setFormData({
          latitude: position.coords.latitude.toFixed(6),
          longitude: position.coords.longitude.toFixed(6),
        });

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
      // Forward Geocoding: If only location name is provided, convert to lat/lng on the frontend first
      if ((!lat || !lng) && formData.location_name.trim()) {
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

          const formattedLat = lat.toFixed(6);
          const formattedLng = lng.toFixed(6);

          // Automatically populate inputs and update map pin
          setFormData((prev) => ({
            ...prev,
            latitude: formattedLat,
            longitude: formattedLng,
          }));
          updateCoordinatesOnMap(lat, lng);
        } else {
          setErrorMessage(`Could not find coordinates for "${formData.location_name}".`);
          setLoading(false);
          return;
        }
      }

      if (!lat || !lng) {
        setErrorMessage('Please enter a location name or latitude and longitude.');
        setLoading(false);
        return;
      }

      // Send exact latitude and longitude payload to backend
      const response = await API.post('/predict-flood', {
        latitude: lat,
        longitude: lng,
        location_name: formData.location_name,
      });

      setPrediction(response.data);
      setTimeout(() => setShowResult(true), 50);
    } catch (error) {
      setErrorMessage(
        error.response?.data?.error || 'Failed to analyze risk. Ensure backend is running.'
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
        <div style={{ maxWidth: '450px' }}>
          <form
            onSubmit={handleSubmit}
            style={{ display: 'grid', gap: '1rem' }}
          >
            <div>
              <label>Latitude</label>
              <input
                type="number"
                step="any"
                name="latitude"
                value={formData.latitude}
                onChange={handleChange}
                placeholder="Enter latitude"
                required
              />
            </div>

            <div>
              <label>Longitude</label>
              <input
                type="number"
                step="any"
                name="longitude"
                value={formData.longitude}
                onChange={handleChange}
                placeholder="Enter longitude"
                required
              />
            </div>

            <button
              type="button"
              onClick={getCurrentLocation}
              disabled={locationLoading || loading}
            >
              {locationLoading
                ? 'Getting Location...'
                : 'Use Current Location'}
            </button>

            <button
              type="submit"
              className="primary-button"
              disabled={loading || locationLoading}
            >
              {loading ? 'Processing Model...' : 'Calculate Flood Risk'}
            </button>
          </form>

            {errorMessage && (
              <div className="animate-fade-in alert alert-error" style={{ marginTop: '1rem' }}>
                {errorMessage}
              </div>
            )}

            {/* Quick locations */}
            <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid rgba(148,163,184,0.1)' }}>
              <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
                QUICK LOCATIONS
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {[
                  { name: 'Kathmandu', lat: 27.7172, lng: 85.3240 },
                  { name: 'Pokhara', lat: 28.2096, lng: 83.9856 },
                  { name: 'Chitwan', lat: 27.5291, lng: 84.3542 },
                  { name: 'Biratnagar', lat: 26.4525, lng: 87.2718 },
                ].map((loc) => (
                  <button
                    key={loc.name}
                    type="button"
                    onClick={() => {
                      setFormData({ latitude: String(loc.lat), longitude: String(loc.lng) });
                      setPrediction(null);
                      setShowResult(false);
                    }}
                    style={{
                      padding: '5px 12px', borderRadius: '8px', fontSize: '0.78rem',
                      border: '1px solid rgba(148,163,184,0.15)',
                      background: 'rgba(255,255,255,0.03)', color: '#94a3b8',
                      cursor: 'pointer', transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.background = 'rgba(96,165,250,0.1)';
                      e.target.style.color = '#60a5fa';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.background = 'rgba(255,255,255,0.03)';
                      e.target.style.color = '#94a3b8';
                    }}
                  >
                    {loc.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Results Panel */}
        <section className="dashboard-section" ref={resultRef}>
          {loading && (
            <div className="glass-card animate-fade-in">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center', padding: '2rem 0' }}>
                <div className="skeleton" style={{ width: 80, height: 80, borderRadius: '50%' }} />
                <div className="skeleton" style={{ width: 200, height: 20 }} />
                <div className="skeleton" style={{ width: 150, height: 16 }} />
                <p style={{ color: '#64748b', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                  Running ML inference...
                </p>
              </div>
            </div>
          )}

          {prediction && (
            <div
              style={{
                marginTop: '1.5rem',
                padding: '1rem',
                border: '1px solid #2574e8',
              }}
            >
              <h2>Flood Risk: {prediction.risk_level}</h2>

              <p>
                <strong>Low Probability:</strong>{' '}
                {(prediction.low_probability * 100).toFixed(2)}%
              </p>

              <p>
                <strong>Medium Probability:</strong>{' '}
                {(prediction.medium_probability * 100).toFixed(2)}%
              </p>

              <p>
                <strong>High Probability:</strong>{' '}
                {(prediction.high_probability * 100).toFixed(2)}%
              </p>
            </div>
          )}

          {!loading && prediction && showResult && (
            <div className="glass-card animate-scale-in">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
                <div>
                  <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.35rem' }}>Risk Assessment</h2>
                  <p style={{ margin: 0, color: '#64748b', fontSize: '0.8rem' }}>
                    {prediction.latitude}, {prediction.longitude}
                  </p>
                </div>
                <RiskBadge risk={prediction.risk_level} />
              </div>

              <div style={{ marginBottom: '1.25rem' }}>
                <UncertaintyBadge probabilities={{
                  low: prediction.low_probability,
                  medium: prediction.medium_probability,
                  high: prediction.high_probability,
                }} />
              </div>

              <AnimatedProbability
                label="Low Risk"
                value={prediction.low_probability}
                color="#4ade80"
                delay={100}
              />
              <AnimatedProbability
                label="Medium Risk"
                value={prediction.medium_probability}
                color="#fbbf24"
                delay={200}
              />
              <AnimatedProbability
                label="High Risk"
                value={prediction.high_probability}
                color="#f87171"
                delay={300}
              />

              <div style={{
                marginTop: '1.25rem', padding: '0.75rem 1rem', borderRadius: '10px',
                background: 'rgba(148, 163, 184, 0.05)',
                border: '1px solid rgba(148, 163, 184, 0.08)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Prediction Mode</span>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#94a3b8' }}>
                  {prediction.mode || 'ML Model'}
                </span>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
