import React, { useEffect, useState } from 'react';

import { registerJournalTab, JournalTabProps } from '../journal/tabs';
import { Picker } from '../../components/Picker/Picker';
import { SearchBar, fuzzyFilter } from '../../components/SearchBar/SearchBar';
import './styles.scss';

// The F3 journal's Court tab (F3 design 3.6, H9; gameplay court.js). One tab with a list of courts: a player sees the
// courts they serve or are offered a post in, staff see every zone. Each court shows its offices (officials.json) and
// its household (the zone's hold faction). A ruler's appointment is an offer the target accepts here; staff appoint
// outright. Every action is dbo:court* with the journal nonce first; the answer lands in the journal's footer.
// A Lead GM (court.canName) renames an office or a household rank for everyone holding it (server rolenames.js): the id
// stays, the name shows at once, Default sets it back. Renaming an office renames the household rank it sets with it.

export interface CourtHolder { pid: number; name: string; tag: string; online: boolean }
export interface CourtOffice { rank: string; title: string; seats: number | null; holders: CourtHolder[]; canAppoint: boolean; named?: boolean; default?: string; wage?: number }
export interface CourtOfferOut { id: string; name: string; rank: string; title: string; from: string; at: number; expiresAt: number }
export interface CourtOfferIn { id: string; zone: string; zoneName: string; rank: string; title: string; from: string; at: number; expiresAt: number }
export interface HouseholdMember { actorId: number; name: string; tag: string; rank: number; title: string; role: string; online: boolean }
export interface Household {
  id: string; name: string; myRank: number; canInvite: boolean; canKick: boolean; canSetRank: boolean;
  ranks: Array<{ title: string; role: string; canon?: string }>; members: HouseholdMember[];
  pending?: Array<{ actorId: number; name: string; from: string; at: number }>;
}
export interface CourtView {
  id: string; name: string; kind: 'hold' | 'stronghold' | 'region'; mine: boolean; offices: CourtOffice[]; outgoing: CourtOfferOut[];
  household: Household | null; treasury: number | null; appointable: Array<{ rank: string; title: string }>; canName?: boolean;
  // The hold's one tax rate (business.js) and who keeps its books (economy.js wages)
  tax?: { pct: number; max: number; canSet: boolean } | null; keepsBooks?: boolean;
  // The hold's terms for its standing hunting contracts (contracts.js; null or missing where no treasury pays them)
  contracts?: CourtContracts | null;
  // Beasts seen changing in the hold (server exposure.js); staff also get the witness count and the hunters among them
  exposed?: CourtExposed[] | null;
}
export interface CourtExposed {
  // name: '' unless the viewer is staff, or of the same court as the beast (the court-powers rule)
  name: string; what: string; place: string; at: number; until: number; bounty: number; hurt: boolean; wanted: boolean;
  seen?: number; hunters?: string[];
}
export interface CourtContractTier { tier: number; name: string; price: number; kinds?: string[] }
export interface CourtContracts {
  tiers: CourtContractTier[]; bounds: { min: number; max: number }; budget: number; budgetMax: number; spent: number; left: number;
  resetsAt: number; standing: boolean; citizensOnly: boolean; canSet: boolean; by: string; at: number; enabled?: boolean;
}
export interface CourtSection { staff: boolean; outright: boolean; courts: CourtView[]; selected: string; offers: CourtOfferIn[] }

const KINDS: Array<{ id: string; label: string }> = [{ id: '', label: 'All' }, { id: 'hold', label: 'Holds' }, { id: 'stronghold', label: 'Strongholds' }, { id: 'region', label: 'Regions' }];
const hoursLeft = (until: number): string => { const h = Math.max(0, Math.round((until - Date.now()) / 3600000)); return h <= 1 ? 'less than an hour left' : `${h} hours left`; };

const OfferCards = ({ offers, busy, act }: { offers: CourtOfferIn[]; busy: boolean; act: JournalTabProps['act'] }) => (
  offers.length ? (
    <div className="court__offers">
      {offers.map((o) => (
        <div key={o.id} className="court__offer">
          <span className="court__offer-text">Offered: <b>{o.title} of {o.zoneName}</b>, by {o.from} <span className="court__muted">({hoursLeft(o.expiresAt)})</span></span>
          <span className="court__offer-actions">
            <button type="button" className="journal__button journal__button--primary" disabled={busy} onClick={() => act('dbo:courtAnswer', o.id, 'accept')}>Accept</button>
            <button type="button" className="journal__button" disabled={busy} onClick={() => act('dbo:courtAnswer', o.id, 'decline')}>Decline</button>
          </span>
        </div>
      ))}
    </div>
  ) : null
);

// A Lead GM's rename of one office or rank: Rename opens a box, Save sends it, Default puts the default back
const RenameControl = ({ court, kind, id, title, fallback, busy, act }: {
  court: CourtView; kind: 'office' | 'rank'; id: string | number; title: string; fallback?: string; busy: boolean; act: JournalTabProps['act'];
}) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(title);
  useEffect(() => { setEditing(false); setText(title); }, [title, court.id]);
  if (!court.canName) return null;
  const send = (name: string): void => { act('dbo:courtRename', court.id, kind, id, name); setEditing(false); };
  if (!editing) {
    return (
      <span className="court__rename">
        <button type="button" className="journal__button journal__button--small" disabled={busy} onClick={() => { setText(title); setEditing(true); }}>Rename</button>
        {fallback ? <button type="button" className="journal__button journal__button--small" disabled={busy} title={`Back to ${fallback}`} onClick={() => send('')}>Default</button> : null}
      </span>
    );
  }
  return (
    <span className="court__rename court__rename--open">
      <input className="court__input" value={text} maxLength={40} placeholder={fallback || title} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && text.trim()) send(text.trim()); if (e.key === 'Escape') setEditing(false); }} />
      <button type="button" className="journal__button journal__button--small journal__button--primary" disabled={busy || !text.trim() || text.trim() === title} onClick={() => send(text.trim())}>Save</button>
      <button type="button" className="journal__button journal__button--small" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
    </span>
  );
};

// A whole number with a Set button, for the tax rate, the wages and the contract terms
const NumberSet = ({ value, min = 0, max, suffix, busy, onSet }: { value: number; min?: number; max: number; suffix: string; busy: boolean; onSet: (n: number) => void }) => {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const n = Number(text);
  const bad = text === '' || n < min || n > max || n === value;
  return (
    <span className="court__set">
      <input className="court__input court__input--number" inputMode="numeric" value={text} maxLength={6}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !bad) onSet(n); }} />
      <span className="court__muted">{suffix}</span>
      <button type="button" className="journal__button journal__button--small" disabled={busy || bad} onClick={() => onSet(n)}>Set</button>
    </span>
  );
};

// When the week's budget renews (server: Monday 00:00 UTC), as "Monday 00:00 UTC, in 2d 5h"
const untilText = (t: number): string => {
  const ms = Math.max(0, t - Date.now());
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.ceil((ms % 3600000) / 60000);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};
const dateText = (t: number): string => new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

// The hold's standing hunting contracts (server contracts.js, set through court.js courtContract*): the pay per kill by
// danger tier, the weekly budget and standing on/off for those who set its tax; read-only lines for everyone else
const ContractTerms = ({ court, terms, busy, act }: { court: CourtView; terms: CourtContracts; busy: boolean; act: JournalTabProps['act'] }) => (
  <div className="court__contracts">
    <h3 className="court__heading">Hunting contracts</h3>
    {terms.enabled === false ? <p className="court__muted">Hunting contracts are closed everywhere for now.</p> : null}
    <p className="court__muted court__term-line">Pay per kill</p>
    {terms.tiers.map((t) => (
      <div key={t.tier} className="court__term">
        <span className="court__term-label" title={t.kinds && t.kinds.length ? t.kinds.join(', ') : undefined}>{t.name.charAt(0).toUpperCase() + t.name.slice(1)}</span>
        {terms.canSet
          ? <NumberSet value={t.price} min={terms.bounds.min} max={terms.bounds.max} suffix="gold" busy={busy} onSet={(n) => act('dbo:courtContractPrice', court.id, t.tier, n)} />
          : <span>{t.price} gold</span>}
      </div>
    ))}
    {terms.canSet ? <p className="court__muted court__term-hint">Pay per kill runs from {terms.bounds.min} to {terms.bounds.max} gold; contracts already taken keep their pay.</p> : null}
    <div className="court__term">
      <span className="court__term-label">Weekly budget</span>
      {terms.canSet
        ? <NumberSet value={terms.budget} max={terms.budgetMax} suffix="gold" busy={busy} onSet={(n) => act('dbo:courtContractBudget', court.id, n)} />
        : <span>{terms.budget} gold</span>}
    </div>
    <div className="court__term">
      <span className="court__term-label">Standing contracts</span>
      <span>{terms.standing ? 'On' : 'Stopped by its officials'}</span>
      {terms.canSet ? (
        <button type="button" className="journal__button journal__button--small" disabled={busy}
          onClick={() => act('dbo:courtContractStanding', court.id, terms.standing ? 'off' : 'on')}>{terms.standing ? 'Stop them' : 'Post them again'}</button>
      ) : null}
    </div>
    <p className="court__muted court__term-line">This week: {terms.spent} gold spent, {terms.left} left. It renews Monday 00:00 UTC, in {untilText(terms.resetsAt)}.</p>
    <p className="court__muted court__term-line">{terms.citizensOnly ? `Citizens of ${court.name} only.` : 'Open to every hunter.'} Work an official posts by hand is open to all.</p>
    <p className="court__muted court__term-line">{terms.by ? `Last set by ${terms.by}, ${dateText(terms.at)}.` : 'Never changed: the realm\'s defaults.'}</p>
  </div>
);

const OfficeRow = ({ court, office, outright, busy, act }: { court: CourtView; office: CourtOffice; outright: boolean; busy: boolean; act: JournalTabProps['act'] }) => {
  const [name, setName] = useState('');
  useEffect(() => { setName(''); }, [office.holders.length]);
  const moves = court.appointable.filter((x) => x.rank !== office.rank);
  const full = office.seats !== null && office.holders.length >= office.seats;
  return (
    <div className="court__office">
      <div className="court__office-head">
        <span className="court__office-title">{office.title}{office.named && office.default ? <span className="court__muted"> ({office.default})</span> : null}</span>
        <span className="court__muted">{office.seats !== null ? `${office.holders.length} / ${office.seats}` : office.holders.length || ''}</span>
      </div>
      {office.wage !== undefined ? (
        court.keepsBooks ? (
          <div className="court__wage">Weekly wage <NumberSet value={office.wage} max={100000} suffix="gold" busy={busy} onSet={(n) => act('dbo:courtWage', court.id, office.rank, n)} /></div>
        ) : <div className="court__wage court__muted">{office.wage ? `${office.wage} gold a week` : 'Unpaid'}</div>
      ) : null}
      <RenameControl court={court} kind="office" id={office.rank} title={office.title} fallback={office.named ? office.default : undefined} busy={busy} act={act} />
      {office.holders.length ? office.holders.map((h) => (
        <div key={h.pid} className="court__holder">
          <span className={'court__dot' + (h.online ? ' court__dot--online' : '')} />
          <span className="court__holder-name">{h.name}{h.tag ? <span className="court__muted"> #{h.tag}</span> : null}{h.online ? null : <span className="court__muted"> (offline)</span>}</span>
          {office.canAppoint ? (
            <>
              {moves.length ? (
                <Picker className="court__move" commit value="" disabled={busy} title="Move to another office of this court"
                  onChange={(rank) => rank && act('dbo:courtMove', court.id, h.pid, rank)}
                  options={[{ value: '', label: 'Move to…' }].concat(moves.map((m) => ({ value: m.rank, label: m.title })))} />
              ) : null}
              <button type="button" className="journal__button journal__button--small" disabled={busy} onClick={() => act('dbo:courtDismiss', court.id, h.pid)}>Dismiss</button>
            </>
          ) : null}
        </div>
      )) : <p className="court__empty">Vacant.</p>}
      {office.canAppoint && !full ? (
        <div className="court__appoint">
          <input className="court__input" value={name} placeholder="Name or #TAG" onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && name.trim()) act(outright ? 'dbo:courtAppoint' : 'dbo:courtOffer', court.id, name.trim(), office.rank); }} />
          <button type="button" className="journal__button" disabled={busy || !name.trim()} onClick={() => act('dbo:courtOffer', court.id, name.trim(), office.rank)}>Offer the post</button>
          {outright ? <button type="button" className="journal__button journal__button--primary" disabled={busy || !name.trim()} onClick={() => act('dbo:courtAppoint', court.id, name.trim(), office.rank)}>Appoint</button> : null}
        </div>
      ) : null}
    </div>
  );
};

const HouseholdPane = ({ court, household, busy, act }: { court: CourtView; household: Household | null; busy: boolean; act: JournalTabProps['act'] }) => {
  const [invite, setInvite] = useState('');
  useEffect(() => { setInvite(''); }, [household && household.members.length]);
  if (!household) return <p className="court__empty">This court keeps no household.</p>;
  return (
    <div className="court__household">
      <h3 className="court__heading">{household.name}</h3>
      {household.members.length ? household.members.map((m) => (
        <div key={m.actorId} className="court__member">
          <span className={'court__dot' + (m.online ? ' court__dot--online' : '')} />
          <span className="court__member-name">{m.name} <span className="court__muted">#{m.tag}</span></span>
          {/* The head's rank follows the office (court.js): it is neither offered nor changed here */}
          {household.canSetRank && m.role !== 'leader' ? (
            <Picker className="court__rank" commit value={m.rank} disabled={busy} onChange={(v) => act('dbo:courtRank', court.id, m.actorId, v)}
              options={household.ranks.map((r, i) => ({ value: i, label: r.title, role: r.role })).filter((r) => r.role !== 'leader').map(({ value, label }) => ({ value, label }))} />
          ) : <span className="court__member-title">{m.title}</span>}
          {household.canKick && (household.myRank < 0 || household.myRank < m.rank) ? (
            <button type="button" className="journal__button journal__button--small" disabled={busy} onClick={() => act('dbo:courtKick', court.id, m.actorId)}>Remove</button>
          ) : null}
        </div>
      )) : <p className="court__empty">Nobody belongs to the household yet.</p>}
      {household.canInvite ? (
        <div className="court__appoint">
          <input className="court__input" value={invite} placeholder="Invite someone online: name or #TAG" onChange={(e) => setInvite(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          <button type="button" className="journal__button" disabled={busy || !invite.trim()} onClick={() => act('dbo:courtInvite', court.id, invite.trim())}>Invite</button>
        </div>
      ) : null}
      {household.pending && household.pending.length ? (
        <p className="court__muted">Invited: {household.pending.map((p) => p.name).join(', ')}</p>
      ) : null}
      <p className="court__note">An office sets its holder's rank here; giving up the office returns them to the lowest rank.</p>
      {court.canName ? (
        <div className="court__names">
          <h3 className="court__heading">Rank names</h3>
          {household.ranks.map((r, i) => (
            <div key={i} className="court__name-row">
              <span className="court__member-name">{r.title}{r.canon ? <span className="court__muted"> ({r.canon})</span> : null}</span>
              <RenameControl court={court} kind="rank" id={i} title={r.title} fallback={r.canon} busy={busy} act={act} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

// Leaving your own court (server court.js courtResign): the office seat, then the household; asked twice
const StepDown = ({ court, busy, act }: { court: CourtView; busy: boolean; act: JournalTabProps['act'] }) => {
  const [sure, setSure] = useState(false);
  useEffect(() => { setSure(false); }, [court.id]);
  if (!sure) return <button type="button" className="journal__button journal__button--small" disabled={busy} onClick={() => setSure(true)}>Step down</button>;
  return (
    <span className="court__note">
      Leave the court of {court.name}, your post and the household? Only its ruler can take you back.{' '}
      <button type="button" className="journal__button journal__button--small" disabled={busy} onClick={() => { setSure(false); act('dbo:courtResign', court.id); }}>Step down</button>
      <button type="button" className="journal__button journal__button--small" onClick={() => setSure(false)}>Stay</button>
    </span>
  );
};

export const CourtTab = ({ section, busy, act }: JournalTabProps<CourtSection>) => {
  const s = section || { staff: false, outright: false, courts: [], selected: '', offers: [] };
  const [zone, setZone] = useState(s.selected || (s.courts[0] ? s.courts[0].id : ''));
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  useEffect(() => { if (s.selected) setZone(s.selected); }, [s.selected]);
  const list = fuzzyFilter(s.courts.filter((c) => !kind || c.kind === kind), search, (c) => c.name + ' ' + c.id);
  const court = s.courts.find((c) => c.id === zone) || s.courts[0] || null;
  return (
    <div className="court">
      <aside className="court__side">
        <h3 className="court__heading">Courts</h3>
        {s.staff ? (
          <SearchBar value={search} onChange={setSearch} placeholder="Search courts" chips={KINDS.map((k) => ({ id: k.id, label: k.label, count: k.id ? s.courts.filter((c) => c.kind === k.id).length : s.courts.length }))} chip={kind} onChip={setKind} />
        ) : null}
        {list.length ? list.map((c) => (
          <button key={c.id} type="button" className={'court__item' + (court && c.id === court.id ? ' court__item--on' : '')} onClick={() => setZone(c.id)}>
            <span>{c.name}</span>{c.mine && s.staff ? <span className="court__muted"> · yours</span> : null}
          </button>
        )) : <p className="court__empty">{s.courts.length ? 'No court matches.' : 'You serve no court yet.'}</p>}
      </aside>
      <section className="court__main">
        <OfferCards offers={s.offers || []} busy={busy} act={act} />
        {court ? (
          <>
            <h2 className="court__title">{court.kind === 'region' ? 'Court of ' : ''}{court.name}</h2>
            {court.mine && court.household && court.household.myRank >= 0 && (court.household.ranks[court.household.myRank] || { role: '' }).role !== 'leader' ? <StepDown court={court} busy={busy} act={act} /> : null}
            {court.treasury !== null ? <p className="court__muted">The treasury holds {court.treasury} gold.</p> : null}
            {court.tax ? (
              <div className="court__tax">
                <span>Tax: {court.tax.pct}% of every rent and, each week, of every property's value</span>
                {court.tax.canSet ? <NumberSet value={court.tax.pct} max={court.tax.max} suffix="%" busy={busy} onSet={(n) => act('dbo:courtTax', court.id, n)} /> : null}
              </div>
            ) : null}
            {court.contracts ? <ContractTerms court={court} terms={court.contracts} busy={busy} act={act} /> : null}
            {court.exposed && court.exposed.length ? (
              <div className="court__outgoing">
                <h3 className="court__heading">Seen as beasts</h3>
                {court.exposed.map((x, i) => (
                  <div key={i} className="court__holder">
                    <span className="court__holder-name">{x.name ? `${x.name}: ${x.what}` : x.what.charAt(0).toUpperCase() + x.what.slice(1)}, seen near {x.place}
                      <span className="court__muted"> ({x.wanted ? `wanted for ${x.bounty} gold` : 'bounty settled'}{x.hurt ? ', hurt people' : ''}, known until {new Date(x.until).toISOString().slice(0, 10)}{x.seen ? `; ${x.seen} witnesses` : ''}{x.hunters && x.hunters.length ? `; hunters: ${x.hunters.join(', ')}` : ''})</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {court.keepsBooks ? <p className="court__note">Wages are paid every Sunday from the treasury into each holder's bank account; the ruler is never paid, and nobody sets their own.</p> : null}
            <div className="court__offices">
              {court.offices.map((o) => <OfficeRow key={o.rank} court={court} office={o} outright={s.outright} busy={busy} act={act} />)}
            </div>
            {court.outgoing.length ? (
              <div className="court__outgoing">
                <h3 className="court__heading">Offers waiting</h3>
                {court.outgoing.map((o) => (
                  <div key={o.id} className="court__holder">
                    <span className="court__holder-name">{o.name}: {o.title} <span className="court__muted">(by {o.from}, {hoursLeft(o.expiresAt)})</span></span>
                    <button type="button" className="journal__button journal__button--small" disabled={busy} onClick={() => act('dbo:courtWithdraw', o.id)}>Withdraw</button>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : (s.offers || []).length ? null : <p className="court__empty">No court to show.</p>}
      </section>
      <aside className="court__right">
        {court ? <HouseholdPane court={court} household={court.household} busy={busy} act={act} /> : null}
      </aside>
    </div>
  );
};

registerJournalTab('court', CourtTab, 'aqua');
export default CourtTab;
