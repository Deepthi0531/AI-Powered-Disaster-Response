import React from 'react';

// Formatter to convert any valid date/timestamp string to an exact formatted string
function formatPostTime(dateString) {
  if (!dateString) {
    // Fallback to current date and time if no creation date is present in the record
    return new Date().toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  }

  const postDate = new Date(dateString);

  // Check if date parsing succeeded
  if (isNaN(postDate.getTime())) {
    return dateString; // Return as-is if backend sends pre-formatted text
  }

  // Exact date/time formatting: e.g. "03 Sep 2026, 01:12 PM"
  return postDate.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

const ShelterCard = ({ shelter, isSelected, onSelect }) => {
  const backendBaseUrl = "http://localhost:5000";

  const hasImage = Boolean(shelter.image_url);
  const imageUrl = hasImage ? `${backendBaseUrl}${shelter.image_url}` : null;

  const availableBeds = shelter.available_beds ?? (shelter.capacity ? shelter.capacity - (shelter.occupied_beds || 0) : 'N/A');
  const totalBeds = shelter.total_beds ?? shelter.capacity ?? 'N/A';

  // Format exact creation timestamp
  const displayTime = formatPostTime(shelter.created_at || shelter.timestamp || shelter.created_time);

  return (
    <div
      onClick={() => onSelect(shelter)}
      style={{
        backgroundColor: '#0f172a',
        color: '#ffffff',
        borderRadius: '12px',
        padding: '16px',
        border: isSelected ? '2px solid #3b82f6' : '1px solid #334155',
        boxShadow: isSelected ? '0 0 12px rgba(59, 130, 246, 0.4)' : '0 4px 6px rgba(0, 0, 0, 0.3)',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        transition: 'all 0.2s ease-in-out',
      }}
    >
      {/* Shelter Image */}
      <div style={{ width: '100%', height: '140px', marginBottom: '12px', borderRadius: '8px', overflow: 'hidden' }}>
        {hasImage ? (
          <img
            src={imageUrl}
            alt={shelter.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              backgroundColor: '#1e293b',
              color: '#94a3b8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.85rem',
              fontWeight: '500',
            }}
          >
            📷 No Image Uploaded
          </div>
        )}
      </div>

      {/* Details */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 'bold', color: '#f8fafc' }}>
            {shelter.name}
          </h3>
          <span
            style={{
              padding: '2px 8px',
              fontSize: '0.75rem',
              fontWeight: '600',
              borderRadius: '4px',
              backgroundColor: shelter.is_safe !== false ? 'rgba(16, 185, 129, 0.2)' : 'rgba(244, 63, 94, 0.2)',
              color: shelter.is_safe !== false ? '#34d399' : '#f87171',
              border: shelter.is_safe !== false ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(244, 63, 94, 0.4)',
            }}
          >
            {shelter.is_safe !== false ? 'Safe' : 'Unsafe'}
          </span>
        </div>

        {/* Location & Exact Posted Timestamp */}
        <p style={{ margin: '0 0 4px 0', fontSize: '0.8rem', color: '#94a3b8' }}>
          📍 {shelter.location_name || `${shelter.distance || 'Near'} away`}
        </p>
        <p style={{ margin: '0 0 12px 0', fontSize: '0.8rem', color: '#94a3b8' }}>
          🕒 Posted: <strong style={{ color: '#e2e8f0' }}>{displayTime}</strong>
        </p>

        {/* Available Space / Beds */}
        <div
          style={{
            backgroundColor: '#1e293b',
            padding: '8px 12px',
            borderRadius: '6px',
            marginBottom: '12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.85rem',
          }}
        >
          <span style={{ color: '#cbd5e1' }}>Available Beds:</span>
          <span style={{ fontWeight: 'bold', color: availableBeds > 0 || availableBeds === 'N/A' ? '#34d399' : '#f87171' }}>
            {availableBeds} / {totalBeds}
          </span>
        </div>

        {/* Risk & Facilities */}
        <p style={{ margin: '0 0 4px 0', fontSize: '0.8rem', color: '#cbd5e1' }}>
          <strong style={{ color: '#94a3b8' }}>ML Risk:</strong> {shelter.risk_level || 'Low Risk'}
        </p>
        <p style={{ margin: 0, fontSize: '0.8rem', color: '#94a3b8' }}>
          <strong style={{ color: '#cbd5e1' }}>Facilities:</strong> {shelter.facilities || 'Water, Emergency Shelter, Power'}
        </p>
      </div>
    </div>
  );
};

export default ShelterCard;