import React, { useState } from 'react';

import '../../citizenBoard/styles.scss';
import './WantedTab.scss';
import { Ask, TextBox, whenText } from '../../citizenBoard';
import { JournalTabProps, registerJournalTab } from '../tabs';

// The F3 Wanted tab (server outlaws.js, Nate 18 Oct): the hold you stand in and who is wanted there; your own bounties, with
// Pay where you stand; for the hold's ruler or Steward, the form to set a bounty and Clear on each one.
// Actions are dbo:outlawJ [nonce, action, ...]; the answer lands in the journal's footer.
export interface WantedSection {
  hold: { id: string; name: string } | null;
  wanted: Array<{ pid: number; name: string; amount: number; reason: string; by: string; at: number }>;
  mine: Array<{ zone: string; name: string; amount: number; reason: string; here: boolean }>;
  canDeclare: boolean; max: number; goldPerMinute: number;
}

export const WantedTab = ({ section, busy, act }: JournalTabProps<WantedSection>) => {
  const [who, setWho] = useState('');
  const [gold, setGold] = useState('');
  const [why, setWhy] = useState('');
  const s = section;
  if (!s) return null;
  const J = (action: string, ...args: unknown[]): void => act('dbo:outlawJ', action, ...args);
  const amount = Math.floor(Number(gold) || 0);
  const ready = !!who.trim() && amount >= 1 && amount <= s.max && !!why.trim();
  return (
    <div className="jwanted">
      {s.mine.length ? <h2 className="journal__heading">Your bounties</h2> : null}
      {s.mine.map((m) => (
        <div key={m.zone} className="citizen__entry">
          <span>{m.name}: {m.amount} gold <span className="citizen__muted">· {m.reason}</span></span>
          {m.here ? <Ask label="Pay" busy={busy} onYes={() => J('pay')} question={`Pay your bounty of ${m.amount} gold to ${m.name}?`} />
            : <span className="citizen__muted">Pay it standing in {m.name}</span>}
        </div>
      ))}

      <h2 className="journal__heading">{s.hold ? `Wanted in ${s.hold.name}` : 'Wanted'}</h2>
      {!s.hold ? <p className="citizen__muted">Stand in a hold to read its wanted list.</p>
        : s.wanted.length ? s.wanted.map((w) => (
          <div key={w.pid} className="citizen__entry">
            <span>{w.name} <b>{w.amount} gold</b> <span className="citizen__muted">· {w.reason} · set by {w.by}, {whenText(w.at)}</span></span>
            {s.canDeclare ? <Ask label="Clear" danger busy={busy} onYes={() => J('clear', w.pid)} question={`Lift the bounty on ${w.name}?`} /> : null}
          </div>
        )) : <span className="citizen__empty">Nobody is wanted here.</span>}
      <p className="citizen__muted">Jailed in this hold, an outlaw pays their bounty to whoever locked them in; what they cannot pay they serve, a minute for every {s.goldPerMinute} gold.</p>

      {s.canDeclare && s.hold ? (
        <div className="citizen__section citizen__section--officials">
          <span className="citizen__heading">Set a bounty in {s.hold.name}</span>
          <div className="jwanted__form">
            <TextBox value={who} onChange={setWho} placeholder="Name or #TAG" />
            <TextBox value={gold} onChange={setGold} placeholder={`Gold, up to ${s.max}`} digits />
            <TextBox value={why} onChange={setWhy} placeholder="Reason" onEnter={() => ready && J('set', who.trim(), amount, why.trim())} />
            <Ask label="Set bounty" busy={busy || !ready} onYes={() => { J('set', who.trim(), amount, why.trim()); setWho(''); setGold(''); setWhy(''); }}
              question={`Put ${amount} gold on ${who.trim() || 'them'}?`} />
          </div>
        </div>
      ) : null}
    </div>
  );
};

registerJournalTab('wanted', WantedTab, 'bronze');
export default WantedTab;
