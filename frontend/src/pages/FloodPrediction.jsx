import { useEffect, useRef, useState } from 'react';
import API from '../api/axios';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const customBluePinIcon = L.divIcon({
  className: 'custom-pin-marker',
  html: `
    <div style="position:relative;width:30px;height:30px;display:flex;align-items:center;justify-content:center;">
      <div style="
        position:absolute;width:18px;height:18px;background:#2563eb;
        border:3px solid white;border-radius:50%;
        box-shadow:0 0 10px rgba(37,99,235,.8);z-index:2;
      "></div>
      <div style="
        position:absolute;width:32px;height:32px;background:rgba(37,99,235,.35);
        border-radius:50%;z-index:1;
      "></div>
    </div>
  `,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

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

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);

  // Reverse Geocoding (Coordinates -> Address Name)
  const fetchAddressName = async (lat, lon) => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`
      );
      const data = await response.json();

      if (data?.address) {
        const { city, town, village, suburb, neighbourhood, county, state_district } = data.address;
        const area = suburb || neighbourhood || city || town || village || county || state_district || '';
        const cityName = city || town || village || state_district || '';
        const displayName = cityName && area !== cityName && area !== '' ? `${area}, ${cityName}` : area || data.display_name || 'Selected Location';

        setFormData((prev) => ({
          ...prev,
          location_name: displayName,
        }));
      }
    } catch (error) {
      console.warn('Reverse geocoding error:', error);
    }
  };

  const updateCoordinatesOnMap = (lat, lng) => {
    const position = [lat, lng];
    if (mapRef.current) {
      mapRef.current.setView(position, 12);

      if (markerRef.current) {
        markerRef.current.setLatLng(position);
      } else {
        markerRef.current = L.marker(position, {
          icon: customBluePinIcon,
          draggable: true,
        }).addTo(mapRef.current);

        markerRef.current.on('dragend', (event) => {
          const newPos = event.target.getLatLng();
          const formattedLat = newPos.lat.toFixed(6);
          const formattedLng = newPos.lng.toFixed(6);
          setFormData((prev) => ({
            ...prev,
            latitude: formattedLat,
            longitude: formattedLng,
          }));
          fetchAddressName(formattedLat, formattedLng);
        });
      }
    }
  };

  const updateCoordinates = (lat, lng) => {
    const formattedLat = Number(lat).toFixed(6);
    const formattedLng = Number(lng).toFixed(6);

    setFormData((prev) => ({
      ...prev,
      latitude: formattedLat,
      longitude: formattedLng,
    }));

    fetchAddressName(formattedLat, formattedLng);
    updateCoordinatesOnMap(lat, lng);
  };

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const initialLat = 12.3712;
    const initialLng = 76.5851;

    const map = L.map(mapContainerRef.current).setView([initialLat, initialLng], 11);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    map.on('click', (e) => {
      const { lat, lng } = e.latlng;
      updateCoordinates(lat, lng);
    });

    mapRef.current = map;

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    if ((name === 'latitude' || name === 'longitude') && value) {
      const updatedForm = { ...formData, [name]: value };
      const lat = parseFloat(updatedForm.latitude);
      const lng = parseFloat(updatedForm.longitude);

      if (!isNaN(lat) && !isNaN(lng)) {
        updateCoordinatesOnMap(lat, lng);
      }
    }
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
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        updateCoordinates(lat, lng);
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
    <div
      className="dashboard-page"
      style={{
        padding: '2rem',
        maxWidth: '1200px',
        margin: '0 auto',
      }}
    >
      <section
        className="dashboard-intro"
        style={{
          backgroundColor: '#111827',
          padding: '1.5rem',
          borderRadius: '8px',
          marginBottom: '1.5rem',
          border: '1px solid #1f2937',
        }}
      >
        <div>
          <p className="eyebrow" style={{ color: '#9ca3af', fontSize: '0.85rem' }}>
            ML RISK ASSESSMENT
          </p>
          <h1 style={{ color: '#fff', margin: '0.5rem 0' }}>
            Flood Risk Prediction
          </h1>
        </div>
      </section>

      <section
        style={{
          backgroundColor: '#111827',
          padding: '1rem',
          borderRadius: '8px',
          marginBottom: '1.5rem',
          border: '1px solid #1f2937',
        }}
      >
        <label
          style={{
            color: '#fff',
            fontWeight: '600',
            fontSize: '0.95rem',
            display: 'block',
            marginBottom: '0.75rem',
          }}
        >
          📍 Select Location on Map (Click or Drag Marker):
        </label>
        <div
          ref={mapContainerRef}
          style={{
            height: '350px',
            width: '100%',
            borderRadius: '6px',
            overflow: 'hidden',
          }}
        />
      </section>

      <section
        className="dashboard-section"
        style={{
          backgroundColor: '#111827',
          padding: '1.5rem',
          borderRadius: '8px',
          border: '1px solid #1f2937',
        }}
      >
        <div style={{ maxWidth: '450px' }}>
          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1rem' }}>
            <div>
              <label style={{ color: '#d1d5db', display: 'block', marginBottom: '0.4rem' }}>
                Location / Area Name
              </label>
              <input
                type="text"
                name="location_name"
                value={formData.location_name}
                onChange={handleChange}
                placeholder="Enter area (e.g. Vijayanagar)"
                style={{
                  width: '100%',
                  padding: '0.6rem',
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '4px',
                  color: '#fff',
                }}
              />
            </div>

            <div>
              <label style={{ color: '#d1d5db', display: 'block', marginBottom: '0.4rem' }}>
                Latitude
              </label>
              <input
                type="number"
                step="any"
                name="latitude"
                value={formData.latitude}
                onChange={handleChange}
                placeholder="Auto-filled from location or map"
                style={{
                  width: '100%',
                  padding: '0.6rem',
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '4px',
                  color: '#fff',
                }}
              />
            </div>

            <div>
              <label style={{ color: '#d1d5db', display: 'block', marginBottom: '0.4rem' }}>
                Longitude
              </label>
              <input
                type="number"
                step="any"
                name="longitude"
                value={formData.longitude}
                onChange={handleChange}
                placeholder="Auto-filled from location or map"
                style={{
                  width: '100%',
                  padding: '0.6rem',
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '4px',
                  color: '#fff',
                }}
              />
            </div>

            <button
              type="button"
              onClick={getCurrentLocation}
              disabled={locationLoading || loading}
              style={{
                padding: '0.6rem',
                backgroundColor: '#374151',
                color: '#e5e7eb',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              {locationLoading ? 'Getting Location...' : 'Use Current Location'}
            </button>

            <button
              type="submit"
              className="primary-button"
              disabled={loading || locationLoading}
              style={{
                padding: '0.75rem',
                backgroundColor: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: '600',
              }}
            >
              {geocodingLoading
                ? 'Resolving Location...'
                : loading
                ? 'Processing Model...'
                : 'Calculate Flood Risk'}
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
                backgroundColor: '#1f2937',
                borderRadius: '6px',
                border: '1px solid #2574e8',
                color: '#fff',
              }}
            >
              {formData.location_name && (
                <p style={{ marginTop: 0, color: '#93c5fd', fontWeight: 'bold' }}>
                  📍 {formData.location_name}
                </p>
              )}

              <h2 style={{ marginTop: formData.location_name ? '0.5rem' : 0 }}>
                Flood Risk: {prediction.risk_level}
              </h2>

              <p>
                <strong>Low Probability:</strong>{' '}
                {(prediction.low_probability * 100).toFixed(2)}%
              </p>

              <p>
                <strong>Medium Probability:</strong>{' '}
                {(prediction.medium_probability * 100).toFixed(2)}%
              </p>

              <p style={{ marginBottom: 0 }}>
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