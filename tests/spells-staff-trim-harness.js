// Scripted test for spells.js's staff trims (Jake, 17 Oct 2026): config spells.staffTrims = [{ id, actor, profile,
// keepSpells, removeSpells, keepShouts?, offline?, by, why }] is a staff removal of learned spells, applied once per id to
// one character at load (and so at a hot reload of the config), in small batches across runs of its own timer, without
// ever reading the learned list (GetSpellCount / GetNthSpell cost the fork N squared). Loads the real module in a scratch
// folder against a mock engine. Part 1 checks the seven entries shipped in gamemode-config.json (one for each character
// still holding the admin panel's Give all spells; Jake, 17 Oct ~03:25Z: remove them all), against the Give all spells
// list and, where the plugins are on this machine, the server's load order and the SPEL records, then runs them together.
// Part 1b runs the first entry shipped (ff001473 back to its 211 spells), kept below as a fixture, against the character
// saved on 17 Oct; part 2 runs made-up characters for each rule.
//
//   node tests/spells-staff-trim-harness.js   (from server/; uses os.tmpdir(), so set TMPDIR where /tmp is not wanted;
//   DBO_PLUGINS and DBO_MANIFEST name the plugin folder and the server's manifest.json, else /opt/skyrim-data and
//   /opt/alduinak/build/dist/server/data/manifest.json; without them the load order and SPEL checks say SKIP)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE = path.resolve(__dirname, '..', 'spells.js');
const SERVER = path.resolve(__dirname, '..');
const LIVE = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8')).spells;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spells-staff-trim-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
fs.copyFileSync(path.join(SERVER, 'skills.json'), 'skills.json');
fs.writeFileSync('spell-tomes.json', JSON.stringify({ tomes: [] }));
let now = Date.UTC(2026, 9, 17, 3, 0);
Date.now = () => now;

let fails = 0, checks = 0;
const ok = (c, what, got) => { checks++; console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!c) fails++; };

// ---- the mock engine -----------------------------------------------------------------------------------------------------
// Plugins get an index the first time they are named; a desc of a plugin never named does not resolve (0), as a plugin
// missing from the load order. Every form named in a list is a SPEL unless listed in NOT_SPELL.
const PLUGINS = new Map();
const MISSING = new Set(['NotLoaded.esp']);
const idOf = (d) => {
  const s = String(d); const i = s.indexOf(':'); if (i < 0) throw new Error('bad desc ' + s);
  const plugin = s.slice(i + 1); if (MISSING.has(plugin)) throw new Error(`${plugin} not found in loaded files`);
  if (!PLUGINS.has(plugin)) PLUGINS.set(plugin, PLUGINS.size);
  return ((PLUGINS.get(plugin) << 24) | parseInt(s.slice(0, i), 16)) >>> 0;
};
const descOf = (id) => {
  id >>>= 0;
  if (id >= 0xff000000) return (id - 0xff000000).toString(16);
  const plugin = [...PLUGINS.entries()].find(([, v]) => v === id >>> 24);
  if (!plugin) throw new Error('no plugin ' + (id >>> 24));
  return `${(id & 0xffffff).toString(16)}:${plugin[0]}`;
};
const actorDesc = (a) => (a >>> 0).toString(16); // never used for a lookup: the self desc is checked against the actor
const NOT_SPELL = new Set();
const ACTORS = new Map(); // actor -> { props: Map, learned: Set }
const addActor = (a, profile, learned, props) => {
  ACTORS.set(a >>> 0, { props: new Map(Object.entries(Object.assign({ profileId: profile }, props || {}))), learned: new Set(learned.map((x) => (typeof x === 'string' ? idOf(x) : x >>> 0))) });
  return a >>> 0;
};
const actorOfDesc = (desc) => { for (const a of ACTORS.keys()) if (descOf(a) === desc) return a; throw new Error('Form not found ' + desc); };
const calls = []; // [fn, actor, spellDesc]
let removeThrows = null; // actor whose RemoveSpell throws
const mp = {
  getIdFromDesc: (d) => idOf(d),
  getDescFromId: (id) => descOf(id),
  get: (a, p) => { const x = ACTORS.get(a >>> 0); if (!x) throw new Error(`Form with id ${(a >>> 0).toString(16)} not found`); return x.props.get(p); },
  set: (a, p, v) => { const x = ACTORS.get(a >>> 0); if (!x) throw new Error(`Form with id ${(a >>> 0).toString(16)} not found`); x.props.set(p, v === undefined ? v : JSON.parse(JSON.stringify(v))); },
  lookupEspmRecordById: (id) => (NOT_SPELL.has(id >>> 0) ? { record: { type: 'BOOK', editorId: 'x', fields: [] }, toGlobalRecordId: (l) => l } : { record: { type: 'SPEL', editorId: 'x', fields: [] }, toGlobalRecordId: (l) => l }),
  callPapyrusFunction: (kind, cls, fn, self, args) => {
    const a = actorOfDesc(self.desc);
    calls.push([fn, a, args && args[0] && args[0].desc]);
    const s = ACTORS.get(a).learned;
    if (fn === 'GetSpellCount') return s.size;
    if (fn === 'GetNthSpell') { const id = [...s][args[0]]; return id === undefined ? null : { type: 'espm', desc: descOf(id) }; }
    if (fn === 'RemoveSpell') { if (removeThrows === a) throw new Error('RemoveSpell refused'); return s.delete(idOf(args[0].desc)); }
    if (fn === 'AddSpell') { const id = idOf(args[0].desc); if (s.has(id)) return false; s.add(id); return true; }
    throw new Error('unexpected papyrus ' + fn);
  },
};
mp.onReadBook = () => undefined;
void actorDesc;

// The trim's own timer, run by hand: setInterval/clearInterval are captured
const intervals = new Map(); let nextInterval = 1;
const realSetInterval = global.setInterval, realClearInterval = global.clearInterval;
global.setInterval = (fn, ms) => { const h = { id: nextInterval++, fn, ms }; intervals.set(h.id, h); return h; };
global.clearInterval = (h) => { if (h && typeof h === 'object' && intervals.has(h.id)) intervals.delete(h.id); else realClearInterval(h); };
const live = () => [...intervals.values()];
const tick = () => { const l = live(); if (l.length !== 1) throw new Error(`${l.length} trim timers`); l[0].fn(); };
const run = (max) => { let n = 0; while (live().length && n < (max || 100)) { tick(); n++; } return n; };
void realSetInterval;

let online = [];
const out = { said: [], audits: [], logs: [] };
const mkApi = (spellsCfg) => ({
  mp,
  log: (...a) => out.logs.push(a.join(' ')),
  personal: (a, t) => out.said.push([a >>> 0, t]),
  system: (a, t) => out.said.push([a >>> 0, t]),
  audit: (t) => out.audits.push(t),
  display: (a) => `C${(a >>> 0).toString(16)}`,
  who: (a) => `C${(a >>> 0).toString(16)} (profile ${(() => { try { return mp.get(a, 'profileId'); } catch (e) { return '?'; } })()})`,
  cfg: { spells: spellsCfg || {} },
  openWidget: () => true, closeWidget: () => true, onUi: () => {}, registerChatCommand: () => {},
  onlineActors: () => online.slice(), every: () => {}, distanceMeters: () => Infinity,
  takeGold: () => false, giveItem: () => true, depositToTreasury: () => 0,
});
const load = (spellsCfg) => { delete require.cache[MODULE]; require(MODULE)(mkApi(spellsCfg)); };
const clearOut = () => { out.said.length = 0; out.audits.length = 0; out.logs.length = 0; calls.length = 0; };
const propOf = (a, p) => ACTORS.get(a >>> 0).props.get(p);
const learnedDescs = (a) => [...ACTORS.get(a >>> 0).learned].map(descOf);
const listReads = () => calls.filter((c) => c[0] === 'GetSpellCount' || c[0] === 'GetNthSpell').length;

// ---- 1. the shipped entries ----------------------------------------------------------------------------------------------
// One for each character that still holds a Give all spells grant, computed offline from the saved characters and the world
// backups (keep: what it held before its first grant, the mastery abilities and its own learns; remove: the rest of the
// learned list plus the suspended spells a grant added, which spells.hold holds and the character no longer has learned).
// actor -> [profile, keep, remove, the removals held, not learned]
const SHIPPED = {
  ff001473: [47, 84, 249, ['da746:Skyrim.esm', '8dcec:Druadach.esm']],
  ff0005e7: [2, 25, 132, []],
  ff0013ec: [4, 80, 132, []],
  ff001a60: [2, 11, 132, []],
  ff001585: [3, 0, 132, ['da746:Skyrim.esm']],
  ff000019: [6, 10, 133, []],
  ff001bbb: [6, 6, 133, []],
};
const TRIMS7 = Array.isArray(LIVE.staffTrims) ? LIVE.staffTrims.filter((e) => e && typeof e === 'object') : [];
ok(Array.isArray(LIVE.staffTrims) && LIVE.staffTrims.length === 7 && TRIMS7.length === 7, 'gamemode-config.json carries seven trims', (LIVE.staffTrims || []).length);
ok(JSON.stringify(TRIMS7.map((e) => e.actor)) === JSON.stringify(Object.keys(SHIPPED)), 'one for each character still holding Give all spells, in this order', TRIMS7.map((e) => e.actor));
ok(new Set(TRIMS7.map((e) => e.id)).size === 7 && TRIMS7.every((e) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(e.id) && e.id === `jake-1017-trim-${e.actor}`),
  'every id is unique and names its character', TRIMS7.map((e) => e.id));
ok(TRIMS7.every((e) => /^ff[0-9a-f]{6}$/.test(e.actor) && parseInt(e.actor, 16) >= 0xff000000), 'every actor is a player character id (ff......)');
ok(TRIMS7.every((e) => SHIPPED[e.actor] && e.profile === SHIPPED[e.actor][0]), "every profile is the character's own", TRIMS7.map((e) => [e.actor, e.profile]));
ok(TRIMS7.every((e) => Array.isArray(e.keepSpells) && Array.isArray(e.removeSpells) && SHIPPED[e.actor] && e.keepSpells.length === SHIPPED[e.actor][1] && e.removeSpells.length === SHIPPED[e.actor][2]),
  'keep / remove: 84/249, 25/132, 80/132, 11/132, 0/132, 10/133, 6/133', TRIMS7.map((e) => [e.actor, (e.keepSpells || []).length, (e.removeSpells || []).length]));
ok(TRIMS7.reduce((n, e) => n + (e.removeSpells || []).length, 0) === 1043, '1043 removals in all');
ok(TRIMS7.every((e) => new Set(e.keepSpells).size === e.keepSpells.length && new Set(e.removeSpells).size === e.removeSpells.length), 'no list repeats a spell');
ok(TRIMS7.every((e) => !e.removeSpells.some((d) => e.keepSpells.includes(d))), 'keep and remove are disjoint in every entry',
  TRIMS7.map((e) => [e.actor, e.removeSpells.filter((d) => e.keepSpells.includes(d))]).filter((x) => x[1].length));
const DESC = /^[1-9a-f][0-9a-f]{0,5}:[^:\s][^:]*\.(esm|esp|esl)$/;
ok(TRIMS7.every((e) => e.keepSpells.concat(e.removeSpells).every((d) => DESC.test(d))), 'every desc is <lowercase hex id>:<plugin>',
  TRIMS7.flatMap((e) => e.keepSpells.concat(e.removeSpells)).filter((d) => !DESC.test(d)));
ok(TRIMS7.every((e) => e.offline === 'apply' && e.keepShouts === undefined), 'each trims the saved form while offline and leaves shouts alone (no keepShouts)');
ok(TRIMS7.every((e) => /^[\w .,;:()'-]+$/.test(String(e.by) + String(e.why)) && !/\d{15,}/.test(String(e.by) + String(e.why))), 'by and why carry no Discord id', TRIMS7.map((e) => [e.by, e.why]));
// The admin panel's Give all spells list: spellsGiveAllOff while the 17 Oct stopgap keeps spells empty, spells again once it
// is undone. The 133 spells it gave before 16 Oct are all among its 254.
const POWERS = JSON.parse(fs.readFileSync(path.join(SERVER, 'admin-powers.json'), 'utf8'));
const GIVE = new Set([].concat(POWERS.spells || [], POWERS.spellsGiveAllOff || []).map((x) => (Array.isArray(x) ? x[0] : x)));
ok(GIVE.size === 254, 'the Give all spells list holds its 254 tome spells', GIVE.size);
ok(TRIMS7.every((e) => e.removeSpells.every((d) => GIVE.has(d))), 'every removal is on the Give all spells list', TRIMS7.flatMap((e) => e.removeSpells.filter((d) => !GIVE.has(d))));
const SUSP = new Set(LIVE.suspendedSpells || []);
ok(Object.values(SHIPPED).every((x) => x[3].every((d) => SUSP.has(d))), 'the removals held, not learned, are suspended spells (spells.hold holds them)');

// The server's load order and the plugins, read from the record headers only: the TES4 header for the masters, the top
// groups, and in the SPEL group each record's type and form id (a record the plugin itself defines has the masters' count
// as its top byte; a light plugin's too)
const PLUGINS_DIR = process.env.DBO_PLUGINS || '/opt/skyrim-data';
const MANIFEST = process.env.DBO_MANIFEST || '/opt/alduinak/build/dist/server/data/manifest.json';
const spelIds = (file) => {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size, h = Buffer.alloc(24);
    const at = (p) => { if (fs.readSync(fd, h, 0, 24, p) !== 24) throw new Error(`${file}: short read at ${p}`); return h; };
    at(0);
    if (h.toString('latin1', 0, 4) !== 'TES4') throw new Error(`${file} is not a plugin`);
    const hs = h.readUInt32LE(4), hd = Buffer.alloc(hs);
    fs.readSync(fd, hd, 0, hs, 24);
    let masters = 0, next = -1; // XXXX: the size of the next field, when it is over 65535
    for (let p = 0; p + 6 <= hs;) {
      const t = hd.toString('latin1', p, p + 4); let l = hd.readUInt16LE(p + 4);
      if (t === 'XXXX') { next = hd.readUInt32LE(p + 6); p += 6 + l; continue; }
      if (next >= 0) { l = next; next = -1; }
      if (t === 'MAST') masters++;
      p += 6 + l;
    }
    const ids = new Set();
    for (let p = 24 + hs; p + 24 <= size;) {
      at(p);
      if (h.toString('latin1', 0, 4) !== 'GRUP') throw new Error(`${file}: no top group at ${p}`);
      const gsz = h.readUInt32LE(4);
      if (h.readInt32LE(12) === 0 && h.toString('latin1', 8, 12) === 'SPEL') {
        for (let q = p + 24; q + 24 <= p + gsz;) {
          at(q);
          const t = h.toString('latin1', 0, 4), sz = h.readUInt32LE(4);
          if (t === 'GRUP') { q += sz; continue; }
          const fid = h.readUInt32LE(12);
          if (t === 'SPEL' && fid >>> 24 === masters) ids.add(fid & 0xffffff);
          q += 24 + sz;
        }
      }
      if (gsz < 24) throw new Error(`${file}: a group of ${gsz} bytes at ${p}`);
      p += gsz;
    }
    return ids;
  } finally { fs.closeSync(fd); }
};
if (fs.existsSync(MANIFEST) && fs.existsSync(PLUGINS_DIR)) {
  const order = new Set(JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).loadOrder || []);
  const pluginOf = (d) => d.slice(d.indexOf(':') + 1);
  const named = new Set(TRIMS7.flatMap((e) => e.keepSpells.concat(e.removeSpells)).map(pluginOf));
  ok(order.size >= 100 && [...named].every((p) => order.has(p)), `every desc names a plugin of the server's load order (${order.size}), spelled as it is there`, [...named].filter((p) => !order.has(p)));
  const read = new Map(), notSpel = [];
  for (const d of new Set(TRIMS7.flatMap((e) => e.removeSpells))) {
    const p = pluginOf(d);
    if (!order.has(p)) { notSpel.push(d); continue; }
    if (!read.has(p)) read.set(p, spelIds(path.join(PLUGINS_DIR, p)));
    if (!read.get(p).has(parseInt(d.slice(0, d.indexOf(':')), 16))) notSpel.push(d);
  }
  ok(read.size > 0 && !notSpel.length, `every removal is a SPEL record its plugin defines (${read.size} plugins, headers only)`, notSpel);
} else console.log('SKIP  the load order and SPEL checks (no plugins or manifest here: DBO_PLUGINS, DBO_MANIFEST)');

// ---- 1b. the first entry shipped, as a fixture ---------------------------------------------------------------------------
// da0665f55's entry for ff001473 (profile 47): back to the 211 spells it held before the 17 Oct grant, the 120 the grant
// added and still learned off, plus 8dcec:Druadach.esm, which the grant added and spells.hold holds. The config now carries
// the seven entries above; this one stays here (not in the config) to run the tool against the character saved on 17 Oct.
const FIXTURE_211 = {
  id: 'jake-1017-trim-ff001473', actor: 'ff001473', profile: 47, offline: 'apply',
  by: 'Jake (owner) via claude-jake', why: 'Give all spells left 331 learned spells; each read of the list froze the server about 4.5 s (17 Oct)',
  keepSpells: [
    '12fcc:Skyrim.esm', '12fcd:Skyrim.esm', '12fd0:Skyrim.esm', '12fd2:Skyrim.esm', '13018:Skyrim.esm', '1a4cc:Skyrim.esm', '1c789:Skyrim.esm', '204c3:Skyrim.esm',
    '204c4:Skyrim.esm', '204c5:Skyrim.esm', '21143:Skyrim.esm', '211eb:Skyrim.esm', '211ec:Skyrim.esm', '211ed:Skyrim.esm', '211ee:Skyrim.esm', '211ef:Skyrim.esm',
    '211f0:Skyrim.esm', '211f1:Skyrim.esm', '27eb6:Skyrim.esm', '2b96b:Skyrim.esm', '2b96c:Skyrim.esm', '2dd29:Skyrim.esm', '2dd2a:Skyrim.esm', '2f3b8:Skyrim.esm',
    '35d7f:Skyrim.esm', '35d80:Skyrim.esm', '35d81:Skyrim.esm', '3ae9f:Skyrim.esm', '3aea2:Skyrim.esm', '3aea3:Skyrim.esm', '43323:Skyrim.esm', '43324:Skyrim.esm',
    '45f9c:Skyrim.esm', '45f9d:Skyrim.esm', '4b146:Skyrim.esm', '4d3f2:Skyrim.esm', '4d3f8:Skyrim.esm', '4dba4:Skyrim.esm', '4dee8:Skyrim.esm', '4dee9:Skyrim.esm',
    '4deea:Skyrim.esm', '4deeb:Skyrim.esm', '4deec:Skyrim.esm', '4deed:Skyrim.esm', '4deee:Skyrim.esm', '4deef:Skyrim.esm', '51b16:Skyrim.esm', '5312d:Skyrim.esm',
    '5ad5c:Skyrim.esm', '5ad5d:Skyrim.esm', '5ad5e:Skyrim.esm', '5ad5f:Skyrim.esm', '5d175:Skyrim.esm', '5db90:Skyrim.esm', '5dd5d:Skyrim.esm', '5dd5e:Skyrim.esm',
    '5dd60:Skyrim.esm', '65bd7:Skyrim.esm', '6796f:Skyrim.esm', '67970:Skyrim.esm', '6d22c:Skyrim.esm', '6f952:Skyrim.esm', '6f953:Skyrim.esm', '7a82b:Skyrim.esm',
    '7e5d5:Skyrim.esm', '7e5d6:Skyrim.esm', '7e5d7:Skyrim.esm', '7e8da:Skyrim.esm', '7e8db:Skyrim.esm', '7e8dd:Skyrim.esm', '7e8de:Skyrim.esm', '7e8df:Skyrim.esm',
    '7e8e1:Skyrim.esm', '7e8e4:Skyrim.esm', '7e8e5:Skyrim.esm', '8c1ab:Skyrim.esm', '8f3eb:Skyrim.esm', '96d94:Skyrim.esm', '96d95:Skyrim.esm', 'ab23d:Skyrim.esm',
    'b62e6:Skyrim.esm', 'b62ee:Skyrim.esm', 'b62ef:Skyrim.esm', 'cdb70:Skyrim.esm', 'e0ccf:Skyrim.esm', '10ddec:Skyrim.esm', '10f7ec:Skyrim.esm', '10f7ed:Skyrim.esm',
    '10f7ee:Skyrim.esm', '38b5:Dawnguard.esm', '38b6:Dawnguard.esm', '3f52:Dawnguard.esm', '45ba:Dawnguard.esm', 'e8d2:Dawnguard.esm', 'e8d4:Dawnguard.esm', '1772d:Dragonborn.esm',
    '17731:Dragonborn.esm', '177af:Dragonborn.esm', '177b7:Dragonborn.esm', '1ce06:Dragonborn.esm', '1d74b:Dragonborn.esm', 'd64:BSAssets.esm', '12c7:BSAssets.esm', '1d9d:BSAssets.esm',
    '1da0:BSAssets.esm', '2308:BSAssets.esm', '3e18:BSAssets.esm', '3e27:BSAssets.esm', '3e28:BSAssets.esm', '4e53:BSAssets.esm', '7980:BSAssets.esm', '601fb4:BSAssets.esm',
    '60250b:BSAssets.esm', '602511:BSAssets.esm', '602595:BSAssets.esm', '6025b9:BSAssets.esm', '6028cd:BSAssets.esm', '6028cf:BSAssets.esm', '6028d0:BSAssets.esm', '6b57b:BSHeartland.esm',
    '6fa2c:BSHeartland.esm', '6ff7b:BSHeartland.esm', '71152:BSHeartland.esm', '72311:BSHeartland.esm', '72320:BSHeartland.esm', '7233b:BSHeartland.esm', '782c5:BSHeartland.esm', '83c8f:BSHeartland.esm',
    '302d:Gray Fox Cowl.esm', '20698:Gray Fox Cowl.esm', '2922:DragonBreak.esp', '111275:DragonBreak Online Edits.esp', '111276:DragonBreak Online Edits.esp', '111277:DragonBreak Online Edits.esp', '111278:DragonBreak Online Edits.esp', '111279:DragonBreak Online Edits.esp',
    '11127f:DragonBreak Online Edits.esp', '111280:DragonBreak Online Edits.esp', '111281:DragonBreak Online Edits.esp', '111282:DragonBreak Online Edits.esp', '111283:DragonBreak Online Edits.esp', '111284:DragonBreak Online Edits.esp', '111285:DragonBreak Online Edits.esp', '111286:DragonBreak Online Edits.esp',
    '111287:DragonBreak Online Edits.esp', '111288:DragonBreak Online Edits.esp', '111289:DragonBreak Online Edits.esp', '11128a:DragonBreak Online Edits.esp', '11128b:DragonBreak Online Edits.esp', '11128c:DragonBreak Online Edits.esp', '11128d:DragonBreak Online Edits.esp', '11128e:DragonBreak Online Edits.esp',
    '11128f:DragonBreak Online Edits.esp', '111290:DragonBreak Online Edits.esp', '111291:DragonBreak Online Edits.esp', '111292:DragonBreak Online Edits.esp', '111293:DragonBreak Online Edits.esp', '111294:DragonBreak Online Edits.esp', '111295:DragonBreak Online Edits.esp', '111296:DragonBreak Online Edits.esp',
    '111297:DragonBreak Online Edits.esp', '111298:DragonBreak Online Edits.esp', '111299:DragonBreak Online Edits.esp', '11129a:DragonBreak Online Edits.esp', '11129b:DragonBreak Online Edits.esp', '11129c:DragonBreak Online Edits.esp', '11129d:DragonBreak Online Edits.esp', '11129e:DragonBreak Online Edits.esp',
    '11129f:DragonBreak Online Edits.esp', '1112a0:DragonBreak Online Edits.esp', '1112a1:DragonBreak Online Edits.esp', '1112a2:DragonBreak Online Edits.esp', '1112a3:DragonBreak Online Edits.esp', '1112a4:DragonBreak Online Edits.esp', '1112a5:DragonBreak Online Edits.esp', '1112a6:DragonBreak Online Edits.esp',
    '1112a7:DragonBreak Online Edits.esp', '1112a8:DragonBreak Online Edits.esp', '1112a9:DragonBreak Online Edits.esp', '1112aa:DragonBreak Online Edits.esp', '1112ab:DragonBreak Online Edits.esp', '1112ac:DragonBreak Online Edits.esp', '1112ad:DragonBreak Online Edits.esp', '1112ae:DragonBreak Online Edits.esp',
    '1112af:DragonBreak Online Edits.esp', '1112b0:DragonBreak Online Edits.esp', '1112b1:DragonBreak Online Edits.esp', '1112b2:DragonBreak Online Edits.esp', '1112b3:DragonBreak Online Edits.esp', '1112b4:DragonBreak Online Edits.esp', '1112b5:DragonBreak Online Edits.esp', '1112b6:DragonBreak Online Edits.esp',
    '1112b7:DragonBreak Online Edits.esp', '1112b8:DragonBreak Online Edits.esp', '1112b9:DragonBreak Online Edits.esp', '1112ba:DragonBreak Online Edits.esp', '1112bb:DragonBreak Online Edits.esp', '1112bc:DragonBreak Online Edits.esp', '1112bd:DragonBreak Online Edits.esp', '1112be:DragonBreak Online Edits.esp',
    '1112bf:DragonBreak Online Edits.esp', '1112c0:DragonBreak Online Edits.esp', '1112c1:DragonBreak Online Edits.esp', '1112c2:DragonBreak Online Edits.esp', '1112c3:DragonBreak Online Edits.esp', '1112c4:DragonBreak Online Edits.esp', '1209ca:DragonBreak Online Edits.esp', '1209cb:DragonBreak Online Edits.esp',
    '1209cc:DragonBreak Online Edits.esp', '1209cd:DragonBreak Online Edits.esp', '1209ce:DragonBreak Online Edits.esp'
  ],
  removeSpells: [
    '640b6:Skyrim.esm', '9ce26:Skyrim.esm', '45b3:Dawnguard.esm', '45b8:Dawnguard.esm', '17782:Dragonborn.esm', '1cdf6:Dragonborn.esm', '33c66:Dragonborn.esm', '86f:ccBGSSSE025-AdvDSGS.esm',
    '870:ccBGSSSE025-AdvDSGS.esm', '8cb:ccBGSSSE025-AdvDSGS.esm', 'a0b:ccBGSSSE025-AdvDSGS.esm', '19d3fa:ccBGSSSE025-AdvDSGS.esm', '7230a:BSHeartland.esm', '815:Gray Fox Cowl.esm', '3a7e7:Gray Fox Cowl.esm', '83c59:Druadach.esm',
    '83c5a:Druadach.esm', '83c5b:Druadach.esm', '8dce4:Druadach.esm', '8dce8:Druadach.esm', '8dce9:Druadach.esm', '8dceb:Druadach.esm', '8dced:Druadach.esm', '8dcee:Druadach.esm',
    '8dd07:Druadach.esm', '8dd08:Druadach.esm', '8dd09:Druadach.esm', '902c2:Druadach.esm', '902c3:Druadach.esm', '902c5:Druadach.esm', '902c6:Druadach.esm', '902c7:Druadach.esm',
    '933de:Druadach.esm', '933e3:Druadach.esm', '933e6:Druadach.esm', '94fc7:Druadach.esm', '94fc8:Druadach.esm', '9544f:Druadach.esm', '95450:Druadach.esm', '95451:Druadach.esm',
    '95452:Druadach.esm', '9608d:Druadach.esm', '960a3:Druadach.esm', '960a4:Druadach.esm', '960a5:Druadach.esm', '960a7:Druadach.esm', '960a8:Druadach.esm', '960a9:Druadach.esm',
    '960c3:Druadach.esm', '960c4:Druadach.esm', '960c5:Druadach.esm', 'a11ae:Druadach.esm', 'a1dc8:Druadach.esm', '3b2ea:arnima.esm', '529d8:arnima.esm', '573bb:arnima.esm',
    '5ed01:arnima.esm', '6b1f5:arnima.esm', '6c5d3:arnima.esm', '73d5d:arnima.esm', '7a2cd:arnima.esm', '7d963:arnima.esm', '7d96a:arnima.esm', '8313c:arnima.esm',
    '8bebb:arnima.esm', '8bebc:arnima.esm', '8bec9:arnima.esm', 'cb54d:arnima.esm', '110396:arnima.esm', '111aad:arnima.esm', '1721b3:arnima.esm', '1721b4:arnima.esm',
    '17adc2:arnima.esm', '1aee56:arnima.esm', '6fa48a:arnima.esm', '6fa493:arnima.esm', '702e66:arnima.esm', 'a1897:summersetisles.esp', 'a189a:summersetisles.esp', 'a189d:summersetisles.esp',
    'a26da:summersetisles.esp', 'a26de:summersetisles.esp', 'de635:summersetisles.esp', '14c8bc:summersetisles.esp', '3055ca:summersetisles.esp', '30ef8e:summersetisles.esp', '3120b4:summersetisles.esp', '336537:summersetisles.esp',
    '51a041:summersetisles.esp', '5ce509:summersetisles.esp', '5ce50e:summersetisles.esp', '5d15db:summersetisles.esp', '65529e:summersetisles.esp', '65836a:summersetisles.esp', '685726:summersetisles.esp', '68572b:summersetisles.esp',
    '685730:summersetisles.esp', '685735:summersetisles.esp', '68573a:summersetisles.esp', '688834:summersetisles.esp', '688835:summersetisles.esp', '99ccc2:summersetisles.esp', '99ccc3:summersetisles.esp', '99ccc8:summersetisles.esp',
    'a13ef7:summersetisles.esp', 'a13efa:summersetisles.esp', 'a17241:summersetisles.esp', 'a2ac11:summersetisles.esp', 'a2ac15:summersetisles.esp', 'c11817:summersetisles.esp', 'c3cd49:summersetisles.esp', 'e30712:summersetisles.esp',
    'e4f6b3:summersetisles.esp', 'e69cb4:summersetisles.esp', 'e73b17:summersetisles.esp', '9c721e:King of the Murkmire.esp', '315aa6:SurWR.esp', '5e31:Summer Druid Armor Set.esp', '8bc:YokuWeapons.esp', '903:YokuWeapons.esp',
    '8dcec:Druadach.esm'
  ]
};
const FIX_CFG = Object.assign({}, LIVE, { staffTrims: [FIXTURE_211] });
const E = FIXTURE_211;
ok(E.id === 'jake-1017-trim-ff001473' && E.actor === 'ff001473' && E.profile === 47, 'the fixture: jake-1017-trim-ff001473 for ff001473 of profile 47', E.id);
const KEEP = E.keepSpells, REMOVE = E.removeSpells;
ok(KEEP.length === 211 && new Set(KEEP).size === 211, 'its keep list: the 211 spells held before the grant, no repeats', KEEP.length);
ok(REMOVE.length === 121 && new Set(REMOVE).size === 121, 'its remove list: the 120 the grant added still learned, plus the one held back', REMOVE.length);
ok(!REMOVE.some((d) => KEEP.includes(d)), 'no spell is on both lists');
ok(REMOVE.includes('8dcec:Druadach.esm') && !REMOVE.includes('da746:Skyrim.esm') && !KEEP.includes('8dcec:Druadach.esm'),
  'the held spell the grant added goes; the one held from before stays');
ok(E.keepShouts === undefined && E.offline === 'apply', 'it leaves shouts alone (they never slow the server) and trims the saved form while offline', E.keepShouts);
ok(/^[\w .,;:()'-]+$/.test(String(E.by) + String(E.why)) && !/\d{15,}/.test(String(E.by) + String(E.why)), 'by and why carry no Discord id', [E.by, E.why]);
// The character's spellbook and prepared spells as saved on 17 Oct: all in the keep list (and in the shipped entry's)
const BOOK = { arcane: ['2dd2a:Skyrim.esm', '45f9d:Skyrim.esm', '2dd29:Skyrim.esm', '7e8e5:Skyrim.esm'] };
const PREP = ['2dd2a:Skyrim.esm', '45f9d:Skyrim.esm', '2dd29:Skyrim.esm'];
ok([...BOOK.arcane, ...PREP].every((d) => KEEP.includes(d)), 'the spellbook and the prepared spells are all kept');

const GM = 0xff001473;
const GM_LEARNED = KEEP.concat(REMOVE.filter((d) => d !== '8dcec:Druadach.esm')).map(idOf);
addActor(GM, 47, GM_LEARNED, { 'private.dboStudied': BOOK, 'private.dboPrepared': PREP, 'private.dboHeldSpells': ['da746:Skyrim.esm', '8dcec:Druadach.esm'], 'private.dboAllShouts': true });
// Another character with the same spells, never touched
const BYSTANDER = addActor(0xff002000, 48, GM_LEARNED, { 'private.dboAllShouts': true, 'private.dboHeldSpells': ['8dcec:Druadach.esm'] });
ok(ACTORS.get(GM).learned.size === 331, 'the mock character holds the 331 saved learned spells', ACTORS.get(GM).learned.size);
online = [BYSTANDER];
clearOut();
load(FIX_CFG);
ok(out.logs.some((l) => /spells: staff trims: 1 started \(jake-1017-trim-ff001473: 121 to remove from ff001473, 0 spared\), 0 applied before, 0 skipped/.test(l)),
  'the load starts the trim and says how many go', out.logs.filter((l) => /staff trim/.test(l)));
ok(live().length === 1 && live()[0].ms === 1000, 'one timer, a run a second', live().map((x) => x.ms));
ok(calls.length === 0, 'nothing is removed at load itself: the first batch waits for the timer', calls.length);
tick();
const firstBatch = calls.filter((c) => c[0] === 'RemoveSpell');
ok(firstBatch.length === 20 && ACTORS.get(GM).learned.size === 311, 'one run removes one batch of 20', [firstBatch.length, ACTORS.get(GM).learned.size]);
ok(/^SPELL TRIM jake-1017-trim-ff001473 Cff001473 \(profile 47\) batch 1\/7 \(\d+ ms\): 20 removed \(/.test(out.audits[0] || ''), 'an audit line for the batch, with what went', out.audits[0]);
const runs = 1 + run();
ok(runs === 7 && live().length === 0, 'seven runs of one batch each (the last closes it), then the timer stops', runs);
ok(Math.max(...[...out.audits.filter((l) => / batch /.test(l))].map((l) => Number((/: (\d+) removed/.exec(l) || [])[1]) || 0)) <= 20, 'no batch removes more than 20');
ok(listReads() === 0, 'the learned list is never read (no GetSpellCount, no GetNthSpell)', listReads());
ok(calls.every((c) => c[1] === GM), 'every engine call is on that character alone', calls.filter((c) => c[1] !== GM).length);
const after = learnedDescs(GM);
ok(after.length === 211 && KEEP.every((d) => after.includes(d)), 'what is left is exactly the 211 of the keep list', after.length);
ok(ACTORS.get(BYSTANDER).learned.size === 331 && propOf(BYSTANDER, 'private.dboAllShouts') === true && propOf(BYSTANDER, 'private.dboHeldSpells').length === 1, 'the other character keeps every spell, its shouts and its held list');
ok(JSON.stringify(propOf(GM, 'private.dboHeldSpells')) === JSON.stringify(['da746:Skyrim.esm']), 'the held list keeps only the spell held from before', propOf(GM, 'private.dboHeldSpells'));
ok(propOf(GM, 'private.dboAllShouts') === true, 'the all-shouts grant is left as it was', propOf(GM, 'private.dboAllShouts'));
ok(JSON.stringify(propOf(GM, 'private.dboStudied')) === JSON.stringify(BOOK) && JSON.stringify(propOf(GM, 'private.dboPrepared')) === JSON.stringify(PREP), 'the spellbook and prepared list are untouched');
const rec = (propOf(GM, 'private.dboSpellTrims') || {})['jake-1017-trim-ff001473'];
ok(rec && rec.removed.length === 120 && rec.notLearned === 1 && rec.spared.length === 0 && rec.heldDropped.join() === '8dcec:Druadach.esm' && rec.shouts === 'untouched',
  'the result is kept on the character: 120 removed, 1 not learned, the held one dropped, shouts untouched', rec && { n: rec.removed.length, notLearned: rec.notLearned, held: rec.heldDropped, shouts: rec.shouts });
ok(rec && rec.removed.every((d) => REMOVE.includes(d)), 'the kept record lists the removed spells by desc, for a rollback');
const done = out.audits.find((l) => / done: /.test(l)) || '';
ok(/SPELL TRIM jake-1017-trim-ff001473 Cff001473 \(profile 47\) done: 120 spell\(s\) removed, 1 not learned, 0 kept as spellbook, prepared or on loan, 1 off the held list \(8dcec:Druadach.esm\), shouts: untouched; by Jake \(owner\) via claude-jake: Give all spells/.test(done), 'a summary audit line', done);
ok(out.said.length === 0, 'an offline character is told nothing', out.said);
// Applied once: a reload (or a restart) changes nothing
clearOut();
ACTORS.get(GM).learned.add(idOf(REMOVE[0])); // learned again after the trim, by hand: not the trim's business any more
load(FIX_CFG);
ok(live().length === 0 && calls.length === 0 && out.logs.every((l) => !/staff trims: /.test(l)), 'a later load applies nothing again and starts no timer', out.logs.filter((l) => /trim/.test(l)));
ok(ACTORS.get(GM).learned.has(idOf(REMOVE[0])), '...and a spell learned again later stays');

// ---- 1c. the seven shipped entries run together ----------------------------------------------------------------------------
// Each character as saved: its keep list and every removal still learned, the held ones on its held list, the shouts grant.
// ff001473 has its spellbook and prepared spells (all kept). One timer runs them all: one batch of 20 a run in all.
const SH = new Map(); // actor -> entry
for (const e of TRIMS7) {
  const held = (SHIPPED[e.actor] || [0, 0, 0, []])[3];
  const a = addActor(parseInt(e.actor, 16), e.profile, e.keepSpells.concat(e.removeSpells.filter((d) => !held.includes(d))),
    Object.assign({ 'private.dboHeldSpells': held.slice(), 'private.dboAllShouts': true }, e.actor === 'ff001473' ? { 'private.dboStudied': BOOK, 'private.dboPrepared': PREP } : {}));
  SH.set(a, e);
}
const bystanderBefore = ACTORS.get(BYSTANDER).learned.size;
online = [BYSTANDER];
clearOut();
load(LIVE);
const startLine = out.logs.find((l) => /spells: staff trims: /.test(l)) || '';
ok(startLine === `spells: staff trims: 7 started (${TRIMS7.map((e) => `${e.id}: ${e.removeSpells.length} to remove from ${e.actor}, 0 spared`).join('; ')}), 0 applied before, 0 skipped`,
  'the load starts all seven, each with every removal (none spared, none skipped)', startLine);
ok(live().length === 1 && calls.length === 0, 'one timer for the seven, and nothing removed at load', [live().length, calls.length]);
const perRun = [], runActors = []; let reads7 = 0, others7 = 0;
while (live().length && perRun.length < 200) {
  calls.length = 0; tick();
  const rm = calls.filter((c) => c[0] === 'RemoveSpell');
  perRun.push(rm.length); runActors.push([...new Set(rm.map((c) => c[1]))]);
  reads7 += listReads(); others7 += calls.filter((c) => !SH.has(c[1])).length;
}
const BATCHES7 = TRIMS7.reduce((n, e) => n + Math.ceil(e.removeSpells.length / 20), 0);
ok(BATCHES7 === 55 && perRun.length === 55 && live().length === 0, '55 runs (13 for ff001473, 7 for each of the others), then the timer stops', [perRun.length, BATCHES7, live().length]);
ok(Math.max(...perRun) <= 20 && perRun.every((n) => n > 0), 'every run removes one batch of at most 20, across all seven', [Math.min(...perRun), Math.max(...perRun)]);
ok(runActors.every((l) => l.length === 1), 'each run works on one character');
const order7 = runActors.map((l) => [...SH.keys()].indexOf(l[0]));
ok(order7.every((x, i) => i === 0 || x >= order7[i - 1]) && new Set(order7).size === 7, 'the seven go one after another, in config order', order7.join(''));
ok(reads7 === 0 && others7 === 0, 'no read of a learned list, and no engine call on anyone else', [reads7, others7]);
ok(ACTORS.get(BYSTANDER).learned.size === bystanderBefore, 'the character beside them keeps every spell');
ok(out.audits.filter((l) => / batch \d+\/\d+ \(/.test(l)).length === 55 && out.audits.filter((l) => / done: /.test(l)).length === 7, 'an audit line per batch (55) and a summary per character (7)',
  out.audits.filter((l) => / done: /.test(l)));
for (const [a, e] of SH) {
  const held = (SHIPPED[e.actor] || [0, 0, 0, []])[3];
  const r = (propOf(a, 'private.dboSpellTrims') || {})[e.id] || {};
  const left = learnedDescs(a);
  ok(left.length === e.keepSpells.length && e.keepSpells.every((d) => left.includes(d))
    && (r.removed || []).length === e.removeSpells.length - held.length && r.notLearned === held.length && (r.spared || []).length === 0
    && JSON.stringify((r.heldDropped || []).slice().sort()) === JSON.stringify(held.slice().sort()) && JSON.stringify(propOf(a, 'private.dboHeldSpells')) === '[]'
    && r.shouts === 'untouched' && propOf(a, 'private.dboAllShouts') === true,
  `${e.actor}: ${e.keepSpells.length} spells left (its keep list), ${e.removeSpells.length - held.length} removed, ${held.length} held one(s) dropped, shouts as they were`,
  { left: left.length, removed: (r.removed || []).length, notLearned: r.notLearned, held: r.heldDropped, shouts: r.shouts });
}
ok(JSON.stringify(propOf(GM, 'private.dboStudied')) === JSON.stringify(BOOK) && JSON.stringify(propOf(GM, 'private.dboPrepared')) === JSON.stringify(PREP), "ff001473's spellbook and prepared list are untouched");
ok(out.said.length === 0, 'nobody offline is told anything', out.said);
clearOut();
load(LIVE);
ok(live().length === 0 && calls.length === 0 && out.logs.every((l) => !/staff trim/.test(l)), 'a later load applies none of the seven again', out.logs.filter((l) => /trim/.test(l)));

// ---- 2. the rules, on made-up characters -----------------------------------------------------------------------------------
const S = (n, plugin) => `${(0x800 + n).toString(16)}:${plugin || 'Test.esm'}`;
const spells = (from, to, plugin) => { const l = []; for (let i = from; i < to; i++) l.push(S(i, plugin)); return l; };
const entry = (over) => Object.assign({ id: 'test-trim', actor: 'ff00a001', profile: 9, keepSpells: spells(0, 5), removeSpells: spells(5, 50), by: 'tester <@123456789012345678>', why: 'test' }, over || {});

// Online, a spellbook spell and a prepared one on the remove list, a spell on loan from a teacher
const A = addActor(0xff00a001, 9, spells(0, 50), { 'private.dboStudied': { arcane: [S(7)] }, 'private.dboPrepared': [S(8)], 'private.dboAllShouts': true });
globalThis.__dboSchoolsOnLoan = (a, id) => (a >>> 0) === A && (id >>> 0) === idOf(S(9));
online = [A];
clearOut();
load({ staffTrims: [entry({ keepShouts: ['7097b:Skyrim.esm'] })] });
run();
const ra = (propOf(A, 'private.dboSpellTrims') || {})['test-trim'];
ok(ra && ra.removed.length === 42 && ra.spared.length === 3 && [S(7), S(8), S(9)].every((d) => ra.spared.includes(d)), 'spellbook, prepared and loaned spells are spared', ra && ra.spared);
ok([S(7), S(8), S(9)].every((d) => learnedDescs(A).includes(d)) && learnedDescs(A).length === 8, '...and stay learned with the keep list', learnedDescs(A).length);
ok(propOf(A, 'private.dboAllShouts') === true && ra.shouts === 'grant kept (it cannot be kept in part)', 'a keepShouts list with shouts leaves the grant on', ra && ra.shouts);
ok(out.said.some((p) => p[0] === A && /The staff have taken 42 spells given by the admin panel's Give all spells off this character/.test(p[1])), 'an online character is told once', out.said);
ok(out.audits.every((l) => !/\d{15,}/.test(l)), 'no Discord id in the audit (by is cleaned)', out.audits.find((l) => /\d{15,}/.test(l)));
ok(listReads() === 0, 'still no read of the learned list');
globalThis.__dboSchoolsOnLoan = undefined;

// No keepShouts: shouts untouched
const B = addActor(0xff00a002, 9, spells(0, 10), { 'private.dboAllShouts': true });
clearOut();
load({ staffTrims: [entry({ id: 'no-shouts', actor: 'ff00a002', removeSpells: spells(5, 10) })] });
run();
ok(propOf(B, 'private.dboAllShouts') === true && (propOf(B, 'private.dboSpellTrims') || {})['no-shouts'].shouts === 'untouched', 'no keepShouts leaves the grant alone');
// keepShouts []: the grant is taken off
const B2 = addActor(0xff00a00a, 9, spells(0, 10), { 'private.dboAllShouts': true });
clearOut();
load({ staffTrims: [entry({ id: 'shouts-off', actor: 'ff00a00a', keepShouts: [], removeSpells: spells(5, 10) })] });
run();
ok(propOf(B2, 'private.dboAllShouts') === null && (propOf(B2, 'private.dboSpellTrims') || {})['shouts-off'].shouts === 'grant taken off', 'keepShouts [] takes the grant off', propOf(B2, 'private.dboAllShouts'));

// Two entries at once, for two characters: still one batch a run in all, the second after the first
const P1 = addActor(0xff00a00b, 21, spells(0, 40)), P2 = addActor(0xff00a00c, 22, spells(0, 40));
clearOut();
load({ staffTrims: [entry({ id: 'pair-1', actor: 'ff00a00b', profile: 21, keepSpells: [], removeSpells: spells(0, 40) }), entry({ id: 'pair-2', actor: 'ff00a00c', profile: 22, keepSpells: [], removeSpells: spells(0, 40) })] });
const pairRuns = [];
while (live().length && pairRuns.length < 20) { calls.length = 0; tick(); pairRuns.push(calls.filter((c) => c[0] === 'RemoveSpell').length); }
ok(Math.max(...pairRuns) <= 20 && ACTORS.get(P1).learned.size === 0 && ACTORS.get(P2).learned.size === 0, 'two runs share the timer: never more than one batch a run', pairRuns);

// A profile that does not match: nothing touched, stays unapplied, said in the log
const C = addActor(0xff00a003, 10, spells(0, 50));
clearOut();
load({ staffTrims: [entry({ id: 'wrong-profile', actor: 'ff00a003', profile: 9 })] });
ok(live().length === 0 && ACTORS.get(C).learned.size === 50 && !propOf(C, 'private.dboSpellTrims'), 'a profile that does not match touches nothing');
ok(out.logs.some((l) => /staff trim wrong-profile \(entry 1\) skipped: character ff00a003 is of profile 10, not 9/.test(l)), '...and says why', out.logs);

// Bad entries: each skipped with a log line, the good one beside them still runs
const D = addActor(0xff00a004, 11, spells(0, 30));
NOT_SPELL.add(idOf(S(40, 'Book.esm')));
clearOut();
load({ staffTrims: [
  'not an object', { id: 'no actor', removeSpells: [S(1)], keepSpells: [] }, entry({ id: 'npc', actor: '0001a2b3' }),
  entry({ id: 'no-profile', actor: 'ff00a004', profile: undefined }),
  entry({ id: 'bad-keep', actor: 'ff00a004', profile: 11, keepSpells: ['12:NotLoaded.esp'] }),
  entry({ id: 'bad-remove', actor: 'ff00a004', profile: 11, removeSpells: ['12:NotLoaded.esp'] }),
  entry({ id: 'not-spell', actor: 'ff00a004', profile: 11, removeSpells: [S(40, 'Book.esm')] }),
  entry({ id: 'empty-remove', actor: 'ff00a004', profile: 11, removeSpells: [] }),
  entry({ id: 'bad-offline', actor: 'ff00a004', profile: 11, offline: 'later' }),
  entry({ id: 'gone', actor: 'ff00dead', profile: 11 }),
  entry({ id: 'good', actor: 'ff00a004', profile: 11, keepSpells: [], removeSpells: spells(0, 3) }),
  entry({ id: 'good', actor: 'ff00a004', profile: 11, keepSpells: [], removeSpells: spells(0, 30) }),
] });
const skipped = out.logs.filter((l) => /skipped/.test(l)).join('\n');
ok(/\(entry 1\) skipped: not an object/.test(skipped) && /\(entry 2\) skipped: a bad id/.test(skipped) && /npc \(entry 3\) skipped: actor is not a player character/.test(skipped)
  && /no-profile \(entry 4\) skipped: no profile/.test(skipped) && /bad-keep \(entry 5\) skipped: keep spell 12:NotLoaded.esp is not in this load order/.test(skipped)
  && /bad-remove \(entry 6\) skipped: spell 12:NotLoaded.esp is not in this load order/.test(skipped) && /not-spell \(entry 7\) skipped: 828:Book.esm is not a spell/.test(skipped)
  && /empty-remove \(entry 8\) skipped: removeSpells is not a list of spells/.test(skipped) && /bad-offline \(entry 9\) skipped: offline is neither/.test(skipped)
  && /gone \(entry 10\) skipped: character ff00dead not found/.test(skipped) && /good \(entry 12\) skipped: a second entry with this id/.test(skipped), 'every bad entry is skipped with its reason', skipped);
run();
ok(ACTORS.get(D).learned.size === 27 && (propOf(D, 'private.dboSpellTrims') || {}).good, 'the good entry beside them runs (the first of a repeated id)', ACTORS.get(D).learned.size);
ok(Object.keys(propOf(D, 'private.dboSpellTrims')).join() === 'good', 'no bad entry is recorded as applied');
clearOut();
load({ staffTrims: 'all of them' });
ok(out.logs.some((l) => /config staffTrims is not a list; nothing trimmed/.test(l)) && live().length === 0, 'staffTrims that is not a list trims nothing');

// offline: 'wait' waits for the character to be online and settled; 'apply' (the default) trims the saved form
const W = addActor(0xff00a005, 12, spells(0, 25));
online = [];
clearOut();
load({ staffTrims: [entry({ id: 'wait', actor: 'ff00a005', profile: 12, offline: 'wait', keepSpells: [], removeSpells: spells(0, 25) })], trimSettleMs: 20000 });
for (let i = 0; i < 5; i++) { now += 1000; tick(); }
ok(ACTORS.get(W).learned.size === 25 && calls.length === 0, "offline 'wait': nothing while the character is offline");
online = [W]; now += 1000; tick();
for (let i = 0; i < 10; i++) { now += 1000; tick(); }
ok(ACTORS.get(W).learned.size === 25, '...nor in its first seconds online (the login passes)', ACTORS.get(W).learned.size);
now += 10000; tick();
ok(ACTORS.get(W).learned.size === 5, '...then a batch once it has been online trimSettleMs', ACTORS.get(W).learned.size);
run();
ok(ACTORS.get(W).learned.size === 0 && (propOf(W, 'private.dboSpellTrims') || {}).wait, '...and the rest');

// A hot reload mid-run goes on where it was: one timer, nothing counted twice
const H = addActor(0xff00a006, 13, spells(0, 100));
online = [];
const HCFG = { staffTrims: [entry({ id: 'reload', actor: 'ff00a006', profile: 13, keepSpells: spells(0, 10), removeSpells: spells(0, 100) })], trimBatch: 20 };
clearOut();
load(HCFG); tick(); tick();
ok(ACTORS.get(H).learned.size === 60, 'two batches before the reload', ACTORS.get(H).learned.size);
load(HCFG);
ok(live().length === 1, 'the reload replaces the timer: still one', live().length);
ok(out.logs.some((l) => /reload: 50 to remove from ff00a006/.test(l)), 'the reload goes on with what is left', out.logs.filter((l) => /reload/.test(l)));
run();
const rh = (propOf(H, 'private.dboSpellTrims') || {}).reload;
ok(ACTORS.get(H).learned.size === 10 && rh && rh.removed.length === 90 && rh.notLearned === 0, 'every spell counted once over the reload', rh && { removed: rh.removed.length, notLearned: rh.notLearned });

// An entry taken out of the config mid-run stops
const T = addActor(0xff00a007, 14, spells(0, 60));
clearOut();
load({ staffTrims: [entry({ id: 'withdrawn', actor: 'ff00a007', profile: 14, keepSpells: [], removeSpells: spells(0, 60) })] });
tick();
load({ staffTrims: [] });
ok(live().length === 0 && ACTORS.get(T).learned.size === 40 && !propOf(T, 'private.dboSpellTrims'), 'an entry taken out of the config mid-run stops, unapplied', ACTORS.get(T).learned.size);

// The engine refusing every removal: three tries, then it stops unapplied and runs again at the next load
const X = addActor(0xff00a008, 15, spells(0, 10));
removeThrows = X;
clearOut();
load({ staffTrims: [entry({ id: 'refused', actor: 'ff00a008', profile: 15, keepSpells: [], removeSpells: spells(0, 10) })] });
tick(); tick();
ok(live().length === 1, 'a refused batch is tried again', live().length);
tick();
ok(live().length === 0 && !propOf(X, 'private.dboSpellTrims') && out.logs.some((l) => /staff trim refused: 10 spell\(s\) could not be removed \(RemoveSpell refused\); it stays unapplied/.test(l)), '...three times, then it stops unapplied', out.logs.filter((l) => /refused/.test(l)));
removeThrows = null;
clearOut();
load({ staffTrims: [entry({ id: 'refused', actor: 'ff00a008', profile: 15, keepSpells: [], removeSpells: spells(0, 10) })] });
run();
ok(ACTORS.get(X).learned.size === 0 && (propOf(X, 'private.dboSpellTrims') || {}).refused, 'the next load applies it');

// Nothing configured: no timer, no line
clearOut();
load({});
ok(live().length === 0 && out.logs.every((l) => !/staff trim/.test(l)), 'no staffTrims: no timer and no log line');

console.log(`\n${checks - fails}/${checks} passed`);
process.exit(fails ? 1 : 0);
