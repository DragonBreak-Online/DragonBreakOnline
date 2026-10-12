// Scripted test for the chat's Admin tab resync in gamemode.js (Nate, 12 Oct, client 0.3.94: senior staff, chat showed
// Local, System and Personal only). No server and no game: the gamemode's watch and resync code is cut out of
// gamemode.js and run against a fake mp, fake timers and a model of the client's chatService, which writes
// window.__alduinakAdmin into the page only when the isAdmin it sees changes (lastAdmin). Run it from this folder's
// parent with
//
//   node tests/admin-tab-resync-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
let fails = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined && !ok ? '   ' + JSON.stringify(detail) : ''}`); if (!ok) fails++; };

// The watch block: from its heading to the every('watch') line
const wStart = src.indexOf('// ---- name / permission change watch');
const wEnd = src.indexOf("every('watch', 5000");
check('gamemode.js has the watch block', wStart > 0 && wEnd > wStart);
const block = src.slice(wStart, wEnd);
check('the watch block can resync the isAdmin flag (resyncAdminFlag)', /const resyncAdminFlag = /.test(block));
check('loginSetup resyncs every staff member after setting isAdmin', /mp\.set\(a, ADMIN_PROP, isAdmin\(a\)\);[^\n]*\n\s*if \(isAdmin\(a\)\) resyncAdminFlag\(userId, a\);/.test(src));

// Fake clock and timers
let now = 1000000;
const timers = [];
const fakeSetTimeout = (fn, ms) => { timers.push({ at: now + ms, fn }); return timers.length; };
const advance = (ms, onStep) => {
  const end = now + ms;
  while (true) {
    timers.sort((x, y) => x.at - y.at);
    const t = timers[0];
    const stepTo = Math.min(end, now + 16); // the client draws a frame every 16 ms
    if (t && t.at <= stepTo) { timers.shift(); now = Math.max(now, t.at); t.fn(); if (onStep) onStep(); continue; }
    now = stepTo; if (onStep) onStep();
    if (now >= end) break;
  }
};
const RealDate = Date;
global.Date = class extends RealDate { static now() { return now; } };

// One staff member online, a senior
const A = 0xff00abcd, USER = 7;
const props = new Map([['isAdmin', true]]);
const sent = []; // what reaches the client, in order
const mp = {
  get: (a, k) => (k === 'isAdmin' ? props.get('isAdmin') : undefined),
  set: (a, k, v) => { props.set(k, v); if (k === 'isAdmin') sent.push({ at: now, v }); },
};
let tier = 'senior';
const fns = new Function('mp', 'onlineActors', 'profileOf', 'nameOf', 'realNameOf', 'tierOf', 'rolesOf', 'audit', 'who', 'actorOf', 'isAdmin', 'ADMIN_PROP', 'setTimeout', 'globalThis',
  block + '\nreturn { watchPlayers, resyncAdminFlag: typeof resyncAdminFlag === "function" ? resyncAdminFlag : null };')(
  mp, () => [A], () => 2, () => 'GM Nate', () => 'GM Nate', () => tier, () => ['1'], () => {}, () => 'GM Nate #DTTM', (u) => (u === USER ? A : 0),
  () => tier !== null, 'isAdmin', fakeSetTimeout, {});

// The client: the owner model follows every isAdmin the server sends; chatService writes the page when it differs from
// lastAdmin. It starts in the state the screenshot showed: lastAdmin true, the page false
const client = { owner: true, lastAdmin: true, page: false, pageWrites: [] };
let delivered = 0;
const clientFrame = () => {
  while (delivered < sent.length) client.owner = sent[delivered++].v; // all messages of this frame land before the update
  const isAdminNow = client.owner === true;
  if (isAdminNow !== client.lastAdmin) { client.lastAdmin = isAdminNow; client.page = isAdminNow; client.pageWrites.push(isAdminNow); }
};

// Login: loginSetup's set, then what it schedules; watchPlayers runs every 5 s throughout
const login = () => { mp.set(A, 'isAdmin', true); if (fns.resyncAdminFlag) fns.resyncAdminFlag(USER, A); };
login();
const watchEvery = () => { fakeSetTimeout(() => { fns.watchPlayers(); watchEvery(); }, 5000); };
watchEvery();
advance(60000, clientFrame);

check('a page that missed the Admin tab gets it within a minute of login', client.page === true, client);
check('...because the client saw isAdmin change (false, then true)', client.pageWrites.join(',') === 'false,true', client.pageWrites);
check('the server ends with isAdmin true', props.get('isAdmin') === true);
const falses = sent.filter((x) => x.v === false);
check('isAdmin was false for one short window only (2 to 3 s)', falses.length === 1 && (() => { const i = sent.indexOf(falses[0]); return sent[i + 1] && sent[i + 1].v === true && sent[i + 1].at - falses[0].at >= 2000 && sent[i + 1].at - falses[0].at <= 3000; })(), sent);

// watchPlayers inside the window leaves the false alone; outside it, a lost true is put back
props.set('isAdmin', false); sent.length = 0;
fns.watchPlayers();
check('outside a resync, watchPlayers puts a wrong false back to true', props.get('isAdmin') === true && sent.length === 1);

// A player who is no staff is never touched
tier = null; props.set('isAdmin', false); sent.length = 0; timers.length = 0;
if (fns.resyncAdminFlag) fns.resyncAdminFlag(USER, A);
advance(30000);
check('a player with no admin tier is never resynced', sent.every((x) => x.v === false) && props.get('isAdmin') === false, sent);
// A staff member who logged out before the resync is not touched
tier = 'senior'; props.set('isAdmin', true); sent.length = 0; timers.length = 0;
if (fns.resyncAdminFlag) fns.resyncAdminFlag(99, A);
advance(30000);
check('a staff member gone before the resync is left alone', sent.length === 0, sent);

global.Date = RealDate;
console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
