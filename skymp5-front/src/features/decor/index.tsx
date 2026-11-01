import React, { useEffect, useRef, useState } from 'react';

import './styles.scss';

// Home decorating (server decor.js, widget 171): the server builds every row and re-checks every action, as /decor does.
// Actions go as dbo:decor* events with the window's nonce; the server answers by sending the panel again.
export interface DecorCost { name: string; n: number; have: number }
export interface DecorRow {
  key: string; name: string; cost?: DecorCost[]; why?: string; group?: string; state?: string;
  // placed: the refund preview text; carpenters: the share their takedowns give back, in percent
  refund?: string | number | null; tier?: string; online?: boolean;
}
export interface DecorMeter { label: string; used: number; of: number }
export interface DecorData {
  id: number;
  nonce: string;
  view: 'catalog' | 'placed' | 'people';
  home: string;
  owner: boolean;
  undo: number;
  budget: DecorMeter[];
  groups: { id: string; label: string }[];
  group: string;
  search?: string;
  page: number;
  pages: number;
  rows: DecorRow[];
  nearby: DecorRow[];
  own?: { tier: string; refund: number };
}

const skillText = (r: DecorRow): string => (r.tier ? `${r.tier} woodworker, ${r.refund}% back` : 'offline');

const send = (key: string, ...args: unknown[]): void => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).skyrimPlatform.sendMessage(key, ...args);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('decor sendMessage', key, args);
  }
};

const SEARCH_DELAY_MS = 350;
const meterKind = (m: DecorMeter): string => (m.used >= m.of ? 'full' : m.of > 1 && m.of - m.used === 1 ? 'last' : '');

const Decor = ({ data }: { data: DecorData }) => {
  const [search, setSearch] = useState(data.search || '');
  const [busy, setBusy] = useState(false);
  const typed = useRef(false);
  const rows = data.rows || [];

  // A re-sent panel ends the action in flight; the box follows the server unless the player is typing
  useEffect(() => {
    setBusy(false);
    if (!typed.current) setSearch(data.search || '');
  }, [data]);

  const act = (event: string, ...args: unknown[]): void => {
    if (busy) return;
    setBusy(true);
    send(event, data.nonce, ...args);
  };
  const view = (v: string, group: string | null, page: number, q?: string) => send('dbo:decorView', data.nonce, v, group, page, q === undefined ? search : q);

  useEffect(() => {
    if (!typed.current) return undefined;
    const t = setTimeout(() => { typed.current = false; view('catalog', null, 0, search); }, SEARCH_DELAY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const tabs: [string, string][] = [['catalog', 'Catalogue'], ['placed', 'Placed'], ...(data.owner ? [['people', 'Carpenters'] as [string, string]] : [])];

  return (
    <div className="decor">
      <div className="decor__fade" />
      <div className="decor__panel">
        <h2 className="decor__title">{data.home}</h2>
        <div className="decor__budget">
          {(data.budget || []).map((m) => (
            <span key={m.label} className={'decor__meter decor__meter--' + (meterKind(m) || 'ok')}>
              <span className="decor__label">{m.label}</span>
              <span className="decor__bar"><span style={{ width: Math.min(100, (m.used / Math.max(1, m.of)) * 100) + '%' }} /></span>
              <span className="decor__count">{m.used}/{m.of}</span>
            </span>
          ))}
        </div>

        <div className="decor__tabs">
          {tabs.map(([id, label]) => (
            <button key={id} className={'decor__tab' + (data.view === id ? ' decor__tab--on' : '')} onClick={() => view(id, null, 0)}>{label}</button>
          ))}
          {data.undo > 0 && <button className="decor__tab decor__undo" disabled={busy} onClick={() => act('dbo:decorUndo')}>Undo ({data.undo} s)</button>}
        </div>

        {data.view === 'catalog' && (
          <>
            <input
              className="decor__search"
              placeholder="Search every group"
              value={search}
              maxLength={40}
              onChange={(e) => { typed.current = true; setSearch(e.target.value); }}
              onKeyDown={(e) => { if (e.key === 'Escape' && !search) return; e.stopPropagation(); if (e.key === 'Escape') { typed.current = true; setSearch(''); } }}
            />
            {!data.search && (
              <div className="decor__chips">
                {(data.groups || []).map((g) => (
                  <button key={g.id} className={'decor__chip' + (g.id === data.group ? ' decor__chip--on' : '')} onClick={() => view('catalog', g.id, 0, '')}>{g.label}</button>
                ))}
              </div>
            )}
          </>
        )}

        <div className="decor__list">
          {rows.length === 0 && (
            <p className="decor__empty">
              {data.view === 'catalog' ? (data.search ? 'Nothing matches.' : 'Nothing in this group.') : data.view === 'placed' ? 'Nothing placed here yet.' : 'No carpenters hired yet. Bring one inside to hire them.'}
            </p>
          )}
          {data.view === 'catalog' && rows.map((r) => (
            <div key={r.key} className={'decor__row' + (r.why ? ' decor__row--blocked' : '')}>
              <div className="decor__main">
                <span className="decor__name">{r.name}</span>
                {r.why ? <span className="decor__why">{r.why}</span> : (
                  <span className="decor__costs">
                    {(r.cost || []).map((c) => <span key={c.name} className={'decor__cost' + (c.have < c.n ? ' decor__cost--short' : '')}>{c.name} {c.have}/{c.n}</span>)}
                  </span>
                )}
              </div>
              <button className="decor__button" disabled={busy || !!r.why || (r.cost || []).some((c) => c.have < c.n)} onClick={() => act('dbo:decorPlace', r.key)}>Place</button>
            </div>
          ))}
          {data.view === 'placed' && rows.map((r) => (
            <div key={r.key} className="decor__row">
              <div className="decor__main">
                <span className="decor__name">{r.name}</span>
                <span className="decor__why">{[r.state, r.refund ? 'taking it down gives back ' + r.refund : ''].filter(Boolean).join('; ')}</span>
              </div>
              <button className="decor__button" disabled={busy} onClick={() => act('dbo:decorMove', r.key)}>Move</button>
              <button className="decor__button" disabled={busy} onClick={() => act('dbo:decorRemove', r.key)}>Remove</button>
            </div>
          ))}
          {data.view === 'people' && (
            <>
              <p className="decor__note">
                Carpenters may place, move and take down pieces here. What a carpenter takes down comes back to you, at their
                woodworking skill: a better Woodcutter gives back more.{data.own ? ` Your own: ${data.own.tier}, ${data.own.refund}% back.` : ''}
              </p>
              {rows.length > 0 && <span className="decor__label decor__sub">Your carpenters</span>}
              {rows.map((r) => (
                <div key={r.key} className="decor__row">
                  <div className="decor__main"><span className="decor__name">{r.name}</span><span className="decor__why">{skillText(r)}</span></div>
                  <button className="decor__button" disabled={busy} onClick={() => act('dbo:decorRevoke', r.key)}>Dismiss</button>
                </div>
              ))}
              {(data.nearby || []).length > 0 && <span className="decor__label decor__sub">Here now</span>}
              {(data.nearby || []).map((r) => (
                <div key={r.key} className="decor__row">
                  <div className="decor__main"><span className="decor__name">{r.name}</span><span className="decor__why">{skillText(r)}</span></div>
                  <button className="decor__button" disabled={busy} onClick={() => act('dbo:decorGrant', r.key)}>Hire</button>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="decor__foot">
          {data.pages > 1 ? (
            <span className="decor__pager">
              <button className="decor__link" disabled={data.page <= 0} onClick={() => view(data.view, null, data.page - 1)}>Previous</button>
              <span>Page {data.page + 1} of {data.pages}</span>
              <button className="decor__link" disabled={data.page >= data.pages - 1} onClick={() => view(data.view, null, data.page + 1)}>Next</button>
            </span>
          ) : <span />}
          <button className="decor__close" onClick={() => send('dbo:decorClose', data.nonce)}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default Decor;
