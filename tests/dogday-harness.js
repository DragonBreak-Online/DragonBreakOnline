// Dog Day (dogday.js, Nate 13 Oct 2026): dormant until 5 March 2027 UTC, then every enemy a player kills hands them dog
// meat and Cooked Dog Meat may be cooked; before and after, nothing drops and the recipe is refused. Loads the real
// module against a fake mp, and checks gamemode.js and regions.js call it.
//   node tests/dogday-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };

const MEAT = 0xedb2e, COOKED = 0x60000801, BOAR = 0x60000802;
const PLAYER = 0xff000010, WOLF = 0xff000020, BANDIT = 0xff000021, PAL = 0xff000022, OTHER = 0xff000011;
const props = new Map([[`${WOLF}|private.npcSpawner`, 'wild:x'], [`${BANDIT}|private.npcSpawner`, 'dungeon:y:1'], [`${PAL}|private.npcSpawner`, 'c'], [`${PAL}|private.dboCompanion`, true]]);
const profiles = { [PLAYER]: 7, [OTHER]: 8 };
const mp = {
  get: (a, k) => props.get(`${a}|${k}`),
  getIdFromDesc: (d) => (d === 'edb2e:Skyrim.esm' ? MEAT : 0),
  lookupEspmRecordById: (id) => ({ [COOKED]: { record: { editorId: 'DBO_FoodDogMeatCooked' } }, [BOAR]: { record: { editorId: 'FoodBoarMeatCooked' } } })[id] || null,
};
const given = [], said = [];
const api = { mp, cfg: CONFIG, log: () => {}, personal: (a, t) => said.push([a, t]),
  giveItem: (a, id, n) => { given.push([a, id, n]); return true; }, profileOf: (a) => (a in profiles ? profiles[a] : -1) };
require(path.join(SERVER, 'dogday.js'))(api);

const T = (iso) => Date.parse(iso);
const BEFORE = T('2027-03-04T23:59:59Z'), DURING = T('2027-03-05T12:00:00Z'), AFTER = T('2027-03-06T00:00:00Z');
ok(CONFIG.dogDay && CONFIG.dogDay.startsAt === '2027-03-05T00:00:00Z' && CONFIG.dogDay.endsAt === '2027-03-06T00:00:00Z', 'the tracked config runs it on 5 March 2027 UTC', CONFIG.dogDay);
ok(!globalThis.__dboDogDayOn(Date.now()), 'it is off today');
ok(!globalThis.__dboDogDayOn(BEFORE) && globalThis.__dboDogDayOn(DURING) && !globalThis.__dboDogDayOn(AFTER), 'on only from 5 March 00:00 to 6 March 00:00 UTC');

globalThis.__dboDogDayDeath(BANDIT, PLAYER, BEFORE);
ok(given.length === 0, 'before the day a kill drops nothing');
globalThis.__dboDogDayDeath(BANDIT, PLAYER, DURING);
ok(given.length === 1 && given[0][0] === PLAYER && given[0][1] === MEAT && given[0][2] >= 1 && given[0][2] <= 2, 'on the day a bandit killed by a player gives them 1-2 dog meat', given);
ok(/Dog Day: you take/.test((said[0] || [])[1] || ''), '...and they are told', said);
globalThis.__dboDogDayDeath(WOLF, PLAYER, DURING);
ok(given.length === 2, 'wildlife counts as an enemy too');
globalThis.__dboDogDayDeath(OTHER, PLAYER, DURING);
ok(given.length === 2, 'killing a player drops nothing');
globalThis.__dboDogDayDeath(PAL, PLAYER, DURING);
ok(given.length === 2, 'killing a companion drops nothing');
globalThis.__dboDogDayDeath(BANDIT, WOLF, DURING);
ok(given.length === 2, 'an NPC killing an NPC gives nobody meat');
globalThis.__dboDogDayDeath(BANDIT, PLAYER, AFTER);
ok(given.length === 2, 'after the day a kill drops nothing');

ok(/only cooked on Dog Day/.test(globalThis.__dboDogDayCraft(PLAYER, COOKED, BEFORE)), 'before the day Cooked Dog Meat is refused');
ok(globalThis.__dboDogDayCraft(PLAYER, COOKED, DURING) === '', 'on the day it may be cooked');
ok(/only cooked on Dog Day/.test(globalThis.__dboDogDayCraft(PLAYER, COOKED, AFTER)), 'after the day it is refused again');
ok(globalThis.__dboDogDayCraft(PLAYER, BOAR, BEFORE) === '', 'other cooking is never touched');

const gm = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8'), rg = fs.readFileSync(path.join(SERVER, 'regions.js'), 'utf8');
ok(/require\(DOGDAY_JS\)/.test(gm) && /__dboDogDayDeath\(Number\(actorId\) >>> 0, Number\(killerId\) >>> 0\)/.test(gm), 'gamemode.js loads it and calls it on every death');
ok(/__dboDogDayCraft\(a, Number\(itemId\) >>> 0\)/.test(rg) && /if \(dogDay\) \{[\s\S]{0,400}return false;/.test(rg), 'regions.js refuses the craft when it says so');

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
