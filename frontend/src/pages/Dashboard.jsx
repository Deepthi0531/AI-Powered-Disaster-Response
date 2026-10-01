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

const pageLoadTime = new Date().toISOString();

/* =========================================================
   HELPERS
========================================================= */

function formatUploadedTime(dateInput) {
  if (!dateInput) return formatUploadedTime(pageLoadTime);

  let dateVal = dateInput;

  if (
    typeof dateVal === 'object' &&
    dateVal !== null &&
    dateVal.$date
  ) {
    dateVal = dateVal.$date;
  }

  if (typeof dateVal === 'number') {
    dateVal = dateVal < 10000000000
      ? dateVal * 1000
      : dateVal;
  }

  const date = new Date(dateVal);

  if (isNaN(date.getTime())) {
    return formatUploadedTime(pageLoadTime);
  }

  return date.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  if (
    lat1 === null ||
    lat1 === undefined ||
    lon1 === null ||
    lon1 === undefined ||
    lat2 === null ||
    lat2 === undefined ||
    lon2 === null ||
    lon2 === undefined
  ) {
    return '0.0';
  }

  const R = 6371;

  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c =
    2 * Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return (R * c).toFixed(3);
}

function formatRouteTime(minutes) {
  if (!minutes || minutes <= 0) {
    return 'Calculating...';
  }

  const totalMinutes = Math.round(minutes);

  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;

  if (hours === 0) {
    return `${mins} min`;
  }

  if (mins === 0) {
    return `${hours} hr`;
  }

  return `${hours} hr ${mins} min`;
}

async function fetchFullAddress(lat, lng) {
  if (
    lat === null ||
    lat === undefined ||
    lng === null ||
    lng === undefined
  ) {
    return 'Coordinates unavailable';
  }

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
      {
        headers: {
          'Accept-Language': 'en',
        },
      }
    );

    if (!res.ok) {
      throw new Error('Geocode failed');
    }

    const data = await res.json();

    return (
      data.display_name ||
      `${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}`
    );
  } catch (err) {
    return `${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}`;
  }
}

/* =========================================================
   LIVE MAP
========================================================= */

function LiveMap({
  activeLayer,
  incidents,
  shelters,
  selectedShelter,
  onShelterSelect,
  userCoords,
  onLocationChange,
  safeRoute,
}) {
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

    if (
      !map ||
      !map.getContainer() ||
      !map._loaded
    ) {
      return;
    }

    const point = [lat, lng];

    if (locationMarker.current) {
      locationMarker.current.setLatLng(point);
    } else {
      locationMarker.current = L.marker(point, {
        draggable: true,
        title: 'Your Location',
      })
        .addTo(map)
        .bindPopup(
          '<b>Your Location</b><br/>Drag pin to adjust position.'
        );

      locationMarker.current.on(
        'dragend',
        (event) => {
          const newPos = event.target.getLatLng();

          if (onLocationChangeRef.current) {
            onLocationChangeRef.current(
              newPos.lat,
              newPos.lng,
              `Exact location pinned: ${newPos.lat.toFixed(
                5
              )}, ${newPos.lng.toFixed(5)}`,
              true
            );
          }
        }
      );
    }

    if (!tappedMarker.current) {
      requestAnimationFrame(() => {
        if (
          mapRef.current &&
          mapRef.current.getContainer() &&
          mapRef.current._loaded
        ) {
          mapRef.current.setView(point, 13);
        }
      });
    }

    if (onLocationChangeRef.current) {
      onLocationChangeRef.current(
        lat,
        lng,
        `GPS position updated (${lat.toFixed(
          4
        )}, ${lng.toFixed(4)})`,
        false
      );
    }
  }, []);

  /* =========================================================
     INITIALIZE MAP
  ========================================================= */

  useEffect(() => {
    if (!mapElement.current || mapRef.current) {
      return;
    }

    const initialLat =
      userCoords?.lat ?? 14.2798;

    const initialLng =
      userCoords?.lng ?? 74.4441;

    const map = L.map(
      mapElement.current
    ).setView(
      [initialLat, initialLng],
      13
    );

    L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        attribution:
          '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }
    ).addTo(map);

    mapRef.current = map;

    /* GPS */

    const handleLocationSuccess = (
      position
    ) => {
      const {
        latitude,
        longitude,
      } = position.coords;

      updateLocationPoint(
        latitude,
        longitude
      );
    };

    const handleLocationError = () => {
      const fallbackLat =
        userCoords?.lat ?? 14.2798;

      const fallbackLng =
        userCoords?.lng ?? 74.4441;

      if (onLocationChangeRef.current) {
        onLocationChangeRef.current(
          fallbackLat,
          fallbackLng,
          'GPS unavailable. Tap map to select manual location.',
          false
        );
      }
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        handleLocationSuccess,
        handleLocationError,
        {
          enableHighAccuracy: true,
          timeout: 10000,
        }
      );
    } else {
      handleLocationError();
    }

    /* MAP CLICK */

    const handleMapClick = (e) => {
      const {
        lat,
        lng,
      } = e.latlng;

      if (tappedMarker.current) {
        tappedMarker.current.remove();
      }

      tappedMarker.current =
        L.marker([lat, lng])
          .addTo(map)
          .bindPopup(
            `Selected spot: ${lat.toFixed(
              5
            )}, ${lng.toFixed(5)}`
          )
          .openPopup();

      if (onLocationChangeRef.current) {
        onLocationChangeRef.current(
          lat,
          lng,
          `Selected point: ${lat.toFixed(
            5
          )}, ${lng.toFixed(5)}`,
          true
        );
      }
    };

    map.on(
      'click',
      handleMapClick
    );

    return () => {
      map.off(
        'click',
        handleMapClick
      );

      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      locationMarker.current = null;
      tappedMarker.current = null;
    };
  }, []);

  /* =========================================================
     UPDATE USER LOCATION
  ========================================================= */

  useEffect(() => {
    if (
      userCoords?.lat !== null &&
      userCoords?.lat !== undefined &&
      userCoords?.lng !== null &&
      userCoords?.lng !== undefined &&
      mapRef.current &&
      mapRef.current._loaded
    ) {
      updateLocationPoint(
        userCoords.lat,
        userCoords.lng
      );
    }
  }, [
    userCoords?.lat,
    userCoords?.lng,
    updateLocationPoint,
  ]);

  /* =========================================================
     DRAW ROUTE
  ========================================================= */

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !map._loaded) {
      return;
    }

    if (routeLayerRef.current) {
      map.removeLayer(
        routeLayerRef.current
      );

      routeLayerRef.current = null;
    }

    if (
      safeRoute &&
      safeRoute.coordinates &&
      safeRoute.coordinates.length > 0
    ) {
      const polylineCoords =
        safeRoute.coordinates.map(
          (coordinate) => [
            coordinate[1],
            coordinate[0],
          ]
        );

      routeLayerRef.current =
        L.polyline(
          polylineCoords,
          {
            color: '#2563eb',
            weight: 6,
            opacity: 0.9,
            lineJoin: 'round',
          }
        ).addTo(map);

      map.fitBounds(
        routeLayerRef.current.getBounds(),
        {
          padding: [40, 40],
        }
      );
    }
  }, [safeRoute]);

  /* =========================================================
     SHELTERS + INCIDENTS
  ========================================================= */

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !map._loaded) {
      return;
    }

    const layerGroup =
      L.layerGroup().addTo(map);

    /* SHELTERS */

    if (activeLayer !== 'risk') {
      shelters.forEach((shelter) => {
        const shelterLat =
          shelter.lat;

        const shelterLng =
          shelter.lng ??
          shelter.lon;

        if (
          shelterLat === null ||
          shelterLat === undefined ||
          shelterLng === null ||
          shelterLng === undefined
        ) {
          return;
        }

        const isSelected =
          selectedShelter?.id ===
            shelter.id ||
          selectedShelter?._id ===
            shelter.id;

        const markerColor =
          shelter.is_safe
            ? '#53b889'
            : '#d94a5f';

        const circle =
          L.circleMarker(
            [
              shelterLat,
              shelterLng,
            ],
            {
              radius: isSelected
                ? 12
                : 8,
              color: isSelected
                ? '#333'
                : '#fff',
              weight: 2,
              fillColor:
                markerColor,
              fillOpacity: 0.9,
            }
          )
            .bindTooltip(
              `<b>${shelter.name}</b><br/>` +
                `Status: <b style="color:${markerColor}">` +
                `${
                  shelter.is_safe
                    ? 'Safe'
                    : 'Unsafe'
                }` +
                `</b><br/>` +
                `Distance: ${shelter.distance}<br/>` +
                `Reported: ${formatUploadedTime(
                  shelter.created_at
                )}`
            )
            .on('click', () =>
              onShelterSelect(
                shelter
              )
            );

        layerGroup.addLayer(
          circle
        );
      });
    }

    /* INCIDENTS */

    if (activeLayer !== 'shelters') {
      incidents.forEach(
        (incident) => {
          let coordinates =
            incident.location
              ?.coordinates ||
            (
              incident.lat !==
                null &&
              incident.lat !==
                undefined &&
              (
                incident.lng !==
                  null &&
                incident.lng !==
                  undefined
              )
                ? [
                    incident.lng,
                    incident.lat,
                  ]
                : null
            );

          if (
            Array.isArray(
              coordinates
            ) &&
            coordinates.length === 2
          ) {
            const incidentMarker =
              L.circleMarker(
                [
                  coordinates[1],
                  coordinates[0],
                ],
                {
                  radius: 9,
                  color: '#fff',
                  weight: 2,
                  fillColor:
                    '#ef6a55',
                  fillOpacity: 1,
                }
              ).bindTooltip(
                incident.type ||
                  incident.description ||
                  'Verified Hazard / Incident'
              );

            layerGroup.addLayer(
              incidentMarker
            );
          }
        }
      );
    }

    return () => {
      layerGroup.clearLayers();

      if (
        map &&
        map.getContainer()
      ) {
        map.removeLayer(
          layerGroup
        );
      }
    };
  }, [
    activeLayer,
    incidents,
    shelters,
    selectedShelter,
    onShelterSelect,
  ]);

  return (
    <div
      ref={mapElement}
      className="leaflet-map"
      style={{
        height: '546px',
        width: '100%',
        borderRadius: '8px',
      }}
    />
  );
}

/* =========================================================
   DASHBOARD
========================================================= */

export default function Dashboard() {
  const [
    incidents,
    setIncidents,
  ] = useState([]);

  const [
    userCoords,
    setUserCoords,
  ] = useState({
    lat: 14.2798,
    lng: 74.4441,
  });

  const [
    shelters,
    setShelters,
  ] = useState([]);

  const [
    loadingShelters,
    setLoadingShelters,
  ] = useState(true);

  const [
    activeLayer,
    setActiveLayer,
  ] = useState('all');

  const [
    selectedShelter,
    setSelectedShelter,
  ] = useState(null);

  /*
   * IMPORTANT:
   * routeTarget is used for BOTH:
   * - shelter routing
   * - searched destination routing
   */
  const [
    routeTarget,
    setRouteTarget,
  ] = useState(null);

  const [
    locationMessage,
    setLocationMessage,
  ] = useState(
    'Acquiring location...'
  );

  const [
    safeRoute,
    setSafeRoute,
  ] = useState(null);

  const [
    isCalculatingRoute,
    setIsCalculatingRoute,
  ] = useState(false);

  const [
    isModalOpen,
    setIsModalOpen,
  ] = useState(false);

  const [
    destinationSearch,
    setDestinationSearch,
  ] = useState('');

  const [
    isSearchingDestination,
    setIsSearchingDestination,
  ] = useState(false);

  const activeAbortController =
    useRef(null);

  const lastFetchedCoords =
    useRef({
      lat: null,
      lng: null,
    });

  /* =========================================================
     LOAD VERIFIED INCIDENTS
  ========================================================= */

  useEffect(() => {
    API.get('/incidents/verified')
      .then((res) => {
        setIncidents(
          res.data.data ||
            res.data ||
            []
        );
      })
      .catch((err) =>
        console.error(
          'Error loading verified incidents:',
          err
        )
      );
  }, []);

  /* =========================================================
     INCIDENT PROXIMITY
  ========================================================= */

  const isShelterNearIncident =
    useCallback(
      (
        shelterLat,
        shelterLng,
        incidentList
      ) => {
        if (
          !incidentList ||
          incidentList.length === 0
        ) {
          return false;
        }

        return incidentList.some(
          (inc) => {
            let incLat = inc.lat;
            let incLng =
              inc.lng ??
              inc.lon;

            if (
              (
                incLat ===
                  null ||
                incLat ===
                  undefined
              ) &&
              inc.location
                ?.coordinates
            ) {
              incLng =
                inc.location
                  .coordinates[0];

              incLat =
                inc.location
                  .coordinates[1];
            }

            if (
              incLat !== null &&
              incLat !==
                undefined &&
              incLng !== null &&
              incLng !==
                undefined
            ) {
              const distToIncident =
                parseFloat(
                  calculateDistance(
                    shelterLat,
                    shelterLng,
                    parseFloat(
                      incLat
                    ),
                    parseFloat(
                      incLng
                    )
                  )
                );

              return (
                distToIncident <=
                2.0
              );
            }

            return false;
          }
        );
      },
      []
    );

  /* =========================================================
     DISTANCE FROM POINT TO ROUTE SEGMENT
  ========================================================= */

  const distanceToSegmentKm = (
    pLat,
    pLng,
    aLat,
    aLng,
    bLat,
    bLng
  ) => {
    const dAB =
      parseFloat(
        calculateDistance(
          aLat,
          aLng,
          bLat,
          bLng
        )
      );

    if (dAB === 0) {
      return parseFloat(
        calculateDistance(
          pLat,
          pLng,
          aLat,
          aLng
        )
      );
    }

    /*
     * Convert longitude to a latitude-adjusted
     * local coordinate system so that route
     * segment projection is more accurate.
     */

    const avgLat =
      ((aLat + bLat + pLat) /
        3) *
      (Math.PI / 180);

    const lngScale =
      Math.cos(avgLat);

    const ax =
      aLng * lngScale;

    const ay = aLat;

    const bx =
      bLng * lngScale;

    const by = bLat;

    const px =
      pLng * lngScale;

    const py = pLat;

    const dx = bx - ax;
    const dy = by - ay;

    const denominator =
      dx * dx + dy * dy;

    let t = 0;

    if (denominator > 0) {
      t =
        ((px - ax) * dx +
          (py - ay) * dy) /
        denominator;
    }

    t = Math.max(
      0,
      Math.min(1, t)
    );

    const projLat =
      ay + t * dy;

    const projLng =
      (ax + t * dx) /
      (lngScale || 1);

    return parseFloat(
      calculateDistance(
        pLat,
        pLng,
        projLat,
        projLng
      )
    );
  };

  /* =========================================================
     CHECK WHETHER ROUTE PASSES INCIDENTS
  ========================================================= */

  const checkRouteHasHazards = (
    geometryCoordinates,
    hazardsList,
    safetyRadiusKm = 3.0
  ) => {
    let breachCount = 0;

    let minDistanceToHazard =
      Infinity;

    if (
      !geometryCoordinates ||
      geometryCoordinates.length <
        2
    ) {
      return {
        hasConflict: false,
        breachCount: 0,
        minDistanceToHazard:
          Infinity,
      };
    }

    for (
      let i = 0;
      i <
      geometryCoordinates.length -
        1;
      i++
    ) {
      const aLng =
        geometryCoordinates[i][0];

      const aLat =
        geometryCoordinates[i][1];

      const bLng =
        geometryCoordinates[
          i + 1
        ][0];

      const bLat =
        geometryCoordinates[
          i + 1
        ][1];

      for (
        const hazard of hazardsList
      ) {
        const dist =
          distanceToSegmentKm(
            hazard.lat,
            hazard.lng,
            aLat,
            aLng,
            bLat,
            bLng
          );

        if (
          dist <
          minDistanceToHazard
        ) {
          minDistanceToHazard =
            dist;
        }

        if (
          dist <
          safetyRadiusKm
        ) {
          breachCount++;
        }
      }
    }

    return {
      hasConflict:
        breachCount > 0,
      breachCount,
      minDistanceToHazard,
    };
  };

  /* =========================================================
     CREATE INCIDENT HAZARDS
  ========================================================= */

  const getIncidentHazards =
    () => {
      return incidents
        .map((inc) => {
          const coords =
            inc.location
              ?.coordinates;

          if (
            Array.isArray(
              coords
            ) &&
            coords.length === 2
          ) {
            return {
              lat: parseFloat(
                coords[1]
              ),
              lng: parseFloat(
                coords[0]
              ),
            };
          }

          if (
            inc.lat !== null &&
            inc.lat !==
              undefined &&
            (
              inc.lng !== null &&
              inc.lng !==
                undefined
            ) ||
            (
              inc.lon !== null &&
              inc.lon !==
                undefined
            )
          ) {
            return {
              lat: parseFloat(
                inc.lat
              ),
              lng: parseFloat(
                inc.lng ??
                  inc.lon
              ),
            };
          }

          return null;
        })
        .filter(
          (hazard) =>
            hazard &&
            !isNaN(hazard.lat) &&
            !isNaN(hazard.lng)
        );
    };

  /* =========================================================
     SAFE ROUTE CALCULATION
     
     SAME FUNCTION IS USED FOR:
     1. SHELTERS
     2. SEARCHED DESTINATIONS
  ========================================================= */

  const calculateRouteToTarget =
    async (
      targetLocation
    ) => {
      if (
        !targetLocation
      ) {
        return;
      }

      if (
        userCoords.lat ===
          null ||
        userCoords.lat ===
          undefined ||
        userCoords.lng ===
          null ||
        userCoords.lng ===
          undefined
      ) {
        return;
      }

      const destLat =
        parseFloat(
          targetLocation.lat
        );

      const destLng =
        parseFloat(
          targetLocation.lng ??
            targetLocation.lon
        );

      if (
        isNaN(destLat) ||
        isNaN(destLng)
      ) {
        return;
      }

      setIsCalculatingRoute(
        true
      );

      /*
       * Remove old route immediately.
       */
      setSafeRoute(null);

      try {
        const hazards =
          getIncidentHazards();

        /*
         * Straight-line distance.
         */
        const straightDist =
          parseFloat(
            calculateDistance(
              userCoords.lat,
              userCoords.lng,
              destLat,
              destLng
            )
          );

        /*
         * Safety radius around every verified
         * incident.
         *
         * A route entering this radius is
         * considered unsafe.
         */
        const safetyRadiusKm =
          Math.min(
            3.0,
            Math.max(
              0.5,
              straightDist *
                0.025
            )
          );

        /*
         * Never allow the safety radius to
         * become extremely small.
         */
        const finalSafetyRadius =
          Math.max(
            0.75,
            Math.min(
              3.0,
              safetyRadiusKm
            )
          );

        /*
         * -----------------------------------------------------
         * FIRST:
         * Ask OSRM for the normal shortest route
         * plus alternative routes.
         * -----------------------------------------------------
         */

        const osrmBaseUrl =
          `https://router.project-osrm.org/route/v1/driving/` +
          `${userCoords.lng},${userCoords.lat};` +
          `${destLng},${destLat}` +
          `?overview=full` +
          `&geometries=geojson` +
          `&alternatives=true` +
          `&steps=true`;

        const response =
          await fetch(
            osrmBaseUrl
          );

        if (!response.ok) {
          throw new Error(
            'Routing service failed'
          );
        }

        const data =
          await response.json();

        let candidateRoutes =
          data.routes &&
          data.routes.length > 0
            ? [...data.routes]
            : [];

        /*
         * -----------------------------------------------------
         * FIND INCIDENTS RELEVANT TO THIS JOURNEY
         * -----------------------------------------------------
         */

        const relevantHazards =
          hazards.filter(
            (hazard) => {
              const distanceFromStart =
                parseFloat(
                  calculateDistance(
                    userCoords.lat,
                    userCoords.lng,
                    hazard.lat,
                    hazard.lng
                  )
                );

              const distanceFromDestination =
                parseFloat(
                  calculateDistance(
                    destLat,
                    destLng,
                    hazard.lat,
                    hazard.lng
                  )
                );

              /*
               * Only create detours for incidents
               * that are reasonably close to the
               * journey corridor.
               */
              return (
                distanceFromStart +
                  distanceFromDestination <=
                straightDist *
                  1.8 +
                  5.0
              );
            }
          );

        /*
         * -----------------------------------------------------
         * CHECK ORIGINAL OSRM ROUTES
         * -----------------------------------------------------
         */

        const evaluatedOriginalRoutes =
          candidateRoutes.map(
            (route) => {
              const evaluation =
                checkRouteHasHazards(
                  route.geometry
                    .coordinates,
                  relevantHazards,
                  finalSafetyRadius
                );

              return {
                route,
                evaluation,
              };
            }
          );

        /*
         * If the normal shortest route does not
         * touch any incident, use it.
         *
         * This is important because we want the
         * SHORTEST route whenever it is safe.
         */

        const safeOriginalRoutes =
          evaluatedOriginalRoutes.filter(
            (item) =>
              !item.evaluation
                .hasConflict
          );

        /*
         * -----------------------------------------------------
         * IF NORMAL ROUTES ARE UNSAFE:
         * GENERATE DETOUR ROUTES AROUND INCIDENTS.
         * -----------------------------------------------------
         */

        if (
          safeOriginalRoutes.length ===
            0 &&
          relevantHazards.length > 0
        ) {
          /*
           * We generate points around each incident.
           *
           * These points are used as temporary
           * routing waypoints.
           */

          const angles = [
            0,
            45,
            90,
            135,
            180,
            225,
            270,
            315,
          ];

          /*
           * Keep detours reasonably close to
           * the incident so that the alternate
           * route does not become unnecessarily long.
           */
          const pushDistances = [
            Math.max(
              1.0,
              finalSafetyRadius *
                1.25
            ),
            Math.max(
              1.5,
              finalSafetyRadius *
                1.7
            ),
          ];

          /*
           * Limit the number of routing requests.
           *
           * We take the closest relevant incidents
           * first.
           */
          const sortedHazards =
            [...relevantHazards]
              .sort(
                (a, b) => {
                  const aDist =
                    parseFloat(
                      calculateDistance(
                        userCoords.lat,
                        userCoords.lng,
                        a.lat,
                        a.lng
                      )
                    );

                  const bDist =
                    parseFloat(
                      calculateDistance(
                        userCoords.lat,
                        userCoords.lng,
                        b.lat,
                        b.lng
                      )
                    );

                  return (
                    aDist - bDist
                  );
                }
              )
              .slice(0, 3);

          for (
            const hazard of sortedHazards
          ) {
            for (
              const distKm of pushDistances
            ) {
              for (
                const angle of angles
              ) {
                const rad =
                  (angle *
                    Math.PI) /
                  180;

                const dLat =
                  (distKm /
                    111.32) *
                  Math.cos(rad);

                const latitudeRadians =
                  (hazard.lat *
                    Math.PI) /
                  180;

                const dLng =
                  (distKm /
                    (111.32 *
                      Math.cos(
                        latitudeRadians
                      ))) *
                  Math.sin(rad);

                const waypointLat =
                  hazard.lat +
                  dLat;

                const waypointLng =
                  hazard.lng +
                  dLng;

                /*
                 * Don't place waypoint inside
                 * another incident's safety zone.
                 */
                const waypointIsSafe =
                  hazards.every(
                    (otherHazard) => {
                      const distance =
                        parseFloat(
                          calculateDistance(
                            waypointLat,
                            waypointLng,
                            otherHazard.lat,
                            otherHazard.lng
                          )
                        );

                      return (
                        distance >=
                        finalSafetyRadius
                      );
                    }
                  );

                if (
                  !waypointIsSafe
                ) {
                  continue;
                }

                try {
                  const detourUrl =
                    `https://router.project-osrm.org/route/v1/driving/` +
                    `${userCoords.lng},${userCoords.lat};` +
                    `${waypointLng},${waypointLat};` +
                    `${destLng},${destLat}` +
                    `?overview=full&geometries=geojson`;

                  const detourResponse =
                    await fetch(
                      detourUrl
                    );

                  if (
                    !detourResponse.ok
                  ) {
                    continue;
                  }

                  const detourData =
                    await detourResponse.json();

                  if (
                    detourData.routes &&
                    detourData.routes[0]
                  ) {
                    candidateRoutes.push(
                      detourData.routes[0]
                    );
                  }
                } catch (detourError) {
                  console.error(
                    'Detour route error:',
                    detourError
                  );
                }
              }
            }
          }
        }

        /*
         * -----------------------------------------------------
         * REMOVE DUPLICATE ROUTES
         * -----------------------------------------------------
         */

        const uniqueRoutes =
          [];

        const routeKeys =
          new Set();

        candidateRoutes.forEach(
          (route) => {
            if (
              !route.geometry ||
              !route.geometry
                .coordinates
            ) {
              return;
            }

            const first =
              route.geometry
                .coordinates[0];

            const last =
              route.geometry
                .coordinates[
                  route.geometry
                    .coordinates
                    .length - 1
                ];

            const key =
              `${route.distance.toFixed(
                0
              )}-${first[0].toFixed(
                4
              )}-${first[1].toFixed(
                4
              )}-${last[0].toFixed(
                4
              )}-${last[1].toFixed(
                4
              )}`;

            if (
              !routeKeys.has(key)
            ) {
              routeKeys.add(key);
              uniqueRoutes.push(
                route
              );
            }
          }
        );

        /*
         * -----------------------------------------------------
         * EVALUATE EVERY ROUTE AGAINST INCIDENTS
         * -----------------------------------------------------
         */

        const evaluatedRoutes =
          uniqueRoutes.map(
            (route) => {
              const evaluation =
                checkRouteHasHazards(
                  route.geometry
                    .coordinates,
                  hazards,
                  finalSafetyRadius
                );

              return {
                route,
                evaluation,
              };
            }
          );

        /*
         * -----------------------------------------------------
         * SAFE ROUTES ONLY
         *
         * This is the important part:
         *
         * 1. Ignore routes that hit an incident.
         * 2. Among safe routes, choose the shortest.
         * -----------------------------------------------------
         */

        const safeRoutes =
          evaluatedRoutes.filter(
            (item) =>
              !item.evaluation
                .hasConflict
          );

        let bestRoute = null;
        let routeWasSafe = false;

        if (
          safeRoutes.length > 0
        ) {
          /*
           * SHORTEST SAFE ROUTE
           */
          bestRoute =
            safeRoutes.reduce(
              (shortest, current) =>
                current.route.distance <
                shortest.route.distance
                  ? current
                  : shortest
            );

          routeWasSafe = true;
        } else if (
          evaluatedRoutes.length >
          0
        ) {
          /*
           * This should only happen if every
           * available road route is affected.
           *
           * We choose the route with:
           * 1. Least incident breaches
           * 2. Then greatest distance from incidents
           * 3. Then shortest distance
           *
           * This prevents the application from
           * showing "no route" when the road network
           * itself has no completely clean option.
           */
          bestRoute =
            evaluatedRoutes.reduce(
              (best, current) => {
                if (
                  current.evaluation
                    .breachCount <
                  best.evaluation
                    .breachCount
                ) {
                  return current;
                }

                if (
                  current.evaluation
                    .breachCount ===
                    best.evaluation
                      .breachCount
                ) {
                  if (
                    current.evaluation
                      .minDistanceToHazard >
                    best.evaluation
                      .minDistanceToHazard
                  ) {
                    return current;
                  }

                  if (
                    current.evaluation
                      .minDistanceToHazard ===
                    best.evaluation
                      .minDistanceToHazard
                  ) {
                    return current
                      .route
                      .distance <
                      best.route
                        .distance
                      ? current
                      : best;
                  }
                }

                return best;
              }
            );
        }

        /*
         * -----------------------------------------------------
         * DISPLAY ROUTE
         * -----------------------------------------------------
         */

        if (
          !bestRoute ||
          !bestRoute.route
        ) {
          console.error(
            'No route could be calculated.'
          );

          setSafeRoute(
            null
          );

          return;
        }

        const selectedRoute =
          bestRoute.route;

        const routeDistanceKm =
          selectedRoute.distance /
          1000;

        const routeTimeMinutes =
          selectedRoute.duration /
          60;

        setSafeRoute({
          coordinates:
            selectedRoute
              .geometry
              .coordinates,

          distance:
            routeDistanceKm.toFixed(
              1
            ),

          duration:
            Math.round(
              routeTimeMinutes
            ),

          durationText:
            formatRouteTime(
              routeTimeMinutes
            ),

          wasSafe:
            routeWasSafe,

          incidentAvoided:
            relevantHazards.length ===
              0 ||
            routeWasSafe,

          incidentCount:
            relevantHazards.length,

          safetyRadius:
            finalSafetyRadius,
        });
      } catch (err) {
        console.error(
          'Error calculating safe route:',
          err
        );

        setSafeRoute(
          null
        );
      } finally {
        setIsCalculatingRoute(
          false
        );
      }
    };

  /* =========================================================
     SHELTER DIRECTIONS
  ========================================================= */

  const handleShelterSelect =
    (shelter) => {
      setSelectedShelter(
        shelter
      );

      setRouteTarget(
        shelter
      );

      setSafeRoute(
        null
      );
    };

  const handleShowDirections =
    () => {
      if (!routeTarget) {
        return;
      }

      calculateRouteToTarget(
        routeTarget
      );
    };

  /* =========================================================
     SEARCH DESTINATION
  ========================================================= */

  const handleDestinationSearch =
    async (e) => {
      e.preventDefault();

      if (
        !destinationSearch.trim()
      ) {
        return;
      }

      setIsSearchingDestination(
        true
      );

      /*
       * Clear old route before searching
       * for the new destination.
       */
      setSafeRoute(
        null
      );

      try {
        const response =
          await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
              destinationSearch
            )}`
          );

        if (!response.ok) {
          throw new Error(
            'Destination search failed'
          );
        }

        const results =
          await response.json();

        if (
          results &&
          results.length > 0
        ) {
          const topResult =
            results[0];

          const destLat =
            parseFloat(
              topResult.lat
            );

          const destLng =
            parseFloat(
              topResult.lon
            );

          const targetDestination =
            {
              id: `destination-${Date.now()}`,

              name:
                topResult.display_name
                  .split(',')[0] ||
                destinationSearch,

              lat: destLat,

              lng: destLng,

              lon: destLng,

              distance:
                `${calculateDistance(
                  userCoords.lat,
                  userCoords.lng,
                  destLat,
                  destLng
                )} km`,

              is_safe: true,

              risk_level:
                'Destination Selected',

              created_at:
                new Date().toISOString(),

              full_address:
                topResult.display_name,

              photoUrl: null,

              isDestination: true,
            };

          /*
           * IMPORTANT:
           * Do NOT replace the selected shelter
           * with the destination.
           *
           * The route target is now the destination.
           */
          setRouteTarget(
            targetDestination
          );

          /*
           * Keep selectedShelter for the UI,
           * but the routing system uses routeTarget.
           */
          setSelectedShelter(
            targetDestination
          );

          /*
           * Calculate route using exactly the
           * same incident avoidance algorithm.
           */
          await calculateRouteToTarget(
            targetDestination
          );
        } else {
          alert(
            'Location not found. Please try entering a valid city or address.'
          );
        }
      } catch (err) {
        console.error(
          'Error searching destination:',
          err
        );

        alert(
          'Failed to search location. Please check your network and try again.'
        );
      } finally {
        setIsSearchingDestination(
          false
        );
      }
    };

  /* =========================================================
     FETCH NEARBY SHELTERS
  ========================================================= */

  const fetchNearbyInstitutions =
    useCallback(
      async (
        lat,
        lng,
        force = false
      ) => {
        if (
          !force &&
          lastFetchedCoords.current
            .lat !== null &&
          lastFetchedCoords.current
            .lng !== null &&
          parseFloat(
            calculateDistance(
              lastFetchedCoords.current
                .lat,
              lastFetchedCoords.current
                .lng,
              lat,
              lng
            )
          ) < 0.5
        ) {
          return;
        }

        if (
          activeAbortController.current
        ) {
          activeAbortController.current.abort();
        }

        const controller =
          new AbortController();

        activeAbortController.current =
          controller;

        lastFetchedCoords.current =
          {
            lat,
            lng,
          };

        setLoadingShelters(
          true
        );

        try {
          const response =
            await API.post(
              '/predict-shelters-risk',
              {
                lat,
                lng,
              },
              {
                signal:
                  controller.signal,
              }
            );

          const rawShelters =
            response.data.data ||
            response.data ||
            [];

          const mappedShelters =
            rawShelters.map(
              (s, idx) => {
                const shelterLat =
                  parseFloat(
                    s.lat ??
                      s.latitude
                  );

                const shelterLng =
                  parseFloat(
                    s.lon ??
                      s.lng ??
                      s.longitude
                  );

                const distNum =
                  parseFloat(
                    calculateDistance(
                      lat,
                      lng,
                      shelterLat,
                      shelterLng
                    )
                  );

                const isAdminOrUserAdded =
                  s.is_admin ||
                  s.is_official ||
                  s.source ===
                    'admin' ||
                  (
                    s.name &&
                    s.name
                      .toLowerCase()
                      .includes(
                        '(official)'
                      )
                  );

                const exactCreated =
                  isAdminOrUserAdded ||
                  s.is_updated_by_user
                    ? s.created_at ||
                      s.createdAt ||
                      s.timestamp ||
                      s.updatedAt ||
                      new Date().toISOString()
                    : pageLoadTime;

                const nearIncident =
                  isShelterNearIncident(
                    shelterLat,
                    shelterLng,
                    incidents
                  );

                const isSafe =
                  nearIncident
                    ? false
                    : s.is_safe !==
                        undefined
                      ? s.is_safe
                      : true;

                const riskLevel =
                  nearIncident
                    ? 'High Risk (Proximity to Incident)'
                    : s.risk_level ||
                      (
                        isSafe
                          ? 'Low Risk'
                          : 'High Risk'
                      );

                return {
                  ...s,

                  id:
                    s.id ||
                    s._id ||
                    `shelter-${idx}`,

                  lat: shelterLat,

                  lng: shelterLng,

                  distNum,

                  distance:
                    `${distNum.toFixed(
                      1
                    )} km`,

                  is_safe:
                    isSafe,

                  risk_level:
                    riskLevel,

                  facilities:
                    s.facilities ||
                    'Water, Emergency Shelter, Power',

                  total_beds:
                    s.total_beds !==
                      undefined &&
                    s.total_beds !==
                      null
                      ? Number(
                          s.total_beds
                        )
                      : s.capacity
                      ? Number(
                          s.capacity
                        )
                      : 300,

                  available_beds:
                    s.available_beds !==
                      undefined &&
                    s.available_beds !==
                      null
                      ? Number(
                          s.available_beds
                        )
                      : s.capacity
                      ? Number(
                          s.capacity
                        ) -
                        (Number(
                          s.occupied_beds
                        ) || 0)
                      : 150,

                  occupied_beds:
                    s.occupied_beds !==
                      undefined &&
                    s.occupied_beds !==
                      null
                      ? Number(
                          s.occupied_beds
                        )
                      : 0,

                  location_name:
                    s.location_name ||
                    s.address ||
                    '',

                  full_address:
                    s.full_address ||
                    s.address ||
                    s.location_name ||
                    `${
                      shelterLat.toFixed(
                        4
                      )
                    }, ${
                      shelterLng.toFixed(
                        4
                      )
                    }`,

                  created_at:
                    exactCreated,

                  photoUrl:
                    s.photoUrl ||
                    s.photo_url ||
                    s.image ||
                    s.imageUrl ||
                    null,

                  is_admin:
                    isAdminOrUserAdded,
                };
              }
            );

          const validShelters =
            mappedShelters
              .filter(
                (s) =>
                  !isNaN(
                    s.distNum
                  ) &&
                  s.distNum <= 50.0
              )
              .sort(
                (a, b) => {
                  if (
                    a.is_admin &&
                    !b.is_admin
                  ) {
                    return -1;
                  }

                  if (
                    !a.is_admin &&
                    b.is_admin
                  ) {
                    return 1;
                  }

                  return (
                    a.distNum -
                    b.distNum
                  );
                }
              );

          setShelters(
            validShelters
          );

          /*
           * Only select a shelter automatically
           * if we currently don't have a searched
           * destination.
           */
          if (
            validShelters.length >
              0 &&
            !routeTarget?.isDestination
          ) {
            const nearestShelter =
              validShelters[0];

            setSelectedShelter(
              nearestShelter
            );

            setRouteTarget(
              nearestShelter
            );
          }

          /*
           * Reverse geocode shelters.
           */
          validShelters.forEach(
            async (
              shelterItem
            ) => {
              if (
                !shelterItem.full_address ||
                shelterItem.full_address.includes(
                  ','
                )
              ) {
                const detailedAddr =
                  await fetchFullAddress(
                    shelterItem.lat,
                    shelterItem.lng
                  );

                if (
                  detailedAddr
                ) {
                  setShelters(
                    (prev) =>
                      prev.map(
                        (
                          item
                        ) =>
                          item.id ===
                          shelterItem.id
                            ? {
                                ...item,
                                full_address:
                                  detailedAddr,
                              }
                            : item
                      )
                  );
                }
              }
            }
          );
        } catch (err) {
          if (
            err.name !==
              'CanceledError' &&
            err.code !==
              'ERR_CANCELED'
          ) {
            console.error(
              'Failed to fetch nearby shelters:',
              err
            );
          }
        } finally {
          if (
            !controller.signal
              .aborted
          ) {
            setLoadingShelters(
              false
            );
          }
        }
      },
      [
        incidents,
        isShelterNearIncident,
        routeTarget,
      ]
    );

  /* =========================================================
     LOCATION CHANGE
  ========================================================= */

  const handleLocationChange =
    useCallback(
      (
        lat,
        lng,
        message,
        isManual = false
      ) => {
        setUserCoords({
          lat,
          lng,
        });

        setLocationMessage(
          message
        );

        fetchNearbyInstitutions(
          lat,
          lng,
          isManual
        );

        /*
         * If a route is already active,
         * recalculate it from the new location.
         */
        if (
          routeTarget
        ) {
          calculateRouteToTarget(
            routeTarget
          );
        }
      },
      [
        fetchNearbyInstitutions,
        routeTarget,
      ]
    );

  /* =========================================================
     SHELTER ADDED
  ========================================================= */

  const handleShelterAdded =
    async (
      newShelter
    ) => {
      const rawData =
        newShelter.data ||
        newShelter.shelter ||
        newShelter;

      const shelterLat =
        parseFloat(
          rawData.lat ??
            rawData.latitude ??
            userCoords.lat
        );

      const shelterLng =
        parseFloat(
          rawData.lon ??
            rawData.lng ??
            rawData.longitude ??
            userCoords.lng
        );

      const distNum =
        parseFloat(
          calculateDistance(
            userCoords.lat,
            userCoords.lng,
            shelterLat,
            shelterLng
          )
        );

      const exactTimestamp =
        new Date().toISOString();

      const fullAddress =
        rawData.address ||
        rawData.location_name ||
        (await fetchFullAddress(
          shelterLat,
          shelterLng
        ));

      const uploadedImage =
        rawData.photoUrl ||
        rawData.photo_url ||
        rawData.image ||
        rawData.imageUrl ||
        (
          rawData.photo &&
          typeof rawData.photo ===
            'string'
            ? rawData.photo
            : null
        );

      const nearIncident =
        isShelterNearIncident(
          shelterLat,
          shelterLng,
          incidents
        );

      const isSafe =
        nearIncident
          ? false
          : rawData.is_safe !==
              undefined
            ? rawData.is_safe
            : true;

      const riskLevel =
        nearIncident
          ? 'High Risk (Proximity to Incident)'
          : rawData.risk_level ||
            'Low Risk';

      const formattedNewShelter =
        {
          ...rawData,

          id:
            rawData.id ||
            rawData._id ||
            `user-added-${Date.now()}`,

          name:
            rawData.name ||
            'Citizen Reported Shelter',

          lat: shelterLat,

          lng: shelterLng,

          distNum,

          distance:
            `${distNum.toFixed(
              1
            )} km`,

          is_safe:
            isSafe,

          risk_level:
            riskLevel,

          created_at:
            exactTimestamp,

          full_address:
            fullAddress,

          photoUrl:
            uploadedImage,

          is_admin: true,

          is_updated_by_user:
            true,

          facilities:
            rawData.facilities ||
            'Water, Power, First Aid',

          total_beds:
            Number(
              rawData.total_beds ||
                rawData.capacity ||
                100
            ),

          available_beds:
            Number(
              rawData.available_beds ||
                rawData.capacity ||
                100
            ),

          occupied_beds:
            Number(
              rawData.occupied_beds ||
                0
            ),
        };

      setShelters(
        (prevShelters) => {
          const updated = [
            formattedNewShelter,
            ...prevShelters,
          ];

          return updated.sort(
            (a, b) => {
              if (
                a.is_admin &&
                !b.is_admin
              ) {
                return -1;
              }

              if (
                !a.is_admin &&
                b.is_admin
              ) {
                return 1;
              }

              return (
                a.distNum -
                b.distNum
              );
            }
          );
        }
      );

      setSelectedShelter(
        formattedNewShelter
      );

      setRouteTarget(
        formattedNewShelter
      );

      setIsModalOpen(
        false
      );
    };

  /* =========================================================
     BED COUNT UPDATE
  ========================================================= */

  const handleBedsChanged =
    (updatedShelter) => {
      const updateTime =
        new Date().toISOString();

      setShelters(
        (currentShelters) =>
          currentShelters.map(
            (item) =>
              item.id ===
                `admin_${updatedShelter.id}` ||
              item.id ===
                updatedShelter.id
                ? {
                    ...item,
                    ...updatedShelter,
                    id: `admin_${updatedShelter.id}`,
                    is_admin: true,
                    is_updated_by_user:
                      true,
                    created_at:
                      updateTime,
                  }
                : item
          )
      );

      setSelectedShelter(
        (current) =>
          current?.id ===
            `admin_${updatedShelter.id}` ||
          current?.id ===
            updatedShelter.id
            ? {
                ...current,
                ...updatedShelter,
                id: `admin_${updatedShelter.id}`,
                is_admin: true,
                is_updated_by_user:
                  true,
                created_at:
                  updateTime,
              }
            : current
      );

      setRouteTarget(
        (current) =>
          current?.id ===
            `admin_${updatedShelter.id}` ||
          current?.id ===
            updatedShelter.id
            ? {
                ...current,
                ...updatedShelter,
                id: `admin_${updatedShelter.id}`,
                is_admin: true,
                is_updated_by_user:
                  true,
                created_at:
                  updateTime,
              }
            : current
      );
    };

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <div className="dashboard-page">

      {/* =====================================================
          INTRO
      ===================================================== */}

      <section className="dashboard-intro">
        <div>
          <p className="eyebrow">
            CITIZEN RESPONSE CENTER
          </p>

          <h1>
            Know the ground. Move with confidence.
          </h1>
        </div>
      </section>

      {/* =====================================================
          MAP SECTION
      ===================================================== */}

      <section className="dashboard-section map-section">

        <div className="section-heading">

          <div>
            <h2>
              Interactive Map
            </h2>
          </div>

          <div className="layer-controls">

            {[
              'all',
              'incidents',
              'shelters',
              'risk',
            ].map(
              (layer) => (
                <button
                  className={
                    activeLayer ===
                    layer
                      ? 'layer-button active'
                      : 'layer-button'
                  }
                  key={layer}
                  onClick={() =>
                    setActiveLayer(
                      layer
                    )
                  }
                >
                  {layer[0].toUpperCase() +
                    layer.slice(1)}
                </button>
              )
            )}

          </div>
        </div>

        {/* =================================================
            DESTINATION SEARCH
        ================================================= */}

        <form
          onSubmit={
            handleDestinationSearch
          }
          style={{
            display: 'flex',
            gap: '8px',
            marginBottom:
              '0.75rem',
            alignItems:
              'center',
          }}
        >

          <input
            type="text"
            placeholder="Search destination city or trip location for safe route..."
            value={
              destinationSearch
            }
            onChange={(e) =>
              setDestinationSearch(
                e.target.value
              )
            }
            style={{
              flex: 1,
              padding:
                '8px 12px',
              borderRadius:
                '6px',
              border:
                '1px solid rgba(255, 255, 255, 0.2)',
              backgroundColor:
                'rgba(255, 255, 255, 0.05)',
              color:
                '#ffffff',
              fontSize:
                '0.9rem',
              outline:
                'none',
            }}
          />

          <button
            type="submit"
            disabled={
              isSearchingDestination
            }
            style={{
              backgroundColor:
                '#2563eb',
              color:
                '#ffffff',
              border:
                'none',
              padding:
                '8px 16px',
              borderRadius:
                '6px',
              fontWeight:
                'bold',
              cursor:
                'pointer',
              fontSize:
                '0.9rem',
              whiteSpace:
                'nowrap',
              opacity:
                isSearchingDestination
                  ? 0.7
                  : 1,
            }}
          >
            {isSearchingDestination
              ? '🔍 Searching...'
              : '🔍 Find Safe Route'}
          </button>

        </form>

        {/* =================================================
            MAP
        ================================================= */}

        <LiveMap
          activeLayer={
            activeLayer
          }
          incidents={
            incidents
          }
          shelters={
            shelters
          }
          selectedShelter={
            selectedShelter
          }
          onShelterSelect={
            handleShelterSelect
          }
          userCoords={
            userCoords
          }
          onLocationChange={
            handleLocationChange
          }
          safeRoute={
            safeRoute
          }
        />

        {/* =================================================
            SELECTED DESTINATION / SHELTER
        ================================================= */}

        <div
          className="map-selection"
          style={{
            marginTop:
              '1rem',
          }}
        >

          {routeTarget ? (
            <>

              <strong>
                {routeTarget.name}
              </strong>

              <span
                style={{
                  margin:
                    '0 0.5rem',
                }}
              >
                {routeTarget.distance ||
                  'Destination selected'}
              </span>

              {!routeTarget.isDestination && (
                <span
                  style={{
                    color:
                      routeTarget.is_safe
                        ? '#53b889'
                        : '#d94a5f',
                    fontWeight:
                      'bold',
                  }}
                >
                  {routeTarget.is_safe
                    ? 'Safe Shelter'
                    : 'Unsafe Shelter'}
                  {' '}
                  (ML Risk:{' '}
                  {routeTarget.risk_level ||
                    'N/A'}
                  )
                </span>
              )}

              {routeTarget.isDestination && (
                <span
                  style={{
                    color:
                      '#60a5fa',
                    fontWeight:
                      'bold',
                  }}
                >
                  📍 Destination
                </span>
              )}

            </>
          ) : (
            <span>
              {loadingShelters
                ? 'Analyzing risk levels for local shelters...'
                : 'Select a shelter or search for a destination'}
            </span>
          )}

          <span
            className="location-status"
            style={{
              display:
                'block',
              marginTop:
                '0.25rem',
            }}
          >
            {locationMessage}
          </span>

        </div>

        {/* =================================================
            ROUTE INFORMATION
        ================================================= */}

        {safeRoute && (
          <div
            style={{
              marginTop:
                '1rem',
              padding:
                '14px 16px',
              borderRadius:
                '10px',
              background:
                'rgba(37, 99, 235, 0.10)',
              border:
                '1px solid rgba(37, 99, 235, 0.35)',
            }}
          >

            <div
              style={{
                display:
                  'flex',
                justifyContent:
                  'space-between',
                alignItems:
                  'center',
                flexWrap:
                  'wrap',
                gap:
                  '12px',
              }}
            >

              <div>

                <div
                  style={{
                    fontSize:
                      '0.8rem',
                    color:
                      '#94a3b8',
                    marginBottom:
                      '4px',
                  }}
                >
                  ROUTE
                </div>

                <div
                  style={{
                    fontSize:
                      '1.1rem',
                    fontWeight:
                      'bold',
                  }}
                >
                  🛣️{' '}
                  {safeRoute.distance}{' '}
                  km
                </div>

              </div>

              <div>

                <div
                  style={{
                    fontSize:
                      '0.8rem',
                    color:
                      '#94a3b8',
                    marginBottom:
                      '4px',
                  }}
                >
                  ESTIMATED TIME
                </div>

                <div
                  style={{
                    fontSize:
                      '1.1rem',
                    fontWeight:
                      'bold',
                  }}
                >
                  ⏱️{' '}
                  {safeRoute.durationText ||
                    formatRouteTime(
                      safeRoute.duration
                    )}
                </div>

              </div>

              <div>

                <div
                  style={{
                    fontSize:
                      '0.8rem',
                    color:
                      '#94a3b8',
                    marginBottom:
                      '4px',
                  }}
                >
                  ROUTE STATUS
                </div>

                <div
                  style={{
                    fontSize:
                      '0.95rem',
                    fontWeight:
                      'bold',
                    color:
                      safeRoute.wasSafe
                        ? '#53b889'
                        : '#f59e0b',
                  }}
                >
                  {safeRoute.wasSafe
                    ? '✓ Incidents avoided'
                    : '⚠️ Best available route'}
                </div>

              </div>

            </div>

            {safeRoute.incidentCount >
              0 && (
              <div
                style={{
                  marginTop:
                    '10px',
                  paddingTop:
                    '10px',
                  borderTop:
                    '1px solid rgba(255,255,255,0.1)',
                  fontSize:
                    '0.85rem',
                  color:
                    '#cbd5e1',
                }}
              >
                🚨 Verified incidents were
                considered while calculating
                this route.
              </div>
            )}

          </div>
        )}

        {/* =================================================
            DIRECTIONS BUTTON
        ================================================= */}

        <div
          style={{
            marginTop:
              '1rem',
          }}
        >

          <button
            onClick={
              handleShowDirections
            }
            disabled={
              !routeTarget ||
              isCalculatingRoute
            }
            style={{
              backgroundColor:
                '#10b981',
              color:
                '#ffffff',
              border:
                'none',
              padding:
                '12px 20px',
              borderRadius:
                '8px',
              fontWeight:
                'bold',
              cursor:
                routeTarget &&
                !isCalculatingRoute
                  ? 'pointer'
                  : 'not-allowed',
              opacity:
                routeTarget &&
                !isCalculatingRoute
                  ? 1
                  : 0.6,
              display:
                'flex',
              alignItems:
                'center',
              justifyContent:
                'center',
              gap:
                '8px',
              boxShadow:
                '0 4px 12px rgba(16, 185, 129, 0.3)',
              width:
                '100%',
              fontSize:
                '1rem',
            }}
          >

            {isCalculatingRoute
              ? '🔄 Calculating Safest Shortest Route...'
              : '🗺️ Show Directions'}

          </button>

        </div>

      </section>

      {/* =====================================================
          NEARBY SHELTERS
      ===================================================== */}

      <section className="dashboard-section">

        <div
          className="section-heading"
          style={{
            display:
              'flex',
            justifyContent:
              'space-between',
            alignItems:
              'center',
            marginBottom:
              '1rem',
          }}
        >

          <div>

            <h2>
              Nearby Relief Shelters
            </h2>

            <span
              className="section-count"
              style={{
                display:
                  'block',
                marginTop:
                  '0.25rem',
              }}
            >
              {loadingShelters
                ? 'Evaluating ML Safety...'
                : `${shelters.length} centers found`}
            </span>

          </div>

          <button
            onClick={() =>
              setIsModalOpen(
                true
              )
            }
            style={{
              backgroundColor:
                '#2563eb',
              color:
                '#ffffff',
              border:
                'none',
              padding:
                '10px 18px',
              borderRadius:
                '8px',
              fontWeight:
                'bold',
              cursor:
                'pointer',
              display:
                'flex',
              alignItems:
                'center',
              gap:
                '8px',
              boxShadow:
                '0 4px 12px rgba(37, 99, 235, 0.3)',
            }}
          >
            ➕ Report / Add Shelter
          </button>

        </div>

        <div className="shelter-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

          {shelters.map(
            (shelter) => (
              <ShelterCard
                key={
                  shelter.id
                }
                shelter={
                  shelter
                }
                isSelected={
                  selectedShelter?.id ===
                  shelter.id
                }
                onSelect={
                  handleShelterSelect
                }
                onBedsChanged={
                  handleBedsChanged
                }
              />
            )
          )}

        </div>

      </section>

      {/* =====================================================
          ML TABLE
      ===================================================== */}

      <section className="dashboard-section">

        <div className="section-heading">

          <div>
            <h2>
              ML Model Safety Assessment for Nearby Shelters
            </h2>
          </div>

        </div>

        <div
          style={{
            overflowX:
              'auto',
          }}
        >

          <table
            style={{
              width:
                '100%',
              borderCollapse:
                'collapse',
              marginTop:
                '1rem',
            }}
          >

            <thead>

              <tr
                style={{
                  background:
                    'rgba(255, 255, 255, 0.05)',
                  textAlign:
                    'left',
                }}
              >

                <th
                  style={{
                    padding:
                      '0.75rem',
                  }}
                >
                  Location / Address
                </th>

                <th
                  style={{
                    padding:
                      '0.75rem',
                  }}
                >
                  Shelter Name
                </th>

                <th
                  style={{
                    padding:
                      '0.75rem',
                  }}
                >
                  Distance
                </th>

                <th
                  style={{
                    padding:
                      '0.75rem',
                  }}
                >
                  ML Risk Level
                </th>

                <th
                  style={{
                    padding:
                      '0.75rem',
                  }}
                >
                  High Flood Probability
                </th>

                <th
                  style={{
                    padding:
                      '0.75rem',
                  }}
                >
                  Safety Status
                </th>

                <th
                  style={{
                    padding:
                      '0.75rem',
                  }}
                >
                  Reported Time
                </th>

              </tr>

            </thead>

            <tbody>

              {shelters.map(
                (s) => (
                  <tr
                    key={s.id}
                    style={{
                      borderBottom:
                        '1px solid rgba(255,255,255,0.1)',
                    }}
                  >

                    <td
                      style={{
                        padding:
                          '0.75rem',
                        fontSize:
                          '0.85rem',
                        color:
                          '#cbd5e1',
                        maxWidth:
                          '280px',
                      }}
                    >
                      {s.full_address ||
                        s.location_name ||
                        'Address unavailable'}
                    </td>

                    <td
                      style={{
                        padding:
                          '0.75rem',
                      }}
                    >
                      {s.name}
                    </td>

                    <td
                      style={{
                        padding:
                          '0.75rem',
                      }}
                    >
                      {s.distance}
                    </td>

                    <td
                      style={{
                        padding:
                          '0.75rem',
                      }}
                    >
                      {s.risk_level ||
                        'N/A'}
                    </td>

                    <td
                      style={{
                        padding:
                          '0.75rem',
                      }}
                    >
                      {s.high_probability !==
                        undefined
                        ? `${(
                            s.high_probability *
                            100
                          ).toFixed(
                            2
                          )}%`
                        : 'N/A'}
                    </td>

                    <td
                      style={{
                        padding:
                          '0.75rem',
                        color:
                          s.is_safe
                            ? '#53b889'
                            : '#d94a5f',
                        fontWeight:
                          'bold',
                      }}
                    >
                      {s.is_safe
                        ? '✓ Safe Shelter'
                        : '⚠️ Unsafe (Avoid)'}
                    </td>

                    <td
                      style={{
                        padding:
                          '0.75rem',
                        fontSize:
                          '0.85rem',
                        color:
                          '#a1a1aa',
                      }}
                    >
                      {formatUploadedTime(
                        s.created_at
                      )}
                    </td>

                  </tr>
                )
              )}

            </tbody>

          </table>

        </div>

      </section>

      {/* =====================================================
          ADD SHELTER MODAL
      ===================================================== */}

      <AddShelterModal
        isOpen={
          isModalOpen
        }
        onClose={() =>
          setIsModalOpen(
            false
          )
        }
        userCoords={
          userCoords
        }
        onShelterAdded={
          handleShelterAdded
        }
      />

    </div>
  );
}