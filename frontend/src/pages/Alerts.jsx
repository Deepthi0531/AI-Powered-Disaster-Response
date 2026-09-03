import { useEffect, useState } from 'react';
import API from '../api/axios';

function getDistanceKm(lat1, lon1, lat2, lon2) {
  const radius = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return radius * c;
}

export default function Alerts() {
  const [incidents, setIncidents] = useState([]);
  const [nearbyIncidents, setNearbyIncidents] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [locationStatus, setLocationStatus] = useState(
    'Fetching your location...'
  );

  const [resolvingId, setResolvingId] = useState(null);
  const [proofFile, setProofFile] = useState(null);
  const [resolvingLoading, setResolvingLoading] = useState(false);

  const backendBaseUrl = 'http://127.0.0.1:5000';

  const fetchIncidents = () => {
    setLoading(true);

    API.get('/incidents/verified')
      .then((response) => {
        setIncidents(response.data.data || []);
      })
      .catch((error) => {
        console.error('Failed to load incidents:', error);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchIncidents();
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationStatus(
        'Location is not supported by this browser. Showing all verified incidents.'
      );
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });

        setLocationStatus(
          'Showing verified incidents within 10 km of your location.'
        );
      },
      (error) => {
        console.warn('Geolocation denied or failed:', error);

        setLocationStatus(
          'Location access denied. Showing all verified incidents.'
        );
      }
    );
  }, []);

  useEffect(() => {
    if (!incidents.length) {
      setNearbyIncidents([]);
      return;
    }

    if (!userLocation) {
      setNearbyIncidents(incidents);
      return;
    }

    const filteredIncidents = incidents
      .map((incident) => {
        const coordinates = incident.location?.coordinates;

        if (!coordinates || coordinates.length < 2) {
          return null;
        }

        const distanceKm = getDistanceKm(
          userLocation.lat,
          userLocation.lng,
          coordinates[1],
          coordinates[0]
        );

        return {
          ...incident,
          distanceKm,
        };
      })
      .filter(
        (incident) => incident && incident.distanceKm <= 10
      )
      .sort((first, second) => first.distanceKm - second.distanceKm);

    setNearbyIncidents(filteredIncidents);
  }, [incidents, userLocation]);

  const handleResolveIncident = async (incidentId) => {
    if (!proofFile) {
      alert('Please select a proof image showing the resolved incident.');
      return;
    }

    const formData = new FormData();
    formData.append('proof_image', proofFile);

    try {
      setResolvingLoading(true);

      await API.post(
        `/incidents/resolve/${incidentId}`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      alert('Incident successfully resolved.');

      setResolvingId(null);
      setProofFile(null);

      setIncidents((previous) =>
        previous.filter(
          (incident) =>
            (incident._id || incident.id) !== incidentId
        )
      );
    } catch (error) {
      console.error('Failed to resolve incident:', error);

      alert(
        error.response?.data?.message ||
          'Unable to resolve incident. Please try again.'
      );
    } finally {
      setResolvingLoading(false);
    }
  };

  const formatDateTime = (rawDate) => {
    if (!rawDate) {
      return 'Date unavailable';
    }

    const date = new Date(rawDate);

    if (Number.isNaN(date.getTime())) {
      return 'Date unavailable';
    }

    return date.toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      hour12: true,
    });
  };

  const getBorderColor = (incident) => {
    if (
      incident.severity === 'High' ||
      incident.type?.toLowerCase().includes('flood')
    ) {
      return '#ef6a55';
    }

    if (incident.severity === 'Medium') {
      return '#e6b84b';
    }

    return '#2574e8';
  };

  return (
    <div
      className="dashboard-page"
      style={{
        padding: '2rem',
        maxWidth: '1000px',
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
        <h1 style={{ color: '#fff', margin: '0.5rem 0' }}>
          Emergency Alerts
        </h1>

        <small
          style={{
            color: '#9ca3af',
            display: 'block',
            marginTop: '0.5rem',
          }}
        >
          {locationStatus}
        </small>
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
        <h2 style={{ color: '#fff', marginBottom: '1rem' }}>
          Nearby Verified Incidents ({nearbyIncidents.length})
        </h2>

        {loading ? (
          <p style={{ color: '#9ca3af' }}>
            Loading verified incident reports...
          </p>
        ) : nearbyIncidents.length === 0 ? (
          <p style={{ color: '#53b889' }}>
            No verified incidents were found near your location.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {nearbyIncidents.map((incident) => {
              const incidentId = incident._id || incident.id;

              const imageSource = incident.image_url
                ? incident.image_url.startsWith('http')
                  ? incident.image_url
                  : `${backendBaseUrl}/${incident.image_url}`
                : null;

              const locationName =
                incident.location_name || 'Location unavailable';

              return (
                <div
                  key={incidentId}
                  style={{
                    backgroundColor: '#1f2937',
                    padding: '1.25rem',
                    borderRadius: '8px',
                    borderLeft: `5px solid ${getBorderColor(incident)}`,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      gap: '1.25rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    {imageSource && (
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
                          src={imageSource}
                          alt={incident.type || 'Incident'}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                          }}
                          onError={(event) => {
                            event.target.style.display = 'none';
                          }}
                        />
                      </div>
                    )}

                    <div style={{ flex: 1, minWidth: '240px' }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          gap: '12px',
                        }}
                      >
                        <h3 style={{ color: '#fff', margin: 0 }}>
                          {incident.type || 'Hazard Report'}
                        </h3>

                        <small
                          style={{
                            color: '#9ca3af',
                            textAlign: 'right',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <strong>Reported:</strong>
                          <br />
                          {formatDateTime(incident.created_at)}
                        </small>
                      </div>

                      <div
                        style={{
                          marginTop: '1rem',
                          paddingTop: '0.7rem',
                          borderTop: '1px solid #374151',
                          color: '#9ca3af',
                          fontSize: '0.9rem',
                        }}
                      >
                        <strong style={{ color: '#e5e7eb' }}>
                          📍 Location:
                        </strong>{' '}
                        {locationName}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'flex-end',
                      borderTop: '1px solid #2d3748',
                      paddingTop: '0.75rem',
                      marginTop: '1rem',
                    }}
                  >
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
                        <label
                          style={{
                            color: '#d1d5db',
                            fontSize: '0.85rem',
                            fontWeight: '500',
                          }}
                        >
                          Upload proof image of the resolved hazard:
                        </label>

                        <input
                          type="file"
                          accept="image/*"
                          onChange={(event) =>
                            setProofFile(event.target.files[0])
                          }
                          style={{
                            color: '#9ca3af',
                            fontSize: '0.8rem',
                          }}
                        />

                        <div
                          style={{
                            display: 'flex',
                            gap: '0.5rem',
                            justifyContent: 'flex-end',
                          }}
                        >
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
                            }}
                          >
                            Cancel
                          </button>

                          <button
                            onClick={() =>
                              handleResolveIncident(incidentId)
                            }
                            disabled={resolvingLoading}
                            style={{
                              padding: '0.35rem 0.75rem',
                              backgroundColor: '#10b981',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontWeight: 'bold',
                            }}
                          >
                            {resolvingLoading
                              ? 'Resolving...'
                              : 'Confirm Resolution'}
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
                        }}
                      >
                        Mark as Resolved & Upload Proof
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