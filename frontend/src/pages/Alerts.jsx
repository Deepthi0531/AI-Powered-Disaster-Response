import { useEffect, useState } from 'react';
import API from '../api/axios';

// Haversine distance helper function (returns distance in km)
function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function Alerts() {
  const [incidents, setIncidents] = useState([]);
  const [nearbyIncidents, setNearbyIncidents] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [locationStatus, setLocationStatus] = useState('Fetching location...');

  // State for resolving an incident
  const [resolvingId, setResolvingId] = useState(null);
  const [proofFile, setProofFile] = useState(null);
  const [resolvingLoading, setResolvingLoading] = useState(false);

  const BACKEND_BASE_URL = 'http://127.0.0.1:5000';

  // 1. Fetch Verified Incidents from Backend
  const fetchIncidents = () => {
    setLoading(true);
    API.get('/incidents/verified')
      .then((res) => {
        setIncidents(res.data.data || []);
      })
      .catch((err) => {
        console.error('Failed to load incidents:', err);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchIncidents();
  }, []);

  // 2. Get User's Geolocation
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationStatus('Geolocation is not supported by your browser.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setUserLocation(coords);
        setLocationStatus(`Showing incidents within 10 km of your location.`);
      },
      (err) => {
        console.warn('Geolocation denied or failed:', err);
        setLocationStatus('Location access denied. Showing all reported incidents.');
      }
    );
  }, []);

  // 3. Filter Incidents by Distance when Location or Incidents update
  useEffect(() => {
    if (!incidents.length) {
      setNearbyIncidents([]);
      return;
    }

    if (!userLocation) {
      // If location is disabled, default to showing all verified incidents
      setNearbyIncidents(incidents);
      return;
    }

    const filtered = incidents
      .map((inc) => {
        const coords = inc.location?.coordinates; // Format: [longitude, latitude]
        if (!coords || coords.length < 2) return null;

        const distance = getDistanceKm(
          userLocation.lat,
          userLocation.lng,
          coords[1], // Latitude
          coords[0]  // Longitude
        );

        return { ...inc, distanceKm: distance };
      })
      .filter((inc) => inc && inc.distanceKm <= 10) // Filter to 10 km radius
      .sort((a, b) => a.distanceKm - b.distanceKm);

    setNearbyIncidents(filtered);
  }, [incidents, userLocation]);

  // 4. Handle Proof Photo Upload & Incident Resolution
  const handleResolveIncident = async (incidentId) => {
    if (!proofFile) {
      alert('Please select a proof image showing the resolved incident.');
      return;
    }

    const formData = new FormData();
    formData.append('proof_image', proofFile);

    try {
      setResolvingLoading(true);
      await API.post(`/incidents/resolve/${incidentId}`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      alert('Incident successfully resolved and deleted from database!');
      setResolvingId(null);
      setProofFile(null);
      
      // Update state locally to immediately remove resolved card
      setIncidents((prev) => prev.filter((item) => (item._id || item.id) !== incidentId));
    } catch (err) {
      console.error('Failed to resolve incident:', err);
      alert(err.response?.data?.message || 'Error resolving incident. Please try again.');
    } finally {
      setResolvingLoading(false);
    }
  };

  // Helper function to format timestamp
  const formatDateTime = (rawDate) => {
    if (!rawDate) return 'Recently';
    const dateObj = new Date(rawDate);
    if (isNaN(dateObj.getTime())) return 'Recently';

    return `${dateObj.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })} at ${dateObj.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })}`;
  };

  return (
    <div className="dashboard-page" style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
      {/* Header Banner */}
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
        <h1 style={{ color: '#fff', margin: '0.5rem 0' }}>Emergency Alerts</h1>
        <small style={{ color: '#6b7280', display: 'block', marginTop: '0.5rem' }}>
          {locationStatus}
        </small>
      </section>

      {/* Dynamic Nearby Incidents Section */}
      <section
        className="dashboard-section"
        style={{
          backgroundColor: '#111827',
          padding: '1.5rem',
          borderRadius: '8px',
          border: '1px solid #1f2937',
        }}
      >
        <h2 style={{ color: '#fff', marginBottom: '1rem' }}>
          Nearby Reported Incidents ({nearbyIncidents.length})
        </h2>

        {loading ? (
          <p style={{ color: '#9ca3af' }}>Loading live incident reports...</p>
        ) : nearbyIncidents.length === 0 ? (
          <p style={{ color: '#53b889' }}>No severe incidents reported within 10 km of your current location.</p>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {nearbyIncidents.map((incident) => {
              const incidentId = incident._id || incident.id;
              const borderLeftColor =
                incident.severity === 'high' || incident.type?.toLowerCase().includes('flood')
                  ? '#ef6a55'
                  : incident.severity === 'medium'
                  ? '#e6b84b'
                  : '#2574e8';

              // Construct proper image URL
              let imageSrc = null;
              if (incident.image_url) {
                imageSrc = incident.image_url.startsWith('http')
                  ? incident.image_url
                  : `${BACKEND_BASE_URL}/${incident.image_url}`;
              }

              // Extract coordinates
              const coords = incident.location?.coordinates;
              const locationStr = coords
                ? `Lat: ${coords[1].toFixed(4)}, Lon: ${coords[0].toFixed(4)}`
                : incident.address || 'Mysuru District';

              return (
                <div
                  key={incidentId}
                  style={{
                    backgroundColor: '#1f2937',
                    padding: '1.25rem',
                    borderRadius: '8px',
                    borderLeft: `5px solid ${borderLeftColor}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem',
                  }}
                >
                  <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
                    {/* Incident Image Display */}
                    {imageSrc && (
                      <div
                        style={{
                          width: '180px',
                          height: '120px',
                          borderRadius: '6px',
                          overflow: 'hidden',
                          backgroundColor: '#111827',
                          flexShrink: 0,
                          border: '1px solid #374151',
                        }}
                      >
                        <img
                          src={imageSrc}
                          alt={incident.type || 'Incident'}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={(e) => {
                            e.target.style.display = 'none';
                          }}
                        />
                      </div>
                    )}

                    {/* Incident Main Body */}
                    <div style={{ flex: 1, minWidth: '240px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ color: '#fff', margin: 0 }}>
                          {incident.title || incident.type || 'Hazard Report'}
                        </h3>
                        {incident.distanceKm !== undefined && (
                          <span
                            style={{
                              backgroundColor: '#374151',
                              color: '#67d5c7',
                              padding: '0.2rem 0.6rem',
                              borderRadius: '4px',
                              fontSize: '0.85rem',
                            }}
                          >
                            {incident.distanceKm.toFixed(1)} km away
                          </span>
                        )}
                      </div>

                      <p style={{ color: '#d1d5db', margin: '0.5rem 0' }}>
                        {incident.description || 'Verified citizen incident report near your area.'}
                      </p>

                      {/* Date, Time, Location & Status Metadata */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                          gap: '0.5rem',
                          marginTop: '0.75rem',
                          fontSize: '0.85rem',
                          color: '#9ca3af',
                          borderTop: '1px solid #374151',
                          paddingTop: '0.5rem',
                        }}
                      >
                        <div>
                          <strong style={{ color: '#e5e7eb' }}>📍 Location:</strong> {locationStr}
                        </div>
                        <div>
                          <strong style={{ color: '#e5e7eb' }}>📅 Date & Time:</strong>{' '}
                          {formatDateTime(incident.created_at || incident.createdAt)}
                        </div>
                        <div>
                          <strong style={{ color: '#e5e7eb' }}>⚡ Status:</strong>{' '}
                          <span style={{ color: '#f59e0b', fontWeight: '600' }}>Active / Unresolved</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Citizen Resolution Action Section */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #2d3748', paddingTop: '0.75rem' }}>
                    {resolvingId === incidentId ? (
                      <div
                        style={{
                          backgroundColor: '#111827',
                          padding: '0.75rem',
                          borderRadius: '6px',
                          border: '1px solid #374151',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.5rem',
                          width: '100%',
                          maxWidth: '380px',
                        }}
                      >
                        <label style={{ color: '#d1d5db', fontSize: '0.85rem', fontWeight: '500' }}>
                          Upload Proof Photo of Resolved Hazard:
                        </label>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => setProofFile(e.target.files[0])}
                          style={{ color: '#9ca3af', fontSize: '0.8rem' }}
                        />
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                          <button
                            onClick={() => {
                              setResolvingId(null);
                              setProofFile(null);
                            }}
                            style={{
                              padding: '0.35rem 0.75rem',
                              backgroundColor: '#4b5563',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '0.8rem',
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleResolveIncident(incidentId)}
                            disabled={resolvingLoading}
                            style={{
                              padding: '0.35rem 0.75rem',
                              backgroundColor: '#10b981',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '0.8rem',
                              fontWeight: 'bold',
                            }}
                          >
                            {resolvingLoading ? 'Resolving...' : 'Confirm & Mark Resolved'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setResolvingId(incidentId)}
                        style={{
                          backgroundColor: '#059669',
                          color: '#fff',
                          border: 'none',
                          padding: '0.5rem 1rem',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontWeight: '600',
                          fontSize: '0.85rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                        }}
                      >
                        <span>✓</span> Mark as Resolved & Upload Proof
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}