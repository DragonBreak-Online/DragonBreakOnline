import React from 'react';

import './styles.scss';

// Letter icons over nearby notice boards while unread pigeons wait (client BoardMailService, widget "mailMarkers")
export interface MailMarker {
  x: number;
  y: number;
  near: number;
}

export interface MailMarkersData {
  id: number;
  markers: MailMarker[];
  unread: number;
}

// A thin bone-white pointer with an envelope, drawn as Skyrim's own HUD markers are (Nate, 19 Oct: the gold medallion
// felt out of place): no glow, no bob, fainter with distance; the count of letters is in the pigeon window
const MailIcon = () => (
  <svg className="mailMarkers__icon" viewBox="0 0 34 44" aria-hidden="true">
    <path d="M3 3 H31 V25 L17 41 L3 25 Z" className="mailMarkers__pin" />
    <rect x="9" y="10" width="16" height="11" className="mailMarkers__line" />
    <path d="M9 10 L17 16.5 L25 10" className="mailMarkers__line" />
  </svg>
);

const MailMarkers = ({ data }: { data: MailMarkersData }) => (
  <div className="mailMarkers">
    {(data.markers || []).map((m, i) => {
      const near = Math.max(0, Math.min(1, m.near));
      return (
        <div
          key={i}
          className="mailMarkers__marker"
          style={{ left: (m.x * 100) + '%', top: (m.y * 100) + '%', opacity: 0.45 + 0.5 * near, transform: 'translate(-50%, -100%) scale(' + (0.7 + 0.4 * near) + ')' }}
        >
          <MailIcon />
        </div>
      );
    })}
  </div>
);

export default MailMarkers;
