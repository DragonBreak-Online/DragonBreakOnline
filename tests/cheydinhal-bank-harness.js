// Scripted test for Cheydinhal's bank (Nat, 25 Oct: "also add a bank"). DBO_Cheydinhal.esp has no DragonBreak.esp master,
// so its bank's teller is its own copy of TheBank (DBOCheydinhalBankTeller, 0x1FF100), in bank.js's default activators
// beside the DLE's (gamemode-config.json sets none). With the real config file and bank.js over a mock gamemode api:
//   - Cheydinhal's teller opens the bank, and Bruma's TheBank still does;
//   - any other object does not;
//   - on a server whose load order lacks DBO_Cheydinhal.esp (production today), bank.js loads and Bruma's bank works;
//   - before this change (origin/server's bank.js) Cheydinhal's teller is not a bank.
// No server and no game: from the server folder,
//   node tests/cheydinhal-bank-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SERVER = path.resolve(__dirname, '..');
const BANK = path.join(SERVER, 'bank.js');
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'cheydinhal-bank-')));

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };

const GOLD = 0xf;
const TELLER_BRUMA = 0xff000501, TELLER_CHEY = 0xff000502, TABLE = 0xff000503, PLAYER = 0x14;
const BASE_THEBANK = 0x0b000005, BASE_CHEY = 0x921ff100;
const props = new Map();
const get = (id, p) => props.get(id + '|' + p);
const set = (id, p, v) => props.set(id + '|' + p, v);
set(PLAYER, 'inventory', { entries: [{ baseId: GOLD, count: 500 }] });
set(TELLER_BRUMA, 'baseDesc', '5:DragonBreak.esp');
set(TELLER_CHEY, 'baseDesc', '1ff100:DBO_Cheydinhal.esp');   // verify-formids: ignore (test descs)
set(TABLE, 'baseDesc', '1234:Skyrim.esm');   // verify-formids: ignore (test descs)

const makeApi = (cfg, cheydinhalLoaded) => ({
  mp: {
    get, set,
    getIdFromDesc: (d) => {
      if (d === '5:DragonBreak.esp') return BASE_THEBANK;
      if (d === '1ff100:DBO_Cheydinhal.esp') { if (!cheydinhalLoaded) throw new Error('no such plugin'); return BASE_CHEY; }   // verify-formids: ignore (test descs)
      if (d === '1234:Skyrim.esm') return 0x1234;   // verify-formids: ignore (test descs)
      return 0;
    },
  },
  log: () => {}, personal: () => {}, audit: () => {}, who: (a) => `P${a.toString(16)}`, cfg,
  openWidget: () => {}, closeWidget: () => {}, onUi: () => {}, registerChatCommand: () => {},
  takeGold: () => true, giveItem: () => true,
  goldOf: (a) => ((get(a, 'inventory') || {}).entries || []).filter((e) => e.baseId === GOLD).reduce((s, e) => s + e.count, 0),
  depositToTreasury: () => 0, zoneById: () => null, zoneList: () => [], zoneOfActor: () => '',
  every: () => {}, ranksOf: () => [], profileOf: () => 1, distanceMeters: () => 2,
});
const load = (cfg, loaded) => { delete require.cache[BANK]; delete globalThis.__dboBankActivate; require(BANK)(makeApi(cfg, loaded)); return (ref) => globalThis.__dboBankActivate(ref, PLAYER); };

const config = (text) => JSON.parse(text);
const now = config(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));
ok(!((now.bank || {}).activators), 'gamemode-config.json sets no bank.activators, so the default list in bank.js is used');

// With Cheydinhal loaded (the dev server)
let activate = load(now, true);
ok(activate(TELLER_CHEY) === true, 'Cheydinhal\'s teller opens the bank');
ok(activate(TELLER_BRUMA) === true, 'Bruma\'s TheBank still opens it');
ok(activate(TABLE) === false, 'another object is not a bank');

// Without it (production today): loading must not throw, and the DLE's bank keeps working
let threw = null;
try { activate = load(now, false); } catch (e) { threw = e.message; }
ok(threw === null, 'bank.js loads when DBO_Cheydinhal.esp is not in the load order', threw);
if (!threw) {
  ok(activate(TELLER_BRUMA) === true, 'there Bruma\'s TheBank still opens the bank');
  ok(activate(TELLER_CHEY) === false, 'and a stray Cheydinhal teller desc is not a bank');
}

// Before the change: origin/server's bank.js, when git can show it
let before = null;
try { before = execFileSync('git', ['-C', SERVER, 'show', 'origin/server:bank.js'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { /* no git */ }
if (before && !/DBO_Cheydinhal/.test(before)) {
  const old = path.join(process.cwd(), 'bank-before.js'); fs.writeFileSync(old, before);
  delete globalThis.__dboBankActivate; delete globalThis.__dboBankState; require(old)(makeApi(now, true));
  activate = (ref) => globalThis.__dboBankActivate(ref, PLAYER);
  ok(activate(TELLER_CHEY) === false, "before the change Cheydinhal's teller was not a bank");
  ok(activate(TELLER_BRUMA) === true, "before the change Bruma's TheBank was");
} else console.log('ok    skipped the before-checks: origin/server already carries the change, or git is not here');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
