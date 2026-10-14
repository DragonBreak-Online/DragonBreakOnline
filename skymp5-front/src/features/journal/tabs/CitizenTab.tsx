import React from 'react';

import '../../citizenBoard/styles.scss';
import './CitizenTab.scss';
import { Ask, HoldsList, HoldLine, RequestLine, whenText } from '../../citizenBoard';
import { JournalTabProps, registerJournalTab } from '../tabs';

// The F3 hub's Citizen tab (server citizenship.js, Nate 14 Oct): your citizenships, Primary first, and what you can do with
// them anywhere (make one Primary, renounce one, withdraw a request); a court's invitation to stand with a candidate; the
// elections you take part in; for a ruler or Steward, the requests to answer; for a Lead GM, every election and its overrides.
// Becoming a citizen, entering a court and voting happen at a notice board of the hold (its Citizenship and Voting tabs).
// Actions are dbo:citizenJ [nonce, action, zone, ...args]; the answer lands in the journal's footer.
export interface CitizenSection {
  holds: HoldLine[]; maxHolds: number; cooldownUntil: number;
  requests: Array<{ zone: string; name: string; at: number }>;
  invites: Array<{ zone: string; name: string; court: string; jarl: string; seat: string }>;
  elections: Array<{ zone: string; name: string; phase: string; endsAt: number; revote: boolean; voted: boolean; mine: boolean }>;
  manage: Array<{ zone: string; name: string; policy: string; fee: number; requests: RequestLine[] }>;
  staff: Array<{ zone: string; name: string; phase: string; endsAt: number; citizens: number; threshold: number }> | null;
}

const PHASE: Record<string, string> = { none: 'no election yet', registration: 'courts are being entered', voting: 'the vote is open', seated: 'the Jarl is elected', held: 'held by the staff' };
const POLICY: Record<string, string> = { manual: 'manual approval', paid: 'paid', free: 'free' };

export const CitizenTab = ({ section, busy, act }: JournalTabProps<CitizenSection>) => {
  const s = section;
  if (!s) return null;
  const J = (action: string, zone: string, ...args: unknown[]): void => act('dbo:citizenJ', action, zone, ...args);
  return (
    <div className="jcitizen">
      <h2 className="journal__heading">Citizenship</h2>
      <HoldsList holds={s.holds} />
      <div className="citizen__list">
        {s.holds.filter((h) => !h.auto).map((h, i) => (
          <div key={h.zone} className="citizen__entry">
            <span>{h.name}</span>
            <span className="citizen__actions">
              {i > 0 ? <button type="button" className="citizen__button citizen__button--small" disabled={busy} onClick={() => J('primary', h.zone, h.zone)}>Make Primary</button> : null}
              <Ask label="Renounce" danger busy={busy} onYes={() => J('renounce', h.zone, h.zone)}
                question={`Renounce the citizenship of ${h.name}? You cannot take another for 7 days.`} />
            </span>
          </div>
        ))}
      </div>
      {s.cooldownUntil ? <p className="citizen__muted">You may take another citizenship from {whenText(s.cooldownUntil)}.</p> : null}
      <p className="citizen__muted">At most {s.maxHolds}: a Primary and a Secondary. Become a citizen at a notice board of the hold (Citizenship).</p>
      {s.requests.map((r) => (
        <div key={r.zone} className="citizen__entry">
          <span>Asked for the citizenship of {r.name} <span className="citizen__muted">· {whenText(r.at)}</span></span>
          <button type="button" className="citizen__link" disabled={busy} onClick={() => J('renounce', r.zone, r.zone)}>Withdraw</button>
        </div>
      ))}

      {s.invites.length ? <h3 className="journal__heading">Named in a court</h3> : null}
      {s.invites.map((i) => (
        <div key={i.court} className="citizen__invite">
          <span>{i.jarl} names you <b>{i.seat}</b> in their court for Jarl of {i.name}.</span>
          <span className="citizen__actions">
            <button type="button" className="citizen__button citizen__button--small" disabled={busy} onClick={() => J('accept', i.zone, i.court)}>Accept</button>
            <button type="button" className="citizen__link" disabled={busy} onClick={() => J('refuse', i.zone, i.court)}>Refuse</button>
          </span>
        </div>
      ))}

      {s.elections.length ? <h3 className="journal__heading">Elections</h3> : null}
      {s.elections.map((e) => (
        <div key={e.zone} className="citizen__entry">
          <span>{e.name}: {e.revote ? 'a revote between tied courts' : PHASE[e.phase] || e.phase}{e.endsAt ? ` until ${whenText(e.endsAt)}` : ''}</span>
          <span className="citizen__muted">{e.voted ? 'you have voted' : e.mine ? 'you are in a court' : 'vote at a notice board of the hold'}</span>
        </div>
      ))}

      {s.manage.map((m) => (
        <div key={m.zone} className="citizen__section citizen__section--officials">
          <span className="citizen__heading">{m.name}: citizenship is {POLICY[m.policy] || m.policy}{m.policy === 'paid' ? ` (${m.fee} gold)` : ''}</span>
          <span className="citizen__muted">Set it at a notice board of the hold.</span>
          {m.requests.length ? m.requests.map((r) => (
            <div key={r.actor} className="citizen__entry">
              <span>{r.name}{r.tag ? <span className="citizen__muted"> #{r.tag}</span> : null} asks to become a citizen</span>
              <span className="citizen__actions">
                <button type="button" className="citizen__button citizen__button--small" disabled={busy} onClick={() => J('grant', m.zone, r.actor)}>Grant</button>
                <button type="button" className="citizen__link" disabled={busy} onClick={() => J('decline', m.zone, r.actor)}>Decline</button>
              </span>
            </div>
          )) : <span className="citizen__empty">Nobody has asked.</span>}
        </div>
      ))}

      {s.staff ? (
        <div className="citizen__section citizen__section--officials">
          <span className="citizen__heading">Staff: elections</span>
          {s.staff.map((e) => (
            <div key={e.zone} className="citizen__entry">
              <span>{e.name}: {PHASE[e.phase] || e.phase}{e.endsAt ? ` until ${whenText(e.endsAt)}` : ''} <span className="citizen__muted">· {e.citizens} of {e.threshold} citizens</span></span>
              <span className="citizen__actions">
                {e.phase === 'held' ? <button type="button" className="citizen__button citizen__button--small" disabled={busy} onClick={() => J('staff', e.zone, 'resume')}>Resume</button>
                  : e.phase !== 'none' ? <Ask label="Hold" danger busy={busy} onYes={() => J('staff', e.zone, 'cancel')} question={`Hold the election of ${e.name}?`} /> : null}
                <Ask label="Restart" busy={busy} onYes={() => J('staff', e.zone, 'restart')} question={`Start a fresh election in ${e.name} now?`} />
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

registerJournalTab('citizen', CitizenTab, 'bronze');
export default CitizenTab;
