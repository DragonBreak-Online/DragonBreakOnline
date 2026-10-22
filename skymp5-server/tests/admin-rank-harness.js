// Scripted test for the F7 panel's rank rule (22 Oct, the review of rank-typed-1022): kick, ban, temp ban, ip ban, kill and
// delete act only on an account below the admin's own rank, never on their own, and an account whose rank cannot be read is
// refused, the rule typed /kick and /discipline follow in the gamemode (rankRefusalOf). An account's rank is its highest staff
// tier over all its characters, online or not, and the admin profiles. Every rank asks every action on every kind of account:
// what the rule refuses gets a refusal and an admin log line the player log reads as refused, and nothing happens (no kick,
// no ban, no death, no delete); what it allows goes through as before, or stops at the rank's caps as before.
// It bundles adminSystem.ts with esbuild (settings, NPC spawns, mastery and the ban store stubbed) and fakes the native
// server. Run it from skymp5-server with node_modules present:
//
//   node tests/admin-rank-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-jake-adminrank-'));

const stubSources = {
  '../settings': 'module.exports = { Settings: { get: async () => globalThis.__admin.settings } };',
  './npcSpawnSystem': 'module.exports = { NpcSpawnSystem: class {} };',
  './masterySystem': 'module.exports = { MasterySystem: class {}, MAX_GRANT: 0 };',
  './adminBans': `module.exports = { AdminBans: class {
    list() { return []; }
    add(b) { const ban = Object.assign({ id: 'b' + (globalThis.__admin.bans.length + 1), at: 0 }, b); globalThis.__admin.bans.push(ban); return ban; }
    find() { return null; }
    remove() { return null; } } };`,
};
const stubFilter = new RegExp('^(' + Object.keys(stubSources).map((k) => k.replace(/[./-]/g, '\\$&')).join('|') + ')$');

let failures = 0, checks = 0;
const check = (name, ok, got) => { checks++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 600) : ''}`); if (!ok) failures++; };

// The staff, one per rank, online: an Owner by the admin profiles, a Developer, a Lead GM, a GM
const STAFF = {
  senior: { userId: 1, actorId: 0xff000011, profileId: 11, roles: [], rank: 5 },
  developer: { userId: 2, actorId: 0xff000012, profileId: 12, roles: ['role-dev'], rank: 4 },
  leadgm: { userId: 3, actorId: 0xff000013, profileId: 13, roles: ['role-lead'], rank: 3 },
  gm: { userId: 4, actorId: 0xff000014, profileId: 14, roles: ['role-gm'], rank: 2 },
};
// The accounts acted on, each online on one character. Kate and Devon play characters with no staff role stamped; their
// accounts are an Owner's and a Developer's by another character's stamp (offline)
const TARGETS = {
  mira: { userId: 20, actorId: 0xff000020, profileId: 20, name: 'Mira', roles: [], rank: 0 },
  tess: { userId: 21, actorId: 0xff000021, profileId: 21, name: 'Tess', roles: ['role-trial'], rank: 1 },
  gary: { userId: 22, actorId: 0xff000022, profileId: 22, name: 'Gary', roles: ['role-gm'], rank: 2 },
  lena: { userId: 23, actorId: 0xff000023, profileId: 23, name: 'Lena', roles: ['role-lead'], rank: 3 },
  devon: { userId: 24, actorId: 0xff000024, profileId: 24, name: 'Devon', roles: [], rank: 4, alt: ['role-dev'] },
  kate: { userId: 25, actorId: 0xff000025, profileId: 25, name: 'Kate', roles: [], rank: 5, alt: ['role-senior', 'role-patron'] },
  olaf: { userId: 26, actorId: 0xff000026, profileId: 26, name: 'Olaf', roles: ['role-senior'], rank: 5 },
  ada: { userId: 27, actorId: 0xff000027, profileId: 27, name: 'Ada', roles: [], rank: 5 },
};
// What each rank may do at all (TIER_CAPS and SPAWN_ACTIONS): a GM kicks; a Lead GM kicks and kills; Developers and Owners all
const CAPS = { senior: ['kick', 'ban', 'tempBan', 'ipBan', 'kill', 'deleteCharacter'], developer: ['kick', 'ban', 'tempBan', 'ipBan', 'kill', 'deleteCharacter'],
  leadgm: ['kick', 'kill'], gm: ['kick'] };
const ACTIONS = ['kick', 'ban', 'tempBan', 'ipBan', 'kill', 'deleteCharacter'];

const users = new Map();
let props = {};
let packets = [], logs = [], serverLogs = [], kicks = [], disabled = [], posts = [], timers = [];
const clear = () => { packets = []; logs = []; serverLogs = []; kicks = []; disabled = []; posts = []; timers = []; globalThis.__admin.bans = []; };
const setup = () => {
  users.clear(); props = {};
  for (const [tier, s] of Object.entries(STAFF)) { users.set(s.userId, s.actorId); props[s.actorId] = { appearance: { name: `Staff ${tier}` }, profileId: s.profileId, 'private.discordRoles': s.roles }; }
  for (const t of Object.values(TARGETS)) {
    users.set(t.userId, t.actorId);
    props[t.actorId] = { appearance: { name: t.name }, profileId: t.profileId, 'private.discordRoles': t.roles };
    if (t.alt) props[t.actorId + 0x100] = { appearance: { name: `${t.name} Old` }, profileId: t.profileId, 'private.discordRoles': t.alt };
  }
};
const mp = {
  isConnected: (u) => users.has(u),
  getUserActor: (u) => users.get(u) || 0,
  get: (a, k) => { if (!props[a]) throw new Error(`no actor ${a}`); return props[a][k]; },
  set: (a, k, v) => { (props[a] = props[a] || {})[k] = v; },
  getActorsByProfileId: (pid) => Object.keys(props).map(Number).filter((a) => props[a].profileId === pid),
  getUserIp: (u) => `203.0.113.${u}:50000`,
  getUserGuid: (u) => `guid-${u}`,
  getPrometheusMetrics: () => '',
  sendCustomPacket: (u, s) => packets.push({ u, p: JSON.parse(s) }),
  setEnabled: (a, on) => { if (!on) disabled.push(a >>> 0); },
  kick: (u) => kicks.push(u),
  destroyActor: (a) => { delete props[a]; },
  getIdFromDesc: () => 0,
  getDescFromId: (id) => `${(id >>> 0).toString(16)}:Test.esp`,
};

globalThis.__admin = {
  bans: [],
  settings: {
    name: 'test', master: 'http://master.test', masterKey: 'KEY',
    allSettings: { masterApiAuthToken: 't', adminProfileIds: [11, 27], adminRoles: { senior: ['role-senior'], developer: ['role-dev'], leadgm: ['role-lead'], gm: ['role-gm'], trialgm: ['role-trial'] } },
  },
};
globalThis.fetch = async (url, o) => { if (o && o.method === 'POST') posts.push(JSON.parse(o.body)); return { ok: true, status: 200, json: async () => ({ players: [] }) }; };
globalThis.__alduinakAdminLog = (text) => logs.push(String(text));
// The player log's own reading of an admin log line (playerlog-rules.js ADMINLOG): "was refused" right after the staff part
const READ_AS_REFUSED = /^profile \d+(?: \([a-z]+\))? was refused /;

(async () => {
  await esbuild.build({
    entryPoints: [path.join(root, 'ts', 'systems', 'adminSystem.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'admin.js'), logLevel: 'error',
    plugins: [{
      name: 'stubs',
      setup(b) {
        b.onResolve({ filter: stubFilter }, (a) => ({ path: a.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: stubSources[a.path], loader: 'js' }));
      },
    }],
  });
  const cwd = process.cwd();
  process.chdir(out);
  const { AdminSystem } = require(path.join(out, 'admin.js'));
  const sys = new AdminSystem((...a) => serverLogs.push(a.join(' ')), { listZones: () => [] }, { summaryOf: () => null });
  const ctx = { svr: mp, gm: new EventEmitter() };
  setup();
  await sys.initAsync(ctx);
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn, ms, ...a) => (ms === 1500 ? (timers.push(fn), 0) : realSetTimeout(fn, ms, ...a));

  const act = async (s, action, t, extra = {}) => {
    clear();
    sys.customPacket(s.userId, 'adminAction', Object.assign({ customPacketType: 'adminAction', action, target: t.actorId.toString(16), hours: 2, reason: 'test' }, extra), ctx);
    await new Promise((r) => realSetImmediate(r));
    const results = packets.filter((x) => x.u === s.userId && x.p.customPacketType === 'adminActionResult').map((x) => x.p);
    return { results, happened: kicks.length > 0 || disabled.length > 0 || posts.length > 0 || globalThis.__admin.bans.length > 0 || props[t.actorId].isDead === true || timers.length > 0 };
  };
  const realSetImmediate = global.setImmediate;

  // ---- every rank, every action, every kind of account ----
  const wrong = [];
  let rankRefusals = 0, allowed = 0, capped = 0;
  for (const [tier, s] of Object.entries(STAFF)) {
    for (const action of ACTIONS) {
      for (const [key, t] of Object.entries(TARGETS)) {
        setup();
        const r = await act(s, action, t);
        const may = CAPS[tier].includes(action);
        const below = t.rank < s.rank;
        if (may && below) {
          allowed++;
          if (!r.happened || !r.results.some((x) => x.ok === true)) wrong.push({ tier, action, key, want: 'done', r });
        } else if (may) {
          rankRefusals++;
          const line = logs.find((l) => / was refused /.test(l)) || '';
          if (r.happened || !r.results.some((x) => x.ok === false && /staff account of your rank or higher/.test(x.text))
            || line !== `profile ${s.profileId} (${tier}) was refused ${action} on ${t.name} (profile ${t.profileId}) (staff rank)` || !READ_AS_REFUSED.test(line)) wrong.push({ tier, action, key, want: 'rank refusal', r, logs });
        } else {
          capped++;
          // one admin log line read as refused, so the player log takes back the packet's leave mark (review of 22 Oct, L2)
          if (r.happened || !r.results.some((x) => x.ok === false) || logs.filter((l) => READ_AS_REFUSED.test(l)).length !== 1) wrong.push({ tier, action, key, want: 'refused by caps, one refused line', r, logs });
        }
      }
    }
  }
  check(`each rank's ${allowed} allowed actions on accounts below it go through, its ${rankRefusals} on accounts of its rank or higher are refused with a log line read as refused, and nothing happens (${capped} stop at the rank's caps as before)`,
    !wrong.length && allowed > 0 && rankRefusals > 0, wrong.slice(0, 4));
  {
    // The named findings, one by one
    setup();
    let r = await act(STAFF.gm, 'kick', TARGETS.gary);
    check('a GM cannot kick another GM from the panel (the kick confirmed in the review)', !r.happened && r.results[0] && r.results[0].text === 'Gary is on a staff account of your rank or higher. Take it to someone above that rank, or to the Owners.', r);
    setup();
    r = await act(STAFF.leadgm, 'kill', TARGETS.kate);
    check("a Lead GM cannot kill an Owner playing a character with no roles stamped: the account's other character counts", !r.happened && props[TARGETS.kate.actorId].isDead !== true, r);
    setup();
    r = await act(STAFF.developer, 'ban', TARGETS.olaf);
    check('a Developer cannot ban an Owner: no ban is posted to the backend', !r.happened && posts.length === 0, { r, posts });
    setup();
    r = await act(STAFF.developer, 'tempBan', TARGETS.devon);
    check('...nor temp-ban another Developer\'s account, nor ip-ban it', !r.happened && globalThis.__admin.bans.length === 0 && !(await act(STAFF.developer, 'ipBan', TARGETS.devon)).happened, r);
    setup();
    r = await act(STAFF.senior, 'deleteCharacter', TARGETS.ada);
    check('an Owner cannot delete a character of another Owner (the admin profiles)', !r.happened && timers.length === 0 && !!props[TARGETS.ada.actorId], r);
    setup();
    r = await act(STAFF.senior, 'kick', TARGETS.devon);
    const r2 = await act(STAFF.developer, 'kill', TARGETS.lena);
    check('an Owner kicks a Developer, a Developer kills a Lead GM (below them), as before', r.happened && r2.happened && props[TARGETS.lena.actorId].isDead === true, { r, r2 });
    setup();
    r = await act(STAFF.gm, 'kick', TARGETS.tess);
    const r3 = await act(STAFF.gm, 'kick', TARGETS.mira);
    check('a GM kicks a Trial GM and a player, as before', r.happened && r3.happened, { r, r3 });
  }

  // ---- never on one's own account ----
  {
    const self = STAFF.developer;
    const asTarget = { userId: self.userId, actorId: self.actorId, profileId: self.profileId, name: 'Staff developer' };
    const wrongSelf = [];
    for (const action of ACTIONS) {
      setup();
      const r = await act(self, action, asTarget);
      const line = logs.find((l) => / was refused /.test(l)) || '';
      if (r.happened || !r.results.some((x) => x.ok === false && x.text === 'Not on your own account') || !/ \(own account\)$/.test(line) || !READ_AS_REFUSED.test(line)) wrongSelf.push({ action, r, logs });
    }
    check('nobody acts on their own account from the panel: each action refused, nothing done, a log line read as refused', !wrongSelf.length, wrongSelf.slice(0, 3));
  }

  // ---- fails closed: the account's characters cannot be listed, or the target's profile cannot be read ----
  {
    setup();
    const realIdx = mp.getActorsByProfileId;
    mp.getActorsByProfileId = (pid) => { if (pid === 20) throw new Error('index gone'); return realIdx(pid); };
    const r = await act(STAFF.senior, 'kick', TARGETS.mira);
    mp.getActorsByProfileId = realIdx;
    check("an account whose characters cannot be listed is not kicked, and the server log says why", !r.happened && r.results[0] && r.results[0].text === "The staff rank of Mira's account could not be read, so nothing was done. Try again, or ask an Owner."
      && serverLogs.some((l) => /staff rank of profile 20 unreadable: Error: index gone/.test(l)) && logs.some((l) => / \(rank unreadable\)$/.test(l)), { r, serverLogs, logs });
    setup();
    delete props[TARGETS.mira.actorId].profileId;
    const r2 = await act(STAFF.senior, 'ban', TARGETS.mira);
    check('...nor one whose profile cannot be read (no ban posted)', !r2.happened && posts.length === 0 && r2.results[0] && /could not be read/.test(r2.results[0].text), r2);
  }

  // ---- every other refusal of a kick or a ban writes its refused line too (the player log clears the packet's mark by it) ----
  {
    const lines = [];
    const refusedLine = async (s, action, t, extra, why) => {
      setup();
      const r = await act(s, action, t, extra);
      await new Promise((res) => realSetImmediate(res));
      const l = logs.filter((x) => READ_AS_REFUSED.test(x));
      lines.push({ action, why, ok: !r.happened && l.length === 1 && l[0] === `profile ${s.profileId} (${Object.keys(STAFF).find((k) => STAFF[k] === s)}) was refused ${action} on ${t.name} (profile ${t.profileId}) (${why})`, l });
    };
    await refusedLine(STAFF.developer, 'tempBan', TARGETS.mira, { hours: 0 }, 'ban length');
    const realIp = mp.getUserIp;
    mp.getUserIp = (u) => (u === TARGETS.mira.userId ? '10.10.10.1:50000' : realIp(u));
    await refusedLine(STAFF.developer, 'ipBan', TARGETS.mira, {}, 'ip bans off');
    mp.getUserIp = (u) => (u === TARGETS.mira.userId ? '' : realIp(u));
    await refusedLine(STAFF.developer, 'ipBan', TARGETS.mira, {}, 'ip unknown');
    mp.getUserIp = realIp;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, o) => (o && o.method === 'POST' ? { ok: false, status: 503, json: async () => ({}) } : realFetch(url, o));
    await refusedLine(STAFF.developer, 'ban', TARGETS.mira, {}, 'backend 503');
    globalThis.fetch = async (url, o) => { if (o && o.method === 'POST') throw new Error('down'); return realFetch(url, o); };
    await refusedLine(STAFF.developer, 'ban', TARGETS.mira, {}, 'backend unreachable');
    globalThis.fetch = realFetch;
    check('a ban length out of range, ip bans off, an unknown ip and a failed or unreachable backend each write one refused line naming the target, and nothing happens', lines.every((x) => x.ok), lines.filter((x) => !x.ok));
  }

  // ---- what the rule does not touch: teleport and summon still reach a higher rank ----
  {
    setup();
    const r = await act(STAFF.gm, 'teleportTo', TARGETS.olaf);
    check('teleporting to an Owner is no punishment: a GM still may', r.results.some((x) => x.ok === true && x.text === 'Teleported to Olaf'), r);
  }

  global.setTimeout = realSetTimeout;
  process.chdir(cwd);
  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED of ${checks}` : `\nall ${checks} checks passed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FAIL the harness threw', e); fs.rmSync(out, { recursive: true, force: true }); process.exit(1); });
