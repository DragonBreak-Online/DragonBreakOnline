import React, { useEffect, useState } from 'react';

import './ReferralsTab.scss';
import { JournalTabProps, registerJournalTab } from '../tabs';

// The F3 hub's Referrals tab (server referrals.js, Nate 16 Oct): the player's link, the friends who joined with it, the
// boost queue and the carry weight. A new account may enter a friend's code once (referralCode [nonce, code]).

export interface ReferralFriend { n: number; status: 'counted' | 'playing' | 'review' | 'ineligible' | 'revoked'; text: string }
export interface ReferralBoost { kind: 'first' | 'later' | 'welcome'; mult: number; leftMs: number; running: boolean }
export interface ReferralsSection {
  link: string;
  code: string;
  counted: number;
  friends: ReferralFriend[];
  queue: ReferralBoost[];
  waitingBehind: boolean;
  carry: boolean;
  carryLive: boolean;
  canEnter: boolean;
  referredBy: string | null;
  rules: { qualifyHours: number; qualifyDays: number; boostHours: number; firstMult: number; laterMult: number; welcomeMult: number; queueCap: number; carryWeight?: number; commandWindowHours?: number };
}

const pct = (m: number): string => `+${Math.round((m - 1) * 100)}%`;
const hm = (ms: number): string => { const m = Math.max(0, Math.floor(ms / 60000)); return `${Math.floor(m / 60)} h ${m % 60} m`; };
const KIND: Record<string, string> = { first: 'First friend', later: 'Friend', welcome: 'Welcome' };

// Keys typed here stay out of the game's and the global Escape handler
const keep = (e: React.KeyboardEvent): void => { e.stopPropagation(); };

export const ReferralsTab = ({ section, busy, act }: JournalTabProps<ReferralsSection>) => {
  const s = section as ReferralsSection;
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  useEffect(() => { if (!busy && sent) { setCode(''); setSent(false); } }, [busy]);
  if (!s) return null;
  const r = s.rules;
  const carry = r.carryWeight || 50;
  const codeHours = r.commandWindowHours || 24;
  const clean = code.trim().toUpperCase();
  const send = (): void => { if (clean.length !== 8 || busy) return; setSent(true); act('referralCode', clean); };

  return (
    <div className="jref">
      <h2 className="journal__heading">Invite a friend</h2>
      <p className="journal__hint">
        Share your link. A friend who joins with it and plays {r.qualifyHours} hours on {r.qualifyDays} different days counts as your referral:
        your first earns {pct(r.firstMult)} skill progress for {r.boostHours} hours of play and +{carry} carry weight for good, each later one {pct(r.laterMult)} for {r.boostHours} hours.
        Your friend gets {pct(r.welcomeMult)} for their first {r.boostHours} hours.
      </p>
      <div className="jref__link">
        <input className="jref__input" readOnly value={s.link} onFocus={(e) => e.currentTarget.select()} onKeyDown={keep} aria-label="Your referral link" />
        <span className="jref__code">Code {s.code}</span>
      </div>

      <h3 className="journal__heading">Friends ({s.counted} counted)</h3>
      {s.friends.length ? (
        <ul className="jref__list">
          {s.friends.map((f) => <li key={f.n} className={`jref__friend jref__friend--${f.status}`}>{f.text}</li>)}
        </ul>
      ) : <p className="journal__empty">No friends have joined with your link yet.</p>}

      <h3 className="journal__heading">Boosts</h3>
      {s.queue.length ? (
        <ol className="jref__list">
          {s.queue.map((b, i) => (
            <li key={i} className={'jref__boost' + (b.running ? ' jref__boost--running' : '')}>
              <span>{KIND[b.kind] || 'Boost'}: {pct(b.mult)} skill progress</span>
              <span className="jref__left">{hm(b.leftMs)} of play left{b.running ? ', running' : i === 0 && s.waitingBehind ? ', waiting behind your other skill boost' : ', queued'}</span>
            </li>
          ))}
        </ol>
      ) : <p className="journal__empty">No boosts waiting. Boosts run one at a time, only while you play, {r.queueCap} at most in line.</p>}
      {s.carry ? <p className="jref__carry">{s.carryLive ? `Carry weight +${carry}: yours for good.` : `Carry weight +${carry} earned: it arrives with a coming update.`}</p> : null}

      {s.canEnter ? (
        <>
          <h3 className="journal__heading">Did a friend invite you?</h3>
          <p className="journal__hint">Enter their code once, in your first {codeHours} hours of play.</p>
          <div className="jref__enter">
            <input className="jref__input jref__input--code" maxLength={8} value={code} placeholder="CODE" onKeyDown={(e) => { keep(e); if (e.key === 'Enter') send(); }}
              onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))} aria-label="A friend's referral code" />
            <button type="button" className="journal__button journal__button--primary" disabled={busy || clean.length !== 8} onClick={send}>Enter code</button>
          </div>
        </>
      ) : null}
    </div>
  );
};

registerJournalTab('referrals', ReferralsTab, 'dragonbreak');
