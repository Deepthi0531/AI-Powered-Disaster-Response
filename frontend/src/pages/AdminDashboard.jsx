import React, { useContext, useEffect, useState } from 'react';
import API from '../api/axios';
import { AuthContext } from '../context/AuthContext';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const ADMIN_GATE_PASSCODE = 'admin123';
const FILE_BASE_URL = 'http://localhost:5000';

// Same palette as before: #007bff, green, red, #ccc, #111827, white.
const COLORS = {
  blue: '#007bff',
  green: 'green',
  red: 'red',
  border: '#ccc',
  ink: '#111827',
  white: '#ffffff',
  muted: '#6b7280',
  surface: '#f5f6f8',
};

const s = {
  page: {
    fontFamily: 'Arial, sans-serif',
    color: COLORS.ink,
    backgroundColor: COLORS.surface,
    minHeight: '100vh',
  },
  header: {
    backgroundColor: COLORS.ink,
    color: COLORS.white,
    padding: '16px 28px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '8px',
  },
  headerTitle: { margin: 0, fontSize: '20px', letterSpacing: '0.5px' },
  headerSub: { margin: '4px 0 0', fontSize: '13px', opacity: 0.8 },
  body: { padding: '24px 28px' },
  tabBar: {
    display: 'flex',
    gap: '4px',
    flexWrap: 'wrap',
    borderBottom: `2px solid ${COLORS.border}`,
    marginBottom: '24px',
  },
  tab: (active) => ({
    padding: '10px 18px',
    border: 'none',
    borderBottom: active ? `3px solid ${COLORS.blue}` : '3px solid transparent',
    backgroundColor: 'transparent',
    color: active ? COLORS.blue : COLORS.ink,
    fontWeight: active ? 'bold' : 'normal',
    fontSize: '14px',
    cursor: 'pointer',
    marginBottom: '-2px',
  }),
  tabCount: {
    marginLeft: '8px',
    padding: '1px 8px',
    borderRadius: '10px',
    backgroundColor: COLORS.red,
    color: COLORS.white,
    fontSize: '12px',
  },
  sectionTitle: { margin: '0 0 4px', fontSize: '18px' },
  sectionHint: { margin: '0 0 16px', fontSize: '13px', color: COLORS.muted },
  statGrid: { display: 'flex', gap: '16px', flexWrap: 'wrap' },
  statCard: {
    flex: '1 1 180px',
    maxWidth: '230px',
    backgroundColor: COLORS.white,
    border: `1px solid ${COLORS.border}`,
    borderTop: `4px solid ${COLORS.blue}`,
    borderRadius: '6px',
    padding: '16px',
  },
  statLabel: {
    margin: 0,
    fontSize: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.6px',
    color: COLORS.muted,
  },
  statValue: { margin: '8px 0 0', fontSize: '30px', fontWeight: 'bold' },
  panel: {
    backgroundColor: COLORS.white,
    border: `1px solid ${COLORS.border}`,
    borderRadius: '6px',
    padding: '16px',
  },
  tableWrap: {
    overflowX: 'auto',
    backgroundColor: COLORS.white,
    border: `1px solid ${COLORS.border}`,
    borderRadius: '6px',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th: {
    textAlign: 'left',
    padding: '12px 10px',
    backgroundColor: COLORS.ink,
    color: COLORS.white,
    fontSize: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '12px 10px',
    borderBottom: `1px solid ${COLORS.border}`,
    verticalAlign: 'top',
  },
  badge: (color) => ({
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: '12px',
    border: `1px solid ${color}`,
    color,
    fontSize: '12px',
    fontWeight: 'bold',
    whiteSpace: 'nowrap',
  }),
  note: {
    marginTop: '6px',
    padding: '4px 8px',
    borderLeft: `3px solid ${COLORS.blue}`,
    backgroundColor: COLORS.surface,
    fontSize: '12px',
  },
  small: { fontSize: '12px', color: COLORS.muted, marginTop: '4px' },
  btn: (color) => ({
    backgroundColor: color,
    color: COLORS.white,
    border: 'none',
    borderRadius: '4px',
    padding: '6px 12px',
    marginRight: '6px',
    cursor: 'pointer',
    fontSize: '13px',
  }),
  input: {
    padding: '10px',
    borderRadius: '4px',
    border: `1px solid ${COLORS.border}`,
    fontSize: '14px',
  },
  select: {
    padding: '8px',
    borderRadius: '4px',
    border: `1px solid ${COLORS.border}`,
    fontSize: '13px',
  },
  thumb: {
    objectFit: 'cover',
    borderRadius: '4px',
    border: `1px solid ${COLORS.border}`,
  },
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

const statusColor = (status) => {
  if (status === 'VERIFIED') return COLORS.green;
  if (status === 'REJECTED') return COLORS.red;
  if (status === 'PENDING') return COLORS.blue;
  return COLORS.muted;
};

const fileUrl = (path) => (path ? `${FILE_BASE_URL}/${path}` : null);

const percent = (value) =>
  value === undefined || value === null ? 'N/A' : `${(value * 100).toFixed(1)}%`;

export default function AdminDashboard() {
  const { user } = useContext(AuthContext);

  const [activeTab, setActiveTab] = useState('dashboard');
  const [stats, setStats] = useState({
    total_incidents: 0,
    pending_incidents: 0,
    verified_incidents: 0,
    total_shelters: 0,
    pending_resolutions: 0,
    needs_review: 0,
  });

  const [incidents, setIncidents] = useState([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [resolutionRequests, setResolutionRequests] = useState([]);
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
      fetchResolutionRequests();
    }
  }, [isVerified]);

  const fetchStats = async () => {
    try {
      const response = await API.get('/admin/stats');
      setStats((previous) => ({ ...previous, ...response.data }));
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

  const fetchResolutionRequests = async () => {
    try {
      const response = await API.get('/admin/resolution-requests');
      setResolutionRequests(response.data);
    } catch (error) {
      console.error('Error fetching resolution requests:', error);
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

  const handleResolutionDecision = async (id, action) => {
    if (
      action === 'approve' &&
      !window.confirm(
        'Approve this proof? The incident will be marked resolved and removed from the active list.'
      )
    ) {
      return;
    }

    try {
      await API.patch(`/admin/resolution-requests/${id}`, { action });
      fetchResolutionRequests();
      fetchIncidents();
      fetchStats();
    } catch (error) {
      console.error('Error deciding resolution request:', error);
      alert('Unable to update the resolution request.');
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
      <div style={{ ...s.page, paddingTop: '80px' }}>
        <div
          style={{
            maxWidth: '420px',
            margin: '0 auto',
            padding: '32px',
            textAlign: 'center',
            boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
            borderRadius: '10px',
            backgroundColor: COLORS.white,
            color: COLORS.ink,
            borderTop: `4px solid ${COLORS.blue}`,
          }}
        >
          <h2 style={{ marginTop: 0 }}>Admin Verification</h2>
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
              style={s.input}
              required
            />

            <button
              type="submit"
              style={{
                padding: '12px',
                borderRadius: '6px',
                backgroundColor: COLORS.blue,
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Unlock Admin Dashboard
            </button>
          </form>
        </div>
      </div>
    );
  }

  const parsedLat = parseFloat(newShelter.lat) || 20.5937;
  const parsedLng = parseFloat(newShelter.lng) || 78.9629;

  const visibleIncidents =
    statusFilter === 'ALL'
      ? incidents
      : incidents.filter((incident) => incident.status === statusFilter);

  const tabs = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'incidents', label: 'Verify Incidents', count: stats.pending_incidents },
    { id: 'resolutions', label: 'Resolution Requests', count: stats.pending_resolutions },
    { id: 'shelters', label: 'Manage Shelters' },
  ];

  const overviewCards = [
    { label: 'Total Incidents', value: stats.total_incidents },
    { label: 'Pending Verification', value: stats.pending_incidents },
    { label: 'Pending Resolutions', value: stats.pending_resolutions },
    { label: 'Needs Review', value: stats.needs_review },
    { label: 'Verified Incidents', value: stats.verified_incidents },
    { label: 'Active Shelters', value: stats.total_shelters },
  ];

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h2 style={s.headerTitle}>Admin Control Tower</h2>
          <p style={s.headerSub}>Disaster Response and Emergency Management</p>
        </div>

        <div style={{ fontSize: '13px' }}>
          Signed in as <strong>{user?.username || user?.name || 'Admin'}</strong>
        </div>
      </div>

      <div style={s.body}>
        <div style={s.tabBar}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={s.tab(activeTab === tab.id)}
            >
              {tab.label}
              {tab.count > 0 && <span style={s.tabCount}>{tab.count}</span>}
            </button>
          ))}
        </div>

        {activeTab === 'dashboard' && (
          <div>
            <h3 style={s.sectionTitle}>Overview</h3>
            <p style={s.sectionHint}>Live summary of incidents, reviews and shelters.</p>

            <div style={s.statGrid}>
              {overviewCards.map((card) => (
                <div key={card.label} style={s.statCard}>
                  <p style={s.statLabel}>{card.label}</p>
                  <p style={s.statValue}>{card.value ?? 0}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'incidents' && (
          <div>
            <h3 style={s.sectionTitle}>Incident Verification</h3>
            <p style={s.sectionHint}>
              Computer vision results are shown for every report. Reports it was
              not confident about wait here for your decision.
            </p>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '13px', marginRight: '8px' }}>
                Filter by status:
              </label>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                style={s.select}
              >
                <option value="ALL">All</option>
                <option value="PENDING">Pending</option>
                <option value="VERIFIED">Verified</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>

            {visibleIncidents.length === 0 ? (
              <div style={s.panel}>No incidents found.</div>
            ) : (
              <div style={s.tableWrap}>
                <table style={{ ...s.table, minWidth: '1200px' }}>
                  <thead>
                    <tr>
                      <th style={s.th}>Image</th>
                      <th style={s.th}>Type</th>
                      <th style={s.th}>Location</th>
                      <th style={s.th}>Reported</th>
                      <th style={s.th}>Upcount</th>
                      <th style={s.th}>Community Confidence</th>
                      <th style={s.th}>Computer Vision Result</th>
                      <th style={s.th}>Confidence</th>
                      <th style={s.th}>Status</th>
                      <th style={s.th}>Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {visibleIncidents.map((incident) => {
                      const imageUrl = fileUrl(incident.image_url);
                      const cv = incident.cv_verification || {};
                      const labels = cv.detected_labels || [];
                      const upcount = incident.upcount ?? 1;
                      const communityConfidence =
                        incident.community_confidence || 'Low';

                      return (
                        <tr key={incident._id}>
                          <td style={s.td}>
                            {imageUrl ? (
                              <img
                                src={imageUrl}
                                alt="Incident"
                                width="80"
                                height="60"
                                style={s.thumb}
                              />
                            ) : (
                              'No Image'
                            )}
                          </td>

                          <td style={s.td}>
                            <strong>
                              {incident.display_type || incident.type || 'N/A'}
                            </strong>
                            {incident.custom_type && (
                              <div style={s.small}>Reported as "Other"</div>
                            )}
                            {incident.photo_note && (
                              <div style={s.note}>{incident.photo_note}</div>
                            )}
                          </td>

                          <td style={{ ...s.td, maxWidth: '260px' }}>
                            {incident.location_name || 'Location unavailable'}
                          </td>

                          <td style={s.td}>
                            {formatReportedDateTime(incident.created_at)}
                          </td>

                          <td style={s.td}>
                            <strong>{upcount}</strong>
                          </td>

                          <td style={s.td}>
                            <strong>{communityConfidence}</strong>

                            {upcount >= 4 && (
                              <div style={s.small}>
                                High chance confirmed by citizens
                              </div>
                            )}

                            {upcount >= 2 && upcount < 4 && (
                              <div style={s.small}>Multiple citizen reports</div>
                            )}
                          </td>

                          <td style={s.td}>
                            <strong>
                              {cv.model || 'Computer Vision Classifier'}
                            </strong>
                            <br />
                            {labels.length > 0
                              ? labels.join(', ')
                              : 'No result available'}
                            {cv.message && <div style={s.small}>{cv.message}</div>}
                          </td>

                          <td style={s.td}>{percent(cv.confidence_score)}</td>

                          <td style={s.td}>
                            <span style={s.badge(statusColor(incident.status))}>
                              {incident.status}
                            </span>
                            {incident.resolution_pending && (
                              <div style={s.small}>Resolution under review</div>
                            )}
                          </td>

                          <td style={s.td}>
                            {incident.status === 'PENDING' && (
                              <>
                                <button
                                  onClick={() =>
                                    handleVerifyIncident(incident._id, 'VERIFIED')
                                  }
                                  style={s.btn(COLORS.green)}
                                >
                                  Approve
                                </button>

                                <button
                                  onClick={() =>
                                    handleVerifyIncident(incident._id, 'REJECTED')
                                  }
                                  style={s.btn(COLORS.red)}
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

        {activeTab === 'resolutions' && (
          <div>
            <h3 style={s.sectionTitle}>Resolution Requests</h3>
            <p style={s.sectionHint}>
              Proof photos the system could not verify on its own. Compare the
              reported photo with the proof before deciding.
            </p>

            {resolutionRequests.length === 0 ? (
              <div style={s.panel}>No resolution requests are waiting for review.</div>
            ) : (
              <div style={s.tableWrap}>
                <table style={{ ...s.table, minWidth: '1000px' }}>
                  <thead>
                    <tr>
                      <th style={s.th}>Reported Photo</th>
                      <th style={s.th}>Proof Photo</th>
                      <th style={s.th}>Incident</th>
                      <th style={s.th}>Submitted</th>
                      <th style={s.th}>Computer Vision Check</th>
                      <th style={s.th}>Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    {resolutionRequests.map((request) => {
                      const cv = request.cv || {};
                      const original = fileUrl(request.original_image_url);
                      const proof = fileUrl(request.proof_url);

                      return (
                        <tr key={request._id}>
                          <td style={s.td}>
                            {original ? (
                              <img
                                src={original}
                                alt="Reported"
                                width="120"
                                height="90"
                                style={s.thumb}
                              />
                            ) : (
                              'No Image'
                            )}
                          </td>

                          <td style={s.td}>
                            {proof ? (
                              <img
                                src={proof}
                                alt="Proof"
                                width="120"
                                height="90"
                                style={s.thumb}
                              />
                            ) : (
                              'No Image'
                            )}
                          </td>

                          <td style={s.td}>
                            <strong>{request.incident_type || 'N/A'}</strong>
                          </td>

                          <td style={s.td}>
                            {formatReportedDateTime(request.created_at)}
                          </td>

                          <td style={s.td}>
                            <div>{cv.message || 'Needs manual review'}</div>
                            <div style={s.small}>
                              Same-place match: {percent(cv.scene_similarity)}
                            </div>
                            <div style={s.small}>
                              Hazard still visible: {percent(cv.hazard_score)}
                            </div>
                            {cv.captured_at ? (
                              <div style={s.small}>
                                Photo taken: {formatReportedDateTime(cv.captured_at)}
                              </div>
                            ) : (
                              <div style={s.small}>No capture time in photo</div>
                            )}
                          </td>

                          <td style={s.td}>
                            <button
                              onClick={() =>
                                handleResolutionDecision(request._id, 'approve')
                              }
                              style={s.btn(COLORS.green)}
                            >
                              Approve
                            </button>

                            <button
                              onClick={() =>
                                handleResolutionDecision(request._id, 'reject')
                              }
                              style={s.btn(COLORS.red)}
                            >
                              Reject
                            </button>
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
            <h3 style={s.sectionTitle}>Add and Manage Shelters</h3>
            <p style={s.sectionHint}>
              Click the map to pin coordinates, then register the shelter.
            </p>

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
                  ...s.panel,
                  flex: '1 1 300px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <input
                  style={s.input}
                  placeholder="Shelter Name"
                  value={newShelter.name}
                  onChange={(event) =>
                    setNewShelter({ ...newShelter, name: event.target.value })
                  }
                  required
                />

                <input
                  style={s.input}
                  type="number"
                  step="any"
                  placeholder="Latitude"
                  value={newShelter.lat}
                  onChange={(event) =>
                    setNewShelter({ ...newShelter, lat: event.target.value })
                  }
                  required
                />

                <input
                  style={s.input}
                  type="number"
                  step="any"
                  placeholder="Longitude"
                  value={newShelter.lng}
                  onChange={(event) =>
                    setNewShelter({ ...newShelter, lng: event.target.value })
                  }
                  required
                />

                <input
                  style={s.input}
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
                  style={s.input}
                  placeholder="Contact Info"
                  value={newShelter.contact}
                  onChange={(event) =>
                    setNewShelter({ ...newShelter, contact: event.target.value })
                  }
                />

                <button
                  type="submit"
                  style={{
                    ...s.btn(COLORS.blue),
                    padding: '10px',
                    marginRight: 0,
                  }}
                >
                  Add Shelter
                </button>
              </form>

              <div
                style={{
                  flex: '1 1 400px',
                  height: '320px',
                }}
              >
                <MapContainer
                  center={[parsedLat, parsedLng]}
                  zoom={5}
                  style={{
                    height: '100%',
                    width: '100%',
                    borderRadius: '6px',
                    border: `1px solid ${COLORS.border}`,
                  }}
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

            <h4 style={{ margin: '0 0 10px' }}>Registered Shelters</h4>

            {shelters.length === 0 ? (
              <div style={s.panel}>No shelters registered yet.</div>
            ) : (
              <div style={s.tableWrap}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Name</th>
                      <th style={s.th}>Capacity</th>
                      <th style={s.th}>Available Beds</th>
                      <th style={s.th}>Contact</th>
                    </tr>
                  </thead>

                  <tbody>
                    {shelters.map((shelter) => (
                      <tr key={shelter.id || shelter._id}>
                        <td style={s.td}>
                          <strong>{shelter.name}</strong>
                        </td>
                        <td style={s.td}>
                          {shelter.total_beds ??
                            shelter.capacity ??
                            shelter.total_capacity ??
                            'N/A'}{' '}
                          beds
                        </td>
                        <td style={s.td}>{shelter.available_beds ?? 'N/A'}</td>
                        <td style={s.td}>{shelter.contact || 'N/A'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}