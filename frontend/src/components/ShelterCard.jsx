import { useState } from 'react';
import API from '../api/axios';

function formatPostTime(dateString) {
  if (!dateString) return 'Not available';

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function parseInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function ShelterCard({
  shelter = {},
  isSelected = false,
  onSelect,
  onBedsChanged,
}) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  // --- Image Resolution ---
  const rawImage = shelter.photoUrl || shelter.image_url || shelter.image || shelter.photo;
  let imageUrl = null;

  if (rawImage) {
    const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
    imageUrl = /^https?:\/\/|^data:image/.test(rawImage)
      ? rawImage
      : `${baseURL.replace(/\/$/, '')}/${rawImage.replace(/^\//, '')}`;
  }

  // --- Bed Metrics Calculation ---
  const hasBedData =
    shelter.total_beds !== null &&
    shelter.total_beds !== undefined &&
    parseInteger(shelter.total_beds, 0) > 0;

  const totalBeds = hasBedData ? parseInteger(shelter.total_beds) : 0;
  const occupiedBeds = parseInteger(shelter.occupied_beds, 0);

  const availableBeds = hasBedData
    ? Math.min(
        totalBeds,
        Math.max(
          0,
          shelter.available_beds !== null && shelter.available_beds !== undefined
            ? parseInteger(shelter.available_beds)
            : totalBeds - occupiedBeds
        )
      )
    : 0;

  // --- Bed Updates Handler ---
  const handleBedUpdate = async (action, event) => {
    event.stopPropagation();
    setHasInteracted(true); // Reveal image on click interaction

    setIsUpdating(true);
    try {
      let updatedData = { ...shelter };
      
      // Fallback or optimistic update locally if API fails or for client updates
      if (action === 'remove' && availableBeds > 0) {
        updatedData.available_beds = availableBeds - 1;
        updatedData.occupied_beds = occupiedBeds + 1;
      } else if (action === 'add' && availableBeds < totalBeds) {
        updatedData.available_beds = availableBeds + 1;
        updatedData.occupied_beds = Math.max(0, occupiedBeds - 1);
      }
      
      updatedData.created_at = new Date().toISOString();
      updatedData.is_updated_by_user = true;

      try {
        const response = await API.patch(`/shelters/${shelter.id}/beds`, { action });
        if (response.data) {
          updatedData = {
            ...response.data?.data || response.data,
            created_at: new Date().toISOString(),
            is_updated_by_user: true
          };
        }
      } catch (err) {
        console.warn('API Endpoint failed, performing local capacity state sync:', err);
      }

      if (onBedsChanged) {
        onBedsChanged(updatedData);
      }
    } catch (error) {
      console.error('Failed to update bed capacity:', error);
      alert(error.response?.data?.message || 'Unable to modify bed allocation.');
    } finally {
      setIsUpdating(false);
    }
  };

  const rawTimestamp =
    shelter.created_at ||
    shelter.createdAt ||
    shelter.timestamp ||
    shelter.created_time ||
    shelter.uploaded_at;

  const isSafe = shelter.is_safe !== false;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect && onSelect(shelter)}
      onKeyDown={(e) => e.key === 'Enter' && onSelect && onSelect(shelter)}
      style={{
        backgroundColor: '#0f172a',
        color: '#f8fafc',
        borderRadius: '16px',
        padding: '16px',
        border: isSelected ? '2px solid #3b82f6' : '1px solid #1e293b',
        boxShadow: isSelected
          ? '0 0 16px rgba(59, 130, 246, 0.3)'
          : '0 4px 12px rgba(0, 0, 0, 0.25)',
        cursor: 'pointer',
        transition: 'all 0.2s ease-in-out',
        display: 'flex',
        flexDirection: 'column',
        justify: 'space-between',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Header Preview Image */}
      <div
        style={{
          width: '100%',
          height: '150px',
          borderRadius: '10px',
          overflow: 'hidden',
          backgroundColor: '#1e293b',
          marginBottom: '14px',
          position: 'relative',
        }}
      >
        {hasInteracted && imageUrl ? (
          <img
            src={imageUrl}
            alt={shelter.name || 'Shelter Image'}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#64748b',
              fontSize: '0.85rem',
              fontWeight: '500',
              padding: '12px',
              textAlign: 'center',
            }}
          >
            {hasInteracted ? '📷 No Image Available' : '🔒 Click Occupy/Vacate to reveal photo'}
          </div>
        )}

        {/* Safety Badge */}
        <span
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            padding: '4px 10px',
            fontSize: '0.75rem',
            fontWeight: '700',
            borderRadius: '20px',
            backdropFilter: 'blur(8px)',
            backgroundColor: isSafe ? 'rgba(16, 185, 129, 0.85)' : 'rgba(239, 68, 68, 0.85)',
            color: '#ffffff',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
          }}
        >
          {isSafe ? '✓ Safe Zone' : '⚠️ Warning'}
        </span>
      </div>

      {/* Primary Details */}
      <div style={{ flex: 1 }}>
        <h3
          style={{
            margin: '0 0 6px 0',
            fontSize: '1.15rem',
            fontWeight: '700',
            color: '#ffffff',
            lineHeight: '1.3',
          }}
        >
          {shelter.name || 'Unnamed Shelter'}
        </h3>

        <p style={subTextStyle}>
          📍 <span style={{ color: '#e2e8f0', fontWeight: '600' }}>{shelter.full_address || shelter.location_name || shelter.distance || 'N/A'}</span>
        </p>

        <p style={subTextStyle}>
          🕒 Posted: <span style={{ color: '#cbd5e1' }}>{formatPostTime(rawTimestamp)}</span>
        </p>

        {/* Capacity & Live Management */}
        <div
          style={{
            backgroundColor: '#1e293b',
            padding: '12px',
            borderRadius: '10px',
            margin: '12px 0',
            border: '1px solid #334155',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '10px',
            }}
          >
            <span style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: '500' }}>
              Bed Availability
            </span>
            <span
              style={{
                fontSize: '0.85rem',
                fontWeight: '700',
                color: !hasBedData
                  ? '#64748b'
                  : availableBeds > 0
                  ? '#10b981'
                  : '#ef4444',
              }}
            >
              {hasBedData ? `${availableBeds} / ${totalBeds} Left` : 'Not Tracked'}
            </span>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              disabled={isUpdating || (hasBedData && availableBeds <= 0)}
              onClick={(e) => handleBedUpdate('remove', e)}
              style={{
                ...buttonStyle,
                backgroundColor: '#dc2626',
                opacity: isUpdating || (hasBedData && availableBeds <= 0) ? 0.4 : 1,
              }}
            >
              − Occupy Bed
            </button>

            <button
              type="button"
              disabled={isUpdating || (hasBedData && availableBeds >= totalBeds)}
              onClick={(e) => handleBedUpdate('add', e)}
              style={{
                ...buttonStyle,
                backgroundColor: '#059669',
                opacity: isUpdating || (hasBedData && availableBeds >= totalBeds) ? 0.4 : 1,
              }}
            >
              + Vacate Bed
            </button>
          </div>
        </div>

        {/* Metadata Footer */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem' }}>
          <div style={{ color: '#94a3b8' }}>
            <span style={{ color: '#64748b', fontWeight: '600' }}>Risk Assessment: </span>
            <span style={{ color: '#e2e8f0' }}>{shelter.risk_level || 'Low Risk'}</span>
          </div>
          <div style={{ color: '#94a3b8' }}>
            <span style={{ color: '#64748b', fontWeight: '600' }}>Facilities: </span>
            <span style={{ color: '#e2e8f0' }}>
              {shelter.facilities || 'Water, Power, First Aid'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const subTextStyle = {
  margin: '0 0 6px 0',
  fontSize: '0.825rem',
  color: '#94a3b8',
};

const buttonStyle = {
  flex: 1,
  border: 'none',
  borderRadius: '6px',
  padding: '8px',
  color: '#ffffff',
  fontSize: '0.8rem',
  fontWeight: '600',
  cursor: 'pointer',
  transition: 'opacity 0.15s ease',
};