// Scripted test for server\elements.js with a mock gamemode api: a frost hit on a player sends one dboStatus chill with
// the config's slow, a hit from another element or a weapon sends nothing, a fast caster is held to minGapMs, the dead
// and the attacker themselves are never sent one, an NPC is sent nothing while frost.npc.enabled is false and its host
// is sent dboNpcChill when it is on, a host that is gone is skipped, and the config flag turns the whole thing off.
// Also checks the wiring in gamemode.js, the config default and that the slow stays inside what the client accepts.
// Run it from this folder's parent with
//
//   node tests/elements-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ELEMENTS = path.join(ROOT, 'elements.js');

let failures = 0;
const check = (label, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail !== undefined ? '   ' + JSON.stringify(detail) : ''}`); if (!ok) failures++; };

const FROSTBOLT = 0x0002dd29, FIREBOLT = 0x0002dd27, IRON = 0x00012eb7;
const PLAYER = 0xff000014, P2 = 0xff000015, NPC = 0xff000100, DEAD = 0xff000101, UNHOSTED = 0xff000102;
const forms = new Map([[PLAYER, { profileId: 1 }], [P2, { profileId: 2 }], [NPC, {}], [DEAD, { isDead: true }], [UNHOSTED, {}]]);
const hosters = new Map([[NPC, P2], [DEAD, P2], [UNHOSTED, 0]]);
// The elements of each source, as gamemode.js's fitsElement answers them from the MGEF resist values
const ELEMENT_OF = new Map([[FROSTBOLT, 'frost'], [FIREBOLT, 'fire']]);

let now = 5_000_000;
const sent = [];
const mp = {
  get: (id, p) => { const f = forms.get(id); if (!f) throw new Error('no form'); return f[p]; },
  getHoster: (id) => hosters.get(id) || 0,
};
const cfg = { elements: { enabled: true, minGapMs: 1500, frost: { player: { enabled: true, speedMult: -40, seconds: 6, text: 'The cold bites deep. You are slowed.' }, npc: { enabled: false, speedMult: -40, seconds: 6 } } } };
const api = {
  mp, log: () => {}, cfg,
  profileOf: (id) => { const f = forms.get(id); return f && f.profileId !== undefined ? f.profileId : -1; },
  userOf: () => -1,
  display: (id) => `#${id.toString(16)}`,
  sendPacket: (to, p) => { sent.push([to, p]); return true; },
  fitsElement: (element, src) => ELEMENT_OF.get(src >>> 0) === element,
};

delete globalThis.__dboElements;
delete require.cache[ELEMENTS];
const M = require(ELEMENTS);
const E = M(api);
const take = () => sent.splice(0);
const hit = (agg, tgt, src, at) => { now = at === undefined ? now : at; E.onHit(agg, tgt, src, now); };

// ---- the element of a source ----
check('a frost source is frost', E.elementOf(FROSTBOLT) === 'frost');
check('a fire source is not frost', E.elementOf(FIREBOLT) === 'fire');
check('a weapon has no element', E.elementOf(IRON) === '');

// ---- a player struck by frost ----
hit(P2, PLAYER, FROSTBOLT, 5_000_000);
const first = take();
check('one packet, to the player who was struck', first.length === 1 && first[0][0] === PLAYER, first);
check('...the chill the config asks for', JSON.stringify(first[0] && first[0][1])
  === '{"customPacketType":"dboStatus","kind":"chill","seconds":6,"speedMult":-40,"text":"The cold bites deep. You are slowed."}', first[0] && first[0][1]);

hit(P2, PLAYER, FROSTBOLT, 5_000_200);
check('a second hit a moment later sends nothing (minGapMs)', take().length === 0);
hit(P2, PLAYER, FROSTBOLT, 5_001_600);
check('...and one after the gap sends again', take().length === 1);

hit(P2, PLAYER, FIREBOLT, 5_010_000);
check('a fire hit sends nothing (only frost is configured)', take().length === 0);
hit(P2, PLAYER, IRON, 5_020_000);
check('a weapon hit sends nothing', take().length === 0);
hit(PLAYER, PLAYER, FROSTBOLT, 5_030_000);
check('a caster does not chill themselves', take().length === 0);
hit(P2, DEAD, FROSTBOLT, 5_040_000);
check('the dead are not chilled', take().length === 0);

// ---- an NPC: nothing until a client carries it ----
hit(P2, NPC, FROSTBOLT, 5_050_000);
check('an NPC is sent nothing while frost.npc.enabled is false', take().length === 0);
cfg.elements.frost.npc.enabled = true;
hit(P2, NPC, FROSTBOLT, 5_060_000);
const npcPacket = take();
check('with it on, the NPC\'s host is sent dboNpcChill for that ref', npcPacket.length === 1 && npcPacket[0][0] === P2
  && JSON.stringify(npcPacket[0][1]) === `{"customPacketType":"dboNpcChill","refId":${NPC},"seconds":6,"speedMult":-40}`, npcPacket);
hit(P2, UNHOSTED, FROSTBOLT, 5_070_000);
check('an NPC nobody hosts is skipped', take().length === 0);
cfg.elements.frost.npc.enabled = false;

// ---- the config flag ----
cfg.elements.enabled = false;
hit(P2, PLAYER, FROSTBOLT, 5_080_000);
check('enabled false sends nothing at all (the rollback)', take().length === 0);
cfg.elements.enabled = true;

// ---- what the client will accept ----
check('a slow is clamped into the client\'s range', (() => {
  const low = M.slowOf({ enabled: true, speedMult: -500, seconds: 9999 });
  const high = M.slowOf({ enabled: true, speedMult: 50, seconds: 6 });
  return low.speedMult === -90 && low.seconds === 60 && high === null;
})(), M.slowOf({ enabled: true, speedMult: -500, seconds: 9999 }));
check('a slow of nothing is no packet', M.slowOf({ enabled: true, speedMult: 0, seconds: 6 }) === null && M.slowOf({ enabled: false, speedMult: -40, seconds: 6 }) === null);
check('an element the config does not name falls back to the defaults', JSON.stringify(M.elementConf({}, 'frost').player.speedMult) === '-40');

// ---- a hot reload ----
const before = globalThis.__dboElementHit;
delete require.cache[ELEMENTS];
require(ELEMENTS)(api);
check('a reload replaces the one hit delegate', typeof globalThis.__dboElementHit === 'function' && globalThis.__dboElementHit !== before);
check('...and keeps what each victim was last sent (no flood after a reload)', globalThis.__dboElements.sentAt instanceof Map);

// ---- the wiring ----
const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
check('gamemode.js loads elements.js with fitsElement', /require\(ELEMENTS_JS\)\(\{[^}]*\bfitsElement\b[^}]*\}\)/.test(gm));
check('gamemode.js calls it on every hit', /globalThis\.__dboElementHit\(agg, tgt, Number\(sourceId\) >>> 0\)/.test(gm));
check('a failed load leaves no stale delegate', /elements\.js failed to load[\s\S]{0,80}__dboElementHit = null/.test(gm));
const conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
check('the config ships frost on for players and off for NPCs', conf.elements && conf.elements.enabled === true
  && conf.elements.frost.player.enabled === true && conf.elements.frost.npc.enabled === false, conf.elements && conf.elements.frost);
check('the config says how to roll it back', /ROLLBACK: enabled false/.test(String(conf.elements._comment || '')));

// ---- Restoration's sun on the undead (gamemode.js sunDamageMult, config elements.sun) ------------------------------
// The multiplier lives in gamemode.js beside the other damage factors, so the real code is sliced out and driven here,
// the way supernatural-weakness-harness.js drives blessingTargetMult.
{
  const GM = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
  const a0 = GM.indexOf('const SUN = Object.assign(');
  const END = '  return isUndead(tgt) ? Number(SUN.undeadMult) : 1;\n};';
  const b0 = GM.indexOf(END) + END.length;
  check('the sun block is where the harness expects it', a0 > 0 && b0 > a0);

  const SUNFIRE = 0x02003f52, VAMPSUN = 0x000ed09c, FIREBOLT2 = 0x0002dd27;
  const DRAUGR = 0xff000200, BANDIT = 0xff000201, PLAYER2 = 0xff000016;
  const DRAUGR_BASE = 0x0002d1de, BANDIT_BASE = 0x0001be1c, DRAUGR_RACE = 0x000d53ab, BANDIT_RACE = 0x00013746;
  const UNDEAD_KW = 0x0013796, NPC_KW = 0x0013794;
  // The records the real code walks: actor -> baseDesc -> NPC_ -> RNAM race -> RACE KWDA -> keyword editor ids
  const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
  const records = new Map([
    [DRAUGR_BASE, { record: { type: 'NPC_', fields: [{ type: 'RNAM', data: u32(DRAUGR_RACE) }] }, toGlobalRecordId: (x) => x }],
    [BANDIT_BASE, { record: { type: 'NPC_', fields: [{ type: 'RNAM', data: u32(BANDIT_RACE) }] }, toGlobalRecordId: (x) => x }],
    [DRAUGR_RACE, { record: { type: 'RACE', fields: [{ type: 'KWDA', data: new Uint8Array([...u32(NPC_KW), ...u32(UNDEAD_KW)]) }] }, toGlobalRecordId: (x) => x }],
    [BANDIT_RACE, { record: { type: 'RACE', fields: [{ type: 'KWDA', data: u32(NPC_KW) }] }, toGlobalRecordId: (x) => x }],
    [UNDEAD_KW, { record: { type: 'KYWD', editorId: 'ActorTypeUndead' } }],
    [NPC_KW, { record: { type: 'KYWD', editorId: 'ActorTypeNPC' } }],
  ]);
  const bases = new Map([[DRAUGR, DRAUGR_BASE], [BANDIT, BANDIT_BASE], [PLAYER2, 0]]);
  const descs = { '3f52:Dawnguard.esm': SUNFIRE, '10d8d:Dawnguard.esm': 0x02010d8d, '38b6:Dawnguard.esm': 0x020038b6,
    '38b5:Dawnguard.esm': 0x020038b5, '71df:Dawnguard.esm': 0x020071df, '15718:Dawnguard.esm': 0x02015718 };
  const gmp = {
    get: (id, p2) => { if (p2 !== 'baseDesc') throw new Error('unexpected ' + p2); const b = bases.get(id); if (b === undefined) throw new Error('no form'); return b ? `base${b}` : ''; },
    getIdFromDesc: (d) => { if (d in descs) return descs[d]; const m = /^base(\d+)$/.exec(String(d)); if (m) return Number(m[1]); throw new Error('no such desc'); },
  };
  const conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
  const G = new Function('mp', 'recordOf', 'fieldsOf', 'u32At', 'globalAt', 'profileOf', 'log', 'cfg',
    GM.slice(a0, b0) + '\nreturn { sunDamageMult, isUndead, SUN };')(
    gmp,
    (id) => records.get(id >>> 0) || null,
    (lr, type) => ((lr && lr.record && lr.record.fields) || []).filter((f) => f.type === type && f.data instanceof Uint8Array),
    (f, off) => (f && f.data.byteLength >= off + 4 ? new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getUint32(off, true) : 0),
    (lr, local) => { try { return local ? lr.toGlobalRecordId(local) >>> 0 : 0; } catch (e) { return 0; } },
    (id) => (id === PLAYER || id === PLAYER2 ? 1 : -1),
    () => {}, conf);

  check('a draugr is undead by its race\'s keyword', G.isUndead(DRAUGR) === true);
  check('a bandit is not', G.isUndead(BANDIT) === false);
  check('Sun Fire on a draugr is doubled', G.sunDamageMult(PLAYER, DRAUGR, SUNFIRE) === 2);
  check('...and on a bandit is not', G.sunDamageMult(PLAYER, BANDIT, SUNFIRE) === 1);
  check('a firebolt on a draugr is not (only the named sources)', G.sunDamageMult(PLAYER, DRAUGR, FIREBOLT2) === 1);
  check('the vampire sun penalty is not one of the sources (it burns our own players)', G.sunDamageMult(PLAYER, DRAUGR, VAMPSUN) === 1);
  check('an NPC\'s own sun hit is not scaled', G.sunDamageMult(DRAUGR, BANDIT, SUNFIRE) === 1);
  check('a hit on a player is never scaled', G.sunDamageMult(PLAYER, PLAYER2, SUNFIRE) === 1);
  check('all six surveyed sources resolve', Object.keys(descs).every((d) => G.sunDamageMult(PLAYER, DRAUGR, descs[d]) === 2));
  check('the config says how to roll it back', /ROLLBACK: enabled false/.test(String(conf.elements.sun._comment || '')));
  check('gamemode.js multiplies it into the hit', /mult \*= sunDamageMult\(agg, tgt, src\);/.test(GM));
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exitCode = failures ? 1 : 0;
