// Scripted test for spellInvisPolicy.ts and its use in formView.ts / spellInvisReportService.ts (Nate, 23 Oct: other
// players' copies of a player stayed invisible for the potion's or spell's full 30-50 s after an attack ended it on the
// player's own screen). A watcher hides a player copy only while the copy's own Invisibility is up AND the owner's
// report (ff_spellInvis) says on and was refreshed within CONFIRM_MAX_AGE_MS.
//
// spellInvisPolicy.ts has no imports, so it transpiles on its own. Run it from skymp5-client:
//
//   ./node_modules/typescript/bin/tsc src/view/spellInvisPolicy.ts --outDir "$TMPDIR/dbo-spellinvis" --module commonjs --target es2019
//   node tests/spellinvis-harness.js "$TMPDIR/dbo-spellinvis/spellInvisPolicy.js"
'use strict';
const fs = require('fs');
const path = require('path');
const P = require(path.resolve(process.argv[2]));
const { ownerInvisOf, nextConfirm, spellHidden, reportDue, REPORT_HEARTBEAT_MS, CONFIRM_MAX_AGE_MS } = P;

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

// ---- the pieces ---------------------------------------------------------------------------------------------------
check('no prop: no report', ownerInvisOf(undefined) === null && ownerInvisOf(null) === null && ownerInvisOf(5) === null);
check('prop parsed', JSON.stringify(ownerInvisOf({ on: true, n: 4 })) === '{"on":true,"n":4}');
check('on must be literally true', ownerInvisOf({ on: 1, n: 2 }).on === false);
check('NPC copy: its own actor value alone', spellHidden(false, 40, null, null, 0) === true && spellHidden(false, 0, null, null, 0) === false);
check('player copy without any report: shown (old owner client, or a forged effect)', spellHidden(true, 40, null, null, 0) === false);
check('player copy, owner says on, copy has no effect: shown (a report alone hides nobody)',
  spellHidden(true, 0, { on: true, n: 1 }, { n: 1, at: 0 }, 0) === false);
check('heartbeat well inside the bound', REPORT_HEARTBEAT_MS * 2 < CONFIRM_MAX_AGE_MS, [REPORT_HEARTBEAT_MS, CONFIRM_MAX_AGE_MS]);
check('the bound is far below a potion (30 s)', CONFIRM_MAX_AGE_MS <= 10000, CONFIRM_MAX_AGE_MS);

// ---- owner and watcher over time -----------------------------------------------------------------------------------
// The owner drinks at t=0 (effect 30 s), attacks at t=5 s: their own effect ends; the copy keeps the effect to t=30 s.
// Reports go owner -> server (mirrors n+1) -> watcher with LAG ms.
const sim = ({ ownerEndsAt, copyEndsAt, lag = 150, dropAfter = Infinity, until = 35000 }) => {
  const out = [];
  let sent = null, sentAt = 0, prop = null, n = 0, confirm = null;
  const inflight = [];
  for (let t = 0; t <= until; t += 50) {
    const onNow = t < ownerEndsAt;
    if (t < dropAfter && reportDue(sent, sentAt, onNow, t)) { sent = onNow; sentAt = t; inflight.push({ at: t + lag, on: onNow }); }
    while (inflight.length && inflight[0].at <= t) { const r = inflight.shift(); n++; prop = { on: r.on, n }; }
    const owner = ownerInvisOf(prop);
    confirm = nextConfirm(confirm, owner, t);
    const hidden = spellHidden(true, t < copyEndsAt ? 40 : 0, owner, confirm, t);
    out.push({ t, hidden });
  }
  return out;
};
const hiddenAt = (rows, t) => rows.find((r) => r.t >= t).hidden;
const lastHidden = (rows) => { let l = -1; for (const r of rows) if (r.hidden) l = r.t; return l; };

{
  const rows = sim({ ownerEndsAt: 5000, copyEndsAt: 30000 });
  check('invisible to the watcher while the owner is', hiddenAt(rows, 1000) && hiddenAt(rows, 4800));
  check('the attack shows the owner within the report lag', !hiddenAt(rows, 5300), lastHidden(rows));
  check('and they stay shown while the copy\'s stale effect runs', rows.filter((r) => r.t >= 5300 && r.t < 30000).every((r) => !r.hidden));
}
{
  const rows = sim({ ownerEndsAt: 30000, copyEndsAt: 30000 });
  check('an untouched potion hides for its whole length (heartbeats keep it fresh)', rows.filter((r) => r.t >= 500 && r.t < 29900).every((r) => r.hidden));
  check('and ends with it', !hiddenAt(rows, 30300));
}
{
  // The owner's "off" is lost (crash, disconnect): the upper bound shows them anyway
  const rows = sim({ ownerEndsAt: 5000, copyEndsAt: 30000, dropAfter: 4000 });
  const last = lastHidden(rows);
  check('a lost "off": hidden no longer than the bound after the last heartbeat', last > 0 && last <= 3000 + 150 + CONFIRM_MAX_AGE_MS + 50, last);
}
{
  // A forged report with no effect on the copy hides nobody
  const rows = sim({ ownerEndsAt: 30000, copyEndsAt: 0 });
  check('a client that only claims invisibility is never hidden', lastHidden(rows) === -1);
}

// ---- the owner's report cadence ------------------------------------------------------------------------------------
check('first check always reports (clears a stale state from the last session)', reportDue(null, 0, false, 0) === true);
check('no repeat while visible', reportDue(false, 0, false, 60000) === false);
check('a change reports at once', reportDue(false, 999, true, 1000) === true && reportDue(true, 999, false, 1000) === true);
check('heartbeat while invisible', reportDue(true, 0, true, REPORT_HEARTBEAT_MS - 1) === false && reportDue(true, 0, true, REPORT_HEARTBEAT_MS) === true);

// ---- the wiring in the sources --------------------------------------------------------------------------------------
const root = path.resolve(__dirname, '..', 'src');
const fv = fs.readFileSync(path.join(root, 'view', 'formView.ts'), 'utf8');
const svc = fs.readFileSync(path.join(root, 'services', 'services', 'spellInvisReportService.ts'), 'utf8');
const idx = fs.readFileSync(path.join(root, 'index.ts'), 'utf8');
check('formView reads ff_spellInvis', /\["ff_spellInvis"\]/.test(fv));
check('formView decides with spellHidden and the copy kind', /spellHidden\(!!model\.appearance, av, owner, this\.invisConfirm, now\)/.test(fv));
check('both callers pass the model', (fv.match(/this\.spellInvisible\(refr, model\)/g) || []).length === 2 && !/this\.spellInvisible\(refr\)/.test(fv));
check('a shown copy with a stale effect loses the shimmer', /clearStaleInvisLook\(refr\)/.test(fv) && /INVIS_SHIMMER_SHADER_ID/.test(fv));
check('the owner reports through the dbo relay as spellInvis', /customPacketType: "dbo", event: "spellInvis", args: \[on\]/.test(svc));
check('the report service is constructed', /new SpellInvisReportService\(sp, controller\)/.test(idx));

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
