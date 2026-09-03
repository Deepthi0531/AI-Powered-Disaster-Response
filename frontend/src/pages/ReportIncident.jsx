import { useState, useEffect, useRef } from 'react';
import API from '../api/axios';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
});

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

export default function ReportIncident() {
  const [file, setFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [incidentType, setIncidentType] = useState('Flood');
  const [severity, setSeverity] = useState('Medium');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState(null);
  const [locationMessage, setLocationMessage] = useState('');
  const [gettingLocation, setGettingLocation] = useState(false);
  const [loading, setLoading] = useState(false);

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);

  // Initialize and update the map when location state changes
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const defaultLat = location?.latitude || 14.2798;
    const defaultLng = location?.longitude || 74.4441;

    if (!mapRef.current) {
      const map = L.map(mapContainerRef.current).setView([defaultLat, defaultLng], 12);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      map.on('click', (e) => {
        const { lat, lng } = e.latlng;
        setLocation({
          latitude: parseFloat(lat.toFixed(6)),
          longitude: parseFloat(lng.toFixed(6)),
        });
        setLocationMessage(`Selected via map: ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      });

      mapRef.current = map;
    }

    const map = mapRef.current;

    if (location?.latitude && location?.longitude) {
      const pos = [location.latitude, location.longitude];

      if (markerRef.current) {
        markerRef.current.setLatLng(pos);
      } else {
        markerRef.current = L.marker(pos, { draggable: true }).addTo(map);

        markerRef.current.on('dragend', (event) => {
          const newPos = event.target.getLatLng();
          setLocation({
            latitude: parseFloat(newPos.lat.toFixed(6)),
            longitude: parseFloat(newPos.lng.toFixed(6)),
          });
          setLocationMessage(`Pinned location: ${newPos.lat.toFixed(5)}, ${newPos.lng.toFixed(5)}`);
        });
      }

      map.setView(pos, 14);
    }

    return () => {
      // Clean up on unmount
    };
  }, [location?.latitude, location?.longitude]);

  // Clean up map instance on unmount
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  const handleImageChange = (event) => {
    const selectedFile = event.target.files[0];

    if (!selectedFile) {
      return;
    }

    if (!selectedFile.type.startsWith('image/')) {
      alert('Please select a valid image file.');
      event.target.value = '';
      return;
    }

    if (selectedFile.size > MAX_IMAGE_SIZE) {
      alert('Image size must be less than 5 MB.');
      event.target.value = '';
      return;
    }

    setFile(selectedFile);
    setImagePreview(URL.createObjectURL(selectedFile));
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationMessage('Location is not supported by this browser.');
      return;
    }

    setGettingLocation(true);
    setLocationMessage('Getting your current location...');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = parseFloat(position.coords.latitude.toFixed(6));
        const lng = parseFloat(position.coords.longitude.toFixed(6));

        setLocation({
          latitude: lat,
          longitude: lng,
        });

        setLocationMessage('Location added successfully.');
        setGettingLocation(false);
      },
      () => {
        setLocation(null);
        setLocationMessage(
          'Unable to get your location. Please allow location permission and try again.'
        );
        setGettingLocation(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };

  const handleLatitudeChange = (val) => {
    const parsed = parseFloat(val);
    setLocation((prev) => ({
      latitude: isNaN(parsed) ? '' : parsed,
      longitude: prev?.longitude || 0,
    }));
  };

  const handleLongitudeChange = (val) => {
    const parsed = parseFloat(val);
    setLocation((prev) => ({
      latitude: prev?.latitude || 0,
      longitude: isNaN(parsed) ? '' : parsed,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!file) {
      alert('Please select an incident image to upload.');
      return;
    }

    if (!location || !location.latitude || !location.longitude) {
      alert('Please provide a valid location via GPS, map click, or manual inputs.');
      return;
    }

    setLoading(true);

    const formData = new FormData();

    formData.append('image', file);
    formData.append('type', incidentType);
    formData.append('severity', severity);
    formData.append('description', description.trim());
    formData.append('latitude', location.latitude);
    formData.append('longitude', location.longitude);

    try {
      const response = await API.post('/incidents/report', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 60000,
      });

      const predictedType =
        response.data.verification?.cv?.detected_labels?.[0] || 'Pending';

      alert(
        `Report submitted successfully!\n\n` +
        `Report ID: ${response.data.incident_id}\n` +
        `Verification Result: ${predictedType}\n` +
        `Status: PENDING — waiting for admin approval.`
      );

      setFile(null);
      setImagePreview(null);
      setIncidentType('Flood');
      setSeverity('Medium');
      setDescription('');
      setLocation(null);
      setLocationMessage('');
    } catch (error) {
      console.error('Submission failed:', error);
      alert(error.response?.data?.message || 'Failed to submit report.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '1100px', margin: '20px auto', padding: '0 16px' }}>
      <h2>Report Emergency Incident</h2>
      <p style={{ marginBottom: '24px' }}>Share an incident image and your location to help emergency responders.</p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '24px',
          alignItems: 'start',
        }}
      >
        {/* Left Form Section */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '6px' }}>Incident Type:</label>
            <select
              value={incidentType}
              onChange={(event) => setIncidentType(event.target.value)}
              required
              style={{ width: '100%', padding: '8px', borderRadius: '4px' }}
            >
              <option value="Flood">Flood / Waterlogging</option>
              <option value="Blocked Road">Blocked Road</option>
              <option value="Structural Damage">Structural Damage</option>
              <option value="Landslide">Landslide</option>
              <option value="Fire">Fire</option>
              <option value="Fallen Tree">Fallen Tree</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '6px' }}>Severity Level:</label>
            <select
              value={severity}
              onChange={(event) => setSeverity(event.target.value)}
              style={{ width: '100%', padding: '8px', borderRadius: '4px' }}
            >
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '6px' }}>Description:</label>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Briefly describe the emergency situation..."
              maxLength={500}
              rows="4"
              required
              style={{ width: '100%', padding: '8px', borderRadius: '4px' }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '6px' }}>Upload Image:</label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp"
              onChange={handleImageChange}
              required
              style={{ width: '100%' }}
            />
            <small style={{ display: 'block', marginTop: '4px' }}>Accepted: JPG, PNG, WEBP. Maximum size: 5 MB.</small>
          </div>

          {imagePreview && (
            <div style={{ marginBottom: '16px' }}>
              <p style={{ marginBottom: '6px' }}>Image Preview:</p>
              <img
                src={imagePreview}
                alt="Selected incident"
                style={{
                  width: '100%',
                  maxHeight: '240px',
                  objectFit: 'cover',
                  borderRadius: '8px',
                }}
              />
            </div>
          )}

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontWeight: 'bold' }}>Incident Location:</label>

            <button
              type="button"
              onClick={useCurrentLocation}
              disabled={gettingLocation}
              style={{ display: 'block', marginTop: '8px', padding: '8px 14px', cursor: 'pointer' }}
            >
              {gettingLocation ? 'Getting Location...' : 'Use My Current Location'}
            </button>

            {/* Manual Latitude and Longitude updating */}
            <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '4px' }}>Latitude:</label>
                <input
                  type="number"
                  step="any"
                  placeholder="e.g. 14.2798"
                  value={location?.latitude ?? ''}
                  onChange={(e) => handleLatitudeChange(e.target.value)}
                  style={{ width: '100%', padding: '6px', borderRadius: '4px' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '4px' }}>Longitude:</label>
                <input
                  type="number"
                  step="any"
                  placeholder="e.g. 74.4441"
                  value={location?.longitude ?? ''}
                  onChange={(e) => handleLongitudeChange(e.target.value)}
                  style={{ width: '100%', padding: '6px', borderRadius: '4px' }}
                />
              </div>
            </div>

            {locationMessage && (
              <p
                style={{
                  color: location ? '#22c55e' : '#f59e0b',
                  marginTop: '8px',
                  fontSize: '0.9rem',
                }}
              >
                {locationMessage}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || gettingLocation}
            style={{
              width: '100%',
              padding: '10px 16px',
              fontWeight: 'bold',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Submitting Report...' : 'Submit Report'}
          </button>
        </form>

        {/* Right Map Section */}
        <div style={{ width: '100%' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Click Map to Pin Incident Spot:
          </label>
          <div
            ref={mapContainerRef}
            style={{
              height: '480px',
              width: '100%',
              borderRadius: '8px',
              overflow: 'hidden',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            }}
          />
        </div>
      </div>
    </div>
  );
}