'use strict';
// Gear taken back from everyone, its materials refunded: sprstrip.js (one item, one known smith) made general. First use
// (12 Oct 2026, Nate: "the only guard armor should be bruma in cyrodiil, the rest dont work"): the 35 guard armour pieces
// of Anvil, Bravil, Cheydinhal, Chorrol, Kvatch, Leyawiin and Skingrad (BSHeartland.esm), whose models do not show in
// game (the wearer looks invisible or bald). Bruma's set is never listed. regions-overrides.json forgeNever already stops
// new ones; this removes the ones made before.
// Every listed item is removed from players (at login, and every sweepSeconds for whoever is online) and from containers
// (the listed ones on a timer, any other as it is opened). A copy taken from a player refunds that player the item's
// recipe (its refund list; an item no recipe makes refunds nothing), when refundTo is "holder", the holder's profile is
// in crafters (an empty list lets every holder), and fewer than maxRefunds copies have been refunded. A copy found in a
// container is removed with no refund. Give only, never take, apart from the listed items themselves.
// State (gearstrip-state.json beside world/, never in git): { removed: { desc: n }, refunded, log: [] }. It is written
// before an inventory changes, and put back if the change throws, so a reload never counts a copy twice.
// Config "gearStrip" in gamemode-config.json, read at load; it ships enabled false (Nate decides).
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  enabled: false,
  reason: 'it has been withdrawn',
  items: [],
  refundTo: 'holder',
  crafters: [],
  maxRefunds: 0,
  containers: [],
  sweepSeconds: 60,
  stateFile: ''
};

// Pure: an inventory's entries without any of the ids. -> { entries, removed: Map(id -> n), worn: Set(id) }
const without = (entries, ids) => {
  const removed = new Map(), worn = new Set(), out = [];
  for (const e of entries || []) {
    const b = e ? (Number(e.baseId) >>> 0) : 0;
    if (e && ids.has(b) && Number(e.count) > 0) {
      removed.set(b, (removed.get(b) || 0) + Number(e.count));
      if (e.worn || e.wornLeft) worn.add(b);
      continue;
    }
    out.push(e);
  }
  return { entries: out, removed, worn };
};

module.exports = (api) => {
  const { mp, log, personal, audit, who, onlineActors, every, giveItem } = api;
  const C = Object.assign({}, DEFAULTS, (api.cfg || {}).gearStrip || {});
  const S = globalThis.__dboGearStripS || (globalThis.__dboGearStripS = {});
  const off = () => { globalThis.__dboGearStripLogin = null; globalThis.__dboGearStripContainer = null; };
  if (C.enabled !== true) { off(); if (typeof api.stopTimer === 'function') api.stopTimer('gearStrip'); log('gearstrip: off'); return; }

  const idOf = (desc) => { try { return mp.getIdFromDesc(desc) >>> 0; } catch (e) { return 0; } };
  // id -> { desc, name, refund: [[id, n, name]], reason }; items not in the load order are skipped (logged). An item's own
  // reason (12 Oct, the giant's clubs) replaces C.reason in the line its holder is told when every removed item gives it.
  const ITEMS = new Map();
  for (const it of C.items || []) {
    if (!it || !it.item) continue;
    const id = idOf(it.item);
    if (!id) { log(`gearstrip: ${it.item} is not in the load order; skipped`); continue; }
    const refund = (it.refund || []).map(([d, n, name]) => [idOf(d), Number(n), String(name || d)]).filter(([rid, n]) => rid && n > 0);
    ITEMS.set(id, { desc: String(it.item), name: String(it.name || it.item), refund, reason: it.reason ? String(it.reason) : '' });
  }
  if (!ITEMS.size) { off(); log('gearstrip: no listed item is in the load order; off'); return; }
  const IDS = new Set(ITEMS.keys());
  const CRAFTERS = new Set((C.crafters || []).map(Number));
  const MAX_REFUNDS = Math.max(0, Number(C.maxRefunds) || 0);

  const stateDir = () => { try { return path.dirname(fs.realpathSync(path.resolve('world'))); } catch (e) { return path.resolve('.'); } };
  const FILE = C.stateFile ? path.resolve(C.stateFile) : path.join(stateDir(), 'gearstrip-state.json');
  const state = () => {
    if (S.state && S.file === FILE) return S.state;
    let st = { removed: {}, refunded: 0, log: [] };
    try { const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); st = Object.assign(st, raw); }
    catch (e) { if (e.code !== 'ENOENT') { log(`gearstrip: ${FILE} unreadable (${e.message}); off, the file is left as it is`); S.readOnly = true; } }
    S.state = st; S.file = FILE; return st;
  };
  const save = () => {
    if (S.readOnly) return false;
    try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(state(), null, 1)); fs.renameSync(FILE + '.tmp', FILE); return true; }
    catch (e) { log('gearstrip: state write failed', e.message); return false; }
  };
  const snapshot = () => JSON.parse(JSON.stringify(state()));
  const restore = (snap) => { S.state = snap; save(); };

  const mayRefund = (a) => {
    if (C.refundTo !== 'holder') return false;
    if (CRAFTERS.size && !CRAFTERS.has(Number(mp.get(a, 'profileId')))) return false;
    return true;
  };
  const unequip = (a, id) => {
    try { mp.callPapyrusFunction('method', 'Actor', 'UnequipItem', { type: 'form', desc: mp.getDescFromId(a) }, [{ type: 'espm', desc: mp.getDescFromId(id) }, false, true]); }
    catch (e) { log('gearstrip UnequipItem failed', e.message); }
  };
  const names = (removed) => [...removed].map(([id, n]) => `${n} x ${ITEMS.get(id).name}`).join(', ');

  const stripActor = (a) => {
    a = a >>> 0;
    if (S.readOnly) return 0;
    let inv; try { inv = mp.get(a, 'inventory'); } catch (e) { return 0; }
    const p = without(inv && Array.isArray(inv.entries) ? inv.entries : [], IDS);
    if (!p.removed.size) return 0;
    const snap = snapshot();
    const st = state();
    // The refund, copy by copy, up to maxRefunds in all; written with the removal before anything changes
    const give = new Map(); let copies = 0, total = 0;
    const can = mayRefund(a);
    for (const [id, n] of p.removed) {
      total += n;
      st.removed[ITEMS.get(id).desc] = (st.removed[ITEMS.get(id).desc] || 0) + n;
      const refund = ITEMS.get(id).refund;
      if (!can || !refund.length) continue;
      const k = Math.max(0, Math.min(n, MAX_REFUNDS - st.refunded));
      if (!k) continue;
      st.refunded += k; copies += k;
      for (const [rid, per, rname] of refund) { const g = give.get(rid) || { n: 0, name: rname }; g.n += per * k; give.set(rid, g); }
    }
    st.log.push({ at: new Date().toISOString(), where: `actor ${a.toString(16)} profile ${mp.get(a, 'profileId')}`, items: Object.fromEntries([...p.removed].map(([id, n]) => [ITEMS.get(id).desc, n])), refunded: copies });
    if (!save()) { S.state = snap; log('gearstrip: state not saved; nothing removed'); return 0; }
    try {
      for (const id of p.worn) unequip(a, id);
      mp.set(a, 'inventory', { entries: p.entries });
    } catch (e) { restore(snap); log('gearstrip: removal failed, state put back', e.message); return 0; }
    try {
      const lw = mp.get(a, 'private.lastWorn');
      if (Array.isArray(lw)) mp.set(a, 'private.lastWorn', lw.filter((it) => !IDS.has(Number(Array.isArray(it) ? it[0] : it) >>> 0)));
    } catch (e) { /* no outfit remembered */ }
    for (const [rid, g] of give) giveItem(a, rid, g.n);
    const back = [...give.values()].map((g) => `${g.n} ${g.name}`).join(', ');
    audit(`GEARSTRIP removed ${names(p.removed)} from ${who(a)}${p.worn.size ? ' (worn)' : ''}${copies ? `; refunded ${copies} cop${copies === 1 ? 'y' : 'ies'}: ${back}` : ''}`);
    try {
      personal(a, `Your ${[...p.removed.keys()].map((id) => ITEMS.get(id).name).join(', ')} ${total === 1 ? 'has' : 'have'} been taken back: ${(() => { const r = [...new Set([...p.removed.keys()].map((id) => ITEMS.get(id).reason || C.reason))]; return r.length === 1 ? r[0] : C.reason; })()}.${copies ? ` You have been given the materials back: ${back}.` : ''}`);
    } catch (e) { /* offline */ }
    return total;
  };

  const stripContainer = (ref) => {
    ref = ref >>> 0;
    if (S.readOnly) return 0;
    let inv; try { inv = mp.get(ref, 'inventory'); } catch (e) { return -1; }
    const p = without(inv && Array.isArray(inv.entries) ? inv.entries : [], IDS);
    if (!p.removed.size) return 0;
    const snap = snapshot();
    const st = state(); let total = 0;
    for (const [id, n] of p.removed) { total += n; st.removed[ITEMS.get(id).desc] = (st.removed[ITEMS.get(id).desc] || 0) + n; }
    st.log.push({ at: new Date().toISOString(), where: `container ${ref.toString(16)}`, items: Object.fromEntries([...p.removed].map(([id, n]) => [ITEMS.get(id).desc, n])), refunded: 0 });
    if (!save()) { S.state = snap; return 0; }
    try { mp.set(ref, 'inventory', { entries: p.entries }); }
    catch (e) { restore(snap); log('gearstrip: container removal failed, state put back', e.message); return 0; }
    audit(`GEARSTRIP removed ${names(p.removed)} from container ${ref.toString(16)} (no refund)`);
    return total;
  };

  const sweep = () => {
    for (const a of onlineActors()) stripActor(a);
    for (const d of C.containers || []) { const ref = idOf(d); if (ref) stripContainer(ref); }
  };

  globalThis.__dboGearStripLogin = (a) => { stripActor(a); };
  globalThis.__dboGearStripContainer = (ref) => { stripContainer(ref); };
  globalThis.__dboGearStripState = () => snapshot();
  every('gearStrip', Math.max(10, Number(C.sweepSeconds) || 60) * 1000, sweep);
  log(`gearstrip on: ${ITEMS.size} item(s); removed ${Object.values(state().removed).reduce((n, v) => n + v, 0)}, refunded ${state().refunded} of at most ${MAX_REFUNDS}; ${(C.containers || []).length} container(s) listed`);
};
module.exports.without = without;
module.exports.DEFAULTS = DEFAULTS;
