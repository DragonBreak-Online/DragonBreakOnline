import React, { useEffect, useMemo, useState } from 'react';

import Button from '../../constructorComponents/button';
import { fuzzyFilter } from '../../components/SearchBar/SearchBar';
import { Confirm, MoreRow } from './extraTabs';

// F7 tabs fed by the gamemode rather than AdminSystem: GM Calls (server gmcall.js) and Enchant (server staffenchant.js).
// The gamemode sends their data as unfocused staffData widgets (drawn by nobody, read here) and hears the buttons as
// dbo:<event> through the relay, so the client needs no change for either. Rights are checked there, never here.

const GMCALLS_DATA_WIDGET_ID = 140;
const ENCHANT_CATALOG_WIDGET_ID = 141;
const ENCHANT_ITEMS_WIDGET_ID = 142;

const dbo = (event: string, ...args: unknown[]): void => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).skyrimPlatform.sendMessage('dbo:' + event, ...args);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('adminPanel dbo', event, args);
  }
};

// The staffData widget with this id as it stands, with when it arrived; follows every widgets.set
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const widgets = (): any => (window as any).skyrimPlatform && (window as any).skyrimPlatform.widgets;
export function useStaffData<T> (id: number): { data: T | null; at: number } {
  const read = (): T | null => {
    try {
      const list = (widgets() && widgets().get()) || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (list.find((w: any) => w && w.type === 'staffData' && w.id === id) as T) || null;
    } catch (e) {
      return null;
    }
  };
  const [state, setState] = useState<{ data: T | null; at: number }>(() => ({ data: read(), at: Date.now() }));
  useEffect(() => {
    const onChange = (): void => {
      const next = read();
      setState((prev) => (prev.data === next ? prev : { data: next, at: Date.now() }));
    };
    const w = widgets();
    if (w && typeof w.addListener === 'function') w.addListener(onChange);
    return () => { if (w && typeof w.removeListener === 'function') w.removeListener(onChange); };
  }, [id]);
  return state;
}

// "just now", "12 min ago", "2 h 5 min ago"
const ago = (ms: number): string => {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  return Math.floor(m / 60) + ' h ' + (m % 60) + ' min ago';
};

// ---- GM Calls ----------------------------------------------------------------------------------------------------
interface GmCall {
  n: number;
  name: string;
  online: boolean;
  place: string;
  at: number;
  lines: Array<{ at: number; text: string }>;
  takenBy: string;
  mine: boolean;
  ticket: string;
}

interface GmCallsData {
  now: number; // the server's clock when sent
  open: GmCall[];
  closed: Array<{ n: number; name: string; how: string; by: string; at: number; note: string }>;
  canGoto: boolean;
  quiet: boolean;
}

export const GmCallsTab = () => {
  const { data, at } = useStaffData<GmCallsData>(GMCALLS_DATA_WIDGET_ID);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    dbo('staffGmCalls', 'watch');
    const timer = setInterval(() => setTick(Date.now()), 15000);
    return () => { clearInterval(timer); dbo('staffGmCalls', 'unwatch'); };
  }, []);
  // The server's clock now: its stamp plus the time since the list arrived
  const serverNow = data ? data.now + (tick - at) : tick;
  const op = (what: string, n: number, note?: string): void => dbo('staffGmCalls', what, n, note || '');
  if (!data) return <div className="admin-panel__body"><div className="admin-panel__empty">Loading GM calls</div></div>;
  const waiting = data.open.filter((c) => !c.takenBy).length;
  return (
    <div className="admin-panel__body">
      <div className="admin-panel__filters">
        <span className="admin-panel__label">{data.open.length ? data.open.length + ' open, ' + waiting + ' waiting' : 'No open GM calls'}</span>
        <button className={'admin-panel__chip' + (data.quiet ? ' admin-panel__chip--on' : '')} onClick={() => dbo('staffGmCalls', 'quiet', data.quiet ? 'off' : 'on')}>
          {data.quiet ? 'Banners off' : 'Banners on'}
        </button>
        <span className="admin-panel__hint">Players call with /gm or the U panel&apos;s Contact a GM. The list updates by itself.</span>
      </div>
      <div className="admin-panel__list admin-panel__gmcalls">
        {data.open.map((c) => (
          <div key={c.n} className={'admin-panel__gmcall' + (c.takenBy ? '' : ' admin-panel__gmcall--waiting')}>
            <div className="admin-panel__gmcall-head">
              <span className="admin-panel__cell admin-panel__cell--name">#{c.n} {c.name}{c.online ? '' : ' (offline)'}</span>
              <span className="admin-panel__cell admin-panel__cell--discord">{c.place}</span>
              <span className="admin-panel__cell admin-panel__cell--discord">{ago(serverNow - c.at)}</span>
              <span className={'admin-panel__gmcall-state' + (c.takenBy ? '' : ' admin-panel__gmcall-state--waiting')}>
                {c.takenBy ? (c.mine ? 'Yours' : 'Taken by ' + c.takenBy) : 'Waiting'}
              </span>
            </div>
            {c.lines.map((l, i) => (
              <div key={i} className="admin-panel__gmcall-line">
                <span className="admin-panel__hint">{i ? '+' + ago(l.at - c.at).replace(' ago', '').replace('just now', '0 min') : ''}</span> {l.text}
              </div>
            ))}
            {c.ticket ? <div className="admin-panel__hint">Discord ticket #{c.ticket}</div> : null}
            <div className="admin-panel__actions">
              {!c.mine ? <Button text={c.takenBy ? 'Take over' : 'Take'} width={110} height={30} onClick={() => op('take', c.n)} /> : null}
              {data.canGoto ? <Button text={c.online ? 'Go to' : 'Go to (where they called)'} width={c.online ? 90 : 220} height={30} onClick={() => op('goto', c.n)} /> : null}
              {c.takenBy ? <Button text="Release" width={100} height={30} onClick={() => op('release', c.n)} /> : null}
              <input
                className="admin-panel__input admin-panel__gmcall-note"
                placeholder="Note for staff (optional)"
                value={notes[c.n] || ''}
                maxLength={300}
                onChange={(e) => setNotes(Object.assign({}, notes, { [c.n]: e.target.value }))}
              />
              <Confirm text="Close" width={100} onConfirm={() => { op('close', c.n, notes[c.n]); setNotes(Object.assign({}, notes, { [c.n]: '' })); }} />
            </div>
          </div>
        ))}
        {!data.open.length ? <div className="admin-panel__empty">Nobody is waiting for a GM</div> : null}
      </div>
      {data.closed.length ? (
        <div className="admin-panel__bans">
          <div className="admin-panel__section">Lately closed</div>
          {data.closed.map((c) => (
            <div key={c.n} className="admin-panel__row">
              <span className="admin-panel__cell admin-panel__cell--name">#{c.n} {c.name}</span>
              <span className="admin-panel__cell admin-panel__cell--discord">{c.how}{c.by ? ' by ' + c.by : ''}, {ago(serverNow - c.at)}</span>
              <span className="admin-panel__cell admin-panel__cell--discord">{c.note}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

// ---- Enchant -----------------------------------------------------------------------------------------------------
interface EnchantRow {
  id: string; // ENCH form id hex
  n: string; // name (editor id in words)
  e: string; // editor id
  p: string; // plugin
  k: 'w' | 'a';
  m: number; // the main effect's index
  fx: Array<[string, number, number, number]>; // effect name, magnitude, duration, area
}

interface EnchantCatalog { list: EnchantRow[]; maxScale: number }

interface EnchantPiece { key: string; name: string; count: number; kind: 'w' | 'a'; ok: boolean; why: string; now: string }

interface EnchantItems { target: string; targetName: string; items: EnchantPiece[]; at: number }

const ROWS = 150;
const round1 = (n: number): number => Math.round(n * 10) / 10;

export const EnchantTab = ({ who }: { who: string }) => {
  const catalog = useStaffData<EnchantCatalog>(ENCHANT_CATALOG_WIDGET_ID).data;
  const pack = useStaffData<EnchantItems>(ENCHANT_ITEMS_WIDGET_ID).data;
  const [pieceKey, setPieceKey] = useState('');
  const [enchId, setEnchId] = useState('');
  const [search, setSearch] = useState('');
  const [strength, setStrength] = useState('');
  const [name, setName] = useState('');
  const [shown, setShown] = useState(ROWS);
  useEffect(() => {
    if (!catalog) dbo('staffEnchant', 'catalog');
    return () => dbo('staffEnchant', 'close');
  }, []);
  useEffect(() => { setPieceKey(''); dbo('staffEnchant', 'items', who); }, [who]);
  const items = pack && pack.target === who ? pack.items : null;
  const piece = (items || []).find((p) => p.key === pieceKey) || null;
  // A piece the server no longer lists (enchanted, sold) is let go
  useEffect(() => { if (pieceKey && items && !piece) setPieceKey(''); }, [items]);
  const kind = piece ? piece.kind : '';
  const rows = useMemo(() => {
    const list = (catalog ? catalog.list : []).filter((r) => !kind || r.k === kind);
    return fuzzyFilter(list, search, (r) => r.n + ' ' + r.e + ' ' + r.p + ' ' + r.fx.map((f) => f[0]).join(' '));
  }, [catalog, kind, search]);
  useEffect(() => setShown(ROWS), [kind, search]);
  const ench = (catalog ? catalog.list : []).find((r) => r.id === enchId) || null;
  useEffect(() => { if (ench && kind && ench.k !== kind) setEnchId(''); }, [kind]);
  const main = ench ? ench.fx[ench.m] || ench.fx[0] : null;
  const own = main ? main[1] : 0;
  const cap = own * (catalog ? catalog.maxScale : 1);
  useEffect(() => { setStrength(own ? String(own) : ''); }, [enchId]);
  const want = strength.trim() === '' ? own : Number(strength);
  const strengthOk = !own || (Number.isFinite(want) && want > 0 && want <= cap + 1e-6);
  const scale = own && strengthOk ? want / own : 1;
  const apply = (): void => {
    if (!piece || !ench || !strengthOk) return;
    dbo('staffEnchant', 'apply', JSON.stringify({ target: who, key: piece.key, ench: ench.id, strength: own ? want : undefined, name: name.trim() }));
    setName('');
  };
  return (
    <div className="admin-panel__body admin-panel__items">
      <div className="admin-panel__categories admin-panel__enchant-pieces">
        <div className="admin-panel__section">{pack && pack.target === who ? 'Pack of ' + pack.targetName : 'Loading the pack'}</div>
        {(items || []).map((p) => (
          <button
            key={p.key}
            className={'admin-panel__category' + (p.key === pieceKey ? ' admin-panel__category--on' : '')}
            disabled={!p.ok}
            title={p.why || p.now}
            onClick={() => setPieceKey(p.key)}
          >
            {p.name}{p.count > 1 ? ' x' + p.count : ''}
            <span className="admin-panel__count">{p.ok ? (p.kind === 'w' ? 'weapon' : 'apparel') : p.why}</span>
            {p.now ? <div className="admin-panel__hint">{p.now}</div> : null}
          </button>
        ))}
        {items && !items.length ? <div className="admin-panel__empty">No weapons or apparel</div> : null}
        <Button text="Reload pack" width={150} height={28} onClick={() => dbo('staffEnchant', 'items', who)} />
      </div>
      <div className="admin-panel__itempane">
        <div className="admin-panel__filters">
          <input className="admin-panel__search" placeholder={kind === 'w' ? 'Search weapon enchantments' : kind === 'a' ? 'Search apparel enchantments' : 'Search enchantments (pick a piece first)'} value={search} onChange={(e) => setSearch(e.target.value)} />
          <span className="admin-panel__hint">{catalog ? rows.length + ' of ' + catalog.list.length : 'Loading enchantments'}</span>
        </div>
        <div className="admin-panel__list admin-panel__list--items">
          {rows.slice(0, shown).map((r) => (
            <div key={r.id} className={'admin-panel__row admin-panel__row--clickable' + (r.id === enchId ? ' admin-panel__row--selected' : '')} onClick={() => setEnchId(r.id)}>
              <span className="admin-panel__cell admin-panel__cell--name">{r.n}</span>
              <span className="admin-panel__cell admin-panel__cell--discord">{r.fx.map((f) => f[0] + (f[1] ? ' ' + f[1] : '')).join(', ')}</span>
              <span className="admin-panel__cell admin-panel__cell--discord">{r.p.replace(/\.(esp|esm|esl)$/i, '')}</span>
            </div>
          ))}
          <MoreRow shown={Math.min(shown, rows.length)} total={rows.length} onMore={() => setShown(shown + ROWS)} />
        </div>
        {ench ? (
          <div className="admin-panel__enchant-preview">
            {ench.fx.map((f, i) => (
              <div key={i} className="admin-panel__hint">
                {f[0]}{f[1] ? ': ' + round1(f[1] * scale) + (i === ench.m ? ' (main)' : '') : ''}{f[2] ? ' for ' + f[2] + ' s' : ''}{f[3] ? ', area ' + f[3] : ''}
              </div>
            ))}
          </div>
        ) : null}
        <div className="admin-panel__actions">
          <span className="admin-panel__label">{piece ? piece.name : 'Pick a piece'} {ench ? '→ ' + ench.n : ''}</span>
          {own ? (
            <>
              <span className="admin-panel__label">Strength</span>
              <input className="admin-panel__input admin-panel__input--short" value={strength} onChange={(e) => setStrength(e.target.value)} title={'Its own: ' + own + ', at most ' + round1(cap)} />
              <span className="admin-panel__hint">own {own}, max {round1(cap)}</span>
            </>
          ) : null}
          <input className="admin-panel__input" placeholder="New name (optional)" maxLength={64} value={name} onChange={(e) => setName(e.target.value)} />
          {piece && piece.now
            ? <Confirm text="Replace enchantment" width={200} disabled={!ench || !strengthOk} onConfirm={apply} />
            : <Button text="Enchant" width={110} height={32} disabled={!piece || !ench || !strengthOk} onClick={apply} />}
        </div>
        <span className="admin-panel__hint">One copy is enchanted; the rest of its stack stays plain. It goes on as a player-made enchantment, so nobody can disenchant it to learn it. Worn pieces must be taken off first.</span>
      </div>
    </div>
  );
};
