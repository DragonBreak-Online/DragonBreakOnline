// clearcorpses.js against a stub mp: /clearcorpses disables the dead NPC bodies in reach of the staff member and nothing
// else (never the living, a player's body, a plugin-placed record, another cell's, one out of reach), leaves summons',
// companions' and warbands' dead unless "all", destroys nothing (the owners' timers do; a destroyed id is reused), and audits.
//   node tests/clearcorpses-harness.js   (from server/)
'use strict';
const path = require('path');
const MODULE = path.resolve(__dirname, '..', 'clearcorpses.js');

const GM = 0xff000001, PLAYER_BODY = 0xff000002, LIVE = 0xff000010, ZONE_DEAD = 0xff000011, ZONE_DEAD2 = 0xff000012, FAR = 0xff000013,
  OTHER_CELL = 0xff000014, VANILLA_DEAD = 0x0001b0e2, COMPANION_DEAD = 0xff000015, WARBAND_DEAD = 0xff000016, HIDDEN = 0xff000017;
const HERE = '3c:Skyrim.esm', THERE = '16bb4:Skyrim.esm';
let A;
const reset = () => {
  A = {
    [GM]: { pos: [0, 0, 0], cell: HERE, dead: false, profile: 3 },
    [PLAYER_BODY]: { pos: [100, 0, 0], cell: HERE, dead: true, profile: 40 },
    [LIVE]: { pos: [200, 0, 0], cell: HERE, dead: false, base: '1b0e2:Skyrim.esm' },
    [ZONE_DEAD]: { pos: [300, 0, 0], cell: HERE, dead: true, base: '23a90:Skyrim.esm' },
    [ZONE_DEAD2]: { pos: [0, 1400, 0], cell: HERE, dead: true, base: '23a90:Skyrim.esm' },
    [FAR]: { pos: [50 * 70, 0, 0], cell: HERE, dead: true, base: '4359c:Skyrim.esm' },
    [OTHER_CELL]: { pos: [10, 0, 0], cell: THERE, dead: true, base: '4359c:Skyrim.esm' },
    [VANILLA_DEAD]: { pos: [20, 0, 0], cell: HERE, dead: true, base: '1b0e1:Skyrim.esm' },
    [COMPANION_DEAD]: { pos: [30, 0, 0], cell: HERE, dead: true, base: '282a:Dawnguard.esm', companionOf: 0xff000099 },
    [WARBAND_DEAD]: { pos: [40, 0, 0], cell: HERE, dead: true, base: '16907:Dawnguard.esm' },
    [HIDDEN]: { pos: [50, 0, 0], cell: HERE, dead: true, base: '23a90:Skyrim.esm', disabled: true },
  };
  globalThis.__dboWarband = { released: [{ id: WARBAND_DEAD, hostile: true }], owners: new Map() };
  sets.length = 0; destroyed.length = 0; audits.length = 0; told.length = 0;
};
const sets = [], destroyed = [], audits = [], told = [], cmds = new Map();
const mp = {
  get: (id, k) => {
    const x = A[id >>> 0];
    if (!x) throw new Error('no such form');
    switch (k) {
      case 'pos': return x.pos.slice();
      case 'worldOrCellDesc': return x.cell;
      case 'isDead': return x.dead;
      case 'isDisabled': return !!x.disabled;
      case 'baseDesc': return x.base || '';
      case 'ff_companionOf': return x.companionOf || 0;
      default: return undefined;
    }
  },
  set: (id, k, v) => { sets.push([id >>> 0, k, v]); if (k === 'isDisabled') A[id >>> 0].disabled = v; },
  destroyActor: (id) => destroyed.push(id >>> 0),
  getNeighborsByPosition: (cell) => Object.keys(A).map(Number),
};
reset();
const S = require(MODULE)({
  mp, log: () => {}, audit: (t) => audits.push(t), personal: (a, t) => told.push(t), who: () => 'Gm Swag #UPSY',
  profileOf: (id) => (A[id >>> 0] && A[id >>> 0].profile !== undefined ? A[id >>> 0].profile : -1), userOf: (id) => ((id >>> 0) === GM ? 4 : -1),
  registerChatCommand: (n, fn, o) => cmds.set(n, { fn, o }), cfg: {},
});
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!c) fails++; };
const run = (args) => cmds.get('clearcorpses').fn(GM, args);
const disabled = () => sets.filter(([, k, v]) => k === 'isDisabled' && v === true).map(([id]) => id).sort();

ok(cmds.has('clearcorpses') && cmds.get('clearcorpses').o.admin === true, '/clearcorpses is a staff command');

// Plain, 30 m: the zone NPC's bodies in reach, nothing else
reset();
ok(run('') === 2, 'plain: two bodies cleared');
ok(JSON.stringify(disabled()) === JSON.stringify([ZONE_DEAD, ZONE_DEAD2].sort()), '...the two dead spawned NPCs within 30 m in this cell', disabled().map((x) => x.toString(16)));
ok(!disabled().includes(LIVE), '...never the living');
ok(!disabled().includes(PLAYER_BODY), "...never a player's body");
ok(!disabled().includes(VANILLA_DEAD), '...never a record placed by a plugin');
ok(!disabled().includes(FAR) && !disabled().includes(OTHER_CELL), '...nor one out of reach or in another cell');
ok(!disabled().includes(COMPANION_DEAD) && !disabled().includes(WARBAND_DEAD), "...nor a companion's or a warband's dead");
ok(!sets.some(([id]) => id === HIDDEN), '...nor one already disabled');
ok(destroyed.length === 0, 'nothing is destroyed (the owners destroy on their timers; a destroyed id is reused)');
// The left list follows the neighbours' order: each reason once, in any order
const leftOf = (l) => (/; left (.*)$/.exec(l) || [, ''])[1].split(', ').sort().join(', ');
ok(audits.length === 1 && /^CLEARCORPSES Gm Swag #UPSY cleared 2 body\(ies\) within 30 m in 3c:Skyrim\.esm: 2x 23a90:Skyrim\.esm; left /.test(audits[0])
  && leftOf(audits[0]) === "1 a player, 1 a summon or companion, 1 a warband's, 1 placed by a plugin", 'the run is audited with what was taken and what was left', audits);
ok(/^Cleared 2 bodies within 30 m\. Left: .*\/clearcorpses 30 all takes/.test(told[0]), 'the GM is told, and how to take the rest', told);

// all: summons, companions and warbands too; still never a player, the living or a plugin record
reset();
ok(run('all') === 4 && disabled().includes(COMPANION_DEAD) && disabled().includes(WARBAND_DEAD), 'all: the companion and the warband bodies too', disabled().map((x) => x.toString(16)));
ok(!disabled().includes(PLAYER_BODY) && !disabled().includes(LIVE) && !disabled().includes(VANILLA_DEAD), "...and still never a player's body, the living or a plugin record");
ok(/ \(all\): /.test(audits[0]), '...audited as all', audits);

// The radius: in metres, capped
reset();
ok(run('60') === 3 && disabled().includes(FAR), '60 m reaches the body at 50 m');
reset();
run('5000');
ok(/within 100 m/.test(audits[0]), 'a radius past the cap is held to 100 m', audits);
reset();
ok(run('10') === 1 && disabled().includes(ZONE_DEAD) && !disabled().includes(ZONE_DEAD2), '10 m: only the body at 4 m, not the one at 20 m');

// Junk words: usage, nothing done
reset();
run('everything now');
ok(sets.length === 0 && audits.length === 0 && /^Usage: \/clearcorpses/.test(told[0]), 'an unknown word gives the usage and does nothing', told);

// A warband body the warband still holds is left (it destroys it on its own timer)
reset();
globalThis.__dboWarband = undefined;
run('');
ok(disabled().includes(WARBAND_DEAD), 'with no warband loaded, a body no one holds is just a body');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
