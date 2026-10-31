// A companion its owner's own client reports missing twice in a row is regrouped (gamemode.js companionReport, calling the
// fork's __dboCompanions.regroup from companion-regroup-1031). Checks: one missing report does nothing, the second in a
// row calls regroup and logs its answer; a report that finds it resets the count; another player's report, an unknown id
// and a server build without regroup do nothing; config companions.regroup false turns it off; the npcDrift handler calls it.
//   node tests/companion-regroup-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!c) fails++; };

const OWNER = 0xff000101, OTHER = 0xff000102, C1 = 0xff200001, C2 = 0xff200002;
const OF = { [C1]: OWNER, [C2]: OWNER };
const mp = { get: (id, k) => { if (k !== 'ff_companionOf') return undefined; if (!(id in OF)) throw new Error('gone'); return OF[id]; } };
const logs = [], calls = [];
const cfg = { companions: {} };
const SRC = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
const from = SRC.indexOf('const companionMissing = '), to = SRC.indexOf("onUi('npcDrift', (a, args) => {");
ok(from > 0 && to > from, 'gamemode.js has companionReport before the npcDrift handler');
delete globalThis.__dboCompanionMissing;
const report = new Function('mp', 'cfg', 'log', 'display', SRC.slice(from, to) + '\nreturn companionReport;')(mp, cfg, (...x) => logs.push(x.join(' ')), (a) => `P${(a >>> 0).toString(16)}`);
globalThis.__dboCompanions = { regroup: (id) => { calls.push(id); return 'placed'; } };
const hex = (x) => x.toString(16);

ok(report(OWNER, { kind: 'companion', remoteId: hex(C1), exists: false }) === '' && !calls.length, 'one missing report does nothing yet');
ok(report(OWNER, { kind: 'companion', remoteId: hex(C1), exists: false }) === 'placed' && calls.join() === String(C1), 'the second in a row regroups it', calls);
ok(logs.some((l) => /companion ff200001 of Pff000101 missing on the owner's client twice: placed/.test(l)), '...logged with the answer', logs);
calls.length = 0;
report(OWNER, { kind: 'companion', remoteId: hex(C1), exists: false });
report(OWNER, { kind: 'companion', remoteId: hex(C1), hosted: true, loaded: true });
report(OWNER, { kind: 'companion', remoteId: hex(C1), exists: false });
ok(!calls.length, 'a report that finds it in between resets the count');
report(OWNER, { kind: 'companion', remoteId: hex(C1), exists: false });
ok(calls.length === 1, '...and two in a row after that regroup it again');
calls.length = 0;
report(OTHER, { kind: 'companion', remoteId: hex(C2), exists: false }); report(OTHER, { kind: 'companion', remoteId: hex(C2), exists: false });
ok(!calls.length, 'another player\'s client reporting someone else\'s companion missing counts for nothing');
report(OWNER, { kind: 'companion', remoteId: 'ff2000ff', exists: false }); report(OWNER, { kind: 'companion', remoteId: 'ff2000ff', exists: false });
report(OWNER, { kind: 'companion', remoteId: '', exists: false }); report(OWNER, { kind: 'companion', exists: false });
ok(!calls.length, 'an unknown or missing id does nothing');
cfg.companions.regroup = false;
report(OWNER, { kind: 'companion', remoteId: hex(C2), exists: false }); report(OWNER, { kind: 'companion', remoteId: hex(C2), exists: false });
ok(!calls.length, 'companions.regroup false turns it off (the rollback)');
cfg.companions.regroup = true;
globalThis.__dboCompanions = { list: () => [] };
report(OWNER, { kind: 'companion', remoteId: hex(C2), exists: false });
ok(report(OWNER, { kind: 'companion', remoteId: hex(C2), exists: false }) === '' && !logs.some((l) => /regroup failed/.test(l)), 'a server build without regroup: nothing, no error');
globalThis.__dboCompanions = { regroup: () => { throw new Error('boom'); } };
report(OWNER, { kind: 'companion', remoteId: hex(C1), exists: false });
ok(report(OWNER, { kind: 'companion', remoteId: hex(C1), exists: false }) === '' && logs.some((l) => /companion regroup failed boom/.test(l)), 'a failing regroup is logged, not thrown');
const handler = SRC.slice(to, SRC.indexOf('\n});', to));
ok(/if \(r\.kind === 'companion'\) \{ try \{ companionReport\(a, r\); \}/.test(handler), 'the npcDrift handler hands every companion report to it');

delete globalThis.__dboCompanions; delete globalThis.__dboCompanionMissing;
console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exitCode = fails ? 1 : 0;
