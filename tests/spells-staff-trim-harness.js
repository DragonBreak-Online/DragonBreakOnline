// Scripted test for spells.js's staff trims (Jake, 17 Oct 2026): config spells.staffTrims = [{ id, actor, profile,
// keepSpells, removeSpells, keepShouts?, offline?, by, why }] is a staff removal of learned spells, applied once per id to
// one character at load (and so at a hot reload of the config), in small batches across runs of its own timer, without
// ever reading the learned list (GetSpellCount / GetNthSpell cost the fork N squared). Loads the real module in a scratch
// folder against a mock engine. The first part runs the real entry shipped in gamemode-config.json against a character
// whose learned list is the one saved on 17 Oct (the keep list plus what Give all spells added); the rest are made-up
// characters for each rule.
//
//   node tests/spells-staff-trim-harness.js   (from server/; uses os.tmpdir(), so set TMPDIR where /tmp is not wanted)
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

// ---- 1. the shipped entry ------------------------------------------------------------------------------------------------
const E = (LIVE.staffTrims || [])[0] || {};
ok(Array.isArray(LIVE.staffTrims) && LIVE.staffTrims.length === 1 && E.id === 'jake-1017-trim-ff001473' && E.actor === 'ff001473' && E.profile === 47,
  'gamemode-config.json carries one trim, jake-1017-trim-ff001473 for ff001473 of profile 47', E.id);
const KEEP = E.keepSpells || [], REMOVE = E.removeSpells || [];
ok(KEEP.length === 211 && new Set(KEEP).size === 211, 'its keep list: the 211 spells held before the grant, no repeats', KEEP.length);
ok(REMOVE.length === 121 && new Set(REMOVE).size === 121, 'its remove list: the 120 the grant added still learned, plus the one held back', REMOVE.length);
ok(!REMOVE.some((d) => KEEP.includes(d)), 'no spell is on both lists');
ok(REMOVE.includes('8dcec:Druadach.esm') && !REMOVE.includes('da746:Skyrim.esm') && !KEEP.includes('8dcec:Druadach.esm'),
  'the held spell the grant added goes; the one held from before stays');
ok(E.keepShouts === undefined && E.offline === 'apply', 'it leaves shouts alone (they never slow the server) and trims the saved form while offline', E.keepShouts);
ok(/^[\w .,;:()'-]+$/.test(String(E.by) + String(E.why)) && !/\d{15,}/.test(String(E.by) + String(E.why)), 'by and why carry no Discord id', [E.by, E.why]);
// The character's spellbook and prepared spells as saved on 17 Oct: all in the keep list
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
load(LIVE);
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
load(LIVE);
ok(live().length === 0 && calls.length === 0 && out.logs.every((l) => !/staff trims: /.test(l)), 'a later load applies nothing again and starts no timer', out.logs.filter((l) => /trim/.test(l)));
ok(ACTORS.get(GM).learned.has(idOf(REMOVE[0])), '...and a spell learned again later stays');

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
