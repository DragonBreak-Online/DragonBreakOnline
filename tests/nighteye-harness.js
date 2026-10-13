// Scripted test for the Khajiit's Night Eye (racial.js, the Racial Power with view 'nightEye'): only a Khajiit (the vampire
// Khajiit too) calls it, only from a client that draws it (dbo:uiCaps 'nightEye', client 0.3.97), with its 20-minute wait
// and 60 seconds; the player's own client is told on and off (dboNightEye), never anyone else's; the end, death, a beast
// form, a change of race and logout take it off; a relog while it lasts draws it again. Wiring in gamemode.js checked by
// source. Loads the real racial.js against a stubbed mp.
//   node tests/nighteye-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

delete globalThis.__dboRacialState;
const { RACE_IDS } = require(path.join(SERVER, 'racial.js'));
const state = {};
const mp = {
  get: (id, k) => {
    const s = state[id] || {};
    if (k === 'appearance') return s.race ? { raceId: s.race } : null;
    if (k === 'private.beast') return s.beast || null;
    if (k === 'isDead') return !!s.dead;
    if (k === 'percentages') return { health: 1, magicka: 1, stamina: 1 };
    if (k === 'worldOrCellDesc') return '3c:Skyrim.esm';
    if (k === 'pos') return [0, 0, 0];
    return (s.props || {})[k];
  },
  set: (id, k, v) => { state[id] = state[id] || {}; state[id].props = state[id].props || {}; state[id].props[k] = v; },
  getIdFromDesc: () => 0, getDescFromId: (id) => `${id.toString(16)}:Skyrim.esm`, getServerSettings: () => ({}),
};
const packets = [];
const told = [];
const caps = new Map();
let online = [];
const R = require(path.join(SERVER, 'racial.js'))({
  mp, log: () => {}, personal: (a, t) => told.push([a, t]), display: (a) => String(a), recordOf: () => null,
  giveItem: () => true, profileOf: (a) => (a < 1000 ? a : -1), every: () => {}, onlineActors: () => online.slice(),
  weaponHandsOf: () => 1, sourceResistsOf: () => [], gmstFloat: () => 0, cfg: { racial: { enabled: true, overhaul: true } },
  sendPacket: (a, p) => { if (!online.includes(a)) return false; packets.push([a, p]); return true; },
  hasUiCap: (a, cap) => !!caps.get(a) && caps.get(a).has(cap),
});
const eye = (a) => packets.filter(([x, p]) => x === a && p.customPacketType === 'dboNightEye').map(([, p]) => p);
const anyEye = () => packets.filter(([, p]) => p.customPacketType === 'dboNightEye');
const clear = () => { packets.length = 0; told.length = 0; };
const player = (id, race, vampire = false, cap = true) => {
  state[id] = { race: RACE_IDS[race][vampire ? 1 : 0] };
  if (!online.includes(id)) online.push(id);
  caps.set(id, new Set(cap ? ['bank', 'journal', 'nightEye'] : ['bank', 'journal']));
};
const KHAJIIT = 1, VAMP = 2, OLD = 3, NORD = 4, WATCHER = 5, NPC = 1001;
player(KHAJIIT, 'khajiit'); player(VAMP, 'khajiit', true); player(OLD, 'khajiit', false, false); player(NORD, 'nord'); player(WATCHER, 'khajiit');
state[NPC] = { race: RACE_IDS.khajiit[0] };

let now = 10_000_000;
// ---- who may call it ----
check('the default: Night Eye, 60 s, a 20-minute wait, drawn by the client (no clientOnly)',
  R.config.khajiit.power.name === 'Night Eye' && R.config.khajiit.power.seconds === 60 && R.config.khajiit.power.cooldownHours === 1 / 3
  && R.config.khajiit.power.clientOnly !== true && R.config.khajiit.power.clientCap === 'nightEye' && R.config.khajiit.power.view === 'nightEye');
const v0 = R.powerView(KHAJIIT, now);
check('a Khajiit on a new client: ready, with what it does and its wait', v0 && v0.ready === true && v0.clientOnly === false && v0.effect === 'you see in the dark' && v0.cooldownHours === 1 / 3, v0);
check('a Khajiit on an old client (no nightEye cap): a later update, not ready', R.powerView(OLD, now).clientOnly === true && R.powerView(OLD, now).ready === false && /later update/.test(R.statusLine(OLD, now)));
const old = R.usePower(OLD, now);
check('...and refused with "comes with a later update", nothing sent, nothing stored', !old.ok && /comes with a later update/.test(old.text) && !eye(OLD).length && !(state[OLD].props || {})['private.racialPower'], old);
check('a Nord has Battle Cry, not Night Eye', R.powerView(NORD, now).name === 'Battle Cry');
check('an NPC Khajiit has no power', R.powerView(NPC, now) === null && R.usePower(NPC, now).ok === false);

// ---- first sight: every client with the cap is told once where it stands ----
R.powerTick(now);
check('first tick: each new client is told "off" once', eye(KHAJIIT).length === 1 && eye(KHAJIIT)[0].on === false && eye(NORD).length === 1 && !eye(OLD).length, anyEye());
clear(); R.powerTick(now + 1000);
check('...and then nothing while nothing changes', anyEye().length === 0);

// ---- use ----
clear();
const u = R.usePower(KHAJIIT, now);
const st = state[KHAJIIT].props['private.racialPower'];
check('a Khajiit calls it: ok, 60 s, the wait 20 minutes', u.ok && st.race === 'khajiit' && st.activeUntil - st.usedAt === 60000 && st.readyAt - st.usedAt === 20 * 60000, [u, st]);
check('...its own client is told on at once with 60 s', eye(KHAJIIT).length === 1 && eye(KHAJIIT)[0].on === true && eye(KHAJIIT)[0].seconds === 60, eye(KHAJIIT));
check('...and nobody else is (no relay to the Khajiit watching, the Nord or the old client)', anyEye().length === 1);
check('...no spell is cast on anyone for it (no dboCastSelf) and no glow sent', !packets.some(([, p]) => p.customPacketType === 'dboCastSelf' || p.customPacketType === 'dboGlow'));
check('called again while on: refused', !R.usePower(KHAJIIT, now + 1000).ok);
clear(); R.powerTick(now + 2000);
check('ticks while it lasts send nothing more', anyEye().length === 0);
const vu = R.powerView(KHAJIIT, now + 2000);
check('the journal\'s view: upon you, not ready', vu.activeUntil === st.activeUntil && vu.ready === false && /upon you/.test(R.statusLine(KHAJIIT, now + 2000)));
check('the HUD countdown', R.hudField(KHAJIIT, now + 2000).name === 'Night Eye');

// ---- relog while it lasts ----
clear();
globalThis.__dboRacialLeave(KHAJIIT);
online = online.filter((x) => x !== KHAJIIT); caps.delete(KHAJIIT);
R.powerTick(now + 5000);
check('logged out: nothing is sent to an actor offline', eye(KHAJIIT).length === 0);
online.push(KHAJIIT);
R.powerTick(now + 6000);
check('logged in, before the UI said it draws it: nothing yet', eye(KHAJIIT).length === 0);
caps.set(KHAJIIT, new Set(['nightEye']));
R.powerTick(now + 7000);
check('logged in with the cap while it lasts: on again, with the 53 s left', eye(KHAJIIT).length === 1 && eye(KHAJIIT)[0].on === true && eye(KHAJIIT)[0].seconds === 53, eye(KHAJIIT));
check('the relog neither reset the wait nor ended it', state[KHAJIIT].props['private.racialPower'].readyAt === st.readyAt && state[KHAJIIT].props['private.racialPower'].activeUntil === st.activeUntil);

// ---- the end ----
clear(); R.powerTick(now + 60000);
check('at its end: off, to its own client only, and "Night Eye fades."', eye(KHAJIIT).length === 1 && eye(KHAJIIT)[0].on === false && anyEye().length === 1 && told.some(([a, t]) => a === KHAJIIT && t === 'Night Eye fades.'), [anyEye(), told]);
clear(); R.powerTick(now + 61000);
check('...once', anyEye().length === 0);
check('the wait: refused until 20 minutes after the use', /returns in/.test(R.usePower(KHAJIIT, now + 61000).text) && !R.powerView(KHAJIIT, now + 61000).ready);
clear();
check('after 20 minutes: called again, on again', R.usePower(KHAJIIT, now + 20 * 60000 + 1).ok && eye(KHAJIIT).length === 1 && eye(KHAJIIT)[0].on === true);
let t = now + 20 * 60000 + 1;

// ---- death ends it, the wait stays ----
clear(); state[KHAJIIT].dead = true; R.powerTick(t + 5000);
check('death: off at once', eye(KHAJIIT).length === 1 && eye(KHAJIIT)[0].on === false, eye(KHAJIIT));
check('...the power has ended (no countdown) and the wait stays', R.hudField(KHAJIIT, t + 5000) === null && state[KHAJIIT].props['private.racialPower'].readyAt === t + 20 * 60000);
state[KHAJIIT].dead = false; clear(); R.powerTick(t + 10000);
check('...and it does not come back on revival', anyEye().length === 0 && !R.usePower(KHAJIIT, t + 10000).ok);

// ---- the vampire Khajiit; a beast form ----
clear();
check('a vampire Khajiit calls it too', R.usePower(VAMP, t).ok && eye(VAMP).length === 1 && eye(VAMP)[0].on === true);
state[VAMP].beast = { form: 'vampireLord' }; clear(); R.powerTick(t + 1000);
check('a beast form: off', eye(VAMP).length === 1 && eye(VAMP)[0].on === false);
check('...and none can be called in it', /beast/.test(R.usePower(VAMP, t + 1000).text));
delete state[VAMP].beast;

// ---- a change of race ----
clear(); state[VAMP].race = RACE_IDS.khajiit[1];
const W = R.usePower(WATCHER, t);
clear(); state[WATCHER].race = RACE_IDS.nord[0]; R.powerTick(t + 1000);
check('a change of race while it lasts: off', W.ok && eye(WATCHER).length === 1 && eye(WATCHER)[0].on === false, eye(WATCHER));

// ---- a character switch: the new character has none ----
clear();
const SWITCH = 6; player(SWITCH, 'breton'); R.powerTick(t + 2000);
check('a character without it, first seen: off (the client takes off any left from the last one)', eye(SWITCH).length === 1 && eye(SWITCH)[0].on === false);

// ---- with the overhaul off: nothing ----
delete globalThis.__dboRacialState;
const OFF = require(path.join(SERVER, 'racial.js'))({ mp, log: () => {}, personal: () => {}, display: String, recordOf: () => null, giveItem: () => true,
  profileOf: (a) => (a < 1000 ? a : -1), every: () => {}, onlineActors: () => online.slice(), weaponHandsOf: () => 1, sourceResistsOf: () => [],
  gmstFloat: () => 0, cfg: { racial: { enabled: true, overhaul: false } }, sendPacket: (a, p) => { packets.push([a, p]); return true; }, hasUiCap: () => true });
clear(); OFF.powerTick(t);
check('the overhaul off: no power and every client is told off once (harmless)', OFF.powerView(KHAJIIT) === null && anyEye().every(([, p]) => p.on === false));
// a gamemode without hasUiCap (older): nobody has the cap
delete globalThis.__dboRacialState;
const NOCAP = require(path.join(SERVER, 'racial.js'))({ mp, log: () => {}, personal: () => {}, display: String, recordOf: () => null, giveItem: () => true,
  profileOf: (a) => (a < 1000 ? a : -1), every: () => {}, onlineActors: () => online.slice(), weaponHandsOf: () => 1, sourceResistsOf: () => [],
  gmstFloat: () => 0, cfg: { racial: { enabled: true, overhaul: true } }, sendPacket: (a, p) => { packets.push([a, p]); return true; } });
state[KHAJIIT].props['private.racialPower'] = {};
check('without the reader (an older gamemode): refused as a later update', /later update/.test(NOCAP.usePower(KHAJIIT).text));

// ---- the wiring ----
const gm = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8');
check('gamemode.js gives racial.js the uiCaps reader', /require\(RACIAL_JS\)\(\{[^}]*\bhasUiCap\b[^}]*\}\)/.test(gm));
check('gamemode.js forgets the actor at logout (__dboRacialLeave)', /'__dboRacialLeave'\]\)/.test(gm));
check('the journal\'s button calls usePower (journal.js journalAction racialPower)', /racialPower: \(a\) => \(typeof globalThis.__dboRacialPowerUse/.test(fs.readFileSync(path.join(SERVER, 'journal.js'), 'utf8')));

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
