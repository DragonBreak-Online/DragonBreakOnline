// A hold's seat held by its ruler cannot be revoked by anyone below the ruler (Nat, 7 Nov: "A Steward can revoke
// ownership", Misfit_Panda and Celaewyn). A Steward manages the hold's property, the seat included, but taking the seat
// from the Jarl who holds it by office is the Jarl's own decision. Bundles housingSystem.ts with esbuild and drives
// doRevoke on a stub, with the seat list in gamemode-config.json housingPlaces.seats as live has it.
//
//   node tests/housing-seat-revoke-harness.js     (HOUSING_ROOT=<another skymp5-server> tests that tree instead)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(process.env.HOUSING_ROOT || path.join(__dirname, '..'));
const esbuild = require(path.join(__dirname, '..', 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-seatrevoke-'));
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

(async () => {
  await esbuild.build({ entryPoints: [path.join(root, 'ts', 'systems', 'housingSystem.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'housing.js'), logLevel: 'error' });
  const { HousingSystem } = require(path.join(out, 'housing.js'));
  process.chdir(out);
  fs.writeFileSync('gamemode-config.json', JSON.stringify({ housingPlaces: { seats: { windhelm: ['c0e2c:Skyrim.esm'] } } }));
  const PALACE = 0xc0e2c, HOUSE = 0x1000;
  const JARL = 70, STEWARD = 71, CITIZEN = 72, STAFF = 73;
  const ACTOR = { [JARL]: 0xff000141, [STEWARD]: 0xff000142, [CITIZEN]: 0xff000143, [STAFF]: 0xff000144 };
  const PROFILE = Object.fromEntries(Object.entries(ACTOR).map(([p, a]) => [a, Number(p)]));
  const ranks = { windhelm: { [JARL]: 'jarl', [STEWARD]: 'steward' } };
  const sys = new HousingSystem(() => {});
  const mp = { getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) >>> 0, get: () => undefined };
  const ctx = { svr: mp };
  sys.zones = { all: [], rankOf: (p, z) => (ranks[z] || {})[p] || null };
  sys.holdRanks = () => [];
  sys.profileOf = (_c, a) => PROFILE[a >>> 0] || -1;
  sys.isStaffOverride = (_c, a) => (a >>> 0) === ACTOR[STAFF];
  const notices = [];
  const released = [];
  sys.notice = (_c, _u, text) => notices.push(text);
  sys.sendMenu = () => {};
  sys.release = (_c, primary) => { released.push(primary); return true; };
  const rec = (owner) => ({ owner, ownerChar: ACTOR[owner], ownerName: 'Owner' });
  const revoke = (actorP, primary, owner) => { notices.length = 0; released.length = 0; sys.doRevoke(ctx, 1, ACTOR[actorP], primary, rec(owner), true); return { said: notices[0] || '', released: released.length > 0 }; };

  let r = revoke(STEWARD, PALACE, JARL);
  check('a Steward cannot revoke the seat the Jarl holds', !r.released && /only the ruler can give it up/.test(r.said), r);
  r = revoke(JARL, PALACE, JARL);
  check('the Jarl can', r.released && /Taken back/.test(r.said), r);
  r = revoke(STAFF, PALACE, JARL);
  check('staff can, as for any property', r.released, r);
  r = revoke(STEWARD, PALACE, CITIZEN);
  check('a seat someone else holds (not the ruler) is still the Steward\'s to take back', r.released, r);
  r = revoke(STEWARD, HOUSE, JARL);
  check('an ordinary house of the Jarl is not a seat: the Steward can revoke it as before', r.released, r);

  console.log(failures ? `\n${failures} failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL crashed', e); process.exit(1); });
