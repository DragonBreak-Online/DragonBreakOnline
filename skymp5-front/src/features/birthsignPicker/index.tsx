import React, { useEffect, useState } from 'react';

import './styles.scss';

// The birthsign picker (Nat, 25 Oct: Worker 2's mock _work\birthsigns-widget-mock-1025.html), opened by the gamemode through
// the dbo relay (widget type "birthsignPicker", id 163) for a client whose HUD said 'birthsignPicker' in dbo:uiCaps; any other
// client gets the contextMenu list. The three Guardians head a column each with their charges under them, and a sign that
// answers to no Guardian (the Serpent) sits below. A card shows the sign's lore and its gift; choosing one opens a confirm
// over the grid. There is no "Not yet" (the choice is not optional), but Escape closes, and the server shows it again later.
//
//   Confirm:  sendMessage('dbo:birthsignPick', nonce, signId)
//   Escape:   sendMessage('dbo:birthsignClose', nonce)
// Worker 2's contract: _work\birthsigns-picker-front-spec-1025.md (server birthsigns-1025)
export interface BirthsignEmblem { stars: Array<[number, number]>; lines: Array<[number, number]> }

export interface BirthsignChoice {
  id: string;
  name: string;
  guardian: string;      // '' for a Guardian, a Guardian's id for its charge, 'none' for a sign under no Guardian
  lore: string;
  effect: string;        // birthsigns.js describe()
  emblem?: BirthsignEmblem | null;  // 40 x 40 grid, lines index into stars; null leaves the slot empty
}

export interface BirthsignPickerData {
  id: number;
  nonce?: string;
  title?: string;
  sub?: string;
  signs: BirthsignChoice[];
  notice?: string;
}

const send = (key: string, ...args: unknown[]): void => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).skyrimPlatform.sendMessage(key, ...args);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('birthsignPicker sendMessage', key, args);
  }
};

// Original constellation line-art on a 40 x 40 grid (Worker 2's mock): stars, then the lines between them by index
type Emblem = { s: Array<[number, number]>; l: Array<[number, number]> };
export const EMBLEMS: Record<string, Emblem> = {
  warrior: { s: [[20, 5], [20, 35], [11, 13], [29, 13], [20, 13]], l: [[0, 4], [4, 1], [2, 4], [4, 3]] },
  lady: { s: [[20, 6], [13, 15], [27, 15], [15, 33], [25, 33], [20, 22]], l: [[0, 1], [0, 2], [1, 5], [2, 5], [5, 3], [5, 4]] },
  steed: { s: [[8, 26], [15, 18], [24, 16], [32, 10], [31, 22], [16, 31]], l: [[0, 1], [1, 2], [2, 3], [2, 4], [1, 5]] },
  lord: { s: [[20, 4], [12, 12], [28, 12], [20, 20], [13, 34], [27, 34]], l: [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [3, 5]] },
  mage: { s: [[20, 4], [14, 10], [26, 10], [20, 16], [20, 36]], l: [[0, 1], [1, 3], [3, 2], [2, 0], [3, 4]] },
  apprentice: { s: [[10, 30], [17, 22], [24, 16], [31, 8], [27, 27]], l: [[0, 1], [1, 2], [2, 3], [2, 4]] },
  atronach: { s: [[20, 5], [32, 14], [28, 31], [12, 31], [8, 14], [20, 20]], l: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [5, 0], [5, 2], [5, 3]] },
  ritual: { s: [[20, 6], [30, 14], [30, 28], [20, 34], [10, 28], [10, 14]], l: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [0, 3]] },
  thief: { s: [[10, 8], [18, 16], [22, 24], [30, 32], [30, 10], [10, 30]], l: [[0, 1], [1, 2], [2, 3], [4, 2], [2, 5]] },
  lover: { s: [[20, 34], [8, 18], [14, 8], [20, 14], [26, 8], [32, 18]], l: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]] },
  shadow: { s: [[14, 6], [26, 10], [30, 22], [22, 34], [12, 26]], l: [[0, 1], [1, 2], [2, 3], [3, 4]] },
  tower: { s: [[14, 36], [26, 36], [15, 18], [25, 18], [20, 5]], l: [[0, 2], [1, 3], [2, 3], [2, 4], [3, 4]] },
  serpent: { s: [[6, 30], [12, 22], [20, 26], [26, 16], [32, 20], [34, 8]], l: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]] },
};

// The sign's emblem: the payload's (the server's), or for a payload without the field this front's copy of the same art by
// id. null, or one that is not a list of stars, leaves the slot empty; a line naming a star that is not there is skipped
export const emblemOf = (s: BirthsignChoice): BirthsignEmblem | null => {
  if (s.emblem === null) return null;
  const e = s.emblem !== undefined ? s.emblem : (EMBLEMS[s.id] ? { stars: EMBLEMS[s.id].s, lines: EMBLEMS[s.id].l } : null);
  return e && Array.isArray(e.stars) && e.stars.length ? { stars: e.stars, lines: Array.isArray(e.lines) ? e.lines : [] } : null;
};

const EmblemSvg = ({ sign }: { sign: BirthsignChoice }) => {
  const e = emblemOf(sign);
  if (!e) return null;
  const at = (i: number) => (Array.isArray(e.stars[i]) ? e.stars[i] : null);
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <circle className="birthsign__ring" cx="20" cy="20" r="19" />
      {e.lines.map(([a, b], i) => {
        const p = at(a), q = at(b);
        return p && q ? <line key={'l' + i} className="birthsign__line" x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} /> : null;
      })}
      {e.stars.map(([x, y], i) => <circle key={'s' + i} className="birthsign__star" cx={x} cy={y} r={i === 0 ? 1.9 : 1.5} />)}
    </svg>
  );
};

// The columns: each Guardian (guardian '') with its charges, in the order sent; a charge whose Guardian is not in the list,
// and every sign under no Guardian, goes to the row below
export const layout = (signs: BirthsignChoice[]): { columns: BirthsignChoice[][]; below: BirthsignChoice[] } => {
  const guardians = signs.filter((s) => s.guardian === '');
  const ids = new Set(guardians.map((g) => g.id));
  const columns = guardians.map((g) => [g, ...signs.filter((s) => s.guardian === g.id)]);
  const below = signs.filter((s) => s.guardian !== '' && !ids.has(s.guardian));
  return { columns, below };
};

const BirthsignPicker = ({ data }: { data: BirthsignPickerData }) => {
  const signs = Array.isArray(data.signs) ? data.signs.filter((s) => s && typeof s.id === 'string' && s.id) : [];
  const [selected, setSelected] = useState<string>('');
  const [confirming, setConfirming] = useState<boolean>(false);
  const nonce = data.nonce || '';

  // A new payload (a new nonce) starts again from the grid
  useEffect(() => { setSelected(''); setConfirming(false); }, [nonce]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      if (confirming) { setConfirming(false); return; }
      send('dbo:birthsignClose', nonce);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [nonce, confirming]);

  const shown = signs.find((s) => s.id === selected) || null;
  const { columns, below } = layout(signs);

  const card = (s: BirthsignChoice) => {
    const kicker = s.guardian === '' ? 'Guardian' : s.guardian === 'none' ? 'Wanders' : '';
    return (
      <button
        key={s.id}
        type="button"
        className={'birthsign__card' + (s.guardian === '' ? ' birthsign__card--guardian' : '') + (s.id === selected ? ' birthsign__card--on' : '')}
        onClick={() => setSelected(s.id)}
        onDoubleClick={() => { setSelected(s.id); setConfirming(true); }}
      >
        <span className="birthsign__emblem"><EmblemSvg sign={s} /></span>
        <span className="birthsign__name">{s.name}{kicker ? <span className="birthsign__kicker">{kicker}</span> : null}</span>
        <span className="birthsign__lore">{s.lore}</span>
        <span className="birthsign__effect">{s.effect}</span>
      </button>
    );
  };

  return (
    <div className="birthsign">
      <div className="birthsign__fade" />
      <div className="birthsign__panel">
        <h1 className="birthsign__title">{data.title || 'Choose your birthsign'}</h1>
        <p className="birthsign__sub">{data.sub || 'The stars you were born under. Yours for life; only staff can change it later.'}</p>
        <div className="birthsign__rule" />
        {data.notice ? <p className="birthsign__notice">{data.notice}</p> : null}
        <div className="birthsign__cols" style={{ gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(0, 1fr))` }}>
          {columns.map((c, i) => <div key={i} className="birthsign__col">{c.map(card)}</div>)}
        </div>
        {below.length ? (
          <div className="birthsign__below" style={{ '--birthsign-cols': Math.max(1, columns.length) } as React.CSSProperties}>{below.map(card)}</div>
        ) : null}
        <footer className="birthsign__foot">
          <span>Choose a sign to read it, then confirm. Each gift is small and adds to your race&apos;s.</span>
          <button type="button" className="birthsign__button birthsign__button--primary" disabled={!shown} onClick={() => { if (shown) setConfirming(true); }}>
            {shown ? `Born under ${shown.name}` : 'Choose a sign'}
          </button>
        </footer>
        {confirming && shown ? (
          <div className="birthsign__confirm">
            <div className="birthsign__confirm-box">
              <div className="birthsign__confirm-emblem"><EmblemSvg sign={shown} /></div>
              <div className="birthsign__confirm-q">Born under {shown.name}, for life?</div>
              <div className="birthsign__confirm-lore">{shown.lore}</div>
              <div className="birthsign__confirm-effect">{shown.effect}</div>
              <div className="birthsign__confirm-note">Only staff can change it later.</div>
              <div className="birthsign__confirm-btns">
                <button type="button" className="birthsign__button birthsign__button--primary" onClick={() => send('dbo:birthsignPick', nonce, shown.id)}>Confirm</button>
                <button type="button" className="birthsign__button" onClick={() => setConfirming(false)}>Choose again</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default BirthsignPicker;
