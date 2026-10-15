// Snow Elf and Goblin gifts (racial.js, 13 Oct): the DLE races resolve from config snowElfRace / goblinRace, get their gifts
// and powers with the overhaul on, and the creator override names them
const path = require('path');
const SERVER = path.join(__dirname, '..');
let failed = 0;
const check = (name, ok, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra))); if (!ok) failed++; };
const SNOW = 0x481ac9ff, SNOWV = 0x481aca00, GOB = 0x481aca01, SWAMP = 0x481aca09;
const descs = { '1ac9ff:DragonBreak Online Edits.esp': SNOW, '1aca00:DragonBreak Online Edits.esp': SNOWV, '1aca01:DragonBreak Online Edits.esp': GOB, '1aca09:DragonBreak Online Edits.esp': SWAMP };
const RACE = { record: { type: 'RACE', fields: [] } };
const records = { [SNOW]: RACE, [SNOWV]: RACE, [GOB]: RACE, [SWAMP]: RACE };
const state = { 1: { race: SNOW }, 2: { race: GOB }, 3: { race: SWAMP } };
const mp = {
  get: (id, k) => { const s = state[id] || {}; if (k === 'appearance') return s.race ? { raceId: s.race } : null; return (s.props || {})[k]; },
  set: (id, k, v) => { state[id] = state[id] || {}; state[id].props = state[id].props || {}; state[id].props[k] = v; },
  getIdFromDesc: (d) => descs[d] || 0,
};
const cfg = { racial: { enabled: true, overhaul: true }, snowElfRace: { race: '1ac9ff:DragonBreak Online Edits.esp', vampire: '1aca00:DragonBreak Online Edits.esp' }, goblinRace: { race: '1aca01:DragonBreak Online Edits.esp', variants: { goblinswamp: '1aca09:DragonBreak Online Edits.esp' } } };
const R = require(path.join(SERVER, 'racial.js'))({ mp, log: () => {}, personal: () => {}, display: String, recordOf: (id) => records[id >>> 0] || null,
  giveItem: () => true, profileOf: (a) => (a < 1000 ? a : -1), every: () => {}, onlineActors: () => [1, 2],
  weaponHandsOf: () => '', sourceResistsOf: () => new Set(), cfg });
check('the creator overrides name both races', globalThis.__dboRaceOverrides.snowelf === SNOW && globalThis.__dboRaceOverrides.goblin === GOB, globalThis.__dboRaceOverrides);
check('a Snow Elf is a snowelf', R.raceOf(1) === 'snowelf', R.raceOf(1));
check('a Goblin is a goblin', R.raceOf(2) === 'goblin', R.raceOf(2));
check('a Swamp goblin is a goblin, and its slug names its race', R.raceOf(3) === 'goblin' && globalThis.__dboRaceOverrides.goblinswamp === SWAMP && globalThis.__dboGoblinRaces.includes(SWAMP), globalThis.__dboRaceOverrides);
const pv = R.powerView(1);
check('the Snow Elf power is Glacier Fall', pv && pv.name === 'Glacier Fall', pv);
check('the Goblin power is Feeding Frenzy', (R.powerView(2) || {}).name === 'Feeding Frenzy', R.powerView(2));
check('Snow Elf arcane and defense x1.15', Math.abs(R.skillRate(1, 'arcane', 'hit') - 1.15) < 1e-9 && Math.abs(R.skillRate(1, 'defense', 'hit') - 1.15) < 1e-9);
check('Goblin harvesting x1.15', Math.abs(R.skillRate(2, 'harvesting', 'hit') - 1.15) < 1e-9);
const parts = new Map(); globalThis.__dboRegisterStatus = (k, o, fn) => parts.set(k, fn);
const R2 = require(path.join(SERVER, 'racial.js'))({ mp, log: () => {}, personal: () => {}, display: String, recordOf: (id) => records[id >>> 0] || null,
  giveItem: () => true, profileOf: (a) => (a < 1000 ? a : -1), every: () => {}, onlineActors: () => [1, 2],
  weaponHandsOf: () => '', sourceResistsOf: () => new Set(), cfg });
const line = (a) => parts.get('racialGifts')(a);
console.log('  snow elf:', line(1)); console.log('  goblin:', line(2));
check('the Snow Elf gifts line', line(1) === 'Snow Elf: 50% frost resistance, +15% Arcane XP, +15% Defence XP', line(1));
check('the Goblin gifts line', line(2) === 'Goblin: 50% poison resistance, +10% gold from loot and contracts, +15% Gatherer XP', line(2));
console.log(failed ? `\n${failed} failed` : '\nall passed'); process.exit(failed ? 1 : 0);
