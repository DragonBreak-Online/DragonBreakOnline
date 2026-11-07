// Scripted test: nothing inside a dungeon is property (Nat, 7 Nov, #bugs BlamBlam Banana: Harbard claimed Embershard Mine and
// locked every sack and chest, and an unlock never stuck because the place built from its door kept every chest owner-only).
// Claim, lock, grant and the rest are refused in a dungeon cell (gameplay dungeons.js __dboDungeonCells), a refused claim or
// lock calls the strike hook, and claims made before stop applying: they open for anyone and show no lock or name.
// Bundles housingSystem.ts with esbuild on a fake mp whose refs keep their properties in a Map.
//
//   node tests/housing-dungeon-harness.js            (HOUSING_ROOT=<another skymp5-server> tests that tree instead)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(process.env.HOUSING_ROOT || path.join(__dirname, '..'));
const esbuild = require(path.join(__dirname, '..', 'node_modules', 'esbuild'));
const base = process.platform === 'linux' && fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
const out = fs.mkdtempSync(path.join(base, 'claude-nate-housingdungeon-'));
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

(async () => {
  await esbuild.build({ entryPoints: [path.join(root, 'ts', 'systems', 'housingSystem.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'housing.js'), logLevel: 'error' });
  const { HousingSystem } = require(path.join(out, 'housing.js'));
  // Embershard Mine: its cell b6be6, a sack and a chest inside, the way in (inside b6ccd, outside b6cce in Tamriel); a house elsewhere
  const SACK = 0x000b6d01, CHEST = 0x000b6d02, DOOR_IN = 0x000b6ccd, DOOR_OUT = 0x000b6cce, HOUSE_CHEST = 0x08000ef7;
  const HARBARD = 0xff000101, STRANGER = 0xff000ccc, STEWARD = 0xff0017ea;
  const USER = { [HARBARD]: 1, [STRANGER]: 2, [STEWARD]: 3 };
  const props = new Map();
  const at = (id) => { if (!props.has(id)) props.set(id, {}); return props.get(id); };
  at(HARBARD).profileId = 101; at(HARBARD).appearance = { name: 'Harbard' };
  at(STRANGER).profileId = 77; at(STRANGER).appearance = { name: 'Passer By' };
  at(STEWARD).profileId = 150; at(STEWARD).appearance = { name: 'Carloft Fhang' };
  for (const id of [SACK, CHEST, DOOR_IN]) at(id).worldOrCellDesc = '0b6be6:Skyrim.esm';
  at(DOOR_OUT).worldOrCellDesc = '3c:Skyrim.esm';
  at(HOUSE_CHEST).worldOrCellDesc = '16bdf:Skyrim.esm';
  const claim = (locked) => ({ owner: 101, ownerChar: HARBARD, ownerName: 'Harbard', name: 'Harbard\'s Mine', locked, serial: 1, partner: 0, containers: [], issued: [] });
  at(SACK)['private.housing'] = claim(true);
  at(DOOR_IN)['private.housing'] = { ...claim(true), partner: DOOR_OUT };
  at(DOOR_OUT)['private.housing'] = { primary: DOOR_IN };
  at(HOUSE_CHEST)['private.housing'] = claim(true);
  const sent = [];
  const mp = {
    get: (id, k) => at(id >>> 0)[k], set: (id, k, v) => { at(id >>> 0)[k] = JSON.parse(JSON.stringify(v)); },
    getActorsByProfileId: () => [], getUserByActor: (a) => USER[a] ?? -1,
    getUserActor: (u) => Number(Object.keys(USER).find((a) => USER[a] === u)) || 0,
    isConnected: () => true, sendCustomPacket: (u, s) => sent.push({ u, p: JSON.parse(s) }),
  };
  const ctx = { svr: mp };
  const lines = [];
  const sys = new HousingSystem((...a) => lines.push(a.join(' ')));
  sys.openClaims = true;
  sys.nearProperty = () => true;
  sys.primaryOf = (c, ref) => { const r = at(ref >>> 0)['private.housing']; return r && r.primary ? r.primary : (ref >>> 0); };
  sys.partnerOf = (c, ref) => ({ [DOOR_IN]: DOOR_OUT, [DOOR_OUT]: DOOR_IN })[ref] || 0;
  sys.holdOf = () => 'falkreath';
  sys.holdRanks = (c, a) => (a === STEWARD ? [{ hold: 'falkreath', rank: 'steward' }] : []);
  sys.isAdmin = () => false;
  sys.isClaimable = () => true;
  sys.reKey = (c, p, rec) => { rec.serial = (Number(rec.serial) || 1) + 1; };
  sys.freezeKeyNames = () => { };
  sys.sendMenu = () => { };
  sys.claimed = [SACK, DOOR_IN, HOUSE_CHEST];
  globalThis.__dboDungeonCells = new Set(['b6be6:skyrim.esm']);
  const strikes = [];
  globalThis.__dboDungeonClaimRefused = (actor, action, ref, cell) => strikes.push({ actor, action, ref, cell });
  const ask = (actor, target, action, extra = {}) => {
    sys.lastRequestMs.clear();
    sent.length = 0;
    sys.onPropertyRequest(ctx, USER[actor], { target, action, ...extra });
    return sent.filter((s) => s.p.customPacketType === 'propertyNotice').map((s) => s.p.text);
  };
  const rec = (id) => at(id)['private.housing'];

  // New claims and locks
  let n = ask(STEWARD, CHEST, 'claim');
  check('an official\'s claim of a chest in a dungeon is refused', !rec(CHEST) && /inside a dungeon/.test(n[0] || ''), { rec: rec(CHEST), n });
  check('...and calls the strike hook with the claim and the dungeon cell', strikes.length === 1 && strikes[0].actor === STEWARD && strikes[0].action === 'claim' && strikes[0].cell === 'b6be6:skyrim.esm', strikes);
  n = ask(HARBARD, SACK, 'lock');
  check('the owner of an old claim in a dungeon cannot lock it again', /inside a dungeon/.test(n[0] || '') && strikes.length === 2 && strikes[1].action === 'lock' && strikes[1].actor === HARBARD, { n, strikes });
  n = ask(HARBARD, DOOR_OUT, 'claim');
  check('a claim from the outside door of a dungeon is refused too', /inside a dungeon/.test(n[0] || '') && strikes.length === 3, { n, strikes });
  n = ask(HARBARD, SACK, 'createkey');
  check('cutting a key there is refused without a strike', /inside a dungeon/.test(n[0] || '') && strikes.length === 3, { n, strikes });
  n = ask(HARBARD, SACK, 'transfer', { recipient: STRANGER });
  check('handing an old dungeon claim over is refused', rec(SACK).owner === 101 && /inside a dungeon/.test(n[0] || ''), { n, rec: rec(SACK) });
  ask(HARBARD, SACK, 'unlock');
  check('unlocking an old claim still works (cleanup)', rec(SACK).locked === false, rec(SACK));
  rec(SACK).locked = true;
  ask(HARBARD, SACK, 'abandon');
  check('giving up an old claim still works (cleanup)', rec(SACK).owner === 0, rec(SACK));
  // Given up, it leaves the registry; put back as it was
  at(SACK)['private.housing'] = claim(true);
  if (!sys.claimed.includes(SACK)) sys.claimed.unshift(SACK);
  n = ask(HARBARD, HOUSE_CHEST, 'unlock');
  ask(HARBARD, HOUSE_CHEST, 'lock');
  check('outside a dungeon locking is untouched', rec(HOUSE_CHEST).locked === true && strikes.length === 3, rec(HOUSE_CHEST));

  // Old claims stop applying
  check('a locked claimed sack in a dungeon opens for a stranger', sys.onActivate(ctx, SACK, STRANGER) === true);
  check('a locked claimed dungeon door opens from inside', sys.onActivate(ctx, DOOR_IN, STRANGER) === true);
  check('...and from outside', sys.onActivate(ctx, DOOR_OUT, STRANGER) === true);
  check('a locked chest outside a dungeon still refuses a stranger', sys.onActivate(ctx, HOUSE_CHEST, STRANGER) === false);
  const refs = sys.decorRefs(ctx);
  const of = (id) => refs.find((r) => r.refId === id) || {};
  check('the engine lock and name of a dungeon claim are cleared for everyone', of(SACK).locked === false && of(SACK).name === null && of(DOOR_OUT).locked === false && of(DOOR_OUT).name === null, refs);
  check('...but a house chest keeps its lock and name', of(HOUSE_CHEST).locked === true && of(HOUSE_CHEST).name === 'Harbard\'s Mine', refs);
  sent.length = 0;
  sys.pushDecorDelta(ctx, [SACK, HOUSE_CHEST]);
  const delta = (sent.find((s) => s.p.customPacketType === 'refDecor') || { p: { refs: [] } }).p.refs;
  check('a delta push clears a dungeon claim\'s lock too', (delta.find((r) => r.refId === SACK) || {}).locked === false && (delta.find((r) => r.refId === HOUSE_CHEST) || {}).locked === true, delta);

  // The gameplay's grant (tenancy.js buy and rent, /grantproperty, guild halls)
  sys.exposeTenancy(ctx);
  const H = globalThis.__dboHousing;
  check('the gameplay cannot grant a chest in a dungeon', /inside a dungeon/.test(H.grant(CHEST, STRANGER)) && !rec(CHEST));
  check('...nor its outside door', /inside a dungeon/.test(H.grant(DOOR_OUT, STRANGER)) && rec(DOOR_IN).owner === 101);
  check('inDungeon answers for tenancy.js', typeof H.inDungeon === 'function' && H.inDungeon(DOOR_OUT) === true && H.inDungeon(HOUSE_CHEST) === false);

  // Staff see the old claims at boot
  lines.length = 0;
  sys.logDungeonClaims(ctx);
  check('the old dungeon claims are listed in the log for staff', lines.some((l) => /2 claim\(s\) inside dungeons are inert: b6d01 owner 101 "Harbard" locked, b6ccd owner 101/.test(l)), lines);

  // Without the gameplay's list nothing is refused
  globalThis.__dboDungeonCells = undefined;
  check('with no dungeon list loaded the sack is an ordinary claim again', sys.onActivate(ctx, SACK, STRANGER) === false);

  globalThis.__dboHousing = undefined;
  globalThis.__dboDungeonClaimRefused = undefined;
  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
