// Harness for the Dunmer-only Spider Imbuing Chamber gate (server\spidermancy.js).
//
// It loads the real module against a stub `mp`, so it exercises the shipped code rather than a copy, and it needs no
// server: run it from the server folder with `node tests\spidermancy-gate-harness.js`.
//
// Cases: Dunmer allowed, Dunmer vampire allowed, Nord refused, plus a Nord in a beast form (still refused, because
// beastform.js reports the character's own race) and a Dunmer in a beast form (still allowed), and an activate of
// something that is not the chamber (never touched).
const path = require('path');

const DARK_ELF = 0x00013742;
const DARK_ELF_VAMPIRE = 0x0008883D;
const NORD = 0x00013746;
const WEREWOLF = 0x000CDD84;          // whatever a beast form writes into appearance.raceId; only its presence matters

const CHAMBER_REF = 0x0401c9c2;       // Tel Mithryn's own lever reference
const OTHER_REF = 0x00012345;
const ACTOR = 0xff001234;

let innerCalls = 0;
let told = [];
let raceId = NORD;
let beastOriginal = 0;
// A baseDesc is the LOCAL id plus the plugin name, which is what makes it load-order independent: the server's own
// audit lines read "9a9:DragonBreak.esp" and "1445e:Dragonborn.esm".
let baseDescOf = { [CHAMBER_REF]: '1705f:Dragonborn.esm', [OTHER_REF]: '3ad5f:Skyrim.esm' };

const mp = {
  getIdFromDesc: (desc) => {
    const map = { '13742:skyrim.esm': DARK_ELF, '8883d:skyrim.esm': DARK_ELF_VAMPIRE };
    const id = map[String(desc).toLowerCase()];
    if (!id) throw new Error('unknown desc ' + desc);
    return id;
  },
  get: (id, prop) => {
    if (prop === 'baseDesc') return baseDescOf[id >>> 0] || '';
    if (prop === 'appearance') return { raceId, name: 'Test' };
    if (prop === 'profileId') return 1;
    return null;
  },
  onActivate: function () { innerCalls++; return true; },
};
const log = () => { };
const personal = (a, text) => told.push(text);

require(path.resolve(__dirname, '..', 'spidermancy.js'))({ mp, log, personal });

let failures = 0;
const check = (name, { race, beast = 0, ref = CHAMBER_REF, expectAllowed }) => {
  raceId = race; beastOriginal = beast;
  globalThis.__dboBeastOriginalRace = beast ? () => beast : undefined;
  innerCalls = 0; told = [];
  const verdict = mp.onActivate(ref, ACTOR);
  // Allowed means the chain continued (the inner handler ran) and nothing was said to the player
  const allowed = verdict !== false && innerCalls === 1;
  const ok = allowed === expectAllowed;
  if (!ok) failures++;
  console.log('%s  %s  verdict=%s inner=%d told=%s',
    ok ? 'ok  ' : 'FAIL', name.padEnd(46), String(verdict), innerCalls,
    told.length ? JSON.stringify(told[0]) : 'nothing');
};

console.log('Spider Imbuing Chamber, Dunmer only\n');
check('Dunmer uses the chamber', { race: DARK_ELF, expectAllowed: true });
check('Dunmer vampire uses the chamber', { race: DARK_ELF_VAMPIRE, expectAllowed: true });
check('Nord is refused', { race: NORD, expectAllowed: false });
check('Nord in a beast form is still refused', { race: WEREWOLF, beast: NORD, expectAllowed: false });
check('Dunmer in a beast form is still allowed', { race: WEREWOLF, beast: DARK_ELF, expectAllowed: true });
check('a Nord activating something else is untouched', { race: NORD, ref: OTHER_REF, expectAllowed: true });

console.log('\n%s', failures ? `FAILED: ${failures} case(s)` : 'all cases passed');
process.exit(failures ? 1 : 0);
