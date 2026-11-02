// Scripted test for a hold's seat outside the one-building cap (the Leader, 2 Nov, after fac-0498: Windhelm's Jarl, whose
// account holds other houses, could not take the Palace of Kings back after giving it up). gamemode-config.json
// housingPlaces.seats names each hold's seat doors; the hold's ruler (jarl, count, chieftain..., not a steward) holds it by
// office, so it neither counts toward their cap nor is refused by it. Bundles housingSystem.ts with esbuild and drives
// overCap and countPlaces on a stub.
//
//   node tests/housing-hold-seat-harness.js        (HOUSING_ROOT=<another skymp5-server> tests that tree instead)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(process.env.HOUSING_ROOT || path.join(__dirname, '..'));
const esbuild = require(path.join(__dirname, '..', 'node_modules', 'esbuild'));
const base = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
const out = fs.mkdtempSync(path.join(base, 'claude-nate-holdseat-'));
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

(async () => {
  await esbuild.build({ entryPoints: [path.join(root, 'ts', 'systems', 'housingSystem.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'housing.js'), logLevel: 'error' });
  const { HousingSystem } = require(path.join(out, 'housing.js'));
  process.chdir(out);
  const PALACE = 0xc0e2c, PALACE_OUT = 0x5929, HOUSE = 0x1000, HOUSE2 = 0x2000, OTHER_SEAT = 0x16707;
  const config = (seats) => fs.writeFileSync('gamemode-config.json', JSON.stringify({ housingPlaces: { seats } }));
  config({ _comment: 'test', windhelm: ['c0e2c:Skyrim.esm'], whiterun: ['16707:Skyrim.esm'] });
  const JARL = 70, STEWARD = 71, OTHER_JARL = 72;
  const ACTOR = { [JARL]: 0xff000141, [STEWARD]: 0xff000142, [OTHER_JARL]: 0xff000143 };
  let ranks = { windhelm: { [JARL]: 'jarl', [STEWARD]: 'steward' }, whiterun: { [OTHER_JARL]: 'jarl' } };
  let boundTo = {};   // zone -> profile -> the character the office is bound to
  const logs = [];
  const sys = new HousingSystem((m) => logs.push(String(m)));
  const recs = new Map();
  const mp = {
    getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) >>> 0,
    get: () => undefined,
  };
  const ctx = { svr: mp };
  sys.zones = {
    all: [],
    rankOf: (p, z, a) => { const r = (ranks[z] || {})[p] || null; const b = (boundTo[z] || {})[p]; return r && a && b && b !== a ? null : r; },
  };
  sys.placesOn = () => true; sys.isStaff = () => false; sys.uncappedProfiles = () => new Set();
  sys.read = (_c, ref) => recs.get(ref) || null;
  sys.ownsAs = (rec, p) => rec.owner === p;
  sys.isBuilding = () => true;
  sys.ownerCharOf = (rec) => rec.ownerChar || 0;
  sys.hallExempt = () => false; sys.notHome = () => false; sys.fiefHolderOf = () => null;
  sys.partnerOf = (_c, r) => ({ [PALACE]: PALACE_OUT, [PALACE_OUT]: PALACE })[r] || 0;
  sys.primaryOf = (_c, r) => (r === PALACE_OUT ? PALACE : r);
  sys.perCharacter = false; sys.placeCap = 1;
  const own = (ref, p) => recs.set(ref, { owner: p, ownerChar: ACTOR[p] });
  const reset = () => { recs.clear(); sys.claimed = []; sys.seatDoors = null; };
  const claim = (ref, p) => { if (!sys.claimed.includes(ref)) sys.claimed.push(ref); own(ref, p); };
  const capFor = (p, primary) => sys.overCap(ctx, p, ACTOR[p], true, true, primary);

  // The Jarl owns a house; the palace is claimed back over the cap
  reset(); claim(HOUSE, JARL);
  check('the Jarl, holding a house, may take the palace back: it is held by office', capFor(JARL, PALACE) === '', capFor(JARL, PALACE));
  check('...from either side of its door', capFor(JARL, PALACE_OUT) === '', capFor(JARL, PALACE_OUT));
  check('...but another house is still refused', /already hold/.test(capFor(JARL, HOUSE2)), capFor(JARL, HOUSE2));

  // Holding the palace, the Jarl may still claim a house of their own
  reset(); claim(PALACE, JARL);
  check('the palace does not count toward the Jarl\'s cap', sys.countPlaces(ctx, JARL, ACTOR[JARL]) === 0 && capFor(JARL, HOUSE) === '', [sys.countPlaces(ctx, JARL, ACTOR[JARL]), capFor(JARL, HOUSE)]);

  // Only the hold's ruler
  reset(); claim(HOUSE, STEWARD);
  check('a steward holds no seat by office: refused over the cap', /already hold/.test(capFor(STEWARD, PALACE)), capFor(STEWARD, PALACE));
  reset(); claim(HOUSE, OTHER_JARL);
  check('another hold\'s Jarl is refused at this seat', /already hold/.test(capFor(OTHER_JARL, PALACE)), capFor(OTHER_JARL, PALACE));
  check('...and exempt at their own', capFor(OTHER_JARL, OTHER_SEAT) === '', capFor(OTHER_JARL, OTHER_SEAT));

  // An office bound to another character of the account
  reset(); claim(HOUSE, JARL); boundTo = { windhelm: { [JARL]: 0xff000999 } };
  check('the account\'s other character, not the bound Jarl, is refused', /already hold/.test(capFor(JARL, PALACE)), capFor(JARL, PALACE));
  boundTo = {};

  // A door not on the list, and a missing or changed config
  reset(); claim(HOUSE, JARL);
  check('a building not listed as a seat is no seat', /already hold/.test(capFor(JARL, 0x7777)), capFor(JARL, 0x7777));
  config({ windhelm: [] }); const t = Date.now() / 1000 + 5; fs.utimesSync('gamemode-config.json', t, t);
  check('the list is read again when the file changes', /already hold/.test(capFor(JARL, PALACE)), capFor(JARL, PALACE));
  config({ windhelm: ['zz:Nowhere.esp'] }); mp.getIdFromDesc = () => 0; fs.utimesSync('gamemode-config.json', t + 5, t + 5);
  check('a listed door not in the load order is logged and ignored', /already hold/.test(capFor(JARL, PALACE)) && logs.some((l) => /housingPlaces\.seats: windhelm door zz:Nowhere\.esp is not in the load order/.test(l)), logs.slice(-2));

  console.log(failures ? `\n${failures} failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL crashed', e); process.exit(1); });
