// Scripted test for how server\prayer.js hands over a blessing (2026-10-01). The server's AddSpell only puts a spell in the
// learned list, so every Divine and Prince blessing (a Spell cast Fire-and-Forget on Self) was taught as a castable
// "Blessing of X" and never ran. Now such a blessing is cast on the worshipper by their own client (dboCastSelf), again at
// every login while it runs and again when the spell's own duration ends first; an Ability is still learned, and so is a
// Power. Also: closing a prayer round before its first press (to make an offering) rests no shrine. Since the follow-up
// (fix/prayer-blessings-2): a cast blessing that ends (its end, a turn, a new blessing, a staff reset) is ended on the
// client too (dboDispelSelf), and one whose worshipper died is cast again once they stand; the faiths' racial powers,
// which the client blocks, are gone: the Hist, the Ancestors and the Yokudan gods give a boon the server keeps,
// Riddle'Thar's Night Eye is cast, and a power still held from before is taken back. Loads the real
// module with a mock gamemode api and spell records shaped like the real ones. Run it from this folder's parent with
//
//   node tests/prayer-blessings-harness.js
'use strict';
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
const PRAYER = path.join(SERVER, 'prayer.js');
const SKILLS = require(path.join(SERVER, 'skills.json'));

let virtual = 0;
globalThis.performance = { now: () => virtual };
let wallClock = 1790000000000;
const realNow = Date.now;
Date.now = () => wallClock;
const H = 3600000;

const ACTOR = 0x14;
const STAFF = 0x15;
const idOf = (d) => parseInt(String(d).split(':')[0], 16) >>> 0;
const choiceOf = (id) => SKILLS.deities.choices.find((c) => c.id === id);
const spellOf = (id) => idOf(choiceOf(id).blessing);

// Every blessing spell in skills.json, as the winning record reads in the server's load order (/opt/skyrim-data,
// plugins.server.txt, measured 2026-10-01): SPIT type (0 Spell, 2 Power, 3 Lesser Power, 4 Ability), cast type
// (0 Constant Effect, 1 Fire and Forget), delivery (0 Self), and each effect's EFIT duration in seconds.
const MEASURED = {
  akatosh: ['AltarAkatoshSpell', 0, 1, 0, [28800, 0]], arkay: ['AltarArkaySpell', 0, 1, 0, [28800, 0]],
  dibella: ['DBO_BlessingOfDibella', 0, 1, 0, [28800, 0]], julianos: ['AltarJulianosSpell', 0, 1, 0, [28800, 0]],
  kynareth: ['AltarKynarethSpell', 0, 1, 0, [28800, 0]], mara: ['AltarMaraSpell', 0, 1, 0, [28800, 0]],
  stendarr: ['AltarStendarrSpell', 0, 1, 0, [28800, 0]], talos: ['DBO_BlessingOfTalos', 0, 1, 0, [28800, 0]],
  zenithar: ['DBO_BlessingOfZenithar', 0, 1, 0, [28800, 0]], auriel: ['DLC1AltarAurielSpell', 0, 1, 0, [43200, 0]],
  malacath: ['AltarMalacathSpell', 0, 1, 0, [28800, 0, 28800]], azura: ['DLC2AltarAzuraSpell', 0, 1, 0, [0, 28800]],
  boethiah: ['DLC2AltarBoethiahSpell', 0, 1, 0, [0, 28800]], mephala: ['DBO_BlessingOfMephala', 0, 1, 0, [28800, 0]],
  mehrunes: ['DBO_BlessingOfMehrunesDagon', 0, 1, 0, [28800, 0]], molagbal: ['DBO_BlessingOfMolagBal', 0, 1, 0, [28800, 0]],
  nocturnal: ['AltarNocturnalSpell', 0, 1, 0, [28800, 0]], hircine: ['DBO_BlessingOfHircine', 0, 1, 0, [28800, 0]],
  meridia: ['DBO_BlessingOfMeridia', 0, 1, 0, [28800, 0]], namira: ['DBO_BlessingOfNamira', 0, 1, 0, [28800, 28800]],
  peryite: ['DBO_BlessingOfPeryite', 0, 1, 0, [28800, 0]], vaermina: ['DBO_BlessingOfVaermina', 0, 1, 0, [28800, 0]],
  dragoncult: ['AltarTalosSpell', 0, 1, 0, [28800, 0]],
  riddlethar: ['DBO_BlessingOfVaermina', 0, 1, 0, [28800, 0]],
  // The Deep Serpents, the Maormer faith (11 Oct, PC session; Nate: sea serpents, not Orgnum): Water Breathing and Resist Poison 25, both 8 hours
  "deep-serpents": ['DBO_BlessingOfOrgnum', 0, 1, 0, [28800, 28800]],
  trinimac: ['doomLordAbility', 4, 0, 0, [0, 0]], wormcult: ['doomApprenticeAbility', 4, 0, 0, [0]],
};
const CAST = Object.keys(MEASURED).filter((k) => MEASURED[k][1] === 0 && MEASURED[k][2] === 1);
const ABILITIES = ['trinimac', 'wormcult'];
// The faiths whose blessing was a racial power until 2026-10-01: three now keep a boon on the server with no spell
const SERVER_HELD = ['hist', 'ancestors', 'yokudan'];
// and the powers themselves, still in the load order, for a blessing granted before (SPIT type 2 Power, 3 Lesser Power)
const OLD = { hist: 0xe40d5, ancestors: 0xe40d4, yokudan: 0xe40ce, riddlethar: 0xaa01d };
const OLD_RECORDS = { hist: ['PowerArgonianHistskin', 2, 1, 0, [60, 60]], ancestors: ['PowerDarkElfFlameCloak', 2, 1, 0, [60, 62]],
  yokudan: ['PowerRedguardStaminaRegen', 2, 1, 0, [60]], riddlethar: ['PowerKhajiitNightEye', 3, 1, 0, [60]] };
const field = (type, bytes) => ({ type, data: Uint8Array.from(bytes) });
const u32le = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const spel = ([edid, type, castType, delivery, durations]) => ({ record: { type: 'SPEL', editorId: edid, fields: [
  field('EDID', []),
  // cost, flags, type, charge time, cast type, delivery, cast duration, range, half-cost perk
  field('SPIT', [...u32le(402104), ...u32le(0), ...u32le(type), ...u32le(0), ...u32le(castType), ...u32le(delivery), ...u32le(0), ...u32le(0), ...u32le(0)]),
  ...durations.flatMap((secs) => [field('EFID', u32le(0x800)), field('EFIT', [...u32le(0x41200000), ...u32le(0), ...u32le(secs)])]),
] } });

const records = new Map();
for (const [deity, m] of Object.entries(MEASURED)) records.set(spellOf(deity), spel(m));
for (const [deity, m] of Object.entries(OLD_RECORDS)) records.set(OLD[deity], spel(m));

const props = new Map();
let online = true;
const learned = new Set();                       // the server's learned list for ACTOR
const out = { packets: [], papyrus: [], logs: [], personals: [], widgets: [] };
const handlers = new Map(), commands = new Map(), timers = new Map();
const api = {
  mp: {
    getIdFromDesc: (d) => idOf(d),
    getDescFromId: (id) => `${(id >>> 0).toString(16)}:Skyrim.esm`,
    get: (id, prop) => props.get(id + '|' + prop),
    set: (id, prop, v) => props.set(id + '|' + prop, v),
    lookupEspmRecordById: (id) => records.get(id >>> 0) || null,
    // The server's own AddSpell and RemoveSpell (PapyrusActor.cpp): the learned list only, and a snippet to the client
    // only when the list changed
    callPapyrusFunction: (kind, cls, fn, self, args) => {
      const spell = idOf(args[0] && args[0].desc);
      let changed = false;
      if (fn === 'AddSpell') { changed = !learned.has(spell); learned.add(spell); }
      if (fn === 'RemoveSpell') { changed = learned.delete(spell); }
      out.papyrus.push({ fn, spell, changed, n: out.packets.length });
      return changed;
    },
  },
  log: (...a) => out.logs.push(a.join(' ')),
  personal: (a, t) => out.personals.push(t),
  audit: () => {},
  display: () => 'Tester #ABCD',
  who: () => 'Tester #ABCD (profile 1)',
  cfg: {},
  openWidget: (a, w) => { out.widgets.push(w); return true; },
  closeWidget: () => true,
  onUi: (ev, fn) => { const l = handlers.get(ev) || []; l.push(fn); handlers.set(ev, l); },
  registerChatCommand: (name, fn) => commands.set(name, fn),
  onlineActors: () => (online ? [ACTOR] : []),
  every: (name, ms, fn) => { timers.set(name, fn); },
  skills: SKILLS,
  takeGold: () => true,
  treasuryHere: (a, n) => n,
  sendPacket: (a, p) => out.packets.push({ a, p }),
  isLeadStaff: (a) => a === STAFF,
  findAnyByName: (q) => (/^tester$/i.test(String(q).trim()) ? ACTOR : 0),
};

let failures = 0;
const check = (name, cond, detail) => { if (!cond) failures++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '   ' + detail : ''}`); };
const clear = () => { for (const k of Object.keys(out)) out[k].length = 0; };
const fire = (ev, args) => (handlers.get(ev) || []).forEach((f) => f(ACTOR, args, 35));
const load = () => { delete require.cache[require.resolve(PRAYER)]; handlers.clear(); commands.clear(); timers.clear(); require(PRAYER)(api); };
const sweep = () => { clear(); timers.get('prayerBlessings')(); };
const casts = () => out.packets.filter((x) => x.a === ACTOR && x.p.customPacketType === 'dboCastSelf');
const dispels = () => out.packets.filter((x) => x.a === ACTOR && x.p.customPacketType === 'dboDispelSelf');
const sent = () => out.packets.filter((x) => x.a === ACTOR).map((x) => `${x.p.customPacketType}:${(x.p.spell >>> 0).toString(16)}`);
const calls = (fn) => out.papyrus.filter((c) => c.fn === fn);
const blessing = () => props.get(ACTOR + '|private.dboBlessing') || null;
const worship = (id, tier) => {
  const d = choiceOf(id);
  props.set(ACTOR + '|private.dboDeity', { id: d.id, name: d.name, kind: d.kind, at: 1, convertedAt: 1, warnedUnlawful: true });
  props.delete(ACTOR + '|private.prayedShrines');
  props.delete(ACTOR + '|private.dboBlessing');
  props.set(ACTOR + '|private.mastery', tier === undefined ? null : { order: ['priest'], skills: { priest: { rank: tier } } });
};
// A held prayer whose roll always lands, at the deity's own shrine (or anywhere, for a faith that needs none)
const prayAndWin = (id) => {
  const d = choiceOf(id);
  wallClock += 2000; virtual += 100000; clear();
  if (d.prayAnywhere) commands.get('pray')(ACTOR, '');
  else globalThis.__dboPrayerActivate(idOf(d.shrines[0]), ACTOR);
  const w = out.widgets[out.widgets.length - 1];
  if (!w || w.type !== 'prayer') return { ok: false, said: out.personals.join(' | ') };
  const start = virtual;
  virtual = start + w.totalMs + 100;
  const roll = Math.random; Math.random = () => 0;
  clear();
  try { fire('prayer', [w.nonce, JSON.stringify([[0, w.totalMs]]), w.totalMs]); } finally { Math.random = roll; }
  return { ok: true, said: out.personals.join(' | ') };
};

load();

// ---- 1. what each blessing is, read from its record --------------------------------------------------------------
check('the measured table covers every blessing spell in skills.json',
  SKILLS.deities.choices.filter((c) => /^[0-9a-f]+:/i.test(String(c.blessing))).every((c) => MEASURED[c.id]) && Object.keys(MEASURED).length === 27,
  `${Object.keys(MEASURED).length} measured`);
const boot = out.logs.find((l) => /^prayer on:/.test(l)) || '';
check('the boot line counts 25 blessings cast on the worshipper, 2 learned and 8 kept by the server (Ithelia, 12 Oct)',
  /27 resolved \(25 cast on the worshipper, 2 learned\), 8 server-side, 0 broken/.test(boot), boot.replace(/^.*blessings /, ''));

// ---- 2. every blessing, granted for real -------------------------------------------------------------------------
const rows = [];
for (const id of [...Object.keys(MEASURED), ...SERVER_HELD]) {
  worship(id);
  learned.clear();
  const r = prayAndWin(id);
  const b = blessing();
  const spell = spellOf(id);
  const sent = casts();
  rows.push({ id, ok: r.ok, sent: sent.length, packet: sent[0] && sent[0].p, added: calls('AddSpell').length, learnedNow: learned.has(spell), via: b && b.via, spellOk: !!b && b.spell === spell });
}
const row = (id) => rows.find((x) => x.id === id);
const castRows = CAST.map(row);
check('every Fire-and-Forget blessing (25, Riddle\'Thar\'s Night Eye among them) is cast on the worshipper by their own client',
  castRows.length === 25 && castRows.every((x) => x.ok && x.sent === 1 && x.via === 'cast' && x.spellOk) && castRows.some((x) => x.id === 'riddlethar'),
  castRows.filter((x) => !(x.ok && x.sent === 1 && x.via === 'cast')).map((x) => x.id).join(', ') || '25 of 25');
check('the packet is the one castSelfService reads: { customPacketType: dboCastSelf, spell }',
  castRows.every((x) => x.packet && x.packet.customPacketType === 'dboCastSelf' && x.packet.spell === spellOf(x.id) && Object.keys(x.packet).length === 2),
  JSON.stringify(row('akatosh').packet));
check('and none of them is taught: no AddSpell, nothing in the learned list',
  castRows.every((x) => x.added === 0 && !x.learnedNow), castRows.filter((x) => x.added || x.learnedNow).map((x) => x.id).join(', '));
check('the Abilities (Trinimac, the Worm Cult) are still learned, which is what runs them, and nothing is cast',
  ABILITIES.map(row).every((x) => x.ok && x.added === 1 && x.learnedNow && x.sent === 0 && x.via === 'spell'),
  JSON.stringify(ABILITIES.map(row)));
check('the Hist, the Ancestors and the Yokudan gods give a boon the server keeps: nothing taught, nothing cast, the record holds the god and the end',
  SERVER_HELD.map(row).every((x) => x.ok && x.added === 0 && x.sent === 0 && x.via === undefined && x.spellOk),
  JSON.stringify(SERVER_HELD.map(row)));
check('and no power is handed out any more', rows.every((x) => !Object.values(OLD).includes(x.packet ? x.packet.spell : -1)) && Object.values(OLD).every((id) => !learned.has(id)));

// ---- 3. the cast, step by step: Akatosh at priest tier 3 (a 16 h blessing over an 8 h spell) ----------------------
worship('akatosh', 3);
learned.clear();
learned.add(spellOf('akatosh'));                 // taught by the old code and never taken back (a lost expiry)
prayAndWin('akatosh');
const T0 = wallClock;
let b = blessing();
const removeFirst = calls('RemoveSpell').find((c) => c.spell === spellOf('akatosh'));
check('a spell the old code taught is taken out of the learned list, before the cast is sent',
  !!removeFirst && removeFirst.changed && removeFirst.n === 0 && !learned.has(spellOf('akatosh')) && casts().length === 1,
  JSON.stringify(out.papyrus));
check('the blessing lasts the priest tier\'s 16 h', !!b && b.until === T0 + 16 * H && b.via === 'cast', JSON.stringify(b));
wallClock = T0 + 4 * H; sweep();
check('4 h in, with the spell still running, nothing is sent', casts().length === 0);
wallClock = T0 + 8 * H - 30000; sweep();
check('a sweep before the 8 h spell runs out, with the blessing running on, it is cast again', casts().length === 1 && casts()[0].p.spell === spellOf('akatosh'), JSON.stringify(out.packets));
check('ending the old effect first (dboDispelSelf, then dboCastSelf), so a client that has it restarts the spell cleanly',
  sent().join(' ') === `dboDispelSelf:${spellOf('akatosh').toString(16)} dboCastSelf:${spellOf('akatosh').toString(16)}`, sent().join(' '));
wallClock += 60000; sweep();
check('once, not every sweep', casts().length === 0);
wallClock = T0 + 15 * H; sweep();
check('the second cast covers the blessing to its end: no third', casts().length === 0);

// ---- 4. login --------------------------------------------------------------------------------------------------
globalThis.__dboDeityForget(ACTOR);              // the gamemode's logout
wallClock = T0 + 10 * H; clear();
globalThis.__dboPrayerLogin(ACTOR);
check('a login while the blessing runs casts it again (the client lost it with the session)', casts().length === 1 && calls('AddSpell').length === 0, JSON.stringify(out.packets));
wallClock = T0 + 16 * H + 1; sweep();
check('at its end the blessing fades and nothing is taken back, there being nothing to take',
  !blessing() && calls('RemoveSpell').length === 0 && casts().length === 0 && out.personals.some((p) => /blessing of Akatosh fades/.test(p)), out.personals.join(' | '));
check('and its effect is ended on the client: { customPacketType: dboDispelSelf, spell }',
  dispels().length === 1 && dispels()[0].p.spell === spellOf('akatosh') && Object.keys(dispels()[0].p).length === 2, JSON.stringify(out.packets));
globalThis.__dboDeityForget(ACTOR);
clear(); globalThis.__dboPrayerLogin(ACTOR);
check('a login after it ended sends nothing', casts().length === 0 && out.papyrus.length === 0);

// an 8 h blessing over an 8 h spell ends with it: no cast at the spell's end
worship('akatosh', 0);
prayAndWin('akatosh');
const T1 = wallClock;
check('a tier-1 blessing lasts 8 h, as long as the spell', blessing() && blessing().until === T1 + 8 * H);
wallClock = T1 + 8 * H - 30000; sweep();
check('so the spell running out is not answered with another 8 h cast', casts().length === 0);
// nor is a login in its last minute
globalThis.__dboDeityForget(ACTOR); clear(); globalThis.__dboPrayerLogin(ACTOR);
check('nor a login in the blessing\'s last minute', casts().length === 0);

// ---- 5. a login that the gamemode never reported (the sweep's own catch) ------------------------------------------
worship('julianos');
prayAndWin('julianos');
globalThis.__dboDeityForget(ACTOR);              // logged out: a sweep runs while they are away
online = false; wallClock += 60000; sweep();
online = true;                                   // and back in; the login hook has not run (or never will)
wallClock += 60000; sweep();
const firstSweep = casts().length;
wallClock += 60000; sweep();
check('a worshipper online with no cast this session is cast at the second sweep, not the first (a login is still loading)',
  firstSweep === 0 && casts().length === 1, `${firstSweep}, then ${casts().length}`);

// ---- 6. a blessing granted before this fix ----------------------------------------------------------------------
learned.clear();
learned.add(spellOf('arkay'));
props.set(ACTOR + '|private.dboBlessing', { deity: 'arkay', spell: spellOf('arkay'), until: wallClock + 5 * H });
globalThis.__dboDeityForget(ACTOR); clear();
globalThis.__dboPrayerLogin(ACTOR);
b = blessing();
check('an old blessing (taught, no `via`) at login: the spell leaves the learned list and is cast for the time left',
  !learned.has(spellOf('arkay')) && calls('RemoveSpell').length === 1 && casts().length === 1 && b.via === 'cast' && b.until === wallClock + 5 * H,
  JSON.stringify({ papyrus: out.papyrus, b }));
const r6 = calls('RemoveSpell')[0];
check('the RemoveSpell goes out before the cast', r6.n === 0);
// one that expired while its worshipper was away
learned.add(spellOf('stendarr'));
props.set(ACTOR + '|private.dboBlessing', { deity: 'stendarr', spell: spellOf('stendarr'), until: wallClock - 1000 });
globalThis.__dboDeityForget(ACTOR); clear();
globalThis.__dboPrayerLogin(ACTOR);
check('an old blessing that ended offline is not cast at login', casts().length === 0);
sweep();
check('and the sweep takes its taught spell back as it always did, with nothing to end on the client', !blessing() && !learned.has(spellOf('stendarr')) && calls('RemoveSpell').length === 1 && dispels().length === 0);
// one running while its worshipper was online when this loaded: the second sweep
learned.add(spellOf('mara'));
props.set(ACTOR + '|private.dboBlessing', { deity: 'mara', spell: spellOf('mara'), until: wallClock + 3 * H });
globalThis.__dboBlessingCasts.delete(ACTOR);
delete globalThis.__dboBlessingSeen;             // the reload that ships this: no sweep has run yet
load();
sweep(); const s1 = casts().length;
wallClock += 60000; sweep();
check('an old blessing on someone online at the reload is moved over within two sweeps',
  s1 === 0 && casts().length === 1 && !learned.has(spellOf('mara')) && blessing().via === 'cast', `${s1}, then ${casts().length}`);

// ---- 7. an Ability: learned while it lasts, taken back at the end ------------------------------------------------
worship('trinimac');
learned.clear();
prayAndWin('trinimac');
const T2 = wallClock;
b = blessing();
check('Trinimac\'s Ability is learned for the faiths\' half-length blessing (4 h)', learned.has(spellOf('trinimac')) && b.until === T2 + 4 * H && b.via === 'spell', JSON.stringify(b));
globalThis.__dboDeityForget(ACTOR); clear(); globalThis.__dboPrayerLogin(ACTOR);
check('a login sends no cast for an Ability (the learned list comes back by itself)', casts().length === 0 && out.papyrus.length === 0);
wallClock = T2 + 4 * H + 1; sweep();
check('and at its end the Ability is taken back (no dboDispelSelf: RemoveSpell ends it)', !learned.has(spellOf('trinimac')) && calls('RemoveSpell').length === 1 && !blessing() && dispels().length === 0);

// ---- 8. a blessing shorter than its spell (the Dragon Cult, 4 h, over the 8 h AltarTalosSpell) --------------------
worship('dragoncult');
prayAndWin('dragoncult');
const T3 = wallClock;
check('the Dragon Cult\'s blessing is cast, and lasts 4 h', casts().length === 1 && blessing().until === T3 + 4 * H);
wallClock = T3 + 4 * H + 1; sweep();
check('it fades at 4 h, and its 8 h effect is ended on the client then, not 4 h later',
  !blessing() && calls('RemoveSpell').length === 0 && casts().length === 0 && dispels().length === 1 && dispels()[0].p.spell === spellOf('dragoncult'), JSON.stringify(out.packets));

// ---- 9. turning, the staff reset, Sheogorath -------------------------------------------------------------------
worship('kynareth');
prayAndWin('kynareth');
props.set(ACTOR + '|private.dboDeity', { id: 'kynareth', name: 'Kynareth', kind: 'divine', at: 1, convertedAt: 1 });
clear();
fire('deityChoose', ['x', 'mara']);              // a stale nonce: nothing
globalThis.__dboDeityPicker(ACTOR);
const pick = out.widgets[out.widgets.length - 1];
clear(); fire('deityChoose', [pick.nonce, 'mara']);
check('turning to another god ends a cast blessing with no RemoveSpell', (props.get(ACTOR + '|private.dboDeity') || {}).id === 'mara'
  && !blessing() && calls('RemoveSpell').length === 0, JSON.stringify(out.papyrus));
check('and ends its effect on the client', dispels().length === 1 && dispels()[0].p.spell === spellOf('kynareth'), JSON.stringify(out.packets));

worship('sheogorath');
const roll = Math.random;
const r9 = prayAndWin('sheogorath');
Math.random = roll;
b = blessing();
check('Sheogorath hands over another god\'s blessing, and a Fire-and-Forget one is cast',
  r9.ok && !!b && b.deity !== 'sheogorath' && (CAST.includes(b.deity) ? casts().length === 1 && b.via === 'cast' : calls('AddSpell').length === 1),
  JSON.stringify(b));

// ---- 10. a record the server cannot read keeps AddSpell --------------------------------------------------------
const saved = records.get(spellOf('nocturnal'));
records.delete(spellOf('nocturnal'));
load();
worship('nocturnal');
learned.clear();
prayAndWin('nocturnal');
check('a blessing whose record cannot be read is taught as before, not lost', calls('AddSpell').length === 1 && casts().length === 0 && blessing().via === 'spell'
  && out.logs.some((l) => /record unreadable/.test(l)));
records.set(spellOf('nocturnal'), saved);

// ---- 11. an offering costs no shrine rest (the second fix of 2026-10-01) ------------------------------------------
// /offer wants the shrine touched first, and a touch at a shrine that is not resting opens a prayer round. Closing that
// round to type /offer used to finish it as a failure, which rested the shrine for 5 minutes before the prayer.
const SHRINE = idOf(choiceOf('akatosh').shrines[0]);
const rests = () => props.get(ACTOR + '|private.prayedShrines') || {};
const touch = () => { wallClock += 2000; virtual += 100000; clear(); globalThis.__dboPrayerActivate(SHRINE, ACTOR); return { w: out.widgets.find((x) => x.type === 'prayer' && !x.result), said: out.personals.join(' | ') }; };
worship('akatosh');
let t = touch();
check('a touch at the shrine opens a round', !!t.w);
clear(); fire('prayerCancel', [t.w.nonce]);
const closed = out.widgets.find((x) => x.type === 'prayer' && x.result);
check('closed before the first press, it rests nothing', !rests()[SHRINE.toString(16)] && !!closed && /without praying/.test(closed.result), JSON.stringify(rests()));
clear(); commands.get('offer')(ACTOR, '50');
const offering = props.get(ACTOR + '|private.dboOffering');
check('the offering is taken at the shrine just touched', !!offering && offering.deityId === 'akatosh' && offering.gold === 50, out.personals.join(' | '));
t = touch();
check('and the shrine hears the prayer it was made for at once', !!t.w && !/prayed here recently/.test(t.said), t.said);
clear(); fire('prayerStart', [t.w.nonce]);
virtual += 3000; clear(); fire('prayerCancel', [t.w.nonce]);
check('a round begun (the first press) and abandoned still rests the shrine', Number(rests()[SHRINE.toString(16)]) === wallClock + 5 * 60000, JSON.stringify(rests()));
t = touch();
check('so the next touch is refused for those minutes', !t.w && /prayed here recently/.test(t.said), t.said);

// ---- 12. the same for Escape (the relay's close), which the client-judged prayer now answers ---------------------
props.delete(ACTOR + '|private.prayedShrines');
t = touch();
clear(); fire('close', []);
check('Escape before the first press rests nothing either, and says so', !rests()[SHRINE.toString(16)] && /without praying/.test(out.personals.join(' | ')), JSON.stringify(rests()));
t = touch();
check('...so the shrine opens a round again at once', !!t.w && !/prayed here recently/.test(t.said), t.said);
clear(); fire('prayerStart', [t.w.nonce]);
virtual += 3000; clear(); fire('close', []);
check('Escape after the first press still rests the shrine', Number(rests()[SHRINE.toString(16)]) === wallClock + 5 * 60000, JSON.stringify(rests()));

// ---- 13. the end of a cast blessing, the rest of it: a new blessing over it, a staff reset -------------------------
props.delete(ACTOR + '|private.prayedShrines');   // section 12 left the shrine resting
worship('arkay');
prayAndWin('arkay');
props.delete(ACTOR + '|private.prayedShrines');
prayAndWin('arkay');
check('a new blessing over a running one: the old effect is ended, then the new one cast, in that order',
  sent().join(' ') === `dboDispelSelf:${spellOf('arkay').toString(16)} dboCastSelf:${spellOf('arkay').toString(16)}` && blessing().via === 'cast', sent().join(' '));
clear(); commands.get('deity')(STAFF, 'reset tester');
check('a staff reset of a worshipper who is online ends the effect on their client', !blessing() && dispels().length === 1 && dispels()[0].p.spell === spellOf('arkay') && calls('RemoveSpell').length === 0, JSON.stringify(out.packets));
worship('arkay');
prayAndWin('arkay');
online = false; clear();
commands.get('deity')(STAFF, 'reset tester');
check('and of one who is offline sends nothing (their effect went with the session)', !blessing() && out.packets.length === 0, JSON.stringify(out.packets));
online = true;
worship('trinimac');
prayAndWin('trinimac');
clear(); commands.get('deity')(STAFF, 'reset tester');
check('an Ability is taken back by RemoveSpell, with nothing to end on the client', !blessing() && calls('RemoveSpell').length === 1 && dispels().length === 0);

// ---- 13. a death: the client skips a cast on the dead, and may come back without the effect ------------------------
const dead = (v) => props.set(ACTOR + '|isDead', v);
const watch = () => timers.get('prayerBlessingRespawn')();
worship('mara', 3);
prayAndWin('mara');                               // 16 h over the 8 h AltarMaraSpell
dead(true); clear(); watch(); wallClock += 1000; watch();
check('while the worshipper is dead nothing is cast', casts().length === 0 && dispels().length === 0);
dead(false); watch(); wallClock += 1000; watch();
check('nor in their first seconds on their feet (the client\'s own death lags the server\'s; a temple respawn loads a cell)', casts().length === 0);
wallClock += 2000; watch();
check('3 s after they stand, the blessing is cast again, any effect that survived the death ended first',
  sent().join(' ') === `dboDispelSelf:${spellOf('mara').toString(16)} dboCastSelf:${spellOf('mara').toString(16)}`, sent().join(' '));
clear(); wallClock += 1000; watch(); wallClock += 5000; watch();
check('once', out.packets.length === 0);
const R = globalThis.__dboBlessingCasts.get(ACTOR);
wallClock = R + 8 * H - 30000; dead(true); sweep();
check('the spell running out while its worshipper lies dead is not cast on them (castSelfService would skip it, Reviewer F)', casts().length === 0, JSON.stringify(out.packets));
watch(); dead(false); watch(); wallClock += 3000; clear(); watch();
check('it is cast when they stand', casts().length === 1 && casts()[0].p.spell === spellOf('mara'));
clear(); sweep();
check('and the sweep, seeing that cast, does not cast it again', casts().length === 0);
globalThis.__dboDeityForget(ACTOR); dead(true); clear();
globalThis.__dboPrayerLogin(ACTOR);
check('a login while dead casts nothing', casts().length === 0);
watch(); dead(false); watch(); wallClock += 3000; watch();
check('the stand-up after it does', casts().length === 1);
worship('wormcult');
prayAndWin('wormcult');
dead(true); clear(); watch(); dead(false); watch(); wallClock += 4000; watch();
check('an Ability is not cast at a stand-up (the learned list keeps it)', out.packets.length === 0);
dead(false);

// ---- 14. a racial power granted before: taken back, and the deity's blessing of today in its place -------------------
worship('hist');
learned.clear(); learned.add(OLD.hist);
props.set(ACTOR + '|private.dboBlessing', { deity: 'hist', spell: OLD.hist, until: wallClock + 3 * H, via: 'spell' });
globalThis.__dboDeityForget(ACTOR); clear();
globalThis.__dboPrayerLogin(ACTOR);
b = blessing();
check('a Hist blessing from before (Histskin, a power the client blocks) at login: the power leaves the learned list, the server keeps the boon for the time left',
  !learned.has(OLD.hist) && calls('RemoveSpell').length === 1 && calls('RemoveSpell')[0].spell === OLD.hist && b.deity === 'hist' && b.spell === 0
  && b.until === wallClock + 3 * H && out.packets.length === 0 && out.logs.some((l) => /racial power e40d5/.test(l)), JSON.stringify(b));
check('and the Hist\'s regeneration is held from then', globalThis.__dboBlessingRegen(ACTOR).some((e) => e.av === 'HealRateMult' && e.mag === 50));
wallClock = b.until + 1; sweep();
check('at its end there is nothing left to take back', !blessing() && calls('RemoveSpell').length === 0 && dispels().length === 0);
worship('riddlethar');
learned.clear(); learned.add(OLD.riddlethar);
props.set(ACTOR + '|private.dboBlessing', { deity: 'riddlethar', spell: OLD.riddlethar, until: wallClock + 5 * H, via: 'spell' });
globalThis.__dboDeityForget(ACTOR); clear();
globalThis.__dboPrayerLogin(ACTOR);
b = blessing();
check('a Riddle\'Thar blessing from before (the Khajiit Night Eye power): taken back, and the Night Eye cast at login for the time left',
  !learned.has(OLD.riddlethar) && b.spell === spellOf('riddlethar') && b.via === 'cast' && casts().length === 1 && casts()[0].p.spell === spellOf('riddlethar')
  && calls('RemoveSpell')[0].spell === OLD.riddlethar && calls('RemoveSpell')[0].n === 0, JSON.stringify({ b, packets: out.packets }));
for (const id of ['ancestors', 'yokudan']) {
  worship(id);
  learned.clear(); learned.add(OLD[id]);
  // the Yokudan one as the code before 2026-10-01 wrote it (no `via`)
  props.set(ACTOR + '|private.dboBlessing', Object.assign({ deity: id, spell: OLD[id], until: wallClock + 2 * H }, id === 'ancestors' ? { via: 'spell' } : {}));
  clear(); sweep();
  b = blessing();
  check(`a${id === 'ancestors' ? 'n Ancestors' : ' Yokudan'} blessing from before, online when this loads: moved over at the next sweep`,
    !learned.has(OLD[id]) && calls('RemoveSpell').length === 1 && b.spell === 0 && b.deity === id && out.packets.length === 0, JSON.stringify(b));
}
worship('ancestors');
learned.clear(); learned.add(OLD.ancestors);
props.set(ACTOR + '|private.dboBlessing', { deity: 'ancestors', spell: OLD.ancestors, until: wallClock - 1000, via: 'spell' });
clear(); sweep();
check('one that ended while its worshipper was away is taken back at the sweep, as always', !blessing() && !learned.has(OLD.ancestors) && calls('RemoveSpell').length === 1);
// Sheogorath's pool holds the server's own boons too
const pool = SKILLS.deities.choices.filter((x) => x.id !== 'sheogorath' && (/^[0-9a-f]+:/i.test(String(x.blessing)) || x.hungerHalf || x.scholarBoon || x.blessingRegen || x.combatBoon));
const poolAt = pool.findIndex((x) => x.id === 'ancestors');
worship('sheogorath');
{
  const sheo = choiceOf('sheogorath');
  wallClock += 2000; virtual += 100000; clear();
  if (sheo.prayAnywhere) commands.get('pray')(ACTOR, ''); else globalThis.__dboPrayerActivate(idOf(sheo.shrines[0]), ACTOR);
  const w = out.widgets[out.widgets.length - 1];
  virtual += w.totalMs + 100;
  const rolls = [0, (poolAt + 0.5) / pool.length];
  const roll = Math.random; Math.random = () => (rolls.length ? rolls.shift() : 0);
  clear();
  try { fire('prayer', [w.nonce, JSON.stringify([[0, w.totalMs]]), w.totalMs]); } finally { Math.random = roll; }
}
b = blessing();
check('Sheogorath can hand over a boon the server keeps (the Ancestors\' ward)', poolAt >= 0 && !!b && b.deity === 'ancestors' && b.spell === 0 && out.packets.length === 0, JSON.stringify(b));

// ---- 15. display abilities for the server's own boons (12 Oct: "players like visuals for all boons") ---------------
// A deity whose boon the server keeps can name a display-only Ability (blessingDisplay): learned for as long as the
// blessing runs so it shows in Active Effects, taken back wherever the blessing ends. skills.json ships them empty.
check('skills.json ships every blessingDisplay empty, on the six server boons only',
  SKILLS.deities.choices.filter((c) => 'blessingDisplay' in c).map((c) => c.id).sort().join(',') === 'ancestors,hermaeusmora,hist,ithelia,sanguine,yokudan'
  && SKILLS.deities.choices.every((c) => !c.blessingDisplay));
// empty ids: the old behaviour (sections 2 and 14 ran with them)
load();
check('with no ids the boot line names none', out.logs.some((l) => l === "prayer: display abilities for the server's boons: 0 of 0 named"), out.logs.filter((l) => /display abil/.test(l)).join(' | '));
worship('hist'); learned.clear();
prayAndWin('hist');
check('and a Hist blessing teaches nothing and records no display', calls('AddSpell').length === 0 && blessing() && !('display' in blessing()), JSON.stringify(blessing()));
{
  const DISP = { hist: 0xd15001, sanguine: 0xd15002, hermaeusmora: 0xd15003, ancestors: 0xd15004, yokudan: 0xd15005, ithelia: 0xd15006 };
  const displayDesc = (id) => `${DISP[id].toString(16)}:DragonBreak Online Edits.esp`;
  // display records: an Ability (SPIT type 4), constant effect (cast type 0), self, one effect with no duration
  for (const id of ['hist', 'sanguine', 'hermaeusmora', 'ithelia']) records.set(DISP[id], spel([`DBO_BoonDisplay_${id}`, 4, 0, 0, [0]]));
  records.set(DISP.yokudan, spel(['DBO_BoonDisplay_yokudan', 0, 1, 0, [28800]]));    // a Fire-and-Forget Spell: not an Ability
  // the Ancestors' id names a record that is not in the load order (the PC's DLE not deployed yet)
  const setIds = (ids) => { for (const c of SKILLS.deities.choices) if ('blessingDisplay' in c) c.blessingDisplay = ids[c.id] || ''; };
  setIds({ hist: displayDesc('hist'), sanguine: displayDesc('sanguine'), hermaeusmora: displayDesc('hermaeusmora'), ancestors: displayDesc('ancestors'),
    yokudan: displayDesc('yokudan'), ithelia: 'DBO_BoonDisplay_Ithelia' });
  const dispFor = (id) => DISP[id];
  const removed = (id) => calls('RemoveSpell').filter((c) => c.spell === dispFor(id)).length;
  const added = (id) => calls('AddSpell').filter((c) => c.spell === dispFor(id)).length;

  // a blessing granted by the code before this one, still running at the reload that ships it (memory: reload over old state)
  const fs = require('fs'), os = require('os'), cp = require('child_process');
  const OLD_REF = process.env.PRAYER_OLD_REF || 'ba438c574f4c728c217402eedb318713e21ff06c';
  let oldDir = null;
  try {
    oldDir = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-prayer-old-'));
    for (const f of ['prayer.js', 'minigames.js']) fs.writeFileSync(path.join(oldDir, f), cp.execFileSync('git', ['-C', SERVER, 'show', `${OLD_REF}:${f}`]));
  } catch (e) { oldDir = null; console.log(`(the old prayer.js at ${OLD_REF} could not be read: ${e.message})`); }
  if (oldDir) {
    const OLDP = path.join(oldDir, 'prayer.js');
    delete require.cache[OLDP]; handlers.clear(); commands.clear(); timers.clear(); require(OLDP)(api);
    worship('hist'); learned.clear();
    prayAndWin('hist');
    const before = blessing();
    timers.get('prayerBlessings')();
    // the release: the new module over the old one's globalThis state and records
    clear(); load();
    sweep();
    const b15 = blessing();
    check('reload over old state: a Hist blessing the old code gave (no display) gets its display ability at the first sweep after the reload',
      !!before && !('display' in before) && !!b15 && b15.display === DISP.hist && learned.has(DISP.hist) && added('hist') === 1 && b15.until === before.until && b15.deity === 'hist',
      JSON.stringify({ before, after: b15 }));
    clear(); sweep();
    check('and once: the next sweep sends nothing', out.papyrus.length === 0 && out.packets.length === 0, JSON.stringify(out.papyrus));
    fs.rmSync(oldDir, { recursive: true, force: true });
  }
  clear(); load();
  const bootDisp = out.logs.find((l) => /display abilities for the server's boons/.test(l)) || '';
  check('the boot line counts the good ones: 3 of 6 named (hist, sanguine, hermaeusmora)',
    /: 3 of 6 named \(/.test(bootDisp) && /hist d15001/.test(bootDisp) && /sanguine d15002/.test(bootDisp) && /hermaeusmora d15003/.test(bootDisp), bootDisp);
  const warns = () => out.logs.filter((l) => /^prayer: the display ability of /.test(l));
  check('a missing record, a non-Ability and an unresolvable id are each logged once, at boot',
    warns().length === 3 && warns().some((l) => /Ancestors .* cannot be read/.test(l)) && warns().some((l) => /Yokudan .* is not an Ability \(SPIT type 0\)/.test(l))
    && warns().some((l) => /Ithelia .* does not resolve/.test(l)), warns().join(' | '));

  // grant
  worship('hist'); learned.clear();
  prayAndWin('hist');
  let bh = blessing();
  check('a Hist blessing with a display id: the display Ability is learned (AddSpell), nothing is cast, the record keeps it',
    added('hist') === 1 && learned.has(DISP.hist) && casts().length === 0 && bh.display === DISP.hist && bh.spell === 0 && bh.via === undefined, JSON.stringify(bh));
  check('the log says it was given as a spell', out.logs.some((l) => /blessing of The Hist \(the server's own\) given .*display ability d15001 given as a spell/.test(l)));
  const regen = globalThis.__dboBlessingRegen(ACTOR);
  check('the boon is not doubled: the regeneration held is still the Hist\'s one +50% (the display carries no stat)',
    regen.length === 1 && regen[0].av === 'HealRateMult' && regen[0].mag === 50, JSON.stringify(regen));
  wallClock += 60000; sweep();
  check('a sweep while it runs touches nothing', out.papyrus.length === 0 && out.packets.length === 0);
  // relog
  globalThis.__dboDeityForget(ACTOR); wallClock += 60000; clear();
  globalThis.__dboPrayerLogin(ACTOR);
  check('a login while it runs gives the display Ability again (a known spell: no change), and casts nothing',
    added('hist') === 1 && calls('RemoveSpell').length === 0 && learned.has(DISP.hist) && casts().length === 0 && blessing().display === DISP.hist, JSON.stringify(out.papyrus));
  // replace
  props.delete(ACTOR + '|private.prayedShrines');
  worship('sanguine'); props.set(ACTOR + '|private.dboBlessing', bh);
  clear(); prayAndWin('sanguine');
  const bs = blessing();
  const order = out.papyrus.map((c) => `${c.fn}:${c.spell.toString(16)}`).join(' ');
  check('a new blessing over it: the Hist\'s display is taken back, then Sanguine\'s given',
    order === 'RemoveSpell:d15001 AddSpell:d15002' && !learned.has(DISP.hist) && learned.has(DISP.sanguine) && bs.display === DISP.sanguine, order);
  check('and Sanguine\'s appetite is still the server\'s', globalThis.__dboPrayerHungerMult(ACTOR) === 0.5);
  // expiry at the sweep
  wallClock = bs.until + 1; sweep();
  check('at its end the display Ability is taken back with it', !blessing() && removed('sanguine') === 1 && !learned.has(DISP.sanguine)
    && out.personals.some((p) => /blessing of Sanguine fades/.test(p)), JSON.stringify(out.papyrus));
  // expiry while logged out
  worship('hermaeusmora'); learned.clear();
  prayAndWin('hermaeusmora');
  const bm = blessing();
  check('Hermaeus Mora\'s blessing carries its display', bm.display === DISP.hermaeusmora && learned.has(DISP.hermaeusmora));
  globalThis.__dboDeityForget(ACTOR); online = false;
  wallClock = bm.until + 3600000; sweep();
  check('offline, the sweep does not see it', !!blessing() && out.papyrus.length === 0);
  online = true; clear();
  globalThis.__dboPrayerLogin(ACTOR);
  check('a login after it ran out takes the display back at once (not a minute later), and says it faded',
    !blessing() && removed('hermaeusmora') === 1 && !learned.has(DISP.hermaeusmora) && out.personals.some((p) => /Hermaeus Mora fades/.test(p)) && casts().length === 0,
    JSON.stringify(out.papyrus));
  // a turn
  worship('hist'); learned.clear();
  prayAndWin('hist');
  globalThis.__dboDeityPicker(ACTOR);
  const pk = out.widgets[out.widgets.length - 1];
  clear(); fire('deityChoose', [pk.nonce, 'mara']);
  check('turning to another god takes the display back', (props.get(ACTOR + '|private.dboDeity') || {}).id === 'mara' && !blessing() && removed('hist') === 1 && !learned.has(DISP.hist), JSON.stringify(out.papyrus));
  // the staff reset, online and offline
  for (const on of [true, false]) {
    worship('hist'); learned.clear();
    prayAndWin('hist');
    online = on; clear();
    commands.get('deity')(STAFF, 'reset tester');
    check(`a staff reset (worshipper ${on ? 'online' : 'offline'}) takes the display back`, !blessing() && removed('hist') === 1 && !learned.has(DISP.hist), JSON.stringify(out.papyrus));
    online = true;
  }
  // a broken id: the boon works without it, and the warning is not repeated
  worship('ancestors'); learned.clear();
  const w0 = out.logs.length;
  prayAndWin('ancestors');
  props.delete(ACTOR + '|private.prayedShrines'); prayAndWin('ancestors');
  check('the Ancestors (record missing): no AddSpell, no display recorded, the ward still on, no new warning',
    calls('AddSpell').length === 0 && blessing() && !('display' in blessing()) && globalThis.__dboBlessedWith(ACTOR, 'combatBoon') === true
    && !out.logs.slice(w0).some((l) => /display ability of/.test(l)), JSON.stringify(blessing()));
  clear(); sweep();
  check('and the sweep does not keep trying', out.papyrus.length === 0);
  worship('yokudan'); learned.clear(); prayAndWin('yokudan');
  check('the Yokudan gods (display record not an Ability): nothing given, nothing cast, stamina held',
    calls('AddSpell').length === 0 && casts().length === 0 && !('display' in blessing()) && globalThis.__dboBlessingRegen(ACTOR).some((e) => e.av === 'StaminaRateMult' && e.mag === 100));
  // an id emptied (or changed) in skills.json while a blessing runs
  worship('hist'); learned.clear(); prayAndWin('hist');
  setIds({ sanguine: displayDesc('sanguine'), hermaeusmora: displayDesc('hermaeusmora') });
  clear(); load(); sweep();
  check('an id emptied while a blessing runs: the next sweep takes the display back and the boon runs on',
    removed('hist') === 1 && !learned.has(DISP.hist) && blessing() && blessing().deity === 'hist' && !('display' in blessing())
    && globalThis.__dboBlessingRegen(ACTOR).some((e) => e.av === 'HealRateMult'), JSON.stringify(blessing()));
  setIds({ hist: displayDesc('hist'), sanguine: displayDesc('sanguine'), hermaeusmora: displayDesc('hermaeusmora') });
  load();
  // a cast blessing is not touched: no display for a deity with a spell
  worship('akatosh'); learned.clear(); prayAndWin('akatosh');
  check('a cast blessing (Akatosh) gets no display, as before', calls('AddSpell').length === 0 && casts().length === 1 && !('display' in blessing()));
  // Sheogorath: unchanged; the god he picks brings its own
  const sheoPool = SKILLS.deities.choices.filter((x) => x.id !== 'sheogorath' && (/^[0-9a-f]+:/i.test(String(x.blessing)) || x.hungerHalf || x.scholarBoon || x.blessingRegen || x.combatBoon));
  const sheoPray = (pickId) => {
    worship('sheogorath'); learned.clear();
    const sheo = choiceOf('sheogorath');
    wallClock += 2000; virtual += 100000; clear();
    if (sheo.prayAnywhere) commands.get('pray')(ACTOR, ''); else globalThis.__dboPrayerActivate(idOf(sheo.shrines[0]), ACTOR);
    const w = out.widgets[out.widgets.length - 1];
    virtual += w.totalMs + 100;
    const at = sheoPool.findIndex((x) => x.id === pickId);
    const rolls = [0, (at + 0.5) / sheoPool.length];
    const roll = Math.random; Math.random = () => (rolls.length ? rolls.shift() : 0);
    clear();
    try { fire('prayer', [w.nonce, JSON.stringify([[0, w.totalMs]]), w.totalMs]); } finally { Math.random = roll; }
    return blessing();
  };
  let sb = sheoPray('akatosh');
  check('Sheogorath handing over Akatosh: cast, no display (unchanged)', sb && sb.deity === 'akatosh' && casts().length === 1 && calls('AddSpell').length === 0 && !('display' in sb), JSON.stringify(sb));
  sb = sheoPray('hist');
  check('Sheogorath handing over the Hist: the Hist\'s display goes with it', sb && sb.deity === 'hist' && sb.display === DISP.hist && added('hist') === 1, JSON.stringify(sb));
  check('Sheogorath has no display of his own', !('blessingDisplay' in choiceOf('sheogorath')));
  setIds({});
}

console.log('');
console.log('deity        cast  learned  via');
for (const x of rows) console.log(`${x.id.padEnd(12)} ${String(x.sent).padEnd(5)} ${String(x.learnedNow).padEnd(8)} ${x.via}`);
Date.now = realNow;
console.log('');
console.log(failures ? `${failures} FAILURES` : 'all checks passed');
process.exit(failures ? 1 : 0);
