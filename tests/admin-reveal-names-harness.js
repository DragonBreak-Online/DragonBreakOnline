// The staff "real names" mode as one gate (/realnames, Jake 14 Oct 2026: "an option to see all player names instead of
// 'stranger' as an admin ... a mode that can be toggled on and off"). Runs its two harnesses with the same environment
// and fails when either does:
//   tests/real-names-harness.js        the mode: who may, on and off, names and labels, privacy, reload, kill switch, cost,
//                                      the remote console, /players, the U panel, and a leftover marker gone at login (R1-R26)
//   tests/real-names-chat-harness.js   chat: a disguised speaker named to staff with the mode on, and to nobody else (C1-C5)
//   node tests/admin-reveal-names-harness.js                      (from server/)
//   REVEAL_ROOT=<another server/ copy> node tests/admin-reveal-names-harness.js    against that copy: origin/server
//                                      6b37238cd fails (the mode is not there); FORK=<client tree> adds the client pins
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

let failed = 0;
for (const h of ['real-names-harness.js', 'real-names-chat-harness.js']) {
  const r = spawnSync(process.execPath, [path.join(__dirname, h)], { env: process.env, encoding: 'utf8', timeout: 110000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  console.log(`== ${h}`);
  for (const line of out.split('\n')) if (line.trim()) console.log(line);
  const good = r.status === 0;
  console.log(`${good ? 'ok  ' : 'FAIL'} ${h}${good ? '' : ` (exit ${r.status === null ? r.signal : r.status})`}`);
  if (!good) failed++;
}
console.log(failed ? `\n${failed} of 2 FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
