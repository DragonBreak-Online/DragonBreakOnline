// Scripted test for the election notices and the cabinet rule of server\citizenship.js (Nate, 14 Oct 2026: "announce to
// citizens of their holds when players can start putting in their cabinet, then after that 24hrs, an announcement for voting
// to begin, cabinets cant vote. and this will all start once a hold reaches 15 citizens in total").
// Loads the real module in a scratch folder against a mock world with a harness clock, a Discord stub
// (globalThis.__dboDiscordPost) and the login hook gamemode.js calls (globalThis.__dboCitizenLogin); then discordroles.js's
// post helper against a stubbed https.
//
//   node tests/citizenship-announce-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { EventEmitter } = require('events');

const MODULE = path.resolve(__dirname, '..', 'citizenship.js');
const ROLES_MODULE = path.resolve(__dirname, '..', 'discordroles.js');
const GAMEMODE = path.resolve(__dirname, '..', 'gamemode.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-elect-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
let now = Date.UTC(2026, 9, 14, 12, 0);
Date.now = () => now;
const HOUR = 3600000, DAY = 24 * HOUR;

let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 500) : ''}`); if (!c) fails++; };

// ---- the world ---------------------------------------------------------------------------------------------------------
const ZONES = [
  { id: 'bruma', name: 'Bruma', treasury: 'x', officials: ['count', 'steward', 'captain'] },
  { id: 'whiterun', name: 'Whiterun', treasury: 'y', officials: ['jarl', 'steward', 'commander', 'guard'] },
  { id: 'riften', name: 'The Rift', treasury: 'z', officials: ['jarl', 'steward', 'commander', 'guard'] },
  { id: 'dawnstar', name: 'The Pale', officials: ['jarl', 'steward', 'commander'] },
];
const officials = {};
const chars = new Map();
const add = (id, pid, name, race) => { chars.set(id, { pid, name, race: race || 'NordRace' }); return id; };
let online = [];
const guilds = new Map();
globalThis.__dboGuildsOf = (a) => guilds.get(a >>> 0) || [];
globalThis.__dboCourtFaction = () => null;
globalThis.__dboGuildHolders = () => [];
globalThis.__dboFactionList = () => [];
globalThis.__dboGuildInfo = () => null;
globalThis.__dboGuildMembers = () => [];
globalThis.__dboCourtSync = () => '';
globalThis.__dboJournalFresh = () => true;
globalThis.__dboJournalLimited = (a, fn) => fn();
// The Discord stub: what the module hands the bot
const posts = [];
let postFails = false;
globalThis.__dboDiscordPost = (channel, body) => { posts.push({ channel, body }); return postFails ? Promise.reject(new Error('HTTP 403')) : Promise.resolve({ id: '1' }); };

const mp = { get: (id, p) => { const c = chars.get(id >>> 0); if (!c) throw new Error('no such form'); return p === 'type' ? 'MpActor' : undefined; } };
const said = [], logs = [];
const ui = {};
let timer = null;
const ROLES = { bruma: '1553067344442433757', whiterun: '1559949568513155193', riften: '1559950618733580418' };
let citizenCfg = { discordRoles: ROLES, election: { voterRules: { enabled: false } } };
const api = () => ({
  mp, log: (...x) => logs.push(x.join(' ')), audit: () => {}, who: (a) => (chars.get(a >>> 0) || {}).name || `actor ${a}`,
  personal: (a, t) => said.push([a >>> 0, t]), nameOf: (a) => chars.get(a >>> 0).name, ownNameOf: (a) => chars.get(a >>> 0).name, tagOf: (a) => `T${(a >>> 0).toString(16)}`,
  onUi: (n, f) => { ui[n] = f; }, onlineActors: () => online.slice(), isAdmin: () => false, isLeadStaff: () => false,
  profileOf: (a) => { const c = chars.get(a >>> 0); return c ? c.pid : -1; },
  cfg: { citizenship: citizenCfg },
  every: (n, ms, f) => { timer = f; },
  zoneList: () => ZONES, zoneById: (id) => ZONES.find((z) => z.id === String(id)) || null, readOfficials: () => officials,
  rankTitle: (r) => ({ count: 'Count', jarl: 'Jarl', steward: 'Steward', commander: 'Lord Commander' })[r] || r,
  officialTarget: (q) => {
    const s = String(q).toLowerCase();
    const hit = [...chars.entries()].find(([, c]) => c.name.toLowerCase() === s);
    if (!hit) return { error: `No character called ${q}.` };
    return { pid: hit[1].pid, actor: hit[0], online: 0, label: hit[1].name, who: hit[1].name };
  },
  accountActors: (pid) => [...chars.entries()].filter(([, c]) => c.pid === pid).map(([id]) => id),
  seatOfficial: () => ({ text: 'seated' }), unseatOfficialBy: () => ({ text: 'unseated' }),
  takeGold: () => true, depositToTreasury: (z, n) => n, openWidget: () => true, closeWidget: () => true,
  boardZoneNear: () => 'whiterun', raceEdidOf: (a) => chars.get(a >>> 0).race,
});
const load = () => { delete require.cache[MODULE]; return require(MODULE)(api()); };
let M = load();
const nm = (a) => chars.get(a).name;
const toldSince = (n, a) => said.slice(n).filter(([x]) => x === (a >>> 0)).map(([, t]) => t);
const login = (a) => { if (!online.includes(a)) online.push(a); if (typeof globalThis.__dboCitizenLogin === 'function') globalThis.__dboCitizenLogin(a); };
const logout = (a) => { online = online.filter((x) => x !== a); };
const flush = () => new Promise((r) => setImmediate(r));
const lastPost = () => posts[posts.length - 1] || { channel: '', body: { content: '' } };
const mentionsOnly = (p, role) => !!p && !!p.body && p.body.allowed_mentions && Array.isArray(p.body.allowed_mentions.parse) && p.body.allowed_mentions.parse.length === 0
  && JSON.stringify(p.body.allowed_mentions.roles) === JSON.stringify([role]) && p.body.content.startsWith(`<@&${role}> `) && !/@everyone|@here/.test(p.body.content);

(async () => {
  // ---- the login path: gamemode.js calls the hook in its login sequence ---------------------------------------------------
  const GM = fs.readFileSync(GAMEMODE, 'utf8');
  const loginStart = GM.indexOf('globalThis.__dboSchoolsLogin(a)');
  const loginEnd = GM.indexOf('}), 8000);', loginStart);
  ok(loginStart > 0 && loginEnd > 0 && GM.slice(loginStart, loginEnd).includes('globalThis.__dboCitizenLogin(a)'), "gamemode.js's login sequence calls __dboCitizenLogin");
  ok(/'__dboCitizenLogin'/.test(GM.slice(GM.indexOf("log('citizenship.js failed to load:'"), GM.indexOf("log('citizenship.js failed to load:'") + 600)), 'and clears it when citizenship.js fails to load');
  ok(typeof globalThis.__dboCitizenLogin === 'function', 'citizenship.js provides the login hook');

  // ---- 1. the threshold: 15 citizen ACCOUNTS of the hold -------------------------------------------------------------------
  const WR = ZONES[1];
  const wr = [];
  for (let i = 0; i < 14; i++) { const id = add(0x200 + i, 200 + i, `Whiterunner ${i}`, i % 2 ? 'NordRace' : 'ImperialRace'); online.push(id); wr.push(id); M.join(id, 'whiterun'); }
  // two alts of accounts already counted, both citizens: 16 characters, still 14 accounts
  const ALT0 = add(0x2f0, 200, 'Whiterunner 0 alt'); online.push(ALT0); M.join(ALT0, 'whiterun');
  const ALT5 = add(0x2f5, 205, 'Whiterunner 5 alt'); M.join(ALT5, 'whiterun'); // offline
  // A citizen of another hold, online, and someone of no hold
  const RIFT = add(0x300, 300, 'Riftling'); online.push(RIFT); M.join(RIFT, 'riften');
  const NOBODY = add(0x301, 301, 'Wanderer'); online.push(NOBODY);
  timer();
  ok(M.citizenAccounts(WR) === 14 && !M.data().elections.whiterun && posts.length === 0, '16 citizen characters on 14 accounts: no election, no notice (alts do not pad the count)', [M.citizenAccounts(WR), posts.length]);
  // The 15th account: offline when the election starts
  const LATE = add(0x210, 215, 'Whiterunner Late'); M.join(LATE, 'whiterun');
  let n0 = said.length;
  timer();
  let E = M.data().elections.whiterun;
  ok(E && E.phase === 'registration' && M.citizenAccounts(WR) === 15, 'the 15th account starts registration', E && E.phase);

  // ---- 2. registration opens: in game, at login, on Discord ----------------------------------------------------------------
  const regText = toldSince(n0, wr[3])[0] || '';
  ok(/citizens of Whiterun are to choose their Jarl/.test(regText) && /notice board of the hold, on its Voting tab/.test(regText) && /Steward, Lord Commander, Housecarl/.test(regText), 'every online citizen is told registration is open, and where to go', regText);
  ok(wr.every((a) => toldSince(n0, a).length === 1) && toldSince(n0, ALT0).length === 1, 'each online citizen character once (the alt too: it is a citizen)');
  ok(toldSince(n0, RIFT).length === 0 && toldSince(n0, NOBODY).length === 0, 'citizens of other holds and non-citizens are not told');
  ok(posts.length === 1 && (posts[0] || {}).channel === '1555017562700390602', 'one Discord post, in #server-updates by default', posts.map((p) => p.channel));
  ok(mentionsOnly(posts[0], ROLES.whiterun), "it mentions only Whiterun's Citizen role; allowed_mentions lets nothing else ping", posts[0] && posts[0].body);
  ok(/Whiterun will choose its Jarl/.test(lastPost().body.content) && /<t:\d+:f>/.test(lastPost().body.content) && /Voting tab/.test(lastPost().body.content), 'the post says what, until when (a Discord timestamp) and where', lastPost().body.content);
  // At login, once per character per phase
  n0 = said.length;
  login(LATE);
  ok(toldSince(n0, LATE).length === 1 && toldSince(n0, LATE)[0] === regText, 'a citizen logging in during registration is told the same words', toldSince(n0, LATE));
  logout(LATE); login(LATE);
  ok(toldSince(n0, LATE).length === 1, 'and only once for this phase');
  login(ALT5);
  ok(toldSince(n0, ALT5).length === 1, "another character of a citizen's account is told once too (per character)");
  login(wr[0]);
  ok(toldSince(n0, wr[0]).length === 0, 'a citizen told while online is not told again at login');
  login(NOBODY); login(RIFT);
  ok(toldSince(n0, NOBODY).length === 0 && toldSince(n0, RIFT).length === 0, 'logins of non-citizens hear nothing');
  // What has been seen survives a restart
  delete globalThis.__dboCitizen; M = load();
  logout(LATE); login(LATE);
  ok(toldSince(n0, LATE).length === 1 && (M.data().elections.whiterun.noticed || {})[(LATE >>> 0).toString(16)], 'after a restart the seen mark is kept in citizenship.json, no repeat');
  ok((JSON.parse(fs.readFileSync('citizenship.json', 'utf8')).elections.whiterun.notice || {}).kind === 'registration', 'the notice is stored with the election');

  // ---- 3. courts; the vote opens 24 h later ---------------------------------------------------------------------------------
  const [J1, S1, C1, H1, J2, S2, C2, H2, V1, V2, V3, V4] = wr;
  let r;
  ok(!M.register(J1, 'whiterun', [nm(S1), nm(C1), nm(H1)]).error, 'a first court is entered');
  ok(!M.register(J2, 'whiterun', [nm(S2), nm(C2), nm(H2)]).error, 'a second court is entered');
  E = M.data().elections.whiterun;
  const [K1, K2] = E.courts.map((c) => c.id);
  for (const a of [S1, C1, H1, S2, C2, H2]) M.answerInvite(a, 'whiterun', a === S1 || a === C1 || a === H1 ? K1 : K2, true);
  // A third court whose members never accept: it is dropped at the close
  const J3 = V4, S3 = add(0x220, 220, 'Whiterunner Third'), T3 = add(0x221, 221, 'Whiterunner Fourth'); M.join(S3, 'whiterun'); M.join(T3, 'whiterun');
  r = M.register(J3, 'whiterun', [nm(S3), nm(LATE), nm(T3)]);
  ok(!r.error, 'a third court is named, and its members never accept', r);
  logout(LATE);
  const posts0 = posts.length;
  n0 = said.length;
  now += 24 * HOUR; timer();
  E = M.data().elections.whiterun;
  ok(E.phase === 'voting' && E.ballot.length === 2, 'at 24 hours the vote opens with the two complete courts', [E.phase, E.ballot.length]);
  const voteText = toldSince(n0, V1)[0] || '';
  ok(/The vote for the Jarl of Whiterun is open until/.test(voteText) && /Voting tab/.test(voteText) && /stand in a court do not vote/.test(voteText), 'online citizens are told the vote is open, where, and that courts do not vote', voteText);
  ok(posts.length === posts0 + 1 && mentionsOnly(lastPost(), ROLES.whiterun) && /vote for the Jarl of Whiterun is open/.test(lastPost().body.content), 'one Discord post for the vote', posts.slice(posts0));
  login(LATE);
  ok(toldSince(n0, LATE).length === 1 && toldSince(n0, LATE)[0] === voteText, 'a citizen told of registration is told again at login: this is a new phase');

  // ---- 4. cabinets cannot vote ---------------------------------------------------------------------------------------------
  r = M.vote(J1, 'whiterun', K2);
  ok(r.error && /stand for Jarl on this ballot/.test(r.error), 'the Jarl candidate cannot vote', r);
  r = M.vote(S2, 'whiterun', K1);
  ok(r.error && /as Steward in the court of Whiterunner 4/.test(r.error), 'a named and accepted Steward cannot vote', r);
  for (const a of [C1, H1, C2, H2]) ok(M.vote(a, 'whiterun', K1).error, `${nm(a)} (court member) cannot vote`);
  r = M.vote(ALT0, 'whiterun', K2);
  ok(r.error && /Another of your characters stands on this ballot/.test(r.error), "another character of the Jarl candidate's account cannot vote for them", r);
  const vv = M.votingView(S1, WR);
  ok(/do not vote/.test(vv.voteWhy), 'the Voting tab carries why (voteWhy), which the front shows in place of the vote buttons', vv.voteWhy);
  ok(/do not vote/.test(M.boardPayload(S1, 'whiterun', 'n', 'voting').voting.voteWhy), 'in the board panel too');
  ok(M.votingView(V1, WR).voteWhy === '', 'a plain citizen may vote');
  r = M.vote(J3, 'whiterun', K1);
  ok(!r.error, 'the candidate of a court dropped at the close (its members never accepted) is no cabinet: they vote', r);
  r = M.vote(S3, 'whiterun', K2);
  ok(!r.error, 'nor is a member who was named but never accepted', r);

  // ---- 5. a tie: the revote is announced ------------------------------------------------------------------------------------
  // 1-1 so far (J3 for K1, S3 for K2)
  n0 = said.length;
  const posts1 = posts.length;
  now += 24 * HOUR; timer();
  E = M.data().elections.whiterun;
  ok(E.phase === 'voting' && E.revote && E.round === 2, 'a tie: a revote', [E.phase, E.round]);
  const revText = toldSince(n0, V1)[0] || '';
  ok(/is tied/.test(revText) && /Voting tab/.test(revText), 'citizens are told of the revote', revText);
  ok(posts.length === posts1 + 1 && /is tied/.test(lastPost().body.content) && mentionsOnly(lastPost(), ROLES.whiterun), 'and Discord');
  ok(M.vote(J2, 'whiterun', K2).error, 'in the revote the courts still cannot vote');
  // ---- 6. the result -------------------------------------------------------------------------------------------------------
  M.vote(V1, 'whiterun', K1); M.vote(V2, 'whiterun', K1); M.vote(V3, 'whiterun', K2);
  n0 = said.length;
  const posts2 = posts.length;
  now += 24 * HOUR; timer();
  E = M.data().elections.whiterun;
  ok(E.phase === 'seated' && E.result.winner === K1, 'the first court wins 2-1');
  const resText = toldSince(n0, V3)[0] || '';
  ok(/Whiterunner 0 is elected Jarl of Whiterun by its citizens/.test(resText) && /Voting tab/.test(resText), 'citizens are told the result', resText);
  const resPost = lastPost();
  ok(posts.length === posts2 + 1 && /Whiterunner 0 is elected Jarl of Whiterun/.test(resPost.body.content) && /Steward Whiterunner 1/.test(resPost.body.content) && mentionsOnly(resPost, ROLES.whiterun), 'and Discord, with the court', resPost.body.content);
  logout(LATE); login(LATE);
  ok(toldSince(n0, LATE).length === 1 && toldSince(n0, LATE)[0] === resText, 'a citizen logging in after the vote is told the result once');
  now += 8 * DAY;
  const ALT9 = add(0x2f9, 209, 'Whiterunner 9 alt'); M.join(ALT9, 'whiterun');
  n0 = said.length;
  login(ALT9);
  ok(toldSince(n0, ALT9).length === 0, 'after resultLoginDays (7) the result is no longer told at login');

  // ---- 7. registration re-opens: announced ---------------------------------------------------------------------------------
  const RF = ZONES[2];
  const rf = [RIFT];
  for (let i = 1; i < 15; i++) { const id = add(0x300 + i + 1, 300 + i + 1, `Riftling ${i}`); online.push(id); rf.push(id); M.join(id, 'riften'); }
  n0 = said.length;
  timer();
  ok(M.data().elections.riften.phase === 'registration' && toldSince(n0, RIFT).length === 1 && /citizens of the Rift are to choose their Jarl/.test(toldSince(n0, RIFT)[0]), 'the Rift (15) opens registration and tells its citizens, "the Rift" in a sentence', toldSince(n0, RIFT));
  ok(mentionsOnly(lastPost(), ROLES.riften) && /The Rift will choose its Jarl/.test(lastPost().body.content), "the post pings the Rift's role only", lastPost().body);
  n0 = said.length;
  const posts3 = posts.length;
  now += 24 * HOUR; timer();
  ok(M.data().elections.riften.phase === 'registration' && M.data().elections.riften.reopened === 1, 'no court in 24 hours: registration reopens');
  ok(/No full court stood before the citizens of the Rift/.test(toldSince(n0, RIFT)[0] || '') && /Voting tab/.test(toldSince(n0, RIFT)[0] || ''), 'citizens are told it reopens', toldSince(n0, RIFT));
  ok(posts.length === posts3 + 1 && /call for courts goes out again/.test(lastPost().body.content), 'and Discord');

  // ---- 8. no role, no channel: the post is skipped and logged ------------------------------------------------------------
  const PA = ZONES[3];
  const pa = [];
  for (let i = 0; i < 15; i++) { const id = add(0x400 + i, 400 + i, `Paler ${i}`); online.push(id); pa.push(id); M.join(id, 'dawnstar'); }
  const posts4 = posts.length;
  logs.length = 0; n0 = said.length;
  timer();
  ok(M.data().elections.dawnstar.phase === 'registration' && toldSince(n0, pa[0]).length === 1, 'the Pale opens registration and tells its citizens in game');
  ok(posts.length === posts4 && logs.some((l) => /no Discord notice for registration in dawnstar: no citizen role/.test(l)), 'with no Citizen role id for the hold nothing is posted, and the log says so', logs);
  delete globalThis.__dboCitizen; citizenCfg = { discordRoles: ROLES, election: { announceChannel: '', voterRules: { enabled: false } } }; M = load();
  logs.length = 0;
  now += 24 * HOUR; timer();
  ok(posts.length === posts4 && logs.some((l) => /no Discord notice for reopened in riften: no announceChannel/.test(l)), 'with no channel set nothing is posted, and the log says so', logs.filter((l) => /Discord/.test(l)));
  citizenCfg = { discordRoles: ROLES, election: { voterRules: { enabled: false } } };

  // ---- 9. a failing Discord post is logged and changes nothing in game -------------------------------------------------------
  delete globalThis.__dboCitizen; M = load();
  postFails = true; logs.length = 0;
  now += 24 * HOUR; timer();
  await flush(); await flush();
  ok(logs.some((l) => /Discord notice reopened for riften failed: HTTP 403/.test(l)) && M.data().elections.riften.phase === 'registration', 'a refused post is logged; the election goes on', logs.filter((l) => /Discord/.test(l)));
  postFails = false;

  // ---- 10. hot reload over an election the older code started (no notice): announced once ------------------------------------
  const S = globalThis.__dboCitizen;
  const Z = { id: 'falkreath', name: 'Falkreath', treasury: 'f', officials: ['jarl', 'steward', 'commander'] };
  ZONES.push(Z); ROLES.falkreath = '1559949253290238113';
  const FK = add(0x500, 500, 'Falk'); online.push(FK); M.join(FK, 'falkreath');
  S.data.elections.falkreath = { phase: 'voting', round: 1, startedAt: now - DAY, phaseStartedAt: now, phaseEndsAt: now + DAY, courts: [], ballot: [], votes: {} };
  M = load(); // a hot reload: globalThis state survives
  const posts5 = posts.length; n0 = said.length;
  timer();
  ok(posts.length === posts5 + 1 && /vote for the Jarl of Falkreath is open/.test(lastPost().body.content) && toldSince(n0, FK).length === 1, 'after a reload an older running vote is announced once', posts.slice(posts5));
  timer();
  ok(posts.length === posts5 + 1 && toldSince(n0, FK).length === 1, 'and not again on the next tick');

  // ---- 11. discordroles.js: the post helper, the bot token never in the log ---------------------------------------------------
  const calls = [];
  const realRequest = https.request;
  https.request = (opts, cb) => {
    const req = new EventEmitter(); req.setTimeout = () => req;
    req.end = (data) => { calls.push({ opts, body: data ? JSON.parse(data) : null }); const res = new EventEmitter(); res.statusCode = /messages$/.test(opts.path) ? 200 : 404; setImmediate(() => { cb(res); res.emit('data', '{"id":"9"}'); res.emit('end'); }); };
    return req;
  };
  const TOKEN = ['MTI', 'zNDU2Nzg5', 'fake'].join('.');
  const rlogs = [];
  const loadRoles = (token, enabled) => {
    delete require.cache[ROLES_MODULE]; delete globalThis.__dboDiscordRoles;
    return require(ROLES_MODULE)({ mp: { get: () => null }, log: (...x) => rlogs.push(x.join(' ')), audit: (x) => rlogs.push(x), who: (a) => `#${a}`, onlineActors: () => [], every: () => {},
      discordOf: () => '', profileOf: () => 1, zoneById: () => null, cfg: { discordRoles: { enabled } }, skills: [], token, guildId: 'G', isStaff: () => false, staffRolesSeen: () => {} });
  };
  loadRoles(TOKEN, true);
  ok(typeof globalThis.__dboDiscordPost === 'function', 'discordroles.js offers the post helper with a bot token');
  const body = { content: '<@&1559949568513155193> test', allowed_mentions: { parse: [], roles: ['1559949568513155193'] } };
  const got = await globalThis.__dboDiscordPost('1555017562700390602', body);
  const c0 = calls[calls.length - 1];
  ok(got && got.id === '9' && c0.opts.method === 'POST' && c0.opts.path === '/api/v10/channels/1555017562700390602/messages' && JSON.stringify(c0.body) === JSON.stringify(body), 'it POSTs the message as given to the channel', c0 && [c0.opts.method, c0.opts.path, c0.body]);
  let err = '';
  await globalThis.__dboDiscordPost('not-a-channel', body).catch((e) => { err = e.message; });
  ok(/no channel id/.test(err) && calls.length === 1, 'a channel that is not an id is refused without a call');
  loadRoles(TOKEN, false);
  ok(typeof globalThis.__dboDiscordPost === 'function', 'it works with the role sync switched off');
  loadRoles('', true);
  ok(globalThis.__dboDiscordPost === null, 'without a bot token there is none (citizenship.js then logs and skips)');
  ok(!rlogs.concat(logs).some((l) => String(l).includes(TOKEN)), 'the bot token is never in a log line');
  ok(!fs.readFileSync(MODULE, 'utf8').includes('Bot ') && !/botToken|discordAuth/.test(fs.readFileSync(MODULE, 'utf8')), 'citizenship.js never touches the token');
  https.request = realRequest;

  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
