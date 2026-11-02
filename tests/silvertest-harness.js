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

// ---- teaching (Nat, 2 Nov) ----
const OFFICER = 0x1b, LEADER = 0x1c, STAFF = 0x1d, SHLEADER = 0x1e, PUPIL = 0x1f;
for (const a of [OFFICER, LEADER, STAFF, SHLEADER, PUPIL]) { mp.set(a, 'worldOrCellDesc', 'c:Bruma'); mp.set(a, 'pos', [0, 0, 0]); mp.set(a, 'profileId', a + 100); ONLINE.add(a); }
const ROLE = { [OFFICER]: 'officer', [LEADER]: 'leader', [SHLEADER]: 'leader' };
Object.assign(GUILDS, { [OFFICER]: 'dawnguard', [LEADER]: 'dawnguard', [SHLEADER]: 'silver-hand' });
globalThis.__dboGuildsOf = (a) => (GUILDS[a] ? [{ id: GUILDS[a], name: GUILDS[a] === 'dawnguard' ? 'Dawnguard' : 'Silver Hand', title: 'Member', role: ROLE[a] || 'member' }] : []);
const cmds = new Map();
Object.assign(api, {
  registerChatCommand: (n, f) => cmds.set(n, f), isAdmin: (a) => a === STAFF, display: (a) => `C${a.toString(16)}`,
  findByName: (q) => ({ pupil: PUPIL, mortal: MORTAL, vamp: VAMP }[String(q).toLowerCase()] || 0), offlineByTag: () => 0,
});
load();
const teachIn = (a, t) => entries(a, t).some((e) => e.id === 'silver:teach');
const teach = (a, t) => { clear(); return globalThis.__dboSilverTestAction(a, 'silver:teach', t); };
const learn = (t, choice) => handlers.get('silverTeachAnswer')(t, [choice]);
const MARK = 'private.dboSilverTaught';
const cmd = (a, line) => { clear(); cmds.get('silvertest')(a, line); return told(a).join(' | '); };
const resetTeach = () => { reset(); S().lessons.clear(); S().teacherAt.clear(); };
resetTeach();

ok(teachIn(OFFICER, MORTAL), 'a Dawnguard officer gets "Teach the Silver Test" on another player');
ok(entries(OFFICER, MORTAL).find((e) => e.id === 'silver:teach').label === 'Teach the Silver Test', '...labelled "Teach the Silver Test"');
ok(!teachIn(HUNTER, MORTAL) && !teachIn(PLAIN, MORTAL), 'a plain member and an outsider do not');
ok(teachIn(OFFICER, VAMP) && teachIn(OFFICER, HUNTER), 'the entry reads nothing of the learner (their blood or their order)');
teach(OFFICER, MORTAL);
const tw = out.widgets[0];
ok(tw && tw.a === MORTAL && tw.w.id === 118 && /C1b offers to teach you the silver test/.test(tw.w.targetName) && tw.w.actions.map((x) => x.label).join('|') === 'Learn it|Decline'
  && tw.w.events.action === 'dbo:silverTeachAnswer' && tw.w.events.close === 'dbo:silverTeachClose', 'the learner gets a panel: Learn it or Decline', tw);
ok(out.audits.some((t) => /^SILVERTEACH P1b offers to teach P16 the silver test \(dawnguard\)$/.test(t)), 'the offer is audited', out.audits);
clear(); learn(MORTAL, 'accept');
const mk = mp.get(MORTAL, MARK);
ok(mk && mk.faction === 'dawnguard' && mk.factionName === 'Dawnguard' && mk.byProfile === OFFICER + 100 && mk.byName === 'C1b', 'accepting marks the learner: who taught them and which order', mk);
ok(told(MORTAL).some((t) => /You learn the silver test from C1b of the Dawnguard/.test(t)) && out.audits.some((t) => /^SILVERTEACH P1b taught P16 the silver test \(dawnguard\)$/.test(t)), 'the learner is told, and it is audited', out.audits);
mp.set(MORTAL, 'inventory', { entries: [{ baseId: SILVER_SWORD, count: 1 }] });
ok(entries(MORTAL, PLAIN).some((e) => e.id === 'silver:test'), 'a taught player with a silver weapon gets Silver Test, without joining');
mp.set(MORTAL, 'inventory', { entries: [] });
ok(!entries(MORTAL, PLAIN).some((e) => e.id === 'silver:test'), '...and needs the silver weapon as a member does');
mp.set(MORTAL, 'inventory', { entries: [{ baseId: SILVER_SWORD, count: 1 }] });
ask(MORTAL, WOLF); answer(WOLF, 'accept'); clear();
ok(strike(MORTAL, WOLF, SILVER_SWORD) === true && told(MORTAL).includes(T.burns), '...and the same accept-and-strike flow works for them');
reset();
ok(!teachIn(OFFICER, PLAIN) && /Wait 30 more minute/.test((teach(OFFICER, PLAIN), told(OFFICER).join(' '))), 'one lesson per teacher every teachMinutes');
ok(teachIn(LEADER, PLAIN), '...a different teacher is not held by it');
now += 30 * 60000 + 1000;
ok(teachIn(OFFICER, PLAIN), 'after teachMinutes the officer may teach again');
teach(OFFICER, MORTAL);
ok(/already know the silver test/.test(told(OFFICER).join(' ')) && !out.widgets.length, 'a learner who already knows it is not asked again');
teach(OFFICER, HUNTER);
ok(/already know the silver test/.test(told(OFFICER).join(' ')) && !out.widgets.length, 'nor a member of an order');

// A vampire learns nothing, and the teacher cannot tell
resetTeach(); teach(OFFICER, VAMP); clear(); learn(VAMP, 'accept');
const tVamp = told(OFFICER).join(' ');
ok(!mp.get(VAMP, MARK), 'a vampire is not marked');
resetTeach(); teach(OFFICER, PUPIL); clear(); learn(PUPIL, 'accept');
ok(tVamp === told(OFFICER).join(' ') && tVamp.length > 0, 'the teacher hears exactly what they hear for a mortal (the blood is never revealed)', [tVamp, told(OFFICER).join(' ')]);
resetTeach(); teach(OFFICER, VAMP); clear(); learn(VAMP, 'accept');
ok(/will not take/.test(told(VAMP).join(' ')) && out.audits.some((t) => /^SILVERTEACH P15 could not learn the silver test from P1b \(dawnguard\): a vampire$/.test(t)), 'the vampire is told it will not take; the audit says why', out.audits);

// A taught player who turns loses it: at once on use, and on the ten-second sweep
mp.set(PUPIL, 'inventory', { entries: [{ baseId: SILVER_SWORD, count: 1 }] });
ok(entries(PUPIL, PLAIN).some((e) => e.id === 'silver:test'), 'the pupil may test');
mp.set(PUPIL, 'private.supernatural', { kind: 'werewolf' }); clear();
ok(!entries(PUPIL, PLAIN).some((e) => e.id === 'silver:test') && !mp.get(PUPIL, MARK) && out.audits.some((t) => /^SILVERTEACH P1f lost the silver test taught by the dawnguard: now a werewolf$/.test(t)), 'once turned, the test is gone and it is audited', out.audits);
mp.set(PUPIL, 'private.supernatural', null);
resetTeach(); teach(OFFICER, PUPIL); learn(PUPIL, 'accept');
mp.set(PUPIL, 'private.supernatural', { kind: 'vampire', stage: 1 }); clear();
for (let i = 0; i < 10; i++) tick();
ok(!mp.get(PUPIL, MARK) && out.audits.some((t) => /lost the silver test .*now a vampire/.test(t)), 'the sweep takes it from an online player who turned', out.audits);
mp.set(PUPIL, 'private.supernatural', null);

// Declining, closing and silence teach nothing
resetTeach(); teach(OFFICER, PUPIL); clear(); learn(PUPIL, 'refuse');
ok(!mp.get(PUPIL, MARK) && /turn the lesson down/.test(told(OFFICER).join(' ')) && out.audits.some((t) => /^SILVERTEACH P1f turned down the silver test from P1b \(declined\)$/.test(t)), 'declining teaches nothing', out.audits);
resetTeach(); teach(OFFICER, PUPIL); clear(); handlers.get('silverTeachClose')(PUPIL);
ok(!mp.get(PUPIL, MARK) && !S().lessons.size, 'closing the panel teaches nothing');
resetTeach(); teach(OFFICER, PUPIL); clear(); now += 31000; tick();
ok(!mp.get(PUPIL, MARK) && !S().lessons.size && out.audits.some((t) => /\(timeout\)/.test(t)), 'no answer in answerSeconds teaches nothing');
resetTeach(); teach(OFFICER, PUPIL); globalThis.__dboSilverTestLeave(OFFICER);
ok(!S().lessons.size, 'the teacher logging out drops the lesson');

// /silvertest and revoke
ok(/You know the silver test, taught by C1b of the Dawnguard/.test(cmd(MORTAL, '')), '/silvertest tells a taught player who taught them');
ok(/as a member of your order/.test(cmd(HUNTER, '')) && /do not know the silver test/.test(cmd(PLAIN, '')), '...a member, and someone who does not know it');
ok(/Only the leader of the order that taught them, or staff/.test(cmd(OFFICER, 'revoke mortal')) && !!mp.get(MORTAL, MARK), 'an officer cannot revoke');
ok(/Only the leader of the order that taught them, or staff/.test(cmd(SHLEADER, 'revoke mortal')) && !!mp.get(MORTAL, MARK), 'nor the leader of another order');
ok(/no longer knows the silver test/.test(cmd(LEADER, 'revoke mortal')) && !mp.get(MORTAL, MARK) && out.audits.some((t) => /^SILVERTEACH P1c revoked the silver test of P16 \(dawnguard\)$/.test(t))
  && told(MORTAL).some((t) => /The Dawnguard that taught you the silver test has taken it back/.test(t)), 'the teaching order\'s leader revokes it, audited, and the player is told', out.audits);
ok(!entries(MORTAL, PLAIN).some((e) => e.id === 'silver:test'), 'revoked, they can no longer test');
resetTeach(); teach(OFFICER, PUPIL); learn(PUPIL, 'accept');
ok(/no longer knows/.test(cmd(STAFF, 'revoke pupil')) && !mp.get(PUPIL, MARK), 'staff revoke it too');
ok(/was not taught/.test(cmd(STAFF, 'revoke pupil')) && /No character/.test(cmd(STAFF, 'revoke nobody')), 'revoking someone untaught, or no one, says so');

// Switches
resetTeach(); load({ teach: false });
ok(!teachIn(OFFICER, PUPIL), 'teach false: no lesson on the menu');
load({ teachRoles: ['leader'] });
ok(!teachIn(OFFICER, PUPIL) && teachIn(LEADER, PUPIL), 'teachRoles ["leader"]: only the leader teaches');
load();
ok(cfg.silverTest.teach === true && JSON.stringify(cfg.silverTest.teachRoles) === '["leader","officer"]' && cfg.silverTest.teachMinutes === 30 && /Nat, 2 Nov/.test(cfg.silverTest._teach || ''), 'gamemode-config.json: teach on, leader and officer, 30 minutes, the comment citing Nat');
ok(!/—/.test(fs.readFileSync(MODULE, 'utf8')), 'still no em dash in silvertest.js');

// The gamemode wiring
const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
ok(/require\(SILVERTEST_JS\)\(\{[^}]*registerChatCommand, isAdmin, findByName, offlineByTag \}\)/.test(gm), 'gamemode gives silvertest.js its command, staff check and name lookups');
const hook = gm.indexOf("globalThis.__dboSilverTestStrike(agg, tgt, src, dmg, flags)) return false;");
ok(hook > 0 && hook < gm.indexOf("const prev = globalThis.__dboPrevHitDamageAttempt;\n  if (prev) {\n    try { if (prev(agg, tgt, src, dmg) === false) return false; }"), 'the hit hook asks silvertest.js before the fork chain and any damage');
ok(gm.indexOf("hitDamageAttemptHook =(") < hook, 'inside hitDamageAttemptHook');
ok(/require\(SILVERTEST_JS\)/.test(gm) && /'__dboSilverTestLeave'/.test(gm) && /'__dboSuperIsSilverWeapon'/.test(gm), 'gamemode loads silvertest.js, calls its leave and clears the silver export on a failed supernatural load');
const pm = fs.readFileSync(path.join(ROOT, 'playermenu.js'), 'utf8');
ok(/__dboSilverTestEntries\(a, t\)/.test(pm) && /__dboSilverTestAction\(a, id, t\)/.test(pm), 'playermenu.js offers and routes Silver Test');

console.log(fails ? `${fails} failure(s)` : 'all checks passed');
process.exit(fails ? 1 : 0);
