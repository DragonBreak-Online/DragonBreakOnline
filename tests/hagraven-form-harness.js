// Scripted test for the Hagraven's body (hagraven.js /hagraven form, Nat 25 Oct): a stage-3 Hagraven takes the Hagraven
// creature through beastform.js's polymorph (__dboPolymorphAs, by 'hagraven') and leaves it through its revert
// (__dboBeastRevert). Loads the real hagraven.js against stubs of those two hooks: who may (stage 3 only, the switch, the
// hook missing), the guard's own refusal passed through, the cooldown, the stage put back after the body, and what ends it
// (down, jail, bound, the stage lowered, the pact revoked), while a staff member's own Hagraven polymorph is left alone.
// Run it from this folder's parent with
//
//   node tests\hagraven-form-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 300) : ''}`); if (!c) fails++; };

// The stage put back after the body waits 2.5 s for the client: run it at once here
globalThis.setTimeout = (f) => { f(); return 0; };

const WORLD = '3c:Skyrim.esm';
const props = new Map();
const P = (a, k) => props.get(`${a >>> 0}|${k}`);
const setP = (a, k, v) => props.set(`${a >>> 0}|${k}`, v);
const papyrusCalls = [];
const mp = {
  get: (a, k) => { const v = P(a, k); return v === undefined ? null : JSON.parse(JSON.stringify(v)); },
  set: (a, k, v) => setP(a, k, v === null ? null : JSON.parse(JSON.stringify(v))),
  getIdFromDesc: (d) => ({ '803:DBO SD.esp': 0xb4000803, '805:DBO SD.esp': 0xb4000805, '807:DBO SD.esp': 0xb4000807, '809:DBO SD.esp': 0xb4000809 })[d] || 0,
  getDescFromId: (id) => `${(id >>> 0).toString(16)}:Skyrim.esm`,
  lookupEspmRecordById: () => ({ record: { editorId: 'DBOReachmanRace' } }),
  callPapyrusFunction: (kind, cls, method, self, args) => { papyrusCalls.push({ method, args: args.map((x) => (x && x.desc !== undefined ? x.desc : x)) }); },
};
const actor = (id, pos, zone) => {
  setP(id, 'appearance', { raceId: 1, isFemale: true, name: `char${id.toString(16)}` });
  setP(id, 'locationalData', { cellOrWorldDesc: WORLD, pos: pos || [0, 0, 0], rot: [0, 0, 0] });
  setP(id, 'inventory', { entries: [] });
  zones.set(id >>> 0, zone || 'markarth');
  return id >>> 0;
};
const zones = new Map();
const WITCH = actor(0x20), YOUNG = actor(0x21), STAFF = actor(0x26), PASSER = actor(0x28, [100, 0, 0], 'whiterun');
const online = [WITCH, YOUNG, STAFF, PASSER];
const said = [], audits = [], logs = [], commands = new Map(), tickers = new Map(), witnessedCalls = [];
let downed = new Set();
globalThis.__dboIsStaff = (a) => (a >>> 0) === STAFF;
globalThis.__dboIsDowned = (a) => downed.has(a >>> 0);
globalThis.__dboBeastWitnessed = (a, form, seers, phase) => { witnessedCalls.push({ a, form, phase }); return true; };

// beastform.js stubs: the polymorph and its revert, recording what they were asked
const polyCalls = [], revertCalls = [];
let guardSays = '';
const installHook = () => {
  globalThis.__dboPolymorphAs = (a, key, opts) => {
    polyCalls.push({ a, key, opts });
    if (guardSays) return guardSays;
    const original = mp.get(a, 'appearance');
    mp.set(a, 'private.beast', { form: key, original, at: Date.now(), until: 0, race: 0x131fb, creature: true, by: opts && opts.by });
    mp.set(a, 'appearance', Object.assign({}, original, { name: 'Hagraven' }));
    return '';
  };
};
globalThis.__dboBeastRevert = (a, why) => {
  revertCalls.push({ a, why });
  const s = mp.get(a, 'private.beast'); if (!s) return false;
  mp.set(a, 'appearance', s.original); mp.set(a, 'private.beast', null); return true;
};

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hagraven-form-'));
const cwd = process.cwd(); process.chdir(scratch);
const api = (cfg) => ({
  mp, log: (...x) => logs.push(x.join(' ')), personal: (a, t) => said.push([a >>> 0, t]), audit: (t) => audits.push(t), who: (a) => `who${(a >>> 0).toString(16)}`,
  display: (a) => `char${(a >>> 0).toString(16)}`, cfg, registerChatCommand: (n, f) => commands.set(n, f), onlineActors: () => online.slice(),
  isLeadStaff: (a) => (a >>> 0) === STAFF, findByName: (q) => ({ witch: WITCH, young: YOUNG })[String(q).trim().toLowerCase()] || 0,
  every: (n, ms, f) => tickers.set(n, { ms, f }), sourceSkillsOf: () => new Set(), zoneOfActor: (a) => ({ id: zones.get(a >>> 0) || '' }),
});
const HMOD = path.resolve(__dirname, '..', 'hagraven.js');
const loadH = (cfg) => { delete require.cache[HMOD]; delete globalThis.__dboHagraven; return require(HMOD)(api(cfg)); };
const run = (a, args) => { said.length = 0; commands.get('hagraven')(a, args); return said.map(([, t]) => t).join(' | '); };
const beast = (a) => P(a, 'private.beast');
const HOUR = 3600000;
const makeStage = (a, st) => setP(a, 'private.dboHagraven', { since: Date.now(), played: st >= 3 ? 60 * HOUR : st === 2 ? 20 * HOUR : 0, stage: st, how: 'test', by: '' });

// ---- who may ---------------------------------------------------------------------------------------------------------------
const CFG = { hagraven: { enabled: true } };
let H = loadH(CFG);
makeStage(WITCH, 3); makeStage(YOUNG, 2);
ok(/not available on this server/.test(run(WITCH, 'form')) && polyCalls.length === 0, 'without beastform\'s polymorph hook: refused, nothing asked');
ok(/polymorph hook absent/.test(logs.join('\n')), 'the boot line says the hook is absent');
installHook();
ok(/Only a full Hagraven/.test(run(YOUNG, 'form')) && polyCalls.length === 0, 'stage 2: refused before beastform is asked');
ok(/You have made no pact|Only a full Hagraven/.test(run(PASSER, 'form')) && polyCalls.length === 0, 'a mortal: refused');
H = loadH({ hagraven: { enabled: true, form: { enabled: false } } });
ok(/does not answer yet/.test(run(WITCH, 'form')) && polyCalls.length === 0, 'form.enabled false: refused');
H = loadH({ hagraven: { enabled: false } });
ok(/does not answer yet/.test(run(WITCH, 'form')), 'the pact switched off: refused');
H = loadH(CFG);
ok(H.C.form.cooldownSeconds === 60 && H.C.form.enabled === true, 'defaults: on, 60 s between changes');
ok(/polymorph hook present/.test(logs.join('\n')), 'the boot line says the hook is present');

// ---- beastform's guards answer for themselves --------------------------------------------------------------------------------
guardSays = 'Not indoors: these animals cannot open doors. Go outside first.';
ok(/Not indoors/.test(run(WITCH, 'form')) && !beast(WITCH), 'a polymorph guard\'s refusal is passed through, and she stays herself');
ok(polyCalls.length === 1 && polyCalls[0].key === 'hagraven' && polyCalls[0].opts && polyCalls[0].opts.by === 'hagraven', 'beastform is asked for the hagraven creature, by hagraven', polyCalls);
guardSays = '';

// ---- the body, and back ----------------------------------------------------------------------------------------------------------
zones.set(WITCH, 'whiterun'); witnessedCalls.length = 0;
const took = run(WITCH, 'form');
ok(/the hunched body/.test(took) && /casts nothing/.test(took) && beast(WITCH) && beast(WITCH).form === 'hagraven' && beast(WITCH).by === 'hagraven', 'stage 3: she takes the body, told it casts nothing', took);
ok(audits.some((t) => /who20 took the Hagraven body/.test(t)), 'audited');
ok(witnessedCalls.length === 1 && witnessedCalls[0].form === 'hagraven', 'outside the Reach the change is seen at once (exposure.js, known on sight)', witnessedCalls);
ok(H.inForm(WITCH), 'inForm sees it');
papyrusCalls.length = 0;
const back = run(WITCH, 'form');
ok(/stand as yourself again/.test(back) && !beast(WITCH) && revertCalls.pop().why === 'asked to revert', '/hagraven form again: beastform reverts her (asked to revert)', back);
ok(papyrusCalls.some((c) => c.method === 'SetActorValue' && c.args[0] === 'SpeedMult' && c.args[1] === 90), 'her stage is put back after the body (SpeedMult 90)');
ok(audits.some((t) => /who20 left the Hagraven body \(asked to revert\)/.test(t)), 'the leaving is audited');
zones.set(WITCH, 'markarth');

// ---- the cooldown --------------------------------------------------------------------------------------------------------------
const n0 = polyCalls.length;
ok(/Wait \d+ more seconds?/.test(run(WITCH, 'form')) && polyCalls.length === n0, 'straight after a change: wait, beastform not asked');
globalThis.__dboHagraven.formAt.set(WITCH, Date.now() - 61000);
ok(/the hunched body/.test(run(WITCH, 'form')), 'after the cooldown: she changes again');

// ---- what ends the body ------------------------------------------------------------------------------------------------------------
const formTick = tickers.get('hagraven-form');
ok(formTick && formTick.ms === 5000, 'the body is checked every 5 s');
said.length = 0; formTick.f();
ok(beast(WITCH), 'nothing wrong: the tick leaves her be');
downed.add(WITCH); said.length = 0; formTick.f();
ok(!beast(WITCH) && revertCalls.pop().why === 'downed' && said.some(([a, t]) => a === WITCH && /struck down/.test(t)), 'downed: the body ends, she is told');
downed.clear();
const again = () => { globalThis.__dboHagraven.formAt.set(WITCH, 0); run(WITCH, 'form'); return !!beast(WITCH); };
ok(again(), '(she takes it again)');
setP(WITCH, 'private.dboSentence', { totalMs: 600000, servedMs: 0 }); formTick.f();
ok(!beast(WITCH) && revertCalls.pop().why === 'jailed', 'jailed: the body ends');
setP(WITCH, 'private.dboSentence', { totalMs: 600000, servedMs: 600000 });
ok(again(), '(sentence served: she takes it again)');
setP(WITCH, 'private.restrained', { boundHands: true }); formTick.f();
ok(!beast(WITCH) && revertCalls.pop().why === 'bound', 'bound: the body ends');
setP(WITCH, 'private.restrained', null);
ok(again(), '(free: she takes it again)');
run(STAFF, 'stage witch 2 coven event');
ok(!beast(WITCH) && revertCalls.some((r) => r.why === 'no longer a Hagraven'), 'staff lower her to stage 2: the body ends with it');
run(STAFF, 'stage witch 3 coven event');
ok(again(), '(stage 3 again: she takes it)');
run(STAFF, 'revoke witch done');
ok(!beast(WITCH) && revertCalls.some((r) => r.why === 'pact ended') && globalThis.__dboHagravenStage(WITCH) === 0, 'the pact revoked: the body ends first, then the pact');

// ---- beastform ends the body by itself (its polymorphBreak): she is still told, her stage put back -----------------------------------
makeStage(WITCH, 3);
ok(again(), '(she takes the body)');
downed.add(WITCH); setP(WITCH, 'private.beast', null); setP(WITCH, 'appearance', { raceId: 1, isFemale: true, name: 'char20' });
said.length = 0; papyrusCalls.length = 0; formTick.f(); downed.clear();
ok(said.some(([a, t]) => a === WITCH && /You are yourself again: struck down/.test(t)), 'beastform reverted her on a down: hagraven.js tells her why', said);
ok(papyrusCalls.some((c) => c.method === 'SetActorValue' && c.args[1] === 90), '...and puts her stage back');
said.length = 0; formTick.f();
ok(!said.some(([a]) => a === WITCH), '...once only');
ok(again(), '(she takes it again)');
setP(WITCH, 'private.beast', null); setP(WITCH, 'isDead', true); said.length = 0; formTick.f(); setP(WITCH, 'isDead', false);
ok(!said.some(([a]) => a === WITCH), 'the body ended by a death: no line from hagraven.js');

// ---- a staff member's own Hagraven polymorph is not hers ----------------------------------------------------------------------------
setP(STAFF, 'private.beast', { form: 'hagraven', original: P(STAFF, 'appearance'), at: Date.now(), until: 0, race: 0x131fb, creature: true, by: 'staff' });
const r0 = revertCalls.length; downed.add(STAFF); formTick.f(); downed.clear();
ok(beast(STAFF) && revertCalls.length === r0 && !H.inForm(STAFF), 'a staff /polymorph hagraven is left to beastform\'s own rules');
setP(STAFF, 'private.beast', null);

// ---- what she is, in Active Effects, and the Hagraven Form power ----------------------------------------------------------------------
{
  const DCFG = { hagraven: { enabled: true, display: { 1: '803:DBO SD.esp', 2: '805:DBO SD.esp', 3: '807:DBO SD.esp' }, powerSpell: '809:DBO SD.esp' } };
  const HD = loadH(DCFG);
  const calls = (m, d) => papyrusCalls.filter((c) => c.method === m && c.args[0] === d);
  makeStage(YOUNG, 1); papyrusCalls.length = 0; globalThis.__dboHagravenLogin(YOUNG);
  ok(calls('AddSpell', '803:DBO SD.esp').length === 1 && calls('RemoveSpell', '805:DBO SD.esp').length === 1 && calls('RemoveSpell', '807:DBO SD.esp').length === 1 && calls('RemoveSpell', '809:DBO SD.esp').length === 1, 'stage 1 at login: Crone-touched shown, the other stages and the power taken', papyrusCalls);
  run(STAFF, 'stage young 3 test'); 
  ok(calls('AddSpell', '807:DBO SD.esp').length === 1 && calls('AddSpell', '809:DBO SD.esp').length === 1, 'staff set stage 3: the Hagraven display and the power are given');
  papyrusCalls.length = 0; run(STAFF, 'stage young 2 test');
  ok(calls('AddSpell', '805:DBO SD.esp').length === 1 && calls('RemoveSpell', '807:DBO SD.esp').length >= 1 && calls('RemoveSpell', '809:DBO SD.esp').length >= 1, 'stage 2: Feathered shown, the Hagraven display and the power taken');
  papyrusCalls.length = 0; run(STAFF, 'revoke young test');
  ok(['803', '805', '807', '809'].every((k) => calls('RemoveSpell', k + ':DBO SD.esp').length >= 1) && !papyrusCalls.some((c) => c.method === 'AddSpell'), 'the pact revoked: every display and the power taken, nothing given');
  // the power cast is /hagraven form
  makeStage(WITCH, 3); globalThis.__dboHagraven.formAt.set(WITCH, 0); setP(WITCH, 'private.beast', null); said.length = 0;
  ok(globalThis.__dboHagravenCast(WITCH, 0xb4000809) === true && beast(WITCH) && beast(WITCH).form === 'hagraven', 'casting Hagraven Form takes the body');
  ok(said.some(([a, t]) => a === WITCH && /the hunched body/.test(t)), '...and says so');
  globalThis.__dboHagraven.formAt.set(WITCH, 0); said.length = 0;
  ok(globalThis.__dboHagravenCast(WITCH, 0xb4000809) === true && !beast(WITCH) && said.some(([a, t]) => a === WITCH && /stand as yourself/.test(t)), 'cast again: back to herself');
  ok(globalThis.__dboHagravenCast(WITCH, 0x12345) === false, 'any other spell is not ours');
  loadH(CFG);
  ok(globalThis.__dboHagravenCast(WITCH, 0xb4000809) === false, 'no powerSpell configured: no cast is taken as the power');
}

// ---- the pieces in the other files -------------------------------------------------------------------------------------------------
const src = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
const bf = src('beastform.js');
if (/__dboPolymorphAs\s*=/.test(bf)) {
  ok(/hagraven: \{ name: 'Hagraven', race: idOf\('131fb:Skyrim\.esm'\) \}/.test(bf), 'beastform.js has the Hagraven creature (131fb)');
} else console.log('skip  beastform.js has no __dboPolymorphAs here (worker4-polymorph-panel-1025 brings it)');
ok(/\/hagraven form again/.test(src('hagraven.js')) && /\| form \|/.test(src('hagraven.js')), 'the usage names /hagraven form');
ok(/globalThis\.__dboHagravenCast\(Number\(casterId\) >>> 0, Number\(spellId\) >>> 0\)/.test(src('gamemode.js')), 'gamemode.js castHook asks hagraven.js about the power');

process.chdir(cwd);
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
