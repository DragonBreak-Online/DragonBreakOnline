import React, { useEffect, useMemo, useState } from 'react';

import Button from '../../constructorComponents/button';
import { Confirm, MoreRow } from './extraTabs';
import { useStaffData } from './staffTabs';

// F7 Thievery (server thievery.js): thief factions, Fence Chests, guard raid reports, the stolen ledger, hall permits and
// live breaches. The gamemode sends the state as an unfocused staffData widget and hears the buttons as dbo:staffThievery;
// every button runs the same action as its chat command, which checks the tier there (Lead GM: factions and fences;
// GMs: raids, permits, sending back). lead/gm only decide what is drawn.

const THIEVERY_DATA_WIDGET_ID = 162;

const dbo = (...args: unknown[]): void => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).skyrimPlatform.sendMessage('dbo:staffThievery', ...args);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('adminPanel thievery', args);
  }
};

interface Fence { chest: string; by: string; at: number; frozen: number; lots: number }
interface Faction { id: string; name: string; config: boolean; fence: Fence | null }
interface Raid { n: number; fid: string; faction: string; state: string; by: string; evidence: string; at: number; raidAt: number; decidedBy: string; reason: string }
interface Stolen { n: number; at: number; item: string; owner: string; thief: string; home: string; state: string; canSendBack: boolean }
interface Permit { home: string; homeName: string; thief: string; until: number; by: string }
interface Breach { thief: string; home: string; faction: string; until: number; at: number }
interface Working { thief: string; home: string; kind: string; until: number }

export interface ThieveryData {
  now: number;
  enabled: boolean;
  lead: boolean;
  gm: boolean;
  armed: { kind: string; fid: string; name: string; until: number } | null;
  factions: Faction[];
  candidates: Array<{ id: string; name: string }>;
  raids: Raid[];
  stolen: Stolen[];
  stolenTotal: number;
  permits: Permit[];
  breaches: Breach[];
  working: Working[];
  result: { ok: boolean; text: string; at: number } | null;
}

type View = 'factions' | 'raids' | 'ledger' | 'permits';
const VIEWS: Array<[View, string]> = [['factions', 'Factions & fences'], ['raids', 'Raids'], ['ledger', 'Stolen ledger'], ['permits', 'Permits & breaches']];
const ROWS = 60;

// "in 3 h 5 min" / "12 min ago"
const span = (ms: number): string => {
  const m = Math.max(0, Math.round(Math.abs(ms) / 60000));
  const t = m < 60 ? m + ' min' : m < 2880 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : Math.round(m / 1440) + ' days';
  return ms >= 0 ? 'in ' + t : t + ' ago';
};
const when = (ms: number): string => new Date(ms).toISOString().slice(5, 16).replace('T', ' ') + ' UTC';

export const ThieveryTab = ({ initialView }: { initialView?: View }) => {
  const { data, at } = useStaffData<ThieveryData>(THIEVERY_DATA_WIDGET_ID);
  const [view, setView] = useState<View>(initialView || 'factions');
  const [tick, setTick] = useState(Date.now());
  const [owner, setOwner] = useState('');
  const [thief, setThief] = useState('');
  const [shown, setShown] = useState(ROWS);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [permitName, setPermitName] = useState('');
  const [permitHours, setPermitHours] = useState('24');
  useEffect(() => {
    dbo('watch');
    const timer = setInterval(() => setTick(Date.now()), 15000);
    return () => { clearInterval(timer); dbo('unwatch'); };
  }, []);
  useEffect(() => setShown(ROWS), [owner, thief]);
  const serverNow = data ? data.now + (tick - at) : tick;
  const ledger = useMemo(() => {
    const o = owner.trim().toLowerCase(); const t = thief.trim().toLowerCase();
    return (data ? data.stolen : []).filter((s) => (!o || s.owner.toLowerCase().indexOf(o) !== -1 || s.home.toLowerCase().indexOf(o) !== -1) && (!t || s.thief.toLowerCase().indexOf(t) !== -1));
  }, [data, owner, thief]);
  if (!data) return <div className="admin-panel__body"><div className="admin-panel__empty">Loading thievery</div></div>;
  const open = data.raids.filter((r) => r.state === 'pending' || r.state === 'approved');
  const counts: Record<View, string> = {
    factions: String(data.factions.length), raids: String(open.length), ledger: String(data.stolenTotal), permits: String(data.permits.length + data.breaches.length + data.working.length),
  };
  const fresh = data.result && serverNow - data.result.at < 60000 ? data.result : null;

  return (
    <div className="admin-panel__body admin-panel__thievery">
      <div className="admin-panel__filters">
        {VIEWS.map(([id, label]) => (
          <button key={id} className={'admin-panel__chip' + (view === id ? ' admin-panel__chip--on' : '')} onClick={() => setView(id)}>{label} ({counts[id]})</button>
        ))}
        <span className="admin-panel__hint">{data.enabled ? 'Burglary is on.' : 'Burglary is off (thievery.enabled).'} {data.lead ? 'Lead GM: every control.' : 'GM: raids, permits and sending back; factions and fences are for a Lead GM.'}</span>
      </div>
      {fresh ? <div className={'admin-panel__thievery-result' + (fresh.ok ? '' : ' admin-panel__thievery-result--refused')}>{fresh.text}</div> : null}
      {data.armed ? (
        <div className="admin-panel__thievery-armed">
          <span>{data.armed.kind === 'fence' ? 'Open the container that is to be the Fence Chest' : 'Use the door or chest of the home ' + data.armed.name + ' may break into'} ({span(data.armed.until - serverNow).replace('in ', '')} left)</span>
          <span className="admin-panel__actions"><Button text="Cancel" width={90} height={28} onClick={() => dbo('cancel')} /></span>
        </div>
      ) : null}

      {view === 'factions' ? (
        <div className="admin-panel__list admin-panel__thievery-list">
          <div className="admin-panel__section">Thief factions</div>
          {data.factions.map((f) => (
            <div key={f.id} className="admin-panel__row admin-panel__thievery-row">
              <span className="admin-panel__cell admin-panel__cell--name">{f.name}{f.config ? ' (config)' : ''}</span>
              <span className="admin-panel__cell admin-panel__cell--discord">
                {f.fence ? 'Fence Chest ' + f.fence.chest + ', ' + f.fence.lots + ' lot' + (f.fence.lots === 1 ? '' : 's') + (f.fence.frozen ? ', frozen by raid #' + f.fence.frozen : '') : 'No Fence Chest'}
              </span>
              {data.lead ? (
                <span className="admin-panel__actions">
                  <Button text={f.fence ? 'Move fence' : 'Mark fence'} width={120} height={28} onClick={() => dbo('mark', f.id)} />
                  {f.fence ? <Confirm text="Unmark" width={90} disabled={f.fence.lots > 0 || !!f.fence.frozen} onConfirm={() => dbo('unmark', f.id)} /> : null}
                  <Confirm text="Revoke" width={90} disabled={f.config} onConfirm={() => dbo('revoke', f.id)} />
                </span>
              ) : null}
            </div>
          ))}
          {!data.factions.length ? <div className="admin-panel__empty">No faction may burgle yet</div> : null}
          {data.lead ? (
            <>
              <div className="admin-panel__section">Approve a faction</div>
              {data.candidates.map((c) => (
                <div key={c.id} className="admin-panel__row admin-panel__thievery-row">
                  <span className="admin-panel__cell admin-panel__cell--name">{c.name}</span>
                  <span className="admin-panel__cell admin-panel__cell--discord">{c.id}</span>
                  <span className="admin-panel__actions"><Confirm text="Approve" width={100} onConfirm={() => dbo('approve', c.id)} /></span>
                </div>
              ))}
            </>
          ) : null}
          <span className="admin-panel__hint">Mark fence, then open an empty container in the faction&apos;s hall: it becomes the Fence Chest and never opens as a container again. A faction named in the config is revoked there.</span>
        </div>
      ) : null}

      {view === 'raids' ? (
        <div className="admin-panel__list admin-panel__thievery-list">
          {data.raids.map((r) => (
            <div key={r.n} className={'admin-panel__gmcall' + (r.state === 'pending' ? ' admin-panel__gmcall--waiting' : '')}>
              <div className="admin-panel__gmcall-head">
                <span className="admin-panel__cell admin-panel__cell--name">#{r.n} {r.faction}</span>
                <span className="admin-panel__cell admin-panel__cell--discord">by {r.by}, {span(r.at - serverNow)}</span>
                <span className={'admin-panel__gmcall-state' + (r.state === 'pending' ? ' admin-panel__gmcall-state--waiting' : '')}>
                  {r.state === 'pending' ? 'Waiting for a GM' : r.state === 'approved' ? 'Frozen; may be ruled ' + (r.raidAt > serverNow ? span(r.raidAt - serverNow) : 'now') : r.state + (r.decidedBy ? ' by ' + r.decidedBy : '')}
                </span>
              </div>
              <div className="admin-panel__gmcall-line">{r.evidence}</div>
              {r.reason ? <div className="admin-panel__hint">Reason: {r.reason}</div> : null}
              {r.state === 'pending' ? (
                <div className="admin-panel__actions">
                  <Confirm text="Approve" width={100} onConfirm={() => dbo('raid', r.n, 'approve')} />
                  <input className="admin-panel__input admin-panel__gmcall-note" placeholder="Reason to deny (the guard is told)" maxLength={300} value={reasons[r.n] || ''} onChange={(e) => setReasons(Object.assign({}, reasons, { [r.n]: e.target.value }))} />
                  <Confirm text="Deny" width={90} disabled={!(reasons[r.n] || '').trim()} onConfirm={() => dbo('raid', r.n, 'deny', reasons[r.n] || '')} />
                </div>
              ) : null}
              {r.state === 'approved' ? (
                <div className="admin-panel__actions">
                  <Confirm text="Won: lots go home" width={170} disabled={r.raidAt > serverNow && !data.lead} onConfirm={() => dbo('raid', r.n, 'won')} />
                  <Confirm text="Lost: unfreeze" width={150} disabled={r.raidAt > serverNow && !data.lead} onConfirm={() => dbo('raid', r.n, 'lost')} />
                  {r.raidAt > serverNow ? <span className="admin-panel__hint">{data.lead ? 'The notice is not out yet: ruling now is a Lead GM\'s call.' : 'The thieves have until ' + when(r.raidAt) + '.'}</span> : null}
                </div>
              ) : null}
            </div>
          ))}
          {!data.raids.length ? <div className="admin-panel__empty">No raid reports. Guards file them with /fence report.</div> : null}
        </div>
      ) : null}

      {view === 'ledger' ? (
        <>
          <div className="admin-panel__filters admin-panel__filters--sub">
            <input className="admin-panel__search" placeholder="Owner or home" value={owner} onChange={(e) => setOwner(e.target.value)} />
            <input className="admin-panel__search" placeholder="Thief" value={thief} onChange={(e) => setThief(e.target.value)} />
            <span className="admin-panel__hint">{ledger.length} of {data.stolen.length}{data.stolenTotal > data.stolen.length ? ' (the newest ' + data.stolen.length + ' of ' + data.stolenTotal + ')' : ''}</span>
          </div>
          <div className="admin-panel__list admin-panel__thievery-list">
            {ledger.slice(0, shown).map((s) => (
              <div key={s.n} className="admin-panel__row admin-panel__thievery-row">
                <span className="admin-panel__cell admin-panel__cell--name">#{s.n} {s.item}</span>
                <span className="admin-panel__cell admin-panel__cell--discord">{s.home} ({s.owner})</span>
                <span className="admin-panel__cell admin-panel__cell--discord">{s.thief}, {span(s.at - serverNow)}</span>
                <span className={'admin-panel__thievery-state admin-panel__thievery-state--' + s.state.replace(/\s+/g, '-')}>{s.state}</span>
                {s.canSendBack ? <span className="admin-panel__actions"><Confirm text="Send back" width={110} onConfirm={() => dbo('sendback', s.n)} /></span> : <span className="admin-panel__thievery-spacer" />}
              </div>
            ))}
            <MoreRow shown={Math.min(shown, ledger.length)} total={ledger.length} onMore={() => setShown(shown + ROWS)} />
            {!ledger.length ? <div className="admin-panel__empty">{data.stolen.length ? 'Nothing matches' : 'Nothing has been stolen'}</div> : null}
          </div>
          <span className="admin-panel__hint">Send back returns a fenced lot, or a carried one from a thief who is online, to its owner (at their next login if they are away).</span>
        </>
      ) : null}

      {view === 'permits' ? (
        <div className="admin-panel__list admin-panel__thievery-list">
          <div className="admin-panel__section">Hall permits</div>
          <div className="admin-panel__actions">
            <input className="admin-panel__input" placeholder="Thief (online, name or #TAG)" value={permitName} onChange={(e) => setPermitName(e.target.value)} />
            <span className="admin-panel__label">Hours</span>
            <input className="admin-panel__input admin-panel__input--short admin-panel__thievery-hours" value={permitHours} onChange={(e) => setPermitHours(e.target.value)} />
            <Button text="Grant, then use the door" width={230} height={30} disabled={!permitName.trim()} onClick={() => dbo('permit', permitName.trim(), Number(permitHours) || 24)} />
          </div>
          {data.permits.map((p) => (
            <div key={p.home} className="admin-panel__row admin-panel__thievery-row">
              <span className="admin-panel__cell admin-panel__cell--name">{p.thief}</span>
              <span className="admin-panel__cell admin-panel__cell--discord">{p.homeName}</span>
              <span className="admin-panel__cell admin-panel__cell--discord">ends {span(p.until - serverNow)}{p.by ? ', by ' + p.by : ''}</span>
              <span className="admin-panel__actions"><Confirm text="Revoke" width={90} onConfirm={() => dbo('unpermit', p.home)} /></span>
            </div>
          ))}
          {!data.permits.length ? <div className="admin-panel__empty">No permits</div> : null}
          <div className="admin-panel__section">At a lock now</div>
          {data.working.map((w, i) => (
            <div key={'w' + i} className="admin-panel__row admin-panel__thievery-row">
              <span className="admin-panel__cell admin-panel__cell--name">{w.thief}</span>
              <span className="admin-panel__cell admin-panel__cell--discord">{w.home}, at its {w.kind}</span>
              <span className="admin-panel__cell admin-panel__cell--discord">to the lockpick {span(w.until - serverNow)}</span>
            </div>
          ))}
          {!data.working.length ? <div className="admin-panel__empty">Nobody is forcing a lock</div> : null}
          <div className="admin-panel__section">Live breaches</div>
          {data.breaches.map((b, i) => (
            <div key={'b' + i} className="admin-panel__row admin-panel__thievery-row">
              <span className="admin-panel__cell admin-panel__cell--name">{b.thief}</span>
              <span className="admin-panel__cell admin-panel__cell--discord">{b.home}{b.faction ? ' (' + b.faction + ')' : ''}</span>
              <span className="admin-panel__cell admin-panel__cell--discord">broke in {span(b.at - serverNow)}, ends {span(b.until - serverNow)}</span>
            </div>
          ))}
          {!data.breaches.length ? <div className="admin-panel__empty">No home is breached</div> : null}
        </div>
      ) : null}
    </div>
  );
};
