import React, { useContext, useEffect, useState } from 'react';
import API from '../api/axios';
import { AuthContext } from '../context/AuthContext';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const ADMIN_GATE_PASSCODE = 'admin123';

const cardStyle = {
  border: '1px solid #ccc',
  padding: '15px',
  borderRadius: '8px',
  width: '180px',
  textAlign: 'center',
};

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

function LocationPicker({ onLocationSelect }) {
  useMapEvents({
    click(event) {
      onLocationSelect(event.latlng.lat, event.latlng.lng);
    },
  });

  return null;
}

export default function AdminDashboard() {
  const { user } = useContext(AuthContext);

  const [activeTab, setActiveTab] = useState('dashboard');
  const [stats, setStats] = useState({
    total_incidents: 0,
    pending_incidents: 0,
    verified_incidents: 0,
    total_shelters: 0,
  });

  const [incidents, setIncidents] = useState([]);
  const [shelters, setShelters] = useState([]);
  const [passcode, setPasscode] = useState('');
  const [isVerified, setIsVerified] = useState(false);
  const [verificationError, setVerificationError] = useState('');

  const [newShelter, setNewShelter] = useState({
    name: '',
    lat: '',
    lng: '',
    total_capacity: '',
    contact: '',
  });

  useEffect(() => {
    if (isVerified) {
      fetchStats();
      fetchIncidents();
      fetchShelters();
    }
  }, [isVerified]);

  const fetchStats = async () => {
    try {
      const response = await API.get('/admin/stats');
      setStats(response.data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const fetchIncidents = async () => {
    try {
      const response = await API.get('/admin/incidents');
      setIncidents(response.data);
    } catch (error) {
      console.error('Error fetching incidents:', error);
    }
  };

  const fetchShelters = async () => {
    try {
      const response = await API.get('/admin/shelters');
      setShelters(response.data);
    } catch (error) {
      console.error('Error fetching shelters:', error);
    }
  };

  const handlePasscodeSubmit = (event) => {
    event.preventDefault();

    if (passcode === ADMIN_GATE_PASSCODE) {
      setIsVerified(true);
      setVerificationError('');
    } else {
      setVerificationError('Invalid admin passcode. Please try again.');
    }
  };

  const handleVerifyIncident = async (id, status) => {
    try {
      await API.patch(`/admin/incidents/${id}/verify`, { status });
      fetchIncidents();
      fetchStats();
    } catch (error) {
      console.error('Error updating incident status:', error);
      alert('Unable to update incident status.');
    }
  };

  const handleMapClick = (lat, lng) => {
    setNewShelter((previous) => ({
      ...previous,
      lat: lat.toFixed(6),
      lng: lng.toFixed(6),
    }));
  };

  const handleAddShelter = async (event) => {
    event.preventDefault();

    try {
      await API.post('/admin/shelters', {
        ...newShelter,
        lat: parseFloat(newShelter.lat),
        lng: parseFloat(newShelter.lng),
        total_capacity: parseInt(newShelter.total_capacity, 10),
      });

      setNewShelter({
        name: '',
        lat: '',
        lng: '',
        total_capacity: '',
        contact: '',
      });

      fetchShelters();
      fetchStats();
      alert('Shelter successfully registered!');
    } catch (error) {
      console.error('Error adding shelter:', error);
      alert('Unable to add shelter.');
    }
  };

  const formatReportedDateTime = (dateValue) => {
    if (!dateValue) {
      return 'Date unavailable';
    }

    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
      return 'Date unavailable';
    }

    return date.toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      hour12: true,
    });
  };

  if (!isVerified) {
    return (
      <div
        style={{
          maxWidth: '420px',
          margin: '80px auto',
          padding: '32px',
          textAlign: 'center',
          boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
          borderRadius: '10px',
          backgroundColor: '#ffffff',
          color: '#111827',
        }}
      >
        <h2>Admin Verification</h2>
        <p>Enter the admin passcode to unlock the control tower.</p>

        {verificationError && (
          <div style={{ margin: '16px 0', color: '#b00020' }}>
            {verificationError}
          </div>
        )}

        <form
          onSubmit={handlePasscodeSubmit}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <input
            type="password"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            placeholder="Admin passcode"
            style={{
              padding: '12px',
              borderRadius: '6px',
              border: '1px solid #ccc',
            }}
            required
          />

          <button
            type="submit"
            style={{
              padding: '12px',
              borderRadius: '6px',
              backgroundColor: '#007bff',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Unlock Admin Dashboard
          </button>
        </form>
      </div>
    );
  }

  const parsedLat = parseFloat(newShelter.lat) || 20.5937;
  const parsedLng = parseFloat(newShelter.lng) || 78.9629;

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h2>Admin Control Tower</h2>

      <p style={{ marginTop: '8px' }}>
        Welcome back, {user?.username || user?.name || 'Admin'}.
      </p>

      <div
        style={{
          marginBottom: '20px',
          display: 'flex',
          gap: '10px',
          flexWrap: 'wrap',
        }}
      >
        <button onClick={() => setActiveTab('dashboard')}>
          Dashboard
        </button>

        <button onClick={() => setActiveTab('incidents')}>
          Verify Incidents
        </button>

        <button onClick={() => setActiveTab('shelters')}>
          Manage Shelters
        </button>
      </div>

      <hr />

      {activeTab === 'dashboard' && (
        <div>
          <h3>Overview Stats</h3>

          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            <div style={cardStyle}>
              <h4>Total Incidents</h4>
              <p>{stats.total_incidents}</p>
            </div>

            <div style={cardStyle}>
              <h4>Pending Verification</h4>
              <p>{stats.pending_incidents}</p>
            </div>

            <div style={cardStyle}>
              <h4>Verified Incidents</h4>
              <p>{stats.verified_incidents}</p>
            </div>

            <div style={cardStyle}>
              <h4>Active Shelters</h4>
              <p>{stats.total_shelters}</p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'incidents' && (
        <div>
          <h3>Incident Verification and Computer Vision Checks</h3>

          {incidents.length === 0 ? (
            <p>No incidents have been reported yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table
                border="1"
                cellPadding="10"
                style={{
                  width: '100%',
                  minWidth: '1200px',
                  borderCollapse: 'collapse',
                }}
              >
                <thead>
                  <tr>
                    <th>Image</th>
                    <th>Type</th>
                    <th>Location</th>
                    <th>Reported Date & Time</th>
                    <th>Upcount</th>
                    <th>Community Confidence</th>
                    <th>Computer Vision Result</th>
                    <th>Confidence</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {incidents.map((incident) => {
                    const imageUrl = incident.image_url
                      ? `http://localhost:5000/${incident.image_url}`
                      : null;

                    const labels =
                      incident.cv_verification?.detected_labels || [];

                    const confidence =
                      incident.cv_verification?.confidence_score;

                    const upcount = incident.upcount ?? 1;

                    const communityConfidence =
                      incident.community_confidence || 'Low';

                    return (
                      <tr key={incident._id}>
                        <td>
                          {imageUrl ? (
                            <img
                              src={imageUrl}
                              alt="Incident"
                              width="80"
                              height="60"
                              style={{ objectFit: 'cover' }}
                            />
                          ) : (
                            'No Image'
                          )}
                        </td>

                        <td>{incident.type || 'N/A'}</td>

                        <td style={{ maxWidth: '260px' }}>
                          {incident.location_name ||
                            'Location unavailable'}
                        </td>

                        <td>
                          {formatReportedDateTime(
                            incident.created_at
                          )}
                        </td>

                        <td>
                          <strong>{upcount}</strong>
                        </td>

                        <td>
                          <strong>{communityConfidence}</strong>

                          {upcount >= 4 && (
                            <div
                              style={{
                                marginTop: '4px',
                                fontSize: '12px',
                              }}
                            >
                              High chance confirmed by citizens
                            </div>
                          )}

                          {upcount >= 2 && upcount < 4 && (
                            <div
                              style={{
                                marginTop: '4px',
                                fontSize: '12px',
                              }}
                            >
                              Multiple citizen reports
                            </div>
                          )}
                        </td>

                        <td>
                          <strong>
                            {incident.cv_verification?.model ||
                              'Computer Vision Classifier'}
                          </strong>
                          <br />

                          {labels.length > 0
                            ? labels.join(', ')
                            : 'No result available'}
                        </td>

                        <td>
                          {confidence !== undefined
                            ? `${(confidence * 100).toFixed(1)}%`
                            : 'N/A'}
                        </td>

                        <td>{incident.status}</td>

                        <td>
                          {incident.status === 'PENDING' && (
                            <>
                              <button
                                onClick={() =>
                                  handleVerifyIncident(
                                    incident._id,
                                    'VERIFIED'
                                  )
                                }
                                style={{
                                  backgroundColor: 'green',
                                  color: 'white',
                                  marginRight: '5px',
                                  padding: '5px 10px',
                                  cursor: 'pointer',
                                }}
                              >
                                Approve
                              </button>

                              <button
                                onClick={() =>
                                  handleVerifyIncident(
                                    incident._id,
                                    'REJECTED'
                                  )
                                }
                                style={{
                                  backgroundColor: 'red',
                                  color: 'white',
                                  padding: '5px 10px',
                                  cursor: 'pointer',
                                }}
                              >
                                Reject
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'shelters' && (
        <div>
          <h3>Add and Manage Shelters</h3>

          <div
            style={{
              display: 'flex',
              gap: '20px',
              flexWrap: 'wrap',
              marginBottom: '25px',
            }}
          >
            <form
              onSubmit={handleAddShelter}
              style={{
                flex: '1 1 300px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <input
                placeholder="Shelter Name"
                value={newShelter.name}
                onChange={(event) =>
                  setNewShelter({
                    ...newShelter,
                    name: event.target.value,
                  })
                }
                required
              />

              <input
                type="number"
                step="any"
                placeholder="Latitude"
                value={newShelter.lat}
                onChange={(event) =>
                  setNewShelter({
                    ...newShelter,
                    lat: event.target.value,
                  })
                }
                required
              />

              <input
                type="number"
                step="any"
                placeholder="Longitude"
                value={newShelter.lng}
                onChange={(event) =>
                  setNewShelter({
                    ...newShelter,
                    lng: event.target.value,
                  })
                }
                required
              />

              <input
                placeholder="Total Capacity"
                type="number"
                value={newShelter.total_capacity}
                onChange={(event) =>
                  setNewShelter({
                    ...newShelter,
                    total_capacity: event.target.value,
                  })
                }
                required
              />

              <input
                placeholder="Contact Info"
                value={newShelter.contact}
                onChange={(event) =>
                  setNewShelter({
                    ...newShelter,
                    contact: event.target.value,
                  })
                }
              />

              <button
                type="submit"
                style={{ cursor: 'pointer', padding: '8px' }}
              >
                Add Shelter
              </button>
            </form>

            <div
              style={{
                flex: '1 1 400px',
                height: '300px',
                borderRadius: '8px',
                overflow: 'hidden',
              }}
            >
              <p
                style={{
                  margin: '0 0 6px 0',
                  fontSize: '14px',
                  fontWeight: 'bold',
                }}
              >
                Click on map to pin coordinates:
              </p>

              <MapContainer
                center={[parsedLat, parsedLng]}
                zoom={5}
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

                <LocationPicker onLocationSelect={handleMapClick} />

                {newShelter.lat && newShelter.lng && (
                  <Marker
                    position={[
                      parseFloat(newShelter.lat),
                      parseFloat(newShelter.lng),
                    ]}
                  />
                )}
              </MapContainer>
            </div>
          </div>

          <h4>Registered Shelters</h4>

          <ul>
            {shelters.map((shelter) => (
              <li key={shelter._id} style={{ marginBottom: '10px' }}>
                <strong>{shelter.name}</strong> — Capacity:{' '}
                {shelter.total_capacity} beds
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}