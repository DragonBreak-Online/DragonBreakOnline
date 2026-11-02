// Event bosses' raised vitals (Nat, 2 Nov; bossvitals.js): /vitals and the F7 Vitals row. Loads bossvitals.js and the
// real charlevel.js with stubs, so the raise is checked where the server reads it: private.dboAvBonus (fork
// MpActor::AddLevelBonus adds it to the maximum every hit is measured against). GM and above on a staff character; a GM
// sets themselves or a player inside an open event's area, a Lead GM anyone; capped at the server's 1000; the boss's
// client is sent the gain; cleared at logout and when its event ends unless kept. Mutants of a copy must fail.
//   node tests/bossvitals-1102-harness.js [bossvitals.js]   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.resolve(process.argv[2] || path.join(ROOT, 'bossvitals.js')), 'utf8').replace(/\r\n/g, '\n');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-bossvitals-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* the OS */ } });

const GM = 0xff000001, GM_RP = 0xff000002, LEAD = 0xff000003, TRIAL = 0xff000004, BOSS = 0xff000005, BYSTANDER = 0xff000006, PLAYER = 0xff000007;
const TIER = { [GM]: 'gm', [GM_RP]: 'gm', [LEAD]: 'leadgm', [TRIAL]: 'trialgm' };
const NAMES = { boss: BOSS, bystander: BYSTANDER, '#gemm': GM };
let n = 0;

const run = (src, check) => {
  const props = new Map();
  const get = (a, k) => props.get(`${a >>> 0}|${k}`);
  // Every character has spent one level point on Health (+25)
  for (const a of [GM, GM_RP, LEAD, TRIAL, BOSS, BYSTANDER, PLAYER]) { props.set(`${a}|private.dboLevel`, { level: 2, pending: 0, spent: { health: 25, magicka: 0, stamina: 0 }, per: 25 }); props.set(`${a}|private.dboAvBonus`, { health: 25, magicka: 0, stamina: 0 }); }
  const mp = { get: (a, k) => get(a, k), set: (a, k, v) => { if (v === null) props.delete(`${a >>> 0}|${k}`); else props.set(`${a >>> 0}|${k}`, JSON.parse(JSON.stringify(v))); } };
  const said = [], audits = [], packets = [], logs = [], cmds = {}, ui = {}, timers = {};
  const at = { [BOSS]: true };
  const events = { 'raid-1102abc': true };
  globalThis.__dboWarbandEventAt = (a) => (at[a >>> 0] ? { id: 'raid-1102abc' } : null);
  globalThis.__dboWarbandEventOpen = (id) => !!events[id];
  globalThis.__dboStaffGuard = { powersOn: (a) => (a >>> 0) !== GM_RP, NOT_HERE: 'Staff powers work only on your staff character.' };
  for (const k of ['__dboRaceVitalBonus', '__dboBriarheartVitalBonus', '__dboBossVitalBonus', '__dboCharLevelSyncBonus']) delete globalThis[k];
  const api = {
    mp, cfg: {}, log: (...x) => logs.push(x.join(' ')), personal: (a, t) => said.push([a >>> 0, t]), system: () => {}, audit: (t) => audits.push(t),
    who: (a) => `P${(a >>> 0).toString(16)}`, display: (a) => `P${(a >>> 0).toString(16)}`, openWidget: () => {}, closeWidget: () => {},
    onUi: (ev, fn) => { ui[ev] = fn; }, registerChatCommand: (name, fn, o) => { cmds[name] = { fn, o }; }, onlineActors: () => [GM, LEAD, BOSS, BYSTANDER],
    every: (name, ms, fn) => { timers[name] = fn; }, sendPacket: (a, p) => packets.push([a >>> 0, p]), isAdmin: (a) => !!TIER[a >>> 0], findByName: (q) => NAMES[String(q).toLowerCase()] || 0,
    staffTierOf: (a) => TIER[a >>> 0] || null, isLeadStaff: (a) => TIER[a >>> 0] === 'leadgm',
  };
  require(path.join(ROOT, 'charlevel.js'))(api);
  const copy = path.join(dir, `bossvitals-${n++}.js`);
  fs.writeFileSync(copy, src);
  require(copy)(api);
  const last = (a) => (said.filter((s) => s[0] === (a >>> 0)).pop() || [0, ''])[1];
  const bonus = (a) => get(a, 'private.dboAvBonus') || {};
  const v = (a, line) => { cmds.vitals.fn(a, line); return last(a); };

  check('/vitals and the panel events are there', !!cmds.vitals && cmds.vitals.o.admin === true && typeof ui.vitalsSet === 'function' && typeof ui.vitalsReset === 'function');
  check('a player is refused', /Only a GM or above/.test(v(PLAYER, 'me health 500')) && !get(PLAYER, 'private.dboBossVitals'));
  check('a Trial GM is refused', /Only a GM or above/.test(v(TRIAL, 'me health 500')));
  check('a GM on a character that is not their staff one is refused', /only on your staff character/.test(v(GM_RP, 'me health 500')));
  let r = v(GM, 'me health 500');
  check('a GM raises their own Health: the server\'s bonus is their level point plus the raise', bonus(GM).health === 525 && /Health \+500, until they log out/.test(r), [bonus(GM), r]);
  check('...and their client is sent the gain', packets.some(([a, p]) => a === GM && p.customPacketType === 'dboAvGain' && p.health === 500), packets);
  check('a GM may not raise a player outside an open event\'s area', /anyone else needs a Lead GM/.test(v(GM, 'bystander health 500')) && !get(BYSTANDER, 'private.dboBossVitals'));
  r = v(GM, 'boss health 900');
  check('...but may raise one standing inside it, tied to that event', bonus(BOSS).health === 925 && get(BOSS, 'private.dboBossVitals').event === 'raid-1102abc' && /until raid-1102abc ends or they log out/.test(r), [bonus(BOSS), r]);
  check('...audited, and the boss is told', audits.some((t) => /^VITALS Pff000001 set Pff000005 health \+900, until raid-1102abc ends or they log out$/.test(t)) && /raised your Health/.test(last(BOSS)), audits);
  check('a Lead GM may raise anyone', /Magicka \+300/.test(v(LEAD, 'bystander magicka 300')) && bonus(BYSTANDER).magicka === 300);
  check('the cap is the server\'s 1000', /At most \+1000/.test(v(LEAD, 'bystander stamina 1001')) && !bonus(BYSTANDER).stamina);
  r = v(LEAD, 'bystander health 990');
  check('...and a raise that, with their own bonus, goes past it says the server counts 1000', /server counts \+1000 for health/.test(r), r);
  check('/vitals show reads it back', /\+990 Health, \+300 Magicka/.test(v(LEAD, 'bystander show')), last(LEAD));
  // The panel: [target, health, magicka, stamina, keep], a blank leaves that one
  ui.vitalsSet(GM, [BOSS.toString(16), '', '200', '', true]);
  const boss = get(BOSS, 'private.dboBossVitals');
  check('the panel\'s Set raises one vital, leaves the blank ones and keeps it after the event', boss.health === 900 && boss.magicka === 200 && boss.keep === true && bonus(BOSS).magicka === 200, boss);
  ui.vitalsSet(GM, ['', '100', '', '', false]);
  check('...with no player selected it is the staff member\'s own', get(GM, 'private.dboBossVitals').health === 100 && bonus(GM).health === 125);
  ui.vitalsSet(GM, [BYSTANDER.toString(16), '50', '', '', false]);
  check('...under the same rules as /vitals', /anyone else needs a Lead GM/.test(last(GM)) && get(BYSTANDER, 'private.dboBossVitals').health === 990);
  // Logout, and the event's end
  globalThis.__dboBossVitalsLeave(GM);
  check('a raise not kept ends at logout, back to the level point alone', !get(GM, 'private.dboBossVitals') && bonus(GM).health === 25 && audits.some((t) => /^VITALS Pff000001 back to their own maximum \(logout\)/.test(t)));
  globalThis.__dboBossVitalsLeave(BOSS);
  check('...a kept one stays', !!get(BOSS, 'private.dboBossVitals'));
  v(LEAD, 'me health 400');
  get(LEAD, 'private.dboBossVitals').event = 'raid-1102abc';
  mp.set(LEAD, 'private.dboBossVitals', Object.assign(get(LEAD, 'private.dboBossVitals'), { event: 'raid-1102abc' }));
  globalThis.__dboBossVitalsEventEnd('raid-1102abc');
  check('the event\'s end clears that event\'s raises, not a kept one', !get(LEAD, 'private.dboBossVitals') && bonus(LEAD).health === 25 && !!get(BOSS, 'private.dboBossVitals'));
  mp.set(BYSTANDER, 'private.dboBossVitals', Object.assign(get(BYSTANDER, 'private.dboBossVitals'), { event: 'siege-gone' }));
  timers.bossVitals();
  check('a raise whose event closed unseen is cleared on the next pass', !get(BYSTANDER, 'private.dboBossVitals') && bonus(BYSTANDER).health === 25);
  ui.vitalsReset(GM, [BOSS.toString(16)]);
  check('the panel\'s Reset clears a kept raise, audited', !get(BOSS, 'private.dboBossVitals') && bonus(BOSS).health === 25 && audits.some((t) => /^VITALS Pff000005 back to their own maximum \(reset by Pff000001\)/.test(t)));
  check('/vitals <player> health 0 clears that one', (v(LEAD, 'boss health 300'), v(LEAD, 'boss health 0'), !get(BOSS, 'private.dboBossVitals')));
  for (const k of ['__dboWarbandEventAt', '__dboWarbandEventOpen', '__dboStaffGuard']) delete globalThis[k];
};

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 300) : ''}`); if (!ok) failures++; };
run(SRC, check);
const MUTANTS = [
  ['a GM raises anyone', "if ((t >>> 0) !== (a >>> 0) && !eventAt(t) && !isLeadStaff(a))", 'if (false)'],
  ['any character will do', "if (g && typeof g.powersOn === 'function' && !g.powersOn(a)) return g.NOT_HERE;", ''],
  ['no cap', 'if (v > CAP) return', 'if (false) return'],
  ['logout keeps it', "globalThis.__dboBossVitalsLeave = (a) => { const s = stateOf(a); if (s && !s.keep) clear(a, 'logout'); };", 'globalThis.__dboBossVitalsLeave = () => {};'],
  ['the event\'s end clears kept ones too', "if (s && !s.keep && s.event && s.event === String(eventId)) clear(a, `event ${eventId} ended`);", 'if (s && s.event === String(eventId)) clear(a, `event ${eventId} ended`);'],
  ['charlevel is not told', '    sync(t);\n    const bonus', '    const bonus'],
  ['the raise is not offered to charlevel', "globalThis.__dboBossVitalBonus = (a) =>", 'globalThis.__dboBossVitalBonusX = (a) =>'],
];
for (const [name, from, to] of MUTANTS) {
  if (!SRC.includes(from)) { check(`mutant "${name}": its line is still in bossvitals.js`, false, from); continue; }
  let bad = 0;
  try { run(SRC.replace(from, to), (_n, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
  check(`mutant caught: ${name}`, bad > 0);
}
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exitCode = failures ? 1 : 0;
