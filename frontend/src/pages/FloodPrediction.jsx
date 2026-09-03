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
            <div
              style={{
                marginTop: '1rem',
                color: '#ef6a55',
                fontWeight: 'bold',
              }}
            >
              {errorMessage}
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
        </div>
      </section>
    </div>
  );
}