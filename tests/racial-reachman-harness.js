// The Reachman (racial.js, 15 Oct; PROPOSED numbers, waiting on Nate): the DLE's DBOReachmanRace and its vampire resolve
// from config reachmanRace, get the Reachman's gifts with the overhaul on, the creator's reachfolk slug is overridden to it,
// a Reachfolk made on the Breton record counts as one, and supernatural.js, appearance.js and racemenupresets.js know the pair.
//   node tests/racial-reachman-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const SERVER = path.join(__dirname, '..');
let failed = 0;
const check = (name, ok, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || extra === undefined ? '' : '  ' + JSON.stringify(extra))); if (!ok) failed++; };
const near = (a, b) => Math.abs(a - b) < 1e-9;

// The live config's blocks, so the harness checks what would ship
const live = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));
check('config reachmanRace names the DLE pair', live.reachmanRace && live.reachmanRace.race === '1c8981:DragonBreak Online Edits.esp'
  && live.reachmanRace.vampire === '1c8982:DragonBreak Online Edits.esp', live.reachmanRace);

// The new order puts the DLE at 0x48 (README section 6)
const REACH = 0x481c8981, REACHV = 0x481c8982, BRETON = 0x13741, BRETONV = 0x8883c;
const POISON_SRC = 0x100, MAGIC_SRC = 0x200, FROST_SRC = 0x300, SWORD = 0x400;
const descs = { '1c8981:DragonBreak Online Edits.esp': REACH, '1c8982:DragonBreak Online Edits.esp': REACHV };
const RACE = { record: { type: 'RACE', fields: [] } };
const records = { [REACH]: RACE, [REACHV]: RACE, [MAGIC_SRC]: { record: { type: 'SPEL', fields: [] } }, [POISON_SRC]: { record: { type: 'ALCH', fields: [] } },
  [FROST_SRC]: { record: { type: 'SPEL', fields: [] } }, [SWORD]: { record: { type: 'WEAP', fields: [] } } };
const RESISTS = { [POISON_SRC]: new Set([40]), [MAGIC_SRC]: new Set([44]), [FROST_SRC]: new Set([43]) };
// 1 Reachman, 2 Reachman vampire, 3 Reachfolk made in the creator on the Breton record, 4 a plain Breton, 5 a Breton vampire Reachfolk
const state = { 1: { race: REACH }, 2: { race: REACHV }, 3: { race: BRETON, rp: 'reachfolk' }, 4: { race: BRETON }, 5: { race: BRETONV, rp: 'reachfolk' }, 9: { race: BRETON } };
const mp = {
  get: (id, k) => {
    const s = state[id] || {};
    if (k === 'appearance') return s.race ? { raceId: s.race } : null;
    if (k === 'private.rp') return s.rp ? { race: s.rp } : undefined;
    return (s.props || {})[k];
  },
  set: (id, k, v) => { state[id] = state[id] || {}; state[id].props = state[id].props || {}; state[id].props[k] = v; },
  getIdFromDesc: (d) => descs[d] || 0,
};
const parts = new Map(); globalThis.__dboRegisterStatus = (k, o, fn) => parts.set(k, fn);
const load = (racialCfg) => require(path.join(SERVER, 'racial.js'))({ mp, log: () => {}, personal: () => {}, display: String,
  recordOf: (id) => records[id >>> 0] || null, giveItem: () => true, profileOf: (a) => (a < 1000 ? a : -1), every: () => {},
  onlineActors: () => [1, 2, 3, 4], weaponHandsOf: (src) => ((src >>> 0) === SWORD ? 'one' : ''), sourceResistsOf: (src) => RESISTS[src >>> 0] || new Set(),
  cfg: { racial: racialCfg, reachmanRace: live.reachmanRace } });
// The shipped racial block, enabled with the overhaul as live has it
const R = load(Object.assign({}, live.racial, { enabled: true, overhaul: true }));

check('the creator override files the race under the reachfolk slug', globalThis.__dboRaceOverrides.reachfolk === REACH, globalThis.__dboRaceOverrides);
check('a Reachman is a reachman', R.raceOf(1) === 'reachman', R.raceOf(1));
check('a Reachman vampire is a reachman', R.raceOf(2) === 'reachman', R.raceOf(2));
check('a Reachfolk on the Breton record is a reachman', R.raceOf(3) === 'reachman', R.raceOf(3));
check('...and on the Breton vampire record too', R.raceOf(5) === 'reachman', R.raceOf(5));
check('a plain Breton stays a breton', R.raceOf(4) === 'breton', R.raceOf(4));

// Mongrel Blood: 25% off poison, 15% off magic, nothing off frost damage that is not magic, nothing off a sword
check('poison taken x0.75', near(R.targetMult(9, 1, POISON_SRC, 10), 0.75), R.targetMult(9, 1, POISON_SRC, 10));
check('a spell taken x0.85 (magic resistance)', near(R.targetMult(9, 1, MAGIC_SRC, 10), 0.85), R.targetMult(9, 1, MAGIC_SRC, 10));
check('a frost spell: only the magic share, no frost share', near(R.targetMult(9, 1, FROST_SRC, 10), 0.85), R.targetMult(9, 1, FROST_SRC, 10));
check('a sword blow is untouched', near(R.targetMult(9, 1, SWORD, 10), 1), R.targetMult(9, 1, SWORD, 10));
check('a Breton keeps the Breton 25% magic share', near(R.targetMult(9, 4, MAGIC_SRC, 10), 0.75), R.targetMult(9, 4, MAGIC_SRC, 10));

// One +15% XP skill
check('Alchemist XP x1.15', near(R.skillRate(1, 'alchemist', 'hit'), 1.15), R.skillRate(1, 'alchemist', 'hit'));
check('...and no other skill', near(R.skillRate(1, 'arcane', 'hit'), 1) && near(R.skillRate(1, 'priest', 'hit'), 1));
check('a staff award is never boosted', near(R.skillRate(1, 'alchemist', 'award'), 1));

// One Racial Power a real day
const pv = R.powerView(1);
check('the power is Fury of the Reach, 60 s', pv && pv.name === 'Fury of the Reach' && pv.seconds === 60, pv);
check('...with the stamina and magicka regeneration buffs', pv && pv.buffs && pv.buffs.staminaRegen === 1.5 && pv.buffs.magickaRegen === 1.5, pv && pv.buffs);
check('...ready, not a client-only power', pv && pv.ready === true && pv.clientOnly === false, pv);
const used = R.usePower(1);
check('using it works', used && used.ok === true, used);
check('while it runs, stamina and magicka regenerate x1.5 and health is untouched', near(R.regenFactor(1, 'stamina'), 1.5) && near(R.regenFactor(1, 'magicka'), 1.5)
  && near(R.regenFactor(1, 'health'), 1), [R.regenFactor(1, 'stamina'), R.regenFactor(1, 'magicka'), R.regenFactor(1, 'health')]);
const again = R.usePower(1);
check('...and it waits a day before the next use', again && again.ok === false && /h/.test(String(again.text)), again);

// The Journal's Racial Gifts line
const line = parts.get('racialGifts')(1);
console.log('  reachman:', line);
check('the Racial Gifts line', line === 'Reachman: 25% poison resistance, 15% magic resistance, +15% Alchemy XP', line);

// Without the overhaul a Reachman has the Breton's gift (its morph race), and a Reachfolk on the Breton record is a Breton
const R0 = load(Object.assign({}, live.racial, { enabled: true, overhaul: false }));
check('overhaul off: a Reachman has the Breton gift', R0.raceOf(1) === 'breton', R0.raceOf(1));
check('overhaul off: a Reachfolk on the Breton record is a Breton', R0.raceOf(3) === 'breton', R0.raceOf(3));
check('overhaul off: no Alchemist boost', near(R0.skillRate(1, 'alchemist', 'hit'), 1));

// The other modules read the same config pair (source checks: each needs a whole server to load)
const read = (f) => fs.readFileSync(path.join(SERVER, f), 'utf8');
const sup = read('supernatural.js');
check('supernatural.js turns DBOReachmanRace into its vampire and back', /cfg\.reachmanRace/.test(sup)
  && /VAMPIRE_RACES\.set\(reachmanRace\[0\], reachmanRace\[1\]\); MORTAL_RACES\.set\(reachmanRace\[1\], reachmanRace\[0\]\)/.test(sup));
check('...and gives a Reachman the human tells', /FAMILY\.set\(reachmanRace\[0\], 'human'\)/.test(sup));
check('appearance.js guards the Reachman heads as the Breton\'s', /cfg\.reachmanRace[\s\S]{0,400}HEADS\.raceOf\.set\(r, 'BretonRace'\)/.test(read('appearance.js')));
check('racemenupresets.js keeps a Reachman face across a vampire turn', /\['reachmanRace', 'DBOReachmanRace'\]/.test(read('racemenupresets.js')));

console.log(failed ? `\n${failed} failed` : '\nall passed'); process.exit(failed ? 1 : 0);
