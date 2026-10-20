// DragonBreak Online: mines owned like property (Nate, 20 Oct: "allow all mines to be claimable. orc mines belong to the
// strongholds"). Loaded by gamemode.js.
//
// A mine is a building of buildings.json, listed in mines.json (tools/mines_build.py). It is owned the way a house is: the
// housing registry's claim on its way in (fork housingSystem.ts), so the hold's officials sell it at its door and a
// citizen buys it (tenancy.js), it pays the weekly property tax and the Imperial tithe like any building (economy.js), and
// its owner may resell it. It is not a home: __dboHousingNotHome keeps it outside the one-building cap (fork 1020+).
// An Orc stronghold's mine is its clan's, as the clan's longhouse is (guilds.js reads the clan mines out of mines.json and
// treats their doors as the clan's hall): never sold, its members work it freely, its Chief and officers set its rules.
//
// What this file adds on top, read by labour.js at the ore vein:
//   access  open to every miner (the default), the owner's chosen faction and named people, named people only, or closed
//           (the owner, or the clan, alone)
//   share   a percentage of every yield anyone but the owner (or a clan member) mines there goes into the mine's store,
//           in ore: the owner collects it at the mine. Ore rather than gold: it is paid whether or not the owner is online,
//           needs no price for each ore, cannot fail on a miner's empty purse, and the miner sees it leave the yield.
// A mine nobody owns works as before: open to all, no share. A mine that is a lease dungeon (dungeons.json, not in
// dungeons.exclude) is a lair, not property: the hold does not sell it (staff take it off the lease list first, as Frost-Iron
// Mine was on 7 Oct). The panel opens from the door's property menu ("Buy or rent") or /mine, at the mine.
// State in mines-state.json: { rules: { mineId: { ownerKey, access, faction, named: [{ char, name }], share, by, at } },
//   stock: { mineId: { ownerKey: { itemDesc: count } } }, names: { itemDesc: name } }.
'use strict';

const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, audit, who, display, cfg, onUi, openWidget, closeWidget, onlineActors, every, registerChatCommand,
    giveItem, distanceMeters, profileOf, zoneById } = api;
  const isLeadStaff = typeof api.isLeadStaff === 'function' ? api.isLeadStaff : () => false;
  const C = Object.assign({
    enabled: true,
    // The value the weekly tax is taken on until a Steward assesses it or the hold sells it: value + perVein for each vein
    value: 1000, perVein: 50, valueByMine: {},
    maxShare: 50, shareSteps: [0, 5, 10, 15, 20, 25, 30, 40, 50],
    maxStockPerItem: 1000, maxNamed: 24, nameReachMeters: 10, doorReachMeters: 15,
    clanMines: true, leaseMinesForSale: false, auditEveryMinutes: 60,
  }, cfg.mines || {});
  const MENU_ID = 95;
  const FILE = path.resolve('mines-state.json');
  const S = globalThis.__dboMinesState || (globalThis.__dboMinesState = { data: null, panels: new Map(), tally: new Map(), flushedAt: Date.now() });
  if (!(S.panels instanceof Map)) S.panels = new Map();
  if (!(S.tally instanceof Map)) S.tally = new Map();

  // ---- the mine list ---------------------------------------------------------------------------------------------------
  let MINES = [];
  try { MINES = (JSON.parse(fs.readFileSync(path.resolve('mines.json'), 'utf8')).mines || []).filter((m) => m && m.id); }
  catch (e) { log('mines: mines.json unreadable, no mine is property', e.message); }
  const idOf = (desc) => { try { return mp.getIdFromDesc(String(desc)) >>> 0; } catch (e) { return 0; } };
  const low = (s) => String(s || '').toLowerCase();
  const byId = new Map(), byDoor = new Map(), byCell = new Map(), byVein = new Map();
  for (const m of MINES) {
    byId.set(m.id, m);
    m.doorIds = [];
    for (const e of m.entrances || []) for (const d of [e.door, e.inside]) { const id = idOf(d); if (id) { byDoor.set(id, m); m.doorIds.push(id); } }
    for (const c of m.cells || []) byCell.set(low(c), m);
    for (const v of m.veins || []) { const id = idOf(v.ref); if (id) byVein.set(id, m); }
  }
  const lair = (m) => Array.isArray(m.lease) && m.lease.length > 0 && !m.leaseExcluded;
  const clanOf = (m) => (C.clanMines !== false && m.clan ? String(m.clan) : '');
  // A vein's mine: by its reference, else by the cell it stands in (a vein placed later, or one the list missed)
  const mineOfVein = (ref) => {
    const m = byVein.get(Number(ref) >>> 0); if (m) return m;
    try { return byCell.get(low(mp.get(Number(ref) >>> 0, 'worldOrCellDesc'))) || null; } catch (e) { return null; }
  };
  const mineOfDoor = (ref) => byDoor.get(Number(ref) >>> 0) || null;
  // Where a player stands: inside a mine's cells, or within reach of one of its doors outside
  const mineAt = (a) => {
    let cell = ''; try { cell = low(mp.get(a, 'worldOrCellDesc')); } catch (e) { return null; }
    if (byCell.has(cell)) return byCell.get(cell);
    let best = null, bd = Number(C.doorReachMeters) || 15;
    for (const [door, m] of byDoor) { let d = Infinity; try { d = distanceMeters(a, door); } catch (e) { continue; } if (d < bd) { bd = d; best = m; } }
    return best;
  };

  // ---- state -----------------------------------------------------------------------------------------------------------
  const data = () => {
    if (S.data) return S.data;
    try { S.data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { S.data = null; }
    if (!S.data || typeof S.data !== 'object') S.data = {};
    for (const k of ['rules', 'stock', 'names']) if (!S.data[k] || typeof S.data[k] !== 'object') S.data[k] = {};
    return S.data;
  };
  const save = () => { try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(data(), null, 1)); fs.renameSync(FILE + '.tmp', FILE); } catch (e) { log('mines: saving failed', e.message); } };

  // ---- who owns it -------------------------------------------------------------------------------------------------------
  const H = () => globalThis.__dboHousing || null;
  const fn = (name) => (typeof globalThis[name] === 'function' ? globalThis[name] : null);
  const factionName = (fid) => { try { const i = fn('__dboGuildInfo') && fn('__dboGuildInfo')(fid); return (i && i.name) || fid; } catch (e) { return fid; } };
  const guildsOf = (a) => { try { return fn('__dboGuildsOf') ? fn('__dboGuildsOf')(a >>> 0) || [] : []; } catch (e) { return []; } };
  const roleIn = (a, fid) => (guildsOf(a).find((g) => g.id === fid) || {}).role || '';
  // The housing claim on any of its ways in: { rec, root }, or null when nobody holds one
  const claimOf = (m) => {
    const h = H(); if (!h) return null;
    for (const id of m.doorIds) {
      try { const root = Number(h.primaryOf(id)) >>> 0; const rec = root ? h.recordOf(root) : null; if (rec && Number(rec.owner)) return { rec, root }; } catch (e) { /* not loaded */ }
    }
    return null;
  };
  // { kind: 'clan' | 'player', key, name, ... } or null for a mine nobody owns
  const ownerOf = (m) => {
    const clan = clanOf(m);
    if (clan) return { kind: 'clan', fid: clan, key: `f:${clan}`, name: factionName(clan) };
    const c = claimOf(m); if (!c) return null;
    let key = String(c.rec.owner);
    try { const h = H(); if (h && typeof h.ownerKeyOf === 'function') key = String(h.ownerKeyOf(c.rec)); } catch (e) { /* the account's */ }
    return { kind: 'player', key, name: String(c.rec.ownerName || 'its owner'), rec: c.rec, root: c.root };
  };
  // The owner's side, who never pays the share: the owning character, or any member of the clan
  const insider = (a, own) => {
    if (!own) return false;
    if (own.kind === 'clan') return !!roleIn(a, own.fid);
    try { const h = H(); if (h && typeof h.ownsRecord === 'function') return h.ownsRecord(own.rec, a) === true; } catch (e) { return false; }
    return Number(own.rec.owner) === Number(profileOf(a));
  };
  // Who sets the rules: the owning character; for a clan's mine its leader and officers; a Lead GM anywhere (audited)
  const setsRules = (a, own) => {
    if (!own) return false;
    if (own.kind === 'clan') return ['leader', 'officer'].includes(roleIn(a, own.fid)) || isLeadStaff(a);
    return insider(a, own) || isLeadStaff(a);
  };
  const DEFAULT_RULES = () => ({ access: 'open', faction: '', named: [], share: 0 });
  // A new owner starts from the defaults: the last owner's rules end with their ownership
  const rulesOf = (m, own) => {
    const r = data().rules[m.id];
    return own && r && r.ownerKey === own.key ? Object.assign(DEFAULT_RULES(), r) : DEFAULT_RULES();
  };
  const putRules = (m, own, change, a, what) => {
    const r = Object.assign(rulesOf(m, own), change, { ownerKey: own.key, by: who(a), at: Date.now() });
    data().rules[m.id] = r; save();
    audit(`MINE ${who(a)} set ${m.name} (${own.name}): ${what}`);
    return r;
  };
  const named = (r, a) => (r.named || []).some((n) => (Number(n.char) >>> 0) === (a >>> 0));
  const allowed = (a, r) => {
    if (r.access === 'open') return true;
    if (named(r, a)) return r.access !== 'closed';
    return r.access === 'faction' && !!r.faction && !!roleIn(a, r.faction);
  };
  const accessText = (r, own) => ({
    open: 'open to every miner',
    faction: `open to ${factionName(r.faction)} and the people named`,
    named: `open only to ${own && own.kind === 'clan' ? 'the clan and ' : ''}the people named`,
    closed: own && own.kind === 'clan' ? 'worked by the clan alone' : 'closed to all but its owner',
  })[r.access] || 'open to every miner';

  // ---- labour.js: the vein ---------------------------------------------------------------------------------------------
  // '' when the miner may strike this vein, else why not
  globalThis.__dboMineGate = (ref, a) => {
    if (!C.enabled) return '';
    const m = mineOfVein(ref); if (!m) return '';
    const own = ownerOf(m); if (!own || insider(a, own)) return '';
    const r = rulesOf(m, own);
    if (allowed(a, r)) return '';
    return `${m.name} belongs to ${own.name}, and its seams are ${accessText(r, own)}.`;
  };
  // The mine's share of a won yield: { cut, to, commit() } or null. labour.js gives the miner count - cut and commits only once
  // the miner's part is in their pack, so a full pack costs the owner nothing either
  globalThis.__dboMineShareQuote = (ref, a, itemDesc, count, itemName) => {
    if (!C.enabled || !(count > 0) || !itemDesc) return null;
    const m = mineOfVein(ref); if (!m) return null;
    const own = ownerOf(m); if (!own || insider(a, own)) return null;
    const pct = Math.max(0, Math.min(Number(C.maxShare) || 0, Number(rulesOf(m, own).share) || 0)) / 100;
    if (!pct) return null;
    const exact = count * pct;
    let cut = Math.min(count, Math.floor(exact) + (Math.random() < exact - Math.floor(exact) ? 1 : 0));
    const st = data().stock[m.id] = data().stock[m.id] || {};
    const mine = st[own.key] = st[own.key] || {};
    cut = Math.min(cut, Math.max(0, (Number(C.maxStockPerItem) || 1000) - (Number(mine[itemDesc]) || 0)));
    if (!cut) return null;
    return {
      cut, to: own.name, mine: m.name,
      commit: () => {
        mine[itemDesc] = (Number(mine[itemDesc]) || 0) + cut;
        if (itemName) data().names[itemDesc] = String(itemName);
        save();
        const k = `${m.id}|${own.key}`;
        const t = S.tally.get(k) || { mine: m.name, owner: own.name, items: {}, miners: new Set() };
        t.items[itemName || itemDesc] = (t.items[itemName || itemDesc] || 0) + cut; t.miners.add(display(a));
        S.tally.set(k, t);
      },
    };
  };
  // One audit line per mine per auditEveryMinutes for the shares paid, not one per strike
  const flushTally = (force) => {
    if (!force && Date.now() - S.flushedAt < Math.max(1, Number(C.auditEveryMinutes) || 60) * 60000) return;
    S.flushedAt = Date.now();
    for (const t of S.tally.values()) audit(`MINE share ${t.mine} -> ${t.owner}: ${Object.entries(t.items).map(([n, c]) => `${c} ${n}`).join(', ')} from ${t.miners.size} miner(s): ${[...t.miners].join(', ')}`);
    S.tally.clear();
  };
  every('mines', 60000, () => { try { flushTally(false); } catch (e) { log('mines: share audit failed', e.message); } });
  globalThis.__dboMinesFlush = () => flushTally(true);

  // ---- economy.js, housingSystem.ts, tenancy.js -------------------------------------------------------------------------
  // The value the weekly tax is taken on before any assessment or sale, for a mine's door; null for anything else
  globalThis.__dboMineValueOf = (ref) => {
    if (!C.enabled) return null;
    const m = mineOfDoor(ref); if (!m) return null;
    const own = Number((C.valueByMine || {})[m.id]);
    return Number.isFinite(own) && own > 0 ? Math.floor(own) : Math.floor((Number(C.value) || 0) + (Number(C.perVein) || 0) * (m.veins || []).length);
  };
  // A mine is owned property but no home (fork housingSystem.ts notHome: outside the one-building cap)
  globalThis.__dboHousingNotHome = (refs) => !!C.enabled && (Array.isArray(refs) ? refs : []).some((r) => byDoor.has(Number(r) >>> 0));
  // tenancy.js asks before a mine is listed, sold or bought: '' or why not
  globalThis.__dboMineSaleRefusal = (door) => {
    if (!C.enabled) return '';
    const m = mineOfDoor(door); if (!m) return '';
    if (clanOf(m)) return `${m.name} belongs to ${factionName(clanOf(m))}, as its stronghold does. It is never sold.`;
    if (lair(m) && !C.leaseMinesForSale) return `${m.name} is a lair for now, not property: it is not for sale.`;
    return '';
  };

  // ---- the panel (contextMenu, widget 95) ------------------------------------------------------------------------------
  const hex = (n) => (Number(n) >>> 0).toString(16);
  const holdName = (m) => { try { const z = m.hold && zoneById ? zoneById(m.hold) : null; return z ? z.name : (m.hold || ''); } catch (e) { return m.hold || ''; } };
  const keysOf = (a) => [`c${hex(a)}`, String(profileOf(a))];
  const stockFor = (m, key) => ((data().stock[m.id] || {})[key]) || {};
  const stockText = (st) => Object.entries(st).filter(([, n]) => n > 0).map(([d, n]) => `${n} ${data().names[d] || 'ore'}`).join(', ');
  const nearby = (a) => onlineActors().filter((t) => (t >>> 0) !== (a >>> 0)).map((t) => { let d = Infinity; try { d = distanceMeters(a, t); } catch (e) { /* far */ } return { t, d }; })
    .filter((x) => x.d <= (Number(C.nameReachMeters) || 10)).sort((x, y) => x.d - y.d).slice(0, 12).map((x) => x.t);
  const taxLine = (m) => {
    try {
      const t = fn('__dboEconomyTaxOf') ? fn('__dboEconomyTaxOf')(m.doorIds[0]) : null;
      return t && t.weeklyTax > 0 ? ` Property tax: ${t.weeklyTax} gold a week on a value of ${t.taxValue}.` : '';
    } catch (e) { return ''; }
  };
  const open = (a, m, page, note) => {
    const own = ownerOf(m); const r = rulesOf(m, own); const rules = setsRules(a, own);
    const nonce = `${hex(a)}-${Date.now().toString(36)}`;
    S.panels.set(a >>> 0, { id: m.id, nonce, page: page || 'main' });
    const act = (id, label) => ({ id: `${nonce}|${id}`, label });
    const actions = [];
    let title = `${m.name}${holdName(m) ? `, ${holdName(m)}` : ''}. `;
    if (!own) title += lair(m) ? 'A lair for now, owned by nobody: its seams are open to every miner.' : 'Owned by nobody: its seams are open to every miner, and the hold may sell it.';
    else title += `Owned by ${own.name}: ${accessText(r, own)}${Number(r.share) > 0 ? `, ${r.share}% of what others mine goes to the owner` : ''}.${taxLine(m)}`;
    if (note) title = `${note} ${title}`;
    if (!page || page === 'main') {
      if (!clanOf(m) && !lair(m)) actions.push(act('market', own ? (insider(a, own) ? 'Sell it, or take it off sale' : 'Buy it from its owner') : 'Buy it from the hold'));
      if (rules) {
        actions.push(act('page:access', `Who may mine here (now ${r.access})`));
        actions.push(act('page:share', `The owner's share (now ${Number(r.share) || 0}%)`));
        if (r.access === 'faction' || r.access === 'named') actions.push(act('page:name', 'Name someone beside you'));
        if ((r.named || []).length) actions.push(act('page:unname', `Strike a name (${r.named.length} named)`));
        const st = stockText(stockFor(m, own.key));
        if (st) actions.push(act('collect', `Collect the share: ${st}`));
      }
      // A former owner's share, left from when they held it
      for (const k of keysOf(a)) if (!own || k !== own.key) { const st = stockText(stockFor(m, k)); if (st) { actions.push(act(`collectOld:${k}`, `Collect your share from when you held it: ${st}`)); break; } }
    } else if (page === 'access' && rules) {
      actions.push(act('access:open', 'Open to every miner'));
      if (own.kind === 'player') for (const g of guildsOf(a)) actions.push(act(`access:faction:${g.id}`, `Open to ${g.name} and the people named`));
      actions.push(act('access:named', `Only ${own.kind === 'clan' ? 'the clan and ' : ''}the people named`));
      actions.push(act('access:closed', own.kind === 'clan' ? 'The clan alone' : 'You alone'));
    } else if (page === 'share' && rules) {
      for (const p of (C.shareSteps || []).map(Number).filter((x) => Number.isFinite(x) && x >= 0 && x <= Number(C.maxShare))) actions.push(act(`share:${p}`, `${p}%${p === Number(r.share) ? ' (now)' : ''}`));
    } else if (page === 'name' && rules) {
      for (const t of nearby(a)) actions.push(act(`name:${hex(t)}`, display(t)));
      if (!actions.length) title = `Nobody is beside you to name. ${title}`;
    } else if (page === 'unname' && rules) {
      for (const n of r.named || []) actions.push(act(`unname:${hex(n.char)}`, n.name));
    }
    if (page && page !== 'main') actions.push(act('page:main', 'Back'));
    actions.push(act('cancel', 'Close'));
    openWidget(a, { type: 'contextMenu', id: MENU_ID, mode: 'menu', targetName: title, actions, events: { action: 'dbo:mineChoose', close: 'dbo:mineClose' } }, true);
    return true;
  };
  globalThis.__dboMinePanel = (a, mine) => { const m = byId.get(String((mine && mine.id) || mine)); return m ? open(a, m) : false; };
  // tenancy.js: the door's property menu ("Buy or rent") at a mine opens this panel first; true when it did
  globalThis.__dboMineAtDoor = (a, door) => {
    if (!C.enabled) return false;
    const m = mineOfDoor(door); if (!m) return false;
    return open(a, m);
  };

  const collect = (a, m, key) => {
    const st = (data().stock[m.id] || {})[key] || {};
    const got = [];
    for (const [d, n] of Object.entries(st)) {
      if (!(n > 0)) continue;
      if (giveItem(a, idOf(d), n) === false) continue;
      got.push(`${n} ${data().names[d] || 'ore'}`); delete st[d];
    }
    if (!Object.keys(st).length && data().stock[m.id]) delete data().stock[m.id][key];
    save();
    if (got.length) audit(`MINE ${who(a)} collected the share of ${m.name}: ${got.join(', ')}`);
    return got.length ? `You collect ${got.join(', ')}.` : 'There was nothing you could carry.';
  };

  onUi('mineChoose', (a, args) => {
    const p = S.panels.get(a >>> 0);
    const raw = String((args || [])[0] || ''); const bar = raw.indexOf('|');
    const nonce = bar > 0 ? raw.slice(0, bar) : ''; const [verb, x, y] = raw.slice(bar + 1).split(':');
    if (!p || nonce !== p.nonce) return;
    const m = byId.get(p.id); if (!m) return;
    if (verb === 'cancel') { S.panels.delete(a >>> 0); return closeWidget(a, MENU_ID); }
    if (mineAt(a) !== m) { S.panels.delete(a >>> 0); closeWidget(a, MENU_ID); return personal(a, `You have walked away from ${m.name}.`); }
    if (verb === 'page') return open(a, m, x);
    if (verb === 'market') {
      const why = globalThis.__dboMineSaleRefusal(m.doorIds[0]);
      if (why) return open(a, m, 'main', why);
      S.panels.delete(a >>> 0); closeWidget(a, MENU_ID);
      if (fn('__dboTenancyPanel')) return fn('__dboTenancyPanel')(a);
      return personal(a, 'The property panel is not ready. Try again in a moment.');
    }
    const own = ownerOf(m);
    if (verb === 'collectOld') {
      if (!keysOf(a).includes(x) || (own && own.key === x)) return open(a, m);
      return open(a, m, 'main', collect(a, m, x));
    }
    if (!setsRules(a, own)) return open(a, m, 'main', 'Only its owner sets the rules of this mine.');
    const r = rulesOf(m, own);
    if (verb === 'collect') return open(a, m, 'main', collect(a, m, own.key));
    if (verb === 'access') {
      if (!['open', 'faction', 'named', 'closed'].includes(x)) return open(a, m);
      if (x === 'faction' && (own.kind !== 'player' || !roleIn(a, y))) return open(a, m, 'access', 'You can open it only to a faction you belong to.');
      putRules(m, own, { access: x, faction: x === 'faction' ? y : '' }, a, `access ${x}${x === 'faction' ? ` (${factionName(y)})` : ''}`);
      return open(a, m, 'main', `${m.name} is now ${accessText(rulesOf(m, own), own)}.`);
    }
    if (verb === 'share') {
      const pct = Math.floor(Number(x));
      if (!Number.isFinite(pct) || pct < 0 || pct > Number(C.maxShare)) return open(a, m, 'share');
      putRules(m, own, { share: pct }, a, `share ${pct}% (was ${Number(r.share) || 0}%)`);
      return open(a, m, 'main', pct ? `${pct}% of what others mine here now goes into the mine's store for its owner.` : 'Others now keep all they mine here.');
    }
    if (verb === 'name') {
      const t = parseInt(x, 16) >>> 0;
      if (!nearby(a).includes(t)) return open(a, m, 'name', 'They are not beside you any more.');
      if (named(r, t)) return open(a, m, 'main', `${display(t)} is already named.`);
      if ((r.named || []).length >= (Number(C.maxNamed) || 24)) return open(a, m, 'main', `At most ${C.maxNamed} people can be named.`);
      putRules(m, own, { named: (r.named || []).concat([{ char: t, name: display(t) }]) }, a, `named ${who(t)}`);
      personal(t, `You may now mine at ${m.name} (${own.name}).`);
      return open(a, m, 'main', `${display(t)} may now mine here.`);
    }
    if (verb === 'unname') {
      const t = parseInt(x, 16) >>> 0;
      const n = (r.named || []).find((e) => (Number(e.char) >>> 0) === t);
      if (!n) return open(a, m);
      putRules(m, own, { named: r.named.filter((e) => e !== n) }, a, `struck ${n.name}`);
      return open(a, m, 'main', `${n.name} is no longer named.`);
    }
    return open(a, m);
  });
  onUi('mineClose', (a) => { S.panels.delete(a >>> 0); closeWidget(a, MENU_ID); });
  onUi('close', (a, args, widgetId) => { if (Number(widgetId) === MENU_ID) S.panels.delete(a >>> 0); });

  registerChatCommand('mine', (a) => {
    if (!C.enabled) return personal(a, 'Mines are not owned as property yet.');
    const m = mineAt(a);
    if (!m) return personal(a, 'Stand in a mine, or at its door, to see who owns it.');
    open(a, m);
  }, { help: 'in a mine or at its door: who owns it, who may mine there, and the owner\'s rules' });

  globalThis.__dboMines = { list: () => MINES, byId: (id) => byId.get(String(id)) || null, ownerOf: (id) => { const m = byId.get(String(id)); return m ? ownerOf(m) : null; } };
  log(`mines ${C.enabled ? 'on' : 'off'}: ${MINES.length} mines (${MINES.filter((m) => clanOf(m)).length} of the clans, ${MINES.filter(lair).length} lairs not for sale), ${byVein.size} veins by reference`);
};
