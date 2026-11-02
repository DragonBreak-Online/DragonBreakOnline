// When the client asks the server to host a copy, and whether it seats or plays back one it does not host
// (src/view/hostAsk.ts, used by formView.ts). Step (3) of the server-hosted NPC slice (_work/server-npc-movement-1102.md):
// an actor the server drives (model.isServerDriven) is never asked for, from any of the three triggers, and is played back
// like one another client hosts. Every combination of the other flags is checked against formView's conditions as they
// were before, so nothing changes for any other actor. The mutants at the end are compiled from altered copies of
// hostAsk.ts and must each fail.
//   node tests/host-ask-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'view', 'hostAsk.ts');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dbo-host-ask-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* the OS */ } });
let fails = 0;
const check = (what, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!ok) fails++; };

const compile = (source, name) => {
  const d = path.join(TMP, name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'hostAsk.ts'), source);
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), path.join(d, 'hostAsk.ts'), '--outDir', d, '--module', 'commonjs', '--target', 'es2019'], { stdio: 'pipe' });
  return require(path.join(d, 'hostAsk.js'));
};

// formView's conditions before step (3), word for word in meaning
const before = {
  onSight: (m, hosted, own) => !m.isHostedByOther && !hosted && !own,
  silent: (m, hosted, silent) => silent && !hosted,
  resync: (m, hosted, remoteId) => !hosted && !!remoteId,
  seat: (m, ever, stranded) => !m.isHostedByOther && (!ever || stranded),
  playback: (m, hosted, ever) => !hosted && (!!m.isHostedByOther || !ever),
};

const B = [false, true];
const decisions = (H, c) => {
  let same = 0, total = 0, firstDiff = null;
  const cmp = (what, got, want, at) => { total++; if (got === want) same++; else if (!firstDiff) firstDiff = { what, got, want, at }; };
  for (const other of [undefined, false, true]) for (const sd of [undefined, false]) {
    const m = { isHostedByOther: other, isServerDriven: sd };
    for (const hosted of B) for (const own of B) cmp('onSight', H.mayAskOnSight(m, hosted, own), before.onSight(m, hosted, own), { m, hosted, own });
    for (const hosted of B) for (const silent of B) cmp('silent', H.mayAskSilent(m, hosted, silent), before.silent(m, hosted, silent), { m, hosted, silent });
    for (const hosted of B) for (const rid of [0, 0xff0001]) cmp('resync', H.mayAskResync(m, hosted, rid), before.resync(m, hosted, rid), { m, hosted, rid });
    for (const ever of B) for (const st of B) cmp('seat', H.seatsUndriven(m, ever, st), before.seat(m, ever, st), { m, ever, st });
    for (const hosted of B) for (const ever of B) cmp('playback', H.playsBack(m, hosted, ever), before.playback(m, hosted, ever), { m, hosted, ever });
  }
  c(`an actor the server does not drive decides exactly as formView did, all ${total} combinations`, same === total, firstDiff);
  let asks = 0, seats = 0, played = 0, playable = 0;
  for (const other of [undefined, false, true]) {
    const m = { isHostedByOther: other, isServerDriven: true };
    for (const hosted of B) for (const x of B) {
      if (H.mayAskOnSight(m, hosted, x) || H.mayAskSilent(m, hosted, x) || H.mayAskResync(m, hosted, x ? 0xff0001 : 0) || H.mayAskSilent(m, hosted, true) || H.mayAskResync(m, hosted, 0xff0001)) asks++;
      if (H.seatsUndriven(m, hosted, x) || H.seatsUndriven(m, x, true)) seats++;
      if (!hosted) { playable++; if (H.playsBack(m, hosted, x)) played++; }
    }
  }
  c('an actor the server drives is never asked for: not on sight, not when its host is silent, not on resync, even with isHostedByOther false', asks === 0, asks);
  c('...never seated as an undriven copy', seats === 0, seats);
  c('...and played back like one another client hosts, unless this client hosts it', played === playable && playable > 0 && H.playsBack({ isServerDriven: true }, true, true) === false, { played, playable });
};

const live = compile(fs.readFileSync(SRC, 'utf8'), 'live');
decisions(live, check);

// formView takes its decisions from hostAsk: each is called where the old condition stood
const fv = fs.readFileSync(path.join(ROOT, 'src', 'view', 'formView.ts'), 'utf8');
check('formView asks hostAsk at all five places', ['mayAskOnSight(model', 'mayAskSilent(model', 'mayAskResync(model', 'seatsUndriven(model', 'playsBack(model'].every((k) => fv.includes(k)));
const rs = fs.readFileSync(path.join(ROOT, 'src', 'services', 'services', 'remoteServer.ts'), 'utf8');
// isServerDriven is a property like isHostedByOther (W4, 2 Nov: the wire format is positional, so a movement field would be a
// protocol change): both property paths must put any name on the model, and the movement handler must never touch it, or
// every server movement would clear the property the server just set
const movementHandler = rs.slice(rs.indexOf('private onUpdateMovementMessage'), rs.indexOf('private onUpdateAnimationMessage'));
check('isServerDriven reaches the model as a property: UpdateProperty and CreateActor props both set any name on it',
  /\(form as Record<string, unknown>\)\[msg\.propName\] = msgData;/.test(rs) && /for \(const propName in msg\.props\) \{\s*\(form as Record<string, unknown>\)\[propName\] = msg\.props\[propName/.test(rs));
check('...and no movement ever sets or clears it', movementHandler.length > 100 && !/isServerDriven/.test(movementHandler));

const source = fs.readFileSync(SRC, 'utf8');
const MUTANTS = [
  ['asked for on sight', '!m.isHostedByOther && !m.isServerDriven && !alreadyHosted && !ownCompanion', '!m.isHostedByOther && !alreadyHosted && !ownCompanion'],
  ['asked for when its host is silent', 'hostSilent && !alreadyHosted && !m.isServerDriven', 'hostSilent && !alreadyHosted'],
  ['asked for on resync', '!alreadyHosted && !!remoteId && !m.isServerDriven', '!alreadyHosted && !!remoteId'],
  ['seated as undriven', '!m.isHostedByOther && !m.isServerDriven && (!everApplied || strandedFromServer)', '!m.isHostedByOther && (!everApplied || strandedFromServer)'],
  ['not played back', '!alreadyHosted && (!!m.isHostedByOther || !!m.isServerDriven || !everApplied)', '!alreadyHosted && (!!m.isHostedByOther || !everApplied)'],
  ['every actor treated as server-driven', 'hostSilent && !alreadyHosted && !m.isServerDriven', 'hostSilent && !alreadyHosted && false'],
];
MUTANTS.forEach(([name, a, b], i) => {
  if (!source.includes(a)) { check(`mutant "${name}": its line is in hostAsk.ts`, false, a); return; }
  let bad = 0;
  try { decisions(compile(source.replace(a, b), `m${i}`), (w, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
  check(`mutant caught: ${name}`, bad > 0);
});
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
