// Give all Shouts gives only the player shouts (Nate, 16 Oct: "when i got all shouts it gave me every shouts that you
// shouldnt have"). ck-mcp/admin_powers.py wrote every SHOU of the load order into admin-powers.json (123: dragon breaths,
// Alduin's, Miraak's, Greybeard and quest copies, racial powers, werewolf howls, mod creature shouts), and both
// adminSystem.ts (the grant and the re-teach at login) and combat.js (the shout gate) read that list.
//   - admin-powers.json holds exactly player-shouts.json's 27, each with its own three words of power;
//   - the combat gate refuses a word outside the 27 even if admin-powers.json is regenerated with every SHOU;
//   - /shoutclean is staff-only and reconnects nobody while combat.shoutCleanup is off (the default).
// node tests/player-shouts-harness.js
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log('FAIL', what); } };

const allow = JSON.parse(fs.readFileSync(path.join(ROOT, 'player-shouts.json'), 'utf8')).shouts;
const key = (name, plugin) => `${name}|${plugin}`;
const allowSet = new Set(allow.map(([n, p]) => key(n, p)));
ok(allow.length === 27 && allowSet.size === 27, `the allow-list has the 27 player shouts (${allow.length})`);
const byPlugin = (p) => allow.filter((x) => x[1] === p).length;
ok(byPlugin('Skyrim.esm') === 20 && byPlugin('Dawnguard.esm') === 3 && byPlugin('Dragonborn.esm') === 4, 'vanilla 20, Dawnguard 3, Dragonborn 4');

const powers = JSON.parse(fs.readFileSync(path.join(ROOT, 'admin-powers.json'), 'utf8'));
const shouts = powers.shoutsGate || powers.shouts || [];
const pluginOf = (desc) => String(desc).slice(String(desc).indexOf(':') + 1);
const given = new Set(shouts.map((s) => key(s.name, pluginOf(s.shout))));
const extra = shouts.filter((s) => !allowSet.has(key(s.name, pluginOf(s.shout)))).map((s) => s.name);
ok(extra.length === 0, `Give all Shouts teaches nothing outside the allow-list (${extra.length}: ${extra.slice(0, 8).join(', ')}${extra.length > 8 ? ', ...' : ''})`);
const missing = allow.filter(([n, p]) => !given.has(key(n, p))).map((x) => x[0]);
ok(missing.length === 0, `and every player shout is in it (${missing.join(', ')})`);
ok(shouts.length === 27, `27 shouts in admin-powers.json (${shouts.length})`);
ok(Array.isArray(powers.shouts) && powers.shouts.length === 0, 'Give all shouts gives nothing: admin-powers.json shouts is empty (Nate 17 Oct), the gate reads shoutsGate');
// Non-player shouts carry a dragon's words (252c3..5) or the empty placeholder (ff8d7); a player shout has its own three
const PLACEHOLDER = new Set(['252c3:Skyrim.esm', '252c4:Skyrim.esm', '252c5:Skyrim.esm', 'ff8d7:Skyrim.esm']);
const badWords = shouts.filter((s) => (s.words || []).length !== 3 || new Set(s.words).size !== 3 || s.words.some((w) => PLACEHOLDER.has(w))).map((s) => s.name);
ok(badWords.length === 0, `every given shout has three words of its own (${badWords.join(', ')})`);
const NPC_NAME = /^(Dragon(?!rend)|L_|LShout|MQ|dun|DA13|dlc2MK)|Miraak|Greybeard|Alduin|Durnehviir|Forgemaster|Draugr|Howl|NordBattleCry|VoiceOfTheEmperor|BeastTongue|UndeadSummon/i;
const npcNamed = shouts.filter((s) => NPC_NAME.test(s.name)).map((s) => s.name);
ok(npcNamed.length === 0, `no dragon, Miraak, Greybeard, quest, racial or howl copy (${npcNamed.join(', ')})`);
ok(shouts.every((s) => ['Skyrim.esm', 'Dawnguard.esm', 'Dragonborn.esm'].includes(pluginOf(s.shout))), 'no mod creature shout');
// Give all spells has nothing to give (Jake, 17 Oct: it froze the server) until it is measured on dev (the Leader, 26 Oct).
// The batched give-all fork (68d0b736 adminSystem.ts giveAllSpells) reads spells, and spellsGiveAllOff when spells is empty,
// so the list waits in spellsMeasureFirst, which nothing reads
ok(Array.isArray(powers.spells) && powers.spells.length === 0 && !(powers.spellsGiveAllOff || []).length && (powers.spellsMeasureFirst || []).length > 0,
  'Give all spells has nothing to give: neither spells nor spellsGiveAllOff holds the list, which waits in spellsMeasureFirst');
ok(!!powers.werewolf && !!powers.vampirelord, 'the werewolf and Vampire Lord powers are untouched');

// ---- the combat gate reads the allow-list too -------------------------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-shouts-'));
  const here = process.cwd(); process.chdir(dir);
  const UF_SHOUT = 0x13e07, UF3 = 0x13f3a, DRAGON_SHOUT = 0x252c0, DRAGON_BREATH = 0x252c1, MIRAAK_SHOUT = 0x38b0c, MIRAAK_WORD = 0x38b10;
  // what the generator writes: every SHOU, the dragon's and Miraak's included
  fs.writeFileSync('admin-powers.json', JSON.stringify({ shouts: [
    { shout: '13e07:Skyrim.esm', name: 'UnrelentingForceShout', words: [] },
    { shout: '252c0:Skyrim.esm', name: 'DragonFireBreathShout01', words: [] },
    { shout: '38b0c:Dragonborn.esm', name: 'DLC2MiraakFireBreathShout', words: [] }] }));
  fs.copyFileSync(path.join(ROOT, 'player-shouts.json'), 'player-shouts.json');
  const spit = (type) => { const d = new Uint8Array(36); new DataView(d.buffer).setUint32(8, type, true); return d; };
  const snam = (spell) => { const d = new Uint8Array(12); new DataView(d.buffer).setUint32(4, spell, true); return d; };
  const voice = { type: 'SPEL', fields: [{ type: 'SPIT', data: spit(11) }] };
  const RECS = { [UF3]: voice, [DRAGON_BREATH]: voice, [MIRAAK_WORD]: voice,
    [UF_SHOUT]: { type: 'SHOU', fields: [{ type: 'SNAM', data: snam(UF3) }] },
    [DRAGON_SHOUT]: { type: 'SHOU', fields: [{ type: 'SNAM', data: snam(DRAGON_BREATH) }] },
    [MIRAAK_SHOUT]: { type: 'SHOU', fields: [{ type: 'SNAM', data: snam(MIRAAK_WORD) }] } };
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
  const mp = { get: (a, k) => (k === 'private.dboAllShouts' ? a === 1 : null), set: () => {}, getDescFromId: (a) => `${a.toString(16)}:x`,
    callPapyrusFunction: () => {}, getHoster: () => 0, getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16) };
  const logs = [];
  globalThis.__dboCombat = undefined;
  const c = require(path.join(ROOT, 'combat.js'))({ mp, log: (...x) => logs.push(x.join(' ')), profileOf: (a) => (a === 1 ? 1 : -1), masteryOf: () => null,
    wornOf: () => [], recordOf: (id) => (RECS[id] ? { record: RECS[id], toGlobalRecordId: (l) => l } : null),
    fieldsOf: (lr, t) => ((lr && lr.record.fields) || []).filter((f) => f.type === t), weaponSkillOf: () => '', display: String, cfg, sendPacket: () => {} });
  ok(c.shoutAllowed(1, UF3) === true, 'a granted player may use Unrelenting Force');
  ok(c.shoutAllowed(1, DRAGON_BREATH) === false, "a dragon's breath listed by a regenerated admin-powers.json is still refused");
  ok(c.shoutAllowed(1, MIRAAK_WORD) === false, "so is Miraak's");
  ok(logs.some((l) => /1 shout words allowed to players/.test(l)), `the gate counts only the allow-listed words (${logs.find((l) => /shout words/.test(l))})`);
  process.chdir(here); fs.rmSync(dir, { recursive: true, force: true });
}

// ---- /shoutclean: staff only, off by default ----------------------------------------------------------------------
{
  const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
  const i = gm.indexOf("registerChatCommand('shoutclean'");
  const body = i < 0 ? '' : gm.slice(i, gm.indexOf('\n}, {', i) + 200);
  ok(i >= 0, '/shoutclean is registered');
  ok(/\{ admin: true,/.test(body), '...for staff only');
  const gate = body.indexOf('shoutCleanup !== true'), kick = body.indexOf('mp.kick');
  ok(gate > 0 && kick > gate, '...and reconnects nobody before checking combat.shoutCleanup');
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
  ok(cfg.combat && cfg.combat.shoutCleanup === false, 'combat.shoutCleanup ships off');
}

console.log(`${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
