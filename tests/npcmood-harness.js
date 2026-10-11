// Scripted test for server\npcmood.js with a mock gamemode api: a Harmony or Mayhem hit on a living NPC sends dboNpcMood
// to its host, players and the dead are never sent one, a re-hit refreshes the time and the other blade switches the
// mode, a new host is sent the time left, an expired mood is dropped, the config flag turns it off, and a hot reload
// keeps one hit delegate and one timer. Also checks the wiring in gamemode.js, the config default and the patch note.
// Run it from this folder's parent with
//
//   node tests/npcmood-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NPCMOOD = path.join(ROOT, 'npcmood.js');

let failures = 0;
const check = (label, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail !== undefined ? '   ' + JSON.stringify(detail) : ''}`); if (!ok) failures++; };

const HARMONY = 0x2401cd88, MAYHEM = 0x2401cd8a, IRON = 0x00012eb7;
const NPC = 0xff000100, NPC2 = 0xff000101, DEAD = 0xff000102, PLAYER = 0xff000014, P2 = 0xff000015, GONE = 0xff000999;
const forms = new Map([[NPC, {}], [NPC2, {}], [DEAD, { isDead: true }], [PLAYER, { profileId: 1 }], [P2, { profileId: 2 }]]);
const hosters = new Map([[NPC, PLAYER], [NPC2, PLAYER], [DEAD, PLAYER]]);
const descs = { '1cd88:DragonBreak Hub.esp': HARMONY, '1cd8a:DragonBreak Hub.esp': MAYHEM };
let now = 5000000; Date.now = () => now;
const sent = [];
let descLookups = 0;
const mp = {
  get: (id, p) => { const f = forms.get(id); if (!f) throw new Error('no form'); return f[p]; },
  getHoster: (id) => hosters.get(id) || 0,
  getIdFromDesc: (d) => { descLookups++; if (!(d in descs)) throw new Error('no such plugin'); return descs[d]; },
};
const timers = new Map();
const cfg = { npcMood: { enabled: true, seconds: 20 } };
const api = {
  mp, log: () => {}, cfg,
  every: (n, ms, f) => timers.set(n, f),
  profileOf: (id) => { const f = forms.get(id); return f && f.profileId !== undefined ? f.profileId : -1; },
  userOf: (id) => (id === PLAYER ? 0 : id === P2 ? 1 : -1),
  sendPacket: (a, payload) => { sent.push({ to: a, ...payload }); return true; },
};
const load = () => { delete require.cache[NPCMOOD]; return require(NPCMOOD)(api); };
delete globalThis.__dboNpcMood;
let mod = load();
const hit = (agg, tgt, src) => globalThis.__dboNpcMoodHit(agg, tgt, src);
const tick = () => timers.get('npcMood')();
const last = () => sent[sent.length - 1];

// Trigger
hit(PLAYER, NPC, HARMONY);
check('a Harmony hit on an NPC sends calm for 20 s to its host', sent.length === 1 && last().to === PLAYER && last().customPacketType === 'dboNpcMood' && last().refId === NPC && last().mode === 'calm' && last().seconds === 20, sent);
check('the blade ids come from the plugin name', mod.bladeMode(HARMONY) === 'calm' && mod.bladeMode(MAYHEM) === 'frenzy' && mod.bladeMode(IRON) === '');
hit(PLAYER, NPC2, IRON);
check('another weapon sends nothing', sent.length === 1);

// Player exclusion and the dead
hit(PLAYER, P2, HARMONY); hit(P2, PLAYER, MAYHEM);
check('a player hit by either blade is never sent a mood', sent.length === 1 && !mod.state.moods.has(P2) && !mod.state.moods.has(PLAYER));
hit(PLAYER, DEAD, MAYHEM);
check('a dead NPC is ignored', sent.length === 1 && !mod.state.moods.has(DEAD));
hit(PLAYER, GONE, MAYHEM);
check('a target that no longer exists is ignored', sent.length === 1 && !mod.state.moods.has(GONE));
hit(NPC, NPC, HARMONY);
check('a self hit is ignored', sent.length === 1);

// Refresh and mode switch
now += 8000;
hit(PLAYER, NPC, HARMONY);
check('a re-hit refreshes 20 s', sent.length === 2 && last().mode === 'calm' && last().seconds === 20 && mod.state.moods.get(NPC).until === now + 20000);
now += 3000;
hit(PLAYER, NPC, MAYHEM);
check('a Mayhem hit switches the mode to frenzy for 20 s', sent.length === 3 && last().mode === 'frenzy' && last().seconds === 20 && mod.state.moods.get(NPC).mode === 'frenzy');

// Host change
tick();
check('a tick with the same host sends nothing', sent.length === 3);
now += 5000;
hosters.set(NPC, P2);
tick();
check('a new host is sent the time left', sent.length === 4 && last().to === P2 && last().mode === 'frenzy' && last().seconds === 15, last());
tick();
check('...once', sent.length === 4);
hosters.delete(NPC); tick();
check('no host: nothing to send', sent.length === 4);
now += 1000; hosters.set(NPC, P2); tick();
check('the same host taking it back after nobody is sent it again', sent.length === 5 && last().to === P2 && last().seconds === 14, last());
// A hit on an unhosted NPC is kept and sent when a host appears
hosters.delete(NPC2);
hit(PLAYER, NPC2, HARMONY);
check('an unhosted NPC is remembered, nothing sent yet', sent.length === 5 && mod.state.moods.has(NPC2));
now += 2000; hosters.set(NPC2, PLAYER); tick();
check('...and its first host gets the time left', sent.length === 6 && last().to === PLAYER && last().refId === NPC2 && last().mode === 'calm' && last().seconds === 18, last());

// Death and expiry
forms.get(NPC2).isDead = true; tick();
check('an NPC that died is dropped', !mod.state.moods.has(NPC2));
forms.get(NPC2).isDead = false;
now += 14001; tick();
check('an expired mood is dropped and nothing is sent', !mod.state.moods.has(NPC) && sent.length === 6);
hosters.set(NPC, PLAYER); tick();
check('...a later host change sends nothing', sent.length === 6);

// Config
cfg.npcMood.enabled = false;
hit(PLAYER, NPC, HARMONY);
check('npcMood.enabled false: nothing', sent.length === 6 && !mod.state.moods.has(NPC));
cfg.npcMood = { seconds: 5 };
hit(PLAYER, NPC, HARMONY);
check('enabled defaults to true, seconds from config', sent.length === 7 && last().seconds === 5);
delete cfg.npcMood;
hit(PLAYER, NPC, MAYHEM);
check('no npcMood block: on, 20 s', sent.length === 8 && last().seconds === 20 && last().mode === 'frenzy');

// Hot reload: one delegate, one timer, the moods kept
const before = sent.length;
const lookups = descLookups;
mod = load(); mod = load();
check('a reload keeps the moods', mod.state.moods.has(NPC) && mod.state.moods.get(NPC).mode === 'frenzy');
check('one timer under one name', timers.size === 1 && timers.has('npcMood'));
hit(PLAYER, NPC, HARMONY);
check('a hit after two reloads sends one packet', sent.length === before + 1 && last().mode === 'calm');
check('the blade ids are resolved again after a reload', descLookups > lookups);
// A reload over a state built without the Map (an older shape)
globalThis.__dboNpcMood = {};
mod = load();
hit(PLAYER, NPC2, HARMONY);
check('a reload over an old state shape still works', mod.state.moods instanceof Map && mod.state.moods.has(NPC2));

// A load order without the Hub
delete descs['1cd88:DragonBreak Hub.esp']; delete descs['1cd8a:DragonBreak Hub.esp'];
mod = load();
const n = sent.length;
hit(PLAYER, NPC, HARMONY);
check('without the Hub nothing triggers and nothing throws', sent.length === n);

// Wiring
const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
const hook = /const hitDamageHook = \(aggressorId, targetId, sourceId, damage, \.\.\.rest\) => \{([\s\S]*?)\n\};/.exec(gm);
check('gamemode.js onHitDamage calls the delegate with the source id', !!hook && /globalThis\.__dboNpcMoodHit\(agg, tgt, Number\(sourceId\) >>> 0\)/.test(hook[1]));
check('gamemode.js loads npcmood.js uncached with sendPacket', /path\.resolve\('npcmood\.js'\)[\s\S]{0,120}delete require\.cache\[NPCMOOD_JS\][\s\S]{0,120}require\(NPCMOOD_JS\)\(\{[^}]*sendPacket[^}]*\}\)/.test(gm));
check('npcmood.js registers no mp.on listener', !/mp\.on\(/.test(fs.readFileSync(NPCMOOD, 'utf8')));
const conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
check('gamemode-config npcMood.enabled is true, 20 s', !!conf.npcMood && conf.npcMood.enabled === true && conf.npcMood.seconds === 20);
const notes = JSON.parse(fs.readFileSync(path.join(ROOT, 'patch-notes.json'), 'utf8'));
const note = notes.find((x) => /Harmony/.test(JSON.stringify(x)) && /Mayhem/.test(JSON.stringify(x)));
check('patch note, dated SHIP_DATE or a date', !!note && (note.date === 'SHIP_DATE' || /^\d{4}-\d{2}-\d{2}$/.test(note.date)), note && note.date);

console.log(failures ? `${failures} FAILED` : 'all checks passed');
process.exit(failures ? 1 : 0);
