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

// Fix Leaflet marker icon rendering issues in React
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Interactive map click handler
function LocationPicker({ onLocationSelect }) {
  useMapEvents({
    click(e) {
      onLocationSelect(e.latlng.lat, e.latlng.lng);
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

  // const [alertForm, setAlertForm] = useState({
  //   region: '',
  //   severity: 'CRITICAL',
  //   message: '',
  // });

  useEffect(() => {
    if (isVerified) {
      fetchStats();
      fetchIncidents();
      fetchShelters();
    }
  }, [isVerified]);

  const fetchStats = async () => {
    try {
      const res = await API.get('/admin/stats');
      setStats(res.data);
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  };

  const fetchIncidents = async () => {
    try {
      const res = await API.get('/admin/incidents');
      setIncidents(res.data);
    } catch (err) {
      console.error('Error fetching incidents:', err);
    }
  };

  const fetchShelters = async () => {
    try {
      const res = await API.get('/admin/shelters');
      setShelters(res.data);
    } catch (err) {
      console.error('Error fetching shelters:', err);
    }
  };

  const handlePasscodeSubmit = (e) => {
    e.preventDefault();

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
    } catch (err) {
      console.error('Error updating incident status:', err);
      alert('Unable to update incident status.');
    }
  };

  // Maps click coordinates directly to state
  const handleMapClick = (lat, lng) => {
    setNewShelter((prev) => ({
      ...prev,
      lat: lat.toFixed(6),
      lng: lng.toFixed(6),
    }));
  };

  const handleAddShelter = async (e) => {
    e.preventDefault();

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
    } catch (err) {
      console.error('Error adding shelter:', err);
      alert('Unable to add shelter.');
    }
  };

  const handleSendAlert = async (e) => {
    e.preventDefault();

    try {
      await API.post('/admin/alerts/broadcast', alertForm);

      alert('Emergency alert broadcasted successfully.');

      setAlertForm({
        region: '',
        severity: 'CRITICAL',
        message: '',
      });
    } catch (err) {
      console.error('Error broadcasting alert:', err);
      alert('Unable to broadcast alert.');
    }
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
          style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
        >
          <input
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
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

      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button onClick={() => setActiveTab('dashboard')}>Dashboard</button>
        <button onClick={() => setActiveTab('incidents')}>Verify Incidents</button>
        <button onClick={() => setActiveTab('shelters')}>Manage Shelters</button>
        {/* <button onClick={() => setActiveTab('alerts')}>Emergency Broadcast</button> */}
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
          <h3>Incident Verification and YOLO Image Checks</h3>

          {incidents.length === 0 ? (
            <p>No incidents have been reported yet.</p>
          ) : (
            <table
              border="1"
              cellPadding="10"
              style={{ width: '100%', borderCollapse: 'collapse' }}
            >
              <thead>
                <tr>
                  <th>Image</th>
                  <th>Type</th>
                  <th>Location</th>
                  <th>Upcount</th>
                  <th>Community Confidence</th>
                  <th>YOLO Detection</th>
                  <th>Confidence</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {incidents.map((inc) => {
                  const coords = inc.location?.coordinates || [];
                  const lat = coords[1] ?? 'N/A';
                  const lng = coords[0] ?? 'N/A';

                  const imgUrl = inc.image_url
                    ? `http://localhost:5000/${inc.image_url}`
                    : null;

                  const labels = inc.cv_verification?.detected_labels || [];
const confidence = inc.cv_verification?.confidence_score;

const upcount = inc.upcount ?? 1;
const communityConfidence = inc.community_confidence || 'Low';

                  return (
                    <tr key={inc._id}>
                      <td>
                        {imgUrl ? (
                          <img
                            src={imgUrl}
                            alt="Incident"
                            width="80"
                            height="60"
                            style={{ objectFit: 'cover' }}
                          />
                        ) : (
                          'No Image'
                        )}
                      </td>

                      <td>{inc.type || 'N/A'}</td>

                      <td>
  {lat}, {lng}
</td>

<td>
  <strong>{upcount}</strong>
</td>

<td>
  <strong>{communityConfidence}</strong>

  {upcount >= 4 && (
    <div style={{ marginTop: '4px', fontSize: '12px' }}>
      High chance confirmed by citizens
    </div>
  )}

  {upcount >= 2 && upcount < 4 && (
    <div style={{ marginTop: '4px', fontSize: '12px' }}>
      Multiple citizen reports
    </div>
  )}
</td>

<td>
  <strong>{inc.cv_verification?.model || 'YOLOv8n'}</strong>
                        <br />
                        {labels.length > 0 ? labels.join(', ') : 'No objects detected'}
                      </td>

                      <td>
                        {confidence !== undefined
                          ? `${(confidence * 100).toFixed(1)}%`
                          : 'N/A'}
                      </td>

                      <td>{inc.status}</td>

                      <td>
                        {inc.status === 'PENDING' && (
                          <>
                            <button
                              onClick={() =>
                                handleVerifyIncident(inc._id, 'VERIFIED')
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
                                handleVerifyIncident(inc._id, 'REJECTED')
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
          )}
        </div>
      )}

      {activeTab === 'shelters' && (
        <div>
          <h3>Add and Manage Shelters</h3>

          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '25px' }}>
            {/* Form Container */}
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
                onChange={(e) =>
                  setNewShelter({ ...newShelter, name: e.target.value })
                }
                required
              />

              <input
                type="number"
                step="any"
                placeholder="Latitude"
                value={newShelter.lat}
                onChange={(e) =>
                  setNewShelter({ ...newShelter, lat: e.target.value })
                }
                required
              />

              <input
                type="number"
                step="any"
                placeholder="Longitude"
                value={newShelter.lng}
                onChange={(e) =>
                  setNewShelter({ ...newShelter, lng: e.target.value })
                }
                required
              />

              <input
                placeholder="Total Capacity"
                type="number"
                value={newShelter.total_capacity}
                onChange={(e) =>
                  setNewShelter({
                    ...newShelter,
                    total_capacity: e.target.value,
                  })
                }
                required
              />

              <input
                placeholder="Contact Info"
                value={newShelter.contact}
                onChange={(e) =>
                  setNewShelter({ ...newShelter, contact: e.target.value })
                }
              />

              <button type="submit" style={{ cursor: 'pointer', padding: '8px' }}>
                Add Shelter
              </button>
            </form>

            {/* Map Selection Component */}
            <div style={{ flex: '1 1 400px', height: '300px', borderRadius: '8px', overflow: 'hidden' }}>
              <p style={{ margin: '0 0 6px 0', fontSize: '14px', fontWeight: 'bold' }}>
                Click on map to pin coordinates:
              </p>
              <MapContainer center={[parsedLat, parsedLng]} zoom={5} style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <LocationPicker onLocationSelect={handleMapClick} />
                {newShelter.lat && newShelter.lng && (
                  <Marker position={[parseFloat(newShelter.lat), parseFloat(newShelter.lng)]} />
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

      {activeTab === 'alerts' && (
        <div>
          <h3>Broadcast Emergency Alert</h3>

          <form
            onSubmit={handleSendAlert}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              maxWidth: '400px',
            }}
          >
            <input
              placeholder="Target Region (example: Mysuru)"
              value={alertForm.region}
              onChange={(e) =>
                setAlertForm({ ...alertForm, region: e.target.value })
              }
              required
            />

            <select
              value={alertForm.severity}
              onChange={(e) =>
                setAlertForm({ ...alertForm, severity: e.target.value })
              }
            >
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High Risk</option>
              <option value="MODERATE">Moderate Risk</option>
            </select>

            <textarea
              placeholder="Alert message for citizens"
              value={alertForm.message}
              onChange={(e) =>
                setAlertForm({ ...alertForm, message: e.target.value })
              }
              required
            />

            <button
              type="submit"
              style={{
                backgroundColor: 'red',
                color: 'white',
                padding: '10px',
                cursor: 'pointer',
              }}
            >
              Broadcast Alert
            </button>
          </form>
        </div>
      )}
    </div>
  );
}