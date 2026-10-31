// Skill books, studied (skillbooks.js, Leader 31 Oct, skill-books-1031.md): the DBO skill a book trains (by skills.json
// vanillaSkills), the place, the study time, once per book, three a day, the Scholar's bonus, and inert until the fork's
// __alduinakMasteryStudy ships (manuals.js keeps its old smithing award until then).
//   node tests/skillbooks-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);
let pass = 0, fail = 0;
const ok = (c, what, got) => { if (c) pass++; else { fail++; console.log('FAIL', what, got === undefined ? '' : JSON.stringify(got)); } };

const book = (av, edid) => { const d = new Uint8Array(16); d[0] = 0x01; new DataView(d.buffer).setInt32(4, av, true); return { type: 'BOOK', editorId: edid, fields: [{ type: 'DATA', data: d }] }; };
const LORE = { type: 'BOOK', editorId: 'BookMiningLore', fields: [{ type: 'DATA', data: new Uint8Array(16) }] };
const RECORDS = { 0x1b0a1: book(12, 'SkillLightArmor1'), 0x1b0a2: book(11, 'SkillHeavyArmor2'), 0x1b0a3: book(9, 'SkillBlock1'), 0x1b0a4: book(6, 'SkillOneHanded3'),
  0x1b0a5: book(15, 'SkillSneak1'), 0x1b0a6: book(17, 'SkillSpeechcraft2'), 0x1b0a7: book(22, 'SkillRestoration1'), 0x1b0a8: book(16, 'SkillAlchemy1'), 0x2c001: LORE };
const A = 0xff000001;
const props = new Map();
const put = (k, v) => props.set(`${A}|${k}`, v);
const mp = {
  get: (a, k) => props.get(`${a}|${k}`), set: (a, k, v) => props.set(`${a}|${k}`, v),
  lookupEspmRecordById: (id) => (RECORDS[id >>> 0] ? { record: RECORDS[id >>> 0] } : null),
  getDescFromId: (id) => `${(id >>> 0).toString(16)}:Skyrim.esm`, getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) >>> 0,
};
const told = [], audits = [], timers = [], studied = [];
const savedTimeout = global.setTimeout; global.setTimeout = (fn) => { timers.push(fn); return 0; };
const run = () => { while (timers.length) timers.shift()(); };
let now = Date.UTC(2026, 10, 1, 18, 0);
const realNow = Date.now; Date.now = () => now;
let safe = true;
globalThis.__dboSafeZone = () => safe;
const load = (cfgB) => require(path.resolve(ROOT, 'skillbooks.js'))({ mp, log: () => {}, personal: (a, t) => told.push(t), audit: (t) => audits.push(t), who: () => 'Aldric', cfg: { skillBooks: Object.assign({ extraBooks: { '2c001:Skyrim.esm': 'miner' } }, cfgB || {}) } });   // verify-formids: ignore - a made-up lore book for the stub
const mastery = (skills) => put('private.mastery', { order: Object.keys(skills), skills: Object.fromEntries(Object.entries(skills).map(([k, [level, rank]]) => [k, { level, rank: rank || 0 }])) });
const reset = () => { told.length = 0; props.forEach((v, k) => { if (/dboStudiedBooks|dboStudyDay/.test(k)) props.delete(k); }); };
put('pos', [0, 0, 0]); put('worldOrCellDesc', 'tamriel');

// Inert: no fork hook, so the read is not ours (null) and manuals.js keeps its own path
delete globalThis.__alduinakMasteryStudy;
load();
mastery({ defense: [30, 1] });
ok(globalThis.__dboSkillBookRead(A, 0x1b0a1) === null, 'without the fork\'s __alduinakMasteryStudy the read is not ours: null, inert');
const man = fs.readFileSync(path.join(ROOT, 'manuals.js'), 'utf8');
ok(/const studied = typeof globalThis\.__dboSkillBookRead === 'function' \? globalThis\.__dboSkillBookRead\(a, bookId >>> 0\) : null;\n\s*if \(studied !== null && studied !== undefined\) \{ if \(studied\) personal\(a, studied\); return undefined; \}\n\s*const line = skillBook\(a, bookId >>> 0\);/.test(man), 'manuals.js asks skillbooks.js first and keeps its smithing award when the answer is null');

// The hook ships
globalThis.__alduinakMasteryStudy = (a, skill, levels, key) => { studied.push({ skill, levels, key }); const lv = 30 + levels; return { units: levels * 20, gained: 0, level: Math.floor(lv) }; };
load();
reset(); studied.length = 0;
let line = globalThis.__dboSkillBookRead(A, 0x1b0a1);
ok(/You settle down to study Light Armor/.test(line) && !studied.length, 'a Light Armor book, read at an inn: study begins, nothing given yet', line);
run();
ok(studied.length === 1 && studied[0].skill === 'defense' && studied[0].levels === 0.5, '...after the study, Defense gets half a level through the fork hook', studied);
ok(told.some((t) => /What Light Armor teaches stays with you: your Defense grows/.test(t)) && audits.some((t) => /^SKILLBOOK Aldric studied SkillLightArmor1: Defense \+10 units$/.test(t)), '...told and audited', [told, audits]);
line = globalThis.__dboSkillBookRead(A, 0x1b0a1);
ok(/You know Light Armor already/.test(line), 'once per book per character', line);
// Heavy Armor and Block also train Defense; a fourth book in a day is refused
studied.length = 0;
globalThis.__dboSkillBookRead(A, 0x1b0a2); run();
globalThis.__dboSkillBookRead(A, 0x1b0a3); run();
ok(studied.length === 2 && studied.every((s) => s.skill === 'defense'), 'Heavy Armor and Block books train Defense too (the PvP skill)', studied);
mastery({ defense: [31, 1], blade: [20, 0], blunt: [40, 1] });
line = globalThis.__dboSkillBookRead(A, 0x1b0a4);
ok(/studied 3 books today/.test(line), 'a fourth book in one day waits for tomorrow', line);
now += 86400000;
studied.length = 0;
globalThis.__dboSkillBookRead(A, 0x1b0a4); run();
ok(studied.length === 1 && studied[0].skill === 'blunt', 'a One-Handed book trains the higher held of Blade (20) and Blunt (40)', studied);
// A skill not taken up, the mapped extras, and a lore book named by config
line = globalThis.__dboSkillBookRead(A, 0x1b0a8);
ok(/would teach Alchemist, a skill you have not taken up/.test(line), 'a skill not taken up: told which, nothing given', line);
mastery({ lockpicking: [10, 0], scholar: [55, 2], miner: [12, 0] });
studied.length = 0;
globalThis.__dboSkillBookRead(A, 0x1b0a5); run();
globalThis.__dboSkillBookRead(A, 0x1b0a6); run();
now += 86400000;   // three that day already, with the One-Handed book
globalThis.__dboSkillBookRead(A, 0x2c001); run();
ok(studied.map((s) => s.skill).join() === 'lockpicking,scholar,miner', 'Sneak trains Lockpicking, Speechcraft trains Scholar, a lore book in extraBooks trains Mining', studied);
ok(studied.every((s) => s.levels === 0.625), '...and an Adept Scholar takes a quarter more (0.625 of a level)', studied);
// The place, the hold, and Expert
now += 86400000;
mastery({ priest: [30, 1] });
safe = false;
line = globalThis.__dboSkillBookRead(A, 0x1b0a7);
ok(/wants study, in a quiet place/.test(line), 'out on the road: no study', line);
put('worldOrCellDesc', '12cb:BSHeartland.esm');
studied.length = 0;
line = globalThis.__dboSkillBookRead(A, 0x1b0a7);
ok(/settle down to study/.test(line), '...a spell study point (the Bruma cathedral) is fit for study', line);
put('pos', [1000, 0, 0]);
run();
ok(!studied.length && told.some((t) => /lose the thread/.test(t)), 'walking off during the study loses it, and the book can be studied again', told.slice(-1));
put('pos', [0, 0, 0]);
globalThis.__alduinakMasteryStudy = () => ({ units: 0, gained: 0, level: 75, refused: 'ceiling' });
globalThis.__dboSkillBookRead(A, 0x1b0a7); run();
ok(told.some((t) => /nothing left to teach an expert Priest; the rest is practice/.test(t)) && !((props.get(`${A}|private.dboStudiedBooks`) || []).includes('1b0a7:Skyrim.esm')), 'past Expert the book teaches nothing, and is not marked read', told.slice(-1));
put('private.dboSentence', { until: now + 1 });
safe = true;
ok(/wants study/.test(globalThis.__dboSkillBookRead(A, 0x1b0a7)), 'never in a jail cell');
props.delete(`${A}|private.dboSentence`);
ok(globalThis.__dboSkillBookRead(A, 0x99999) === null, 'any other book is not ours');

// Wiring and config
const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
ok(/require\(SKILLBOOKS_JS\)\(\{ mp, log, personal, audit, who, cfg \}\)/.test(gm), 'gamemode.js loads skillbooks.js');
const cfgFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8')).skillBooks || {};
ok(cfgFile.levels === 0.5 && cfgFile.perDay === 3 && cfgFile.extraSkills && cfgFile.extraSkills.Speechcraft === 'scholar', 'gamemode-config.json skillBooks: half a level, 3 a day, the extras', cfgFile);

global.setTimeout = savedTimeout; Date.now = realNow;
console.log(`${pass}/${pass + fail}`);
process.exitCode = fail ? 1 : 0;
