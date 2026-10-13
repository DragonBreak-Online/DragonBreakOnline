import React, { useEffect, useState } from 'react';

import './styles.scss';

// The notice board's Citizenship and Voting tabs (server citizenship.js, widget 84; Nate, 14 Oct). The board's own tabs
// (features/bountyBoard) hand over here with dbo:citizenOpen; this panel is always the hold of the board it was opened at.
// Citizenship: the hold's policy (manual approval, a fee, free), becoming a citizen or asking, renouncing; the ruler and
// Steward set the policy and answer requests. Voting: the election of the hold's Jarl, in its phase (registration of full
// courts, then the vote), with no count anywhere until the vote has ended. Actions go as dbo:citizenAct with the panel's
// nonce, the action and its arguments; the server answers by sending the panel again with a result line.

export interface HoldLine { zone: string; name: string; since: number; how: string; auto: boolean }
export interface RequestLine { actor: string; name: string; tag: string; at: number }
export interface CitizenshipView {
  hold: string; name: string; ruler: string; hasRuler: boolean; policy: 'manual' | 'paid' | 'free'; fee: number;
  citizen: boolean; primary: boolean; auto: boolean; holds: HoldLine[]; maxHolds: number; cooldownUntil: number; requested: boolean;
  can: '' | 'manual' | 'paid' | 'free'; why: string;
  manage?: { policy: 'manual' | 'paid' | 'free'; fee: number; treasury: boolean; maxFee: number; requests: RequestLine[] };
}
export interface MemberLine { seat: string; label: string; name: string; tag: string; accepted: boolean; fit: boolean; why: string }
export interface CourtLine { id: string; jarl: string; members: MemberLine[]; complete: boolean; struck: string; mine: boolean }
export interface VotingView {
  hold: string; name: string; electing: boolean; why?: string; threshold: number; registrationHours: number; votingHours: number;
  seats: Array<{ id: string; label: string }>;
  citizens?: number; phase?: 'none' | 'registration' | 'voting' | 'seated' | 'held'; round?: number; endsAt?: number; revote?: boolean;
  voteWhy?: string; staff?: boolean; courts?: CourtLine[]; inCourt?: boolean; standWhy?: string;
  invites?: Array<{ court: string; jarl: string; seat: string }>; ballot?: CourtLine[]; voted?: boolean;
  result?: { winner: CourtLine | null; empty: string[]; at: number; counts: Array<{ jarl: string; votes: number }> };
}
export interface CitizenBoardData {
  id: number; nonce: string; tab: 'citizenship' | 'voting'; result: string; resultKind: string;
  hold: string; name: string; grants: boolean; why?: string; citizenship?: CitizenshipView; voting?: VotingView;
}
export type Act = (action: string, ...args: unknown[]) => void;

const send = (key: string, ...args: unknown[]): void => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).skyrimPlatform.sendMessage(key, ...args);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log('citizenBoard sendMessage', key, args);
  }
};

const BUSY_TIMEOUT_MS = 8000;
export const whenText = (t: number | undefined): string => {
  if (!t) return '';
  try { return new Date(t).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
};
const ofPlace = (n: string): string => n.replace(/^The /, 'the ');

// A text box whose keys stay out of the game and the global Escape handler
export const TextBox = ({ value, onChange, placeholder, onEnter, digits }: { value: string; onChange: (v: string) => void; placeholder: string; onEnter?: () => void; digits?: boolean }) => (
  <input className="citizen__input" value={value} placeholder={placeholder} maxLength={digits ? 7 : 40} inputMode={digits ? 'numeric' : undefined}
    onChange={(e) => onChange(digits ? e.target.value.replace(/[^0-9]/g, '') : e.target.value)}
    onKeyDown={(e) => { if (e.key === 'Escape' && !value) return; e.stopPropagation(); if (e.key === 'Escape') onChange(''); if (e.key === 'Enter' && onEnter) onEnter(); }} />
);

// One more question before an action that costs or ends something
export const Ask = ({ label, question, onYes, busy, danger }: { label: string; question: string; onYes: () => void; busy: boolean; danger?: boolean }) => {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className={'citizen__button' + (danger ? ' citizen__button--danger' : '')} disabled={busy} onClick={() => setOpen(true)}>{label}</button>;
  return (
    <span className="citizen__confirm">
      <span className="citizen__note">{question}</span>
      <button type="button" className={'citizen__button' + (danger ? ' citizen__button--danger' : '')} disabled={busy} onClick={() => { setOpen(false); onYes(); }}>Yes</button>
      <button type="button" className="citizen__link" onClick={() => setOpen(false)}>No</button>
    </span>
  );
};

const policyText = (c: CitizenshipView): string => {
  if (!c.hasRuler) return `${c.name} has no ${c.ruler} in the seat, so its citizenship is free to all who ask.`;
  if (c.policy === 'paid') return `The citizenship of ${ofPlace(c.name)} costs ${c.fee} gold, paid into the hold's treasury.`;
  if (c.policy === 'manual') return `The citizenship of ${ofPlace(c.name)} is granted by the ${c.ruler} or the Steward, to those who ask in person.`;
  return `The citizenship of ${ofPlace(c.name)} is free.`;
};
const howText = (h: HoldLine, i: number): string => (h.auto ? 'through a faction or court based there' : i === 0 ? 'Primary' : 'Secondary');

export const HoldsList = ({ holds }: { holds: HoldLine[] }) => (
  <div className="citizen__list">
    {holds.length ? holds.map((h, i) => (
      <div key={h.zone} className="citizen__entry">
        <span className="citizen__strong">{h.name}</span>
        <span className="citizen__muted">{howText(h, i)}{h.since ? ` · since ${whenText(h.since)}` : ''}</span>
      </div>
    )) : <span className="citizen__empty">You are a citizen of no hold.</span>}
  </div>
);

const PolicyForm = ({ c, busy, act }: { c: CitizenshipView; busy: boolean; act: Act }) => {
  const m = c.manage!;
  const [fee, setFee] = useState(m.fee ? String(m.fee) : '');
  useEffect(() => { setFee(m.fee ? String(m.fee) : ''); }, [m.fee, m.policy]);
  return (
    <div className="citizen__section citizen__section--officials">
      <span className="citizen__heading">For the {c.ruler} and the Steward</span>
      <span className="citizen__label">How citizenship is granted</span>
      <div className="citizen__row citizen__row--wrap">
        <button type="button" className={'citizen__choice' + (m.policy === 'manual' ? ' citizen__choice--on' : '')} disabled={busy} onClick={() => act('policy', 'manual')}>Manual approval</button>
        <button type="button" className={'citizen__choice' + (m.policy === 'free' ? ' citizen__choice--on' : '')} disabled={busy} onClick={() => act('policy', 'free')}>Free</button>
        {m.treasury ? (
          <>
            <TextBox value={fee} onChange={setFee} placeholder={`Fee, 1 to ${m.maxFee}`} digits onEnter={() => Number(fee) && act('policy', 'paid', Number(fee))} />
            <button type="button" className={'citizen__choice' + (m.policy === 'paid' ? ' citizen__choice--on' : '')} disabled={busy || !Number(fee)} onClick={() => act('policy', 'paid', Number(fee))}>Paid{m.policy === 'paid' ? `: ${m.fee} gold` : ''}</button>
          </>
        ) : <span className="citizen__muted">No treasury here, so no fee.</span>}
      </div>
      {!c.hasRuler && <p className="citizen__note">While nobody sits as {c.ruler}, citizenship is free whatever is set here.</p>}
      <span className="citizen__label">Asked to become citizens</span>
      <div className="citizen__list">
        {m.requests.length ? m.requests.map((r) => (
          <div key={r.actor} className="citizen__entry">
            <span>{r.name}{r.tag ? <span className="citizen__muted"> #{r.tag}</span> : null} <span className="citizen__muted">· {whenText(r.at)}</span></span>
            <span className="citizen__actions">
              <button type="button" className="citizen__button citizen__button--small" disabled={busy} onClick={() => act('grant', r.actor)}>Grant</button>
              <button type="button" className="citizen__link" disabled={busy} onClick={() => act('decline', r.actor)}>Decline</button>
            </span>
          </div>
        )) : <span className="citizen__empty">Nobody has asked.</span>}
      </div>
    </div>
  );
};

export const CitizenshipBody = ({ c, busy, act }: { c: CitizenshipView; busy: boolean; act: Act }) => (
  <>
    <p className="citizen__note">{policyText(c)}</p>
    <div className="citizen__section">
      <span className="citizen__label">Your citizenship ({c.holds.length} of {c.maxHolds})</span>
      <HoldsList holds={c.holds} />
      {c.citizen ? (
        c.auto ? <p className="citizen__note">You are a citizen of {ofPlace(c.name)} for as long as you serve a faction or court based here.</p>
          : <div className="citizen__row citizen__row--end"><Ask label={`Renounce ${c.name}`} danger busy={busy} onYes={() => act('renounce')}
            question={`Renounce the citizenship of ${ofPlace(c.name)}? You cannot take another citizenship for 7 days, and you cannot buy property here.`} /></div>
      ) : c.requested ? (
        <div className="citizen__row citizen__row--wrap">
          <p className="citizen__note">You have asked. Go before the {c.ruler} or the Steward: they grant it.</p>
          <button type="button" className="citizen__link" disabled={busy} onClick={() => act('renounce')}>Withdraw the request</button>
        </div>
      ) : c.why ? <p className="citizen__note citizen__note--warn">{c.why}</p>
        : c.can === 'paid' ? <div className="citizen__row"><Ask label={`Become a citizen for ${c.fee} gold`} busy={busy} onYes={() => act('join')} question={`Pay ${c.fee} gold into the treasury of ${ofPlace(c.name)}?`} /></div>
          : c.can === 'manual' ? <div className="citizen__row"><button type="button" className="citizen__button" disabled={busy} onClick={() => act('join')}>Ask for citizenship</button></div>
            : c.can === 'free' ? <div className="citizen__row"><button type="button" className="citizen__button" disabled={busy} onClick={() => act('join')}>Become a citizen</button></div> : null}
      {c.cooldownUntil ? <p className="citizen__muted">You renounced a citizenship lately: you may take another from {whenText(c.cooldownUntil)}.</p> : null}
      <p className="citizen__muted">A citizen may buy property in the hold. Anyone may hold two citizenships at most, a Primary and a Secondary (F3, Citizen).</p>
    </div>
    {c.manage ? <PolicyForm c={c} busy={busy} act={act} /> : null}
  </>
);

const memberState = (m: MemberLine): string => (m.why === 'empty' ? 'not named' : !m.fit ? (m.why || 'no longer eligible') : m.accepted ? '' : 'has not accepted yet');
export const CourtCard = ({ court, busy, act, ballot, canVote }: { court: CourtLine; busy: boolean; act: Act; ballot?: boolean; canVote?: boolean }) => {
  const [seat, setSeat] = useState('');
  const [name, setName] = useState('');
  const open = court.members.filter((m) => m.seat !== 'jarl' && (m.why === 'empty' || !m.fit));
  return (
    <div className={'citizen__court' + (court.struck ? ' citizen__court--struck' : '')}>
      <div className="citizen__court-head">
        <span className="citizen__strong">The court of {court.jarl}</span>
        {!ballot ? <span className={'citizen__tag' + (court.complete ? ' citizen__tag--ok' : '')}>{court.complete ? 'Complete' : 'Incomplete'}</span> : null}
      </div>
      {court.members.map((m) => (
        <div key={m.seat} className="citizen__member">
          <span className="citizen__muted citizen__seat">{m.label}</span>
          <span>{m.name || '(empty)'}{m.tag ? <span className="citizen__muted"> #{m.tag}</span> : null}</span>
          {!ballot && memberState(m) ? <span className="citizen__warn">{memberState(m)}</span> : null}
        </div>
      ))}
      {ballot && canVote ? (
        <div className="citizen__row citizen__row--end"><Ask label="Vote for this court" busy={busy} onYes={() => act('vote', court.id)} question={`Cast your one vote for the court of ${court.jarl}? It cannot be changed.`} /></div>
      ) : null}
      {!ballot && court.mine ? (
        <div className="citizen__row citizen__row--wrap">
          {open.length ? (
            <>
              {open.map((m) => (
                <button key={m.seat} type="button" className={'citizen__choice' + (seat === m.seat ? ' citizen__choice--on' : '')} onClick={() => setSeat(m.seat)}>Replace the {m.label}</button>
              ))}
              {seat ? (
                <>
                  <TextBox value={name} onChange={setName} placeholder="Name or #TAG" onEnter={() => name.trim() && act('replace', seat, name.trim())} />
                  <button type="button" className="citizen__button citizen__button--small" disabled={busy || !name.trim()} onClick={() => act('replace', seat, name.trim())}>Name them</button>
                </>
              ) : null}
            </>
          ) : null}
          <Ask label="Withdraw your court" danger busy={busy} onYes={() => act('withdraw')} question="Withdraw your court from the election?" />
        </div>
      ) : null}
    </div>
  );
};

const RegisterForm = ({ v, busy, act }: { v: VotingView; busy: boolean; act: Act }) => {
  const others = v.seats.filter((s) => s.id !== 'jarl');
  const [names, setNames] = useState<string[]>(others.map(() => ''));
  const ready = names.every((n) => n.trim());
  return (
    <div className="citizen__section">
      <span className="citizen__heading">Stand for Jarl</span>
      <p className="citizen__note">Name your court. Every member must be a citizen of {ofPlace(v.name)} who serves no faction, and each must accept. You stand as Jarl.</p>
      {others.map((s, i) => (
        <div key={s.id} className="citizen__row">
          <span className="citizen__label citizen__seat">{s.label}</span>
          <TextBox value={names[i]} onChange={(x) => setNames(names.map((n, k) => (k === i ? x : n)))} placeholder="Name or #TAG" />
        </div>
      ))}
      <div className="citizen__row citizen__row--end">
        <button type="button" className="citizen__button" disabled={busy || !ready} onClick={() => act('register', ...names.map((n) => n.trim()))}>Enter this court</button>
      </div>
    </div>
  );
};

export const VotingBody = ({ v, busy, act }: { v: VotingView; busy: boolean; act: Act }) => {
  if (!v.electing) return <p className="citizen__note citizen__lore">{v.why}</p>;
  const staff = v.staff ? (
    <div className="citizen__section citizen__section--officials">
      <span className="citizen__heading">Staff</span>
      <div className="citizen__row citizen__row--wrap">
        {v.phase === 'held' ? <button type="button" className="citizen__button citizen__button--small" disabled={busy} onClick={() => act('staff', 'resume')}>Let it start by itself again</button>
          : v.phase !== 'none' ? <Ask label="Hold the election" danger busy={busy} onYes={() => act('staff', 'cancel')} question="Stop this election until staff restart it? Its courts and votes are kept but nothing moves." /> : null}
        <Ask label="Restart now" busy={busy} onYes={() => act('staff', 'restart')} question={`Start a fresh election now: ${v.registrationHours} hours of registration? Courts and votes so far are dropped.`} />
      </div>
    </div>
  ) : null;
  if (!v.phase || v.phase === 'none') {
    return (
      <>
        <p className="citizen__note">{ofPlace(v.name).replace(/^./, (x) => x.toUpperCase())} will choose its Jarl once {v.threshold} of its people are citizens. Today: {v.citizens} of {v.threshold}.</p>
        <p className="citizen__muted">Then candidates have {v.registrationHours} hours to enter a full court, and the citizens {v.votingHours} hours to vote.</p>
        {staff}
      </>
    );
  }
  if (v.phase === 'held') return (<><p className="citizen__note">The election is held by the staff for now.</p>{staff}</>);
  if (v.phase === 'registration') {
    return (
      <>
        <p className="citizen__note">Courts may be entered until {whenText(v.endsAt)}. Then the vote runs {v.votingHours} hours. A court stands on the ballot only when all four have accepted: {v.seats.map((s) => s.label).join(', ')}.</p>
        {(v.invites || []).map((i) => (
          <div key={i.court} className="citizen__invite">
            <span>{i.jarl} names you <b>{i.seat}</b> of their court.</span>
            <span className="citizen__actions">
              <button type="button" className="citizen__button citizen__button--small" disabled={busy} onClick={() => act('accept', i.court)}>Accept</button>
              <button type="button" className="citizen__link" disabled={busy} onClick={() => act('refuse', i.court)}>Refuse</button>
            </span>
          </div>
        ))}
        <div className="citizen__list">
          {(v.courts || []).length ? (v.courts || []).map((c) => <CourtCard key={c.id} court={c} busy={busy} act={act} />) : <span className="citizen__empty">No court has been entered yet.</span>}
        </div>
        {!v.inCourt ? (v.standWhy ? <p className="citizen__muted">You cannot stand for Jarl: you {v.standWhy.replace(/^is /, 'are ').replace(/^serves/, 'serve')}.</p> : <RegisterForm v={v} busy={busy} act={act} />) : null}
        {staff}
      </>
    );
  }
  if (v.phase === 'voting') {
    return (
      <>
        <p className="citizen__note">{v.revote ? 'The vote was tied. A new vote between the tied courts' : 'The vote'} runs until {whenText(v.endsAt)}. Nobody sees a count until it ends.</p>
        {v.voted ? <p className="citizen__note citizen__note--ok">Your vote is cast.</p> : v.voteWhy ? <p className="citizen__note citizen__note--warn">{v.voteWhy}</p> : <p className="citizen__note">One vote for each player. Choose a court.</p>}
        <div className="citizen__list">
          {(v.ballot || []).map((c) => <CourtCard key={c.id} court={c} busy={busy} act={act} ballot canVote={!v.voted && !v.voteWhy} />)}
        </div>
        {staff}
      </>
    );
  }
  const r = v.result;
  return (
    <>
      {r && r.winner ? (
        <>
          <p className="citizen__note">{ofPlace(v.name).replace(/^./, (x) => x.toUpperCase())} has chosen its Jarl: <b>{r.winner.jarl}</b>, on {whenText(r.at)}.</p>
          <CourtCard court={r.winner} busy={busy} act={act} ballot />
          {r.empty.length ? <p className="citizen__muted">The seat{r.empty.length > 1 ? 's' : ''} of {r.empty.join(', ')} started empty; the Jarl appoints a citizen from the court panel.</p> : null}
          <span className="citizen__label">The count</span>
          <div className="citizen__list">
            {r.counts.map((c) => <div key={c.jarl} className="citizen__entry"><span>The court of {c.jarl}</span><span className="citizen__strong">{c.votes} vote{c.votes === 1 ? '' : 's'}</span></div>)}
          </div>
        </>
      ) : <p className="citizen__note">The election is over.</p>}
      {staff}
    </>
  );
};

const CitizenBoard = ({ data }: { data: CitizenBoardData }) => {
  const [busy, setBusy] = useState(false);
  useEffect(() => { setBusy(false); }, [data]);
  useEffect(() => {
    if (!busy) return undefined;
    const t = setTimeout(() => setBusy(false), BUSY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [busy]);
  const act: Act = (action, ...args) => {
    if (busy) return;
    setBusy(true);
    send('dbo:citizenAct', data.nonce, action, ...args.map(String));
  };
  const tab = data.tab === 'voting' ? 'voting' : 'citizenship';
  return (
    <div className="citizen">
      <div className="citizen__fade" />
      <div className="citizen__panel">
        <h2 className="citizen__title">{data.name} Notice Board</h2>
        <div className="citizen__tabs">
          <button type="button" className={'citizen__tab' + (tab === 'citizenship' ? ' citizen__tab--on' : '')} onClick={() => tab !== 'citizenship' && act('tab', 'citizenship')}>Citizenship</button>
          <button type="button" className={'citizen__tab' + (tab === 'voting' ? ' citizen__tab--on' : '')} onClick={() => tab !== 'voting' && act('tab', 'voting')}>Voting</button>
        </div>
        <div className="citizen__body">
          {!data.grants ? <p className="citizen__note citizen__lore">{data.why}</p>
            : tab === 'citizenship' && data.citizenship ? <CitizenshipBody c={data.citizenship} busy={busy} act={act} />
              : data.voting ? <VotingBody v={data.voting} busy={busy} act={act} /> : null}
        </div>
        {data.result ? <p className={'citizen__result' + (data.resultKind === 'refused' ? ' citizen__result--refused' : '')}>{data.result}</p> : null}
        <div className="citizen__row citizen__row--end">
          <button type="button" className="citizen__close" onClick={() => send('dbo:citizenBack')}>Back to the board</button>
          <button type="button" className="citizen__close" onClick={() => send('dbo:citizenClose')}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default CitizenBoard;
