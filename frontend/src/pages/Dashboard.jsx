import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState, useCallback } from 'react';
import API from '../api/axios';
import ShelterCard from '../components/ShelterCard';
import AddShelterModal from '../components/AddShelterModal';

import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
});

function calculateDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return '0.0';
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
  return (R * c).toFixed(1);
}

function LiveMap({ activeLayer, incidents, shelters, selectedShelter, onShelterSelect, userCoords, onLocationChange, safeRoute }) {
  const mapElement = useRef(null);
  const mapRef = useRef(null);
  const locationMarker = useRef(null);
  const tappedMarker = useRef(null);
  const routeLayerRef = useRef(null);

  const onLocationChangeRef = useRef(onLocationChange);
  useEffect(() => {
    onLocationChangeRef.current = onLocationChange;
  }, [onLocationChange]);

  const updateLocationPoint = useCallback((lat, lng) => {
    const map = mapRef.current;
    if (!map || !map.getContainer() || !map._loaded) return;

    const point = [lat, lng];

    if (locationMarker.current) {
      locationMarker.current.setLatLng(point);
    } else {
      locationMarker.current = L.marker(point, {
        draggable: true,
        title: 'Your Location',
      })
        .addTo(map)
        .bindPopup('<b>Your Location</b><br/>Drag pin to adjust position.');

      locationMarker.current.on('dragend', (event) => {
        const newPos = event.target.getLatLng();
        if (onLocationChangeRef.current) {
          onLocationChangeRef.current(
            newPos.lat,
            newPos.lng,
            `Exact location pinned: ${newPos.lat.toFixed(5)}, ${newPos.lng.toFixed(5)}`,
            true
          );
        }
      });
    }

    if (!tappedMarker.current) {
      requestAnimationFrame(() => {
        if (mapRef.current && mapRef.current.getContainer() && mapRef.current._loaded) {
          mapRef.current.setView(point, 13);
        }
      });
    }

    if (onLocationChangeRef.current) {
      onLocationChangeRef.current(lat, lng, `GPS position updated (${lat.toFixed(4)}, ${lng.toFixed(4)})`, false);
    }
  }, []);

  useEffect(() => {
    if (!mapElement.current || mapRef.current) return;

    const initialLat = userCoords?.lat || 14.2798;
    const initialLng = userCoords?.lng || 74.4441;

    const map = L.map(mapElement.current).setView([initialLat, initialLng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;

    const handleLocationSuccess = (position) => {
      const { latitude, longitude } = position.coords;
      updateLocationPoint(latitude, longitude);
    };

    const handleLocationError = () => {
      const fallbackLat = userCoords?.lat || 14.2798;
      const fallbackLng = userCoords?.lng || 74.4441;
      if (onLocationChangeRef.current) {
        onLocationChangeRef.current(fallbackLat, fallbackLng, 'GPS unavailable. Tap map to select manual location.', false);
      }
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(handleLocationSuccess, handleLocationError, {
        enableHighAccuracy: true,
        timeout: 10000,
      });
    } else {
      handleLocationError();
    }

    const handleMapClick = (e) => {
      const { lat, lng } = e.latlng;
      if (tappedMarker.current) {
        tappedMarker.current.remove();
      }

      tappedMarker.current = L.marker([lat, lng])
        .addTo(map)
        .bindPopup(`Selected spot: ${lat.toFixed(5)}, ${lng.toFixed(5)}`)
        .openPopup();

      if (onLocationChangeRef.current) {
        onLocationChangeRef.current(lat, lng, `Selected point: ${lat.toFixed(5)}, ${lng.toFixed(5)}`, true);
      }
    };

    map.on('click', handleMapClick);

    return () => {
      map.off('click', handleMapClick);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      locationMarker.current = null;
      tappedMarker.current = null;
    };
  }, []);

  useEffect(() => {
    if (userCoords?.lat && userCoords?.lng && mapRef.current && mapRef.current._loaded) {
      updateLocationPoint(userCoords.lat, userCoords.lng);
    }
  }, [userCoords?.lat, userCoords?.lng, updateLocationPoint]);

  // Render Blue Polyline Only
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map._loaded) return;

    if (routeLayerRef.current) {
      map.removeLayer(routeLayerRef.current);
      routeLayerRef.current = null;
    }

    if (safeRoute && safeRoute.coordinates && safeRoute.coordinates.length > 0) {
      const polylineCoords = safeRoute.coordinates.map((c) => [c[1], c[0]]);
      routeLayerRef.current = L.polyline(polylineCoords, {
        color: '#2563eb', // Always Blue line
        weight: 6,
        opacity: 0.9,
        lineJoin: 'round',
      }).addTo(map);

      map.fitBounds(routeLayerRef.current.getBounds(), { padding: [40, 40] });
    }
  }, [safeRoute]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map._loaded) return;

    const layerGroup = L.layerGroup().addTo(map);

    if (activeLayer !== 'risk') {
      shelters.forEach((shelter) => {
        const shelterLat = shelter.lat;
        const shelterLng = shelter.lng || shelter.lon;
        if (!shelterLat || !shelterLng) return;

        const isSelected = selectedShelter?.id === shelter.id || selectedShelter?._id === shelter.id;
        const markerColor = shelter.is_safe ? '#53b889' : '#d94a5f';

        const circle = L.circleMarker([shelterLat, shelterLng], {
          radius: isSelected ? 12 : 8,
          color: isSelected ? '#333' : '#fff',
          weight: 2,
          fillColor: markerColor,
          fillOpacity: 0.9,
        })
          .bindTooltip(
            `<b>${shelter.name}</b><br/>ML Safety: <b>${shelter.is_safe ? 'Safe' : 'Unsafe'}</b><br/>Distance: ${shelter.distance}`
          )
          .on('click', () => onShelterSelect(shelter));
          
        layerGroup.addLayer(circle);
      });
    }

    if (activeLayer !== 'shelters') {
      incidents.forEach((incident) => {
        let coordinates = incident.location?.coordinates || (incident.lat && incident.lng ? [incident.lng, incident.lat] : null);
        if (Array.isArray(coordinates) && coordinates.length === 2) {
          const incidentMarker = L.circleMarker([coordinates[1], coordinates[0]], {
            radius: 9,
            color: '#fff',
            weight: 2,
            fillColor: '#ef6a55',
            fillOpacity: 1,
          }).bindTooltip(incident.type || incident.description || 'Verified Hazard / Incident');

          layerGroup.addLayer(incidentMarker);
        }
      });
    }

    return () => {
      layerGroup.clearLayers();
      if (map && map.getContainer()) {
        map.removeLayer(layerGroup);
      }
    };
  }, [activeLayer, incidents, shelters, selectedShelter, onShelterSelect]);

  return <div ref={mapElement} className="leaflet-map" style={{ height: '450px', width: '100%', borderRadius: '8px' }} />;
}

export default function Dashboard() {
  const [incidents, setIncidents] = useState([]);
  const [userCoords, setUserCoords] = useState({ lat: 14.2798, lng: 74.4441 });
  const [shelters, setShelters] = useState([]);
  const [loadingShelters, setLoadingShelters] = useState(true);
  const [activeLayer, setActiveLayer] = useState('all');
  const [selectedShelter, setSelectedShelter] = useState(null);
  const [locationMessage, setLocationMessage] = useState('Acquiring location...');

  const [safeRoute, setSafeRoute] = useState(null);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const activeAbortController = useRef(null);
  const lastFetchedCoords = useRef({ lat: null, lng: null });

  useEffect(() => {
    setSafeRoute(null);
  }, [selectedShelter]);

  useEffect(() => {
    API.get('/incidents/verified')
      .then((res) => setIncidents(res.data.data || res.data || []))
      .catch((err) => console.error('Error loading verified incidents:', err));
  }, []);

 // Dynamic geometry hazard check with local street buffer (0.3 km)
const checkRouteHasHazards = (geometryCoordinates, hazardsList) => {
  let breachCount = 0;
  let minDistanceToHazard = Infinity;

  for (let coord of geometryCoordinates) {
    const routeLng = coord[0];
    const routeLat = coord[1];

    for (let hazard of hazardsList) {
      const dist = parseFloat(calculateDistance(routeLat, routeLng, hazard.lat, hazard.lng));
      
      if (dist < minDistanceToHazard) {
        minDistanceToHazard = dist;
      }

      // Localized street buffer: 300 meters (0.3 km)
      if (dist < 0.3) {
        breachCount++;
      }
    }
  }

  return {
    hasConflict: breachCount > 0,
    breachCount,
    minDistanceToHazard,
  };
};

const handleShowDirections = async () => {
  if (!selectedShelter || !userCoords.lat || !userCoords.lng) return;

  const destLat = selectedShelter.lat;
  const destLng = selectedShelter.lng || selectedShelter.lon;

  setIsCalculatingRoute(true);

  try {
    const hazards = incidents
      .map((inc) => {
        const typeStr = (inc.type || inc.description || inc.title || '').toLowerCase();
        const isFlood = typeStr.includes('flood') || typeStr.includes('water');
        let coords = inc.location?.coordinates;

        if (Array.isArray(coords) && coords.length === 2) {
          return { lat: coords[1], lng: coords[0], isFlood };
        } else if (inc.lat && (inc.lng || inc.lon)) {
          return { lat: inc.lat, lng: inc.lng || inc.lon, isFlood };
        }
        return null;
      })
      .filter(Boolean);

    // Fetch primary + alternative local routes strictly from OSRM
    const osrmBaseUrl = `https://router.project-osrm.org/route/v1/driving/${userCoords.lng},${userCoords.lat};${destLng},${destLat}?overview=full&geometries=geojson&alternatives=true`;
    const res = await fetch(osrmBaseUrl);
    const data = await res.json();

    if (!data.routes || data.routes.length === 0) {
      setIsCalculatingRoute(false);
      return;
    }

    let bestRoute = null;

    // 1. Try to find a completely safe route
    for (let route of data.routes) {
      const evaluation = checkRouteHasHazards(route.geometry.coordinates, hazards);
      if (!evaluation.hasConflict) {
        bestRoute = route;
        break;
      }
    }

    // 2. If ALL alternatives pass near the hazard, pick the alternative with the fewest hazard intersections
    if (!bestRoute) {
      let lowestBreaches = Infinity;
      
      for (let route of data.routes) {
        const evalResult = checkRouteHasHazards(route.geometry.coordinates, hazards);
        if (evalResult.breachCount < lowestBreaches) {
          lowestBreaches = evalResult.breachCount;
          bestRoute = route;
        }
      }
    }

    // Fallback to primary route
    if (!bestRoute) {
      bestRoute = data.routes[0];
    }

    // Double-check total distance safety cap (if route exceeds 25 km for a local trip, enforce direct route)
    const routeDistanceKm = bestRoute.distance / 1000;
    if (routeDistanceKm > 25) {
      bestRoute = data.routes[0];
    }

    setSafeRoute({
      coordinates: bestRoute.geometry.coordinates,
      distance: (bestRoute.distance / 1000).toFixed(1),
      duration: Math.round(bestRoute.duration / 60),
    });
  } catch (err) {
    console.error('Error calculating route:', err);
  } finally {
    setIsCalculatingRoute(false);
  }
};


  const fetchNearbyInstitutions = useCallback(async (lat, lng, force = false) => {
    if (
      !force &&
      lastFetchedCoords.current.lat &&
      calculateDistance(lastFetchedCoords.current.lat, lastFetchedCoords.current.lng, lat, lng) < 0.5
    ) {
      return;
    }

    if (activeAbortController.current) {
      activeAbortController.current.abort();
    }
    const controller = new AbortController();
    activeAbortController.current = controller;

    lastFetchedCoords.current = { lat, lng };
    setLoadingShelters(true);

    try {
      const response = await API.post('/predict-shelters-risk', { lat, lng }, { signal: controller.signal });
      const rawShelters = response.data.data || response.data || [];

      const formattedShelters = rawShelters.map((s, idx) => ({
        ...s,
        id: s.id || s._id || `shelter-${idx}`,
        lng: s.lon || s.lng,
        distance: `${calculateDistance(lat, lng, s.lat, s.lon || s.lng)} km`,
        facilities: s.facilities || 'Water, Emergency Shelter, Power',
        total_beds: s.total_beds || s.capacity || 300,
        available_beds: s.available_beds || (s.capacity ? s.capacity - (s.occupied_beds || 0) : 150),
      }));

      setShelters(formattedShelters);
      if (formattedShelters.length > 0) {
        setSelectedShelter(formattedShelters[0]);
      }
    } catch (err) {
      if (err.name !== 'CanceledError' && err.code !== 'ERR_CANCELED') {
        console.error('Failed to fetch nearby shelters:', err);
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoadingShelters(false);
      }
    }
  }, []);

  const handleShelterAdded = (newShelter) => {
    const shelterLat = parseFloat(newShelter.lat || userCoords.lat);
    const shelterLng = parseFloat(newShelter.lon || newShelter.lng || userCoords.lng);

    const formattedNewShelter = {
      ...newShelter,
      id: newShelter.id || newShelter._id || `shelter-${Date.now()}`,
      lat: shelterLat,
      lng: shelterLng,
      distance: `${calculateDistance(userCoords.lat, userCoords.lng, shelterLat, shelterLng)} km`,
      is_safe: true,
      risk_level: 'Low Risk',
      created_at: newShelter.created_at || new Date().toISOString(),
    };

    setShelters((prevShelters) => [formattedNewShelter, ...prevShelters]);
    setSelectedShelter(formattedNewShelter);
  };

  const handleLocationChange = useCallback(
    (lat, lng, message, isManual = false) => {
      setUserCoords({ lat, lng });
      setLocationMessage(message);
      fetchNearbyInstitutions(lat, lng, isManual);
    },
    [fetchNearbyInstitutions]
  );

  return (
    <div className="dashboard-page">
      <section className="dashboard-intro">
        <div>
          <p className="eyebrow">CITIZEN RESPONSE CENTER</p>
          <h1>Know the ground. Move with confidence.</h1>
        </div>
      </section>

      <section className="dashboard-section map-section">
        <div className="section-heading">
          <div>
            <h2>Interactive Map</h2>
          </div>
          <div className="layer-controls">
            {['all', 'incidents', 'shelters', 'risk'].map((layer) => (
              <button
                className={activeLayer === layer ? 'layer-button active' : 'layer-button'}
                key={layer}
                onClick={() => setActiveLayer(layer)}
              >
                {layer[0].toUpperCase() + layer.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <LiveMap
          activeLayer={activeLayer}
          incidents={incidents}
          shelters={shelters}
          selectedShelter={selectedShelter}
          onShelterSelect={setSelectedShelter}
          userCoords={userCoords}
          onLocationChange={handleLocationChange}
          safeRoute={safeRoute}
        />

        <div className="map-selection" style={{ marginTop: '1rem' }}>
          {selectedShelter ? (
            <>
              <strong>{selectedShelter.name}</strong>
              <span style={{ margin: '0 0.5rem' }}>{selectedShelter.distance} away</span>
              <span style={{ color: selectedShelter.is_safe ? '#53b889' : '#d94a5f', fontWeight: 'bold' }}>
                {selectedShelter.is_safe ? 'Safe Shelter' : 'Unsafe Shelter'} (ML Risk: {selectedShelter.risk_level || 'N/A'})
              </span>
            </>
          ) : (
            <span>{loadingShelters ? 'Analyzing risk levels for local shelters...' : 'Searching 10km radius'}</span>
          )}
          <span className="location-status" style={{ display: 'block', marginTop: '0.25rem' }}>
            {locationMessage}
          </span>
        </div>

        <div style={{ marginTop: '1rem' }}>
          <button
            onClick={handleShowDirections}
            disabled={!selectedShelter || isCalculatingRoute}
            style={{
              backgroundColor: '#10b981',
              color: '#ffffff',
              border: 'none',
              padding: '12px 20px',
              borderRadius: '8px',
              fontWeight: 'bold',
              cursor: selectedShelter && !isCalculatingRoute ? 'pointer' : 'not-allowed',
              opacity: selectedShelter && !isCalculatingRoute ? 1 : 0.6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)',
              width: '100%',
              fontSize: '1rem',
            }}
          >
            {isCalculatingRoute ? '🔄 Calculating Safe Route...' : '🗺️ Show Directions'}
          </button>
        </div>
      </section>

      <section className="dashboard-section">
        <div
          className="section-heading"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}
        >
          <div>
            <h2>Nearby Relief Shelters (10 km)</h2>
            <span className="section-count" style={{ display: 'block', marginTop: '0.25rem' }}>
              {loadingShelters ? 'Evaluating ML Safety...' : `${shelters.length} centers found`}
            </span>
          </div>

          <button
            onClick={() => setIsModalOpen(true)}
            style={{
              backgroundColor: '#2563eb',
              color: '#ffffff',
              border: 'none',
              padding: '10px 18px',
              borderRadius: '8px',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)',
            }}
          >
            ➕ Report / Add Shelter
          </button>
        </div>

        <div className="shelter-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {shelters.map((shelter) => (
            <ShelterCard
              key={shelter.id}
              shelter={shelter}
              isSelected={selectedShelter?.id === shelter.id}
              onSelect={setSelectedShelter}
            />
          ))}
        </div>
      </section>

      <section className="dashboard-section">
        <div className="section-heading">
          <div>
            <h2>ML Model Safety Assessment for Nearby Shelters</h2>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem' }}>
            <thead>
              <tr style={{ background: 'rgba(255, 255, 255, 0.05)', textAlign: 'left' }}>
                <th style={{ padding: '0.75rem' }}>Shelter Name</th>
                <th style={{ padding: '0.75rem' }}>Distance</th>
                <th style={{ padding: '0.75rem' }}>ML Risk Level</th>
                <th style={{ padding: '0.75rem' }}>High Flood Probability</th>
                <th style={{ padding: '0.75rem' }}>Safety Status</th>
              </tr>
            </thead>
            <tbody>
              {shelters.map((s) => (
                <tr key={s.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  <td style={{ padding: '0.75rem' }}>{s.name}</td>
                  <td style={{ padding: '0.75rem' }}>{s.distance}</td>
                  <td style={{ padding: '0.75rem' }}>{s.risk_level || 'N/A'}</td>
                  <td style={{ padding: '0.75rem' }}>
                    {s.high_probability !== undefined ? `${(s.high_probability * 100).toFixed(2)}%` : 'N/A'}
                  </td>
                  <td style={{ padding: '0.75rem', color: s.is_safe ? '#53b889' : '#d94a5f', fontWeight: 'bold' }}>
                    {s.is_safe ? '✓ Safe Shelter' : '⚠️ Unsafe (Avoid)'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <AddShelterModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        userCoords={userCoords}
        onShelterAdded={handleShelterAdded}
      />
    </div>
  );
}