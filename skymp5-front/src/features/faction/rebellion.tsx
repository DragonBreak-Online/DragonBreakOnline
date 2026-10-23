import React from 'react';

import { Confirm, Field } from './guild';

// The Rebellion tab of the faction panel (server rebellion.js __dboRebellionView, inside guilds.js's payload as
// `rebellion`; null, and the tab hidden, while risings are off). Every button is the /rebellion command of the same name,
// sent as dbo:rebellionTab* with the panel's nonce. Signer names come only to the petition's starter and leader (and Lead
// GMs, in staffPetitions); a signer sees the count.
export interface PetitionView {
  id: number; zone: string; holdName: string; code: string; startedAt: number; expiresAt: number;
  count: number; needMin: number; needShare: number; citizens: number; mode: 'any' | 'both'; needed: number; met: boolean; needText: string;
  starter: boolean; leader: boolean; starterName: string; leaderName: string;
  claimant: { actor: number; name: string } | null; name: string; named: boolean;
  signers: { actor: number; name: string; starter: boolean; leader: boolean }[];
}
export interface RisingView {
  id: number; name: string; zone: string; holdName: string; status: string; declaredAt: number; startsAt: number;
  leaderName: string; claimantName: string; capital: string; rebels: string[];
  rebel: boolean; leads: boolean; rules: boolean; canJoin: boolean; canAnswerDeath: boolean;
  war: { status: string; startsAt: number; windows: { start: number; end: number }[]; death: string | null;
    captures: { territory: string; at: number; byRebels: boolean }[] } | null;
}
export interface RebellionView {
  rules: { noticeDays: number; windowsPerWar: number; windowHours: number; deathWar: boolean; petitionDays: number; outlawDays: number; outlawBounty: number; joinAfterDeclare: boolean };
  petition: PetitionView | null;
  holds: { id: string; name: string; open: boolean }[];
  cooldownUntil: number;
  risings: RisingView[];
  staffPetitions: PetitionView[] | null;
}

type Act = (key: string, ...args: unknown[]) => void;

const when = (ms: number): string => new Date(ms).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const hm = (ms: number): string => new Date(ms).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' });
const STATUS: Record<string, string> = { notice: 'notice given', active: 'under way' };
const DEATH: Record<string, string> = {
  proposed: 'The rebels ask for a war to the death; the ruler has not answered.',
  accepted: 'A war to the death: accepted by the ruler.',
  refused: 'The ruler refused a war to the death: no permadeath in it.',
};

// The war's timeline: the declaration, the notice, each battle window (past, under way, to come) and every capture
const Timeline = ({ r, now }: { r: RisingView; now: number }) => {
  const w = r.war;
  if (!w) return null;
  return (
    <ol className="rebellion__timeline">
      <li className="rebellion__step rebellion__step--past">Declared {when(r.declaredAt)}</li>
      <li className={'rebellion__step' + (now >= w.startsAt ? ' rebellion__step--past' : ' rebellion__step--now')}>Notice until {when(w.startsAt)}</li>
      {w.windows.map((x, i) => {
        const state = now >= x.end ? 'past' : now >= x.start ? 'now' : 'next';
        return (
          <li key={x.start} className={'rebellion__step rebellion__step--' + state}>
            Battle {i + 1}: {when(x.start)} to {hm(x.end)}{state === 'now' ? ' (now)' : ''}
          </li>
        );
      })}
      {w.captures.map((c) => (
        <li key={c.territory + c.at} className="rebellion__step rebellion__step--capture">
          {c.territory} taken by the {c.byRebels ? 'rebels' : 'loyalists'}, {when(c.at)}
        </li>
      ))}
    </ol>
  );
};

const RisingCard = ({ r, act, busy, now }: { r: RisingView; act: Act; busy: boolean; now: number }) => (
  <div className="war war--declare">
    <div className="war__head"><b>{r.name}</b><span className="war__status war__status--active">{STATUS[r.status] || r.status}</span></div>
    <div className="war__line">Against the ruler of {r.holdName}, for {r.capital}. Led by {r.leaderName}{r.claimantName && r.claimantName !== r.leaderName ? `; ${r.claimantName} would take the throne` : ''}.</div>
    <div className="war__line war__line--dim">{r.rebels.length} rebel{r.rebels.length === 1 ? '' : 's'}: {r.rebels.join(', ')}</div>
    {r.rebel && <div className="war__line">You rose with it.{r.leads ? ' You lead it.' : ''}</div>}
    {r.rules && <div className="war__line war__line--death">This rising stands against you.</div>}
    <Timeline r={r} now={now} />
    {r.war && r.war.death && <div className={'war__line' + (r.war.death === 'refused' ? ' war__line--dim' : ' war__line--death')}>{DEATH[r.war.death] || r.war.death}</div>}
    <div className="war__actions">
      {r.canJoin && <Confirm label="Join the rising" ask={`Rise with ${r.name}? If it fails you become an outlaw of ${r.holdName}.`} yes="Rise" danger busy={busy} onYes={() => act('dbo:rebellionTabJoin', r.zone)} />}
      {r.canAnswerDeath && (
        <>
          <Confirm label="Accept a war to the death" ask="Fight it to the death? The fallen may die for good." yes="Accept" danger busy={busy} onYes={() => act('dbo:rebellionTabDeath', 'accept')} />
          <button className="faction__button" disabled={busy} onClick={() => act('dbo:rebellionTabDeath', 'refuse')}>Refuse</button>
        </>
      )}
    </div>
  </div>
);

const PetitionCard = ({ p, act, busy, rules, okNonce, staffView }: { p: PetitionView; act: Act; busy: boolean; rules: RebellionView['rules']; okNonce: string | null; staffView?: boolean }) => {
  const carries = !staffView && (p.starter || p.leader);
  const pct = Math.max(0, Math.min(100, Math.round((p.count / Math.max(1, p.needed)) * 100)));
  const claimant = p.claimant ? p.claimant.actor : 0;
  return (
    <div className="war">
      <div className="war__head"><b>Secret petition against the ruler of {p.holdName}</b><span className="war__status">lapses {when(p.expiresAt)}</span></div>
      {!staffView && <div className="war__line">{p.starter && p.leader ? 'You began it and lead it.' : p.leader ? 'You lead it.' : p.starter ? `You began it; ${p.leaderName} leads it.` : 'Your name is on it.'}</div>}
      <div className="war__line">Its word: <b className="rebellion__code">{p.code}</b>{carries ? ' (hand it only to those you trust)' : ''}</div>
      <div className="rebellion__meter"><div className="rebellion__fill" style={{ width: pct + '%' }} /></div>
      <div className={'war__line' + (p.met ? '' : ' war__line--dim')}>
        {p.count} of {p.needed} names{p.met ? ': enough to rise.' : '.'} It needs {p.needMin} accounts {p.mode === 'any' ? 'or' : 'and'} a share of the hold's {p.citizens} citizen accounts ({p.needShare}).
      </div>
      {(carries || staffView) && (
        <>
          <div className="war__line">The rising: <b>{p.name}</b>{p.named ? '' : ' (its default name)'}. To take the throne: <b>{p.claimant ? p.claimant.name : p.leaderName}</b>.{staffView ? ` Begun by ${p.starterName}, led by ${p.leaderName}.` : ''}</div>
          <div className="realm__section-head">Signed ({p.signers.length})</div>
          <div className="rebellion__signers">
            {p.signers.map((s) => (
              <div key={s.actor} className="rebellion__signer">
                <span className="realm__name">{s.name}</span>
                <span className="war__line--dim">{[s.starter ? 'began it' : '', s.leader ? 'leads it' : '', s.actor === claimant ? 'to take the throne' : ''].filter(Boolean).join(', ')}</span>
                {!staffView && (
                  <span className="rebellion__signer-actions">
                    {p.starter && !s.leader && <button className="faction__button faction__button--small" disabled={busy} onClick={() => act('dbo:rebellionTabLeader', s.actor)}>Make leader</button>}
                    {p.leader && s.actor !== claimant && <button className="faction__button faction__button--small" disabled={busy} onClick={() => act('dbo:rebellionTabClaimant', s.actor)}>To the throne</button>}
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {!staffView && p.leader && (
        <>
          <div className="realm__section-head">Name the rising</div>
          <Field placeholder={p.name} label="Name it" busy={busy} clearOn={okNonce} onSend={(v) => act('dbo:rebellionTabName', v)} />
          <div className="war__actions">
            {p.met ? (
              <>
                <Confirm label="Declare the rising" ask={`Declare ${p.name} in public? Every signer becomes a rebel.`} yes="Declare" danger busy={busy} onYes={() => act('dbo:rebellionTabDeclare', '')} />
                {rules.deathWar && <Confirm label="Declare, to the death" ask="Ask for a war to the death? If the ruler accepts, the fallen may die for good." yes="Declare to the death" danger busy={busy} onYes={() => act('dbo:rebellionTabDeclare', 'death')} />}
              </>
            ) : <span className="war__line--dim">It can be declared once it has enough names.</span>}
          </div>
        </>
      )}
      {!staffView && (
        <div className="war__actions">
          {carries ? (
            <Confirm label="Tear it up" ask="Tear up the petition? Every name on it is lost." yes="Tear it up" danger busy={busy} onYes={() => act('dbo:rebellionTabAbandon')} />
          ) : (
            <Confirm label="Take my name back" ask="Take your name off the petition?" yes="Take it back" busy={busy} onYes={() => act('dbo:rebellionTabUnsign')} />
          )}
        </div>
      )}
    </div>
  );
};

export const RebellionTab = ({ reb, act, busy, okNonce }: { reb: RebellionView; act: Act; busy: boolean; okNonce: string | null }) => {
  const now = Date.now();
  const R = reb.rules;
  return (
    <div className="wars rebellion">
      {reb.risings.map((r) => <RisingCard key={r.id} r={r} act={act} busy={busy} now={now} />)}

      {reb.petition ? (
        <PetitionCard p={reb.petition} act={act} busy={busy} rules={R} okNonce={okNonce} />
      ) : (
        <div className="war">
          <div className="war__head"><b>Rise against a ruler</b></div>
          {reb.cooldownUntil > now && <div className="war__line war__line--death">You rose not long ago. You may rise again from {when(reb.cooldownUntil)}.</div>}
          <div className="war__line war__line--dim">A citizen of a hold, outside its court, begins a secret petition; others sign it with its word. Only you and staff see who signed.</div>
          {reb.holds.length ? (
            <div className="war__actions">
              {reb.holds.map((h) => (
                <Confirm key={h.id} label={`Begin a petition in ${h.name}`} ask={`Begin a secret petition against the ruler of ${h.name}?`} yes="Begin it" busy={busy || !h.open}
                  onYes={() => act('dbo:rebellionTabPetition', h.id)} />
              ))}
            </div>
          ) : <div className="war__line war__line--dim">You are a citizen of no hold that could rise.</div>}
          {reb.holds.some((h) => !h.open) && <div className="war__line war__line--dim">A greyed hold has a petition or a rising already, rose lately, or you serve its court.</div>}
          <div className="realm__section-head">Sign a petition</div>
          <Field placeholder="The petition's word" label="Sign" busy={busy} clearOn={okNonce} max={12} onSend={(v) => act('dbo:rebellionTabSign', v)} />
        </div>
      )}

      {reb.staffPetitions && reb.staffPetitions.length > 0 && (
        <>
          <div className="realm__section-head">Every petition (staff)</div>
          {reb.staffPetitions.map((p) => <PetitionCard key={'s' + p.id} p={p} act={act} busy={busy} rules={R} okNonce={okNonce} staffView />)}
        </>
      )}

      <div className="war__line war__line--dim rebellion__rules">
        A petition lapses after {R.petitionDays} days. A declared rising gives {R.noticeDays} days of notice, then {R.windowsPerWar} battle windows of {R.windowHours} hours for the hold's capital.
        {R.joinAfterDeclare ? ' Citizens may join it until it ends.' : ''} Taking the capital deposes the court and seats the rebels' claimant; failing makes every rebel an outlaw of the hold for {R.outlawDays} days, wanted for {R.outlawBounty} gold.
      </div>
    </div>
  );
};
