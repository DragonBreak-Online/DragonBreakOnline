// No Wheel work from fighting any NPC guard (guards.js isNpcGuard; Nat, 25 Oct: "no xp from hitting or killing guards"):
// the watch's own posts as before, and every other guard by its base's editor id (a Bruma city guard, a vanilla hold guard
// in its Sentinel uniform, a Lilmoth guard), with the real skillrates.js asking __dboWatchNoSkill. A wolf, a bandit
// "guard" of a dungeon, a Redguard bandit, a Dawnguard, a guard dog and a player guard still train as before.
//   node tests/guard-noskill-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));
const NOTES = JSON.parse(fs.readFileSync(path.join(SERVER, 'patch-notes.json'), 'utf8'));
const dir = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-guard-noskill-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* the OS */ } });
let fails = 0;
const ok = (c, t, g) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${t}${c || g === undefined ? '' : '   ' + JSON.stringify(g)}`); if (!c) fails++; };
fs.writeFileSync('NPC-Spawns.json', JSON.stringify({ zones: [] }));

// Real bases (editor ids read from the dev Data plugins, 25 Oct)
const PLUGINS = { 'Skyrim.esm': 0x00, 'Dawnguard.esm': 0x02, 'BSHeartland.esm': 0x08, 'Journey to Baan Malur.esp': 0x30 };
const idOf = (d) => { const [hex, plugin] = String(d).split(':'); if (!(plugin in PLUGINS)) throw new Error(`no plugin ${plugin}`); return ((PLUGINS[plugin] << 24) | parseInt(hex, 16)) >>> 0; };
const BASES = {
  '790de:BSHeartland.esm': 'CYRGuardBrumaEastGate1',          // Bruma's city guard
  'abe18:Skyrim.esm': 'GuardWhiterunHoldImperialGeneric',     // a hold guard (Sentinel - City Guards only re-dresses these)
  '45853:Skyrim.esm': 'GuardRiftenImperialBase',
  'c9b18:BSHeartland.esm': 'CYRSkyrimBorderGateSkyrimSideSentry1', // no "guard" in it: built into noSkillBases
  '13ff04:Journey to Baan Malur.esp': 'SOMRBaanGuardWestGate01',
  '23a90:Skyrim.esm': 'EncCow',                               // any beast
  '3df51:Skyrim.esm': 'LvlBanditMeleeAnyGuard',                 // a dungeon's bandit "guard"
  '3df0b:Skyrim.esm': 'EncBandit06Boss1HRedguardM',           // Redguard is a race, not a guard
  '13ec7:Dawnguard.esm': 'DLC1LvlDawnguardMissile_NoCrime',
  '13:Skyrim.esm': 'GuardDog',                                // a guard dog (no such base in the load order) verify-formids: ignore
  'e662d:Skyrim.esm': 'dunHunterWolfGuardian',
  '882a3:BSHeartland.esm': 'CYRLvlGoblinMeleeGuard',
};
let lookups = 0;
const props = new Map();
const put = (a, p, v) => props.set((a >>> 0) + '|' + p, v);
const mp = {
  getIdFromDesc: idOf, getDescFromId: (id) => (id >>> 0).toString(16),
  get: (a, p) => props.get((a >>> 0) + '|' + p), set: (a, p, v) => put(a, p, v),
  lookupEspmRecordById: (id) => { lookups++; const d = Object.keys(BASES).find((k) => idOf(k) === (id >>> 0)); return d ? { record: { type: 'NPC_', editorId: BASES[d] } } : null; },
  onDeath: () => true,
};
let n = 0x100;
const npc = (base, extra) => { const a = (0xff100000 + n++) >>> 0; put(a, 'profileId', -1); put(a, 'baseDesc', base); for (const [k, v] of Object.entries(extra || {})) put(a, k, v); return a; };
const P1 = 0xff000002;
put(P1, 'profileId', 2); put(P1, 'baseDesc', '7:Skyrim.esm');
const WATCH = npc('6daba:BSHeartland.esm', { 'private.npcSpawner': 'guard:bruma:1' });   // the watch: known by its tag alone
const BRUMA = npc('790de:BSHeartland.esm', { 'private.npcSpawner': 'wild:bruma:0' });
const WHITERUN = npc('abe18:Skyrim.esm');        // plugin-placed or another system's: no spawn tag
const RIFTEN = npc('45853:Skyrim.esm');
const SENTRY = npc('c9b18:BSHeartland.esm');
const BAAN = npc('13ff04:Journey to Baan Malur.esp');
const WOLF = npc('23a90:Skyrim.esm', { 'private.npcSpawner': 'wild:wolf:0' });
const BANDIT_GUARD = npc('3df51:Skyrim.esm', { 'private.npcSpawner': 'dungeon:x:0' });
const REDGUARD = npc('3df0b:Skyrim.esm'), DAWNGUARD = npc('13ec7:Dawnguard.esm'), GUARDIAN = npc('e662d:Skyrim.esm'), GOBLIN = npc('882a3:BSHeartland.esm');
const DOG = npc('13:Skyrim.esm');   // verify-formids: ignore (made up: no guard dog base exists)
const NO_RECORD = npc('999:Skyrim.esm');   // verify-formids: ignore (a base with no record)
const PLAYER_GUARD = 0xff000009; put(PLAYER_GUARD, 'profileId', 9); put(PLAYER_GUARD, 'baseDesc', 'abe18:Skyrim.esm');

const api = (cfg) => ({
  mp, log: () => {}, personal: () => {}, system: () => {}, audit: () => {}, display: (a) => String(a), who: (a) => String(a), cfg,
  registerChatCommand: () => {}, zoneOfActor: () => null, zoneById: () => null,
});
const loadGuards = (guards) => { delete require.cache[path.join(SERVER, 'guards.js')]; delete globalThis.__dboGuardsDeathWrapped; require(path.join(SERVER, 'guards.js'))(api({ guards })); };
const SHIPPED = CONFIG.guards;
loadGuards(SHIPPED);
const noSkill = (k, d) => globalThis.__dboWatchNoSkill(k, d);   // the live hook, as skillrates.js asks it, after any reload
const all3 = (a) => noSkill('hit', { targetId: a, sourceId: 0x12eb7 }) && noSkill('kill', { victimId: a, value: 10 }) && noSkill('hurt', { aggressorId: a, sourceId: 0, value: 5 });
const none3 = (a) => !noSkill('hit', { targetId: a }) && !noSkill('kill', { victimId: a }) && !noSkill('hurt', { aggressorId: a });

ok(SHIPPED.noSkillAnyGuard === true && Array.isArray(SHIPPED.noSkillBases) && Array.isArray(SHIPPED.noSkillExclude), 'config: guards.noSkillAnyGuard on, noSkillBases and noSkillExclude lists', SHIPPED);
ok(all3(WATCH), 'the watch\'s guard (guard:bruma:1 tag): no hit, kill or hurt credit, as before');
ok(all3(BRUMA), 'a Bruma city guard from another zone (CYRGuardBrumaEastGate1): none either');
ok(all3(WHITERUN) && all3(RIFTEN), 'a hold guard with no spawn tag (plugin-placed, Sentinel uniform; GuardWhiterun*, GuardRiften*): none');
ok(all3(SENTRY), 'the Skyrim border gate\'s sentry (built-in noSkillBases): none');
ok(all3(BAAN), 'a Baan Malur city guard (SOMRBaanGuard*): none');
ok(none3(WOLF), 'a beast (EncCow) still trains');
ok(none3(BANDIT_GUARD) && none3(GOBLIN), 'a dungeon bandit "guard" and a goblin "guard" still train (LvlBanditMeleeAnyGuard, CYRLvlGoblinMeleeGuard)');
ok(none3(REDGUARD) && none3(DAWNGUARD) && none3(GUARDIAN), 'Redguard, Dawnguard and Guardian are not guards');
ok(none3(DOG), 'a guard dog still trains');
ok(none3(PLAYER_GUARD), 'a player is never a guard here, even on a guard base');
ok(none3(NO_RECORD) && none3(0) && !noSkill('hit', null) && !noSkill('cast', { targetId: WHITERUN }), 'no record, no actor, no detail, or another kind: counts as before');

// Cached per base: a second guard of the same base, and the same guard again, read no record
const before = lookups;
const WHITERUN2 = npc('abe18:Skyrim.esm');
ok(all3(WHITERUN2) && all3(WHITERUN) && lookups === before, 'one record read per base, never per reference', lookups - before);

// Never throws: a broken mp.get and a broken record read count as "no guard"
const realGet = mp.get, realLookup = mp.lookupEspmRecordById;
mp.get = () => { throw new Error('gone'); };
let threw = false; try { ok(noSkill('hit', { targetId: RIFTEN }) === false, 'an actor whose properties cannot be read is no guard'); } catch (e) { threw = true; }
mp.get = realGet;
loadGuards(SHIPPED);
mp.lookupEspmRecordById = () => { throw new Error('espm'); };
try { ok(globalThis.__dboWatchNoSkill('hit', { targetId: RIFTEN }) === false, 'a base whose record cannot be read is no guard'); } catch (e) { threw = true; }
mp.lookupEspmRecordById = realLookup;
ok(!threw, 'the hook never throws');

// Config: exceptions, additions, rollback
loadGuards(Object.assign({}, SHIPPED, { noSkillExclude: ['abe18:Skyrim.esm', 'GuardRiftenImperialBase'] }));   // verify-formids: ignore (two entries)
ok(none3(WHITERUN) && none3(RIFTEN) && all3(BRUMA), 'noSkillExclude takes a base out by desc or by editor id');
loadGuards(Object.assign({}, SHIPPED, { noSkillBases: ['23A90:Skyrim.esm', 'LvlBanditMeleeAnyGuard'] }));   // verify-formids: ignore (upper case on purpose)
ok(all3(WOLF) && all3(BANDIT_GUARD), 'noSkillBases adds a base by desc (any case) or by editor id');
loadGuards(Object.assign({}, SHIPPED, { noSkillAnyGuard: false }));
ok(all3(WATCH) && none3(BRUMA) && none3(WHITERUN), 'ROLLBACK noSkillAnyGuard false: only the watch\'s guards give nothing, as on 23 Oct');

// The real skillrates.js: 0 for a guard, its normal rate otherwise
loadGuards(SHIPPED);
delete require.cache[path.join(SERVER, 'skillrates.js')];
const R = require(path.join(SERVER, 'skillrates.js'))({ log: () => {}, cfg: { skillRates: CONFIG.skillRates }, recordOf: () => null, fieldsOf: () => [], mp });
const PC = 0xff000002;
const rate = (kind, detail, skill) => R.rateFor(PC, skill || 'onehanded', kind, detail);
const normalHit = rate('hit', { targetId: WOLF, sourceId: 0x12eb7 });
ok(normalHit > 0, 'skillrates: a hit on a wolf trains at its normal rate', normalHit);
ok(rate('hit', { targetId: BRUMA, sourceId: 0x12eb7 }) === 0 && rate('kill', { victimId: WHITERUN, value: 10 }) === 0 && rate('hurt', { aggressorId: RIFTEN, value: 5 }, 'defense') === 0,
  'skillrates: a hit on, a kill of, or a blow from a non-watch guard gives 0');
ok(rate('hit', { targetId: WATCH }) === 0, 'skillrates: the watch\'s guard still gives 0');
ok(rate('hit', { targetId: BANDIT_GUARD }) === normalHit && rate('kill', { victimId: REDGUARD, value: 10 }) === rate('kill', { victimId: WOLF, value: 10 }) && rate('hurt', { aggressorId: DOG, value: 5 }, 'defense') === rate('hurt', { aggressorId: WOLF, value: 5 }, 'defense'),
  'skillrates: a bandit guard, a Redguard, a guard dog train as a wolf does');
const savedHook = globalThis.__dboWatchNoSkill;
globalThis.__dboWatchNoSkill = () => { throw new Error('boom'); };
ok(rate('hit', { targetId: BRUMA }) === normalHit, 'skillrates: a hook that throws never blocks a skill');
globalThis.__dboWatchNoSkill = savedHook;

// Hot reload: guards.js registers no mp.on listener and wraps onDeath once
const GUARDS_SRC = fs.readFileSync(path.join(SERVER, 'guards.js'), 'utf8');
ok(!/\bmp\.on\(/.test(GUARDS_SRC) && /if \(!globalThis\.__dboGuardsDeathWrapped\)/.test(GUARDS_SRC), 'guards.js: no mp.on listeners; onDeath wrapped once (reload safe)');

const NOTE = NOTES.find((x) => x.title === 'Fighting the guard no longer trains your skills');
ok(!!NOTE && (NOTE.date === 'SHIP_DATE' || /^\d{4}-\d{2}-\d{2}$/.test(NOTE.date)) && /guard/i.test(JSON.stringify(NOTE)), 'patch note in patch-notes.json', NOTE);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exitCode = fails ? 1 : 0;
