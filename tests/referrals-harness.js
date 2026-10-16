// Referral links and their boosts (referrals.js, config "referrals"; Nate, 16 Oct 2026) against a stub server, a stub
// clock and a stub backend bindings file: codes, bindings, qualification, the boost queue paused and resumed by play,
// no stacking, the cap, the wait behind private.xpBoost, the carry weight ability, the fallback command and revocation.
//   node tests/referrals-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));
const GAMEMODE = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8');
const IGNORE = fs.readFileSync(path.join(SERVER, '.gitignore'), 'utf8');
const MODULE = path.join(SERVER, 'referrals.js');

let fails = 0, checks = 0;
const ok = (label, cond, got) => { checks++; if (!cond) { fails++; console.log(`  FAIL ${label}${got !== undefined ? `: got ${JSON.stringify(got)}` : ''}`); } };
const near = (a, b) => Math.abs(a - b) < 1e-9;

// ---- what ships ----------------------------------------------------------------------------------------------------
const R = CONFIG.referrals || {};
ok('config: shipped off, Nate\'s numbers', R.enabled === false && R.firstMult === 1.15 && R.laterMult === 1.05 && R.welcomeMult === 1.05 && R.boostHours === 8 && R.queueCap === 10
  && R.qualifyHours === 5 && R.qualifyDays === 2 && R.accountAgeDays === 30 && R.carrySpell === '', R);
ok('gitignore keeps the records out of the public repo', /^referrals\.json$/m.test(IGNORE) && /^referrals\.json\.tmp$/m.test(IGNORE));
ok('gamemode loads referrals.js after playtime.js with what it needs', /require\(PLAYTIME_JS\)[\s\S]*require\(REFERRALS_JS\)\(\{[^}]*discordOf[^}]*isLeadStaff[^}]*creationPending[^}]*cfg \}\)/.test(GAMEMODE));
ok('a failed load clears the rate hook', /log\('referrals\.js failed to load:', e\.stack \|\| e\.message\); globalThis\.__dboReferralSkillRate = null; \}/.test(GAMEMODE));

// ---- the stub server -----------------------------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-referrals-'));
process.chdir(tmp);
const BIND = path.join(tmp, 'referrals.jsonl');
const H = 3600000, D = 24 * H;
let clock = Date.parse('2026-10-20T10:00:00Z');
Date.now = () => clock;
// Accounts the play-time records knew before go-live: 1 (staff), 5 and 7 (veterans)
fs.writeFileSync(path.join(tmp, 'playtime-slots.json'), JSON.stringify({ profiles: { 1: { ms: 0 }, 5: { ms: 9 * H }, 7: { ms: 200 * H } } }));

const props = new Map();
const papyrus = [];
const CARRY_ID = 0x0a123456, CARRY_DESC = '123456:DragonBreak Online Edits.esp';
const mp = {
  get: (id, p) => props.get(`${id >>> 0}|${p}`), set: (id, p, v) => props.set(`${id >>> 0}|${p}`, v),
  getIdFromDesc: (d) => (d === '123456:DragonBreak Online Edits.esp' ? CARRY_ID : 0),
  getDescFromId: (id) => ((id >>> 0) === CARRY_ID ? '123456:DragonBreak Online Edits.esp' : (id >>> 0).toString(16)),
  lookupEspmRecordById: (id) => (id === CARRY_ID ? { record: { type: 'SPEL' } } : null),
  callPapyrusFunction: (kind, cls, fn, self, args) => papyrus.push({ fn, self: self.desc, spell: args[0].desc }),
};
// Actors: one per account; 5 and 7 are veterans, 20+ are accounts made after go-live
const A = { staff: 0xff000001, v5: 0xff000005, v7: 0xff000007, n20: 0xff000020, n21: 0xff000021, n22: 0xff000022, n23: 0xff000023, n24: 0xff000024, n30: 0xff000030 };
const PID = { [A.staff]: 1, [A.v5]: 5, [A.v7]: 7, [A.n20]: 20, [A.n21]: 21, [A.n22]: 22, [A.n23]: 23, [A.n24]: 24, [A.n30]: 30 };
for (const [a, p] of Object.entries(PID)) mp.set(Number(a), 'profileId', p);
const snowflake = (ms) => String(BigInt(ms - 1420070400000) << 22n);
const OLD_DISCORD = snowflake(Date.parse('2024-01-01T00:00:00Z'));
const NEW_DISCORD = snowflake(clock - 3 * D);
const discord = { [A.n24]: OLD_DISCORD, [A.n30]: NEW_DISCORD, [0xff000040]: OLD_DISCORD, [A.v5]: OLD_DISCORD };
let online = [];
const timers = new Map();
const said = [], audits = [];
const commands = new Map();
const ui = new Map(), answers = [];
globalThis.__dboJournalFresh = (a, nonce) => nonce === 'n1';
globalThis.__dboJournalLimited = (a, fn) => answers.push(fn());
const api = (over) => ({
  mp, log: () => {},
  personal: (a, t) => said.push({ a, t }), system: (a, t) => said.push({ a, t, sys: true }),
  registerChatCommand: (n, fn) => commands.set(n, fn), audit: (t) => audits.push(t),
  who: (a) => `who${(a >>> 0).toString(16)}`, display: (a) => `char${(a >>> 0).toString(16)}`,
  profileOf: (a) => { const v = mp.get(a, 'profileId'); return v === undefined ? -1 : Number(v); },
  discordOf: (a) => discord[a >>> 0] || '',
  isAdmin: (a) => (a >>> 0) === A.staff, isLeadStaff: (a) => (a >>> 0) === A.staff,
  findAnyByName: () => 0, onlineActors: () => online.slice(), every: (name, ms, fn) => timers.set(name, { ms, fn }),
  creationPending: () => false,
  onUi: (ev, fn) => ui.set(ev, fn),
  cfg: { referrals: Object.assign({}, R, { enabled: true, bindingsFile: BIND }, over || {}) },
});
let M;
const status = new Map();
globalThis.__dboRegisterStatus = (k, o, fn) => status.set(k, fn);
const load = (over) => { delete require.cache[MODULE]; M = require(MODULE)(api(over)); };
const tick = () => timers.get('referrals').fn();
// Plays `ms` in 30 s samples for whoever is online
const play = (ms) => { for (let t = 0; t < ms; t += 30000) { clock += 30000; tick(); } };
const rec = (pid) => globalThis.__dboReferrals.store.profiles[String(pid)];
const rate = (a) => globalThis.__dboReferralSkillRate(a);
const cmd = (a, args) => { const n = said.length; commands.get('referral')(a, args); return said.slice(n).map((x) => x.t).join(' | '); };
const bindLine = (o) => fs.appendFileSync(BIND, JSON.stringify(Object.assign({ kind: 'bind', v: 1, at: clock, via: 'cookie', accountCreatedAt: Date.parse('2024-01-01T00:00:00Z') }, o)) + '\n');
const settle = () => new Promise((r) => setTimeout(r, 30));

(async () => {
  load();
  ok('go-live snapshot: the accounts already known, highest 7', JSON.stringify(globalThis.__dboReferrals.store.preexisting) === '[1,5,7]' && globalThis.__dboReferrals.store.maxPidAtLive === 7);

  // ---- codes ----
  online = [A.v5, A.v7];
  tick();
  const c5 = rec(5).code, c7 = rec(7).code;
  ok('every account in the world gets a code of 8 from the alphabet', /^[BCDFGHJKLMNPQRSTVWXZ2-9]{8}$/.test(c5) && /^[BCDFGHJKLMNPQRSTVWXZ2-9]{8}$/.test(c7) && c5 !== c7, [c5, c7]);
  ok('the code is kept', M.codeOf(5) === c5);
  ok('/referral shows the link', cmd(A.v5, '').includes(`https://dragonbreakonline.com/api/join/${c5}`));
  ok('/status line carries the link', String(status.get('referral')(A.v5)).includes(`/api/join/${c5}`), status.get('referral')(A.v5));

  // ---- a binding from the backend ----
  bindLine({ code: c5, profileId: 20 });
  bindLine({ code: 'BBBBBBBB', profileId: 21 });     // unknown code
  bindLine({ code: c5, profileId: 5 });              // own code
  bindLine({ code: c7, profileId: 22, accountCreatedAt: clock - 10 * D });   // young Discord account
  fs.appendFileSync(BIND, '{"kind":"bind","code":"half');               // a line still being written
  ok('the backend\'s lines are read', (await M.readBindings()) === 4);
  ok('20 is referred by 5, pending, with its welcome queued', rec(20).ref.by === 5 && rec(20).ref.status === 'pending' && rec(20).queue.length === 1 && rec(20).queue[0].kind === 'welcome' && near(rec(20).queue[0].mult, 1.05), rec(20));
  ok('an unknown code binds nothing', !rec(21) || !rec(21).ref);
  ok('a referral with your own code is refused', !rec(5).ref && audits.some((t) => /profile 5 code .* refused: own code/.test(t)));
  ok('a young Discord account is recorded but cannot count, and still gets the welcome', rec(22).ref.status === 'ineligible' && /under 30 days/.test(rec(22).ref.reason) && rec(22).queue.length === 1);
  fs.appendFileSync(BIND, 'x"}\n');
  bindLine({ code: c7, profileId: 20 });
  await M.readBindings();
  ok('one referrer per account: a second binding is ignored', rec(20).ref.by === 5 && audits.some((t) => /profile 20 .* ignored: already referred by profile 5/.test(t)));
  bindLine({ code: c5, profileId: 7 });
  await M.readBindings();
  ok('an account seen before go-live is refused', !rec(7).ref && audits.some((t) => /profile 7 .* refused: account seen before/.test(t)));

  // ---- the welcome: paused and resumed by play ----
  online = [A.n20];
  tick();
  ok('the welcome is told once and runs at once', said.some((x) => x.a === A.n20 && x.sys && /friend invited you/.test(x.t)) && near(rate(A.n20), 1.05));
  ok('not for a character with nothing queued', rate(A.v7) === 1);
  play(2 * H);
  ok('2 h of play take 2 h off', Math.abs(rec(20).queue[0].leftMs - 6 * H) <= 30000, rec(20).queue[0].leftMs);
  online = [];
  clock += 2 * H; tick();
  ok('offline: nothing is taken', Math.abs(rec(20).queue[0].leftMs - 6 * H) <= 30000);
  online = [A.n20]; tick();
  ok('the first sample after a return adds nothing', Math.abs(rec(20).queue[0].leftMs - 6 * H) <= 30000);
  // A playtester boost on the character: the referral boost waits
  mp.set(A.n20, 'private.xpBoost', { mult: 2, until: clock + H });
  ok('behind a running xpBoost the rate is 1', rate(A.n20) === 1);
  const before = rec(20).queue[0].leftMs;
  play(30 * 60000);
  ok('...and its time is not used', rec(20).queue[0].leftMs === before);
  clock += H; tick();
  ok('the xpBoost over: the referral boost runs again', near(rate(A.n20), 1.05));

  // ---- qualification ----
  const r20 = rec(20);
  ok('play counts toward qualifying', r20.ms >= 2.5 * H && r20.days.length === 1, [r20.ms, r20.days]);
  play(3 * H);
  ok('5 h on one day do not qualify', r20.ref.status === 'pending' && r20.ms >= 5 * H, [r20.ms, r20.days]);
  online = []; clock = Date.parse('2026-10-21T09:00:00Z'); tick(); online = [A.n20]; tick();
  play(60000);
  ok('5 h on two days qualify', r20.ref.status === 'qualified', [r20.ms, r20.days, r20.ref.status]);
  ok('the referrer\'s first boost is +15% for 8 h of play, with the carry weight', rec(5).queue.length === 1 && near(rec(5).queue[0].mult, 1.15) && rec(5).queue[0].kind === 'first' && rec(5).queue[0].leftMs === 8 * H && rec(5).carryFrom === 20);
  ok('the welcome still runs', near(rate(A.n20), 1.05) && rec(20).queue.length === 1);
  play(rec(20).queue[0].leftMs + 30000);
  ok('the welcome ran out after 8 h of play and was said', rec(20).queue.length === 0 && said.some((x) => x.a === A.n20 && /welcome boost .* has run out/.test(x.t)));
  ok('a boost runs only for the account that earned it', rate(A.n20) === 1);

  // The referrer, offline when it qualified, hears it at login
  online = [A.v5]; tick();
  ok('the referrer is told at their next login', said.some((x) => x.a === A.v5 && x.sys && /counts as your referral/.test(x.t) && /\+15%/.test(x.t) && /carry weight/.test(x.t)));
  ok('the referrer\'s boost runs', near(rate(A.v5), 1.15));

  // ---- a later referral: queued behind, never stacked ----
  online = [A.v5, A.n23];
  tick();
  ok('/referral <code> in the first 24 h works', /Thank you/.test(cmd(A.n23, c5)), rec(23).ref);
  ok('...recorded as a command referral with the Discord age unknown -> cannot count', rec(23).ref.via === 'command' && rec(23).ref.status === 'ineligible');
  online = [A.v5, A.n24]; tick();
  ok('a second code is refused for an account already referred', /already been referred/.test(cmd(A.n23, c7)));
  ok('a veteran cannot enter a code', /after referrals opened/.test(cmd(A.v7, c5)));
  ok('nobody enters their own code', /own code/.test(cmd(A.n24, M.codeOf(24))) && !rec(24).ref);
  ok('24 enters 5\'s code', /Thank you/.test(cmd(A.n24, c5)) && rec(24).ref.status === 'pending');
  play(5 * H);
  online = []; clock = Date.parse('2026-10-22T09:00:00Z'); tick(); online = [A.v5, A.n24]; tick(); play(60000);
  ok('24 qualifies', rec(24).ref.status === 'qualified');
  const q5 = rec(5).queue;
  ok('the later boost is +5%, queued behind the first', q5.length === 2 && near(q5[1].mult, 1.05) && q5[1].kind === 'later');
  ok('no stacking: the rate is the first boost alone', near(rate(A.v5), 1.15));
  const firstLeft = q5[0].leftMs;
  play(firstLeft + 60000);
  ok('one after the other: the first ran out, the second runs, the overflow minute taken from it', rec(5).queue.length === 1 && near(rate(A.v5), 1.05) && Math.abs(rec(5).queue[0].leftMs - (8 * H - 60000)) <= 30000, rec(5).queue);

  // ---- the journal tab's code box ----
  const A40 = 0xff000040; mp.set(A40, 'profileId', 40);
  online = [A40]; tick();
  ok('the tab offers the code box to a new account', globalThis.__dboJournalSections.referrals.view(A40).canEnter === true);
  ui.get('referralCode')(A40, ['stale', c5]);
  ok('a stale nonce is ignored', answers.length === 0 && !rec(40).ref);
  ui.get('referralCode')(A40, ['n1', c5.toLowerCase()]);
  ok('the tab enters a code, answered in the footer', answers.length === 1 && answers[0].tab === 'referrals' && answers[0].kind === 'ok' && rec(40).ref && rec(40).ref.by === 5 && rec(40).ref.status === 'pending', answers);
  ui.get('referralCode')(A40, ['n1', c7]);
  ok('...once', answers[1] && answers[1].kind === 'refused' && /already/.test(answers[1].text) && globalThis.__dboJournalSections.referrals.view(A40).canEnter === false);

  // ---- the command window ----
  online = [A.n30]; tick();
  play(25 * H);
  ok('after 24 h of play a code is refused', /first 24 hours/.test(cmd(A.n30, c5)) && !rec(30).ref);

  // ---- the queue cap ----
  rec(7).queue = [];
  for (let i = 0; i < 12; i++) M.bind({ referee: 100 + i, code: c7, at: clock, via: 'link', accountAt: Date.parse('2024-01-01T00:00:00Z') });
  for (let i = 0; i < 12; i++) { const r = rec(100 + i); r.ms = 5 * H; r.days = ['2026-10-20', '2026-10-21']; }
  online = []; for (let i = 0; i < 12; i++) { mp.set(0xff000100 + i, 'profileId', 100 + i); online.push(0xff000100 + i); }
  clock += 60000; tick(); clock += 30000; tick();
  ok('12 referrals qualify', Array.from({ length: 12 }, (_, i) => rec(100 + i).ref.status).every((s) => s === 'qualified'));
  ok('at most 10 boosts wait; the rest are audited, the referrals still count', rec(7).queue.length === 10 && rec(7).dropped === 2 && audits.filter((t) => /profile 7 boost .* not queued: 10 already waiting/.test(t)).length === 2);
  ok('only the first of them is +15%', near(rec(7).queue[0].mult, 1.15) && rec(7).queue.slice(1).every((b) => near(b.mult, 1.05)));

  // ---- carry weight ----
  online = [A.v5]; papyrus.length = 0;
  load({ carrySpell: '' }); tick();
  ok('without the record no ability is given', papyrus.length === 0);
  load({ carrySpell: '123456:DragonBreak Online Edits.esp' }); tick(); tick();
  ok('with it, given once a session', papyrus.filter((p) => p.fn === 'AddSpell' && p.spell === CARRY_DESC).length === 1 && mp.get(A.v5, 'private.dboReferralCarry') === CARRY_DESC);

  // ---- revocation ----
  ok('a GM below Lead cannot revoke', /Lead GM/.test(cmd(A.v5, 'revoke 24')));
  ok('staff revoke the later referral', /revoked/.test(cmd(A.staff, 'revoke 24 alt account')) && rec(24).ref.status === 'revoked');
  ok('...its boost leaves the queue, the carry stays (20 still counts)', rec(5).queue.every((b) => b.from !== 24) && papyrus.every((p) => p.fn !== 'RemoveSpell'));
  ok('...audited with who and why', audits.some((t) => /^REFERRAL profile 24 \(referred by profile 5, was qualified\) revoked by whoff000001: alt account/.test(t)), audits.filter((t) => /revoked/.test(t)));
  cmd(A.staff, 'revoke 20');
  tick();
  ok('revoking the last counted referral takes the carry weight back', papyrus.some((p) => p.fn === 'RemoveSpell' && p.spell === CARRY_DESC) && !mp.get(A.v5, 'private.dboReferralCarry'));
  ok('a revoked referral cannot be revoked twice', /already revoked/.test(cmd(A.staff, 'revoke 20')));
  ok('staff see an account', /referred by 5 .*revoked/.test(cmd(A.staff, 'profile 20')));
  ok('the friends list shows them taken back', /taken back by staff/.test(cmd(A.v5, '')));

  // ---- the journal and the switch ----
  const v = globalThis.__dboJournalSections.referrals.view(A.v5);
  ok('journal section: link, friends, queue', v && v.link.endsWith(c5) && Array.isArray(v.friends) && v.friends.length >= 3 && Array.isArray(v.queue));
  load({ enabled: false });
  ok('off: no rate, no section, the command says so', rate(A.v5) === 1 && globalThis.__dboJournalSections.referrals.visible() === false && /not open yet/.test(cmd(A.v5, '')));

  // ---- the file shrank (the backend's file replaced) ----
  load();
  fs.writeFileSync(BIND, '');
  await M.readBindings();
  ok('a shrunk file is read again from the start', globalThis.__dboReferrals.store.offset === 0);

  // ---- skillrates.js applies the boost after the skill's own rate ----
  const SR = path.join(SERVER, 'skillrates.js');
  delete require.cache[SR];
  let beast = false;
  const sr = require(SR)({ log: () => {}, cfg: { skillRates: { enabled: true, rates: { miner: 2 } } }, recordOf: () => null, fieldsOf: () => [], inBeastForm: () => beast, mp: null, personal: () => {} });
  globalThis.__dboReferralSkillRate = () => 1.15;
  ok('skillrates: a referral boost multiplies the rate', near(sr.rateFor(A.v5, 'miner', 'mine', {}), 2.3) && near(sr.rateFor(A.v5, 'cook', 'kill', {}), 1.15));
  beast = true;
  ok('skillrates: the beast still trains nothing', sr.rateFor(A.v5, 'miner', 'mine', {}) === 0);
  beast = false;
  globalThis.__dboReferralSkillRate = () => 9;
  ok('skillrates: an out-of-range answer is ignored', near(sr.rateFor(A.v5, 'miner', 'mine', {}), 2));

  await settle();
  M.flush(); await settle();
  ok('records are written to referrals.json', fs.existsSync(path.join(tmp, 'referrals.json')));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`referrals: ${checks - fails}/${checks} checks passed`);
  process.exit(fails ? 1 : 0);
})();
