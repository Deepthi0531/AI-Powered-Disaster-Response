import { useEffect, useRef, useState } from 'react';
import API from '../api/axios';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

function getDistanceKm(lat1, lon1, lat2, lon2) {
  const earthRadius = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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

export default function Alerts() {
  const [incidents, setIncidents] = useState([]);
  const [nearbyIncidents, setNearbyIncidents] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [locationStatus, setLocationStatus] = useState(
    'Fetching live location...'
  );
  const [addressMap, setAddressMap] = useState({});

  const [resolvingId, setResolvingId] = useState(null);
  const [proofFile, setProofFile] = useState(null);
  const [resolvingLoading, setResolvingLoading] = useState(false);

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const centerMarkerRef = useRef(null);

  // Stores incident map markers by incident id.
  const incidentMarkersRef = useRef({});

  const BACKEND_BASE_URL = 'http://127.0.0.1:5000';

  const formatDateTime = (rawDate) => {
    if (!rawDate) return 'Recently';

    const dateObj = new Date(rawDate);

    if (Number.isNaN(dateObj.getTime())) return 'Recently';

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

  const fetchAddressName = async (incident) => {
    const id = incident._id || incident.id;

    // New incidents already have the address saved in MongoDB.
    if (incident.location_name) {
      setAddressMap((previous) => ({
        ...previous,
        [id]: incident.location_name,
      }));
      return;
    }

    const coordinates = incident.location?.coordinates;

    if (!coordinates || coordinates.length < 2) return;

    const lat = coordinates[1];
    const lon = coordinates[0];

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`
      );

      const data = await response.json();

      if (data?.address) {
        const {
          city,
          town,
          village,
          suburb,
          neighbourhood,
          county,
          state_district,
        } = data.address;

        const area =
          suburb ||
          neighbourhood ||
          city ||
          town ||
          village ||
          county ||
          state_district ||
          'Unknown Area';

        const cityName = city || town || village || state_district || '';

        const displayName =
          cityName && area !== cityName ? `${area}, ${cityName}` : area;

        setAddressMap((previous) => ({
          ...previous,
          [id]: displayName,
        }));
      }
    } catch (error) {
      console.warn('Could not retrieve location address:', error);
    }
  };

  const fetchIncidents = () => {
    setLoading(true);

    API.get('/incidents/verified')
      .then((response) => {
        const data = response.data.data || [];

        setIncidents(data);
        data.forEach((incident) => fetchAddressName(incident));
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
        'Location is unavailable. Click the map to choose an area.'
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
          'Showing incidents within 15 km of your location.'
        );
      },
      () => {
        setLocationStatus(
          'Location access denied. Click the map to choose an area.'
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
      }
    );
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const defaultLat = userLocation?.lat || 12.3712;
    const defaultLng = userLocation?.lng || 76.5851;

    if (!mapRef.current) {
      const map = L.map(mapContainerRef.current).setView(
        [defaultLat, defaultLng],
        11
      );

      L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 19,
        }
      ).addTo(map);

      map.on('click', (event) => {
        const { lat, lng } = event.latlng;

        setUserLocation({
          lat: Number(lat.toFixed(6)),
          lng: Number(lng.toFixed(6)),
        });

        setLocationStatus(
          'Showing incidents within 15 km of the selected map point.'
        );
      });

      mapRef.current = map;
    }

    const map = mapRef.current;

    if (userLocation) {
      const position = [userLocation.lat, userLocation.lng];

      if (centerMarkerRef.current) {
        centerMarkerRef.current.setLatLng(position);
      } else {
        centerMarkerRef.current = L.marker(position, {
          icon: customBluePinIcon,
          draggable: true,
        }).addTo(map);

        centerMarkerRef.current.bindPopup(
          '<b>Selected Location</b>'
        );

        centerMarkerRef.current.on('dragend', (event) => {
          const newPosition = event.target.getLatLng();

          setUserLocation({
            lat: Number(newPosition.lat.toFixed(6)),
            lng: Number(newPosition.lng.toFixed(6)),
          });

          setLocationStatus(
            'Showing incidents within 15 km of the selected map point.'
          );
        });
      }

      map.setView(position, 11);
    }
  }, [userLocation]);

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
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

        if (!coordinates || coordinates.length < 2) return null;

        const distance = getDistanceKm(
          userLocation.lat,
          userLocation.lng,
          coordinates[1],
          coordinates[0]
        );

        return {
          ...incident,
          distanceKm: distance,
        };
      })
      .filter(
        (incident) =>
          incident &&
          incident.distanceKm <= 15
      )
      .sort((first, second) => first.distanceKm - second.distanceKm);

    setNearbyIncidents(filteredIncidents);

    const map = mapRef.current;

    if (!map) return;

    Object.values(incidentMarkersRef.current).forEach((marker) => {
      marker.remove();
    });

    incidentMarkersRef.current = {};

    filteredIncidents.forEach((incident) => {
      const incidentId = incident._id || incident.id;
      const coordinates = incident.location?.coordinates;

      if (!coordinates || coordinates.length < 2) return;

      const marker = L.circleMarker(
        [coordinates[1], coordinates[0]],
        {
          radius: 8,
          fillColor: '#ef4444',
          color: '#ffffff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.8,
        }
      ).addTo(map);

      marker.bindPopup(
        `<b>${incident.type || 'Hazard Report'}</b><br/>` +
        `${incident.distanceKm.toFixed(1)} km away`
      );

      incidentMarkersRef.current[incidentId] = marker;
    });
  }, [incidents, userLocation]);

  // Clicking an address focuses the already visible Leaflet map.
  const focusIncidentOnMap = (incident) => {
    const incidentId = incident._id || incident.id;
    const coordinates = incident.location?.coordinates;

    if (!coordinates || coordinates.length < 2 || !mapRef.current) {
      alert('Map location is unavailable for this incident.');
      return;
    }

    const lat = coordinates[1];
    const lng = coordinates[0];

    mapRef.current.setView([lat, lng], 16, {
      animate: true,
    });

    const marker = incidentMarkersRef.current[incidentId];

    if (marker) {
      marker.openPopup();
    }

    mapContainerRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  };

  const handleResolveIncident = async (incidentId) => {
    if (!proofFile) {
      alert(
        'Please select a clear proof image showing that the incident is resolved.'
      );
      return;
    }

    const formData = new FormData();
    formData.append('proof_image', proofFile);

    setResolvingLoading(true);

    try {
      const response = await API.post(
        `/incidents/resolve/${incidentId}`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      const result = response.data;

      alert(
        result.message ||
        'Computer vision accepted the proof. Incident resolved.'
      );

      setResolvingId(null);
      setProofFile(null);

      // CV approved only: remove the now-resolved incident from active alerts.
      if (result.resolved) {
        setIncidents((previous) =>
          previous.filter(
            (incident) =>
              (incident._id || incident.id) !== incidentId
          )
        );
      }
    } catch (error) {
      const result = error.response?.data;

      // CV rejected or uncertain image: keep incident active.
      alert(
        result?.message ||
        'Computer vision could not verify this proof image.'
      );

      setProofFile(null);
    } finally {
      setResolvingLoading(false);
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
        <h1
          style={{
            color: '#fff',
            margin: '0.5rem 0',
          }}
        >
          Emergency Alerts
        </h1>

        <small
          style={{
            color: '#6b7280',
            display: 'block',
            marginTop: '0.5rem',
          }}
        >
          {locationStatus}
        </small>
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
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
            marginBottom: '0.75rem',
          }}
        >
          <label
            style={{
              color: '#fff',
              fontWeight: '600',
              fontSize: '0.95rem',
            }}
          >
            📍 Interactive Filter Map (Click anywhere to search 15 km area):
          </label>

          {userLocation && (
            <button
              onClick={() => {
                navigator.geolocation?.getCurrentPosition(
                  (position) => {
                    setUserLocation({
                      lat: position.coords.latitude,
                      lng: position.coords.longitude,
                    });

                    setLocationStatus(
                      'Showing incidents within 15 km of your location.'
                    );
                  }
                );
              }}
              style={{
                backgroundColor: '#374151',
                color: '#e5e7eb',
                border: 'none',
                padding: '0.35rem 0.75rem',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.8rem',
                whiteSpace: 'nowrap',
              }}
            >
              Reset to Current Location
            </button>
          )}
        </div>

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
        <h2
          style={{
            color: '#fff',
            marginBottom: '1rem',
          }}
        >
          Nearby Reported Incidents ({nearbyIncidents.length})
        </h2>

        {loading ? (
          <p style={{ color: '#9ca3af' }}>
            Loading live incident reports...
          </p>
        ) : nearbyIncidents.length === 0 ? (
          <p style={{ color: '#53b889' }}>
            No severe incidents reported within 15 km of your selected location.
          </p>
        ) : (
          <div
            style={{
              display: 'grid',
              gap: '1rem',
            }}
          >
            {nearbyIncidents.map((incident) => {
              const incidentId = incident._id || incident.id;

              const borderLeftColor =
                incident.severity === 'High' ||
                incident.type?.toLowerCase().includes('flood')
                  ? '#ef6a55'
                  : incident.severity === 'Medium'
                    ? '#e6b84b'
                    : '#2574e8';

              const imageSrc = incident.image_url
                ? incident.image_url.startsWith('http')
                  ? incident.image_url
                  : `${BACKEND_BASE_URL}/${incident.image_url}`
                : null;

              const locationDisplay =
                addressMap[incidentId] ||
                incident.location_name ||
                incident.address ||
                'Location unavailable';

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
                  <div
                    style={{
                      display: 'flex',
                      gap: '1.25rem',
                      flexWrap: 'wrap',
                    }}
                  >
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

                    <div
                      style={{
                        flex: 1,
                        minWidth: '240px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '1rem',
                        }}
                      >
                        <h3
                          style={{
                            color: '#fff',
                            margin: 0,
                          }}
                        >
                          {incident.type || 'Hazard Report'}
                        </h3>

                        {incident.distanceKm !== undefined && (
                          <span
                            style={{
                              backgroundColor: '#374151',
                              color: '#67d5c7',
                              padding: '0.2rem 0.6rem',
                              borderRadius: '4px',
                              fontSize: '0.85rem',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {incident.distanceKm.toFixed(1)} km away
                          </span>
                        )}
                      </div>

                      <p
                        style={{
                          color: '#d1d5db',
                          margin: '0.5rem 0',
                        }}
                      >
                        {incident.description ||
                          'Verified citizen incident report near your area.'}
                      </p>

                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns:
                            'repeat(auto-fit, minmax(180px, 1fr))',
                          gap: '0.5rem',
                          marginTop: '0.75rem',
                          fontSize: '0.85rem',
                          color: '#9ca3af',
                          borderTop: '1px solid #374151',
                          paddingTop: '0.5rem',
                        }}
                      >
                        <div>
                          <strong style={{ color: '#e5e7eb' }}>
                            📍 Location:
                          </strong>{' '}

                          <button
                            type="button"
                            onClick={() => focusIncidentOnMap(incident)}
                            title="Show this incident on the map"
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              color: '#93c5fd',
                              cursor: 'pointer',
                              textDecoration: 'underline',
                              fontSize: '0.85rem',
                            }}
                          >
                            {locationDisplay}
                          </button>
                        </div>

                        <div>
                          <strong style={{ color: '#e5e7eb' }}>
                            📅 Date & Time:
                          </strong>{' '}
                          {formatDateTime(
                            incident.created_at || incident.createdAt
                          )}
                        </div>

                        <div>
                          <strong style={{ color: '#e5e7eb' }}>
                            ⚡ Status:
                          </strong>{' '}
                          <span
                            style={{
                              color: '#f59e0b',
                              fontWeight: '600',
                            }}
                          >
                            Active / Unresolved
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'flex-end',
                      borderTop: '1px solid #2d3748',
                      paddingTop: '0.75rem',
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
                          maxWidth: '420px',
                        }}
                      >
                        <label
                          style={{
                            color: '#d1d5db',
                            fontSize: '0.85rem',
                            fontWeight: '500',
                          }}
                        >
                          Upload a clear proof image of the resolved hazard.
                        </label>

                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={(event) => {
                            setProofFile(event.target.files[0]);
                          }}
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
                            marginTop: '0.25rem',
                          }}
                        >
                          <button
                            type="button"
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
                            type="button"
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
                              opacity: resolvingLoading ? 0.6 : 1,
                            }}
                          >
                            {resolvingLoading
                              ? 'Checking with CV...'
                              : 'Upload & Verify Proof'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setResolvingId(incidentId);
                          setProofFile(null);
                        }}
                        style={{
                          backgroundColor: '#059669',
                          color: '#fff',
                          border: 'none',
                          padding: '0.5rem 1rem',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontWeight: '600',
                          fontSize: '0.85rem',
                        }}
                      >
                        ✓ Mark as Resolved & Upload Proof
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