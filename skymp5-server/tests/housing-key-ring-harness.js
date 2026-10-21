// Scripted test for the key ring (housingKeyRing, Nate 13 Oct): keys are records on the character, not items. A cut key goes
// onto a ring, a holder walks through a locked door, a key is given from the ring and accepted, an owner takes one copy back,
// key items in a pack or a chest move onto the ring, robbery takes one, and a re-key empties every ring. It bundles
// housingSystem.ts with esbuild and runs it on a fake mp. Run it from skymp5-server with node_modules present:
//
//   node tests/housing-key-ring-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-keyring-'));
const bundle = path.join(out, 'housing.js');

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

(async () => {
  await esbuild.build({
    entryPoints: [path.join(root, 'ts', 'systems', 'housingSystem.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'error',
  });
  const { HousingSystem, KEY_BASE_ID } = require(bundle);
  const src = fs.readFileSync(bundle, 'utf8');
  const HP = (/HOUSING_PROP\s*=\s*"([^"]+)"/.exec(src) || [])[1];
  const RING = (/KEY_RING_PROP\s*=\s*"([^"]+)"/.exec(src) || [])[1];

  const HOUSE = 0x100, SHED = 0x200, CHEST = 0x300;
  const OWNER = 0xff000014, B = 0xff000015, C = 0xff000016, D = 0xff000017;
  const actors = { [OWNER]: { user: 1, profile: 11, name: 'Nat' }, [B]: { user: 2, profile: 12, name: 'Bera' }, [C]: { user: 3, profile: 13, name: 'Cato' }, [D]: { user: 4, profile: 14, name: 'Dagny' } };
  const byUser = {}; for (const a of Object.keys(actors)) byUser[actors[a].user] = Number(a);
  const props = new Map();
  const packets = [];
  const mp = {
    get: (id, key) => {
      const a = actors[id >>> 0];
      if (key === 'profileId') return a ? a.profile : 0;
      if (key === 'appearance') return a ? { name: a.name } : undefined;
      if (key === 'pos') return [0, 0, 0];
      const v = props.get(`${id >>> 0}:${key}`);
      return v === undefined ? undefined : JSON.parse(v);
    },
    set: (id, key, value) => props.set(`${id >>> 0}:${key}`, JSON.stringify(value)),
    getUserByActor: (id) => (actors[id >>> 0] ? actors[id >>> 0].user : -1),
    getUserActor: (u) => byUser[u] || 0,
    isConnected: (u) => !!byUser[u],
    sendCustomPacket: (u, json) => packets.push({ u, p: JSON.parse(json) }),
  };
  const ctx = { svr: mp };
  const sys = new HousingSystem(() => { });
  sys.holdOf = () => null; sys.isAdmin = () => false; sys.holdRanks = () => []; sys.partnerOf = () => 0;
  sys.saveRegistry = () => { };
  sys.baseTypeOf = (_c, id) => (id === CHEST ? 'CONT' : 'DOOR');
  sys.keyRing = true;
  sys.claimed = [HOUSE, SHED];
  const record = (name) => ({ owner: 11, ownerName: 'Nat', name, locked: true, serial: 1, partner: 0, containers: [], issued: [] });
  mp.set(HOUSE, HP, record('Elions House'));
  mp.set(SHED, HP, record('Elions Shed'));

  const recOf = (id) => sys.read(ctx, id);
  const ring = (a) => (mp.get(a, RING) || []).map((k) => k.n);
  const inv = (a) => (mp.get(a, 'inventory') || {}).entries || [];
  const walksIn = (id, a) => sys.onActivate(ctx, id, a);
  sys.exposeTenancy(ctx);
  const H = globalThis.__dboHousing;
  const lastOf = (a, type) => packets.filter((x) => x.u === actors[a].user && x.p.customPacketType === type).slice(-1)[0];

  sys.doCreateKey(ctx, 1, OWNER, HOUSE, recOf(HOUSE), true);
  check('a cut key goes onto the cutter\'s ring, not the pack', ring(OWNER).length === 1 && inv(OWNER).length === 0, ring(OWNER));
  sys.doCreateKey(ctx, 1, OWNER, HOUSE, recOf(HOUSE), true, B);
  const bKey = ring(B)[0];
  check('a key cut for a player beside the owner lands on their ring', bKey === 'Key to the Elions House No. 2', ring(B));
  check('the lock records who holds each copy', recOf(HOUSE).holders[bKey].w === 'Bera', recOf(HOUSE).holders);
  check('the holder walks through the locked door', walksIn(HOUSE, B) === true);
  check('a stranger is refused at the locked door', walksIn(HOUSE, C) === false);
  check('the key does not open another lock', walksIn(SHED, B) === false);
  const decor = (a) => { sys.pushDecor(ctx, actors[a].user); return lastOf(a, 'refDecor').p.refs.find((r) => r.refId === HOUSE).locked; };
  check('the door shows unlocked to the holder and locked to a stranger', decor(B) === false && decor(C) === true);
  const menu = (() => { sys.sendMenu(ctx, 1, OWNER, HOUSE); return lastOf(OWNER, 'propertyMenu').p; })();
  check('the owner\'s menu lists every copy with its holder', menu.keyRing === true && menu.copies.length === 2 && menu.copies[1].holder === 'Bera', menu.copies);

  check('a gift is offered, not forced', H.ringGive(B, bKey, C) === '' && H.ringView(C).offer.key === bKey && ring(C).length === 0);
  check('the offer is answered once', H.ringAnswer(C, true) === '' && H.ringAnswer(C, true) !== '');
  check('an accepted key moves rings', ring(C)[0] === bKey && ring(B).length === 0, [ring(B), ring(C)]);
  check('the holder list follows the key', recOf(HOUSE).holders[bKey].w === 'Cato');
  check('the giver no longer walks in, the taker does', walksIn(HOUSE, B) === false && walksIn(HOUSE, C) === true);
  H.ringGive(C, bKey, B);
  H.ringAnswer(B, false);
  check('a declined key stays put', ring(C)[0] === bKey && ring(B).length === 0);
  check('a key not on the ring cannot be given', H.ringGive(B, bKey, C) !== '');
  const rl = H.ringView(C);
  check('the ring list says what each key opens and who stands near', rl.keys[0].place === 'Elions House' && rl.keys[0].opens === true && rl.near.length === 3, rl);

  check('the owner\'s ring view lists their lock\'s copies', H.ringView(OWNER).owned[0].copies.find((c) => c.name === bKey).holder === 'Cato');
  check('only the owner takes a key back from the panel', H.ringTakeBack(C, HOUSE, bKey) !== '' && ring(C).length === 1);
  check('the owner takes a key back from the panel', H.ringTakeBack(OWNER, HOUSE, bKey) === '');
  check('a taken-back key leaves the holder\'s ring and stops opening', ring(C).length === 0 && walksIn(HOUSE, C) === false && !recOf(HOUSE).issued.includes(bKey));
  check('the owner\'s own copy still opens', walksIn(HOUSE, OWNER) === true && ring(OWNER).length === 1);

  // A pack key the game stacked under one name (Thievyn, 13 Oct) moves onto the ring at login
  mp.set(SHED, HP, Object.assign(record('Elions Shed'), { issued: ['Key to the Elions Shed'] }));
  mp.set(D, 'inventory', { entries: [{ baseId: KEY_BASE_ID, count: 2, name: 'Key to the Elions Shed' }, { baseId: 0xf, count: 50 }, { baseId: KEY_BASE_ID, count: 1, name: 'Key to Nowhere (ABC)' }] });
  sys.ringAtLogin(ctx, D);
  check('a pack key moves onto the ring at login', ring(D)[0] === 'Key to the Elions Shed' && walksIn(SHED, D) === true, ring(D));
  check('the pack keeps everything else; a named cage key no lock accepts is thrown away (#8BR9)', inv(D).length === 1 && inv(D)[0].baseId === 0xf, inv(D));

  // A key left in a chest goes onto the ring of whoever opens it
  mp.set(CHEST, 'inventory', { entries: [{ baseId: KEY_BASE_ID, count: 1, name: 'Property Key No. 4 (100)' }] });
  sys.takeKeysFrom(ctx, CHEST, B);
  check('a key in a chest goes onto the opener\'s ring', ring(B).includes('Property Key No. 4 (100)') && inv(CHEST).length === 0 && walksIn(HOUSE, B) === true, ring(B));

  const took = H.ringSteal(D, C);
  check('robbery moves one key between rings', took === 'Key to the Elions Shed' && ring(C).includes(took) && ring(D).length === 0, took);

  // A key whose name the lock no longer answers to is gone at the next login
  mp.set(D, RING, [{ n: 'Key to the Elions House No. 9', p: HOUSE, at: 1, by: '' }]);
  sys.ringAtLogin(ctx, D);
  check('a stale ring key is dropped at login', ring(D).length === 0);

  check('the owner cuts a key for a player from the panel', H.ringCut(OWNER, SHED, D) === '' && ring(D).length === 1 && walksIn(SHED, D) === true, ring(D));
  check('nobody else cuts one', H.ringCut(C, SHED, C) !== '');
  const house = recOf(HOUSE);
  sys.doRevokeKeys(ctx, 1, HOUSE, house, true, false);
  check('voiding all keys empties every online ring of them', ring(OWNER).length === 0 && !ring(B).some((n) => n.endsWith('(100)') || n.startsWith('Key to the Elions House')) && !recOf(HOUSE).holders);
  check('after a void, nobody but the owner walks in', walksIn(HOUSE, B) === false && walksIn(HOUSE, OWNER) === true);

  sys.keyRing = false;
  check('with the ring off, a locked door refuses even its owner', walksIn(HOUSE, OWNER) === false);

  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `${failures} FAILED` : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
