// Outlaw bounties (server\outlaws.js, Nate 18 Oct): the ruler or Steward sets them (up to 1000 gold), they are claimed only
// in their own hold's jail, the outlaw pays the jailer from carried gold then the bank, the rest is served as extra minutes,
// and an outlaw may pay their own to the treasury. Run from server/ with a temp state folder.
//   node tests/outlaws-harness.js
'use strict';
const fs = require('fs'); const os = require('os'); const path = require('path');
const MODULE = path.resolve(__dirname, '..', 'outlaws.js');
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-outlaws-'));
process.chdir(dir);
let fails = 0; const ok = (l, c, g) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${l}${!c && g !== undefined ? `: got ${JSON.stringify(g)}` : ''}`); if (!c) fails++; };
const COUNTESS = 0x10, STEWARD = 0x11, GUARD = 0x12, OUTLAW = 0x13, TOWNIE = 0x14, LEAD = 0x15;
const chars = { [COUNTESS]: [70, 'Frigga'], [STEWARD]: [71, 'Aldo'], [GUARD]: [191, 'Dreams'], [OUTLAW]: [99, 'Rogue'], [TOWNIE]: [55, 'Pell'], [LEAD]: [2, 'Nate'] };
const props = new Map(); const ui = {}; const answers = []; const said = []; const sys = []; const audits = []; const deposits = [];
let here = 'bruma';
const gold = (a) => { const inv = props.get(`${a}|inventory`); const g = ((inv && inv.entries) || []).find((e) => e.baseId === 0xf); return g ? g.count : 0; };
const setGold = (a, n) => props.set(`${a}|inventory`, { entries: n > 0 ? [{ baseId: 0xf, count: n }] : [] });
const mp = { get: (a, k) => props.get(`${a}|${k}`), set: (a, k, v) => props.set(`${a}|${k}`, v) };
globalThis.__dboBankTake = (a, n) => { const b = Number(props.get(`${a}|private.bankGold`)) || 0; const t = Math.min(b, n); props.set(`${a}|private.bankGold`, b - t); return t; };
globalThis.__dboTreasuryZone = { deposit: (z, n) => { deposits.push([z, n]); return n; } };
const M = require(MODULE)({
  mp, log: () => {}, personal: (a, t) => said.push([a, t]), system: (a, t) => sys.push([a, t]), audit: (t) => audits.push(t),
  who: (a) => chars[a][1], display: (a) => chars[a][1], cfg: {}, registerChatCommand: (n, f) => { cmd = f; },
  zoneOfActor: () => here, zoneById: (id) => ({ bruma: { id: 'bruma', name: 'Bruma', officials: ['count', 'steward', 'guard'] }, whiterun: { id: 'whiterun', name: 'Whiterun', officials: ['jarl', 'steward'] } })[id] || null,
  readOfficials: () => ({ bruma: { count: [70], steward: [71], guard: [191] } }), profileOf: (a) => (chars[a] ? chars[a][0] : -1),
  officialTarget: (q) => { const e = Object.entries(chars).find(([, c]) => c[1].toLowerCase() === String(q).toLowerCase()); return e ? { pid: e[1][0], actor: Number(e[0]), online: Number(e[0]), label: e[1][1], who: e[1][1] } : { error: `No character called ${q}.` }; },
  onlineActors: () => Object.keys(chars).map(Number), giveItem: (a, b, n) => setGold(a, gold(a) + n), isLeadStaff: (a) => a === LEAD,
  onUi: (n, f) => { ui[n] = f; },
});
globalThis.__dboJournalFresh = (a, n) => n === 'N';
globalThis.__dboJournalLimited = (a, fn) => answers.push(fn());
var cmd;
const run = (a, args) => { said.length = 0; cmd(a, args); return (said[said.length - 1] || [])[1] || ''; };
ok('the Countess sets a bounty', /Rogue is wanted in Bruma for 300 gold/.test(run(COUNTESS, 'set Rogue 300 robbed the Synod')));
ok('...and the outlaw is told', sys.some(([a, t]) => a === OUTLAW && /bounty of 300 gold on you: robbed the Synod/.test(t)));
ok('the Steward may set one too', /wanted in Bruma for 50/.test(run(STEWARD, 'set Pell 50 brawling')));
ok('a guard may not', /Only the ruler or the Steward/.test(run(GUARD, 'set Pell 20 rude')));
ok('nor anyone else', /Only the ruler or the Steward/.test(run(TOWNIE, 'set Rogue 20 rude')));
ok('the cap is 1000 gold', /1 to 1000 gold/.test(run(COUNTESS, 'set Pell 1001 treason')));
ok('/bounty lists who is wanted here', /Wanted in Bruma: .*Rogue, 300 gold \(robbed the Synod\)/.test(run(TOWNIE, '')));
ok('the Steward clears one', /lifted/.test(run(STEWARD, 'clear Pell')) && !/Pell/.test(run(TOWNIE, '')));
// Jailed in Bruma with 100 carried and 120 in the bank: 220 to the jailer, 80 short = 8 more minutes
setGold(OUTLAW, 100); props.set(`${OUTLAW}|private.bankGold`, 120); setGold(GUARD, 0);
let extra = globalThis.__dboOutlawJailed(GUARD, OUTLAW);
ok('jailed in its hold: carried then bank paid to the jailer (220)', gold(GUARD) === 220 && gold(OUTLAW) === 0 && props.get(`${OUTLAW}|private.bankGold`) === 0, [gold(GUARD), gold(OUTLAW)]);
ok('...the 80 unpaid is served as 8 more minutes', extra === 8, extra);
ok('...and the bounty is gone', globalThis.__dboOutlawJailed(GUARD, OUTLAW) === 0 && !/Rogue/.test(run(TOWNIE, '')));
// Hold only: a Bruma bounty is not claimed in Whiterun's jail
run(COUNTESS, 'set Rogue 200 again'); here = 'whiterun'; setGold(OUTLAW, 500); setGold(GUARD, 0);
ok('hold only: a Bruma bounty is not claimed in Whiterun', globalThis.__dboOutlawJailed(GUARD, OUTLAW) === 0 && gold(GUARD) === 0 && gold(OUTLAW) === 500);
ok('...and /bounty pay there says so', /not wanted in Whiterun/.test(run(OUTLAW, 'pay')));
here = 'bruma';
ok('the outlaw tells their own bounty', /You are wanted in Bruma: 200 gold/.test(run(OUTLAW, '')));
ok('paying it: 200 to Bruma\'s treasury, the bounty gone', /no longer wanted/.test(run(OUTLAW, 'pay')) && gold(OUTLAW) === 300 && deposits.some(([z, n]) => z === 'bruma' && n === 200));
run(COUNTESS, 'set Rogue 1000 murder'); setGold(OUTLAW, 0); props.set(`${OUTLAW}|private.bankGold`, 0);
ok('paying more than they have is refused, nothing taken', /more than you have/.test(run(OUTLAW, 'pay')));
extra = globalThis.__dboOutlawJailed(GUARD, OUTLAW);
ok('nothing to pay: 1000 gold is 100 minutes, capped at 240', extra === 100, extra);
ok('a Lead GM may set one anywhere', /wanted in Bruma for 10/.test(run(LEAD, 'set Pell 10 test')));
ok('every step is audited', audits.some((t) => /BOUNTY set/.test(t)) && audits.some((t) => /BOUNTY claimed/.test(t)) && audits.some((t) => /BOUNTY paid/.test(t)) && audits.some((t) => /BOUNTY cleared/.test(t)));
ok('the state is on disk', JSON.parse(fs.readFileSync('outlaws.json', 'utf8')).zones.bruma['55'].amount === 10);
// ---- the F3 Wanted tab ----------------------------------------------------------------------------------------------------
{
  here = 'bruma';
  const sec = globalThis.__dboJournalSections.wanted;
  ok('tab: registered as Wanted', sec && sec.label() === 'Wanted');
  ok('tab: the Countess sees it, with the set form', sec.visible(COUNTESS) && sec.view(COUNTESS).canDeclare === true && sec.view(COUNTESS).max === 1000);
  ok('tab: a townsperson sees the wanted list (Pell is wanted)', sec.visible(TOWNIE) && sec.view(TOWNIE).wanted.some((w) => w.name === 'Pell') && sec.view(TOWNIE).canDeclare === false);
  answers.length = 0;
  ui.outlawJ(COUNTESS, ['N', 'set', 'Rogue', '400', 'arson in the Market']);
  let v = sec.view(OUTLAW);
  ok('tab: Set from the form', /Rogue is wanted in Bruma for 400 gold/.test(answers.at(-1).text) && answers.at(-1).kind === 'ok' && v.mine.some((m) => m.amount === 400 && m.here), answers.at(-1));
  ok('tab: the outlaw gets a badge', (sec.visible(OUTLAW) || {}).badge === 1);
  ui.outlawJ(GUARD, ['N', 'set', 'Rogue', '10', 'x']);
  ok('tab: a guard\'s Set is refused', answers.at(-1).kind === 'refused' && /Only the ruler or the Steward/.test(answers.at(-1).text));
  ui.outlawJ(COUNTESS, ['old', 'set', 'Rogue', '10', 'x']);
  ok('tab: a stale journal nonce does nothing', answers.length === 2);
  setGold(OUTLAW, 500);
  ui.outlawJ(OUTLAW, ['N', 'pay']);
  ok('tab: Pay settles it into the treasury', answers.at(-1).kind === 'ok' && gold(OUTLAW) === 100 && sec.view(OUTLAW).mine.length === 0, answers.at(-1));
  const pellPid = sec.view(TOWNIE).wanted.find((w) => w.name === 'Pell').pid;
  ui.outlawJ(STEWARD, ['N', 'clear', String(pellPid)]);
  ok('tab: Clear by the Steward lifts it', answers.at(-1).kind === 'ok' && !sec.view(TOWNIE).wanted.length, answers.at(-1));
  ok('tab: with nobody wanted, a townsperson no longer sees the tab', !sec.visible(TOWNIE));
}
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* temp */ }
console.log(fails ? `${fails} FAILED` : 'all checks passed'); process.exit(fails ? 1 : 0);
