// smithing.js audits the forge crafts it refuses (B, 23 Oct): a craft refused for the craft tier, a people's own work or an
// unknown technique left no line in the log, only the client's echo of the undone craft ('Recipe not found'). The audit
// follows the smith's notice and its throttle, as regions.js audits REGION refusals, and copies none of the notice's text.
// Loads the real smithing.js with the real smithing.json, loot-materials.json and faction-gear.json in a scratch folder.
//   node tests/smithing-audit-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };

const dir = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-jake-b-smithaudit-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
for (const f of ['smithing.json', 'loot-materials.json', 'faction-gear.json']) fs.copyFileSync(path.join(SERVER, f), path.join(dir, f));
process.chdir(dir);

const GLASS = 0x0010cf98, ORCISH = 0x0010ded4, YOKU = 0x42000800, STEEL = 0x43001011;
const DESC = new Map([[GLASS, '10cf98:Skyrim.esm'], [ORCISH, '10ded4:Skyrim.esm'], [YOKU, '800:YokuWeapons.esp'], [STEEL, '1011:Immersive Weapons.esp']]);
const lm = JSON.parse(fs.readFileSync('loot-materials.json', 'utf8')).items;
ok(lm['10cf98:skyrim.esm'] === 'glass' && lm['10ded4:skyrim.esm'] === 'orcish' && lm['800:yokuweapons.esp'] === 'yoku' && lm['1011:immersive weapons.esp'] === 'steel',
  'fixtures: a Glass, an Orcish, a Yokudan and a Steel item, as loot-materials.json classes them');

// A forge recipe: its bench keyword is CraftingSmithingForge
const RECIPE = 0x000a1234, FORGE_KW = 0x00088105;
const rec = (record) => ({ record, toGlobalRecordId: (v) => v });
const RECORDS = new Map([
  [RECIPE, rec({ type: 'COBJ', fields: [{ type: 'BNAM', data: new Uint8Array([0x05, 0x81, 0x08, 0x00]) }] })],
  [FORGE_KW, rec({ type: 'KYWD', editorId: 'CraftingSmithingForge', fields: [] })],
]);

const props = new Map(), audits = [], told = [];
const A = 0xff000301;
const smith = (points) => props.set(`${A}|private.mastery`, { order: ['blacksmith'], skills: { blacksmith: { level: points, rank: 0 } } });
const mp = {
  get: (a, k) => props.get(`${a >>> 0}|${k}`), set: (a, k, v) => props.set(`${a >>> 0}|${k}`, v),
  getDescFromId: (id) => DESC.get(id >>> 0) || `${(id >>> 0).toString(16)}:Skyrim.esm`,
  getIdFromDesc: () => 0, lookupEspmRecordById: (id) => RECORDS.get(id >>> 0) || null, getEspmRecordIdsByType: () => [],
};
for (const k of Object.keys(globalThis)) if (/^__dbo(Smith|TemperCap)/.test(k)) delete globalThis[k];
require(path.join(SERVER, 'smithing.js'))({ mp, log: () => {}, personal: (a, t) => told.push(t), audit: (t) => audits.push(t), who: (a) => `Smith #T${(a >>> 0).toString(16)}`,
  cfg: { smithing: { enabled: true } }, registerChatCommand: () => {}, onlineActors: () => [A], findByName: () => 0, isAdmin: () => false, sendPacket: () => true, itemName: () => '' });
const craft = (item) => globalThis.__dboSmithCraft(A, item, RECIPE);
const fresh = () => globalThis.__dboSmithState.told.clear();

// The craft tier: a tier 1 smith at Glass (tier 5)
smith(0); fresh();
ok(craft(GLASS) === false && told.length === 1, 'a tier 1 smith is refused Glass and told why, as before');
ok(audits.length === 1 && /^SMITH refused Smith #Tff000301 Glass \(tier 5, crafter tier 1\): below its tier$/.test(audits[0]), 'and the refusal is audited: who, the family, both tiers and the reason', audits);
ok(craft(GLASS) === false && audits.length === 1 && told.length === 1, 'a second refusal within 3 s is neither told nor audited (the notice throttle)', audits.length);

// An unknown technique: a tier 7 smith, not an Orc, with no Orcish technique and no teacher near
smith(91); fresh();
ok(craft(ORCISH) === false && audits.length === 2 && /^SMITH refused Smith #Tff000301 Orcish \(tier 3, crafter tier 7\): technique unknown$/.test(audits[1]),
  'an unknown technique is audited', audits[1]);

// A people's own work: a tier 7 smith who is not a Redguard at Yokudan
fresh();
ok(craft(YOKU) === false && audits.length === 3 && /^SMITH refused Smith #Tff000301 Yokudan \(tier 3, crafter tier 7\): race only$/.test(audits[2]), 'a people\'s own work is audited', audits[2]);

// An allowed craft writes nothing: Steel needs no technique
smith(15); fresh();
ok(craft(STEEL) === true && audits.length === 3, 'an allowed craft is not audited', audits.length);

// The audit never carries the notice's text, and a clean site holds no quote
ok(audits.every((t) => !/Your materials|close the menu|Schematics|['"`]/.test(t)), 'no audit copies the notice or holds a quote', audits);
ok(told.length === 3 && told.every((t) => /Your materials come back when you close the menu\./.test(t)), 'the smith is still told each time, unchanged', told.length);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
