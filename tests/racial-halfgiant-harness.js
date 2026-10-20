// The Half-Giant (racial.js, 20 Oct; Nate approved PC Worker C's plan): the DLE's DBOHalfGiantRace and its vampire resolve from
// config halfGiantRace, get the Half-Giant's gifts with the overhaul on (the Nord's without), the creator's halfgiant slug is
// overridden to it, the appetite and the +50 health reach gamemode.js and charlevel.js, and the other modules know the pair.
//   node tests/racial-halfgiant-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const SERVER = path.join(__dirname, '..');
let failed = 0;
const check = (name, ok, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra))); if (!ok) failed++; };
const near = (a, b) => Math.abs(a - b) < 1e-9;

const live = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));
check('config halfGiantRace names the DLE pair', live.halfGiantRace && live.halfGiantRace.race === '1d201b:DragonBreak Online Edits.esp'
  && live.halfGiantRace.vampire === '1d201c:DragonBreak Online Edits.esp', live.halfGiantRace);

const HG = 0x491d201b, HGV = 0x491d201c, NORD = 0x13746;
const FROST_SRC = 0x300, SWORD = 0x400;
const descs = { '1d201b:DragonBreak Online Edits.esp': HG, '1d201c:DragonBreak Online Edits.esp': HGV };
const RACE = { record: { type: 'RACE', fields: [] } };
const records = { [HG]: RACE, [HGV]: RACE, [FROST_SRC]: { record: { type: 'SPEL', fields: [] } }, [SWORD]: { record: { type: 'WEAP', fields: [] } } };
const RESISTS = { [FROST_SRC]: new Set([43]) };
// 1 Half-Giant, 2 Half-Giant vampire, 3 a plain Nord
const state = { 1: { race: HG }, 2: { race: HGV }, 3: { race: NORD }, 9: { race: NORD } };
const mp = {
  get: (id, k) => { const s = state[id] || {}; if (k === 'appearance') return s.race ? { raceId: s.race } : null; if (k === 'private.rp') return undefined; return (s.props || {})[k]; },
  set: (id, k, v) => { state[id] = state[id] || {}; state[id].props = state[id].props || {}; state[id].props[k] = v; },
  getIdFromDesc: (d) => descs[d] || 0,
};
const parts = new Map(); globalThis.__dboRegisterStatus = (k, o, fn) => parts.set(k, fn);
const load = (racialCfg) => require(path.join(SERVER, 'racial.js'))({ mp, log: () => {}, personal: () => {}, display: String,
  recordOf: (id) => records[id >>> 0] || null, giveItem: () => true, profileOf: (a) => (a < 1000 ? a : -1), every: () => {},
  onlineActors: () => [1, 2, 3], weaponHandsOf: (src) => ((src >>> 0) === SWORD ? 'one' : ''), sourceResistsOf: (src) => RESISTS[src >>> 0] || new Set(),
  cfg: { racial: racialCfg, halfGiantRace: live.halfGiantRace } });
const R = load(Object.assign({}, live.racial, { enabled: true, overhaul: true }));

check('the creator override files the race under the halfgiant slug', globalThis.__dboRaceOverrides.halfgiant === HG, globalThis.__dboRaceOverrides);
check('a Half-Giant is a halfgiant', R.raceOf(1) === 'halfgiant', R.raceOf(1));
check('a Half-Giant vampire is a halfgiant', R.raceOf(2) === 'halfgiant', R.raceOf(2));
check('a Nord stays a nord', R.raceOf(3) === 'nord', R.raceOf(3));

// Frost 25% off, then the bulk's 15% more on everything
check('a frost spell taken x0.75 x1.15', near(R.targetMult(9, 1, FROST_SRC, 10), 0.75 * 1.15), R.targetMult(9, 1, FROST_SRC, 10));
check('a sword blow taken x1.15 (a bigger target)', near(R.targetMult(9, 1, SWORD, 10), 1.15), R.targetMult(9, 1, SWORD, 10));
check('a Nord keeps the Nord frost share and no bulk', near(R.targetMult(9, 3, FROST_SRC, 10), 1 - Number(R.config ? R.config.nord.resistFrost : 0.5)) || R.targetMult(9, 3, FROST_SRC, 10) < 1,
  R.targetMult(9, 3, FROST_SRC, 10));
check('...and a sword blow on a Nord is untouched', near(R.targetMult(9, 3, SWORD, 10), 1), R.targetMult(9, 3, SWORD, 10));
check('Blunt XP x1.15', near(R.skillRate(1, 'blunt', 'hit'), 1.15), R.skillRate(1, 'blunt', 'hit'));

// Appetite and health, read by gamemode.js and charlevel.js
check('appetite x1.5 for a Half-Giant, x1 for a Nord', near(globalThis.__dboRaceHungerMult(1), 1.5) && near(globalThis.__dboRaceHungerMult(3), 1));
check('+50 health for a Half-Giant, none for a Nord', globalThis.__dboRaceVitalBonus(1).health === 50 && globalThis.__dboRaceVitalBonus(3).health === 0);

const pv = R.powerView(1);
check('the power is Titanborn Fury, 60 s', pv && pv.name === 'Titanborn Fury' && pv.seconds === 60, pv);
check('...+25% melee damage, +25% damage taken', pv && pv.buffs && pv.buffs.meleeDamage === 0.25 && pv.buffs.damageTaken === 0.25, pv && pv.buffs);

const line = parts.get('racialGifts')(1);
console.log('  halfgiant:', line);
check('the Racial Gifts line names the costs', /^Half-Giant: /.test(line) && /\+50 health/.test(line) && /15% more damage taken/.test(line) && /hungers 50% faster/.test(line), line);

const R0 = load(Object.assign({}, live.racial, { enabled: true, overhaul: false }));
check('overhaul off: a Half-Giant has the Nord gift', R0.raceOf(1) === 'nord', R0.raceOf(1));

// The creator lock: 150 hours played (playtime.js), like the second character slot
globalThis.__dboEarnedSlots = (pid) => (pid === 7 ? 1 : 0);
globalThis.__dboPlaytimeOf = (pid) => ({ ms: pid === 8 ? 150 * 3600000 : pid === 9 ? 149 * 3600000 : 0, days: 1 });
check('a new account: the Half-Giant is locked', JSON.stringify(globalThis.__dboLockedRacesFor(5)) === '["halfgiant"]');
check('149 hours: still locked', globalThis.__dboLockedRacesFor(9).length === 1);
check('150 hours: open', globalThis.__dboLockedRacesFor(8).length === 0);
check('the playtime slot earned: open', globalThis.__dboLockedRacesFor(7).length === 0);
delete globalThis.__dboPlaytimeOf; delete globalThis.__dboEarnedSlots;
check('playtime off: locked, never open to everyone', globalThis.__dboLockedRacesFor(8).length === 1);

const read = (f) => fs.readFileSync(path.join(SERVER, f), 'utf8');
check('gamemode.js multiplies the appetite by the race', /__dboRaceHungerMult\(a\)/.test(read('gamemode.js')));
check('charlevel.js adds the race bonus to dboAvBonus', /__dboRaceVitalBonus\(a\)/.test(read('charlevel.js')) && /syncBonus\(a, st\)/.test(read('charlevel.js')));
check('supernatural.js turns DBOHalfGiantRace into its vampire and back', /VAMPIRE_RACES\.set\(halfGiantRace\[0\], halfGiantRace\[1\]\)/.test(read('supernatural.js')));
check('appearance.js guards the Half-Giant heads as the Nord\'s', /cfg\.halfGiantRace[\s\S]{0,400}HEADS\.raceOf\.set\(r, 'NordRace'\)/.test(read('appearance.js')));
check('racemenupresets.js keeps a Half-Giant face across a vampire turn', /\['halfGiantRace', 'DBOHalfGiantRace'\]/.test(read('racemenupresets.js')));

console.log(failed ? `\n${failed} failed` : '\nall passed'); process.exit(failed ? 1 : 0);
