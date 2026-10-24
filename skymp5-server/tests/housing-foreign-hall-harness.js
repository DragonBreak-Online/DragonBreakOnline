// Scripted test: a faction's hall is never the hold's to manage (Nate, 21 Oct: Castle Volkihar is the vampire faction's,
// "make sure the castle isn't controlled by Solitude"). The gameplay's guilds.js names the faction through
// globalThis.__dboForeignHall(refs); tenancy.js already refused the hold's sale there, but housingSystem.isHoldManager still
// gave Solitude's officials the property menu's manager powers (lock, open, assign) at the castle's doors (24 Oct).
// Bundles housingSystem.ts with esbuild on a fake mp.
//
//   node tests/housing-foreign-hall-harness.js            (HOUSING_ROOT=<another skymp5-server> tests that tree instead)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(process.env.HOUSING_ROOT || path.join(__dirname, '..'));
const esbuild = require(path.join(__dirname, '..', 'node_modules', 'esbuild'));
const base = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
const out = fs.mkdtempSync(path.join(base, 'claude-nate-foreignhall-'));
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

(async () => {
  await esbuild.build({ entryPoints: [path.join(root, 'ts', 'systems', 'housingSystem.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'housing.js'), logLevel: 'error' });
  const { HousingSystem } = require(path.join(out, 'housing.js'));
  const GATE = 0xfe01810f, GATE_FAR = 0, SHOP = 0x0001a6f6, SHOP_FAR = 0x0001a6f7, STEWARD = 0xff000aaa, FARMER = 0xff000bbb;
  const mp = { get: () => undefined, set: () => { }, getActorsByProfileId: () => [], getUserByActor: () => -1, getUserActor: () => 0, isConnected: () => false, sendCustomPacket: () => { } };
  const ctx = { svr: mp };
  const sys = new HousingSystem(() => { });
  sys.holdOf = () => 'solitude';
  sys.holdRanks = (c, a) => (a === STEWARD ? [{ hold: 'solitude', rank: 'steward' }] : []);
  sys.partnerOf = (c, ref) => (ref === SHOP ? SHOP_FAR : GATE_FAR);
  const asked = [];
  globalThis.__dboForeignHall = (refs) => { asked.push(refs.map((r) => (r >>> 0).toString(16))); return refs.includes(GATE) ? 'Clan Volkihar' : ''; };
  check('a steward of Solitude manages an ordinary building in Solitude', sys.isHoldManager(ctx, STEWARD, SHOP) === true);
  check('...asking the gameplay about both halves of its door', asked.some((a) => a.join() === [SHOP, SHOP_FAR].map((r) => r.toString(16)).join()), asked);
  check('...but not Castle Volkihar\'s gate, a faction\'s hall', sys.isHoldManager(ctx, STEWARD, GATE) === false);
  check('someone with no hold rank manages neither', sys.isHoldManager(ctx, FARMER, SHOP) === false && sys.isHoldManager(ctx, FARMER, GATE) === false);
  globalThis.__dboForeignHall = () => { throw new Error('guilds.js mid-reload'); };
  check('a failing check leaves the hold\'s powers as they were', sys.isHoldManager(ctx, STEWARD, GATE) === true);
  delete globalThis.__dboForeignHall;
  check('without the gameplay hook (an older gamemode) nothing changes', sys.isHoldManager(ctx, STEWARD, GATE) === true);
  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
