// The native admin panel's test fixtures, shared by tests/native-admin-harness.js and the render scenes (tests/native-render.js):
// adminNativeView.ts compiled, panel data for every tab, and a panel wired so each admin::ui it sends is answered with the view
// adminMenuService would build.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('./native-swf-stub');

// adminNativeView.ts, compiled here unless a build is given
const viewJs = (() => {
  if (process.env.ADMIN_VIEW_JS) return path.resolve(process.env.ADMIN_VIEW_JS);
  const ts = require(path.resolve(__dirname, '../node_modules/typescript'));
  const src = fs.readFileSync(path.resolve(__dirname, '../src/services/services/adminNativeView.ts'), 'utf8');
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'admin-view-')), 'adminNativeView.js');
  fs.writeFileSync(out, ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText);
  return out;
})();
const V = require(viewJs);

const EVENTS = {
  tp: 'admin::tp', summon: 'admin::summon', kick: 'admin::kick', ban: 'admin::ban', tpLoc: 'admin::tploc', mode: 'admin::mode', refresh: 'admin::refresh',
  debugRefresh: 'admin::debugrefresh', close: 'admin::close', npcList: 'admin::npclist', npcAdd: 'admin::npcadd', npcTp: 'admin::npctp', npcReset: 'admin::npcreset',
  npcDelete: 'admin::npcdelete', masteryGrant: 'admin::masterygrant', masteryReset: 'admin::masteryreset', action: 'admin::action', request: 'admin::request',
};
const DEBUG = {
  account: 'nat', character: 'Aela', formId: 'ff00012a', actorId: 'ff00012a', profileId: 7, server: { name: 'DragonBreak', offsetMs: 0, tzOffsetMin: 0 },
  pos: [1000.4, -2000.6, 300], cell: { id: '3c', name: 'Bruma', interior: false, world: 'Cyrodiil', location: '' }, heading: { deg: 91, compass: 'E' },
  target: { name: 'Door', id: '1a2b', dist: 120 }, av: { health: [100, 120], magicka: [50, 80], stamina: [90, 90] },
  gameTime: { hour: 13.5, day: 3, month: 7, year: 201, weekday: 2 }, hoursOffset: 0, localTime: Date.now(),
  effects: [{ id: 'abc', name: 'Fortify Health', elapsedSec: 65 }], updatedAt: Date.now(),
};
const ZONES = Array.from({ length: 12 }, (_, i) => ({ name: 'Zone ' + i, active: i % 2 === 0, alive: 2, total: 4, inside: 0, readyInSec: i === 3 ? -1 : i === 5 ? 90 : 0 }));
const panel = (o) => Object.assign({
  admin: true, debug: DEBUG, players: [], locations: [], modes: [{ id: 'invisible', label: 'Invisible', active: true }, { id: 'ghost', label: 'Ghost', active: false }],
  npcZones: ZONES, npcZonesAt: Date.now(), caps: { ban: true, del: true, spawn: true }, tier: 'senior', mastery: null, bans: [], events: EVENTS,
}, o || {});

// A panel wired to the view builder: boot it, push the first view, and answer every admin::ui from then on
const open = (data, extra) => wire(S.boot('dbo_admin', false, extra), data);
const wire = (t, data) => {
  const st = { data, cats: { items: null, locations: null }, staff: {}, staffAt: {}, ui: {}, seen: 0, views: [] };
  t.view = () => V.adminNativeView(st.data, st.cats, st.staff, st.staffAt, st.ui, 23);
  t.serve = () => {
    for (;;) {
      const m = t.msgs();
      if (st.seen >= m.length) break;
      const next = m.slice(st.seen); st.seen = m.length;
      let pushed = false;
      for (const x of next) if (x.key === 'admin::ui') { st.ui = JSON.parse(x.args[0]); pushed = true; }
      if (pushed) { const v = t.view(); st.views.push(v); t.push(v); }
    }
  };
  t.refresh = () => { const v = t.view(); st.views.push(v); t.push(v); t.serve(); };
  t.adm = st;
  t.refresh();
  return t;
};
const P = (t) => t.root.dboPanel;
const B = (t) => P(t).body;
const sentOf = (t, key) => t.msgs().filter((m) => m.key === key);
const click = (t, c) => { c.onRelease(); t.serve(); };
const kids = (c, re) => Object.keys(c.kids).filter((n) => re.test(n)).map((n) => c[n]);
const railLabels = (t) => kids(P(t).rail, /^t\d+$/).map((b) => b.label.text);
const typeInto = (t, fieldClip, text, keep) => {
  click(t, fieldClip);
  const name = fieldClip._name;
  const box = B(t)[name];
  box.text = text; box.onChanged();
  t.press(keep === false ? 27 : 13); t.serve();
};

const ROSTER = Array.from({ length: 14 }, (_, i) => ({
  a: i < 10 ? (0xff000100 + i).toString(16) : undefined, p: 100 + i, n: 'Player ' + i, t: 'T' + i, d: '9' + i, dn: 'disc' + i, ip: '1.2.x.x', hwid: 'hw' + i,
  online: i < 10, ping: i < 10 ? 40 + i : null, m: { profession: i === 2 ? 'smith' : null, label: 'Smith', rank: 1, rankName: 'Apprentice', hours: 3 },
}));
const MASTERY_T = (target) => ({ name: 'Player 2', target, detail: { skills: [{ id: 'smith', label: 'Smithing', chosen: true, rank: 1, hours: 3 }, { id: 'alch', label: 'Alchemy', chosen: false, rank: 0, hours: 0 }],
  tierNames: ['Novice', 'Apprentice', 'Adept'], tierHours: [0, 10, 40], maxChosen: 3,
  schools: [{ name: 'Destruction', level: 20, role: 'mage', roleLabel: 'Mage' }, { name: 'Restoration', level: 5, role: 'priest', roleLabel: 'Priest' }] } });
const ITEMS = [{ id: 'weapons', label: 'Weapons', items: [['12eb7:Skyrim.esm', 'Iron Sword', 'Skyrim.esm'], ['13981:Skyrim.esm', 'Steel Sword', 'Skyrim.esm'], ['1a2b:BS.esm', 'Cyrod Blade', 'BSAssets.esm']] },
  { id: 'armor', label: 'Armour', items: [['12e49:Skyrim.esm', 'Iron Helmet', 'Skyrim.esm'], ['9999:DLE.esp', 'DLC2ArmorNordicHeavyBoots']] }];
const LOCS = [{ name: 'Bruma', region: 'Cyrodiil', worldName: 'Cyrodiil' }, { name: 'Cheydinhal', region: 'Cyrodiil', worldName: 'Cyrodiil' }, { name: 'Frostcrag Spire', region: 'Cyrodiil', worldName: 'Frostcrag' },
  { name: 'Whiterun', region: 'Skyrim', worldName: 'Tamriel' }, { name: 'Ald Velothi', region: 'Morrowind', worldName: 'Morrowind' }];
const ENCH_CAT = { type: 'staffData', id: 141, list: [
  { id: 'e1', n: 'Fire Damage', e: 'EnchWeaponFireDamage01', p: 'Skyrim.esm', k: 'w', m: 0, fx: [['Fire Damage', 10, 0, 0]] },
  { id: 'e2', n: 'Fortify Health', e: 'EnchArmorFortifyHealth01', p: 'Skyrim.esm', k: 'a', m: 0, fx: [['Fortify Health', 20, 60, 0]] }], maxScale: 2 };
const ENCH_PACK = (target) => ({ type: 'staffData', id: 142, target, targetName: target ? 'Player 2' : 'you', at: 0, items: [
  { key: 'k1', name: 'Iron Sword', count: 2, kind: 'w', ok: true, why: '', now: '' }, { key: 'k2', name: 'Steel Helmet', count: 1, kind: 'a', ok: true, why: '', now: 'Fortify Magicka' },
  { key: 'k3', name: 'Worn Boots', count: 1, kind: 'a', ok: false, why: 'Worn: take it off first', now: '' }] });
const now0 = Date.now();
const GMCALLS = { type: 'staffData', id: 140, now: now0, quiet: false, canGoto: true, closed: [{ n: 3, name: 'Olaf', how: 'closed', by: 'nat', at: now0 - 3600000, note: 'sorted' }],
  open: [{ n: 7, name: 'Bri', online: true, place: 'Bruma', at: now0 - 720000, lines: [{ at: now0 - 720000, text: 'stuck in a wall' }, { at: now0 - 60000, text: 'still stuck' }], takenBy: '', mine: false, ticket: '' },
    { n: 8, name: 'Cass', online: false, place: 'Cheydinhal', at: now0 - 60000, lines: [{ at: now0 - 60000, text: 'lost my horse' }], takenBy: 'nat', mine: true, ticket: '41' },
    { n: 9, name: 'Dov', online: true, place: 'Chorrol', at: now0, lines: [{ at: now0, text: 'hi' }], takenBy: 'kim', mine: false, ticket: '' }] };
const THIEF = { type: 'staffData', id: 162, now: now0, enabled: true, lead: true, gm: true, armed: null, result: { ok: true, text: 'Fence marked.', at: now0 },
  factions: [{ id: 'tg', name: 'Thieves Guild', config: true, fence: { chest: 'ff0001', by: 'nat', at: 0, frozen: 0, lots: 2 } }, { id: 'rats', name: 'Ratway Rats', config: false, fence: null }],
  candidates: [{ id: 'ravens', name: 'Ravens' }],
  raids: [{ n: 4, fid: 'tg', faction: 'Thieves Guild', state: 'pending', by: 'Guard Ulf', evidence: 'Found the chest', at: now0 - 600000, raidAt: 0, decidedBy: '', reason: '' },
    { n: 5, fid: 'rats', faction: 'Ratway Rats', state: 'approved', by: 'Guard Ulf', evidence: 'A tip', at: now0 - 600000, raidAt: now0 + 3600000, decidedBy: 'nat', reason: '' }],
  stolen: [{ n: 1, at: now0 - 60000, item: 'Gold Ring', owner: 'Olaf', thief: 'Bri', home: 'Rose Hall', state: 'fenced', canSendBack: true }, { n: 2, at: now0, item: 'Ale', owner: 'Gemma', thief: 'Cass', home: 'Inn', state: 'carried', canSendBack: false }],
  stolenTotal: 2, permits: [{ home: 'h1', homeName: 'Rose Hall', thief: 'Bri', until: now0 + 7200000, by: 'nat' }], breaches: [], working: [{ thief: 'Cass', home: 'Inn', kind: 'door', until: now0 + 30000 }] };
const PMETA = { categories: [{ id: 'npc:bandit', label: 'Bandits', kind: 'npc', count: 40 }, { id: 'obj:chair', label: 'Chairs', kind: 'obj', count: 3 }],
  plugins: ['Skyrim.esm', 'BSHeartland.esm'], rights: { place: true, hostile: true, others: false, placeNeeds: '' } };
const pitems = (n, from) => Array.from({ length: n }, (_, i) => ['Skyrim.esm:' + (1000 + from + i).toString(16), 'Bandit ' + (from + i), 'Skyrim.esm', 'npc:bandit', i % 3 === 2 ? 'obj' : 'npc']);
const preq = (t, type) => sentOf(t, 'admin::request').filter((m) => m.args[0] === type).map((m) => JSON.parse(m.args[1]));
const WB = { members: [{ id: 'm1', name: 'Bandit', alive: true, dist: 4, fighting: false, health: 80, state: '', target: '' }, { id: 'm2', name: 'Wolf', alive: false, dist: null }],
  counts: [{ name: 'Bandit', count: 1 }, { name: 'Wolf', count: 1 }], placed: [{ id: 'r1', name: 'Raider', hostile: true, alive: true, dist: 30 }, { id: 'g1', name: 'Guard', hostile: false, alive: true, dist: 5 }],
  players: [{ id: 'pl', name: 'Bri', dist: 10 }], npcs: [{ id: 'n1', name: 'Orc', gm: 'kim', foe: true, dist: 20 }], foes: [], target: { id: 't', name: 'Troll', dist: 12 },
  stance: 'follow', side: '', enemies: [], plan: { calm: 1, kept: 'Wolf', unread: '' }, presets: [{ name: 'Camp crew', count: 6 }], onLogout: 'dismiss', maxBand: 25, maxRaise: 10, last: { text: 'Raised 2 bandits.' }, info: null };
module.exports = { wire, viewJs, V, EVENTS, DEBUG, ZONES, panel, open, P, B, sentOf, click, kids, railLabels, typeInto, ROSTER, MASTERY_T, ITEMS, LOCS, ENCH_CAT, ENCH_PACK, now0, GMCALLS, THIEF, PMETA, pitems, preq, WB };
