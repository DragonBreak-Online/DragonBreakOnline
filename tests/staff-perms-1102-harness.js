// Staff powers moved down a tier (Nat, 2 Nov: "empower our lead GMs and GMs"; _work\staff-perms-1102.md on the PC):
//   - a GM's event zones from the F7 NPC Zones tab (staffguard.js gmEventZones): a few NPCs, a cooldown, a cap on zones held,
//     never a system zone, only their own to delete or reset; a Trial GM none; a Lead GM unlimited;
//   - a GM's panel temp ban up to 72 h (staffguard.js banRefusal), a Trial GM none;
//   - /jail, /npc remove and /dungeon end out of LEAD_ONLY (gamemode.js), the other Lead GM commands still in it, and none of
//     them open to a Trial GM (TRIAL_COMMANDS);
//   - /giveitem and /takeitem say GM, as their gate already was (staffitemspells.js).
// tests/updates-harness.js (Lead GM restarts), placement-harness.js (others' placements in a player's property),
// warband-events-harness.js (one /event) and discipline-harness.js (the panel's offline temp ban) hold the rest.
//   node tests/staff-perms-1102-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ROOT, CAST, load, check, done } = require('./lib/staffguard-fakes');
const { GM, GM2, TRIAL, LEAD } = Object.fromEntries(Object.entries(CAST).map(([k, v]) => [k, v.id]));

// staffguard.js keeps gm-event-zones.json in its working folder
const home = process.cwd();
const dir = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-staffperms-'));
process.chdir(dir);
let now = Date.UTC(2026, 10, 2, 12, 0, 0);
const realNow = Date.now;
Date.now = () => now;

let f = load({});
// NPC zones need the adder's open /event since 2 Nov (event-zones-1102-harness.js); here every staff member has one
globalThis.__dboWarbandEventOf = (a) => ({ id: `raid-${a}` });
const gate = () => globalThis.__dboAdminGate;
const zone = (Name, ...counts) => ({ Name, ID: 'a764b:BSHeartland.esm', POS: [0, 0, 0], NPC: counts.map((count, i) => ({ id: `${i + 1}:Skyrim.esm`, count })) });
const add = (a, z) => gate()(a, 'npcZoneAdd', { zone: z, zoneName: z.Name });
const del = (a, name) => gate()(a, 'npcZoneDelete', { zoneName: name });

// ---- event zones ----
check('a GM adds an event zone of 3 NPCs, audited', add(GM, zone('gm-wolves', 2, 1)) === '' && f.audits.some((t) => /^GMEVENTZONE GM Gemma .* added 'gm-wolves' with 3 NPC\(s\) for event raid-48$/.test(t)), f.audits);
now += 1000;
check('...another within the cooldown is refused, with the wait', /One event zone every 30 s: try again in 29 s/.test(add(GM, zone('gm-bandits', 1))));
now += 30000;
check('a zone of 6 NPCs is refused (at most 5)', /at most 5 NPCs; this one has 6/.test(add(GM, zone('gm-big', 3, 3))));
check('a system zone name is refused (wild:, guard:, ...)', /system zones/.test(add(GM, zone('wild:wolf:9', 1))) && /system zones/.test(add(GM, zone('Guard:bruma:1', 1))));
check('a zone with no NPCs is refused', /names no NPCs/.test(add(GM, zone('gm-empty'))));
check('a zone another GM holds by name is refused', /Another GM holds a zone by that name/.test(add(GM2, zone('gm-wolves', 1))));
check('a GM deletes another GM\'s zone: refused', /only the event zones they added/.test(del(GM2, 'gm-wolves')));
check('...or a system zone: refused', /only the event zones they added/.test(del(GM, 'wild:wolf:1')) && /only the event zones they added/.test(gate()(GM, 'npcZoneReset', { zoneName: 'guard:bruma:8' })));
check('a GM resets their own, audited', gate()(GM, 'npcZoneReset', { zoneName: 'gm-wolves' }) === '' && f.audits.some((t) => /reset 'gm-wolves'/.test(t)));
check('a GM deletes their own, audited', del(GM, 'gm-wolves') === '' && f.audits.some((t) => /deleted 'gm-wolves'/.test(t)) && !JSON.parse(fs.readFileSync('gm-event-zones.json', 'utf8'))['gm-wolves']);
{
  let ok = true;
  for (let i = 0; i < 6; i++) { now += 31000; ok = ok && add(GM, zone(`gm-camp-${i}`, 1)) === ''; }
  now += 31000;
  check('a GM holds at most 6 event zones at once', ok && /You hold 6 event zones/.test(add(GM, zone('gm-camp-7', 1))));
}
f = load({}, { reset: false });
check('...kept across a hot reload (gm-event-zones.json)', /You hold 6 event zones/.test(add(GM, zone('gm-camp-8', 1))));
check('a Trial GM adds or deletes no zone', /for a GM and above/.test(add(TRIAL, zone('trial-wolves', 1))) && /for a GM and above/.test(del(TRIAL, 'gm-camp-0')));
check('a Lead GM is not limited (8 NPCs, a system zone, another GM\'s zone)', add(LEAD, zone('wild:extra', 4, 4)) === '' && del(LEAD, 'gm-camp-0') === '');
f = load({ enabled: false });
check('the rule holds with the staff-power switches off', /at most 5 NPCs/.test(add(GM, zone('gm-off', 6))));

// ---- panel temp ban ----
f = load({});
check('a GM\'s panel temp ban of 72 h passes the gate', gate()(GM, 'tempBan', { target: CAST.BOB.id, hours: 72 }) === '');
check('...73 h is refused', /at most 72 hours/.test(gate()(GM, 'tempBan', { target: CAST.BOB.id, hours: 73 })));
check('...a permanent ban stays a Lead GM\'s', /Bans are for Lead GMs and above/.test(gate()(GM, 'ban', { target: CAST.BOB.id })));
check('a Trial GM bans no one from the panel', /Only staff ban players/.test(gate()(TRIAL, 'tempBan', { target: CAST.BOB.id, hours: 1, trial: true })));
check('an offline temp ban by #TAG passes to discipline.js for a GM (its /tempban rules decide)', gate()(GM, 'tempBan', { target: 0, hours: 72, offline: true }) === '');
check('...not for a Trial GM', /Only staff ban players/.test(gate()(TRIAL, 'tempBan', { target: 0, hours: 1, offline: true, trial: true })));
check('...and only for a temp ban with no online target (an online one keeps the rank rule here)', /staff account of your rank or higher/.test(gate()(GM, 'tempBan', { target: GM2, hours: 1, offline: true }))
  && gate()(GM, 'ban', { target: 0, offline: true }) !== '', [gate()(GM, 'tempBan', { target: GM2, hours: 1, offline: true }), gate()(GM, 'ban', { target: 0, offline: true })]);

// ---- gamemode.js LEAD_ONLY and TRIAL_COMMANDS ----
const src = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
const setOf = (re) => { const m = src.match(re); return m ? new Set(m[1].replace(/\/\/.*$/gm, '').split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)) : null; };
const LEAD_ONLY = setOf(/const LEAD_ONLY = new Set\(\[([\s\S]*?)\]\);/);
const TRIAL_CMDS = (src.match(/const TRIAL_COMMANDS = \{([^}]*)\}/) || [])[1] || '';
check('LEAD_ONLY parsed', LEAD_ONLY && LEAD_ONLY.size > 30);
check('/jail, /npc remove and /dungeon end are no longer Lead GM only', !LEAD_ONLY.has('jail') && !LEAD_ONLY.has('npc remove') && !LEAD_ONLY.has('dungeon end'), [...LEAD_ONLY].filter((x) => /jail|npc|dungeon/.test(x)));
check('the world-wide and irreversible ones stay (settime, setweather, pk, unpk, curse, schedule, war, wipechars)', ['settime', 'setweather', 'pk', 'unpk', 'curse', 'schedule', 'war', 'wipechars'].every((c) => LEAD_ONLY.has(c)));
check('none of the three is open to a Trial GM', !/\bjail\b|\bnpc\b|\bdungeon\b/.test(TRIAL));
// each is admin-flagged, so the chat gate refuses anyone who is not staff
const flagged = (file, cmd) => new RegExp(`registerChatCommand\\('${cmd}'[\\s\\S]*?\\{ admin: true`).test(fs.readFileSync(path.join(ROOT, file), 'utf8'));
check('/jail and /npc are admin-flagged', flagged('jail.js', 'jail') && flagged('gamemode.js', 'npc'));
check('/dungeon end needs staff in dungeons.js', /sub\.startsWith\('end '\) && isAdmin\(a\)/.test(fs.readFileSync(path.join(ROOT, 'dungeons.js'), 'utf8')));
check('each keeps its audit line (JAIL, ORPHAN, the lease end)', /audit\(`JAIL /.test(fs.readFileSync(path.join(ROOT, 'jail.js'), 'utf8'))
  && /audit\(`ORPHAN /.test(fs.readFileSync(path.join(ROOT, 'orphans.js'), 'utf8')) && /audit\(`GM \$\{who\(a\)\} ended the lease/.test(fs.readFileSync(path.join(ROOT, 'dungeons.js'), 'utf8')));

// ---- staffitemspells.js wording ----
const sis = fs.readFileSync(path.join(ROOT, 'staffitemspells.js'), 'utf8');
check('/giveitem and /takeitem say GM, as their gate is', !/Only a Lead GM or above manages player items/.test(sis) && (sis.match(/Only staff \(GM and above\) manage player items\./g) || []).length === 2 && /give an item to a player, online or offline \(GM and above\)/.test(sis));
check('...and their gate is unchanged (any staff tier; no cap)', (sis.match(/if \(!isLeadStaff\(caller\) && !isAdmin\(caller\)\) \{/g) || []).length === 4);

Date.now = realNow;
process.chdir(home);
fs.rmSync(dir, { recursive: true, force: true });
done();
