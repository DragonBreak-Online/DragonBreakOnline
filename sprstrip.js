'use strict';
// The Dawnguard War Axe SPR taken back (Nate, 11 Oct 2026: "strip the axe from everyone refund materials to the
// blacksmith"). JK's Fort Dawnguard.esp gives XJKFDDLC1DawnguardAxe (f0d) base damage 111; a Dawnguard smith forged 13
// on 10-11 Oct before regions.js forgeNever refused it. Every copy is removed from players and their bank vaults (at login, and every
// sweepSeconds for whoever is online) and from containers (the listed ones on a timer, any other as it is opened). For
// each copy removed, up to maxRefunds, the smith who made them gets the recipe's materials back (at once if online,
// else at his next login). Give only, never take.
// State (sprstrip-state.json beside world/, never in git): { removed, refunded, owed, log: [] }. It is written before an
// inventory changes, and put back if the change throws, so a reload never counts a copy twice.
// Config "sprStrip" in gamemode-config.json, read at load; enabled false stops it.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  enabled: false,
  item: 'f0d:JK\'s Fort Dawnguard.esp',
  itemName: 'Dawnguard War Axe SPR',
  smith: { actor: 'ff000574', profile: 78 },
  refund: [['5ace4:Skyrim.esm', 1, 'Iron Ingot'], ['5ace5:Skyrim.esm', 2, 'Steel Ingot'], ['800e4:Skyrim.esm', 1, 'Leather Strips']],
  maxRefunds: 13,
  containers: [],
  sweepSeconds: 60,
  stateFile: ''
};

// Pure: an inventory's entries without the item. -> { entries, removed, worn }
const without = (entries, item) => {
  let removed = 0, worn = false; const out = [];
  for (const e of entries || []) {
    if (e && (Number(e.baseId) >>> 0) === (item >>> 0) && Number(e.count) > 0) { removed += Number(e.count); if (e.worn || e.wornLeft) worn = true; continue; }
    out.push(e);
  }
  return { entries: out, removed, worn };
};

module.exports = (api) => {
  const { mp, log, personal, audit, who, onlineActors, every, giveItem } = api;
  const C = Object.assign({}, DEFAULTS, (api.cfg || {}).sprStrip || {});
  const S = globalThis.__dboSprStripS || (globalThis.__dboSprStripS = {});
  const off = () => { globalThis.__dboSprStripLogin = null; globalThis.__dboSprStripContainer = null; };
  if (C.enabled !== true) { off(); if (typeof api.stopTimer === 'function') { api.stopTimer('sprStrip'); api.stopTimer('sprStripStep'); } log('sprstrip: off'); return; }

  const idOf = (desc) => { try { return mp.getIdFromDesc(desc) >>> 0; } catch (e) { return 0; } };
  const ITEM = idOf(C.item);
  if (!ITEM) { off(); log(`sprstrip: ${C.item} is not in the load order; off`); return; }
  const SMITH = parseInt(String(C.smith && C.smith.actor || ''), 16) >>> 0;
  const SMITH_PROFILE = Number(C.smith && C.smith.profile);
  const REFUND = (C.refund || []).map(([d, n, name]) => [idOf(d), Number(n), String(name || d)]).filter(([id, n]) => id && n > 0);

  const stateDir = () => { try { return path.dirname(fs.realpathSync(path.resolve('world'))); } catch (e) { return path.resolve('.'); } };
  const FILE = C.stateFile ? path.resolve(C.stateFile) : path.join(stateDir(), 'sprstrip-state.json');
  const state = () => {
    if (S.state && S.file === FILE) return S.state;
    let st = { removed: 0, refunded: 0, owed: 0, log: [] };
    try { const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); st = Object.assign(st, raw); }
    catch (e) { if (e.code !== 'ENOENT') { log(`sprstrip: ${FILE} unreadable (${e.message}); off, the file is left as it is`); S.readOnly = true; } }
    S.state = st; S.file = FILE; return st;
  };
  const save = () => {
    if (S.readOnly) return false;
    try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(state(), null, 1)); fs.renameSync(FILE + '.tmp', FILE); return true; }
    catch (e) { log('sprstrip: state write failed', e.message); return false; }
  };
  const snapshot = () => JSON.parse(JSON.stringify(state()));
  const restore = (snap) => { S.state = snap; save(); };

  // Records n copies taken from `where`; refunds owed grow up to maxRefunds. false when the state did not land.
  const record = (where, n) => {
    const st = state();
    const owe = Math.max(0, Math.min(n, Number(C.maxRefunds) - st.removed));
    st.removed += n; st.owed += owe;
    st.log.push({ at: new Date().toISOString(), where, n, owed: owe });
    return save();
  };

  const unequip = (a) => {
    try { mp.callPapyrusFunction('method', 'Actor', 'UnequipItem', { type: 'form', desc: mp.getDescFromId(a) }, [{ type: 'espm', desc: mp.getDescFromId(ITEM) }, false, true]); }
    catch (e) { log('sprstrip UnequipItem failed', e.message); }
  };

  const stripActor = (a) => {
    a = a >>> 0;
    if (S.readOnly) return 0;
    let inv; try { inv = mp.get(a, 'inventory'); } catch (e) { return 0; }
    const p = without(inv && Array.isArray(inv.entries) ? inv.entries : [], ITEM);
    if (!p.removed) return 0;
    const snap = snapshot();
    if (!record(`actor ${a.toString(16)} profile ${mp.get(a, 'profileId')}`, p.removed)) { log('sprstrip: state not saved; nothing removed'); return 0; }
    try {
      if (p.worn) unequip(a);
      mp.set(a, 'inventory', { entries: p.entries });
    } catch (e) { restore(snap); log('sprstrip: removal failed, state put back', e.message); return 0; }
    try {
      const lw = mp.get(a, 'private.lastWorn');
      if (Array.isArray(lw)) mp.set(a, 'private.lastWorn', lw.filter((it) => (Number(Array.isArray(it) ? it[0] : it) >>> 0) !== ITEM));
    } catch (e) { /* no outfit remembered */ }
    audit(`SPRSTRIP removed ${p.removed} x ${C.itemName} from ${who(a)}${p.worn ? ' (worn)' : ''}`);
    try { personal(a, `Your ${C.itemName} was far stronger than intended and has been removed. The smith who made it has been given its materials back.`); } catch (e) { /* offline */ }
    return p.removed;
  };

  const stripContainer = (ref) => {
    ref = ref >>> 0;
    if (S.readOnly) return 0;
    let inv; try { inv = mp.get(ref, 'inventory'); } catch (e) { return -1; }
    const p = without(inv && Array.isArray(inv.entries) ? inv.entries : [], ITEM);
    if (!p.removed) return 0;
    const snap = snapshot();
    if (!record(`container ${ref.toString(16)}`, p.removed)) return 0;
    try { mp.set(ref, 'inventory', { entries: p.entries }); }
    catch (e) { restore(snap); log('sprstrip: container removal failed, state put back', e.message); return 0; }
    audit(`SPRSTRIP removed ${p.removed} x ${C.itemName} from container ${ref.toString(16)}`);
    return p.removed;
  };

  // Copies parked in a bank vault (bank.js __dboVaultTake), removed like a container's: no refund (bank review R10)
  const stripVault = (a) => {
    a = a >>> 0;
    if (S.readOnly || typeof globalThis.__dboVaultHas !== 'function' || typeof globalThis.__dboVaultTake !== 'function') return 0;
    const n = Number(globalThis.__dboVaultHas(a, ITEM)) || 0;
    if (!(n > 0)) return 0;
    const snap = snapshot();
    if (!record(`vaults of actor ${a.toString(16)}`, n)) return 0;
    let took = 0;
    try { took = globalThis.__dboVaultTake(a, ITEM, n, 'sprstrip'); } catch (e) { took = 0; }
    if (took !== n) { restore(snap); if (took > 0) record(`vaults of actor ${a.toString(16)}`, took); log('sprstrip: vault removal fell short, state put back'); return took; }
    audit(`SPRSTRIP removed ${n} x ${C.itemName} from the bank vaults of ${who(a)}`);
    return n;
  };

  const isSmith = (a) => (a >>> 0) === SMITH && Number(mp.get(a, 'profileId')) === SMITH_PROFILE;
  const payRefund = (a) => {
    if (!isSmith(a) || S.readOnly) return 0;
    const st = state(); const n = st.owed - st.refunded;
    if (!(n > 0)) return 0;
    const snap = snapshot();
    st.refunded += n; st.log.push({ at: new Date().toISOString(), refund: n });
    if (!save()) { S.state = snap; return 0; }
    for (const [id, per] of REFUND) giveItem(a, id, per * n);
    audit(`SPRSTRIP refund ${n} x (${REFUND.map(([id, per]) => `${per} x ${id.toString(16)}`).join(', ')}) to ${who(a)}`);
    try { personal(a, `You have been given the materials back for ${n} ${C.itemName}${n === 1 ? '' : 's'} that were removed: ${REFUND.map(([, per, name]) => `${per * n} ${name}`).join(', ')}.`); } catch (e) { /* offline */ }
    return n;
  };

  // Every online player's inventory and vaults in one go stalled the loop 868 ms at 500 players (gearStrip's first sweep,
  // server/_reviews/2026-10-18-gamemode-at-500.md). A sweep queues them and works through sweepBatch at once, the rest
  // one batch a second; a login is still stripped at once
  const BATCH = Math.max(1, Number(C.sweepBatch) || 25);
  let queue = [];
  const step = () => {
    if (!queue.length) return;
    const on = new Set(onlineActors());
    for (const a of queue.splice(0, BATCH)) { if (on.has(a)) { stripActor(a); stripVault(a); payRefund(a); } }
  };
  const sweep = () => {
    if (!queue.length) queue = onlineActors().slice();
    step();
    for (const d of C.containers || []) { const ref = idOf(d); if (ref) stripContainer(ref); }
  };

  globalThis.__dboSprStripLogin = (a) => { stripActor(a); stripVault(a); payRefund(a); };
  globalThis.__dboSprStripContainer = (ref) => { stripContainer(ref); };
  globalThis.__dboSprStripState = () => snapshot();
  every('sprStripStep', 1000, step);
  every('sprStrip', Math.max(10, Number(C.sweepSeconds) || 60) * 1000, sweep);
  log(`sprstrip on: ${C.itemName} ${ITEM.toString(16)}; removed ${state().removed}, refunded ${state().refunded} of ${state().owed} owed; ${(C.containers || []).length} container(s) listed`);
};
module.exports.without = without;
module.exports.DEFAULTS = DEFAULTS;
