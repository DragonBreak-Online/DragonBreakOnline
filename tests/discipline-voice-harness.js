// discipline.js and voice (security audit F3, 15 Oct): a suspended account gets no voice token, and the fork's voice
// sweep removes it from the room. The fork's voiceSystem.ts asks globalThis.__dboVoiceRefused(actorId); this checks the
// hook discipline.js sets, against the real module and a fake api.
//   node tests/discipline-voice-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };
const MOD = path.join(SERVER, 'discipline.js');
const CFG = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-sf-F3-discipline-'));
const FILE = path.join(tmp, 'discipline.json');
// actors: 2 Lead GM (profile 11), 3 player (20), 4 the player's alt (20), 7 another player (30)
const prof = { 2: 11, 3: 20, 4: 20, 7: 30 }, tier = { 2: 'leadgm' }, tags = { '#AAAA': 3, '#CCCC': 7 };
let cmd = null;
const realTimeout = global.setTimeout; global.setTimeout = (fn) => fn();
const load = (extra) => {
  delete require.cache[MOD];
  cmd = null;
  require(MOD)({
    mp: { kick: () => {} }, log: () => {}, personal: () => {}, audit: () => {},
    who: (a) => `w${a}`, display: (a) => `c${a}`, profileOf: (a) => prof[a], onlineActors: () => [2, 3, 7],
    registerChatCommand: (n, fn) => { if (n === 'discipline') cmd = fn; }, isAdmin: (a) => !!tier[a], isLeadStaff: (a) => !!tier[a] && tier[a] !== 'gm',
    findAnyByName: (q) => tags[q] || 0, sendPacket: () => {}, userOf: (a) => a + 100, every: () => {},
    // gamemode.js's rank rule: every target here is a player's account (tests/staff-rank-harness.js runs the real rule)
    rankRefusal: () => null,
    cfg: { discipline: Object.assign({}, CFG.discipline, { file: FILE, record: [] }, extra) }
  });
};
const refused = (a) => { const h = globalThis.__dboVoiceRefused; return typeof h === 'function' ? h(a) : 'no hook'; };

delete globalThis.__dboVoiceRefused;
load();
ok(typeof globalThis.__dboVoiceRefused === 'function', 'discipline.js sets the voice refusal hook the fork asks');
ok(refused(3) === '' && refused(7) === '', 'an account with no suspension may use voice', [refused(3), refused(7)]);
cmd(2, '#AAAA suspend 2d stole from a barrel');
ok(refused(3) === 'suspended', 'a suspended account is refused voice', refused(3));
ok(refused(4) === 'suspended', '...on every character of the account', refused(4));
ok(refused(7) === '', '...and nobody else is', refused(7));
cmd(2, '#AAAA lift appeal accepted');
ok(refused(3) === '' && refused(4) === '', 'a lifted suspension gives voice back', [refused(3), refused(4)]);
cmd(2, '#CCCC suspend 1h spamming the market chat');
const realNow = Date.now;
Date.now = () => realNow() + 2 * 3600000;
ok(refused(7) === '', 'a suspension that has ended refuses nothing', refused(7));
Date.now = realNow;
ok(refused(7) === 'suspended', '...while it runs it does', refused(7));
load();
ok(refused(7) === 'suspended', 'the hook survives a hot reload (records from the file)', refused(7));
load({ enabled: false });
ok(globalThis.__dboVoiceRefused === null, 'discipline off: the hook is cleared', typeof globalThis.__dboVoiceRefused);

global.setTimeout = realTimeout;
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
