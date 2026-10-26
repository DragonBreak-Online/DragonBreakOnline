// DragonBreak Online: home decorating (Nat, 25 Oct: "a tool for people to decorate their interiors where each item costs
// actual resources they gather in game, and workbenches in the interior that make sense too"). Loaded by gamemode.js on
// every hot reload. Design: _work\home-decorating-design-1025.md on the PC (D1-D12 approved at the recommended values).
//
// What may be placed and what it costs is decor-catalog.json (tools/decor/decor_catalog.py). A piece goes down only in a
// place (housingSystem.ts: the interior cells behind a claimed door) whose owner is the actor or has named them a decorator,
// inside the place's budget by size, the per-cell cap, and clear of the load doors. Its cost (the catalogue's costB, times
// costMultiplier) leaves the inventory in one write before the reference exists; a creation that fails gives it back.
//
// The client side is the Place tool's edit mode, as the business ledger uses it (business.js startPlace): the server sends
// placeEdit with an id 'decor:<nonce>', the player aims the preview, Enter answers placeMove with that id, checked here.
// The select tool's Enter on a placed piece (placeSelect) starts a move of it, Delete (placeDelete) removes it.
//
//   /decor                       budget here, and the commands         /decor find <words> [group]   the catalogue, 10 a page
//   /decor place <n>             start placing result n of /decor find  /decor list                   what this place holds
//   /decor move <n>              move it (free)                         /decor undo                   the last place or move, undoSeconds
//   /decor remove <n>            deconstruct: the Woodcutter's share back (skills.json woodcutter.deconstructShareByTier, 50% Novice
//                                to 75% Master; at least 1 of a material that cost 2 or more), for pieces the catalogue prices
//   /decor grant|revoke <player> the owner names who may decorate       /decor clear [here]           Developer: everything, refunded whole
//
// A place whose owner changes (abandon, revoke, sale) is cleared on the next owner scan and its previous owner is owed
// abandonRefund of what was paid, given at their next scan online. Every action is an audit line (DECOR ...).
// Config "decor" (DEFAULTS below). Hot reload.

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  enabled: false,
  costField: 'costB',                 // phase 1 pays today's gathered resources; 'costA' once the Hearthfire materials are made
  costMultiplier: 1,
  // budget by the place's cell count: 1, 2, 3 or more (D3)
  budgets: [{ pieces: 40, lights: 4, stations: 1, containers: 6 }, { pieces: 70, lights: 6, stations: 2, containers: 6 }, { pieces: 110, lights: 8, stations: 3, containers: 6 }],
  cellCap: 150,                       // placed references per interior cell, decor and staff placements together
  reach: 700, rise: 250,              // from the actor, on the floor plane and up or down
  tilt: 2, tiltGroups: { decor: 90, lights: 90 }, // degrees of pitch/roll; rugs, tapestries and sconces may lie flat or hang
  doorClear: 120, doorRadiusCap: 300, // a piece's footprint (catalogue radius, capped) this near a load door is refused
  abandonRefund: 0.5,                 // D11; a player's own deconstruct pays the Woodcutter's share (skills.json)
  undoSeconds: 60, undoMax: 10,
  placeSeconds: 300,                  // an aim not confirmed by then is dropped
  perSecond: 1, perHour: 120,
  ownerScanMinutes: 10, ownerScanPerTick: 5,
  // The study bookshelf (decor-growing.json; Nat via the Leader, 25 Oct). A home counts as a study from minForStudy shelves,
  // holds at most maxPerHome; each takes `books` books the character carries (no tomes, skill books or books under
  // minBookValue gold, which are notes and letters), consumed unless booksKept, when deconstructing gives them back. The
  // study rate at a home shelf is schools.js's study.homeRate.
  study: { maxPerHome: 3, minForStudy: 2, books: 10, booksKept: false, minBookValue: 5 },
  // Planters: plant one of Hearthfire's crops, it ripens after growHours real hours (rareHours for the rare ones), a pick
  // is one Harvesting roll (skills.json harvesting: chance and multiplier by tier) on baseYield, missYield if it fails;
  // then the planter is empty again. showZ raises the soil and the crop to the planter's bed. tickSeconds: the ripening check.
  planter: { maxPerHome: 4, growHours: 24, rareHours: 48, baseYield: 2, missYield: 1, showZ: 30, tickSeconds: 60 },
};

module.exports = (api) => {
  const { mp, log, personal, audit, who, onUi, sendPacket, registerChatCommand, onlineActors, isAdmin, giveItem, findByName } = api;
  const openWidget = api.openWidget || ((a, widget, focus) => sendPacket(a, { customPacketType: 'dboWidget', widget, focus: !!focus }));
  const closeWidget = api.closeWidget || ((a, id) => sendPacket(a, { customPacketType: 'dboWidget', close: id }));
  const hasUiCap = api.hasUiCap || (() => false);
  const C = Object.assign({}, DEFAULTS, (api.cfg || {}).decor || {});
  C.study = Object.assign({}, DEFAULTS.study, ((api.cfg || {}).decor || {}).study || {});
  C.planter = Object.assign({}, DEFAULTS.planter, ((api.cfg || {}).decor || {}).planter || {});
  const itemName = (d) => { try { const n = typeof api.itemName === 'function' ? api.itemName(d) : ''; return n && n !== d ? String(n) : String(d); } catch (e) { return String(d); } };
  const S = globalThis.__dboDecor || (globalThis.__dboDecor = { catalog: null, byDesc: null, reg: null, pending: new Map(), undo: new Map(), rate: new Map(), found: new Map(), scanAt: 0, scanIdx: 0 });
  S.catalog = null; S.growing = null; S.matNames = null;   // a hot reload reads the catalogue files again (decor-growing.json's ids are filled in later)
  if (!S.plantFor) S.plantFor = new Map();                  // actor -> the planter whose /decor plant list they were shown

  const ID_PREFIX = 'decor:';
  const TAG = 'private.dboDecor';
  const hex = (id) => (Number(id) >>> 0).toString(16);
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
  const finite = (v, n) => Array.isArray(v) && v.length >= n && v.slice(0, n).every((x) => typeof x === 'number' && Number.isFinite(x));
  const norm = (d) => ((d % 360) + 360) % 360;
  const signed = (d) => { const x = norm(d); return x > 180 ? x - 360 : x; };
  const get = (ref, key, dflt) => { try { const v = mp.get(ref, key); return v === undefined || v === null ? dflt : v; } catch (e) { return dflt; } };
  const idOf = (desc) => { try { return mp.getIdFromDesc(String(desc)) >>> 0; } catch (e) { return 0; } };
  const profile = (a) => Number(get(a, 'profileId', -1));
  const tierRank = { senior: 4, developer: 3, leadgm: 2, gm: 1 };
  const isDeveloper = (a) => { const t = typeof api.tierOf === 'function' ? api.tierOf(a) : (isAdmin(a) ? 'senior' : null); return (tierRank[t] || 0) >= 3; };
  const papyrus = (fn, self, args) => mp.callPapyrusFunction('method', 'ObjectReference', fn, { type: 'form', desc: mp.getDescFromId(self) }, args);

  // ---- catalogue --------------------------------------------------------------------------------------------------------
  const catalog = () => {
    if (S.catalog) return S.catalog;
    try {
      const raw = JSON.parse(fs.readFileSync(path.resolve('decor-catalog.json'), 'utf8'));
      S.catalog = []; S.byDesc = new Map();
      for (const g of raw.groups || []) for (const p of g.pieces || []) {
        const row = Object.assign({}, p, { groupLabel: g.label, hay: `${p.name} ${p.edid} ${g.id}`.toLowerCase() });
        S.catalog.push(row); S.byDesc.set(String(p.desc).toLowerCase(), row);
      }
      // the study bookshelf and the planter (decor-growing.json): offered once the merged DLE's ids are filled in
      for (const p of growing().pieces || []) {
        if (!p.desc) continue;
        const row = Object.assign({}, p, { groupLabel: p.group, hay: `${p.name} ${p.edid} ${p.group}`.toLowerCase() });
        S.catalog.push(row); S.byDesc.set(String(p.desc).toLowerCase(), row);
      }
      log(`decor: catalogue of ${S.catalog.length} pieces`);
    } catch (e) { log('decor: decor-catalog.json unreadable', e.message); S.catalog = []; S.byDesc = new Map(); }
    return S.catalog;
  };
  const growing = () => {
    if (S.growing) return S.growing;
    try { S.growing = JSON.parse(fs.readFileSync(path.resolve('decor-growing.json'), 'utf8')); } catch (e) { S.growing = {}; }
    S.cropOf = new Map();
    for (const c of S.growing.crops || []) if (c.desc && c.item) S.cropOf.set(String(c.item).toLowerCase(), c);
    return S.growing;
  };
  const crops = () => { growing(); return [...S.cropOf.values()]; };
  const pieceOf = (desc) => { catalog(); return S.byDesc.get(String(desc || '').toLowerCase()) || null; };
  const costOf = (piece) => {
    const out = {}, src = piece[C.costField] || piece.costB || {};
    for (const [d, n] of Object.entries(src)) out[d] = Math.max(1, Math.ceil(Number(n) * (Number(C.costMultiplier) || 1)));
    return out;
  };

  // ---- registry, beside the world state as placements.json is -----------------------------------------------------------
  const stateDir = () => { try { return path.dirname(fs.realpathSync(path.resolve('world'))); } catch (e) { return path.resolve('.'); } };
  const REG = path.join(stateDir(), 'decor.json');
  const reg = () => {
    if (S.reg) return S.reg;
    try { S.reg = JSON.parse(fs.readFileSync(REG, 'utf8')); } catch (e) { S.reg = null; }
    if (!S.reg || typeof S.reg !== 'object') S.reg = {};
    S.reg.places = S.reg.places || {}; S.reg.owed = S.reg.owed || {};
    return S.reg;
  };
  const save = () => { try { fs.writeFileSync(REG + '.tmp', JSON.stringify(reg(), null, 1)); fs.renameSync(REG + '.tmp', REG); } catch (e) { log('decor: saving decor.json failed', e.message); } };
  const placeEntry = (root, rec) => {
    const k = hex(root), r = reg();
    if (!r.places[k]) r.places[k] = { owner: Number(rec && rec.owner) || 0, ownerChar: Number(rec && rec.ownerChar) >>> 0, decorators: [], items: [] };
    return r.places[k];
  };
  const itemByRef = (refHex) => {
    const k = String(refHex || '').toLowerCase();
    for (const [root, p] of Object.entries(reg().places)) { const it = p.items.find((i) => i.ref === k); if (it) return { root: parseInt(root, 16) >>> 0, place: p, item: it }; }
    return null;
  };

  // ---- places: the interior cells behind a claimed door (housingSystem.ts place.cells, else the claim's own interior) ----
  const isInterior = (cell) => { try { const r = mp.lookupEspmRecordById(cell); return !!(r && r.record && String(r.record.type) === 'CELL'); } catch (e) { return false; } };
  const placeOfCell = (cell) => {
    if (!cell || !isInterior(cell)) return null;
    if (!S.cellIndex || Date.now() - S.cellIndexAt > 30000) {
      S.cellIndex = new Map(); S.cellIndexAt = Date.now();
      let ids = [];
      try { const v = JSON.parse(fs.readFileSync(path.resolve('housing.json'), 'utf8')); if (Array.isArray(v)) ids = v.map((x) => Number(x) >>> 0); } catch (e) { /* none */ }
      for (const ref of new Set(ids)) {
        const rec = get(ref, 'private.housing', null);
        if (!rec || !(Number(rec.owner) > 0)) continue;
        let cells = rec.place && Array.isArray(rec.place.cells) ? rec.place.cells.map(idOf).filter(Boolean) : [];
        if (!cells.length) cells = [idOf(get(ref, 'worldOrCellDesc', '')), idOf(get(Number(rec.partner) >>> 0, 'worldOrCellDesc', ''))].filter((c) => c && isInterior(c));
        for (const c of cells) if (!S.cellIndex.has(c)) S.cellIndex.set(c, { root: ref, cells });
      }
    }
    const hit = S.cellIndex.get(cell);
    if (!hit) return null;
    const rec = get(hit.root, 'private.housing', null);
    return rec && Number(rec.owner) > 0 ? { root: hit.root, cells: hit.cells, rec } : null;
  };
  const owns = (a, rec) => { try { const h = globalThis.__dboHousing; if (h && typeof h.ownsRecord === 'function') return h.ownsRecord(rec, a) === true; } catch (e) { /* the account's */ } return Number(rec && rec.owner) === profile(a); };
  const mayDecorate = (a, pl) => !!pl && (owns(a, pl.rec) || (placeEntry(pl.root, pl.rec).decorators || []).includes(profile(a)));
  const here = (a) => placeOfCell(idOf(get(a, 'worldOrCellDesc', '')));
  const budgetOf = (pl) => { const b = C.budgets || DEFAULTS.budgets; return b[Math.min(b.length, Math.max(1, pl.cells.length)) - 1]; };
  const usage = (p) => {
    const u = { pieces: 0, lights: 0, stations: new Set(), containers: 0 };
    for (const it of p.items) { u.pieces++; if (it.light) u.lights++; if (it.station) u.stations.add(it.station); if (it.container) u.containers++; }
    return u;
  };
  const inCell = (cell) => {
    let n = 0;
    for (const p of Object.values(reg().places)) for (const it of p.items) if (it.cell === cell) n++;
    try { for (const e of JSON.parse(fs.readFileSync(path.join(stateDir(), 'placements.json'), 'utf8'))) if (idOf(e.where) === cell) n++; } catch (e) { /* none */ }
    return n;
  };
  const doorsIn = (cell) => {
    if (!S.doors) { try { S.doors = JSON.parse(fs.readFileSync(path.resolve('doors-pos.json'), 'utf8')).doors || {}; } catch (e) { S.doors = {}; } }
    const out = [];
    for (const v of Object.values(S.doors)) if (Array.isArray(v) && v.length >= 4 && idOf(v[3]) === cell) out.push(v);
    return out;
  };
  // A station with races (the Spider Imbuing Chamber: Dunmer only, Nat 25 Oct) is for the character's own race, as racial.js reads it
  const raceOk = (a, st) => {
    if (!st || !Array.isArray(st.races) || !st.races.length) return true;
    const app = get(a, 'appearance', null), race = app && app.raceId ? Number(app.raceId) >>> 0 : 0;
    return !!race && st.races.some((d) => idOf(d) === race);
  };
  const skillRank = (a, skill) => {
    const r = get(a, 'private.mastery', null);
    if (!skill) return 4;
    if (!r || !Array.isArray(r.order) || !r.order.includes(skill)) return -1;
    return Math.max(0, Math.min(4, Number(r.skills && r.skills[skill] && r.skills[skill].rank) || 0));
  };

  // ---- inventory: all of the cost or none of it ------------------------------------------------------------------------
  const heldOf = (a, baseId) => (get(a, 'inventory', { entries: [] }).entries || []).reduce((n, e) => n + ((Number(e.baseId) >>> 0) === baseId && !e.worn ? Number(e.count) || 0 : 0), 0);
  const shortOf = (a, cost) => Object.entries(cost).map(([d, n]) => ({ d, n, have: heldOf(a, idOf(d)) })).filter((x) => x.have < x.n);
  const takeAll = (a, cost) => {
    const entries = (get(a, 'inventory', { entries: [] }).entries || []).map((e) => Object.assign({}, e));
    for (const [d, n] of Object.entries(cost)) {
      const id = idOf(d); let left = n;
      if (!id) return false;
      for (const e of entries) {
        if (left <= 0) break;
        if ((Number(e.baseId) >>> 0) !== id || e.worn) continue;
        const k = Math.min(left, Number(e.count) || 0); e.count = (Number(e.count) || 0) - k; left -= k;
      }
      if (left > 0) return false;
    }
    mp.set(a, 'inventory', { entries: entries.filter((e) => (Number(e.count) || 0) > 0) });
    return true;
  };
  // ---- books for a study bookshelf: any BOOK carried, except one that teaches a skill or a spell (DATA flags 0x1, 0x4) and
  // one worth under minBookValue (notes, letters); the cheapest go first. SSE BOOK DATA: flags u8, type u8, u16, teaches u32,
  // value u32, weight f32
  const bookValue = (baseId) => {
    if (!S.bookVal) S.bookVal = new Map();
    if (S.bookVal.has(baseId)) return S.bookVal.get(baseId);
    let v = -1;
    try {
      const r = mp.lookupEspmRecordById(baseId), rec = r && r.record;
      if (rec && String(rec.type) === 'BOOK') {
        const f = (rec.fields || []).find((x) => x.type === 'DATA');
        if (f && f.data instanceof Uint8Array && f.data.byteLength >= 12) {
          const dv = new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength);
          v = (dv.getUint8(0) & 0x05) ? -1 : dv.getUint32(8, true);
        }
      }
    } catch (e) { v = -1; }
    S.bookVal.set(baseId, v);
    return v;
  };
  const booksOf = (a) => (get(a, 'inventory', { entries: [] }).entries || [])
    .filter((e) => !e.worn && (Number(e.count) || 0) > 0 && bookValue(Number(e.baseId) >>> 0) >= (Number(C.study.minBookValue) || 0))
    .sort((x, y) => bookValue(Number(x.baseId) >>> 0) - bookValue(Number(y.baseId) >>> 0));
  const booksHeld = (a) => booksOf(a).reduce((n, e) => n + (Number(e.count) || 0), 0);
  const takeBooks = (a, n) => {
    const out = {}; let left = n;
    for (const e of booksOf(a)) { if (left <= 0) break; const k = Math.min(left, Number(e.count) || 0); out[mp.getDescFromId(Number(e.baseId) >>> 0)] = k; left -= k; }
    if (left > 0 || !takeAll(a, out)) return null;
    return out;
  };
  const giveAll = (a, cost, share) => {
    const got = {};
    for (const [d, n] of Object.entries(cost)) { const k = Math.floor(Number(n) * share); if (k > 0 && giveItem(a, idOf(d), k) !== false) got[d] = k; }
    return got;
  };
  // A material's name from the catalogue's own table (editor id -> desc), its words split: "Ingot Iron", "Firewood"
  // The Woodcutter's deconstruct share, from skills.json's woodcutter.deconstructShareByTier by the same rule as labour.js's
  // tierValue (the tier clamped into the list; without the skill, the Novice entry)
  const deconstructShare = (a) => {
    if (!S.shares) { try { const w = (JSON.parse(fs.readFileSync(path.resolve('skills.json'), 'utf8')).skills || []).find((k) => k.id === 'woodcutter') || {}; S.shares = Array.isArray(w.deconstructShareByTier) ? w.deconstructShareByTier : []; } catch (e) { S.shares = []; } }
    const arr = S.shares.length ? S.shares : [0.5, 0.5625, 0.625, 0.6875, 0.75];
    const v = Number(arr[Math.min(Math.max(skillRank(a, 'woodcutter'), 0), arr.length - 1)]);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
  };
  const refundOf = (paid, share) => {
    const out = {};
    for (const [d, n] of Object.entries(paid)) { const k = Math.max(Number(n) >= 2 ? 1 : 0, Math.floor(Number(n) * share)); if (k > 0) out[d] = k; }
    return out;
  };
  const giveRefund = (a, paid, share) => {
    const got = {};
    for (const [d, k] of Object.entries(refundOf(paid, share))) if (giveItem(a, idOf(d), k) !== false) got[d] = k;
    return got;
  };
  const nameOfItem = (d) => {
    catalog();
    if (!S.matNames) {
      S.matNames = new Map();
      try { for (const [e, ds] of Object.entries(JSON.parse(fs.readFileSync(path.resolve('decor-catalog.json'), 'utf8')).materials || {})) if (ds) S.matNames.set(String(ds).toLowerCase(), String(e).replace(/^(BYOHMaterial|Ruins)/, '').replace(/\d+$/, '').replace(/([a-z])([A-Z])/g, '$1 $2')); } catch (e) { /* descs */ }
      for (const [ds, n] of Object.entries(C.materialNames || {})) S.matNames.set(ds.toLowerCase(), n);
    }
    return S.matNames.get(String(d).toLowerCase()) || String(d);
  };
  const costText = (cost, a) => Object.entries(cost).map(([d, n]) => `${n} ${nameOfItem(d)}${a ? ` (${heldOf(a, idOf(d))})` : ''}`).join(', ');

  // ---- rate, undo ------------------------------------------------------------------------------------------------------
  const rateOk = (a) => {
    const now = Date.now(), l = (S.rate.get(a >>> 0) || []).filter((t) => now - t < 3600000);
    if (C.perSecond > 0 && l.length && now - l[l.length - 1] < 1000 / C.perSecond) return false;
    if (l.length >= C.perHour) return false;
    l.push(now); S.rate.set(a >>> 0, l); return true;
  };
  const pushUndo = (a, step) => { const l = S.undo.get(a >>> 0) || []; l.push(Object.assign({ at: Date.now() }, step)); while (l.length > C.undoMax) l.shift(); S.undo.set(a >>> 0, l); };

  // ---- the world ---------------------------------------------------------------------------------------------------------
  const pose = (id, cell, pos, rot) => {
    papyrus('SetPosition', id, [pos[0], pos[1], pos[2]]);
    papyrus('SetAngle', id, [rot[0], rot[1], rot[2]]);
    // watchers get it where it now stands (placement.js applyPose; a PlaceAtMe then move never reaches them otherwise)
    mp.set(id, 'isDisabled', true); mp.set(id, 'isDisabled', false);
  };
  const create = (a, desc, cell, pos, rot, tag) => {
    const res = papyrus('PlaceAtMe', a, [{ type: 'espm', desc }, 1, false, false]);
    if (!res || !res.desc) return 0;
    const id = mp.getIdFromDesc(res.desc) >>> 0;
    pose(id, cell, pos, rot);
    try { const r = mp.lookupEspmRecordById(idOf(desc)); if (r && r.record && String(r.record.type) === 'CONT') { mp.set(id, 'inventory', { entries: [] }); mp.set(id, 'private.dboEmptied', true); } } catch (e) { log('decor: emptying a placed container failed', e.message); }
    mp.set(id, TAG, tag);
    return id;
  };
  const destroy = (refHex) => { try { papyrus('Delete', parseInt(refHex, 16) >>> 0, []); return true; } catch (e) { log('decor: delete failed', refHex, e.message); return false; } };

  // ---- the checks a spot must pass ---------------------------------------------------------------------------------------
  const spotProblem = (a, pl, piece, pos, rot) => {
    const me = get(a, 'pos', null), cell = idOf(get(a, 'worldOrCellDesc', ''));
    if (!finite(me, 3)) return 'Your position is not known yet.';
    if (!pl.cells.includes(cell)) return 'Stand inside your home to do that.';
    if (Math.hypot(pos[0] - me[0], pos[1] - me[1]) > C.reach) return 'That is too far from you. Set it down closer.';
    if (Math.abs(pos[2] - me[2]) > C.rise) return 'That is too high or too low. Set it down nearer your own height.';
    const tilt = (C.tiltGroups || {})[piece.group] !== undefined ? C.tiltGroups[piece.group] : C.tilt;
    if (Math.abs(signed(rot[0])) > tilt || Math.abs(signed(rot[1])) > tilt) return tilt ? `Tilt it no more than ${tilt} degrees.` : 'Furniture stands upright.';
    const r = Math.min(Number(piece.radius) || 50, C.doorRadiusCap);
    for (const d of doorsIn(cell)) if (Math.hypot(pos[0] - d[0], pos[1] - d[1]) < C.doorClear + r && Math.abs(pos[2] - d[2]) < 250) return 'That would block a door. Move it away from the doorway.';
    return null;
  };

  // ---- place, move, remove ---------------------------------------------------------------------------------------------
  const startNew = (a, piece) => {
    if (!C.enabled) return personal(a, 'Decorating is not open yet.');
    const pl = here(a);
    if (!pl) return personal(a, 'Stand inside your own home to decorate it.');
    if (!mayDecorate(a, pl)) return personal(a, 'Only the owner, or someone the owner named with /decor grant, decorates here.');
    const why = budgetProblem(pl, piece, a);
    if (why) return personal(a, why);
    const short = shortOf(a, costOf(piece));
    if (short.length) return personal(a, `${piece.name} needs ${costText(costOf(piece), a)}. Short: ${short.map((x) => `${x.n - x.have} ${nameOfItem(x.d)}`).join(', ')}.`);
    if (piece.kind === 'study' && booksHeld(a) < C.study.books) return personal(a, `${piece.name} also needs ${C.study.books} books to fill it (any you carry but spell tomes, skill books, notes and letters); you have ${booksHeld(a)}.`);
    const me = get(a, 'pos', [0, 0, 0]), ang = get(a, 'angle', [0, 0, 0]);
    const yaw = (Number(ang[2]) || 0) * Math.PI / 180;
    const pos = [me[0] + Math.sin(yaw) * 150, me[1] + Math.cos(yaw) * 150, me[2]];
    const nonce = require('crypto').randomBytes(8).toString('hex');
    S.pending.set(a >>> 0, { nonce, op: 'new', root: pl.root, desc: piece.desc, until: Date.now() + C.placeSeconds * 1000 });
    sendPacket(a, { customPacketType: 'placeEdit', id: ID_PREFIX + nonce, base: piece.desc, name: piece.name, kind: 'object', hostile: false, pos, rot: [0, 0, norm(Number(ang[2]) || 0)] });
    personal(a, `${piece.name} follows your aim (${costText(costOf(piece))}). Arrows turn it and set how far, PgUp/PgDn raise it, Enter sets it down, Backspace stops.`);
  };
  const budgetProblem = (pl, piece, a) => {
    const p = placeEntry(pl.root, pl.rec), u = usage(p), b = budgetOf(pl);
    if (u.pieces >= b.pieces) return `This home holds its ${b.pieces} pieces already. Remove one first.`;
    if (piece.light && u.lights >= b.lights) return `This home has its ${b.lights} lights already.`;
    if (piece.container && u.containers >= b.containers) return `This home has its ${b.containers} placed containers already.`;
    if (piece.kind === 'study' || piece.kind === 'planter') {
      const cap = Math.max(0, Number((piece.kind === 'study' ? C.study : C.planter).maxPerHome) || 0);
      if (p.items.filter((i) => i.kind === piece.kind).length >= cap) return `This home has its ${cap} ${piece.kind === 'study' ? 'study bookshelves' : 'planters'} already.`;
    }
    if (piece.station) {
      const st = piece.station;
      if (u.stations.has(st.keyword)) return `This home has a ${piece.name} already.`;
      if (u.stations.size >= b.stations) return `This home has its ${b.stations} workbench${b.stations === 1 ? '' : 'es'} already.`;
      if (pl.cells.length < (Number(st.minCells) || 1)) return `A ${piece.name} needs a home of ${st.minCells} rooms or more.`;
      if (a && !raceOk(a, st)) return `The ${piece.name} is for Dunmer alone.`;
      if (a && st.skill && skillRank(a, st.skill) < (Number(st.tier) || 0)) return `Setting up a ${piece.name} is for ${st.skill}s of rank ${Number(st.tier) + 1} and above.`;
    }
    const cell = a ? idOf(get(a, 'worldOrCellDesc', '')) : 0;
    if (cell && inCell(cell) >= C.cellCap) return 'This room is full: nothing more can be placed in it.';
    return null;
  };
  const startMove = (a, found) => {
    const pl = here(a);
    if (!pl || pl.root !== found.root || !mayDecorate(a, pl)) return personal(a, 'Only the owner, or someone the owner named, moves things here.');
    const nonce = require('crypto').randomBytes(8).toString('hex');
    S.pending.set(a >>> 0, { nonce, op: 'move', root: found.root, ref: found.item.ref, until: Date.now() + C.placeSeconds * 1000 });
    sendPacket(a, { customPacketType: 'placeEdit', id: ID_PREFIX + nonce, base: found.item.base, name: found.item.name, kind: 'object', hostile: false, pos: found.item.pos, rot: found.item.rot });
    personal(a, `${found.item.name} follows your aim. Enter sets it down, Backspace stops.`);
  };
  const confirm = (a, idStr, posIn, rotIn) => {
    const s = S.pending.get(a >>> 0);
    const refuse = (text, why) => { log(`decor: ${who(a)} refused: ${why}`); personal(a, text); return true; };
    if (!s || s.nonce !== idStr.slice(ID_PREFIX.length)) return refuse('That is out of date. Start again with /decor.', 'unknown or stale nonce');
    S.pending.delete(a >>> 0);
    if (Date.now() > s.until) return refuse('That took too long. Start again with /decor.', 'expired');
    if (!rateOk(a)) return refuse('Slow down a little.', 'rate');
    const pl = here(a);
    if (!pl || pl.root !== s.root || !mayDecorate(a, pl)) return refuse('Stand inside the home you started in.', 'another place or no right');
    if (!finite(posIn, 3) || !finite(rotIn, 3)) return refuse('A bad position.', 'bad numbers');
    const pos = posIn.slice(0, 3).map((n) => Math.round(n * 10) / 10), rot = rotIn.slice(0, 3).map(norm).map((n) => Math.round(n * 10) / 10);
    const cell = idOf(get(a, 'worldOrCellDesc', '')), p = placeEntry(pl.root, pl.rec);
    if (s.op === 'move') {
      const it = p.items.find((i) => i.ref === s.ref);
      if (!it) return refuse('That piece is gone.', 'moved piece missing');
      const piece = pieceOf(it.base) || { group: it.group, radius: 50 };
      const why = spotProblem(a, pl, piece, pos, rot);
      if (why) return refuse(why, 'spot');
      const from = { pos: it.pos, rot: it.rot, cell: it.cell };
      pose(parseInt(it.ref, 16) >>> 0, cell, pos, rot);
      if (it.light) pose(parseInt(it.light, 16) >>> 0, cell, pos, rot);
      if (it.show) pose(parseInt(it.show, 16) >>> 0, cell, showPos(pos), rot);
      Object.assign(it, { pos, rot, cell }); save();
      pushUndo(a, { op: 'moved', root: hex(pl.root), ref: it.ref, from });
      audit(`DECOR move ${who(a)} ${it.name} (${it.base}) ref ${it.ref} place ${hex(pl.root)} to ${pos.map(Math.round).join(',')}`);
      personal(a, `${it.name} is set down.`);
      return true;
    }
    const piece = pieceOf(s.desc);
    if (!piece) return refuse('That is no longer in the catalogue.', 'piece gone');
    const why = spotProblem(a, pl, piece, pos, rot) || budgetProblem(pl, piece, a);
    if (why) return refuse(why, 'spot or budget');
    const cost = costOf(piece);
    if (piece.kind === 'study' && booksHeld(a) < C.study.books) return refuse(`${piece.name} needs ${C.study.books} books.`, 'books');
    if (!takeAll(a, cost)) return refuse(`${piece.name} needs ${costText(cost, a)}.`, 'materials');
    let books = null;
    if (piece.kind === 'study') { books = takeBooks(a, C.study.books); if (!books) { giveAll(a, cost, 1); return refuse(`${piece.name} needs ${C.study.books} books.`, 'books'); } }
    const tag = { root: hex(pl.root), by: profile(a), at: Date.now() };
    let id = 0, light = 0;
    try { id = create(a, piece.desc, cell, pos, rot, tag); if (id && piece.light && piece.light.base) light = create(a, piece.light.base, cell, pos, rot, Object.assign({ of: hex(id) }, tag)); }
    catch (e) { log('decor: create failed', e.stack || e.message); }
    if (!id) { giveAll(a, cost, 1); if (books) giveAll(a, books, 1); return refuse('It could not be placed; your materials are back.', 'create failed'); }
    const it = { ref: hex(id), base: piece.desc, name: piece.name, group: piece.group, cell, pos, rot, by: profile(a), char: a >>> 0, at: new Date().toISOString(), paid: cost };
    if (piece.kind) it.kind = piece.kind;
    if (books) it.books = books;
    if (light) it.light = hex(light);
    if (piece.container) it.container = true;
    if (piece.station) it.station = piece.station.keyword;
    p.items.push(it); save();
    pushUndo(a, { op: 'placed', root: hex(pl.root), ref: it.ref });
    audit(`DECOR place ${who(a)} ${piece.name} (${piece.desc}) ref ${it.ref} place ${hex(pl.root)} cell ${hex(cell)} at ${pos.map(Math.round).join(',')} paid ${JSON.stringify(cost)}`);
    personal(a, `${piece.name} is placed. /decor undo within ${C.undoSeconds} seconds gives everything back; /decor remove later gives back ${Math.round(deconstructShare(a) * 100)}% (more for a skilled Woodcutter).`);
    return true;
  };
  // share 'deconstruct': the Woodcutter's share (deconstructShare), rounded down but at least 1 of a material that cost 2
  // or more, and only for a piece the catalogue still prices; a number (undo: 1): that share of what was paid, exactly
  const removeItem = (a, found, share, why) => {
    const { place: p, item: it, root } = found;
    if (it.container && (get(parseInt(it.ref, 16) >>> 0, 'inventory', { entries: [] }).entries || []).length) return personal(a, `Empty the ${it.name} first.`);
    const paid = it.paid || {}, priced = !!pieceOf(it.base) && Object.keys(paid).length > 0;
    // the record goes first and is saved before anything is paid, so no path can pay for the same piece twice
    p.items.splice(p.items.indexOf(it), 1); save();
    destroy(it.ref); if (it.light) destroy(it.light); if (it.show) destroy(it.show);
    let got = {};
    if (share === 'deconstruct') { if (priced) got = giveRefund(a, paid, deconstructShare(a)); }
    else if (share > 0) got = giveAll(a, paid, share);
    // a study bookshelf's books come back whole on undo, and on deconstruct when booksKept (else they are in the shelf)
    if (it.books && (share === 1 || C.study.booksKept)) for (const [d, n] of Object.entries(giveAll(a, it.books, 1))) got[d] = (got[d] || 0) + n;
    audit(`DECOR ${why} ${who(a)} ${it.name} (${it.base}) ref ${it.ref} place ${hex(root)} refund ${JSON.stringify(got)}`);
    personal(a, `${it.name} is taken down${Object.keys(got).length ? `; back to you: ${costText(got)}` : ''}.`);
    return true;
  };
  const undo = (a) => {
    const l = S.undo.get(a >>> 0) || [];
    // steps for pieces already taken down are skipped, so an undo never spends itself on something gone
    let step = l.pop(), found = step ? itemByRef(step.ref) : null;
    while (step && !found && Date.now() - step.at <= C.undoSeconds * 1000) { step = l.pop(); found = step ? itemByRef(step.ref) : null; }
    if (!step || !found || Date.now() - step.at > C.undoSeconds * 1000) return personal(a, `Nothing to undo: undo works for ${C.undoSeconds} seconds after a place or a move.`);
    if (step.op === 'placed') return removeItem(a, found, 1, 'undo');
    const it = found.item;
    pose(parseInt(it.ref, 16) >>> 0, step.from.cell, step.from.pos, step.from.rot);
    if (it.light) pose(parseInt(it.light, 16) >>> 0, step.from.cell, step.from.pos, step.from.rot);
    if (it.show) pose(parseInt(it.show, 16) >>> 0, step.from.cell, showPos(step.from.pos), step.from.rot);
    Object.assign(it, step.from); save();
    audit(`DECOR undo-move ${who(a)} ${it.name} ref ${it.ref}`);
    return personal(a, `${it.name} is back where it was.`);
  };

  // ---- owners: a place whose owner changed is cleared; its previous owner is owed abandonRefund ------------------------
  const ownerKey = (owner, char) => `${owner}:${char >>> 0}`;
  const scanOwners = () => {
    const r = reg(), roots = Object.keys(r.places);
    let changed = false;
    for (let i = 0; i < Math.min(C.ownerScanPerTick, roots.length); i++) {
      S.scanIdx = (S.scanIdx + 1) % roots.length;
      const k = roots[S.scanIdx], p = r.places[k], rec = get(parseInt(k, 16) >>> 0, 'private.housing', null);
      const same = rec && Number(rec.owner) === p.owner && (!p.ownerChar || !(Number(rec.ownerChar) >>> 0) || (Number(rec.ownerChar) >>> 0) === p.ownerChar);
      if (same) continue;
      const owed = r.owed[ownerKey(p.owner, p.ownerChar)] = r.owed[ownerKey(p.owner, p.ownerChar)] || {};
      for (const it of p.items) {
        destroy(it.ref); if (it.light) destroy(it.light); if (it.show) destroy(it.show);
        for (const [d, n] of Object.entries(it.paid || {})) { const q = Math.floor(n * C.abandonRefund); if (q > 0) owed[d] = (owed[d] || 0) + q; }
        if (it.books && C.study.booksKept) for (const [d, n] of Object.entries(it.books)) owed[d] = (owed[d] || 0) + n;
      }
      audit(`DECOR abandon place ${k} owner ${p.owner}:${hex(p.ownerChar)} items ${p.items.length} owed ${JSON.stringify(owed)}`);
      delete r.places[k]; changed = true;
    }
    for (const a of onlineActors()) {
      const key = ownerKey(profile(a), a >>> 0), alt = ownerKey(profile(a), 0), k = r.owed[key] ? key : (r.owed[alt] ? alt : null);
      if (!k) continue;
      const got = giveAll(a, r.owed[k], 1);
      delete r.owed[k]; changed = true;
      audit(`DECOR owed ${who(a)} ${JSON.stringify(got)}`);
      personal(a, `Your old home's furnishings were taken down; back to you: ${costText(got)}.`);
    }
    if (changed) save();
  };
  if (typeof api.every === 'function') api.every('decor-owners', Math.max(1, C.ownerScanMinutes) * 60000, () => { try { if (C.enabled) scanOwners(); } catch (e) { log('decor: owner scan failed', e.stack || e.message); } });

  // ---- the study bookshelf and the planters at work (gamemode.js asks __dboDecorActivate before schools.js) -------------
  const showPos = (pos) => [pos[0], pos[1], pos[2] + (Number(C.planter.showZ) || 0)];
  const placeOfFound = (found) => ({ root: found.root, rec: get(found.root, 'private.housing', null) });
  const inWords = (ms) => { const m = Math.max(1, Math.ceil(ms / 60000)); return m < 90 ? `${m} minutes` : `${Math.round(m / 60)} hours`; };
  const harvesting = () => {
    if (!S.harvest) { try { S.harvest = (JSON.parse(fs.readFileSync(path.resolve('skills.json'), 'utf8')).skills || []).find((k) => k.id === 'harvesting') || {}; } catch (e) { S.harvest = {}; } }
    return S.harvest;
  };
  const cropFor = (item) => { growing(); return S.cropOf.get(String(item || '').toLowerCase()) || null; };
  const hoursOf = (crop) => Number(crop && crop.rare ? C.planter.rareHours : C.planter.growHours) || 24;
  // the planter's model: soil while a crop grows, the crop once ripe, nothing when empty; made at the planter itself, so
  // ripening needs nobody there
  const showCrop = (it, desc) => {
    if (it.show) { destroy(it.show); delete it.show; }
    if (!desc) return;
    let id = 0;
    try { id = create(parseInt(it.ref, 16) >>> 0, desc, it.cell, showPos(it.pos), it.rot, { of: it.ref, show: true }); } catch (e) { log('decor: planter model failed', e.message); }
    if (id) it.show = hex(id);
  };
  const plant = (a, found, crop) => {
    const it = found.item;
    if (!takeAll(a, { [crop.item]: 1 })) return personal(a, `You have no ${itemName(crop.item)} to plant.`);
    it.crop = { item: crop.item, at: Date.now(), ripeAt: Date.now() + hoursOf(crop) * 3600000, by: profile(a) };
    showCrop(it, (growing().soil || {}).desc);
    save();
    audit(`DECOR plant ${who(a)} ${crop.item} in planter ${it.ref} place ${hex(found.root)} ripe ${new Date(it.crop.ripeAt).toISOString()}`);
    return personal(a, `You plant ${itemName(crop.item)}. It ripens in ${hoursOf(crop)} hours.`);
  };
  // a pick is one Harvesting roll (skills.json harvesting, as a wild plant rolls) on baseYield; missYield if it fails
  const pick = (a, found) => {
    const it = found.item, crop = it.crop, H = harvesting(), tier = skillRank(a, 'harvesting');
    const chance = tier >= 0 ? Number((H.yieldChanceByTier || [])[tier]) || 1 : Number((H.unskilled || {}).yieldChance) || 0.25;
    const mult = tier >= 0 ? Number((H.yieldMultiplierByTier || [])[tier]) || 1 : Number((H.unskilled || {}).yieldMultiplier) || 0.5;
    const n = Math.random() < chance ? Math.max(1, Math.round((Number(C.planter.baseYield) || 1) * mult)) : Math.max(0, Number(C.planter.missYield) || 0);
    // the record goes first and is saved before anything is given, so no path can pick the same crop twice
    delete it.crop; showCrop(it, null); save();
    if (n > 0) giveItem(a, idOf(crop.item), n);
    try { if (typeof globalThis.__alduinakMasteryEvent === 'function') globalThis.__alduinakMasteryEvent('activate', a, { refrId: parseInt(it.ref, 16) >>> 0 }); } catch (e) { /* no skill system */ }
    audit(`DECOR pick ${who(a)} ${crop.item} x${n} from planter ${it.ref} place ${hex(found.root)} tier ${tier}`);
    return personal(a, n ? `You pick ${n} ${itemName(crop.item)}. The planter is empty again.` : `The ${itemName(crop.item)} failed. The planter is empty again.`);
  };
  const usePlanter = (a, found) => {
    const it = found.item;
    if (!mayDecorate(a, placeOfFound(found))) return personal(a, 'Only the owner, or someone the owner named with /decor grant, tends this planter.');
    if (!it.crop) {
      const held = crops().filter((c) => heldOf(a, idOf(c.item)) > 0);
      if (!held.length) return personal(a, `Nothing to plant. A planter grows Hearthfire's crops: ${crops().slice(0, 8).map((c) => itemName(c.item)).join(', ')} and more.`);
      if (held.length === 1) return plant(a, found, held[0]);
      S.plantFor.set(a >>> 0, { ref: it.ref, list: held.map((c) => c.item), at: Date.now() });
      return personal(a, `Plant what? ${held.map((c, i) => `${i + 1}. ${itemName(c.item)}${c.rare ? ' (slow)' : ''}`).join(', ')}. Say /decor plant <n>.`);
    }
    if (!it.crop.ripe && Date.now() < it.crop.ripeAt) return personal(a, `The ${itemName(it.crop.item)} is growing; ready in ${inWords(it.crop.ripeAt - Date.now())}.`);
    return pick(a, found);
  };
  const ripen = () => {
    const now = Date.now(); let changed = false;
    for (const p of Object.values(reg().places)) for (const it of p.items) {
      if (it.kind !== 'planter' || !it.crop || it.crop.ripe || now < it.crop.ripeAt) continue;
      const crop = cropFor(it.crop.item);
      showCrop(it, crop && crop.desc);
      it.crop.ripe = true; changed = true;
    }
    if (changed) save();
  };
  if (typeof api.every === 'function') api.every('decor-grow', Math.max(10, Number(C.planter.tickSeconds) || 60) * 1000, () => { try { if (C.enabled) ripen(); } catch (e) { log('decor: ripening failed', e.stack || e.message); } });
  globalThis.__dboDecorActivate = (target, caster) => {
    if (!C.enabled) return false;
    const found = itemByRef(hex(target));
    if (!found) return false;
    const it = found.item;
    if (it.kind === 'study') {
      // a home is a study from minForStudy shelves; then schools.js opens Study Magic or Priest Studies as at a library
      const n = found.place.items.filter((i) => i.kind === 'study').length, need = Math.max(1, Number(C.study.minForStudy) || 1);
      if (n < need) { personal(caster, `A home study needs ${need} study bookshelves; this home has ${n}.`); return true; }
      return false;
    }
    if (it.kind !== 'planter') return false;
    try { usePlanter(caster, found); } catch (e) { log('decor: planter failed', e.stack || e.message); personal(caster, 'That failed; see the server log.'); }
    return true;
  };

  // ---- the edit mode's packets (placement.js leaves 'decor:' ids and decor references to this file) --------------------
  globalThis.__dboDecorId = (id) => String(id || '').startsWith(ID_PREFIX);
  globalThis.__dboDecorRef = (refHex) => !!itemByRef(refHex);
  onUi('placeMove', (a, args) => { const id = String((args || [])[0] || ''); if (!id.startsWith(ID_PREFIX)) return; try { confirm(a, id, (args || [])[1], (args || [])[2]); } catch (e) { log('decor: confirm failed', e.stack || e.message); personal(a, 'That failed; see the server log.'); } reopenAfterEdit(a); });
  onUi('placeSelect', (a, args) => { try { if (!C.enabled) return; const f = itemByRef((args || [])[0]); if (f) startMove(a, f); } catch (e) { log('decor: select failed', e.stack || e.message); } });
  onUi('placeDelete', (a, args) => {
    try {
      if (!C.enabled) return;
      const f = itemByRef((args || [])[0]); if (!f) return;
      const pl = here(a);
      if (!pl || pl.root !== f.root || !mayDecorate(a, pl)) return personal(a, 'Only the owner, or someone the owner named, takes things down here.');
      if (!rateOk(a)) return personal(a, 'Slow down a little.');
      removeItem(a, f, 'deconstruct', 'deconstruct');
    } catch (e) { log('decor: delete failed', e.stack || e.message); }
  });

  // ---- /decor -----------------------------------------------------------------------------------------------------------
  const listOf = (a, pl) => placeEntry(pl.root, pl.rec).items;
  // names are kept beside the ids so the panel lists a decorator who is offline
  const setDecorator = (a, pl, pid, grant, name) => {
    const p = placeEntry(pl.root, pl.rec);
    p.decorators = (p.decorators || []).filter((x) => x !== pid);
    p.decoratorNames = p.decoratorNames || {};
    if (grant) { p.decorators.push(pid); p.decoratorNames[pid] = String(name || ''); } else delete p.decoratorNames[pid];
    save();
    audit(`DECOR ${grant ? 'grant' : 'revoke'} ${who(a)} -> ${name} (${pid}) place ${hex(pl.root)}`);
    return personal(a, grant ? 'They may now decorate here.' : 'They may no longer decorate here.');
  };

  // ---- the panel (native swf dbo_decor): the server builds every row and re-checks every action as the chat path does ----
  const PANEL_ID = 171;
  // the browser widget (skymp5-front features/decor, cap decorPanel) or the native swf (native:decor), 'rows' a page each
  const PANEL_CAPS = [{ cap: 'decorPanel', rows: 20 }, { cap: 'native:decor', rows: 8 }];
  const panelCap = (a) => PANEL_CAPS.find((c) => hasUiCap(a, c.cap)) || null;
  const MAX_SEARCH = 40;
  if (!S.panel) S.panel = new Map();                       // actor -> { nonce, view, group, page, reopen }
  const homeName = (pl) => String((pl.rec && pl.rec.name) || (pl.rec && pl.rec.ownerName ? `${pl.rec.ownerName}'s home` : 'This home'));
  const groupsFor = (a) => {
    const out = [], seen = new Set();
    for (const p of catalog()) if (raceOk(a, p.station) && !seen.has(p.group)) { seen.add(p.group); out.push({ id: p.group, label: p.groupLabel || p.group }); }
    return out;
  };
  const pageOf = (list, page, n) => {
    const pages = Math.max(1, Math.ceil(list.length / n)), at = Math.max(0, Math.min(pages - 1, Math.floor(Number(page) || 0)));
    return { at, pages, rows: list.slice(at * n, at * n + n) };
  };
  const costRows = (a, cost) => Object.entries(cost).map(([d, n]) => ({ name: nameOfItem(d), n, have: heldOf(a, idOf(d)) }));
  const planterState = (it) => {
    if (it.kind !== 'planter') return '';
    if (!it.crop) return 'empty';
    const left = Number(it.crop.ripeAt) - Date.now();
    return it.crop.ripe || left <= 0 ? 'ripe' : `growing, ${inWords(left)} left`;
  };
  const undoLeft = (a) => {
    const l = S.undo.get(a >>> 0) || [], st = l[l.length - 1];
    const s = st ? Math.ceil((C.undoSeconds * 1000 - (Date.now() - st.at)) / 1000) : 0;
    return s > 0 ? s : 0;
  };
  const panelFor = (a, st) => {
    const pl = here(a);
    if (!pl || !mayDecorate(a, pl)) return null;
    const p = placeEntry(pl.root, pl.rec), u = usage(p), b = budgetOf(pl), isOwner = owns(a, pl.rec), groups = groupsFor(a);
    if (!groups.some((g) => g.id === st.group)) st.group = groups.length ? groups[0].id : '';
    const out = {
      type: 'decor', id: PANEL_ID, nonce: st.nonce, view: st.view, home: homeName(pl), owner: isOwner, undo: undoLeft(a),
      budget: [{ label: 'Pieces', used: u.pieces, of: b.pieces }, { label: 'Lights', used: u.lights, of: b.lights },
        { label: 'Workbenches', used: u.stations.size, of: b.stations }, { label: 'Containers', used: u.containers, of: b.containers }],
      groups, group: st.group, page: 0, pages: 1, rows: [], nearby: [],
    };
    if (st.view === 'placed') {
      const me = get(a, 'pos', [0, 0, 0]), share = deconstructShare(a), far = (it) => Math.hypot(it.pos[0] - me[0], it.pos[1] - me[1]);
      const pg = pageOf(p.items.slice().sort((x, y) => far(x) - far(y)), st.page, st.rows || 8);
      Object.assign(out, { page: pg.at, pages: pg.pages, rows: pg.rows.map((it) => ({ key: it.ref, name: it.name, group: it.group, state: planterState(it),
        refund: pieceOf(it.base) && it.paid ? costText(refundOf(it.paid, share)) : '' })) });
    } else if (st.view === 'people') {
      const names = p.decoratorNames || {}, granted = p.decorators || [];
      out.rows = granted.map((pid) => ({ key: String(pid), name: names[pid] || 'someone' }));
      if (isOwner) out.nearby = onlineActors().filter((x) => x !== a && !granted.includes(profile(x)) && (here(x) || {}).root === pl.root).map((x) => ({ key: String(profile(x)), name: who(x) }));
    } else {
      out.view = 'catalog';
      // a search runs across every group, as /decor find does
      const terms = String(st.search || '').toLowerCase().split(/\s+/).filter(Boolean);
      const list = catalog().filter((x) => (terms.length ? terms.every((t) => x.hay.includes(t)) : x.group === st.group) && raceOk(a, x.station));
      out.search = st.search || '';
      const pg = pageOf(list, st.page, st.rows || 8);
      Object.assign(out, { page: pg.at, pages: pg.pages, rows: pg.rows.map((x) => {
        const why = budgetProblem(pl, x, a) || (x.kind === 'study' && booksHeld(a) < C.study.books ? `Needs ${C.study.books} books; you carry ${booksHeld(a)}.` : '');
        return { key: x.desc, name: x.name, cost: costRows(a, costOf(x)), why: why || '' };
      }) });
    }
    st.page = out.page;
    return out;
  };
  const openPanel = (a, view) => {
    if (!C.enabled) return personal(a, 'Decorating is not open yet.');
    const pl = here(a);
    if (!pl || !mayDecorate(a, pl)) return personal(a, 'Decorating works inside your own home, or one its owner named you in.');
    const old = S.panel.get(a >>> 0);
    const st = { nonce: require('crypto').randomBytes(6).toString('hex'), view: view || (old && old.view) || 'catalog', group: old ? old.group : '', page: old && !view ? old.page : 0, search: old ? old.search || '' : '', rows: (panelCap(a) || { rows: 8 }).rows, reopen: false };
    S.panel.set(a >>> 0, st);
    const w = panelFor(a, st);
    if (w) openWidget(a, w, true);
    return true;
  };
  const refresh = (a) => {
    const st = S.panel.get(a >>> 0);
    if (!st) return;
    const w = panelFor(a, st);
    if (w) openWidget(a, w, true);
    else { S.panel.delete(a >>> 0); closeWidget(a, PANEL_ID); }
  };
  // every action names the panel's nonce, so a stale or forged one does nothing
  const panelAct = (name, fn) => onUi(name, (a, args) => {
    try {
      const st = S.panel.get(a >>> 0), arg = args || [];
      if (!C.enabled || !st || String(arg[0]) !== st.nonce) return;
      fn(a, st, arg.slice(1));
    } catch (e) { log(`decor: panel ${name} failed`, e.stack || e.message); }
  });
  const placedHere = (a, ref) => { const pl = here(a), f = itemByRef(String(ref || '')); return pl && f && f.root === pl.root && mayDecorate(a, pl) ? f : null; };
  panelAct('decorView', (a, st, [view, group, page, search]) => {
    if (search !== undefined && search !== null) { const q = String(search).slice(0, MAX_SEARCH); if (q !== (st.search || '')) { st.search = q; st.page = 0; } }
    st.view = ['catalog', 'placed', 'people'].includes(String(view)) ? String(view) : 'catalog';
    if (group !== undefined && group !== null && group !== '' && String(group) !== st.group) { st.group = String(group); st.page = 0; } else st.page = Math.max(0, Math.floor(Number(page) || 0));
    refresh(a);
  });
  panelAct('decorPlace', (a, st, [desc]) => {
    const piece = pieceOf(desc);
    if (!piece || !raceOk(a, piece.station)) { personal(a, 'That is not in the catalogue.'); return refresh(a); }
    const before = S.pending.get(a >>> 0);
    startNew(a, piece);
    if (S.pending.get(a >>> 0) !== before) { st.reopen = true; closeWidget(a, PANEL_ID); } else refresh(a);
  });
  panelAct('decorMove', (a, st, [ref]) => {
    const f = placedHere(a, ref);
    if (!f) return refresh(a);
    startMove(a, f);
    st.reopen = true;
    closeWidget(a, PANEL_ID);
  });
  panelAct('decorRemove', (a, st, [ref]) => {
    const f = placedHere(a, ref);
    if (f && rateOk(a)) removeItem(a, f, 'deconstruct', 'deconstruct');
    else if (f) personal(a, 'Slow down a little.');
    refresh(a);
  });
  panelAct('decorUndo', (a) => { undo(a); refresh(a); });
  panelAct('decorGrant', (a, st, [pid]) => {
    const pl = here(a), t = pl && onlineActors().find((x) => x !== a && String(profile(x)) === String(pid) && (here(x) || {}).root === pl.root);
    if (t && owns(a, pl.rec)) setDecorator(a, pl, profile(t), true, who(t));
    refresh(a);
  });
  panelAct('decorRevoke', (a, st, [pid]) => {
    const pl = here(a), n = Number(pid), p = pl && placeEntry(pl.root, pl.rec);
    if (p && owns(a, pl.rec) && (p.decorators || []).includes(n)) setDecorator(a, pl, n, false, (p.decoratorNames || {})[n] || String(n));
    refresh(a);
  });
  // the G key (a client release away) sends decorOpen; a client without the native panel is told to use chat
  onUi('decorOpen', (a) => {
    try { if (panelCap(a)) openPanel(a); else personal(a, 'Your client cannot show the decorating panel yet; use /decor help.'); }
    catch (e) { log('decor: open failed', e.stack || e.message); }
  });
  onUi('close', (a, args, widgetId) => { if (widgetId !== PANEL_ID) return; const st = S.panel.get(a >>> 0); if (st && !st.reopen) S.panel.delete(a >>> 0); });
  // the panel comes back once the edit mode it closed for sets a piece down or refuses it
  function reopenAfterEdit(a) { const st = S.panel.get(a >>> 0); if (st && st.reopen) { st.reopen = false; refresh(a); } }
  registerChatCommand('decor', (a, args) => {
    const words = String(args || '').trim().split(/\s+/).filter(Boolean), sub = (words.shift() || '').toLowerCase(), rest = words.join(' ');
    if (!C.enabled && !(sub === 'clear' && isDeveloper(a))) return personal(a, 'Decorating is not open yet.');
    const pl = here(a);
    if (!sub && pl && mayDecorate(a, pl) && panelCap(a)) return openPanel(a);
    if (!sub || sub === 'help') {
      if (!pl) return personal(a, 'Decorating works inside your own home. /decor find <words> lists what you can place.');
      const u = usage(placeEntry(pl.root, pl.rec)), b = budgetOf(pl);
      return personal(a, `This home: ${u.pieces}/${b.pieces} pieces, ${u.lights}/${b.lights} lights, ${u.stations.size}/${b.stations} workbenches. /decor find <words> [group], /decor place <n>, /decor list, /decor move <n>, /decor remove <n>, /decor undo, /decor grant|revoke <player>.`);
    }
    if (sub === 'find' || sub === 'groups') {
      catalog();
      if (sub === 'groups') return personal(a, `Groups: ${[...new Set(S.catalog.map((p) => p.group))].join(', ')}.`);
      const terms = rest.toLowerCase().split(/\s+/).filter(Boolean);
      const page = Math.max(0, (Number((terms.find((t) => /^p\d+$/.test(t)) || 'p1').slice(1)) || 1) - 1);
      const want = terms.filter((t) => !/^p\d+$/.test(t));
      const hits = S.catalog.filter((p) => want.every((t) => p.hay.includes(t)) && raceOk(a, p.station));
      S.found.set(a >>> 0, hits);
      if (!hits.length) return personal(a, 'Nothing matches. Try /decor groups.');
      const shown = hits.slice(page * 10, page * 10 + 10).map((p, i) => `${page * 10 + i + 1}. ${p.name} [${p.group}]: ${costText(costOf(p))}`);
      return personal(a, `${hits.length} found${hits.length > 10 ? `, page ${page + 1} (add p2, p3...)` : ''}:\n${shown.join('\n')}\n/decor place <n> to place one.`);
    }
    if (sub === 'place') {
      const hits = S.found.get(a >>> 0) || [], n = Number(rest);
      const piece = Number.isInteger(n) && n >= 1 ? hits[n - 1] : pieceOf(rest);
      if (!piece) return personal(a, 'Pick a number from /decor find first.');
      return startNew(a, piece);
    }
    if (sub === 'plant') {
      const pf = S.plantFor.get(a >>> 0), n = Number(rest);
      if (!pf || Date.now() - pf.at > 300000) return personal(a, 'Use an empty planter first; it lists what you can plant.');
      const found = itemByRef(pf.ref), crop = Number.isInteger(n) && n >= 1 ? cropFor(pf.list[n - 1]) : null;
      if (!found || found.item.kind !== 'planter') return personal(a, 'That planter is gone.');
      if (!crop) return personal(a, 'Pick a number from the planter list.');
      if (found.item.crop) return personal(a, 'Something is already growing there.');
      if (!mayDecorate(a, placeOfFound(found))) return personal(a, 'Only the owner, or someone the owner named with /decor grant, tends this planter.');
      S.plantFor.delete(a >>> 0);
      return plant(a, found, crop);
    }
    if (!pl) return personal(a, 'Stand inside your own home first.');
    const items = listOf(a, pl);
    if (sub === 'list') return personal(a, items.length ? items.map((it, i) => `${i + 1}. ${it.name} [${it.group}]`).join('\n') : 'Nothing placed here yet.');
    if (sub === 'move' || sub === 'remove' || sub === 'deconstruct') {
      if (!mayDecorate(a, pl)) return personal(a, 'Only the owner, or someone the owner named, changes things here.');
      const it = items[Number(rest) - 1];
      if (!it) return personal(a, 'Pick a number from /decor list.');
      const found = { root: pl.root, place: placeEntry(pl.root, pl.rec), item: it };
      if (sub === 'move') return startMove(a, found);
      if (!rateOk(a)) return personal(a, 'Slow down a little.');
      return removeItem(a, found, 'deconstruct', 'deconstruct');
    }
    if (sub === 'undo') return undo(a);
    if (sub === 'grant' || sub === 'revoke') {
      if (!owns(a, pl.rec)) return personal(a, 'Only the owner names who may decorate.');
      const t = findByName(rest);
      if (!t) return personal(a, 'Nobody online by that name.');
      return setDecorator(a, pl, profile(t), sub === 'grant', who(t));
    }
    if (sub === 'clear') {
      if (!isDeveloper(a)) return personal(a, 'That is for Developers.');
      const p = placeEntry(pl.root, pl.rec), r = reg(), owed = r.owed[ownerKey(p.owner, p.ownerChar)] = r.owed[ownerKey(p.owner, p.ownerChar)] || {};
      for (const it of p.items) { destroy(it.ref); if (it.light) destroy(it.light); if (it.show) destroy(it.show); for (const [d, n] of Object.entries(Object.assign({}, it.paid || {}, it.books || {}))) owed[d] = (owed[d] || 0) + n; }
      audit(`DECOR clear ${who(a)} place ${hex(pl.root)} items ${p.items.length} owed whole to ${p.owner}:${hex(p.ownerChar)}`);
      p.items = []; save();
      return personal(a, 'Cleared; the owner gets everything back at their next scan online.');
    }
    return personal(a, 'Unknown. /decor help');
  }, { help: 'decorate your home: find, place, list, move, remove, undo, grant, revoke, plant' });

  // test hooks (tests/decor-harness.js)
  return { _test: { panelFor, openPanel, refundOf, takeAll, costOf, budgetProblem, spotProblem, confirm, scanOwners, reg, S, C, usePlanter, plant, pick, ripen, showPos } };
};
