import { useState, useEffect, useRef } from 'react';
import API from '../api/axios';

function AnimatedProbability({ label, value, color, delay }) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setWidth(value * 100), 100 + delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return (
    <div style={{ marginBottom: '0.75rem', animationDelay: `${delay}ms` }} className="animate-fade-in-up">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{label}</span>
        <span style={{ fontSize: '0.85rem', fontWeight: 700, color }}>{(value * 100).toFixed(1)}%</span>
      </div>
      <div className="probability-bar">
        <div
          className="probability-bar-fill"
          style={{ width: `${width}%`, background: color }}
        />
      </div>
    </div>
  );
}

function RiskBadge({ risk }) {
  const level = risk?.toLowerCase() || 'low';
  return (
    <span className={`risk-indicator ${level}`}>
      <span className={`risk-dot ${level}`} />
      {risk} Risk
    </span>
  );
}

function UncertaintyBadge({ probabilities }) {
  if (!probabilities) return null;
  const maxProb = Math.max(...Object.values(probabilities));
  const entropy = -Object.values(probabilities).reduce((sum, p) => {
    if (p > 0) return sum + p * Math.log2(p);
    return sum;
  }, 0);
  const maxEntropy = Math.log2(Object.keys(probabilities).length);
  const normalizedEntropy = entropy / maxEntropy;

  let label, color;
  if (normalizedEntropy < 0.3) { label = 'High Confidence'; color = '#4ade80'; }
  else if (normalizedEntropy < 0.6) { label = 'Moderate Confidence'; color = '#fbbf24'; }
  else { label = 'Low Confidence'; color = '#f87171'; }

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      padding: '4px 12px', borderRadius: '999px', fontSize: '0.75rem',
      background: `${color}15`, color, border: `1px solid ${color}40`,
      fontWeight: 600,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {label}
    </span>
  );
}

export default function FloodPrediction() {
  const [formData, setFormData] = useState({ latitude: '', longitude: '' });
  const [prediction, setPrediction] = useState(null);
  const [loading, setLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showResult, setShowResult] = useState(false);
  const resultRef = useRef(null);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
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
      }
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage('');
    setPrediction(null);
    setShowResult(false);

    try {
      if (!formData.latitude || !formData.longitude) {
        setErrorMessage('Please enter latitude and longitude.');
        setLoading(false);
        return;
      }

      const response = await API.post('/predict-flood', {
        latitude: Number(formData.latitude),
        longitude: Number(formData.longitude),
      });

      setPrediction(response.data);
      setTimeout(() => setShowResult(true), 50);
    } catch (error) {
      setErrorMessage(
        error.response?.data?.error ||
          'Failed to analyze risk. Ensure backend is running.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard-page">
      <section className="dashboard-intro animate-fade-in-up">
        <div>
          <p className="eyebrow">ML RISK ASSESSMENT</p>
          <h1 className="gradient-text">Flood Risk Prediction</h1>
          <p style={{ color: '#94a3b8', marginTop: '0.5rem', fontSize: '0.95rem' }}>
            Enter coordinates or use your GPS location to get real-time flood risk analysis powered by machine learning.
          </p>
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', alignItems: 'start' }}>
        {/* Input Form */}
        <section className="dashboard-section animate-fade-in-up delay-1">
          <div className="glass-card">
            <h2 style={{ margin: '0 0 1.25rem', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.4rem' }}>📍</span> Location Input
            </h2>

            <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#94a3b8', fontWeight: 600 }}>
                  Latitude
                </label>
                <input
                  type="number"
                  step="any"
                  name="latitude"
                  value={formData.latitude}
                  onChange={handleChange}
                  placeholder="e.g. 27.7172"
                  required
                  style={{
                    width: '100%', padding: '12px 16px', borderRadius: '10px',
                    border: '1px solid rgba(148, 163, 184, 0.15)',
                    background: 'rgba(15, 23, 42, 0.8)', color: '#e2e8f0',
                    fontSize: '0.95rem', outline: 'none',
                    transition: 'all 0.2s ease',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#94a3b8', fontWeight: 600 }}>
                  Longitude
                </label>
                <input
                  type="number"
                  step="any"
                  name="longitude"
                  value={formData.longitude}
                  onChange={handleChange}
                  placeholder="e.g. 85.3240"
                  required
                  style={{
                    width: '100%', padding: '12px 16px', borderRadius: '10px',
                    border: '1px solid rgba(148, 163, 184, 0.15)',
                    background: 'rgba(15, 23, 42, 0.8)', color: '#e2e8f0',
                    fontSize: '0.95rem', outline: 'none',
                    transition: 'all 0.2s ease',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={getCurrentLocation}
                  disabled={locationLoading || loading}
                  className="btn-modern"
                  style={{
                    flex: 1, padding: '12px', borderRadius: '10px',
                    border: '1px solid rgba(148, 163, 184, 0.2)',
                    background: 'rgba(255, 255, 255, 0.04)', color: '#e2e8f0',
                    fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem',
                  }}
                >
                  {locationLoading ? (
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                      <span className="skeleton" style={{ width: 16, height: 16, borderRadius: '50%' }} />
                      Locating...
                    </span>
                  ) : '📡 Use GPS'}
                </button>

                <button
                  type="submit"
                  disabled={loading || locationLoading}
                  className="btn-modern primary-button"
                  style={{
                    flex: 2, padding: '12px', borderRadius: '10px',
                    fontSize: '0.95rem',
                  }}
                >
                  {loading ? (
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                      <span className="skeleton" style={{ width: 16, height: 16, borderRadius: '50%' }} />
                      Analyzing...
                    </span>
                  ) : '🔍 Calculate Risk'}
                </button>
              </div>
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

          {!loading && !prediction && (
            <div className="glass-card" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>🌊</div>
              <h3 style={{ margin: '0 0 0.5rem', color: '#94a3b8', fontWeight: 600 }}>No Analysis Yet</h3>
              <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>
                Enter coordinates and click Calculate Risk to get started.
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
