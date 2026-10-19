// Scripted test for server\silvertest.js (mestreugway 16 Oct): Silver Test is offered only to a Dawnguard, Silver Hand or
// Vigil member carrying a silver weapon (supernatural.js's own silver test), the target answers in a panel, Accept lets
// that hunter's silver strike give the result to the two of them and deal no damage, a vampire or werewolf burns (a fire
// flash to those two only), Fight or Flee tells the hunter and plays the sunlight sound, a refused or unasked target
// reveals nothing, and the waits, the expiry and the gamemode's hit hook.
//   node tests/silvertest-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SUPER = path.join(ROOT, 'supernatural.js');
const MODULE = path.join(ROOT, 'silvertest.js');
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-silvertest-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });

let now = 1790000000000;
Date.now = () => now;
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!c) fails++; };

// Skyrim.esm: WeapMaterialSilver 10aa1a on SilverSword 10aa19; SteelSword 13989 carries WeapMaterialSteel 1e718
const KW_SILVER = 0x10aa1a, KW_STEEL = 0x1e718, SILVER_SWORD = 0x10aa19, STEEL_SWORD = 0x13989, FIREBOLT = 0x12fcd;
const u32 = (...v) => { const b = new Uint8Array(4 * v.length); const d = new DataView(b.buffer); v.forEach((x, i) => d.setUint32(4 * i, x >>> 0, true)); return b; };
const RECORDS = {
  [SILVER_SWORD]: { type: 'WEAP', editorId: 'SilverSword', fields: [{ type: 'KWDA', data: u32(KW_SILVER) }] },
  [STEEL_SWORD]: { type: 'WEAP', editorId: 'SteelSword', fields: [{ type: 'KWDA', data: u32(KW_STEEL) }] },
  [FIREBOLT]: { type: 'SPEL', editorId: 'Firebolt', fields: [] },
};
const HUNTER = 0x14, VAMP = 0x15, MORTAL = 0x16, WOLF = 0x17, PLAIN = 0x18, FAR = 0x19, VIGIL = 0x1a;
const store = new Map();
const papyrus = [];
const mp = {
  get: (id, p) => (p === 'type' ? 'MpActor' : store.get(`${id}|${p}`)),
  set: (id, p, v) => store.set(`${id}|${p}`, v),
  getDescFromId: (id) => `${id.toString(16)}:Skyrim.esm`,
  getIdFromDesc: (desc) => parseInt(String(desc).split(':')[0], 16) >>> 0,
  callPapyrusFunction: (...a) => { papyrus.push(a); return null; },
  lookupEspmRecordById: (id) => (RECORDS[id] ? { record: RECORDS[id], toGlobalRecordId: (x) => x >>> 0 } : null),
};
for (const a of [HUNTER, VAMP, MORTAL, WOLF, PLAIN, FAR, VIGIL]) { mp.set(a, 'worldOrCellDesc', 'c:Bruma'); mp.set(a, 'pos', a === FAR ? [5000, 0, 0] : [0, 0, 0]); }
mp.set(VAMP, 'private.supernatural', { kind: 'vampire', stage: 2, lastFed: 0 });
mp.set(WOLF, 'private.supernatural', { kind: 'werewolf' });
mp.set(HUNTER, 'inventory', { entries: [{ baseId: SILVER_SWORD, count: 1 }] });
mp.set(VIGIL, 'inventory', { entries: [{ baseId: STEEL_SWORD, count: 1 }] });
mp.set(PLAIN, 'inventory', { entries: [{ baseId: SILVER_SWORD, count: 1 }] });
mp.set(FAR, 'inventory', { entries: [{ baseId: SILVER_SWORD, count: 1 }] });
const GUILDS = { [HUNTER]: 'dawnguard', [VIGIL]: 'vigil-of-stendarr', [FAR]: 'silver-hand' };
globalThis.__dboGuildsOf = (a) => (GUILDS[a] ? [{ id: GUILDS[a], title: 'Member' }] : []);
const ONLINE = new Set([HUNTER, VAMP, MORTAL, WOLF, PLAIN, FAR, VIGIL]);

// supernatural.js as the gamemode loads it, for its silver test and the curse kinds
const noop = () => {};
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
delete globalThis.__dboSuperState;
mp.onHitDamageAttempt = () => true;
require(SUPER)({
  mp, log: noop, audit: noop, personal: noop, registerChatCommand: noop, onUi: noop, openWidget: noop, closeWidget: noop,
  sendPacket: noop, display: String, who: String, isAdmin: () => false, findByName: () => null, onlineActors: () => [], every: noop,
  profileOf: (a) => a, nameOf: String, isWorldspace: () => true, needsFeed: noop, hungerOf: () => 0, cfg: { supernatural: cfg.supernatural || {} },
});
ok(typeof globalThis.__dboSuperIsSilverWeapon === 'function', 'supernatural.js exports its silver weapon test');
ok(globalThis.__dboSuperIsSilverWeapon(SILVER_SWORD) === true && globalThis.__dboSuperIsSilverWeapon(STEEL_SWORD) === false, 'a silver sword is silver, a steel one is not');
ok(globalThis.__dboSuperKind(VAMP) === 'vampire' && globalThis.__dboSuperKind(WOLF) === 'werewolf' && !globalThis.__dboSuperKind(MORTAL), 'the curse kinds read from supernatural.js');

// silvertest.js
const out = { personal: [], widgets: [], closed: [], audits: [], packets: [], logs: [] };
const handlers = new Map(); let tick = null;
const api = {
  mp, log: (...a) => out.logs.push(a.join(' ')), personal: (a, t) => out.personal.push({ a, t }), audit: (t) => out.audits.push(t), who: (a) => `P${a.toString(16)}`,
  onlineActors: () => [...ONLINE], openWidget: (a, w, focus) => out.widgets.push({ a, w, focus }), closeWidget: (a, id) => out.closed.push({ a, id }),
  onUi: (ev, fn) => handlers.set(ev, fn), sendPacket: (a, p) => out.packets.push({ a, p }), every: (name, ms, fn) => { tick = fn; }, cfg: { silverTest: cfg.silverTest },
};
const load = (extra) => { handlers.clear(); delete require.cache[MODULE]; return require(MODULE)(Object.assign({}, api, extra ? { cfg: { silverTest: Object.assign({}, cfg.silverTest, extra) } } : {})); };
const T = load().TEXT;
ok(cfg.silverTest && cfg.silverTest.enabled === true && typeof cfg.silverTest._comment === 'string', 'gamemode-config.json has silverTest with a comment and enabled');
ok(!/—/.test(fs.readFileSync(MODULE, 'utf8')), 'no em dash in silvertest.js');

const S = () => globalThis.__dboSilverTest;
const clear = () => { for (const k of Object.keys(out)) out[k].length = 0; papyrus.length = 0; };
const told = (a) => out.personal.filter((x) => x.a === a).map((x) => x.t);
const entries = (a, t) => globalThis.__dboSilverTestEntries(a, t);
const ask = (a, t) => { clear(); return globalThis.__dboSilverTestAction(a, 'silver:test', t); };
const answer = (t, choice) => handlers.get('silverAnswer')(t, [choice]);
const strike = (a, t, src, flags) => globalThis.__dboSilverTestStrike(a, t, src, 10, flags || {});
const reset = () => { const s = S(); s.pending.clear(); s.accepted.clear(); s.hunterAt.clear(); s.pairAt.clear(); s.flashes = []; };

// Who may test
ok(entries(HUNTER, MORTAL).length === 1 && entries(HUNTER, MORTAL)[0].id === 'silver:test' && entries(HUNTER, MORTAL)[0].label === 'Silver Test', 'a Dawnguard with a silver sword gets Silver Test');
ok(entries(PLAIN, MORTAL).length === 0, 'no Silver Test for someone in none of the three orders');
ok(entries(VIGIL, MORTAL).length === 0, 'no Silver Test without a silver weapon');
ok(entries(FAR, MORTAL).length === 0, 'no Silver Test from far away');
ok(entries(HUNTER, HUNTER).length === 0, 'no Silver Test on yourself');
globalThis.__dboPvpAt = new Map([[MORTAL, now]]);
ok(entries(HUNTER, MORTAL).length === 0, 'no Silver Test in the middle of a fight');
globalThis.__dboPvpAt = new Map();
ask(PLAIN, MORTAL);
ok(told(PLAIN).some((t) => /Dawnguard/.test(t)) && !S().pending.size, 'an outsider who sends the action anyway is refused');

// The prompt
ask(HUNTER, MORTAL);
const w = out.widgets[0];
ok(w && w.a === MORTAL && w.focus === true && w.w.type === 'contextMenu' && w.w.id === 117 && w.w.targetName === 'You are being silver tested.', 'the target gets the panel: "You are being silver tested."', w);
ok(w && w.w.actions.map((x) => x.label).join('|') === 'Accept|Fight or Flee', 'with Accept and Fight or Flee', w && w.w.actions);
ok(w && w.w.events.action === 'dbo:silverAnswer' && w.w.events.close === 'dbo:silverClose', 'the panel answers through dbo:silverAnswer and dbo:silverClose');
ok(entries(HUNTER, MORTAL).length === 0 && entries(VIGIL, MORTAL).length === 0, 'no second test while one is asked');

// A silver hit before any answer reveals nothing
clear();
ok(strike(HUNTER, MORTAL, SILVER_SWORD) === false && !out.personal.length, 'a silver hit before the answer reveals nothing and is an ordinary hit');

// Accept, then the strike
clear(); answer(MORTAL, 'accept');
ok(told(HUNTER).includes(T.accepted), 'Accept: the hunter is told to strike', told(HUNTER));
ok(T.accepted === 'The subject has consented to the silver test. Strike them with your silver weapon, bash or swing, to examine their blood\'s reaction.', 'the accepted line as suggested, without the em dash');
ok(out.closed.some((c) => c.a === MORTAL && c.id === 117), 'the panel closes on the answer');
clear();
ok(strike(PLAIN, MORTAL, SILVER_SWORD) === false && !out.personal.length, 'someone else\'s silver tells nothing');
ok(strike(HUNTER, MORTAL, STEEL_SWORD) === false && !out.personal.length, 'the hunter\'s steel tells nothing and is an ordinary hit');
ok(strike(HUNTER, MORTAL, FIREBOLT, { spell: true }) === false, 'a spell is no test');
ok(strike(HUNTER, MORTAL, SILVER_SWORD, { blocked: true }) === false && S().accepted.has(MORTAL), 'a blocked swing is no test, and the test stays open');
ok(strike(HUNTER, MORTAL, SILVER_SWORD) === true, 'the hunter\'s silver swing is the test, and the hook refuses its damage');
ok(told(HUNTER).includes(T.normal) && told(MORTAL).includes(T.normal), 'a mortal: both are told the blood reacts normally');
ok(out.personal.every((x) => x.a === HUNTER || x.a === MORTAL), 'nobody else is told');
ok(!out.packets.some((x) => x.p.customPacketType === 'dboGlow'), 'no flash on a mortal');
ok(out.audits.some((t) => /SILVER P14 tested P16: no corruption/.test(t)), 'the result is audited', out.audits);
clear();
ok(strike(HUNTER, MORTAL, SILVER_SWORD) === false && !out.personal.length, 'a second silver hit is an ordinary hit and tells nothing');

// A vampire burns: a bash
reset(); ask(HUNTER, VAMP); answer(VAMP, 'accept'); clear();
ok(strike(HUNTER, VAMP, SILVER_SWORD, { bash: true }) === true, 'a silver bash is a test too');
ok(told(HUNTER).includes(T.burns) && told(VAMP).includes(T.burns), 'a vampire: the blood ignites, for both');
const glows = out.packets.filter((x) => x.p.customPacketType === 'dboGlow');
ok(glows.length === 2 && glows.every((x) => x.p.on === true && x.p.refs[0] === VAMP && x.p.shader === 0x1b212) && new Set(glows.map((x) => x.a)).size === 2 && glows.every((x) => x.a === HUNTER || x.a === VAMP), 'the fire flash goes to the hunter and the vampire only', glows);
clear(); now += 4000; tick();
const offs = out.packets.filter((x) => x.p.customPacketType === 'dboGlow' && x.p.on === false);
ok(offs.length === 2 && !S().flashes.length, 'the flash ends after flashSeconds');

// A werewolf in human form burns too
reset(); ask(HUNTER, WOLF); answer(WOLF, 'accept'); clear();
strike(HUNTER, WOLF, SILVER_SWORD);
ok(told(HUNTER).includes(T.burns), 'a werewolf: the blood ignites');

// harmless: false lets the strike's damage through, with the result
reset(); load({ harmless: false }); ask(HUNTER, MORTAL); answer(MORTAL, 'accept'); clear();
ok(strike(HUNTER, MORTAL, SILVER_SWORD) === false && told(HUNTER).includes(T.normal), 'harmless false: the result, and the hit lands');
load();

// Fight or Flee
reset(); ask(HUNTER, VAMP); clear(); answer(VAMP, 'refuse');
ok(told(HUNTER).includes(T.refused), 'Fight or Flee: the hunter is told the subject broke free', told(HUNTER));
const snd = papyrus[0];
ok(snd && snd[0] === 'method' && snd[1] === 'Sound' && snd[2] === 'Play' && snd[3].type === 'espm' && snd[3].desc === 'ff9eb:Skyrim.esm' && snd[4][0].desc === `${VAMP.toString(16)}:Skyrim.esm`, 'the vampire sunlight sound plays at the subject', snd);
clear();
ok(strike(HUNTER, VAMP, SILVER_SWORD) === false && !out.personal.length && !out.packets.length, 'hitting one who refused reveals nothing');
ok(entries(HUNTER, VAMP).length === 0, 'the hunter cannot ask the same subject again at once');
now += 31000;
ok(entries(HUNTER, MORTAL).length === 1, 'another subject after hunterSeconds');
now += 10 * 60000;
ok(entries(HUNTER, VAMP).length === 1, 'the same subject again after pairMinutes');

// Closing the panel and silence are refusals
reset(); ask(HUNTER, MORTAL); clear(); handlers.get('silverClose')(MORTAL);
ok(told(HUNTER).includes(T.refused) && !S().pending.size, 'closing the panel is Fight or Flee');
reset(); ask(HUNTER, MORTAL); clear(); now += 31000; tick();
ok(told(HUNTER).includes(T.refused) && !S().pending.size, 'no answer in answerSeconds is Fight or Flee');

// An accepted test lapses after strikeSeconds
reset(); ask(HUNTER, MORTAL); answer(MORTAL, 'accept'); clear(); now += 61000; tick();
ok(!S().accepted.size && told(HUNTER).some((t) => /passed/.test(t)), 'an accepted test with no strike lapses');
ok(strike(HUNTER, MORTAL, SILVER_SWORD) === false, 'a strike after the lapse tells nothing');

// The hunter walks off or logs out
reset(); ask(HUNTER, MORTAL); clear(); mp.set(HUNTER, 'pos', [3000, 0, 0]); tick(); mp.set(HUNTER, 'pos', [0, 0, 0]);
ok(!S().pending.size && out.closed.some((c) => c.a === MORTAL) && !papyrus.length, 'the hunter walking away drops the prompt, with no sound');
reset(); ask(HUNTER, MORTAL); answer(MORTAL, 'accept'); globalThis.__dboSilverTestLeave(HUNTER);
ok(!S().accepted.size, 'a logout ends the hunter\'s test');

// Switched off
reset(); load({ enabled: false });
ok(entries(HUNTER, MORTAL).length === 0, 'enabled false: not on the menu');
load();

// The gamemode wiring
const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
const hook = gm.indexOf("globalThis.__dboSilverTestStrike(agg, tgt, src, dmg, flags)) return false;");
ok(hook > 0 && hook < gm.indexOf("const prev = globalThis.__dboPrevHitDamageAttempt;\n  if (prev) {\n    try { if (prev(agg, tgt, src, dmg) === false) return false; }"), 'the hit hook asks silvertest.js before the fork chain and any damage');
ok(gm.indexOf("hitDamageAttemptHook =(") < hook, 'inside hitDamageAttemptHook');
ok(/require\(SILVERTEST_JS\)/.test(gm) && /'__dboSilverTestLeave'/.test(gm) && /'__dboSuperIsSilverWeapon'/.test(gm), 'gamemode loads silvertest.js, calls its leave and clears the silver export on a failed supernatural load');
const pm = fs.readFileSync(path.join(ROOT, 'playermenu.js'), 'utf8');
ok(/__dboSilverTestEntries\(a, t\)/.test(pm) && /__dboSilverTestAction\(a, id, t\)/.test(pm), 'playermenu.js offers and routes Silver Test');

console.log(fails ? `${fails} failure(s)` : 'all checks passed');
process.exit(fails ? 1 : 0);
