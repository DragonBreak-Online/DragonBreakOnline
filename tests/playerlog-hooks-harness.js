// Scripted test for the player log's one-line hooks in gamemode.js and the modules (DESIGN.md 2.0, 2.2.1 and 2.3): every hook
// is the one inline form (globalThis only, inside try/catch, so a harness that splices the code and a load without
// playerlog both run as before), every hook name the code calls is one the dispatcher handles, every phase A site is still
// there (a refactor that drops one fails here, named), every hit refusal names a reason the fight records know, and the
// two read-only accessors (business.js, guilds.js) never hand out a name.
//   node tests/playerlog-hooks-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const F = require('./lib/playerlog-fakes.js');

const ROOT = path.resolve(__dirname, '..');
const R = require(path.join(ROOT, 'playerlog-rules.js'));
let failures = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 600) : ''}`); if (!c) failures++; };

const files = fs.readdirSync(ROOT).filter((f) => f.endsWith('.js') && !f.startsWith('playerlog'));
const INLINE = /try \{ const h = globalThis\.__dboPlogHook; if \(typeof h === 'function'\) h\('([a-z_]+)'[^\n]*?\); \} catch \(e\) \{ \/\* the player log is optional \*\/ \}/g;
const calls = [];
const loose = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of src.matchAll(INLINE)) calls.push({ f, name: m[1], line: src.slice(0, m.index).split('\n').length });
  // any other mention of the dispatcher outside the inline form and gamemode's own command wrapper and load block
  src.split('\n').forEach((l, i) => {
    if (!l.includes('__dboPlogHook')) return;
    if (/try \{ const h = globalThis\.__dboPlogHook; if \(typeof h === 'function'\) h\('[a-z_]+'.*\); \} catch \(e\) \{ \/\* the player log is optional \*\/ \}/.test(l)) return;
    if (f === 'gamemode.js' && /const plogCommand = |globalThis\.__dboPlogHook = null;/.test(l)) return;
    loose.push(`${f}:${i + 1} ${l.trim().slice(0, 120)}`);
  });
}
ok(loose.length === 0, 'every hook is the one inline form (globalThis only, try/catch)', loose);
ok(calls.length >= 60, 'the hooks are found', calls.length);

// every name the code calls is handled by the dispatcher
const M = F.makeMp(), FS = F.makeFs(), TM = F.makeTimers(), QU = F.makeQueue(), CL = F.makeClock();
QU.install();
const api = { mp: M.mp, log: () => {}, cfg: { playerLog: { dir: '/fake/events', stopFile: '/fake/STOP' } }, every: TM.every, stopTimer: TM.stopTimer, onlineActors: () => [],
  actorOf: () => 0, fs: FS.fs, clock: CL, discordOf: () => '', recordOf: () => null, adminItemName: () => '', commandsHas: () => false, WORLD_GROUPS: [], lastPacketAt: new Map() };
delete require.cache[path.join(ROOT, 'playerlog.js')];
const K = require(path.join(ROOT, 'playerlog.js'))(api);
QU.run();
const names = new Set(calls.map((c) => c.name));
const unhandled = [...names].filter((n) => typeof K.G.hooks[n] !== 'function');
ok(unhandled.length === 0, `every hook name the code calls has a handler (${[...names].sort().join(' ')})`, unhandled);

// the phase A sites, pinned: [file, hook name, how many at least]
const SITES = [
  ['gamemode.js', 'audit', 1], ['gamemode.js', 'tell', 1], ['gamemode.js', 'gate', 4], ['gamemode.js', 'packet', 1], ['gamemode.js', 'client', 1],
  ['gamemode.js', 'login', 1], ['gamemode.js', 'switch', 1], ['gamemode.js', 'logout', 1], ['gamemode.js', 'travel', 8],
  ['itemguards.js', 'move', 1], ['itemguards.js', 'relog', 1],
  ['gamemode.js', 'loot', 5], ['gamemode.js', 'letter', 1], ['gamemode.js', 'appearance', 1], ['gamemode.js', 'grant', 1], ['gamemode.js', 'leave_reason', 1],
  ['gamemode.js', 'signal', 2],
  ['dungeons.js', 'loot', 2], ['dungeons.js', 'dungeon', 4], ['dungeons.js', 'party', 6], ['dungeons.js', 'itemflow', 2],
  ['downed.js', 'wake', 5], ['downed.js', 'itemflow', 1],
  ['supernatural.js', 'effect', 2], ['supernatural.js', 'itemflow', 1], ['supernatural.js', 'leave_reason', 1],
  ['playermenu.js', 'mask', 2], ['playermenu.js', 'pmenu', 1],
  ['business.js', 'business', 1], ['guilds.js', 'faction', 2], ['contracts.js', 'contract', 1], ['realm.js', 'staffworld', 1],
  ['economy.js', 'bankwrite', 2], ['champions.js', 'income', 1], ['charlevel.js', 'level', 1], ['salvage.js', 'salvage', 1],
  ['alchemy.js', 'brew', 2], ['alchemy.js', 'extras', 1], ['racial.js', 'misc', 1], ['journal.js', 'misc', 2], ['journal.js', 'staffview', 1],
  ['mapprogress.js', 'map', 1], ['thalmor.js', 'dossier', 2], ['debugsnap.js', 'report', 1],
  ['pickpocket.js', 'theft', 3], ['robbery.js', 'theft', 1], ['couriers.js', 'theft', 1], ['lockpick.js', 'lock', 1], ['lockpick.js', 'itemflow', 1],
  ['labour.js', 'signal', 1], ['struggle.js', 'signal', 2], ['prayer.js', 'signal', 1],
  ['beastform.js', 'itemflow', 1], ['manuals.js', 'itemflow', 1], ['jail.js', 'itemflow', 1], ['rope.js', 'itemflow', 1],
  ['combat.js', 'effect', 4], ['discipline.js', 'leave_reason', 1], ['rest.js', 'leave_reason', 1],
];
const missing = SITES.filter(([f, n, k]) => calls.filter((c) => c.f === f && c.name === n).length < k).map(([f, n, k]) => `${f} ${n} (want ${k}, have ${calls.filter((c) => c.f === f && c.name === n).length})`);
ok(missing.length === 0, `every pinned site is there (${SITES.length} kinds)`, missing);
// the command wrapper, the U panel route, the load block
const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
ok(/const registerChatCommand = \(name, fn, opts\) => commands\.set\(name\.toLowerCase\(\), \{ fn: plogCommand\(name\.toLowerCase\(\), fn\)/.test(gm), 'G3: every registered command runs through plogCommand');
ok(/globalThis\.__dboPlogRoute = 'upanel';\s*\n\s*try \{ handleChat/.test(gm), 'G10: the U panel names its route');
ok(gm.lastIndexOf("require(PLAYERLOG_JS)") > gm.lastIndexOf("require(MOVETRACE_JS)"), 'G12: playerlog.js loads after every other module');
ok(/globalThis\.__alduinakItemName = \(baseId\) =>/.test(gm) && !/__alduinakItemName[\s\S]{0,400}\.name\b(?!\w)/.test(gm.slice(gm.indexOf('globalThis.__alduinakItemName = '), gm.indexOf('globalThis.__alduinakItemName = ') + 400)), '__alduinakItemName names the record only');
// G1 sits before the Discord target check, so the audit line reaches the player log with Discord off too
const auditFn = gm.slice(gm.indexOf('const audit = (text) => {'), gm.indexOf('// ---- staff commands'));
ok(auditFn.indexOf("h('audit', body)") > auditFn.indexOf("log('audit:', body);") && auditFn.indexOf("h('audit', body)") < auditFn.indexOf('if (!discordTarget) return;'), 'G1: after the server-log line, before the Discord check');
// G4: a long line is recorded only by its registered command name (the hook gets the name; the player log checks it)
ok(/if \(body\.length > Number\(FLOOD\.chatMaxChars\) && !isAdmin\(a\)\) \{ try \{ const h = globalThis\.__dboPlogHook; if \(typeof h === 'function'\) h\('gate', a, 'too_long', cmd\)/.test(gm), 'G4: the too-long gate passes only the command word');
// G5 after the chat return
const cp = gm.slice(gm.indexOf('globalThis.__dboHandlers.customPacket = '), gm.indexOf('globalThis.__dboHandlers.customPacket = ') + 1500);
ok(cp.indexOf("h('packet', userId, content)") > cp.indexOf("return handleChat(userId, content.data); }"), 'G5: the packet tap sits after the chat return');

// hit refusals name a reason the fight knows
const reasons = [];
for (const f of files) { const src = fs.readFileSync(path.join(ROOT, f), 'utf8'); for (const m of src.matchAll(/globalThis\.__dboHitRefusal = '([a-z_]+)'/g)) reasons.push([f, m[1]]); }
ok(reasons.length >= 14 && reasons.every(([, r]) => R.REFUSAL_REASONS.includes(r)), `every hit refusal names a known reason (${reasons.length})`, reasons.filter(([, r]) => !R.REFUSAL_REASONS.includes(r)));
// gamemode's hit hook names each gate's reason on the line before the gate (the gate lines are left as they were, which
// other harnesses read), in order, and clears it before the fork chain and the summon guard, whose refusals stay unnamed
const hook = gm.slice(gm.indexOf('const hitDamageAttemptHook ='), gm.indexOf('const hitDamageAttemptLogged ='));
const marks = [...hook.matchAll(/globalThis\.__dboHitRefusal = (?:'([a-z_]+)'|null);/g)].map((m) => [m[1] || null, m.index]);
const order = ['shout_not_given', 'ethereal', 'offline_body', 'login_grace', 'bound', 'paralysed', 'armour_change', 'damage_cap', 'spell_rate', 'dungeon_ally', 'warband', null];
ok(JSON.stringify(marks.map(([r]) => r)) === JSON.stringify(order), 'gamemode\'s hit hook: a reason for each gate, in order, then cleared', marks.map(([r]) => r));
const firstGate = hook.indexOf('return false');
const prevAt = hook.indexOf('const prev = globalThis.__dboPrevHitDamageAttempt');
ok(marks.length && marks[0][1] < firstGate && marks[marks.length - 1][1] < prevAt && hook.slice(marks[marks.length - 2][1], prevAt).includes('__dboWarbandRefusesHit'), '...the first reason before the first gate, the clearing after the last gate and before the fork chain');
// the accessors: read-only, no names
const biz = fs.readFileSync(path.join(ROOT, 'business.js'), 'utf8');
const bizAcc = biz.slice(biz.indexOf('globalThis.__dboBusinessChestOf = '), biz.indexOf('globalThis.__dboBusinessActivate = '));
ok(bizAcc.length > 0 && !/\.name\b|renterName|mp\.set|save\(|data\(\)/.test(bizAcc), '__dboBusinessChestOf: profiles only, reads what is loaded, writes nothing', bizAcc.slice(0, 200));
const gu = fs.readFileSync(path.join(ROOT, 'guilds.js'), 'utf8');
const guAcc = gu.slice(gu.indexOf('globalThis.__dboGuildStorageAt = '), gu.indexOf('globalThis.__dboGuildStorageAt = ') + 500);
ok(guAcc.length > 0 && !/\.name\b|mp\.set|save\(/.test(guAcc.slice(0, guAcc.indexOf('return null;'))), '__dboGuildStorageAt: the faction and the leader\'s profile, writes nothing');
// letters, the dossier, the bug report, the story: never their text. The three taps that take a line by design are the
// exceptions: the audit line (parsed by its verb's reviewed class), a told line (classified for the outcome, then dropped)
// and a diagnostic line (only the exact client version shape is read)
const textLeaks = calls.filter((c) => !['audit', 'tell', 'client'].includes(c.name)).filter((c) => {
  const src = fs.readFileSync(path.join(ROOT, c.f), 'utf8').split('\n')[c.line - 1] || '';
  const args = (src.match(/h\('[a-z_]+'(.*?)\); \} catch/) || [])[1] || '';
  return /(?<![.\w])(text|body|note|reason|backstory|origin|rawText|sig\.name|from)\b(?!\s*[:?])/.test(args.replace(/'[^']*'/g, ''));
});
ok(textLeaks.length === 0, 'no hook passes a text, a note, a reason or a signature', textLeaks.map((c) => `${c.f}:${c.line}`));
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
