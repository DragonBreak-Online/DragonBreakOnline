// Scripted test for the alchemy rework's PC records pipeline (Nate, 14 Oct): tooling/xedit-scripts/DBO_AlchemyRecords.pas
// builds the records in DragonBreak Online Edits.esp and writes Edit Scripts\DBO_AlchemyRecords_result.txt;
// tools/alchemy-records-apply.js fills alchemy-rework.json from it. Checks:
// - the script's data block and alchemy-rework.json name exactly the same records (every key of `records` is built, every
//   built ALCH/MGEF has a key), every NEW: effect is one of its own MGEFs, the 29 bench fixes and the 2 kitchen FLOR;
// - the script checks everything before it changes anything, skips an EDID that exists, rolls back on a failed build,
//   and writes the result file and the run line the README gives;
// - the tool fills `records`, moves `_combosPlanned` into `combos` only when all their records are mapped, changes nothing
//   on a second run, keeps the file's layout, and refuses (writing nothing) a failed run, a foreign id, an unknown key or
//   two editor ids on one record;
// - alchemy.js, loaded with the filled file against records carrying those editor ids, maps every one.
// Run from server/: node tests/alchemy-records-apply-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SERVER = path.resolve(__dirname, '..');
process.chdir(SERVER);
let failures = 0, checks = 0;
const check = (name, ok, detail) => { checks++; if (!ok) { failures++; console.log(`FAIL ${name}${detail !== undefined ? ': ' + JSON.stringify(detail).slice(0, 400) : ''}`); } else console.log(`ok   ${name}`); };

const PAS_FILE = path.join('tooling', 'xedit-scripts', 'DBO_AlchemyRecords.pas');
const README = path.join('tooling', 'xedit-scripts', 'DBO_AlchemyRecords_README.md');
const TOOL = path.join('tools', 'alchemy-records-apply.js');
if (!fs.existsSync(PAS_FILE) || !fs.existsSync(TOOL)) { check('the script and the tool exist', false, [PAS_FILE, TOOL]); console.log(`\n${checks - failures}/${checks} passed`); process.exit(1); }
const PAS = fs.readFileSync(PAS_FILE, 'utf8');
const RW_TEXT = fs.readFileSync('alchemy-rework.json', 'utf8');
const RW = JSON.parse(RW_TEXT);

// ---- the data block ----
const lines = [...PAS.matchAll(/^ {2}D\('((?:[^']|'')*)'\);$/gm)].map((m) => m[1].replace(/''/g, "'").split('|'));
const kinds = (k) => lines.filter((l) => l[0] === k);
const M = kinds('M'), A = kinds('A'), F = kinds('F'), C = kinds('C');
check('data block: 10 MGEF, 129 ALCH, 2 FLOR, 29 bench fixes', M.length === 10 && A.length === 129 && F.length === 2 && C.length === 29, [M.length, A.length, F.length, C.length]);
const built = new Set(M.concat(A).map((l) => l[1]));
const keys = Object.keys(RW.records || {});
check('every key of alchemy-rework.json records is built by the script', keys.every((k) => built.has(k)), keys.filter((k) => !built.has(k)));
check('...and every MGEF and ALCH the script builds has a key', [...built].every((k) => keys.includes(k)), [...built].filter((k) => !keys.includes(k)));
check('no EDID twice', new Set(lines.filter((l) => 'MAF'.includes(l[0])).map((l) => l[1])).size === M.length + A.length + F.length);
const effects = A.flatMap((l) => l[8].split(';').map((e) => e.split(':')));
check('every NEW: effect is one of the script\'s own MGEFs', effects.filter((e) => e[0] === 'NEW').every((e) => M.some((m) => m[1] === e[1])), effects.filter((e) => e[0] === 'NEW' && !M.some((m) => m[1] === e[1])));
check('every other effect names its plugin, local id and editor id', effects.filter((e) => e[0] !== 'NEW').every((e) => e.length === 5 && /\.es[mpl]$/.test(e[0]) && /^[0-9a-f]{6}$/.test(e[1]) && e[2]));
check('every template names its plugin, local id and editor id', A.every((l) => /\.es[mpl]$/.test(l[3]) && /^[0-9a-f]{6}$/.test(l[4]) && l[5]) && M.every((l) => /^[0-9a-f]{6}$/.test(l[4]) && l[5]));
check('values and weights are whole numbers (weight in thousandths: no locale decimal point)', A.every((l) => /^\d+$/.test(l[6]) && /^\d+$/.test(l[7])));
const byEdid = Object.fromEntries(A.map((l) => [l[1], l]));
check('the Philter of Healing restores 60% with the slow effect, the Potion 20% at once', /NEW:DBO_AlchRestoreHealthSlowEffect:60:0$/.test(byEdid.DBO_AlchRestoreHealthT4[8]) && /NEW:DBO_AlchRestoreHealthEffect:20:0$/.test(byEdid.DBO_AlchRestoreHealthT1[8]));
check('a Potent Poison: 40 points and 3 a second for 10 s (the design\'s points; the server reads points / 200)', byEdid.DBO_AlchPoisonHealthT3[8] === 'Skyrim.esm:03eb42:AlchDamageHealth:40:0;Skyrim.esm:10aa4a:AlchDamageHealthDuration:3:10');
check('Fortify One-handed uses the vanilla One-handed effect; Fortify Blade the DBO one', /AlchFortifyOneHanded:10:60$/.test(byEdid.DBO_AlchFortifyOneHandedT3[8]) && /NEW:DBO_AlchFortifyBladeEffect:10:60$/.test(byEdid.DBO_AlchFortifyBladeT3[8]));
check('the Blood Potion keeps Dawnguard\'s feeding effect and restores 20%', byEdid.DBO_AlchBloodPotion[3] === 'Dawnguard.esm' && /DLC1BloodPotionEffect:0:0;NEW:DBO_AlchRestoreHealthEffect:20:0$/.test(byEdid.DBO_AlchBloodPotion[8]));
check('the sap drops the vanilla Fortify Health 100 for 25% less damage taken', !/AlchFortifyHealth/.test(byEdid.DBO_AlchSleepingTreeSap[8]) && /NEW:DBO_AlchSleepingTreeSapEffect:25:45$/.test(byEdid.DBO_AlchSleepingTreeSap[8]));
check('the kitchen flora are copies of DragonBreak Harvest\'s jug and sack', F.map((l) => `${l[1]}<${l[4]}`).join() === 'DBO_HarvestJugOfMilk<RP_HarvestJugOfMilk,DBO_HarvestFlourSack<RP_HarvestFlourSack');
check('bench fixes: 3 loom recipes to MCE_CraftingLoom, 25 smithing ones to the forge, the AOTV cloak to its own forge', C.filter((l) => /^DBOLOOM_/.test(l[1])).every((l) => l[5] === 'MCE_CraftingLoom' && l[4] === 'MoreCraftableEquipment.esp')
  && C.filter((l) => /^DBOLOOM_/.test(l[1])).length === 3 && C.filter((l) => /^DBOSM_/.test(l[1])).length === 25 && C.filter((l) => /^DBOSM_|^AOTV/.test(l[1])).every((l) => l[5] === 'CraftingSmithingForge' && l[4] === 'Skyrim.esm'));

// ---- the script's safety ----
check('the script checks everything first and changes nothing when anything is wrong', /if Errors = 0 then CheckAll;\s*if Errors > 0 then begin[^]*?FATAL: nothing changed/.test(PAS));
check('...looks each record up by local id and checks its signature and editor id', /\(Signature\(r\) <> sig\) or \(EditorID\(r\) <> edid\)/.test(PAS));
check('...refuses a template that points outside DragonBreak Online Edits\' masters', /function MastersOk[^]*HasMaster\(Dle, GetFileName\(f\)\)/.test(PAS) && (PAS.match(/MastersOk\(t, fl\[1\]\)/g) || []).length === 3);
check('...skips an EDID that already exists in DLE, and still reports its id', (PAS.match(/r := InDle\('(MGEF|ALCH|FLOR)', fl\[1\]\);\s*if Assigned\(r\) then begin slLog\.Add\('EXISTS\|' \+ fl\[1\]\); Inc\(Existing\);/g) || []).length === 3);
check('...copies each template as a new record', (PAS.match(/wbCopyElementToFile\(t, Dle, True, True\)/g) || []).length === 3);
check('...sets EDID, FULL, value, weight, effects, magnitudes and durations', ['SetEditorID(r, fl[1])', "SetElementEditValues(r, 'FULL', fl[2])", "'ENIT\\Value'", "SetElementNativeValues(r, 'DATA'", "'EFIT\\Magnitude'", "'EFIT\\Duration'", "SetElementNativeValues(e, 'EFID'"].every((x) => PAS.includes(x)));
check('...rolls back what it made and the benches it changed when the build fails', /if Errors > 0 then begin\s*Rollback;/.test(PAS) && /Remove\(ObjectToElement\(slMade\.Objects\[i\]\)\)/.test(PAS));
check('...writes Edit Scripts\\DBO_AlchemyRecords_result.txt as JSON with a records object', /RESULT_FILE = 'DBO_AlchemyRecords_result\.txt'/.test(PAS) && /sl\.SaveToFile\(ScriptsPath \+ RESULT_FILE\)/.test(PAS) && PAS.includes(`sl.Add(' "records": {');`));
const RUN = 'SSEEdit.exe -D:"<dev Data>" -P:"<server\\plugins.server.txt>" -autoload -script:DBO_AlchemyRecords.pas -autoexit';
check('the run line (with -D and -P) is in the script and the README', PAS.includes(RUN) && fs.existsSync(README) && fs.readFileSync(README, 'utf8').includes(RUN));
if (fs.existsSync(README)) {
  const RD = fs.readFileSync(README, 'utf8');
  check('the README has the PC diff record by record, the leftover .save file and the poison test', /record by record/i.test(RD) && /\.save/.test(RD) && /poisons\.judge/.test(RD));
}

// ---- the tool ----
const { apply, format } = require(path.resolve(TOOL));
let n = 0x18e000;
const ids = Object.fromEntries([...M, ...A, ...F].map((l) => [l[1], `${(n++).toString(16)}:DragonBreak Online Edits.esp`]));
const result = (records, extra = {}) => JSON.stringify(Object.assign({ status: 'DONE created 141, existing 0, benches fixed 29', created: 141, existing: 0, benchesFixed: 29, errors: 0, records }, extra));
let r = apply('﻿' + result(ids), RW);
check('a full result fills every record', r.ok && r.filled === keys.length && r.missing.length === 0 && Object.values(r.rework.records).every(Boolean), r.error || r.missing);
check('...moves the six planned combinations into combos and drops _combosPlanned', r.ok && r.moved === 6 && r.rework.combos.length === 6 && !('_combosPlanned' in r.rework));
check('...names the placement bases it leaves out', r.ok && r.extra.join() === 'DBO_HarvestJugOfMilk,DBO_HarvestFlourSack');
const again = r.ok ? apply(result(ids), r.rework) : { ok: false };
check('a second run changes nothing', again.ok && again.changed === 0 && JSON.stringify(again.rework) === JSON.stringify(r.rework));
check('the layout stays alchemy-rework.json\'s own (only the filled lines differ)', format(RW) === RW_TEXT);
const part = Object.fromEntries(Object.entries(ids).filter(([k]) => !/^DBO_AlchCombo.*T5$/.test(k)));
r = apply(result(part), RW);
check('a combination missing its Master record stays planned', r.ok && r.moved === 0 && r.rework._combosPlanned.length === 6 && r.missing.length === 6);
for (const [why, text] of [['a FATAL run', result({}, { status: 'FATAL: nothing changed' })], ['a run with errors', result(ids, { errors: 2 })],
  ['an id in another plugin', result(Object.assign({}, ids, { DBO_AlchLightT2: '801:DragonBreak.esp' }))], ['a key alchemy-rework.json has no place for', result(Object.assign({}, ids, { DBO_AlchNothing: 'abc:DragonBreak Online Edits.esp' }))],
  ['two editor ids on one record', result(Object.assign({}, ids, { DBO_AlchLightT2: ids.DBO_AlchLightT3 }))], ['a file that is not JSON', 'DONE']]) {
  check(`refused: ${why}`, apply(text, RW).ok === false);
}
// the command line: a refusal writes nothing; --dry-run writes nothing; a real run writes the file
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alch-apply-'));
const rwCopy = path.join(tmp, 'alchemy-rework.json'), resFile = path.join(tmp, 'result.txt');
fs.writeFileSync(rwCopy, RW_TEXT);
fs.writeFileSync(resFile, result({}, { status: 'FATAL: nothing changed' }));
let code = 0; try { execFileSync(process.execPath, [TOOL, resFile, rwCopy], { stdio: 'pipe' }); } catch (e) { code = e.status; }
check('the command refuses a FATAL result and leaves the file alone', code === 1 && fs.readFileSync(rwCopy, 'utf8') === RW_TEXT);
fs.writeFileSync(resFile, result(ids));
execFileSync(process.execPath, [TOOL, resFile, rwCopy, '--dry-run'], { stdio: 'pipe' });
check('--dry-run writes nothing', fs.readFileSync(rwCopy, 'utf8') === RW_TEXT);
execFileSync(process.execPath, [TOOL, resFile, rwCopy], { stdio: 'pipe' });
const filled = JSON.parse(fs.readFileSync(rwCopy, 'utf8'));
check('a real run writes the filled file', Object.values(filled.records).every(Boolean) && filled.combos.length === 6);

// ---- the record-by-record diff the README asks for ----
{
  const sub = (sig, data) => { const b = Buffer.alloc(6 + data.length); b.write(sig, 0, 'ascii'); b.writeUInt16LE(data.length, 4); data.copy(b, 6); return b; };
  const rec = (sig, fid, subs) => { const body = Buffer.concat(subs); const h = Buffer.alloc(24); h.write(sig, 0, 'ascii'); h.writeUInt32LE(body.length, 4); h.writeUInt32LE(fid, 12); return Buffer.concat([h, body]); };
  const grup = (label, recs) => { const body = Buffer.concat(recs); const h = Buffer.alloc(24); h.write('GRUP', 0, 'ascii'); h.writeUInt32LE(24 + body.length, 4); h.write(label, 8, 'ascii'); return Buffer.concat([h, body]); };
  const z = (s) => Buffer.from(s + '\0', 'latin1');
  const plugin = (recs) => Buffer.concat([rec('TES4', 0, [sub('HEDR', Buffer.alloc(12))]), grup('ALCH', recs)]);
  const a = rec('ALCH', 0x01000801, [sub('EDID', z('DBO_Skill_cook_T1')), sub('FULL', z('Marker'))]);
  const b = rec('ALCH', 0x01000802, [sub('EDID', z('DBO_AlchLightT2')), sub('FULL', z('Draught of Light'))]);
  const a2 = rec('ALCH', 0x01000801, [sub('EDID', z('DBO_Skill_cook_T1')), sub('FULL', z('Marker')), sub('EFID', Buffer.alloc(4))]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alch-diff-'));
  const w = (n, buf) => { const f = path.join(dir, n); fs.writeFileSync(f, buf); return f; };
  const before = w('before.esp', plugin([a])), good = w('good.esp', plugin([a, b])), bad = w('bad.esp', plugin([a2, b]));
  const run = (x, y) => { try { return { code: 0, out: execFileSync('python3', ['-I', path.resolve('tools', 'plugin_record_diff.py'), x, y, '--allow-edid-prefix', 'DBO_Alch'], { encoding: 'utf8' }) }; } catch (e) { return { code: e.status, out: String(e.stdout || '') }; } };
  let d = run(before, good);
  check('plugin_record_diff.py: only the new DBO_Alch record added -> OK', d.code === 0 && /ADDED   01000802 ALCH DBO_AlchLightT2/.test(d.out), d.out);
  d = run(before, bad);
  check('...a marker spell that gained an effect on the re-save -> NOT OK, naming it', d.code === 1 && /CHANGED 01000801 ALCH DBO_Skill_cook_T1: EFID[^\n]*not expected/.test(d.out), d.out);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---- alchemy.js maps them all ----
const PLUGINS = { 'Skyrim.esm': 0x00, 'Dawnguard.esm': 0x02, 'BSAssets.esm': 0x07, 'BSHeartland.esm': 0x08, 'DragonBreak Online Edits.esp': 0x60 };
const idOf = (d) => { const [hex, plugin] = String(d).split(':'); if (!(plugin in PLUGINS)) return 0; return ((PLUGINS[plugin] << 24) | parseInt(hex, 16)) >>> 0; };
const RECS = {};
for (const [edid, desc] of Object.entries(filled.records)) RECS[idOf(desc)] = { type: M.some((m) => m[1] === edid) ? 'MGEF' : 'ALCH', editorId: edid, fields: [] };
const logs = [];
const mp = { getIdFromDesc: idOf, getDescFromId: () => '', get: () => undefined, set: () => {}, lookupEspmRecordById: (id) => (RECS[id] ? { record: RECS[id], toGlobalRecordId: (l) => l } : null), onEatItem: () => true };
const AL = path.resolve('alchemy.js'); delete require.cache[AL];
// alchemy.js reads alchemy-rework.json from the cwd: the filled copy goes in through the config override
try { require(AL)({ mp, cfg: { alchemyRework: filled }, log: (...x) => logs.push(x.join(' ')), personal: () => {}, audit: () => {}, who: () => '', display: () => '', openWidget: () => {}, closeWidget: () => {}, every: () => {}, itemName: () => '', onUi: () => {}, sendPacket: () => {} }); } catch (e) { logs.push('THREW ' + e.message); }
check('alchemy.js with the filled file maps every PC record (none unmapped, none refused)', logs.some((l) => /^alchemy on:/.test(l)) && !logs.some((l) => /not mapped yet|rework record .* left out|THREW/.test(l)), logs.filter((l) => /mapped|rework record|THREW/.test(l)));
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
