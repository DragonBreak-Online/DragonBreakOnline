// A captured soul is a little Enchanter work (SMJ, 12 Oct: ten soul gems for one Enchanting level). The fork's soulTrapSystem
// calls globalThis.__dboSoulCaptured(caster, target, size, player) after it fills a gem; alchemy.js turns it into a small
// __alduinakMasteryAward for "enchanter", soulTrapXp.perHour credited captures an hour at most.
//   node tests/soultrap-xp-harness.js [fork root]   (from server/; the fork check is skipped without one)
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const SERVER = path.resolve(__dirname, '..');
process.chdir(SERVER);
let clock = 1_790_000_000_000;
Date.now = () => clock;
const awards = [];
let held = true;
globalThis.__alduinakMasteryAward = (a, skill, weight, key) => { awards.push({ a, skill, weight, key }); return held ? weight : 0; };
const mp = { get: () => undefined, set: () => {}, getIdFromDesc: () => 0, getDescFromId: () => '', lookupEspmRecordById: () => null };
const load = (cfg) => {
  delete require.cache[path.join(SERVER, 'alchemy.js')];
  delete globalThis.__dboSoulTrapXpAt;
  require(path.join(SERVER, 'alchemy.js'))({ mp, log: () => {}, personal: () => {}, audit: () => {}, display: () => 'the player', who: () => 'the player',
    openWidget: () => {}, closeWidget: () => {}, every: () => {}, itemName: () => '', cfg, sendPacket: () => {} });
};
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };
const P = 0xff0004cb, Q = 0xff0004cc;

load({});
ok(typeof globalThis.__dboSoulCaptured === 'function', 'alchemy.js registers the capture hook');
ok(globalThis.__dboSoulCaptured(P, 0x1234, 1, false) === 0.4 && awards[0].skill === 'enchanter' && awards[0].key === 0x1234, 'a petty soul is a small Enchanter award, keyed by the target', awards[0]);
globalThis.__dboSoulCaptured(P, 0x1235, 5, false); globalThis.__dboSoulCaptured(P, 0x1236, 0, true);
ok(awards[1].weight === 0.8 && awards[2].weight === 0.8, 'a grand or black soul is worth more, still small (0.8 of the 0.5..3 range)', awards);
for (let i = 0; i < 10; i++) globalThis.__dboSoulCaptured(P, 0x2000 + i, 3, false);
ok(awards.length === 10, 'at most 10 credited captures an hour', awards.length);
ok(globalThis.__dboSoulCaptured(Q, 0x3000, 3, false) > 0, '...per character');
clock += 3600001;
ok(globalThis.__dboSoulCaptured(P, 0x4000, 3, false) > 0, 'the hour rolls over');
held = false; load({}); awards.length = 0;
for (let i = 0; i < 12; i++) globalThis.__dboSoulCaptured(P, 0x5000 + i, 2, false);
held = true;
ok(awards.length === 12 && globalThis.__dboSoulCaptured(P, 0x6000, 2, false) > 0, 'captures before Enchanter is taken up (nothing credited) do not use the hour');
load({ soulTrapXp: { enabled: false } }); awards.length = 0;
ok(globalThis.__dboSoulCaptured(P, 0x7000, 3, false) === 0 && !awards.length, 'soulTrapXp.enabled false: nothing');

const ROOT = path.resolve(process.argv[2] || process.env.FORK || path.join(os.homedir(), 'dragonbreak/fork'));
const sys = path.join(ROOT, 'skymp5-server/ts/systems/soulTrapSystem.ts');
const src = fs.existsSync(sys) ? fs.readFileSync(sys, 'utf8') : '';
if (/__dboSoulCaptured/.test(src)) {
  const capture = (src.match(/private capture\([\s\S]*?\n  \}/) || [''])[0];
  ok(/__dboSoulCaptured\?\.\(casterId, targetId, soul\.black \? 0 : soul\.size, player\)/.test(capture) && capture.indexOf('__dboSoulCaptured') > capture.indexOf('if (!gemId)'), "the fork calls it only after a gem was filled");
} else console.log(`skipped: ${ROOT} has no capture hook yet`);
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
