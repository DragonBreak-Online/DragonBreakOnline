import React, { useEffect } from 'react';

import './styles.scss';

// The realm's legend over Skyrim's own M map (client mapRealmService, widget 210). Display only: the map keeps the keyboard
// and the mouse, so a kind is shown or hidden with its digit (0 for everything else) and the legend with R. The client
// shrinks the hidden markers' clips; this only says what is shown.
export interface MapRealmRow { id: string; label: string; key: string; count: number; shown: boolean }
export interface MapRealmData { type: 'mapRealm'; id: number; mapMode: boolean; shown: boolean; test?: boolean; rows: MapRealmRow[] }

const send = (key: string): void => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).skyrimPlatform.sendMessage(key);
  } catch (e) { /* outside the game */ }
};

// Our own line drawings for each kind: the map itself shows the engine's vanilla icons
const Glyph = ({ id }: { id: string }) => {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 } as const;
  switch (id) {
    case 'seat': return <svg viewBox="0 0 30 30" className="mapRealm__glyph"><path {...s} d="M5 25 V12 L9 9 V5 H12 V9 L15 6 L18 9 V5 H21 V9 L25 12 V25 Z" /><path {...s} strokeWidth={1.4} d="M13 25 V19 Q15 16.5 17 19 V25" /></svg>;
    case 'town': return <svg viewBox="0 0 30 30" className="mapRealm__glyph"><path {...s} d="M4 25 V15 L10 10 L16 15 V25 Z M16 25 V13 L21 9 L26 13 V25" /></svg>;
    case 'village': return <svg viewBox="0 0 30 30" className="mapRealm__glyph"><path {...s} d="M8 25 V15 L15 9 L22 15 V25 Z" /><path {...s} strokeWidth={1.2} d="M13 25 V20 H17 V25" /></svg>;
    case 'fort': return <svg viewBox="0 0 30 30" className="mapRealm__glyph"><path {...s} d="M5 25 V9 H8 V12 H11 V9 H14 V12 H16 V9 H19 V12 H22 V9 H25 V25 Z" /></svg>;
    case 'stronghold': return <svg viewBox="0 0 30 30" className="mapRealm__glyph"><path {...s} d="M6 25 L9 11 L15 6 L21 11 L24 25 Z" /><path {...s} strokeWidth={1.3} d="M11 17 L15 14 L19 17" /></svg>;
    case 'boss': return <svg viewBox="0 0 30 30" className="mapRealm__glyph"><path {...s} d="M15 4 C9 4 6 9 6 13 C6 17 9 19 10 21 V25 H20 V21 C21 19 24 17 24 13 C24 9 21 4 15 4 Z" /><circle cx="11.5" cy="13.5" r="2" fill="currentColor" /><circle cx="18.5" cy="13.5" r="2" fill="currentColor" /></svg>;
    default: return <span className="mapRealm__glyph" />;
  }
};

const MapRealm = ({ data }: { data: MapRealmData }) => {
  // The client's test of whether the browser draws over the map: the widget says it is up
  useEffect(() => { send('mapRealm:mounted'); }, []);
  const rows = data.rows || [];
  const realm = rows.filter((r) => r.id !== 'other');
  const other = rows.find((r) => r.id === 'other');
  return (
    <>
      {data.shown ? (
        <div className="mapRealm">
          <div className="mapRealm__head"><span className="mapRealm__title">The Realm</span></div>
          {data.test ? <div className="mapRealm__sub">Map test: if you can read this, the legend draws over the map.</div> : null}
          <div className="mapRealm__rule" />
          {realm.map((r) => (
            <div key={r.id} className={'mapRealm__row' + (r.shown ? '' : ' mapRealm__row--off')}>
              <span className="mapRealm__key">{r.key}</span>
              <Glyph id={r.id} />
              <span>{r.label}</span>
              <span className="mapRealm__count">{r.count}</span>
            </div>
          ))}
          {other ? (
            <>
              <div className="mapRealm__rule" />
              <div className={'mapRealm__row' + (other.shown ? '' : ' mapRealm__row--off')}>
                <span className="mapRealm__key">{other.key}</span>
                <span className="mapRealm__glyph" />
                <span>{other.label}</span>
                <span className="mapRealm__count">{other.count}</span>
              </div>
            </>
          ) : null}
          <div className="mapRealm__hint">A number shows or hides its places. The realm's places are the map's own markers, so they zoom, turn and fast-travel as every other does.</div>
        </div>
      ) : null}
      <div className="mapRealm__bar"><span className="mapRealm__barkey">R</span>Realm</div>
    </>
  );
};

export default MapRealm;
