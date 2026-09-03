import { useState, useEffect } from 'react';
import API from '../api/axios';

export default function AddShelterModal({ isOpen, onClose, userCoords, onShelterAdded }) {
  const [formData, setFormData] = useState({
    name: '',
    total_beds: 100,
    available_beds: 100,
    lat: '',
    lng: '',
    address: '',
    facilities: 'Water, Emergency Shelter, Power',
    image: null,
  });

  const [loading, setLoading] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [error, setError] = useState('');

  // Prefill user location on open if available
  useEffect(() => {
    if (userCoords && isOpen) {
      setFormData((prev) => ({
        ...prev,
        lat: userCoords.lat !== undefined && userCoords.lat !== null ? userCoords.lat.toString() : '',
        lng: userCoords.lng !== undefined && userCoords.lng !== null ? userCoords.lng.toString() : '',
      }));
    }
  }, [userCoords, isOpen]);

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value, files } = e.target;
    if (name === 'image') {
      setFormData((prev) => ({ ...prev, image: files[0] }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  // 1. Fetch live GPS position directly inside the modal
  const handleGetLiveLocation = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setFormData((prev) => ({
          ...prev,
          lat: latitude.toString(),
          lng: longitude.toString(),
        }));
        setError('');
      },
      () => {
        setError('Unable to retrieve your location. Please check browser permissions.');
      },
      { enableHighAccuracy: true }
    );
  };

  // 2. Fetch coordinates from address if adding on behalf of another location
  const handleGeocodeAddress = async () => {
    if (!formData.address.trim()) {
      setError('Please enter an address first to fetch its coordinates.');
      return;
    }

    setGeocoding(true);
    setError('');

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          formData.address
        )}`
      );
      const data = await response.json();

      if (data && data.length > 0) {
        const { lat, lon } = data[0];
        setFormData((prev) => ({
          ...prev,
          lat: lat.toString(),
          lng: lon.toString(),
        }));
      } else {
        setError('Could not find coordinates for this address. Please enter manually.');
      }
    } catch (err) {
      console.error('Geocoding error:', err);
      setError('Failed to fetch location coordinates for this address.');
    } finally {
      setGeocoding(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const parsedLat = parseFloat(formData.lat);
    const parsedLng = parseFloat(formData.lng);

    if (!formData.name.trim() || isNaN(parsedLat) || isNaN(parsedLng)) {
      setError('Shelter Name, Latitude, and Longitude are required and must be valid numbers.');
      return;
    }

    setLoading(true);

    try {
      const data = new FormData();
      data.append('name', formData.name.trim());
      
      const parsedTotal = parseInt(formData.total_beds, 10);
      const parsedAvailable = parseInt(formData.available_beds, 10);
      
      data.append('total_beds', isNaN(parsedTotal) ? 100 : parsedTotal);
      data.append('available_beds', isNaN(parsedAvailable) ? 100 : parsedAvailable);
      data.append('lat', parsedLat);
      data.append('lon', parsedLng);
      data.append('lng', parsedLng);
      data.append('address', formData.address.trim());
      data.append('facilities', formData.facilities.trim());

      if (formData.image) {
        data.append('image', formData.image);
      }

      const response = await API.post('/shelters/report', data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const responseData = response.data?.data || response.data;
      const newShelter = {
        ...responseData,
        id: responseData?._id || responseData?.id || `shelter-${Date.now()}`,
        lat: parsedLat,
        lon: parsedLng,
        lng: parsedLng,
        is_admin: true,
      };

      if (onShelterAdded) {
        onShelterAdded(newShelter);
      }
      onClose();
    } catch (err) {
      console.error('Submission failed:', err);
      setError(err.response?.data?.message || 'Failed to submit shelter place.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerTitle}>
            <span style={{ marginRight: '8px' }}>📍</span>
            <span>Report / Add Shelter Place</span>
          </div>
          <button onClick={onClose} style={styles.closeBtn}>
            &times;
          </button>
        </div>

        {error && <div style={styles.errorBanner}>{error}</div>}

        <form onSubmit={handleSubmit} style={styles.form}>
          {/* Shelter Name */}
          <div style={styles.inputGroup}>
            <label style={styles.label}>Shelter Name / Facility</label>
            <input
              type="text"
              name="name"
              placeholder="e.g. Community Hall Sector 4"
              value={formData.name}
              onChange={handleChange}
              required
              style={styles.input}
            />
          </div>

          {/* Beds Row */}
          <div style={styles.row}>
            <div style={styles.col}>
              <label style={styles.label}>Total Beds</label>
              <input
                type="number"
                name="total_beds"
                value={formData.total_beds}
                onChange={handleChange}
                style={styles.input}
              />
            </div>
            <div style={styles.col}>
              <label style={styles.label}>Available Beds</label>
              <input
                type="number"
                name="available_beds"
                value={formData.available_beds}
                onChange={handleChange}
                style={styles.input}
              />
            </div>
          </div>

          {/* Address / On Behalf of Field */}
          <div style={styles.inputGroup}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={styles.label}>Address / Location Details (If reporting on behalf of another place)</label>
              <button
                type="button"
                onClick={handleGeocodeAddress}
                style={styles.smallActionBtn}
                disabled={geocoding}
              >
                {geocoding ? 'Locating...' : 'Fetch Coordinates'}
              </button>
            </div>
            <input
              type="text"
              name="address"
              placeholder="e.g. 123 Main St, Near Central Bus Stand"
              value={formData.address}
              onChange={handleChange}
              style={styles.input}
            />
          </div>

          {/* Coordinates Row */}
          <div style={styles.inputGroup}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label style={styles.label}>Location Coordinates</label>
              <button
                type="button"
                onClick={handleGetLiveLocation}
                style={styles.smallActionBtn}
              >
                📍 Use Live Location
              </button>
            </div>

            <div style={styles.row}>
              <div style={styles.col}>
                <label style={styles.subLabel}>Latitude</label>
                <input
                  type="text"
                  name="lat"
                  placeholder="e.g. 12.2958"
                  value={formData.lat}
                  onChange={handleChange}
                  required
                  style={styles.input}
                />
              </div>
              <div style={styles.col}>
                <label style={styles.subLabel}>Longitude</label>
                <input
                  type="text"
                  name="lng"
                  placeholder="e.g. 76.6394"
                  value={formData.lng}
                  onChange={handleChange}
                  required
                  style={styles.input}
                />
              </div>
            </div>
          </div>

          {/* Facilities */}
          <div style={styles.inputGroup}>
            <label style={styles.label}>Facilities</label>
            <input
              type="text"
              name="facilities"
              value={formData.facilities}
              onChange={handleChange}
              style={styles.input}
            />
          </div>

          {/* File Upload */}
          <div style={styles.inputGroup}>
            <label style={styles.label}>Shelter Image (Optional)</label>
            <input
              type="file"
              name="image"
              accept="image/*"
              onChange={handleChange}
              style={styles.fileInput}
            />
          </div>

          {/* Actions */}
          <div style={styles.actions}>
            <button type="button" onClick={onClose} style={styles.cancelBtn}>
              Cancel
            </button>
            <button type="submit" disabled={loading} style={styles.submitBtn}>
              {loading ? 'Posting...' : 'Post Shelter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1100,
    padding: '16px',
  },
  modal: {
    backgroundColor: '#121927',
    color: '#e5e7eb',
    borderRadius: '12px',
    width: '100%',
    maxWidth: '460px',
    padding: '20px 24px',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
    border: '1px solid #1f293d',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  headerTitle: {
    fontSize: '18px',
    fontWeight: '700',
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#9ca3af',
    fontSize: '22px',
    cursor: 'pointer',
    lineHeight: '1',
  },
  errorBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    border: '1px solid #ef4444',
    color: '#fca5a5',
    padding: '8px 12px',
    borderRadius: '6px',
    marginBottom: '14px',
    fontSize: '13px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  row: {
    display: 'flex',
    gap: '12px',
  },
  col: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  label: {
    fontSize: '13px',
    fontWeight: '500',
    color: '#9ca3af',
  },
  subLabel: {
    fontSize: '12px',
    color: '#6b7280',
  },
  input: {
    backgroundColor: '#1b2436',
    border: '1px solid #2a364f',
    borderRadius: '6px',
    padding: '10px 12px',
    color: '#ffffff',
    fontSize: '14px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  fileInput: {
    backgroundColor: '#1b2436',
    border: '1px solid #2a364f',
    borderRadius: '6px',
    padding: '8px 12px',
    color: '#9ca3af',
    fontSize: '13px',
    cursor: 'pointer',
  },
  smallActionBtn: {
    background: 'none',
    border: 'none',
    color: '#3b82f6',
    fontSize: '12px',
    cursor: 'pointer',
    fontWeight: '600',
    padding: '0',
  },
  actions: {
    display: 'flex',
    justify: 'flex-end',
    gap: '10px',
    marginTop: '8px',
  },
  cancelBtn: {
    backgroundColor: '#2d3748',
    color: '#e5e7eb',
    border: 'none',
    borderRadius: '6px',
    padding: '10px 18px',
    fontWeight: '600',
    fontSize: '14px',
    cursor: 'pointer',
  },
  submitBtn: {
    backgroundColor: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    padding: '10px 20px',
    fontWeight: '600',
    fontSize: '14px',
    cursor: 'pointer',
  },
};