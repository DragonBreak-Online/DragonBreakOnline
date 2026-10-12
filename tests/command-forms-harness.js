// The player panel's command forms (Nate, 12 Oct: "i hate using chat commands"). commandforms.js reads a command's usage from
// its help text; gamemode.js puts the form on each panel entry, lists every staff command by its /adminhelp topic (a Lead
// GM's only for a Lead GM and above), and sends the names a player may pick: staff see everyone online, a player only the
// people they were introduced to. A lone "/" in chat opens the panel at its search.
//   node tests/command-forms-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const { formOf } = require('../commandforms.js');

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };
const words = (f) => (f ? f.variants.map((v) => v.word) : null);
const kinds = (v) => v.args.map((a) => a.kind + (a.optional ? '?' : ''));

// ---- the parser, on usages as the commands write them ----
let f = formOf('<player|#TAG|profile id> <zone> <rank> [override] make someone an official, online or not');
ok(f && f.variants.length === 1 && kinds(f.variants[0]).join() === 'player,text,text,text?' && /^make someone/.test(f.desc), 'appoint: a name, two boxes and an optional one; the rest is what it does', f);
f = formOf('invite|accept|decline|leave|kick: group up for dungeons (6 a party, up to 12 a raid at half skill gain)');
ok(words(f).join() === 'invite,accept,decline,leave,kick' && /^group up/.test(f.desc), 'party: one choice per word', words(f));
f = formOf('[werewolf|vampirelord|revert] take or leave your beast form (or cast the power)');
ok(words(f).join() === ',werewolf,vampirelord,revert', 'beast: an optional choice can also be run bare', words(f));
f = formOf('[on|off|clear <player>] whether other players see the Vampire Lord body (crash mitigation)');
ok(words(f).join() === ',on,off,clear' && kinds(f.variants[3]).join() === 'player', 'vlremote: choices inside the brackets, one asking for a name', f.variants);
f = formOf('post <gold> <work> | take | done | refuse | cancel | abandon | rule: work held in escrow at the boards');
ok(words(f).join() === 'post,take,done,refuse,cancel,abandon,rule' && kinds(f.variants[0]).join() === 'number,text' && f.variants[0].args[1].rest, 'commission: post asks for gold and the work (the rest of the line)', f.variants[0]);
f = formOf('<pk|mod|report> <what happened>: a private ticket with staff on Discord (bugs: /bug)');
ok(f.variants.length === 1 && f.variants[0].args[0].kind === 'enum' && f.variants[0].args[0].options.join() === 'pk,mod,report' && f.variants[0].args[1].rest, 'ticket: a choice of kind, then the message', f.variants[0]);
f = formOf('restart|shutdown|update <when> <reason> | list | cancel <n>: planned restarts, with a reason (senior and developer staff)');
ok(words(f).join() === 'restart,shutdown,update,list,cancel' && kinds(f.variants[4]).join() === 'number', 'schedule: shared arguments for three words, a number for cancel', f.variants.map(kinds));
f = formOf('teach|forget <name> <family>, list [name], test: smithing techniques');
ok(words(f).join() === 'teach,forget,list,test', 'smithing: alternatives separated by commas', words(f));
f = formOf('<clear|cloudy|rain|snow> [game hours] weather where you stand');
ok(f.variants[0].args[0].options.join() === 'clear,cloudy,rain,snow' && kinds(f.variants[0]).join() === 'enum,number?', 'setweather: a weather and optional game hours', f.variants[0]);
ok(formOf('who is online') === null && formOf('') === null && formOf(undefined) === null, 'prose and nothing give no form');
ok(formOf('your character level and progress; /level <health|magicka|stamina> [n] spends points') === null, 'a usage in the middle of prose is not guessed at (gamemode.js gives /level its own form)');
ok(formOf('<name|#TAG> toggle ignoring someone\'s pigeons').variants[0].args[0].kind === 'player', 'pigeonblock: a name');

// ---- every real help text parses without throwing ----
const SERVER = path.resolve(__dirname, '..');
let helps = 0, formed = 0, threw = [];
for (const file of fs.readdirSync(SERVER).filter((x) => x.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(SERVER, file), 'utf8');
  const re = /help:\s*(['"`])((?:\\.|(?!\1).)*)\1/g; let m;
  while ((m = re.exec(src))) { helps++; try { if (formOf(m[2].replace(/\\'/g, "'"))) formed++; } catch (e) { threw.push(`${file}: ${e.message}`); } }
}
ok(helps > 100 && threw.length === 0, `every help text in the gameplay parses (${helps}, ${formed} with a form)`, threw);

// ---- gamemode.js: the panel's forms, staff topics and names ----
const src = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8');
const section = src.slice(src.indexOf('const commands = new Map();'), src.indexOf("registerChatCommand('players'"));
const panel = src.slice(src.indexOf('// ---- the player panel (U)'), src.indexOf('globalThis.__dboPanelLeave'));
const PLAYER = 1, GM = 2, LEAD = 3, OTHER = 4, MASKED = 5;
const opened = [];
const ui = new Map();
const tiers = { [GM]: 'gm', [LEAD]: 'senior' };
globalThis.__dboNameFor = (viewer, t) => (viewer === PLAYER && t === OTHER ? 'Dagny Holt' : 'Stranger');
const run = new Function('personal', 'isAdmin', 'deliver', 'C', 'profileOf', 'ranksOf', 'openWidget', 'closeWidget', 'onUi', 'userOf', 'handleChat',
  'require', 'path', 'log', 'LEAD_ONLY', 'isLeadStaff', 'onlineActors', 'display', 'tagOf',
  section + panel + '\nreturn { registerChatCommand, panelTabsFor, openPlayerMenu };')(
  () => {}, (a) => !!tiers[a], () => {}, { WHITE: 'fafafa', SYS: 'eda841' }, (a) => a, () => [], (a, w) => opened.push({ a, w }), () => {},
  (e, fn) => { const l = ui.get(e) || []; l.push(fn); ui.set(e, l); }, (a) => a, () => {},
  require, { resolve: (x) => path.resolve(SERVER, x) }, () => {}, new Set(['curse', 'warband']), (a) => tiers[a] === 'senior',
  () => [PLAYER, GM, LEAD, OTHER, MASKED], (a) => `Name${a} #T${a}`, (a) => `T${a}`);
run.registerChatCommand('party', () => {}, { help: 'invite|accept|decline|leave|kick: group up for dungeons' });
run.registerChatCommand('pigeonblock', () => {}, { help: '<name|#TAG> toggle ignoring someone\'s pigeons' });
run.registerChatCommand('level', () => {}, { help: 'your character level and progress; /level <health|magicka|stamina> [n] spends points' });
run.registerChatCommand('players', () => {}, { help: 'who is online' });
run.registerChatCommand('kick', () => {}, { admin: true, help: '<player>' });
run.registerChatCommand('curse', () => {}, { admin: true, help: '<player|me|#TAG> <vampire|werewolf|cure|status> a curse on someone' });
run.registerChatCommand('warband', () => {}, { admin: true, help: 'raise <npc> [n] | follow | attack <player>: NPCs that follow you' });
run.registerChatCommand('announce', () => {}, { admin: true, help: '<text> tell every online player, on screen and in chat' });

const entries = (a) => run.panelTabsFor(a).flatMap((t) => t.entries.map((e) => Object.assign({ tab: t.key }, e)));
const byName = (a, n) => entries(a).find((e) => e.name === n);
const party = byName(PLAYER, 'party');
ok(party && party.form && party.form.variants.map((v) => v.word).join() === 'invite,accept,decline,leave,kick', 'a player\'s /party entry carries its choices', party && party.form);
opened.length = 0; run.openPlayerMenu(PLAYER, '', '');
const level = opened[0].w.searchOnly.find((e) => e.name === 'level');
ok(level && level.form && level.form.variants.map((v) => v.word).join() === ',health,magicka,stamina', '/level, reached from F3, is still found by the search, with its hand-made form (show, or spend points on one of three)', level && level.form);
ok(!byName(PLAYER, 'help'), 'the panel does not list /help, which is the panel itself');
ok(!entries(PLAYER).some((e) => e.tab === 'staff'), 'a player has no Staff tab');
const gmStaff = entries(GM).filter((e) => e.tab === 'staff').map((e) => e.name);
ok(gmStaff.includes('kick') && gmStaff.includes('announce') && !gmStaff.includes('curse') && !gmStaff.includes('warband'), 'a GM\'s Staff tab lists the staff commands but not a Lead GM\'s', gmStaff);
const leadStaff = entries(LEAD).filter((e) => e.tab === 'staff');
ok(leadStaff.some((e) => e.name === 'curse') && leadStaff.some((e) => e.name === 'warband'), 'a Lead GM\'s Staff tab has the Lead GM commands too', leadStaff.map((e) => e.name));
ok(leadStaff.every((e) => typeof e.section === 'string' && e.section.length), 'every staff entry sits under its /adminhelp topic', leadStaff.filter((e) => !e.section).map((e) => e.name));
const curse = leadStaff.find((e) => e.name === 'curse');
ok(curse.form && curse.form.variants[0].args[0].kind === 'player' && curse.form.variants[0].args[1].options.includes('cure'), '/curse asks for a name and a kind', curse.form);
const names = entries(LEAD).map((e) => e.name);
ok(new Set(names).size === names.length, 'no command is offered twice to staff', names.filter((n, i) => names.indexOf(n) !== i));

opened.length = 0; run.openPlayerMenu(PLAYER, '', '');
let w = opened[0].w;
ok(JSON.stringify(w.people) === JSON.stringify([{ label: 'Dagny Holt', value: 'Dagny Holt' }]), 'a player\'s name list holds only the people they were introduced to, by the name they know', w.people);
opened.length = 0; run.openPlayerMenu(GM, '', 'par');
w = opened[0].w;
ok(w.people.length === 4 && w.people.every((p) => /^#T\d$/.test(p.value)) && !w.people.some((p) => p.value === '#T2'), 'staff see everyone else online, picked by #TAG', w.people);
ok(w.search === 'par', 'the panel opens at a search when asked to', w.search);

// ---- the chat handler: a lone "/" opens the panel ----
ok(/if \(!cmd && hasPlayerMenu\(a\)\) return openPlayerMenu\(a, '', ''\);/.test(src), 'a lone "/" in chat opens the panel at its search (handleChat)');
ok(/Type \/ alone, or press U, to search every command\./.test(src), 'an unknown command points to the search');

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
