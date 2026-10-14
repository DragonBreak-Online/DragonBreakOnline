// Staff "real names" mode in chat (/realnames, Jake 14 Oct 2026): chat never said "Stranger" (an unintroduced speaker is
// named to every listener), but a masked or beast speaker reads "Masked Person" or "Werewolf". With the mode on, a staff
// member reads "Aldric (masked) says: ..." instead, and only they do: sendNear gives the staff line to recipients with the
// mode on and the line of today to everyone else, and a /pm from behind a mask names its sender to them the same way.
// Cuts actorsNear/sendNear and quoteSay..handleLine out of gamemode.js with stubs (as flood-guard-harness.js does), and
// loads the real playermenu.js for the mode itself.
//   node tests/real-names-chat-harness.js              (from server/)
//   REVEAL_ROOT=<another server/ copy>, or GAMEMODE=<file> PLAYERMENU=<file>: the same checks against other copies
// C1, C3 and C5 fail on origin/server 6b37238cd; C2 and C4 are guards (they pass on both).
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = process.env.REVEAL_ROOT ? path.resolve(process.env.REVEAL_ROOT) : path.resolve(__dirname, '..');
const FILE = (env, name) => (process.env[env] ? path.resolve(process.env[env]) : path.join(ROOT, name));
const PM_FILE = FILE('PLAYERMENU', 'playermenu.js'), GM_FILE = FILE('GAMEMODE', 'gamemode.js');
const src = fs.readFileSync(GM_FILE, 'utf8');
let fails = 0, passes = 0;
const ok = (label, cond, got) => { if (cond) passes++; else fails++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 600) : ''}`); };
const step = (label, fn) => { try { fn(); } catch (e) { ok(`${label} (threw: ${e.message})`, false); } };
const cut = (from, to) => { const a = src.indexOf(from), b = a < 0 ? -1 : src.indexOf(to, a + 1); if (a < 0 || b < 0) throw new Error(`gamemode.js markers gone: ${from}`); return src.slice(a, b); };

// GM Gerd has the mode on; Ulla is a player and Tria a Trial GM with it off. Aldric wears a mask, Bryn is a werewolf,
// Pell is plain. Everyone stands within a few metres of everyone
const GM = 0xff000011, TRIAL = 0xff000015, PLAYER = 0xff000014, M = 0xff000022, B = 0xff000023, P = 0xff000021;
const actors = { [GM]: { name: 'Gerd', admin: true }, [TRIAL]: { name: 'Tria' }, [PLAYER]: { name: 'Ulla' }, [M]: { name: 'Masked Person', mask: 'Aldric' },
  [B]: { name: 'Werewolf', beast: 'Bryn' }, [P]: { name: 'Pell' } };
const ONLINE = [GM, TRIAL, PLAYER, M, B, P];
const props = new Map();
const mp = {
  get: (a, k) => { const v = props.get(`${a >>> 0}|${k}`); return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); },
  set: (a, k, v) => props.set(`${a >>> 0}|${k}`, v === undefined ? undefined : JSON.parse(JSON.stringify(v))),
  getIdFromDesc: () => 0, getDescFromId: (id) => id.toString(16), callPapyrusFunction: () => {}, lookupEspmRecordById: () => null,
};
for (const [id, o] of Object.entries(actors)) {
  mp.set(id, 'appearance', { name: o.name, raceId: 1 }); mp.set(id, 'maskName', o.mask || ''); mp.set(id, 'worldOrCellDesc', 'w'); mp.set(id, 'pos', [0, 0, 0]);
  mp.set(id, 'locationalData', { cellOrWorldDesc: 'w', pos: [0, 0, 0], rot: [0, 0, 0] }); mp.set(id, 'ff_knownIds', []);
  if (o.beast) mp.set(id, 'private.beast', { form: 'werewolf', original: { name: o.beast } });
}
globalThis.__dboBeastName = (a) => ((a >>> 0) === B ? 'Werewolf' : '');
const nameOf = (a) => (mp.get(a, 'appearance') || {}).name || 'Stranger';

// ---- playermenu.js, for the mode -------------------------------------------------------------------------------------------
const commands = new Map(); const told = [];
const savedTimeout = global.setTimeout; global.setTimeout = () => 0;
const cfg = { playerMenu: { realNames: { enabled: true, labels: true, chat: true, sweepMs: 2000 } } };
const loadMenu = () => {
  delete require.cache[PM_FILE];
  require(PM_FILE)({ mp, log: () => {}, personal: (a, t) => told.push([a, t]), system: () => {}, registerChatCommand: (n, fn, o) => commands.set(n, { fn, admin: !!(o && o.admin) }),
    onUi: () => {}, sendPacket: () => true, display: (a) => `${nameOf(a)} #T${(a & 0xff).toString(16)}`, nameOf, tagOf: (a) => `T${(a & 0xff).toString(16)}`, profileOf: (a) => a & 0xff,
    onlineActors: () => ONLINE.slice(), isAdmin: (a) => (a >>> 0) === GM || (a >>> 0) === TRIAL, isLeadStaff: () => false,
    staffCan: (a) => (a >>> 0) === GM || (a >>> 0) === TRIAL, ranksOf: () => [], giveItem: () => true, makeProp: () => {}, runCommand: () => {}, zones: {}, zoneOfActor: () => null,
    cfg, every: () => {} });
};
step('playermenu.js loads', loadMenu);
const turnOn = (a) => { const c = commands.get('realnames'); if (!c) throw new Error('no /realnames command'); c.fn(a, 'on'); };

// ---- gamemode.js chat, cut as written ---------------------------------------------------------------------------------------
const lines = [];   // [recipient, line]
const C = { WHITE: 'fafafa', SHOUT: '772021', ME: 'c2a3da', OOC: '3896f3', SYS: 'ffcc00' };
const R = { say: 20, low: 8, whisper: 3, wide: 35, shout: 80, emote: 20, emoteLow: 8, emoteLong: 35, looc: 20, loocLow: 8, loocLong: 35 };
let chat = null;
step('the chat code is cut from gamemode.js', () => {
  const near = cut('// distanceMeters costs four engine reads per pair', '// ---- chat bubbles:');
  const hl = cut('const quoteSay = ', '// ---- Realm of Lorkhan hold gates');
  const names = ['mp', 'UNITS_PER_METER', 'onlineActors', 'deliver', 'actorOf', 'nameOf', 'FLOOD', 'isAdmin', 'personal', 'R', 'C', 'bubbleNear', 'findByName', 'broadcast', 'audit',
    'staffLog', 'tierOf', 'TIER_LABEL', 'staffWho', 'staffCan', 'hasPlayerMenu', 'openPlayerMenu', 'commands', 'TRIAL_COMMANDS', 'LEAD_ONLY', 'isLeadStaff', 'staffTierOf', 'display', 'who', 'log'];
  const G = new Function(...names, `${near}\n${hl}\nreturn { sendNear, handleLine, quoteSay };`)(
    mp, 70, () => ONLINE.slice(), (a, l) => lines.push([a >>> 0, l]), (u) => u, nameOf, { chatMaxChars: 2000, stripColourCodes: true }, (a) => !!(actors[a >>> 0] || {}).admin,
    (a, t) => told.push([a, t]), R, C, () => {}, (q) => ONLINE.find((x) => nameOf(x).toLowerCase() === String(q).toLowerCase() && !(actors[x] || {}).mask) || 0,
    () => {}, () => {}, () => {}, () => 'gm', {}, String, () => true, () => false, () => {}, new Map(), {}, new Set(), () => false, () => 'gm', String, String, () => {});
  chat = (a, text) => { lines.length = 0; G.handleLine(a, text, a); return lines.slice(); };
});
const to = (out, who) => out.filter(([r]) => r === (who >>> 0)).map(([, l]) => l);
const B_ = (a) => `[[B${(a >>> 0).toString(16)}]]`;
// The line of 6b37238cd, for every listener
const SAY = (n, verb, body, col = C.WHITE) => `#{${col}}${n} ${verb}: "${body}"`;

// ---- C2 and C4 first, with nobody in the mode (guards) -----------------------------------------------------------------------
step('C2 nobody', () => {
  if (!chat) throw new Error('no chat');
  const out = chat(M, 'Halt there');
  ok('C2 guard: with nobody in the mode every listener gets exactly today\'s line from a masked speaker', out.length === 5 && out.every(([, l]) => l === B_(M) + SAY('Masked Person', 'says', 'Halt there')), out);
});
step('C1/C3', () => { turnOn(GM); });
ok('(the GM has the mode on)', typeof globalThis.__dboRealNamesOn === 'function' && globalThis.__dboRealNamesOn(GM) === true);

// ---- C1: a masked speaker ------------------------------------------------------------------------------------------------------
step('C1', () => {
  const cases = [
    ['say', 'Halt there', (n) => SAY(n, 'says', 'Halt there')],
    ['/shout Guards!', 'Guards!', (n) => SAY(n, 'shouts', 'Guards!', C.SHOUT)],
    ['/whisper psst', 'psst', (n) => SAY(n, 'whispers', 'psst')],
    ['/me draws a blade', '', (n) => `#{${C.ME}}${n} draws a blade`],
    ['/my hand shakes', '', (n) => `#{${C.ME}}${n}'s hand shakes`],
    ['/ooc brb', '', (n) => `#{${C.OOC}}${n} (OOC): "brb"`],
    ['/looc lag', '', (n) => `#{${C.OOC}}${n} (OOC): "lag"`],
  ];
  for (const [text, , line] of cases) {
    const out = chat(M, text === 'say' ? 'Halt there' : text);
    const gm = to(out, GM), others = [PLAYER, TRIAL, B, P].map((x) => to(out, x));
    ok(`C1 ${text === 'say' ? 'say' : text.split(' ')[0]} from a mask: the GM in the mode reads "Aldric (masked)"`, gm.length === 1 && gm[0] === B_(M) + line('Aldric (masked)'), gm);
    ok(`C1 ...and every other listener (a player, a Trial GM with it off, the beast, Pell) "Masked Person"`, others.every((l) => l.length === 1 && l[0] === B_(M) + line('Masked Person')), others);
  }
  const out = chat(B, 'Grr');
  ok('C1 a werewolf speaking: "Bryn (Werewolf form)" to the GM, "Werewolf" to everyone else', to(out, GM)[0] === B_(B) + SAY('Bryn (Werewolf form)', 'says', 'Grr')
    && to(out, PLAYER)[0] === B_(B) + SAY('Werewolf', 'says', 'Grr'), out);
});

// ---- C2: an unmasked speaker -------------------------------------------------------------------------------------------------------
step('C2', () => {
  const out = chat(P, 'Good day');
  ok('C2 guard: an unmasked speaker\'s line is byte-identical for every listener, the GM in the mode included', out.length === 5 && out.every(([, l]) => l === B_(P) + SAY('Pell', 'says', 'Good day')), out);
  const me = chat(P, '/me waves');
  ok('C2 guard: ...and an emote too', me.length === 5 && me.every(([, l]) => l === `${B_(P)}#{${C.ME}}Pell waves`), me);
});

// ---- C3: /pm -------------------------------------------------------------------------------------------------------------------------
step('C3', () => {
  let out = chat(M, '/pm Gerd who am I');
  ok('C3 a /pm from behind a mask to the GM in the mode: from "Aldric (masked)"', out.length === 1 && out[0][0] === GM && out[0][1] === '[[PM]]Aldric (masked)|who am I', out);
  out = chat(M, '/pm Ulla who am I');
  ok('C3 ...to a player: from "Masked Person", as before', out.length === 1 && out[0][0] === PLAYER && out[0][1] === '[[PM]]Masked Person|who am I', out);
  out = chat(P, '/pm Gerd hello');
  ok('C3 guard: ...an unmasked sender as before', out.length === 1 && out[0][1] === '[[PM]]Pell|hello', out);
});

// ---- C4: /do --------------------------------------------------------------------------------------------------------------------------
step('C4', () => {
  for (const v of ['/do', '/dolow', '/dolong']) {
    const out = chat(M, `${v} The door creaks`);
    ok(`C4 guard: ${v} from a mask is the same line for everyone, the GM in the mode included, [[B<id>]] in front`, out.length === 5 && out.every(([, l]) => l === `${B_(M)}#{${C.ME}}The door creaks`), out);
  }
});

// ---- C5: the chat switch ---------------------------------------------------------------------------------------------------------
step('C5', () => {
  ok('C5 (the label hook names the masked speaker while chat is on)', typeof globalThis.__dboRealNamesLabel === 'function' && globalThis.__dboRealNamesLabel(M) === 'Aldric (masked)');
  cfg.playerMenu.realNames.chat = false;
  loadMenu();
  const out = chat(M, 'Halt there');
  ok('C5 with realNames.chat false no staff line is made: the label hook gives nothing and the GM reads "Masked Person"', typeof globalThis.__dboRealNamesLabel === 'function'
    && globalThis.__dboRealNamesLabel(M) === '' && globalThis.__dboRealNamesOn(GM) === true && to(out, GM)[0] === B_(M) + SAY('Masked Person', 'says', 'Halt there'), out);
  cfg.playerMenu.realNames.chat = true;
});

global.setTimeout = savedTimeout;
console.log(`\n${passes}/${passes + fails} passed`);
console.log(fails ? `${fails} FAILED` : 'all checks passed');
process.exit(fails ? 1 : 0);
