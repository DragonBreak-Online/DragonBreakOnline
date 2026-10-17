import React, { useState } from 'react';

// The vault tab of the bank (server bank.js, for a UI that says 'bankVault'): goods kept by weight, one vault per hold.
// Only the vault of the hold this bank stands in opens here; the others are listed by name. While the vaults are closed
// (enabled false) a holder still sees theirs and may pay and take out, nothing else (bank review F1). A seizure sells what
// covers the debt and sends the rest back by letter ('debt'), or sells everything ('value'), as the server says (F2).
export interface VaultTier { id: string; name: string; weight: number; weekly: number }
export interface VaultItem { row: number; baseId: number; name: string; count: number; weight: number; special: boolean }
export interface VaultCarry { baseId: number; name: string; count: number; weight: number }
export interface VaultElsewhere { zone: string; name: string; tier: string; items: number; used: number; owed: number }
export interface VaultData {
  enabled: boolean;
  zone: string;
  zoneName: string;
  tiers: VaultTier[];
  rented: boolean;
  held?: boolean;
  seizeCredit?: 'debt' | 'value';
  tier?: string;
  cap?: number;
  used?: number;
  weekly?: number;
  paidUntil?: number;
  owed?: number;
  seizeAt?: number;
  items?: VaultItem[];
  carry?: VaultCarry[];
  elsewhere: VaultElsewhere[];
}

const weightText = (n: number): string => String(Math.round((Number(n) || 0) * 100) / 100);
const dayText = (at: number): string => new Date(Number(at) || 0).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const Vault = ({ vault, busy, act }: { vault: VaultData; busy: boolean; act: (event: string, ...args: unknown[]) => void }) => {
  const [count, setCount] = useState('');
  // Renting and changing the vault spend gold at once: a second click confirms, with the price shown
  const [confirm, setConfirm] = useState('');
  const closed = !vault.enabled;
  const debtOnly = vault.seizeCredit !== 'value';
  const seizeRule = debtOnly
    ? 'If the fee goes unpaid for a month, enough of the goods to cover the debt are sold to the hold and the rest is sent back to you by letter.'
    : 'Goods left unpaid for a month are sold to the hold.';
  const closedNote = closed ? <p className="bank__result bank__result--refused">The vaults are closed for now. You can still pay what you owe and take your goods out; nothing is charged while they are closed.</p> : null;
  const n = Number(count) || 0;
  const amount = n > 0 ? String(n) : 'all';
  const tierName = (id?: string): string => (vault.tiers.find((t) => t.id === id) || { name: id || '' }).name;
  const cap = Number(vault.cap) || 0;
  const used = Number(vault.used) || 0;
  const owed = Number(vault.owed) || 0;
  const elsewhere = (vault.elsewhere || []).map((o) => (
    <p key={o.zone} className="bank__note">Stored in {o.name}: {o.items} kind{o.items === 1 ? '' : 's'} of goods, {weightText(o.used)} weight{o.owed ? `, ${o.owed} gold owed` : ''}. Only a bank of that hold opens it.</p>
  ));

  if (!vault.zone) return <div className="bank__section"><p className="bank__note">This bank keeps no vaults: it answers to no hold.</p>{elsewhere}</div>;
  const confirmRow = (t: VaultTier, change: boolean) => {
    if (confirm !== t.id) return null;
    const text = change
      ? `Change to a ${t.name}: up to ${t.weekly} gold now for its first week. What is left of this week counts towards it; nothing is paid back.`
      : `Rent a ${t.name}: ${t.weekly} gold now for its first week, then ${t.weekly} a week. Nothing is paid back if you give it up early.`;
    return (
      <div key={'confirm:' + t.id} className="bank__row">
        <span className="bank__note">{text}</span>
        <button className="bank__button" disabled={busy || closed} onClick={() => { setConfirm(''); act('dbo:bankRent', t.id); }}>Pay</button>
        <button className="bank__link" onClick={() => setConfirm('')}>Cancel</button>
      </div>
    );
  };
  const takeRows = (owed: number) => (vault.items || []).map((e) => (
    <div key={e.row + ':' + e.baseId} className="bank__row bank__vault-row">
      <span className="bank__vault-name">{e.name}{e.special ? ' *' : ''}</span>
      <span className="bank__vault-figure">x{e.count}</span>
      <span className="bank__vault-figure">{weightText(e.weight * e.count)}</span>
      <button className="bank__button" disabled={busy || owed > 0 || n > e.count} onClick={() => act('dbo:bankTake', e.row, String(e.baseId), amount)}>Take</button>
    </div>
  ));
  const countInput = (
    <div className="bank__row">
      <input
        className="bank__amount"
        inputMode="numeric"
        placeholder="How many (empty: all)"
        value={count}
        maxLength={6}
        onChange={(e) => setCount(e.target.value.replace(/[^0-9]/g, ''))}
        onKeyDown={(e) => { if (e.key === 'Escape' && !count) return; e.stopPropagation(); if (e.key === 'Escape') setCount(''); }}
      />
    </div>
  );
  if (!vault.rented) {
    return (
      <div className="bank__section">
        {closedNote}
        {vault.held && (
          <>
            <p className="bank__note">The bank holds these goods of yours from a vault it sold to cover a debt. No fee is charged on them; take them out when you like.</p>
            {countInput}
            {takeRows(0)}
          </>
        )}
        {!closed && <p className="bank__note">Rent a vault in {vault.zoneName} for your goods. It opens only at a bank of this hold. The fee is taken each week from your account, or from the gold you carry, and goes to the hold&apos;s treasury. {seizeRule}</p>}
        {!closed && vault.tiers.map((t) => (
          <React.Fragment key={t.id}>
            <div className="bank__row bank__vault-row">
              <span className="bank__vault-name">{t.name}</span>
              <span className="bank__vault-figure">{t.weight} weight</span>
              <span className="bank__vault-figure">{t.weekly} gold a week</span>
              <button className="bank__button" disabled={busy || closed || Number(vault.used) > t.weight} onClick={() => setConfirm(t.id)}>Rent</button>
            </div>
            {confirmRow(t, false)}
          </React.Fragment>
        ))}
        {elsewhere}
      </div>
    );
  }
  return (
    <div className="bank__section">
      <div className="bank__ledger bank__ledger--treasury">
        <span className="bank__figure"><span className="bank__label">{tierName(vault.tier)} in {vault.zoneName}</span><span className="bank__gold">{weightText(used)} / {cap} weight</span></span>
        <span className="bank__why">{vault.weekly} gold a week, paid to {dayText(Number(vault.paidUntil))}</span>
      </div>
      <div className="bank__vault-bar"><span style={{ width: `${cap > 0 ? Math.min(100, (used / cap) * 100) : 0}%` }} /></div>
      {closedNote}
      {owed > 0 && (
        <div className="bank__row">
          <span className="bank__result bank__result--refused">{owed} gold owed. Nothing comes out until it is paid{vault.seizeAt && !closed
            ? (debtOnly
                ? `. On ${dayText(Number(vault.seizeAt))} enough of the goods to cover the debt are sold to the hold, and the rest is sent back to you by letter`
                : `, and on ${dayText(Number(vault.seizeAt))} the goods are sold to the hold`)
            : ''}.</span>
          <button className="bank__button" disabled={busy} onClick={() => act('dbo:bankVaultPay')}>Pay</button>
        </div>
      )}
      {countInput}
      <span className="bank__label">In the vault</span>
      {(vault.items || []).length === 0 && <span className="bank__empty">Nothing yet.</span>}
      {takeRows(owed)}
      <span className="bank__label">You carry</span>
      {(vault.carry || []).length === 0 && <span className="bank__empty">Nothing the vault takes.</span>}
      {(vault.carry || []).map((e) => (
        <div key={e.baseId} className="bank__row bank__vault-row">
          <span className="bank__vault-name">{e.name}</span>
          <span className="bank__vault-figure">x{e.count}</span>
          <span className="bank__vault-figure">{weightText(e.weight)} each</span>
          <button className="bank__button" disabled={busy || closed || n > e.count || used + e.weight * (n || e.count) > cap + 1e-6} onClick={() => act('dbo:bankStore', String(e.baseId), amount)}>Store</button>
        </div>
      ))}
      <span className="bank__label">Change the vault</span>
      <div className="bank__row bank__row--quick">
        {vault.tiers.filter((t) => t.id !== vault.tier).map((t) => (
          <button key={t.id} className="bank__link" disabled={busy || closed || owed > 0 || used > t.weight} onClick={() => setConfirm(t.id)}>{t.name} ({t.weight}, {t.weekly} gold)</button>
        ))}
        <button className="bank__link" disabled={busy || closed || owed > 0 || (vault.items || []).length > 0} onClick={() => act('dbo:bankVaultEnd')}>Give it up</button>
      </div>
      {vault.tiers.filter((t) => t.id !== vault.tier).map((t) => confirmRow(t, true))}
      {elsewhere}
    </div>
  );
};

export default Vault;
