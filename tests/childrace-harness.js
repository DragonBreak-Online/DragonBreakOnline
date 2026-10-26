// No child is played (Nat, 26 Oct): childrace.js against an mp stub holding the races that matter, and gamemode.js's wiring.
// A RaceMenu close on a child race (the Child flag, or an editor id naming a child) is set to that people's adult race once
// it has settled, the player told; an adult close, the Goblin (small but grown) and a look already put right are left alone.
//   node tests/childrace-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };

// RACE DATA: flags at 32 (Playable 0x1, Child 0x4), as the 26 Oct scan of the live order read them
const race = (edid, flags) => { const d = new Uint8Array(164); new DataView(d.buffer).setUint32(32, flags, true); return { record: { type: 'RACE', editorId: edid, fields: [{ type: 'DATA', data: d }] } }; };
const R = {
  0x13746: race('NordRace', 0x1), 0x13741: race('BretonRace', 0x1), 0x13742: race('DarkElfRace', 0x1), 0x13744: race('ImperialRace', 0x1),
  0x2c65b: race('NordRaceChild', 0x4), 0x2c65c: race('BretonRaceChild', 0x4), 0x108272: race('BretonRaceChildVampire', 0x4),
  0x0d081686: race('DunmerRaceChild', 0x4), 0x4f6ab06e: race('LodgeChildRace', 0x0), 0x330280b9: race('BretonRaceChildArnima', 0x0),
  0x481aca01: race('DBOGoblinRace', 0x1), 0x481d201b: race('DBOHalfGiantRace', 0x1),
  0x99: { record: { type: 'NPC_', editorId: 'SomeNpc', fields: [] } },
};
const props = new Map(), said = [], logs = [];
const mp = {
  lookupEspmRecordById: (id) => R[id >>> 0] || null,
  get: (a, k) => props.get(`${a}|${k}`),
  set: (a, k, v) => { props.set(`${a}|${k}`, v); },
};
const G = require(path.join(ROOT, 'childrace.js'))({ mp, log: (...x) => logs.push(x.join(' ')), personal: (a, t) => said.push([a, t]), display: (a) => `P${a.toString(16)}`, settleMs: 0 });
const wait = () => new Promise((r) => setTimeout(r, 20));

(async () => {
  ok(typeof globalThis.__dboChildRaceGuard === 'function', 'the module publishes __dboChildRaceGuard for the appearance hook');
  for (const id of [0x2c65b, 0x2c65c, 0x108272, 0x0d081686]) ok(G.isChildRace(id), `${R[id].record.editorId} (Child flag) is a child race`);
  for (const id of [0x4f6ab06e, 0x330280b9]) ok(G.isChildRace(id), `${R[id].record.editorId} (no flag, a child by its editor id) is a child race`);
  for (const id of [0x13746, 0x13741, 0x13742, 0x481aca01, 0x481d201b]) ok(!G.isChildRace(id), `${R[id].record.editorId} is not`);
  ok(!G.isChildRace(0x99) && !G.isChildRace(0) && !G.isChildRace(0xdead), 'a non-race, no race or an unknown id is not a child race');

  // each child close is set to its people's adult race; the Nord when the editor id names no playable people
  const cases = [[0x2c65b, 0x13746], [0x2c65c, 0x13741], [0x108272, 0x13741], [0x0d081686, 0x13742], [0x330280b9, 0x13741], [0x4f6ab06e, 0x13746]];
  let a = 0xff000100;
  for (const [child, adult] of cases) {
    a++;
    const look = { raceId: child, isFemale: false, name: 'X', headpartIds: [1, 2] };
    props.set(`${a}|appearance`, look);
    const caught = G.guard(a, look);
    await wait();
    const cur = props.get(`${a}|appearance`);
    ok(caught && cur.raceId === adult && cur.name === 'X' && cur.headpartIds.length === 2,
      `a close on ${R[child].record.editorId} becomes ${R[adult].record.editorId}, the rest of the look kept`, [caught, cur.raceId.toString(16)]);
    ok(said.some(([x, t]) => x === a && /Children cannot be played/.test(t)), '...and the player is told');
  }
  // adult closes are untouched and say nothing
  for (const adult of [0x13744, 0x481aca01, 0x481d201b]) {
    a++;
    const look = { raceId: adult };
    props.set(`${a}|appearance`, look);
    const caught = G.guard(a, look);
    await wait();
    ok(!caught && props.get(`${a}|appearance`) === look && !said.some(([x]) => x === a), `an adult close (${R[adult].record.editorId}) is left alone`);
  }
  // a child close already put right before the check runs is left as it is
  a++;
  props.set(`${a}|appearance`, { raceId: 0x2c65b });
  G.guard(a, { raceId: 0x2c65b });
  const fixed = { raceId: 0x13744 };
  props.set(`${a}|appearance`, fixed);
  await wait();
  ok(props.get(`${a}|appearance`) === fixed && !said.some(([x]) => x === a), 'a look changed to an adult race in the meantime is not touched');
  ok(logs.some((l) => /childrace: P[0-9a-f]+ closed the race menu on the child race NordRaceChild/.test(l)), 'each reset is logged with the race');

  // gamemode.js: loads the module and calls the guard from the appearance hook, for allowed closes
  const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
  const hook = gm.slice(gm.indexOf('const appearanceHook'), gm.indexOf('const appearanceHook') + 4000);
  ok(/require\(CHILDRACE_JS\)\(\{ mp, log, personal, display \}\)/.test(gm), 'gamemode.js loads childrace.js');
  ok(/if \(isAllowed\) \{ try \{ const g = globalThis\.__dboChildRaceGuard; if \(typeof g === 'function'\) g\(actorId >>> 0, appearance\);/.test(hook), 'the appearance hook calls the guard on every allowed close');

  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
