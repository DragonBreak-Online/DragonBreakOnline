'use strict';
// DragonBreak Online: stolen goods taken back (Nate, 12 Oct 2026, ticket #0138: "do both", the victim is given everything
// back by staff gift and the thief loses what is still to be found). Loaded by gamemode.js on every hot reload.
//
// A case (restitution-cases.json, tracked) names a character by #TAG, the items taken as { "<hex base id>": count } exactly as
// ITEMGUARD logged them, and optionally the containers the thief stashed them in, each capped at what the thief put there so
// nobody else's goods are touched. Up to each count, the module removes the items from the character's pack (at login and
// every sweepSeconds while online), from the listed containers (on the timer and as they are opened), and the gold still
// owed from the character's bank balance. Take only, never give: the victim is paid by tools/gift.js.
// State (restitution-state.json beside world/, never in git): { cases: { <id>: { recovered, fromContainer, log } } }. It is
// written before an inventory changes, and put back if the change throws, so a reload never counts an item twice.
// Config "restitution" in gamemode-config.json: { enabled, cases: [ids], sweepSeconds }; enabled false stops it.
const fs = require('fs');
const path = require('path');

const GOLD = 'f';
const DEFAULTS = { enabled: false, cases: [], sweepSeconds: 60, casesFile: '', stateFile: '' };

const hexOf = (id) => (Number(id) >>> 0).toString(16);

// Pure: takes up to want[hex] of each item from entries. -> { entries, taken: { hex: n }, worn: [hex] }
const take = (entries, want) => {
  const left = Object.assign({}, want), taken = {}, worn = [];
  const out = [];
  for (const e of entries || []) {
    const h = e ? hexOf(e.baseId) : '';
    const n = e ? Math.min(Number(e.count) || 0, left[h] || 0) : 0;
    if (!(n > 0)) { out.push(e); continue; }
    left[h] -= n; taken[h] = (taken[h] || 0) + n;
    if ((e.worn || e.wornLeft) && !worn.includes(h)) worn.push(h);
    if (Number(e.count) > n) out.push(Object.assign({}, e, { count: Number(e.count) - n }));
  }
  return { entries: out, taken, worn };
};

// Pure: what a case still owes per item, given what has been recovered
const owed = (items, recovered) => {
  const out = {};
  for (const [h, n] of Object.entries(items || {})) { const left = Number(n) - Number((recovered || {})[h] || 0); if (left > 0) out[h] = left; }
  return out;
};

const add = (into, from) => { for (const [h, n] of Object.entries(from)) into[h] = (into[h] || 0) + n; return into; };
const total = (m) => Object.values(m).reduce((s, n) => s + n, 0);

module.exports = (api) => {
  const { mp, log, personal, audit, who, onlineActors, every } = api;
  const C = Object.assign({}, DEFAULTS, (api.cfg || {}).restitution || {});
  const S = globalThis.__dboRestitutionS || (globalThis.__dboRestitutionS = {});
  const off = () => { globalThis.__dboRestitutionLogin = null; globalThis.__dboRestitutionContainer = null; };
  if (C.enabled !== true) { off(); if (typeof api.stopTimer === 'function') api.stopTimer('restitution'); log('restitution: off'); return; }

  let all = {};
  try { all = JSON.parse(fs.readFileSync(path.resolve(C.casesFile || 'restitution-cases.json'), 'utf8')); }
  catch (e) { off(); log(`restitution: cases unreadable (${e.message}); off`); return; }
  const CASES = (C.cases || []).map((id) => all[id] && Object.assign({ id }, all[id])).filter((c) => c && /^[A-Z0-9]{4}$/.test(c.tag || ''));
  if (!CASES.length) { off(); log('restitution: no case to run; off'); return; }

  const idOf = (desc) => { try { return mp.getIdFromDesc(desc) >>> 0; } catch (e) { return 0; } };
  const stateDir = () => { try { return path.dirname(fs.realpathSync(path.resolve('world'))); } catch (e) { return path.resolve('.'); } };
  const FILE = C.stateFile ? path.resolve(C.stateFile) : path.join(stateDir(), 'restitution-state.json');
  const state = () => {
    if (S.state && S.file === FILE) return S.state;
    let st = { cases: {} };
    try { st = Object.assign(st, JSON.parse(fs.readFileSync(FILE, 'utf8'))); }
    catch (e) { if (e.code !== 'ENOENT') { log(`restitution: ${FILE} unreadable (${e.message}); nothing is taken, the file is left as it is`); S.readOnly = true; } }
    S.state = st; S.file = FILE; return st;
  };
  const caseState = (c) => { const st = state(); return st.cases[c.id] || (st.cases[c.id] = { recovered: {}, fromContainer: {}, log: [] }); };
  const save = () => {
    if (S.readOnly) return false;
    try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(state(), null, 1)); fs.renameSync(FILE + '.tmp', FILE); return true; }
    catch (e) { log('restitution: state write failed', e.message); return false; }
  };
  // Records what was taken, then makes the change; the record is put back if the change throws
  const commit = (c, where, taken, change, container) => {
    const snap = JSON.stringify(state());
    const cs = caseState(c);
    add(cs.recovered, taken);
    if (container) add(cs.fromContainer[container] || (cs.fromContainer[container] = {}), taken);
    cs.log.push({ at: new Date().toISOString(), where, taken });
    if (!save()) { S.state = JSON.parse(snap); log(`restitution ${c.id}: state not saved; nothing taken`); return false; }
    try { change(); return true; }
    catch (e) { S.state = JSON.parse(snap); save(); log(`restitution ${c.id}: change failed, state put back`, e.message); return false; }
  };
  const describe = (taken) => Object.entries(taken).map(([h, n]) => (h === GOLD ? `${n} gold` : `${n} x ${h}`)).join(', ');

  const unequip = (a, h) => {
    try { mp.callPapyrusFunction('method', 'Actor', 'UnequipItem', { type: 'form', desc: mp.getDescFromId(a) }, [{ type: 'espm', desc: mp.getDescFromId(parseInt(h, 16)) }, false, true]); }
    catch (e) { log('restitution UnequipItem failed', e.message); }
  };

  const fromActor = (a, c) => {
    if (S.readOnly) return 0;
    let tag = ''; try { tag = mp.get(a, 'private.charTag'); } catch (e) { return 0; }
    if (tag !== c.tag) return 0;
    let got = 0;
    const want = owed(c.items, caseState(c).recovered);
    let inv; try { inv = mp.get(a, 'inventory'); } catch (e) { return 0; }
    const p = take(inv && Array.isArray(inv.entries) ? inv.entries : [], want);
    if (total(p.taken) && commit(c, `pack of ${who(a)}`, p.taken, () => {
      for (const h of p.worn) unequip(a, h);
      mp.set(a, 'inventory', { entries: p.entries });
    })) {
      got += total(p.taken);
      audit(`RESTITUTION ${c.id} took ${describe(p.taken)} from the pack of ${who(a)}`);
    }
    const gold = owed(c.items, caseState(c).recovered)[GOLD] || 0;
    let bank = 0; try { bank = Number(mp.get(a, 'private.bankGold')) || 0; } catch (e) { /* no account */ }
    const fromBank = c.bankGold === false ? 0 : Math.min(gold, bank);
    if (fromBank > 0 && commit(c, `bank of ${who(a)}`, { [GOLD]: fromBank }, () => mp.set(a, 'private.bankGold', bank - fromBank))) {
      got += fromBank;
      audit(`RESTITUTION ${c.id} took ${fromBank} gold from the bank account of ${who(a)}`);
    }
    if (got) try { personal(a, c.notice || 'Staff have taken back goods you took from another player\'s storage.'); } catch (e) { /* offline */ }
    return got;
  };

  const fromContainer = (ref, c) => {
    if (S.readOnly) return 0;
    const desc = Object.keys(c.containers || {}).find((d) => idOf(d) === (ref >>> 0));
    if (!desc) return 0;
    const cs = caseState(c);
    const cap = owed(c.containers[desc], cs.fromContainer[desc]);
    const due = owed(c.items, cs.recovered);
    const want = {};
    for (const [h, n] of Object.entries(cap)) if (due[h]) want[h] = Math.min(n, due[h]);
    if (!total(want)) return 0;
    let inv; try { inv = mp.get(ref, 'inventory'); } catch (e) { return 0; }
    const p = take(inv && Array.isArray(inv.entries) ? inv.entries : [], want);
    if (!total(p.taken) || !commit(c, `container ${desc}`, p.taken, () => mp.set(ref, 'inventory', { entries: p.entries }), desc)) return 0;
    audit(`RESTITUTION ${c.id} took ${describe(p.taken)} from container ${desc}`);
    return total(p.taken);
  };

  const sweep = () => {
    for (const c of CASES) {
      for (const a of onlineActors()) fromActor(a, c);
      for (const d of Object.keys(c.containers || {})) { const ref = idOf(d); if (ref) fromContainer(ref, c); }
    }
  };

  globalThis.__dboRestitutionLogin = (a) => { for (const c of CASES) fromActor(a >>> 0, c); };
  globalThis.__dboRestitutionContainer = (ref) => { for (const c of CASES) fromContainer(ref >>> 0, c); };
  globalThis.__dboRestitutionState = () => JSON.parse(JSON.stringify(state()));
  every('restitution', Math.max(10, Number(C.sweepSeconds) || 60) * 1000, sweep);
  log(`restitution on: ${CASES.map((c) => `${c.id} #${c.tag} ${total(owed(c.items, caseState(c).recovered))} of ${total(c.items)} still owed`).join('; ')}`);
};
module.exports.take = take;
module.exports.owed = owed;
module.exports.DEFAULTS = DEFAULTS;
