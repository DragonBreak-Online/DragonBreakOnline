// The property menu marks loose storage (Nat, 7 Nov: Winterhold urns and barrels): a chest, barrel or urn is handed over with
// Grant this container, never rented or sold, so propertyMenu carries container: true for a CONT and the front hides its
// market button. Bundles housingSystem.ts with esbuild and drives sendMenu on a stub. Run it from skymp5-server:
//
//   node tests/housing-container-flag-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-contflag-'));
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

(async () => {
  await esbuild.build({ entryPoints: [path.join(root, 'ts', 'systems', 'housingSystem.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'housing.js'), logLevel: 'error' });
  const { HousingSystem } = require(path.join(out, 'housing.js'));
  process.chdir(out);
  const CHEST = 0x100, DOOR = 0x200, OWNER = 0xff000014, OTHER = 0xff000015, USER = 3;
  const PROFILE = { [OWNER]: 55, [OTHER]: 66 };
  const recs = {
    [CHEST]: { owner: 55, ownerChar: OWNER, ownerName: 'Harbard', name: null, locked: true, serial: 1, partner: 0, containers: [], issued: [] },
    [DOOR]: { owner: 55, ownerChar: OWNER, ownerName: 'Harbard', name: null, locked: false, serial: 1, partner: 0x201, containers: [], issued: [] },
  };
  const sent = [];
  const sys = new HousingSystem(() => {});
  const ctx = { svr: { get: () => undefined } };
  sys.placesOn = () => false;
  sys.primaryOf = (_c, id) => (recs[id] ? id : 0);
  sys.read = (_c, id) => recs[id] || null;
  sys.baseTypeOf = (_c, id) => (id === CHEST ? 'CONT' : id === DOOR ? 'DOOR' : '');
  sys.profileOf = (_c, a) => PROFILE[a >>> 0] || 0;
  sys.isManager = () => false;
  sys.isLockFixer = () => false;
  sys.hasAccess = () => false;
  sys.leadsHall = () => false;
  sys.sharesByOffice = () => false;
  sys.send = (_c, _u, msg) => sent.push(msg);
  const menu = (actor, target) => { sent.length = 0; sys.sendMenu(ctx, USER, actor, target); return sent[0] || {}; };

  let m = menu(OTHER, CHEST);
  check('a chest someone else owns is marked as a container', m.customPacketType === 'propertyMenu' && m.container === true, m);
  m = menu(OWNER, CHEST);
  check('so is the owner\'s own chest', m.container === true && m.canGrantContainers === true, m);
  m = menu(OTHER, DOOR);
  check('a door is not', m.customPacketType === 'propertyMenu' && !m.container, m);

  console.log(failures ? `\n${failures} failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL crashed', e); process.exit(1); });
