// A Trial GM answering GM calls (the F7 GM Calls tab is shown to them on purpose; gmcall.js and staffguard.js decide): every
// action, by /gm and by the tab, run as a Trial GM against the real staffguard.js and gmcall.js. A Trial GM takes, goes to,
// releases and closes calls nobody else holds and their own; they take over, release and close no call another staff
// member holds (1 Nov: a take-over made them its holder, and goto and /tp then reached that player). GMs are unchanged.
// Each mutant must fail.
//   node tests/gmcall-trial-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ROOT, CAST, load: loadGuard, check, done } = require('./lib/staffguard-fakes');
const { GM, TRIAL, MIRA, BOB, OWNER } = Object.fromEntries(Object.entries(CAST).map(([k, v]) => [k, v.id]));
const GMCALL = fs.readFileSync(path.join(ROOT, 'gmcall.js'), 'utf8');
const GUARD = fs.readFileSync(path.join(ROOT, 'staffguard.js'), 'utf8');
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-gmcalltrial-')));

const run = (gmcallSrc, guardSrc, trialLimits, live) => {
  let bad = 0;
  const t = (c, what, got) => { if (!c) bad++; if (live) check(what, c, got); };
  const tmp = path.join(ROOT, `.gmcall-trial-${process.pid}.js`), gtmp = path.join(ROOT, `.staffguard-trial-${process.pid}.js`);
  fs.writeFileSync(tmp, gmcallSrc); fs.writeFileSync(gtmp, guardSrc);
  try {
    // staffguard.js through the shared fakes (its cast: GM Gemma a GM, Helps a Trial GM on their staff character, Mira a player)
    const f = loadGuard(trialLimits === false ? { trialLimits: { enabled: false } } : {});
    // the staffguard.js under test (a mutant too), over the same fake api; it publishes itself as __dboStaffGuard
    delete require.cache[gtmp];
    f.G = require(gtmp)(f.api);
    const said = [], teleports = [], ui = {};
    const sayOf = (a) => said.filter((x) => x[0] === (a >>> 0)).map((x) => x[1]).join(' | ');
    const api = Object.assign({}, f.api, {
      mp: Object.assign({}, f.api.mp, { get: (a, k) => (k === 'pos' ? [1, 2, 3] : k === 'worldOrCellDesc' ? '3c:Skyrim.esm' : k === 'angle' ? [0, 0, 0] : f.api.mp.get(a, k)) }),
      personal: (a, x) => said.push([a >>> 0, String(x)]), staffSay: (a, x) => said.push([a >>> 0, String(x)]),
      staffNote: () => {}, discordOf: () => '', rolesOf: () => [],
      isAdmin: (a) => ['gm', 'leadgm', 'senior', 'developer'].includes(f.api.tierOf(a)),
      staffCan: (a, what) => what === 'gmcall' && f.api.staffTierOf(a) === 'trialgm',
      every: () => {}, saveSoon: () => {}, sendPacket: () => true, openWidget: () => {}, closeWidget: () => {},
      onUi: (ev, fn) => { ui[ev] = fn; }, teleportTo: (a, place) => { teleports.push([a >>> 0, place]); return ''; },
      creationPending: () => false, zoneOfActor: () => 'bruma', zoneById: () => ({ id: 'bruma', name: 'Bruma' }), recordOf: () => null,
      sendJson: () => Promise.resolve('{}'), token: '', cfg: { gmCalls: {}, tickets: {} },
    });
    // a fresh server: no call cooldown left from the run before
    delete globalThis.__dboGmCallsRun;
    delete require.cache[tmp];
    require(tmp)(api);
    const gm = (a, text) => f.commands.get('gm').fn(a, text);
    const panel = (a, op, n) => ui.staffGmCalls(a, [op, n]);
    const S = () => globalThis.__dboGmCalls;
    const call = () => S().open[S().open.length - 1];

    gm(MIRA, 'I am stuck under the Bruma gate, please help');
    const c = call();
    t(!!c && c.n > 0, 'Mira opens a GM call');
    gm(GM, `take ${c.n}`);
    if (trialLimits === false) { gm(TRIAL, `take ${c.n}`); return { bad, offTakeover: c.takenBy && c.takenBy.profile === CAST.TRIAL.profile }; }
    t(c.takenBy && c.takenBy.profile === CAST.GM.profile, 'GM Gemma takes it');

    for (const [how, act] of [['/gm', (op) => gm(TRIAL, `${op} ${c.n}`)], ['the F7 tab', (op) => panel(TRIAL, op, c.n)]]) {
      said.length = 0; act('take');
      t(c.takenBy.profile === CAST.GM.profile && /A Trial GM does not take over a call another staff member holds/.test(sayOf(TRIAL)), `${how}: a Trial GM cannot take over GM Gemma's call`, sayOf(TRIAL));
      said.length = 0; act('goto');
      t(teleports.length === 0 && /A Trial GM goes only on a call they hold/.test(sayOf(TRIAL)), `${how}: ...nor go to it`, sayOf(TRIAL));
      said.length = 0; act('release');
      t(c.takenBy && c.takenBy.profile === CAST.GM.profile && /does not release a call another/.test(sayOf(TRIAL)), `${how}: ...nor release it`, sayOf(TRIAL));
      said.length = 0; act('close');
      t(S().open.includes(c) && /does not close a call another/.test(sayOf(TRIAL)), `${how}: ...nor close it`, sayOf(TRIAL));
    }
    t(!!(f.G.command(TRIAL, 'tp', 'tp mira', 'Mira') || {}).refuse, '/tp to Mira stays refused while someone else holds her call');

    gm(GM, `release ${c.n}`);
    said.length = 0; gm(TRIAL, `take ${c.n}`);
    t(c.takenBy && c.takenBy.profile === CAST.TRIAL.profile, 'a call nobody holds: the Trial GM takes it', sayOf(TRIAL));
    gm(TRIAL, `goto ${c.n}`);
    t(teleports.length === 1 && teleports[0][0] === TRIAL, '...goes to the caller');
    gm(TRIAL, `release ${c.n}`);
    t(c.takenBy === null, '...and may release their own');
    panel(TRIAL, 'take', c.n); panel(TRIAL, 'close', c.n);
    t(!S().open.includes(c), '...and close their own, from the tab too');

    gm(BOB, 'My horse is stuck in the Bruma wall, please');
    const d = call();
    gm(TRIAL, `take ${d.n}`);
    gm(GM, `take ${d.n}`);
    t(d.takenBy.profile === CAST.GM.profile, 'a GM still takes over a Trial GM\'s call');
    gm(OWNER, `close ${d.n}`);
    t(!S().open.includes(d), '...and the Owners close any');
    return { bad, said, S, TRIAL_ID: TRIAL };
  } catch (e) { bad++; if (live) check('scenarios ran', false, e.stack); return { bad }; }
  finally { try { fs.unlinkSync(tmp); } catch (e) { /* gone */ } try { fs.unlinkSync(gtmp); } catch (e) { /* gone */ } }
};

check('every scenario passes on the code as written', run(GMCALL, GUARD, true, true).bad === 0);

// trialLimits off: the take-over is the Trial GM's as it was
check('trialLimits.enabled false lifts the rule: the Trial GM takes over GM Gemma\'s call', run(GMCALL, GUARD, false, false).offTakeover === true);

const MUTANTS = [
  ['take has no Trial GM check', GMCALL, "    const no = guardSays(a, c, 'take'); if (no) { say(a, no); return false; }\n", ''],
  ['release has no Trial GM check', GMCALL, "    const no = guardSays(a, c, 'release'); if (no) return say(a, no);\n", ''],
  ['close has no Trial GM check', GMCALL, "    const no = guardSays(a, c, 'close'); if (no) return say(a, no);\n", ''],
  ['the rule refuses a Trial GM their own call too', GUARD, ' || Number(c.takenBy.profile) === pidOf(a)) return \'\';', ") return '';"],
];
for (const [name, src, a, b] of MUTANTS) {
  if (!src.includes(a)) { check(`mutant "${name}": its line is in the code`, false, a); continue; }
  const r = src === GMCALL ? run(src.replace(a, b), GUARD, true, false) : run(GMCALL, src.replace(a, b), true, false);
  check(`mutant caught: ${name}`, r.bad > 0);
}
done();
