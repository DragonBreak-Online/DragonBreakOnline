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
ok('config: on since 17 Oct (Nate: push referrals), Nate\'s numbers', R.enabled === true && R.firstMult === 1.15 && R.laterMult === 1.05 && R.welcomeMult === 1.05 && R.boostHours === 8 && R.queueCap === 10
  && R.qualifyHours === 5 && R.qualifyDays === 2 && R.accountAgeDays === 90 && /players\.json$/.test(R.playersFile) && /device-ids\.json$/.test(R.devicesFile) && R.carrySpell === '1d1fa7:DragonBreak Online Edits.esp'
  && R.deviceCheck === false && R.carryWeight === 50 && R.qualifyDayMinutes >= 30 && R.sessionGapMinutes >= 30 && R.linkBase === 'https://dragonbreakonline.com/api/users/login-discord/join/', R);
ok('a Discord ban revokes the banned account\'s referrals', /if \(op === 'ban' && typeof globalThis\.__dboReferralBan === 'function'\)/.test(GAMEMODE));
ok('gitignore keeps the records out of the public repo', /^referrals\.json$/m.test(IGNORE) && /^referrals\.json\.tmp$/m.test(IGNORE));
ok('gamemode loads referrals.js after playtime.js with what it needs', /require\(PLAYTIME_JS\)[\s\S]*require\(REFERRALS_JS\)\(\{[^}]*discordOf[^}]*isLeadStaff[^}]*creationPending[^}]*cfg \}\)/.test(GAMEMODE));
ok('a failed load clears the rate hook', /log\('referrals\.js failed to load:', e\.stack \|\| e\.message\); globalThis\.__dboReferralSkillRate = null; \}/.test(GAMEMODE));

// ---- the stub server -----------------------------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-referrals-'));
process.chdir(tmp);
const BIND = path.join(tmp, 'referrals.jsonl');
const PLAYERS = path.join(tmp, 'players.json'), DEVICES = path.join(tmp, 'device-ids.json');
// The backend's player store: every account its own address; no device store yet (the live box has none, 16 Oct)
const playerRows = {};
for (const p of [1, 5, 7, 20, 21, 22, 23, 24, 30, 40, ...Array.from({ length: 12 }, (_, i) => 100 + i), 50, 51, 52, 53, 54, 55, 56, 57, 58]) playerRows[`d${p}`] = { profileId: p, discordId: `d${p}`, lastIp: `10.0.0.${p}` };
const writePlayers = () => fs.writeFileSync(PLAYERS, JSON.stringify(playerRows));
writePlayers();
const H = 3600000, D = 24 * H;
let clock = Date.parse('2026-10-20T10:00:00Z');
Date.now = () => clock;
// Accounts the play-time records knew before go-live: 1 (staff), 5 and 7 (veterans), 8 (made and played while referrals were deployed off)
fs.writeFileSync(path.join(tmp, 'playtime-slots.json'), JSON.stringify({ profiles: { 1: { ms: 0 }, 5: { ms: 9 * H }, 7: { ms: 200 * H }, 8: { ms: 30 * H } } }));

const props = new Map();
const papyrus = [];
const CARRY_ID = 0x0a123456, CARRY_DESC = '123456:DragonBreak Online Edits.esp';
const CARRY2_ID = 0x0a654321, CARRY2_DESC = '654321:DragonBreak Online Edits.esp';
const DESCS = { [CARRY_DESC]: CARRY_ID, [CARRY2_DESC]: CARRY2_ID };
const mp = {
  get: (id, p) => props.get(`${id >>> 0}|${p}`), set: (id, p, v) => props.set(`${id >>> 0}|${p}`, v),
  getIdFromDesc: (d) => DESCS[d] || 0,
  getDescFromId: (id) => Object.keys(DESCS).find((k) => DESCS[k] === (id >>> 0)) || (id >>> 0).toString(16),
  lookupEspmRecordById: (id) => (id === CARRY_ID || id === CARRY2_ID ? { record: { type: 'SPEL' } } : null),
  callPapyrusFunction: (kind, cls, fn, self, args) => papyrus.push({ fn, self: self.desc, spell: args[0].desc }),
};
// Actors: one per account; 5 and 7 are veterans, 20+ are accounts made after go-live
const A = { staff: 0xff000001, v5: 0xff000005, v7: 0xff000007, v8: 0xff000008, n20: 0xff000020, n21: 0xff000021, n22: 0xff000022, n23: 0xff000023, n24: 0xff000024, n30: 0xff000030 };
const PID = { [A.staff]: 1, [A.v5]: 5, [A.v7]: 7, [A.v8]: 8, [A.n20]: 20, [A.n21]: 21, [A.n22]: 22, [A.n23]: 23, [A.n24]: 24, [A.n30]: 30 };
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
  cfg: { referrals: Object.assign({}, R, { enabled: true, bindingsFile: BIND, playersFile: PLAYERS, devicesFile: DEVICES }, over || {}) },
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
const settle = () => new Promise((r) => setTimeout(r, 60));

(async () => {
  // Deployed off: no snapshot, nothing written
  load({ enabled: false });
  await settle();
  ok('off: no go-live snapshot and no referrals.json', !globalThis.__dboReferrals.store.liveAt && !fs.existsSync(path.join(tmp, 'referrals.json')));
  load();
  ok('go-live snapshot on the first load with referrals on: the accounts already known, highest 8', JSON.stringify(globalThis.__dboReferrals.store.preexisting) === '[1,5,7,8]' && globalThis.__dboReferrals.store.maxPidAtLive === 8);
  ok('an account that played while referrals were off cannot enter a code after they open', /after referrals opened/.test(cmd(A.v8, 'BCDFGHJK')));

  // ---- codes ----
  online = [A.v5, A.v7];
  tick();
  const c5 = rec(5).code, c7 = rec(7).code;
  ok('every account in the world gets a code of 8 from the alphabet', /^[BCDFGHJKLMNPQRSTVWXZ2-9]{8}$/.test(c5) && /^[BCDFGHJKLMNPQRSTVWXZ2-9]{8}$/.test(c7) && c5 !== c7, [c5, c7]);
  ok('the code is kept', M.codeOf(5) === c5);
  ok('/referral shows the link', cmd(A.v5, '').includes(`https://dragonbreakonline.com/api/users/login-discord/join/${c5}`));
  ok('/status line carries the link', String(status.get('referral')(A.v5)).includes(`/login-discord/join/${c5}`), status.get('referral')(A.v5));

  // ---- a binding from the backend ----
  bindLine({ code: c5, profileId: 20 });
  bindLine({ code: 'BBBBBBBB', profileId: 21 });     // unknown code
  bindLine({ code: c5, profileId: 5 });              // own code
  bindLine({ code: c7, profileId: 22, accountCreatedAt: clock - 60 * D });   // 60 days: old enough under 30, young under 90
  fs.appendFileSync(BIND, '{"kind":"bind","code":"half');               // a line still being written
  ok('the backend\'s lines are read', (await M.readBindings()) === 4);
  ok('20 is referred by 5, pending, with its welcome queued', rec(20).ref.by === 5 && rec(20).ref.status === 'pending' && rec(20).queue.length === 1 && rec(20).queue[0].kind === 'welcome' && near(rec(20).queue[0].mult, 1.05), rec(20));
  ok('an unknown code binds nothing', !rec(21) || !rec(21).ref);
  ok('a referral with your own code is refused', !rec(5).ref && audits.some((t) => /profile 5 code .* refused: own code/.test(t)));
  ok('a young Discord account is recorded but cannot count, and still gets the welcome', rec(22).ref.status === 'ineligible' && /under 90 days/.test(rec(22).ref.reason) && rec(22).queue.length === 1);
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
  play(60000); await settle();
  ok('a minute on the second day does not count that day', r20.ref.status === 'pending' && r20.days.length === 1, [r20.days, r20.dayMs]);
  play(30 * 60000); await settle();
  ok('5 h on two days (30 min or more on the second) qualify', r20.ref.status === 'qualified', [r20.ms, r20.days, r20.ref.status]);
  ok('...saying there was no PC check (off by default)', audits.some((t) => /profile 20 qualified .*no PC check/.test(t)));
  ok('the referrer\'s first boost is +15% for 8 h of play, with the carry weight', rec(5).queue.length === 1 && near(rec(5).queue[0].mult, 1.15) && rec(5).queue[0].kind === 'first' && rec(5).queue[0].leftMs === 8 * H && rec(5).carryFrom === 20);
  ok('the welcome still runs', near(rate(A.n20), 1.05) && rec(20).queue.length === 1);
  play(rec(20).queue[0].leftMs + 30000);
  ok('the welcome ran out after 8 h of play and was said', rec(20).queue.length === 0 && said.some((x) => x.a === A.n20 && /welcome boost .* has run out/.test(x.t)));
  ok('a boost runs only for the account that earned it', rate(A.n20) === 1);

  // The referrer, offline when it qualified, hears it at login
  online = [A.v5]; tick();
  ok('the referrer is told at their next login', said.some((x) => x.a === A.v5 && x.sys && /counts as your referral/.test(x.t) && /\+15%/.test(x.t) && /\+50 carry weight/.test(x.t)));
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
  online = []; clock = Date.parse('2026-10-22T09:00:00Z'); tick(); online = [A.v5, A.n24]; tick(); play(31 * 60000); await settle();
  ok('24 qualifies', rec(24).ref.status === 'qualified');
  const q5 = rec(5).queue;
  ok('the later boost is +5%, queued behind the first', q5.length === 2 && near(q5[1].mult, 1.05) && q5[1].kind === 'later');
  ok('no stacking: the rate is the first boost alone', near(rate(A.v5), 1.15));
  const firstLeft = q5[0].leftMs;
  play(firstLeft + 60000);
  ok('one after the other: the first ran out, the second runs, the overflow minute taken from it', rec(5).queue.length === 1 && near(rate(A.v5), 1.05) && Math.abs(rec(5).queue[0].leftMs - (8 * H - 60000)) <= 60000, rec(5).queue);

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
  // The account's lifetime play (playtime.js) counts, not only what this module counted
  const A61 = 0xff000061; mp.set(A61, 'profileId', 61);
  globalThis.__dboPlaytime = { store: { profiles: { 61: { ms: 30 * H } } } };
  ok('lifetime play over 24 h refuses a code even when this module counted none', /first 24 hours/.test(cmd(A61, c5)) && !(rec(61) && rec(61).ref));
  delete globalThis.__dboPlaytime;

  // ---- one session across midnight UTC is one day ----
  const A62 = 0xff000062; mp.set(A62, 'profileId', 62);
  M.bind({ referee: 62, code: c7, at: clock, via: 'link', accountAt: Date.parse('2024-01-01T00:00:00Z') });
  online = []; tick();
  clock = Date.parse(new Date(clock + D).toISOString().slice(0, 10) + 'T22:00:00Z');
  online = [A62]; tick();
  play(5 * H + 60000);
  ok('22:00Z to 03:01Z in one session: 5 h, but one day, not qualified', rec(62).ref.status === 'pending' && rec(62).ms >= 5 * H && rec(62).days.length === 1, [rec(62).days, rec(62).dayMs]);
  online = []; clock += 6 * H; tick(); online = [A62]; tick();
  play(31 * 60000); await settle();
  ok('...a second session on the next day qualifies it', rec(62).ref.status === 'qualified', [rec(62).days, rec(62).dayMs]);
  // Undone, and 7's first boost re-armed by hand, so the queue cap below starts clean
  M.revoke(62, 'harness', 'harness'); delete rec(7).firstAt;

  // ---- the queue cap ----
  rec(7).queue = [];
  for (let i = 0; i < 12; i++) M.bind({ referee: 100 + i, code: c7, at: clock, via: 'link', accountAt: Date.parse('2024-01-01T00:00:00Z') });
  for (let i = 0; i < 12; i++) { const r = rec(100 + i); r.ms = 5 * H; r.days = ['2026-10-20', '2026-10-21']; }
  online = []; for (let i = 0; i < 12; i++) { mp.set(0xff000100 + i, 'profileId', 100 + i); online.push(0xff000100 + i); }
  clock += 60000; tick(); clock += 30000; tick(); await settle();
  ok('12 referrals qualify', Array.from({ length: 12 }, (_, i) => rec(100 + i).ref.status).every((s) => s === 'qualified'));
  ok('at most 10 boosts wait; the rest are audited, the referrals still count', rec(7).queue.length === 10 && rec(7).dropped === 2 && audits.filter((t) => /profile 7 boost .* not queued: 10 already waiting/.test(t)).length === 2);
  ok('only the first of them is +15%', near(rec(7).queue[0].mult, 1.15) && rec(7).queue.slice(1).every((b) => near(b.mult, 1.05)));

  // ---- no address check; the PC check is off by default ----
  // 52, 53, 54 share the referrer's last address (lastIp is the relay's address for every player): they count
  playerRows.d52.lastIp = playerRows.d5.lastIp; playerRows.d54.lastIp = playerRows.d5.lastIp; writePlayers();
  const setup = (p, code) => {
    M.bind({ referee: p, code, at: clock, via: 'link', accountAt: Date.parse('2024-01-01T00:00:00Z') });
    const r = rec(p); r.ms = 5 * H; r.days = ['2026-10-20', '2026-10-21'];
    mp.set(0xff000000 + p, 'profileId', p);
  };
  for (const p of [52, 53, 54]) setup(p, c5);
  online = [52, 53, 54].map((p) => 0xff000000 + p);
  clock += 30000; tick(); clock += 30000; tick(); await settle();
  ok('no address check: a shared last address counts', [52, 53, 54].every((p) => rec(p).ref.status === 'qualified'));
  ok('with the PC check off the audit says so', audits.some((t) => /profile 53 qualified .*no PC check/.test(t)));

  // deviceCheck on: 50 shares 5's PC; 51 shares the PC of 24 (5's counted referral); 56 (7's) shares 53's (5's), a household
  // of two referrers; 57 and 58 (5's) share one PC and are checked in the same pass
  fs.writeFileSync(DEVICES, JSON.stringify({ v: 1, accounts: { d5: { d: [{ h: 'pc-five' }] }, d24: { d: [{ h: 'pc-24' }] }, d50: { d: [{ h: 'pc-five' }] }, d51: { d: [{ h: 'pc-x' }, { h: 'pc-24' }] }, d53: { d: [{ h: 'pc-53' }] }, d56: { d: [{ h: 'pc-53' }] }, d57: { d: [{ h: 'pc-57' }] }, d58: { d: [{ h: 'pc-57' }] } } }));
  load({ deviceCheck: true });
  const q5before = rec(5).queue.length;
  for (const p of [50, 51, 57, 58]) setup(p, c5);
  setup(56, c7);
  online = [50, 51, 56, 57, 58].map((p) => 0xff000000 + p);
  clock += 30000; tick(); clock += 30000; tick(); await settle();
  ok('the referrer\'s own PC holds it for staff, never refuses', rec(50).ref.status === 'held' && audits.some((t) => /^REFERRAL held for review: profile 50 \(referred by profile 5\) shares a PC with the referrer/.test(t)));
  ok('the PC of another live referral of the same referrer: held', rec(51).ref.status === 'held');
  ok('a household (the same PC as another referrer\'s referral) counts', rec(56).ref.status === 'qualified', rec(56).ref);
  ok('two referrals checked in the same pass do not refuse each other', rec(57).ref.status === 'held' && rec(58).ref.status === 'held');
  ok('held referrals earn nothing yet', rec(5).queue.length === q5before);
  const seen5 = cmd(A.v5, '');
  ok('the referrer sees only "being checked by staff", never a PC or an address', /being checked by staff/.test(seen5) && !/\bPC\b|address/i.test(seen5), seen5);
  ok('nothing about a PC is kept in a reason a player can see', [50, 51, 57, 58].every((p) => rec(p).ref.reason === 'PC check'));
  ok('staff list the held ones', /profile 50 .*PC check/.test(cmd(A.staff, 'held')) && /profile 51/.test(cmd(A.staff, 'held')));
  ok('a GM below Lead cannot decide', /Lead GM/.test(cmd(A.v5, 'approve 50')) && rec(50).ref.status === 'held');
  ok('a Lead GM approves: it counts and earns its boost', /approved/.test(cmd(A.staff, 'approve 50')) && rec(50).ref.status === 'qualified' && rec(5).queue.length === q5before + 1 && audits.some((t) => /profile 50 approved by/.test(t)));
  ok('a Lead GM refuses: it never counts, the welcome stays', /refused/.test(cmd(A.staff, 'refuse 51 same household')) && rec(51).ref.status === 'refused' && rec(51).queue.some((b) => b.kind === 'welcome') && audits.some((t) => /profile 51 .*refused by .*after review: same household/.test(t)));
  ok('only a held referral can be decided', /no referral held/.test(cmd(A.staff, 'approve 53')));
  load();

  // ---- carry weight ----
  online = [A.v5]; papyrus.length = 0;
  load({ carrySpell: '' }); tick();
  ok('without the record no ability is given', papyrus.length === 0);
  load({ carrySpell: '123456:DragonBreak Online Edits.esp' }); tick(); tick();
  ok('with it, given once a session', papyrus.filter((p) => p.fn === 'AddSpell' && p.spell === CARRY_DESC).length === 1 && mp.get(A.v5, 'private.dboReferralCarry') === CARRY_DESC);
  papyrus.length = 0;
  load({ carrySpell: CARRY2_DESC }); tick(); tick();
  ok('a new record: the old ability is removed before the new one is given', papyrus.length === 2 && papyrus[0].fn === 'RemoveSpell' && papyrus[0].spell === CARRY_DESC && papyrus[1].fn === 'AddSpell' && papyrus[1].spell === CARRY2_DESC && mp.get(A.v5, 'private.dboReferralCarry') === CARRY2_DESC, papyrus);
  papyrus.length = 0;
  load({ carrySpell: 'remove' }); tick(); tick();
  ok('carrySpell "remove" takes it back while referrals are on, and gives nothing', papyrus.length === 1 && papyrus[0].fn === 'RemoveSpell' && papyrus[0].spell === CARRY2_DESC && !mp.get(A.v5, 'private.dboReferralCarry'), papyrus);
  load({ carrySpell: CARRY_DESC }); tick();
  ok('...and the record set again gives it again', mp.get(A.v5, 'private.dboReferralCarry') === CARRY_DESC);
  papyrus.length = 0;

  // ---- revocation ----
  ok('a GM below Lead cannot revoke', /Lead GM/.test(cmd(A.v5, 'revoke 24')));
  ok('staff revoke the later referral', /revoked/.test(cmd(A.staff, 'revoke 24 alt account')) && rec(24).ref.status === 'revoked');
  ok('...its boost leaves the queue, the carry stays (20 still counts)', rec(5).queue.every((b) => b.from !== 24) && papyrus.every((p) => p.fn !== 'RemoveSpell'));
  ok('...audited with who and why', audits.some((t) => /^REFERRAL profile 24 \(referred by profile 5, was qualified\) revoked by whoff000001: alt account/.test(t)), audits.filter((t) => /revoked/.test(t)));
  cmd(A.staff, 'revoke 20');
  tick();
  ok('the carry stays while a later referral still counts', papyrus.every((p) => p.fn !== 'RemoveSpell'));
  cmd(A.staff, 'revoke 52'); cmd(A.staff, 'revoke 53'); cmd(A.staff, 'revoke 54'); cmd(A.staff, 'revoke 50');
  tick();
  ok('revoking the last counted referral takes the carry weight back', papyrus.some((p) => p.fn === 'RemoveSpell' && p.spell === CARRY_DESC) && !mp.get(A.v5, 'private.dboReferralCarry'));
  ok('a revoked referral cannot be revoked twice', /already revoked/.test(cmd(A.staff, 'revoke 20')));
  ok('staff see an account', /referred by 5 .*revoked/.test(cmd(A.staff, 'profile 20')));
  const friendsPart = (t) => ((/Friends: (.*?)\.(?: Boosts:| Carry weight:|$)/.exec(t) || [])[1] || '').split('; ');
  ok('the friends list shows them only as "cannot count", never why', friendsPart(cmd(A.v5, '')).some((t) => /^Friend \d+: cannot count$/.test(t)) && !/taken back|after review|alt account|cannot count \(/.test(cmd(A.v5, '')), cmd(A.v5, ''));

  // ---- the first boost once only ----
  setup(55, c5); online = [A.v5, 0xff000000 + 55];
  clock += 30000; tick(); clock += 30000; tick(); await settle(); tick();
  const last5 = rec(5).queue[rec(5).queue.length - 1] || {};
  ok('after a revoke the next referral earns the later boost, not a second first', rec(55).ref.status === 'qualified' && last5.from === 55 && last5.kind === 'later' && near(last5.mult, 1.05), rec(5).queue);
  ok('...and the carry weight comes back with a counted referral', mp.get(A.v5, 'private.dboReferralCarry') === CARRY_DESC);

  // ---- a Discord ban and a deleted account ----
  ok('a ban revokes the banned account\'s referral as a referee', globalThis.__dboReferralBan([58]) === 1 && rec(58).ref.status === 'revoked' && rec(58).ref.reason === 'banned' && audits.some((t) => /profile 58 .*revoked by a Discord ban: banned/.test(t)));
  const c57 = M.codeOf(57);
  ok('a GM below Lead cannot erase a record', /Lead GM/.test(cmd(A.v5, 'forget 57')) && rec(57));
  ok('a Lead GM erases a deleted account\'s record and code', /erased/.test(cmd(A.staff, 'forget 57')) && !rec(57) && globalThis.__dboReferrals.store.codes[c57] === undefined);

  // ---- the journal and the switch ----
  const v = globalThis.__dboJournalSections.referrals.view(A.v5);
  ok('journal section: link, friends, queue', v && v.link.endsWith(c5) && Array.isArray(v.friends) && v.friends.length >= 3 && Array.isArray(v.queue));
  // R1 (Jake's decision 2): ineligible (23, Discord age unknown), refused (51), revoked by staff (24) and by a ban (58)
  // all show exactly 'Friend N: cannot count', in /referral and in the journal, and no reason reaches the player
  const R1 = { ineligible: 23, refused: 51, revoked: 24, banned: 58 };
  ok('R1: each non-counting state is in place', rec(23).ref.status === 'ineligible' && rec(51).ref.status === 'refused' && rec(24).ref.status === 'revoked' && rec(58).ref.status === 'revoked' && rec(58).ref.reason === 'banned');
  const mine = Object.entries(globalThis.__dboReferrals.store.profiles).filter(([, r]) => r && r.ref && r.ref.by === 5);
  const notCounting = mine.filter(([, r]) => ['ineligible', 'refused', 'revoked'].includes(r.ref.status)).length;
  const neutral = v.friends.filter((f) => /^Friend \d+: cannot count$/.test(f.text));
  ok('R1: journal, every ineligible, refused and revoked friend is exactly "Friend N: cannot count"', neutral.length === notCounting && notCounting >= 4 && neutral.every((f) => f.status === 'ineligible') && v.friends.filter((f) => !['counted', 'playing', 'review'].includes(f.status)).every((f) => /^Friend \d+: cannot count$/.test(f.text)), v.friends);
  for (const [state, pid] of Object.entries(R1)) {
    const sorted = mine.map(([id, r]) => ({ id: Number(id), at: r.ref.at })).sort((x, y) => x.at - y.at);
    const line = v.friends.find((f) => f.text.startsWith(`Friend ${sorted.findIndex((x) => x.id === pid) + 1}:`));
    ok(`R1: the ${state} friend (${pid}) reads "cannot count"`, line && /^Friend \d+: cannot count$/.test(line.text) && line.status === 'ineligible', line);
  }
  const cmdLines = friendsPart(cmd(A.v5, ''));
  ok('R1: /referral shows the same neutral lines', cmdLines.filter((t) => /^Friend \d+: cannot count$/.test(t)).length === notCounting && cmdLines.every((t) => !/cannot count ./.test(t)), cmdLines);
  const vj = JSON.stringify(v);
  ok('R1: the view JSON holds no reason text', !/under 90 days|age unknown|not eligible|banned|alt account|same household|PC check|after review|taken back|by staff/i.test(vj.replace(/being checked by staff/g, '')), vj);
  papyrus.length = 0;
  load({ enabled: false }); tick();
  ok('off: no rate, no section, the command says so', rate(A.v5) === 1 && globalThis.__dboJournalSections.referrals.visible() === false && /not open yet/.test(cmd(A.v5, '')));
  ok('off: the carry weight stays (for good)', papyrus.length === 0 && mp.get(A.v5, 'private.dboReferralCarry') === CARRY_DESC);

  // ---- the file shrank (the backend's file replaced) ----
  load();
  fs.writeFileSync(BIND, '');
  await M.readBindings();
  ok('a shrunk file is read again from the start', globalThis.__dboReferrals.store.offset === 0);
  // The backend rewrote the file (a new inode) without the old rows: the bindings left are read again, silently
  const ignoredBefore = audits.filter((t) => /ignored: already referred/.test(t)).length;
  fs.writeFileSync(BIND + '.new', JSON.stringify({ kind: 'bind', v: 1, at: clock, code: c5, profileId: 20, via: 'cookie', accountCreatedAt: Date.parse('2024-01-01T00:00:00Z') }) + '\n');
  fs.renameSync(BIND + '.new', BIND);
  await M.readBindings();
  ok('a replaced file is read again from the start, and a binding already recorded is silent', globalThis.__dboReferrals.store.offset === fs.statSync(BIND).size && audits.filter((t) => /ignored: already referred/.test(t)).length === ignoredBefore);

  // ---- skillrates.js applies the boost after the skill's own rate ----
  const SR = path.join(SERVER, 'skillrates.js');
  delete require.cache[SR];
  let beast = false;
  const sr = require(SR)({ log: () => {}, cfg: { skillRates: { enabled: true, rates: { miner: 2 } } }, recordOf: () => null, fieldsOf: () => [], inBeastForm: () => beast, mp: null, personal: () => {} });
  globalThis.__dboReferralSkillRate = () => 1.15;
  ok('skillrates: a referral boost multiplies the rate', near(sr.rateFor(A.v5, 'miner', 'mine', {}), 2.3) && near(sr.rateFor(A.v5, 'cook', 'kill', {}), 1.15));
  beast = true;
  const withBoost = [sr.rateFor(A.v5, 'alchemist', 'award', {}), sr.rateFor(A.v5, 'miner', 'award', {})];
  globalThis.__dboReferralSkillRate = () => 1;
  const without = [sr.rateFor(A.v5, 'alchemist', 'award', {}), sr.rateFor(A.v5, 'miner', 'award', {})];
  globalThis.__dboReferralSkillRate = () => 1.15;
  ok('skillrates: never on an award (staff, alchemy)', near(withBoost[0], without[0]) && near(withBoost[1], without[1]), [withBoost, without]);
  ok('skillrates: the beast still trains nothing', sr.rateFor(A.v5, 'miner', 'mine', {}) === 0);
  beast = false;
  globalThis.__dboReferralSkillRate = () => 9;
  ok('skillrates: an out-of-range answer is ignored', near(sr.rateFor(A.v5, 'miner', 'mine', {}), 2));

  await settle();
  M.flush(); await settle();
  ok('records are written to referrals.json', fs.existsSync(path.join(tmp, 'referrals.json')));

  // ---- an unreadable referrals.json: copied aside, the module inert, the file left as it is ----
  const STORE = path.join(tmp, 'referrals.json');
  fs.writeFileSync(STORE, '{"profiles": {"5": {"code": "BROK');
  delete globalThis.__dboReferrals; papyrus.length = 0;
  load({ carrySpell: CARRY_DESC }); online = [A.v5];
  tick(); await M.readBindings(); M.flush(); await settle();
  ok('unreadable: paused, no boost, no carry removal, no write', /paused/.test(cmd(A.v5, '')) && rate(A.v5) === 1 && papyrus.length === 0 && fs.readFileSync(STORE, 'utf8') === '{"profiles": {"5": {"code": "BROK'
    && !globalThis.__dboReferrals.store && globalThis.__dboJournalSections.referrals.visible() === false);
  ok('...a copy is set aside and it is audited', fs.readdirSync(tmp).some((f) => /^referrals\.json\.unreadable-/.test(f)) && audits.some((t) => /records unreadable/.test(t)));
  load(); tick();
  ok('...and stays paused across a hot reload until staff restore it', /paused/.test(cmd(A.v5, '')));
  fs.writeFileSync(STORE, JSON.stringify({ profiles: {}, codes: {}, offset: 0, liveAt: clock, preexisting: [1], maxPidAtLive: 1 }));
  delete globalThis.__dboReferrals; load();
  ok('a restored file runs again', !/paused/.test(cmd(A.v5, '')) && globalThis.__dboReferrals.broken === false);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`referrals: ${checks - fails}/${checks} checks passed`);
  process.exit(fails ? 1 : 0);
})();
