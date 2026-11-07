// The staff Give Spells list (the Leader, 1 Nov; Nat: "whatever you recommend"): /givespell finds a tome spell as before,
// then any castable spell no tome teaches (admin-powers.json staffSpells), by name or editor id, and says "staff only, not
// learnable"; a held spell (gamemode-config.json spells.removedSpells / suspendedSpells) is refused with why, unless the line
// ends in force. Players' lists are untouched: spells, the Give all list, stays the tome-taught catalogue.
//   node tests/staff-spells-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };

// ---- the tracked files ------------------------------------------------------------------------------------------------
// With the AI-forbidding mods' rows from the gitignored admin-powers.private.json where it is (privaterows.js, 2 Nov)
const whole = require(path.join(ROOT, 'privaterows.js')).readMerged(path.join(ROOT, 'admin-powers.json'), ['spells', 'staffSpells']);
const powers = whole.data;
const conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8')).spells || {};
const held = new Set([].concat(conf.removedSpells || [], conf.suspendedSpells || []).map((d) => String(d).toLowerCase()));
const playerIds = new Set(powers.spells.map((s) => s[0]));
ok(Array.isArray(powers.staffSpells) && powers.staffSpells.length > (whole.sidecar ? 900 : 700), `admin-powers.json carries the staff-only list (castable spells no tome teaches; sidecar ${whole.sidecar})`, (powers.staffSpells || []).length);
ok(powers.staffSpells.every((s) => Array.isArray(s) && s.length === 3 && /^[0-9a-f]+:.+/.test(s[0]) && s[1]), '...each [desc, name, edid]');
ok(!powers.staffSpells.some((s) => held.has(String(s[0]).toLowerCase())), '...never a held spell (removed or suspended)');
ok(!powers.staffSpells.some((s) => playerIds.has(s[0])), '...and none of the players\' tome spells (those stay where they were)');
ok(!powers.staffSpells.some((s) => /^\(|^[^A-Za-z]*$/.test(s[1])), '...placeholder names (":}", "((...))") replaced by the editor id');
ok(powers.shouts.length === 0 && powers.shoutsGate.length === 26, 'the players\' lists unchanged in shape: shouts empty, the gate 26 (Disarm left it on 5 Nov)');

// ---- /givespell, on a stub world ----------------------------------------------------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-staff-spells-'));
process.chdir(dir);
const STAFF = [['8f3f5:Skyrim.esm', 'Wall of Frost Hazard', 'HazardWallofFrostSpell'], ['a1000:Druadach.esm', 'Spectre Fire', 'DrV_SPECTREsummonfirespell'],
  ['c600:Dawnguard.esm', 'Summon Arvak', 'SummonArvak'], ['109111:Skyrim.esm', 'Transmute Mineral Ore', 'TransmuteOreMineral'],
  ['10d8d:Dawnguard.esm', 'Sun Fire', 'DLC1SunFireLeftHand']];
fs.writeFileSync('admin-powers.json', JSON.stringify({ spells: [], staffSpells: STAFF }));
fs.writeFileSync('spell-tomes.json', JSON.stringify({ tomes: [{ id: '1:Skyrim.esm', spellId: '12fcd:Skyrim.esm', spellName: 'Flames', fullName: 'Spell Tome: Flames', school: 'destruction' },
  { id: '3f51:Dawnguard.esm', spellId: '3f52:Dawnguard.esm', spellName: 'Sun Fire', fullName: 'Spell Tome: Sun Fire', school: 'Restoration' }] }));
fs.writeFileSync('admin-items.json', JSON.stringify({ categories: [] }));
const DESC = new Map(); const ID = new Map(); let next = 0x1000;
const idOfDesc = (d) => { d = String(d).toLowerCase(); if (!ID.has(d)) { ID.set(d, next); DESC.set(next, d); next++; } return ID.get(d); };
const PLAYER = 0xff000010, GM = 0xff000011;
const RECNAME = new Map(); let removeFails = false;
const told = [], audits = [], calls = [], cmds = new Map();
require(path.join(ROOT, 'staffitemspells.js'))({
  mp: { get: () => undefined, set: () => {}, getIdFromDesc: idOfDesc, getDescFromId: (id) => DESC.get(id >>> 0) || `${(id >>> 0).toString(16)}:Skyrim.esm`,
    lookupEspmRecordById: (id) => (RECNAME.has(id >>> 0) ? { record: { name: RECNAME.get(id >>> 0) } } : null),
    callPapyrusFunction: (...a) => { calls.push(a); return !(a[2] === 'RemoveSpell' && removeFails); } },
  log: () => {}, personal: (a, t) => told.push([a, t]), audit: (t) => audits.push(t), who: (a) => `#${(a >>> 0).toString(16)}`, display: String,
  nameOf: () => 'Jorik', tagOf: () => 'TW2F', profileOf: () => 126, onlineActors: () => [PLAYER, GM], isLeadStaff: (a) => a === GM, isAdmin: (a) => a === GM,
  giveItem: () => true, registerChatCommand: (n, f, o) => cmds.set(n, { f, o }), officialTarget: () => null,
  findByName: () => PLAYER, cfg: { spells: { removedSpells: ['109111:Skyrim.esm'], suspendedSpells: ['c600:Dawnguard.esm'], suspendedReasons: { 'c600:Dawnguard.esm': 'a summoned mount is not synced' } } },
});
// the target is found by the module's own resolver: give it a name that resolves
const last = (a) => { for (let i = told.length - 1; i >= 0; i--) if (told[i][0] === a) return told[i][1]; return ''; };
const give = (line) => { calls.length = 0; cmds.get('givespell').f(GM, line); return last(GM); };
ok(cmds.has('givespell') && /\[force\]/.test(cmds.get('givespell').o.help), '/givespell is registered; its help names force');
let r = give('#TW2F Flames');
ok(/^Granted spell 'Flames' to /.test(r) && !/staff only/.test(r), 'a tome spell: granted as before, not marked', r);
r = give('#TW2F Wall of Frost Hazard');
const addSpell = calls.find((c) => c[2] === 'AddSpell');
ok(/^Granted spell 'Wall of Frost Hazard' \(staff only, not learnable\) to /.test(r) && addSpell && addSpell[4][0].desc === '8f3f5:skyrim.esm', 'a no-tome spell by name: granted, marked staff only', [r, addSpell && addSpell[4]]);
ok(told.some(([a, t]) => a !== GM && /Staff granted you the spell: Wall of Frost Hazard \(staff only, not learnable\)\./.test(t)), '...the player is told it is staff only');
ok(audits.some((t) => /granted spell Wall of Frost Hazard .* \(staff only, not learnable\)/.test(t)), '...and the audit says so');
r = give('#TW2F DrV_SPECTREsummonfirespell');
ok(/'Spectre Fire' \(staff only, not learnable\)/.test(r), 'by editor id too', r);
r = give('#TW2F spectre');
ok(/'Spectre Fire'/.test(r), '...and by part of a name', r);
r = give('#TW2F Summon Arvak');
ok(/held back \(spells\.suspendedSpells: a summoned mount is not synced\)\. Add force/.test(r) && !calls.some((c) => c[2] === 'AddSpell'), 'a suspended spell is refused, with its reason', r);
r = give('#TW2F Summon Arvak force');
ok(/^Granted spell 'Summon Arvak' \(staff only, not learnable\)/.test(r) && audits.some((t) => /Summon Arvak .*\(forced past suspended\)/.test(t)), '...unless the line ends in force, audited as forced', r);
r = give('#TW2F Transmute Mineral Ore');
ok(/taken out of the game \(spells\.removedSpells\): it would be taken from them again at their next login\. Add force/.test(r), 'a removed spell is refused: it would be taken again at login', r);
r = give('#TW2F Transmute Mineral Ore force');
ok(/It is taken from them again at their next login\.$/.test(r), '...forced, the GM is told it will not last', r);
r = give('#TW2F 8f3f5:Skyrim.esm');
ok(/\(staff only, not learnable\)/.test(r), 'a staff-only spell by its id is marked too', r);

// A left-hand variant shares its spell's name (#bugs, 7 Nov: a staff grant of Sun Fire gave the left-hand one, and removing
// "Sun Fire" then removed nothing)
r = give('#TW2F sunfire');
ok(/^Granted spell 'Sun Fire' to /.test(r) && calls.some((c) => c[2] === 'AddSpell' && c[4][0].desc === '3f52:dawnguard.esm'), 'a name typed without its space finds the tome\'s Sun Fire, not the left-hand staff row', [r, calls.map((c) => c[4] && c[4][0])]);
r = give('#TW2F sun fire left hand');
ok(/^Granted spell 'Sun Fire \(left hand\)' \(staff only/.test(r) && calls.some((c) => c[2] === 'AddSpell' && c[4][0].desc === '10d8d:dawnguard.esm'), '...the left-hand variant only when asked for, and named so', r);
const take = (line) => { calls.length = 0; cmds.get('removespell').f(GM, line); return last(GM); };
const LEFT = idOfDesc('10d8d:Dawnguard.esm');
RECNAME.set(LEFT, 'Sun Fire');
globalThis.__dboSpellsLearned = () => [LEFT];
r = take('#TW2F Sun Fire');
ok(calls.some((c) => c[2] === 'RemoveSpell' && c[4][0].desc === '10d8d:dawnguard.esm') && /the one they held/.test(r), 'removing Sun Fire from someone who holds the left-hand one removes that one', [r, calls.map((c) => c[4] && c[4][0])]);
globalThis.__dboSpellsLearned = () => [];
removeFails = true;
r = take('#TW2F Flames');
ok(/does not hold Flames .*nothing removed/.test(r) && !audits.some((t) => /removed spell Flames/.test(t)), 'a removal the server refuses says so, and is not audited as done', r);
removeFails = false;
delete globalThis.__dboSpellsLearned;

process.chdir(ROOT);
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* EBUSY on Windows */ }
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
