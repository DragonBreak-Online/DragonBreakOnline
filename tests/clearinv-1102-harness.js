// A staff member clears their own inventory (Nat, 2 Nov; gamemode.js clearOwnInventory: the F7 Debug tab's dbo
// clearInventory and /clearinv). GM and above, on the staff character, only their own; the first press says what would go
// and a second within 5 s clears it through the server's inventory (mp.set), keeping worn items and keys, gold cleared and
// counted in the audit line. The block is cut out of gamemode.js and run with stubs. Mutants of a copy must fail.
//   node tests/clearinv-1102-harness.js [gamemode.js]   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.resolve(process.argv[2] || path.join(__dirname, '..', 'gamemode.js')), 'utf8').replace(/\r\n/g, '\n');
const START = '// ---- a staff member clears their own inventory';
const END_MARK = "registerChatCommand('clearinv'";

const GOLD = 0x0000000f, SWORD = 0x00012eb7, ARMOR = 0x00012e49, KEY = 0x000a1b2c, POTION = 0x0003eadd;
const TYPES = { [SWORD]: 'WEAP', [ARMOR]: 'ARMO', [KEY]: 'KEYM', [POTION]: 'ALCH', [GOLD]: 'MISC' };
const GM = 0xff000001, GM_RP = 0xff000002, LEAD = 0xff000003, TRIAL = 0xff000004, PLAYER = 0xff000005;
const TIER = { [GM]: 'gm', [GM_RP]: 'gm', [LEAD]: 'leadgm', [TRIAL]: 'trialgm' };

const run = (src, check) => {
  const at = src.indexOf(START);
  const end = src.indexOf('\n', src.indexOf(END_MARK, at));
  check('the block is in gamemode.js', at >= 0 && end > at);
  if (at < 0 || end < at) return;
  const inv = new Map();
  const bag = () => [
    { baseId: SWORD, count: 1, worn: true }, { baseId: ARMOR, count: 1, wornLeft: true }, { baseId: KEY, count: 1, name: 'Key to the House' },
    { baseId: SWORD, count: 2 }, { baseId: POTION, count: 5 }, { baseId: GOLD, count: 120 },
  ];
  for (const a of [GM, GM_RP, LEAD, TRIAL, PLAYER]) inv.set(a, { entries: bag() });
  const said = [], audits = [], golds = [], ui = {}, cmds = {};
  let now = 1e12;
  const realNow = Date.now; Date.now = () => now;
  delete globalThis.__dboClearInvAsked;
  globalThis.__dboStaffGuard = { powersOn: (a) => a !== GM_RP, NOT_HERE: 'Staff powers work only on your staff character.' };
  const mp = { get: (a, k) => (k === 'inventory' ? JSON.parse(JSON.stringify(inv.get(a >>> 0) || { entries: [] })) : undefined), set: (a, k, v) => { if (k === 'inventory') inv.set(a >>> 0, v); } };
  try {
    new Function('mp', 'personal', 'staffTierOf', 'log', 'who', 'audit', 'recordOf', 'GOLD_BASE', 'goldChanged', 'onUi', 'registerChatCommand', src.slice(at, end))(
      mp, (a, t) => said.push([a >>> 0, t]), (a) => TIER[a >>> 0] || null, () => {}, (a) => `P${(a >>> 0).toString(16)}`, (t) => audits.push(t),
      (id) => (TYPES[id] ? { record: { type: TYPES[id] } } : null), GOLD, (a) => golds.push(a >>> 0),
      (ev, fn) => { ui[ev] = fn; }, (n, fn, o) => { cmds[n] = { fn, o }; });
    const last = (a) => (said.filter((s) => s[0] === a).pop() || [0, ''])[1];
    const bases = (a) => inv.get(a).entries.map((e) => e.baseId).sort().join();
    const full = bag().map((e) => e.baseId).sort().join();

    check('the button and the chat command are both there', typeof ui.clearInventory === 'function' && !!cmds.clearinv && cmds.clearinv.o && cmds.clearinv.o.admin === true);
    ui.clearInventory(PLAYER, []);
    check('a player is refused, nothing taken', bases(PLAYER) === full && /Only a GM or above/.test(last(PLAYER)));
    ui.clearInventory(TRIAL, []);
    check('a Trial GM is refused', bases(TRIAL) === full && /Only a GM or above/.test(last(TRIAL)));
    ui.clearInventory(GM_RP, []); ui.clearInventory(GM_RP, []);
    check('a GM on a character that is not their staff one is refused (staffCharOnly)', bases(GM_RP) === full && /only on your staff character/.test(last(GM_RP)));
    ui.clearInventory(GM, [PLAYER]);
    check('the first press only asks, with the count and the gold', bases(GM) === full && /^Clear 7 item\(s\) and 120 gold\? Worn items and keys stay\. Click again within 5 s\.$/.test(last(GM)), last(GM));
    now += 6000;
    ui.clearInventory(GM, [PLAYER]);
    check('a second press after 5 s asks again', bases(GM) === full && /^Clear 7/.test(last(GM)), last(GM));
    now += 2000;
    ui.clearInventory(GM, [PLAYER]);
    const left = inv.get(GM).entries;
    check('a second press within 5 s clears it, keeping the worn items and the key', left.length === 3 && left.some((e) => e.worn && e.baseId === SWORD) && left.some((e) => e.wornLeft) && left.some((e) => e.baseId === KEY && e.name), left);
    check('...the gold too, and the HUD is told', !left.some((e) => e.baseId === GOLD) && golds.includes(GM));
    check('...never anyone else\'s, whatever the button sends', bases(PLAYER) === full);
    check('...audited with the counts and the gold', audits.length === 1 && /^STAFF Pff000001 cleared their own inventory: 7 item\(s\) in 2 stack\(s\), 120 gold$/.test(audits[0]), audits);
    check('...and told', /^Cleared 7 item\(s\) and 120 gold\.$/.test(last(GM)), last(GM));
    ui.clearInventory(GM, []);
    check('with only worn items and keys left: nothing to clear', /Nothing to clear/.test(last(GM)) && inv.get(GM).entries.length === 3);
    cmds.clearinv.fn(LEAD, ''); now += 1000; cmds.clearinv.fn(LEAD, '');
    check('/clearinv does the same for a Lead GM', inv.get(LEAD).entries.length === 3 && audits.length === 2);
  } finally { Date.now = realNow; delete globalThis.__dboStaffGuard; }
};

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 300) : ''}`); if (!ok) failures++; };
run(SRC, check);
const MUTANTS = [
  ['worn items go too', 'const clearInvKeeps = (e) => !!(e.worn || e.wornLeft) || ', 'const clearInvKeeps = (e) => '],
  ['keys go too', "return !!r && String(r.record.type) === 'KEYM';", 'return false;'],
  ['no confirm', 'if (!asked || Date.now() - asked > CLEAR_INV_CONFIRM_MS) {', 'if (false) {'],
  ['a GM may not', "['senior', 'developer', 'leadgm', 'gm'].includes(staffTierOf(a))) return personal(a, 'Only a GM or above clears", "['senior', 'developer', 'leadgm'].includes(staffTierOf(a))) return personal(a, 'Only a GM or above clears"],
  ['any character will do', "if (g && typeof g.powersOn === 'function' && !g.powersOn(a)) return personal(a, g.NOT_HERE);", ''],
  ['a Trial GM may', "if (!['senior', 'developer', 'leadgm', 'gm'].includes(staffTierOf(a)))", "if (!['senior', 'developer', 'leadgm', 'gm', 'trialgm'].includes(staffTierOf(a)))"],
];
for (const [name, from, to] of MUTANTS) {
  if (!SRC.includes(from)) { check(`mutant "${name}": its line is still in gamemode.js`, false, from); continue; }
  let bad = 0;
  try { run(SRC.replace(from, to), (_n, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
  check(`mutant caught: ${name}`, bad > 0);
}
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exitCode = failures ? 1 : 0;
