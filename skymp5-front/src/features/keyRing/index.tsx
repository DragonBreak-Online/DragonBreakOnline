import React, { useEffect, useState } from 'react';

import './styles.scss';

// The Key Ring (server keyring.js, widget 91; housingSystem.ts with housingKeyRing): keys are records on the character, grouped
// by property. A key is given to a player beside you, who accepts it here; an owner cuts keys and takes single copies back.
// Actions go to the server as dbo:keyRing* events with the window's nonce; the server answers with the panel again.
export interface RingKey { name: string; place: string; opens: boolean }
export interface NearPlayer { actor: number; name: string }
export interface KeyCopy { name: string; holder: string }
export interface OwnedLock { ref: number; place: string; copies: KeyCopy[] }

export interface KeyRingData {
  id: number;
  nonce: string;
  keys: RingKey[];
  near: NearPlayer[];
  owned: OwnedLock[];
  offer: { from: string; key: string } | null;
  result: string;
  resultKind: string;
}

const send = (key: string, ...args: unknown[]): void => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).skyrimPlatform.sendMessage(key, ...args);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('keyRing sendMessage', key, args);
  }
};

const BUSY_TIMEOUT_MS = 8000;

export const groupByPlace = (keys: RingKey[]): Array<{ place: string; keys: RingKey[] }> => {
  const groups: Array<{ place: string; keys: RingKey[] }> = [];
  for (const k of keys) {
    const place = k.place || 'Other keys';
    const g = groups.find((x) => x.place === place);
    if (g) g.keys.push(k);
    else groups.push({ place, keys: [k] });
  }
  return groups;
};

// Players beside you, as buttons (a native select draws nothing in game)
const PickPlayer = ({ near, onPick, onCancel, busy }: { near: NearPlayer[]; onPick: (actor: number) => void; onCancel: () => void; busy: boolean }) => (
  <div className="keyRing__pick">
    {near.map((p) => (
      <button key={p.actor} className="keyRing__button keyRing__button--small" disabled={busy} onClick={() => onPick(p.actor)}>{p.name}</button>
    ))}
    {near.length === 0 && <span className="keyRing__empty">Nobody stands beside you.</span>}
    <button className="keyRing__link" onClick={onCancel}>Cancel</button>
  </div>
);

// What the ring shows, in the panel and in the journal's Keys tab alike (keyring.js ringView)
export type KeyRingView = Pick<KeyRingData, 'keys' | 'near' | 'owned' | 'offer'>;

// The ring's content: an offer, your keys by property, then your own locks with every copy out. act(event, ...args) sends a
// dbo:keyRing* event with the window's nonce (the panel's own, or the journal's); busy holds every button until the answer.
export const KeyRingBody = ({ view, busy, act }: { view: KeyRingView; busy: boolean; act: (event: string, ...args: unknown[]) => void }) => {
  // What is waiting for a player to be picked: "give:<key>" or "cut:<ref>"
  const [picking, setPicking] = useState('');
  useEffect(() => { setPicking(''); }, [view]);
  const near = view.near || [];
  const owned = view.owned || [];

  return (
    <>
      {view.offer && (
        <div className="keyRing__offer">
          <span>{view.offer.from} offers you <b>{view.offer.key}</b>.</span>
          <span className="keyRing__buttons">
            <button className="keyRing__button" disabled={busy} onClick={() => act('dbo:keyRingAnswer', true)}>Accept</button>
            <button className="keyRing__button" disabled={busy} onClick={() => act('dbo:keyRingAnswer', false)}>Decline</button>
          </span>
        </div>
      )}

      <div className="keyRing__section">
        <span className="keyRing__label">Your keys</span>
        {(view.keys || []).length === 0 && <span className="keyRing__empty">No keys. The owner of a property can cut one for you.</span>}
        {groupByPlace(view.keys || []).map((g) => (
          <div key={g.place} className="keyRing__group">
            <span className="keyRing__place">{g.place}</span>
            {g.keys.map((k) => (
              <div key={k.name} className="keyRing__entry">
                <div className="keyRing__row">
                  <span className="keyRing__name">{k.name}</span>
                  <span className={'keyRing__state' + (k.opens ? '' : ' keyRing__state--dead')}>{k.opens ? 'Opens' : 'Opens nothing'}</span>
                  <button className="keyRing__button keyRing__button--small" disabled={busy} onClick={() => setPicking(picking === `give:${k.name}` ? '' : `give:${k.name}`)}>Give</button>
                </div>
                {picking === `give:${k.name}` && <PickPlayer near={near} busy={busy} onCancel={() => setPicking('')} onPick={(a) => act('dbo:keyRingGive', k.name, a)} />}
              </div>
            ))}
          </div>
        ))}
      </div>

      {owned.length > 0 && (
        <div className="keyRing__section">
          <span className="keyRing__label">Your properties</span>
          {owned.map((o) => (
            <div key={o.ref} className="keyRing__group">
              <div className="keyRing__row">
                <span className="keyRing__place">{o.place}</span>
                <button className="keyRing__button keyRing__button--small" disabled={busy} onClick={() => act('dbo:keyRingCut', o.ref, 0)}>Cut a key</button>
                <button className="keyRing__button keyRing__button--small" disabled={busy} onClick={() => setPicking(picking === `cut:${o.ref}` ? '' : `cut:${o.ref}`)}>Cut for...</button>
              </div>
              {picking === `cut:${o.ref}` && <PickPlayer near={near} busy={busy} onCancel={() => setPicking('')} onPick={(a) => act('dbo:keyRingCut', o.ref, a)} />}
              {(o.copies || []).length === 0 && <span className="keyRing__empty">No keys are out.</span>}
              {(o.copies || []).map((c) => (
                <div key={c.name} className="keyRing__row keyRing__row--copy">
                  <span className="keyRing__name">{c.name}</span>
                  <span className="keyRing__state">{c.holder ? `Held by ${c.holder}` : 'Holder unknown'}</span>
                  <button className="keyRing__button keyRing__button--small" disabled={busy} onClick={() => act('dbo:keyRingTake', o.ref, c.name)}>Take back</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <p className="keyRing__note">A key opens its door even when it is locked. Taking a key back stops it opening at once, wherever it is.</p>
    </>
  );
};

const KeyRing = ({ data }: { data: KeyRingData }) => {
  const [busy, setBusy] = useState(false);

  useEffect(() => { setBusy(false); }, [data]);
  useEffect(() => {
    if (!busy) return undefined;
    const t = setTimeout(() => setBusy(false), BUSY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [busy]);

  const act = (event: string, ...args: unknown[]): void => {
    if (busy) return;
    setBusy(true);
    send(event, data.nonce, ...args);
  };

  return (
    <div className="keyRing">
      <div className="keyRing__fade" />
      <div className="keyRing__panel">
        <h2 className="keyRing__title">Key Ring</h2>
        <KeyRingBody view={data} busy={busy} act={act} />
        {data.result && <p className={'keyRing__result keyRing__result--' + (data.resultKind || 'ok')}>{data.result}</p>}
        <button className="keyRing__close" onClick={() => send('dbo:keyRingClose')}>Close</button>
      </div>
    </div>
  );
};

export default KeyRing;
