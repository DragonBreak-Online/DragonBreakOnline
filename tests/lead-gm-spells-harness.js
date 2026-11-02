// Single spells by staff (the Leader, 1 Nov): /givespell and /removespell on another player ask staffguard.js (kind "spells").
// A GM or Trial GM needs a GM call or ticket (call:<n> / ticket:<id>); a Lead GM or above gives a short reason (reason: <why>)
// instead, audited (STAFFREF) and sent to the staff log; the Owners pass. The words are taken out of the line before the
// command runs, so the spell is named cleanly. Real staffguard.js with this repo's staffPowers, real staffitemspells.js and
// spell-tomes.json, a chat line run as gamemode.js handleLine runs it.
//   node tests/lead-gm-spells-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT, MOD, CAST, load, call, check, done } = require('./lib/staffguard-fakes');
const ID = Object.fromEntries(Object.entries(CAST).map(([k, v]) => [k, v.id]));

const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
const f = load(CONFIG.staffPowers);
const staffLogged = [];
f.api.staffLog = (name, tier, what, detail) => staffLogged.push(`${what} | ${detail}`);
delete require.cache[MOD];
const G = f.G = require(MOD)(f.api);

// staffitemspells.js on the same cast; Flames is Skyrim.esm:012FCD in spell-tomes.json
const FLAMES = 0x12fcd;
const calls = [];
const mp = Object.assign({}, f.api.mp, {
  getIdFromDesc: (d) => { const m = /^([0-9a-f]+):skyrim\.esm$/i.exec(String(d)); return m ? parseInt(m[1], 16) : 0; },
  getDescFromId: (id) => `${(id >>> 0).toString(16)}:Skyrim.esm`,
  lookupEspmRecordById: () => null,
  callPapyrusFunction: (kind, cls, fn, self, args) => calls.push(`${fn} ${self.desc} ${args[0].desc}`),
});
const cmds = new Map();
const byId = f.byId;
const SIS = path.join(ROOT, 'staffitemspells.js');
process.chdir(ROOT);
delete require.cache[SIS];
require(SIS)(Object.assign({}, f.api, {
  mp, nameOf: (a) => (byId.get(a >>> 0) || {}).name || '', tagOf: (a) => (byId.get(a >>> 0) || {}).tag || '',
  isAdmin: (a) => !!f.api.staffTierOf(a), giveItem: () => {}, registerChatCommand: (n, fn) => cmds.set(n, fn),
}));
// A chat line as gamemode.js handleLine runs it: staffguard's command() takes call:/ticket:/reason: out and keeps it
const say = (a, cmd, line) => {
  calls.length = 0; f.said.length = 0;
  const r = G.command(a, cmd, `${cmd} ${(line.split(/\s+/)[0] || '').toLowerCase()}`, line);
  if (r && r.refuse) return r.refuse;
  const body = r && typeof r.body === 'string' ? r.body : line;
  const end = r && r.ref ? G.enter(a, r.ref) : null;
  try { cmds.get(cmd)(a, body); } finally { if (end) end(); }
  return f.said.filter((x) => x.a === (a >>> 0)).map((x) => x.t).join('\n');
};
const ADDED = `AddSpell ${(ID.BOB).toString(16)}:Skyrim.esm 12fcd:Skyrim.esm`;
const REMOVED = `RemoveSpell ${(ID.BOB).toString(16)}:Skyrim.esm 12fcd:Skyrim.esm`;
const REF_NO = /^This needs an open GM call or a ticket/;
const ASK = /^Give a short reason: end the command with reason: <why>/;

// ---- a GM: the call or the ticket ----
let out = say(ID.GM, 'givespell', 'Bob Flames');
check('a GM\'s /givespell on another player with no reference is refused, nothing given', REF_NO.test(out) && !calls.length, out);
out = say(ID.GM, 'givespell', 'Bob Flames reason: it bugged');
check('...a reason is no reference for a GM', REF_NO.test(out) && !calls.length, out);
f.audits.length = 0;
out = say(ID.GM, 'givespell', 'Bob Flames ticket:rep-0612');
check('...with a ticket it is given, the spell named cleanly', calls.join() === ADDED && /Granted spell 'Flames' to Bob/.test(out), [out, calls]);
check('...audited with the ticket (STAFFREF)', f.audits.some((t) => /^STAFFREF GM Gemma #GEMM \(profile 30\) spells on Bob #BOBB \(profile 60\) under ticket rep-0612$/.test(t)), f.audits);
call(7, 60, 30);
out = say(ID.GM, 'removespell', 'Bob Flames call:7');
check('a GM\'s /removespell with the player\'s GM call they hold', calls.join() === REMOVED, [out, calls]);
out = say(ID.TRIAL, 'givespell', 'Bob Flames');
check('a Trial GM is held to the same rule', REF_NO.test(out) && !calls.length, out);

// ---- a Lead GM: a short reason ----
out = say(ID.LEAD, 'givespell', 'Bob Flames');
check('a Lead GM with no reason is asked for one, nothing given', ASK.test(out) && !calls.length, out);
f.audits.length = 0; staffLogged.length = 0;
out = say(ID.LEAD, 'givespell', 'Bob Flames reason: his Flames vanished after the crash');
check('...with a reason it is given, the spell named cleanly', calls.join() === ADDED && /Granted spell 'Flames' to Bob/.test(out), [out, calls]);
check('...audited with the reason', f.audits.some((t) => /^STAFFREF GM Leda #LEAD \(profile 20\) spells on Bob #BOBB \(profile 60\) under reason "his Flames vanished after the crash"$/.test(t)), f.audits);
check('...and sent to the staff log', staffLogged.some((t) => /^spells \(Lead GM, no ticket\) \| GM Leda #LEAD \(profile 20\): spells on Bob #BOBB \(profile 60\), reason "his Flames vanished after the crash"$/.test(t)), staffLogged);
out = say(ID.LEAD, 'removespell', 'Bob Flames reason: given twice');
check('a Lead GM\'s /removespell on a reason', calls.join() === REMOVED, [out, calls]);
out = say(ID.LEAD, 'removespell', 'Bob Flames ticket:rep-0613');
check('...a ticket still works for a Lead GM', calls.join() === REMOVED, [out, calls]);
out = say(ID.OWNER, 'givespell', 'Bob Flames');
check('the Owners pass every rule, as everywhere', calls.join() === ADDED, [out, calls]);

// ---- the F7 panel's One spell (fork AdminSystem giveSpell / removeSpell, Lead GM and above) ----
const panel = (a, op, query, reason, force) => { calls.length = 0; return globalThis.__dboStaffSpell(a, ID.BOB, op, query, reason, force); };
let r = panel(ID.LEAD, 'give', 'Flames', '');
check('the panel: a Lead GM with no reason is asked for one, nothing given', !r.ok && ASK.test(r.text) && !calls.length, r);
f.audits.length = 0; staffLogged.length = 0;
r = panel(ID.LEAD, 'give', 'Flames', 'lost in the crash');
check('...with the panel\'s reason it is given, as by chat', r.ok && /^Granted spell 'Flames' to Bob/.test(r.text) && calls.join() === ADDED, [r, calls]);
check('...audited and staff-logged with that reason', f.audits.some((t) => /spells on Bob #BOBB \(profile 60\) under reason "lost in the crash"$/.test(t)) && staffLogged.some((t) => /reason "lost in the crash"$/.test(t)), [f.audits, staffLogged]);
r = panel(ID.LEAD, 'remove', 'Flames', 'given twice');
check('...and taken back the same way', r.ok && /^Removed spell 'Flames' from Bob/.test(r.text) && calls.join() === REMOVED, [r, calls]);
r = panel(ID.GM, 'give', 'Flames', 'please');
check('a GM\'s reason is no reference, from the panel either', !r.ok && REF_NO.test(r.text) && !calls.length, r);
// staff-perms-1102 opened single spells to GMs: from the panel too, their ticket or GM call is the reference
r = panel(ID.GM, 'give', 'Flames', 'ticket:rep-0613');
check('a GM\'s ticket from the panel is the reference, as on the chat line', r.ok && /^Granted spell 'Flames' to Bob/.test(r.text) && calls.join() === ADDED, [r, calls]);
r = panel(ID.GM, 'remove', 'Flames', 'call:7');
check('...and their open GM call', r.ok && calls.join() === REMOVED, [r, calls]);
r = panel(ID.GM, 'give', 'Flames', 'call:99');
check('...a call that is not open is refused, nothing given', !r.ok && !calls.length, r);
r = panel(ID.LEAD, 'give', 'No Such Spell Anywhere', 'x');
check('an unknown spell is said', !r.ok && /Could not find any spell matching 'No Such Spell Anywhere'/.test(r.text), r);
r = globalThis.__dboStaffSpell(ID.LEAD, ID.MIRA_ALT, 'give', 'Flames', 'x');
check('a player no longer online is said', !r.ok && /no longer online/.test(r.text), r);
const reasonAfter = globalThis.__dboStaffGuardState && globalThis.__dboStaffGuardState.ambient;
check('the panel\'s reason does not linger after the action', !reasonAfter, reasonAfter);

// ---- the wiring ----
const SG = fs.readFileSync(MOD, 'utf8');
check('staffguard takes the words out of /givespell and /removespell', /commands: \['rename', 'faction', 'appoint', 'dismiss', 'citizenship', 'staffref', 'givespell', 'removespell'\]/.test(SG));
check('..."spells" needs a reference, a Lead GM\'s reason standing for one', /kinds: \['rename', 'faction', 'office', 'citizenship', 'spells'\]/.test(SG) && /leadExemptKinds: \['faction', 'spells'\]/.test(SG));
check('gamemode-config.json staffPowers.callRef.leadExemptKinds names spells', JSON.stringify(CONFIG.staffPowers.callRef.leadExemptKinds) === '["faction","spells"]');
const SRC = fs.readFileSync(SIS, 'utf8');
check('both commands ask before they act, after the target is found', (SRC.match(/\{ const no = spellsNo\(caller, tgt\.actor\); if \(no\) return personal\(caller, no\); \}/g) || []).length === 2);

// ---- mutants: each altered copy (in a temp folder, never the tracked files) must fail this harness ----
if (!process.env.DBO_MUTANT_RUN) {
  const os = require('os');
  const { execFileSync } = require('child_process');
  const FILES = ['staffguard.js', 'staffitemspells.js', 'gamemode-config.json', 'spell-tomes.json', 'admin-items.json', 'tests/lead-gm-spells-harness.js', 'tests/lib/staffguard-fakes.js'];
  const MUTANTS = [
    ['/givespell asks no one', 'staffitemspells.js', "    { const no = spellsNo(caller, tgt.actor); if (no) return personal(caller, no); }\n    return personal(caller, grantSpell(", "    return personal(caller, grantSpell("],
    ['/removespell asks no one', 'staffitemspells.js', "    { const no = spellsNo(caller, tgt.actor); if (no) return personal(caller, no); }\n    return personal(caller, takeSpell(", "    return personal(caller, takeSpell("],
    ['the panel asks no one', 'staffitemspells.js', "    if (no) return { ok: false, text: no };\n", ''],
    ['the panel reads every text as a reason', 'staffitemspells.js', "    const m = /^(call|ticket):(\\S+)$/i.exec(why);\n", "    const m = null;\n"],
    ['spells needs no reference', 'staffguard.js', "'citizenship', 'spells'],", "'citizenship'],"],
    ['a Lead GM\'s reason does not stand for spells', 'staffguard.js', "leadExemptKinds: ['faction', 'spells'],", "leadExemptKinds: ['faction'],"],
    ['the config drops spells, which overrides the default', 'gamemode-config.json', '"leadExemptKinds": ["faction", "spells"]', '"leadExemptKinds": ["faction"]'],
    ['the words are left in the line', 'staffguard.js', "'staffref', 'givespell', 'removespell'],", "'staffref'],"],
  ];
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-spells-mutants-'));
  MUTANTS.forEach(([name, file, from, to], i) => {
    const dir = path.join(base, String(i));
    for (const x of FILES) { fs.mkdirSync(path.dirname(path.join(dir, x)), { recursive: true }); fs.copyFileSync(path.join(ROOT, x), path.join(dir, x)); }
    const p = path.join(dir, file);
    const s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
    if (!s.includes(from)) { check(`mutant "${name}": its line is still in ${file}`, false, from.slice(0, 80)); return; }
    fs.writeFileSync(p, s.replace(from, to));
    let o = '', crashed = false;
    try { o = execFileSync(process.execPath, [path.join(dir, 'tests', 'lead-gm-spells-harness.js')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { DBO_MUTANT_RUN: '1' }) }); }
    catch (e) { o = String(e.stdout || ''); crashed = /Error/.test(String(e.stderr || '')); }
    check(`mutant caught: ${name}`, /^FAIL/m.test(o) || crashed);
  });
  try { fs.rmSync(base, { recursive: true, force: true }); } catch (e) { /* a busy file on Windows */ }
}

done();
