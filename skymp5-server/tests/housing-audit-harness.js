// Scripted test: every property request and every gameplay grant or release writes one [housing] AUDIT line, whoever asks
// (Telvanni house, 24 Oct: a Steward's release and rename of a player's house left nothing in the log, because only staff
// overrides were logged). Bundles housingSystem.ts with esbuild on a fake mp whose refs keep their properties in a Map.
//
//   node tests/housing-audit-harness.js            (HOUSING_ROOT=<another skymp5-server> tests that tree instead)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(process.env.HOUSING_ROOT || path.join(__dirname, '..'));
const esbuild = require(path.join(__dirname, '..', 'node_modules', 'esbuild'));
const base = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
const out = fs.mkdtempSync(path.join(base, 'claude-nate-housingaudit-'));
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

(async () => {
  await esbuild.build({ entryPoints: [path.join(root, 'ts', 'systems', 'housingSystem.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'housing.js'), logLevel: 'error' });
  const { HousingSystem } = require(path.join(out, 'housing.js'));
  const HOUSE = 0x08000ef7, OWNER = 0xff000101, STEWARD = 0xff0017ea, STRANGER = 0xff000ccc;
  const USER = { [OWNER]: 1, [STEWARD]: 2, [STRANGER]: 3 };
  const props = new Map();
  const at = (id) => { if (!props.has(id)) props.set(id, {}); return props.get(id); };
  at(OWNER).profileId = 101; at(OWNER).appearance = { name: 'Raven The Shield' };
  at(STEWARD).profileId = 150; at(STEWARD).appearance = { name: 'Carloft Fhang' };
  at(STRANGER).profileId = 77; at(STRANGER).appearance = { name: 'Passer By' };
  at(HOUSE)['private.housing'] = { owner: 101, ownerChar: OWNER, ownerName: 'Raven The Shield', name: 'House Telvanni', locked: true, serial: 3, partner: 0, containers: [], issued: [] };
  const mp = {
    get: (id, k) => at(id >>> 0)[k], set: (id, k, v) => { at(id >>> 0)[k] = JSON.parse(JSON.stringify(v)); },
    getActorsByProfileId: () => [], getUserByActor: (a) => USER[a] ?? -1,
    getUserActor: (u) => Number(Object.keys(USER).find((a) => USER[a] === u)) || 0,
    isConnected: () => true, sendCustomPacket: () => { },
  };
  const ctx = { svr: mp };
  const lines = [];
  const sys = new HousingSystem((...a) => lines.push(a.join(' ')));
  // The world around the house: near enough, in Bruma, the Steward is the hold's official; nothing else of the world matters
  sys.nearProperty = () => true;
  sys.primaryOf = (c, ref) => (ref >>> 0);
  sys.partnerOf = () => 0;
  sys.holdOf = () => 'bruma';
  sys.holdRanks = (c, a) => (a === STEWARD ? [{ hold: 'bruma', rank: 'steward' }] : []);
  sys.isAdmin = () => false;
  sys.reKey = (c, p, rec) => { rec.serial = (Number(rec.serial) || 1) + 1; };
  sys.freezeKeyNames = () => { };
  sys.sendMenu = () => { };
  sys.send = () => { };
  const ask = (actor, action, extra = {}) => {
    sys.lastRequestMs.clear();
    lines.length = 0;
    sys.onPropertyRequest(ctx, USER[actor], { target: HOUSE, action, ...extra });
    return lines.filter((l) => l.startsWith('[housing] AUDIT'));
  };

  let a = ask(STEWARD, 'rename', { name: 'Condemened' });
  check('an official\'s rename of someone\'s house is one AUDIT line', a.length === 1, lines);
  check('...naming the actor, profile and role', /by Carloft Fhang \(actor ff0017ea, profile 150, official\)/.test(a[0] || ''), a[0]);
  check('...the property and the old and new name', /AUDIT rename 8000ef7 /.test(a[0] || '') && /name "House Telvanni" -> "Condemened"; changed$/.test(a[0] || ''), a[0]);
  check('...and the owner, unchanged', /owner profile 101 character ff000101 "Raven The Shield" -> profile 101 character ff000101 "Raven The Shield"/.test(a[0] || ''), a[0]);

  a = ask(STRANGER, 'revoke');
  check('a refused revoke by someone with no right is logged too, as no change', a.length === 1 && /\(actor ff000ccc, profile 77, other\)/.test(a[0]) && /; no change$/.test(a[0]), a);

  a = ask(STEWARD, 'revoke');
  check('the official\'s revoke logs the owner going to nobody, and the name cleared', a.length === 1
    && /AUDIT revoke 8000ef7 by Carloft Fhang .*official.*owner profile 101 character ff000101 "Raven The Shield" -> nobody, name "Condemened" -> none/.test(a[0]), a[0]);
  check('...the lock and the key serial it changed', /, unlocked, key serial 3 -> 4; changed$/.test(a[0] || ''), a[0]);
  check('...and the house is really free', (props.get(HOUSE)['private.housing'] || {}).owner === 0);

  // The gameplay's grant and release (gamemode.js staff /grant, guilds.js halls)
  sys.exposeTenancy(ctx);
  const H = globalThis.__dboHousing;
  lines.length = 0;
  check('the gameplay grants it back', H.grant(HOUSE, OWNER) === '', lines);
  a = lines.filter((l) => l.startsWith('[housing] AUDIT'));
  check('...with an AUDIT grant line naming who it went to', a.length === 1 && /AUDIT grant 8000ef7 by the gameplay, to Raven The Shield \(actor ff000101, profile 101\): owner nobody -> profile 101/.test(a[0]), a);

  a = ask(OWNER, 'lock');
  check('the owner\'s own lock is logged with the owner role', a.length === 1 && /\(actor ff000101, profile 101, owner\)/.test(a[0]) && /, locked; changed$/.test(a[0]), a);

  lines.length = 0;
  H.release(HOUSE);
  a = lines.filter((l) => l.startsWith('[housing] AUDIT'));
  check('the gameplay\'s release is logged too', a.length === 1 && /AUDIT release 8000ef7 by the gameplay: owner profile 101 .* -> nobody/.test(a[0]), a);

  globalThis.__dboHousing = undefined;
  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
