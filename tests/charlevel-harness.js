// node tests/charlevel-harness.js - character levels from skill work, point spending, bonus property
const path = require('path');
const props = new Map(); const packets = []; const widgets = []; const handlers = {}; const cmds = {};
const key = (a, p) => `${a}:${p}`;
const api = {
  mp: { get: (a, p) => props.get(key(a, p)), set: (a, p, v) => props.set(key(a, p), JSON.parse(JSON.stringify(v))) },
  log: () => {}, personal: () => {}, system: () => {}, audit: () => {}, display: (a) => `#${a}`, cfg: {},
  openWidget: (a, w) => widgets.push(w), closeWidget: () => {}, onUi: (e, fn) => { handlers[e] = fn; },
  registerChatCommand: (n, fn) => { cmds[n] = fn; }, onlineActors: () => [1], every: () => {},
  sendPacket: (a, p) => packets.push(p),
  isAdmin: (a) => a === 9, findByName: (q) => (q === 'one' ? 1 : 0),
};
require(path.resolve(__dirname, '..', 'charlevel.js'))(api);
let fails = 0; const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };
const skill = (level, xp = 0) => ({ level, xp, rank: 0, granted: [] });
const setSkills = (s) => api.mp.set(1, 'private.mastery', { v: 2, skills: s, order: Object.keys(s) });

setSkills({ smithing: skill(10) });
globalThis.__dboCharLevelLogin(1);
ok(globalThis.__dboCharLevel(1) === 1, 'a new character is level 1');
setSkills({ smithing: skill(25) });
globalThis.__dboCharLevelLogin(1);
ok(globalThis.__dboCharLevel(1) === 2, 'one skill at Apprentice (250 units) is level 2');
ok(widgets.length === 1, 'the level-up opens the choice menu');
handlers.levelChoose(1, ['health']);
ok(JSON.stringify(api.mp.get(1, 'private.dboAvBonus')) === '{"health":25,"magicka":0,"stamina":0}', 'spending a point writes private.dboAvBonus');
ok(packets.some((p) => p.customPacketType === 'dboAvGain' && p.health === 25), 'the client is told the gain');
handlers.levelChoose(1, ['health']);
ok(api.mp.get(1, 'private.dboAvBonus').health === 25, 'no point to spend, nothing changes');
setSkills({ smithing: skill(80), alchemy: skill(10) });
globalThis.__dboCharLevelLogin(1);
ok(globalThis.__dboCharLevel(1) === 4, 'Expert plus a little elsewhere is level 4, not 5');
ok(api.mp.get(1, 'private.dboLevel').pending === 2, 'two levels gained at once leave two points');
setSkills({ smithing: skill(90) });
globalThis.__dboCharLevelLogin(1);
ok(globalThis.__dboCharLevel(1) === 5, 'the first Master skill (2950 units) is level 5');
setSkills({ smithing: skill(20) });
globalThis.__dboCharLevelLogin(1);
ok(globalThis.__dboCharLevel(1) === 5, 'a skill giving way never lowers the level');
ok(api.mp.get(1, 'private.dboLevel').pending === 3, 'unspent points carry over');
handlers.levelChoose(1, ['bogus']);
ok(api.mp.get(1, 'private.dboLevel').pending === 3, 'an unknown choice is ignored');
// /level <vital> <n> spends several at once (3 pending here); asking for more than is left spends what is left
cmds.level(1, 'stamina 2');
ok(api.mp.get(1, 'private.dboLevel').pending === 1 && api.mp.get(1, 'private.dboAvBonus').stamina === 50, '/level stamina 2 spends two points');
ok(packets.length && JSON.stringify(packets[packets.length - 1]).includes('"stamina":50'), 'one gain packet carries both points');
cmds.level(1, 'magicka 5');
ok(api.mp.get(1, 'private.dboLevel').pending === 0 && api.mp.get(1, 'private.dboAvBonus').magicka === 25, '/level magicka 5 with one left spends one');

// A character who spent points at the old +10 is topped up to +25 once, and the client is told the difference
api.mp.set(2, 'private.mastery', { v: 2, skills: { smithing: skill(25) }, order: ['smithing'] });
api.mp.set(2, 'private.dboLevel', { level: 2, pending: 0, spent: { health: 10, magicka: 0, stamina: 0 } });
api.mp.set(2, 'private.dboAvBonus', { health: 10, magicka: 0, stamina: 0 });
packets.length = 0;
globalThis.__dboCharLevelLogin(2);
ok(api.mp.get(2, 'private.dboAvBonus').health === 25 && api.mp.get(2, 'private.dboLevel').per === 25, 'old +10 points are re-priced at +25');
ok(packets.length === 1 && packets[0].health === 15 && packets[0].magicka === undefined, 'the client is told only the +15 difference');
globalThis.__dboCharLevelLogin(2);
ok(api.mp.get(2, 'private.dboAvBonus').health === 25 && packets.length === 1, 'the top-up happens once');
// Refunds (Moderation Help #0240): a reroll, or staff with /level reset, hand every spent point back
{
  const before = api.mp.get(1, 'private.dboLevel'); const spentPts = Object.values(before.spent).reduce((n, v) => n + v / 25, 0);
  const back = globalThis.__dboCharLevelRefund(1, 'reroll');
  const after = api.mp.get(1, 'private.dboLevel');
  ok(back === spentPts && after.pending === before.pending + spentPts && JSON.stringify(api.mp.get(1, 'private.dboAvBonus')) === '{"health":0,"magicka":0,"stamina":0}', 'a reroll refunds every spent point and zeroes private.dboAvBonus');
  ok(globalThis.__dboCharLevel(1) === 5, '...the level stays');
  ok(globalThis.__dboCharLevelRefund(1, 'reroll') === 0, '...and a second refund has nothing to give');
  cmds.level(1, 'magicka 1');
  cmds.level(1, 'reset one');
  ok(api.mp.get(1, 'private.dboAvBonus').magicka === 25, 'a player cannot use /level reset');
  cmds.level(9, 'reset one');
  ok(api.mp.get(1, 'private.dboAvBonus').magicka === 0 && api.mp.get(1, 'private.dboLevel').pending === after.pending, 'staff /level reset <player> refunds');
}
console.log(fails ? `${fails} FAILURES` : 'all passed');
process.exit(fails ? 1 : 0);
