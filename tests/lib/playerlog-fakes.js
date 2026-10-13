// Fakes for the player log harnesses (tests/playerlog-*-harness.js): an mp with Map-backed properties and counted gets, an
// in-memory fs.promises whose writes can be slowed, stalled, shortened or failed, a manual every(), a manual setTimeout
// queue and a clock. Nothing here touches the disk or a real timer.
'use strict';

const spinFor = (us) => { const end = process.hrtime.bigint() + BigInt(Math.round(us * 1000)); while (process.hrtime.bigint() < end) { /* the native cost of a get */ } };

const makeMp = () => {
  const props = new Map();
  const records = new Map();
  const users = new Map();
  const S = { gets: 0, throwOn: null, spinUs: 0, log: [] };
  const desc = (id) => `${(id >>> 0).toString(16)}:Skyrim.esm`;
  const mp = {
    get(id, k) {
      S.gets++;
      if (S.spinUs) spinFor(S.spinUs);
      if (S.throwOn && S.throwOn(id, k)) throw new Error(`get ${k} failed`);
      const m = props.get(id >>> 0);
      const v = m ? m.get(k) : undefined;
      return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
    },
    set(id, k, v) { let m = props.get(id >>> 0); if (!m) props.set(id >>> 0, m = new Map()); m.set(k, v); },
    getActorsByProfileId(p) { const out = []; for (const [id, m] of props) if (m.get('profileId') === p) out.push(id); return out; },
    findFormsByPropertyValue(k, v) { const out = []; for (const [id, m] of props) if (m.get(k) === v) out.push(id); return out; },
    lookupEspmRecordById(id) { const r = records.get(id >>> 0); return r ? { record: r, toGlobalRecordId: (x) => x } : null; },
    getIdFromDesc(d) { const i = String(d).indexOf(':'); return parseInt(String(d).slice(0, i), 16) >>> 0; },
    getDescFromId(id) { return desc(id); },
    getUserActor(u) { return users.get(u) || 0; },
    getUserByActor(a) { for (const [u, x] of users) if (x === a) return u; return 65535; },
  };
  // a player: actor id, profile, name, tag, discord, place
  const player = (a, o) => {
    const x = Object.assign({ profile: 1, name: 'Rowan', tag: 'PGDB', discord: '337337773973569537', w: 'a764b:BSHeartland.esm', pos: [0, 0, 0], user: null, inv: [] }, o || {});
    mp.set(a, 'profileId', x.profile); mp.set(a, 'appearance', { name: x.name }); mp.set(a, 'private.charTag', x.tag);
    mp.set(a, 'private.indexed.tagKey', x.tag.toLowerCase()); mp.set(a, 'private.indexed.nameKey', x.name.toLowerCase());
    if (x.discord) mp.set(a, 'private.skympDiscordId', x.discord);
    mp.set(a, 'worldOrCellDesc', x.w); mp.set(a, 'pos', x.pos); mp.set(a, 'inventory', { entries: x.inv });
    mp.set(a, 'percentages', { health: 1, magicka: 1, stamina: 1 });
    if (x.user !== null) users.set(x.user, a);
    return a;
  };
  const npc = (a, edid, o) => { const base = (o && o.base) || 0x10000 + (a & 0xfff); records.set(base, { type: 'NPC_', editorId: edid, fields: [] }); mp.set(a, 'baseDesc', desc(base)); mp.set(a, 'profileId', -1); mp.set(a, 'percentages', { health: 1 }); if (o && o.owner) mp.set(a, 'ff_companionOf', o.owner); return a; };
  const record = (id, type, edid, extra) => { records.set(id >>> 0, Object.assign({ type, editorId: edid, fields: [] }, extra || {})); return id; };
  const ref = (id, baseId) => { mp.set(id, 'baseDesc', desc(baseId)); return id; };
  return { mp, props, records, users, S, player, npc, record, ref, desc };
};

// fs.promises in memory. ctl: { delayMs, stall: kinds stalled for ever, hold: kinds held until ctl.release(), shortBytes: at most
// this many per write, failAt: fail a write once this many bytes of the file have gone, failCode, freeGb }
const makeFs = () => {
  const files = new Map();
  const ctl = { stall: new Set(), hold: new Set(), held: [], shortBytes: 0, failAt: -1, failCode: 'EIO', freeGb: 50, pending: 0, maxPending: 0, calls: [], writes: 0 };
  // the calls held so far go through now
  ctl.release = () => { for (const go of ctl.held.splice(0)) go(); };
  const track = (kind, fn) => {
    ctl.calls.push(kind);
    if (ctl.stall.has(kind)) { ctl.pending++; ctl.maxPending = Math.max(ctl.maxPending, ctl.pending); return new Promise(() => {}); }
    if (ctl.hold.has(kind)) {
      ctl.pending++; ctl.maxPending = Math.max(ctl.maxPending, ctl.pending);
      return new Promise((res, rej) => ctl.held.push(() => { Promise.resolve().then(fn).then(res, rej).finally(() => { ctl.pending--; }); }));
    }
    ctl.pending++; ctl.maxPending = Math.max(ctl.maxPending, ctl.pending);
    return Promise.resolve().then(fn).finally(() => { ctl.pending--; });
  };
  const handle = (p) => ({
    write: (buf, off, len) => track('write', () => {
      ctl.writes++;
      const cur = files.get(p) || Buffer.alloc(0);
      let n = len;
      if (ctl.shortBytes > 0) n = Math.min(n, ctl.shortBytes);
      // as write(2): what fits is a short write; the next call, with no room left, fails and writes nothing
      if (ctl.failAt >= 0 && cur.length + n > ctl.failAt) {
        const room = Math.max(0, ctl.failAt - cur.length);
        if (room > 0) { files.set(p, Buffer.concat([cur, buf.subarray(off, off + room)])); return { bytesWritten: room, buffer: buf }; }
        ctl.failAt = -1;
        const e = new Error(`${ctl.failCode} fake`); e.code = ctl.failCode; throw e;
      }
      files.set(p, Buffer.concat([cur, buf.subarray(off, off + n)]));
      return { bytesWritten: n, buffer: buf };
    }),
    stat: () => track('stat', () => ({ size: (files.get(p) || Buffer.alloc(0)).length })),
    close: () => track('close', () => undefined),
  });
  const fs = {
    promises: {
      mkdir: (p) => track('mkdir', () => undefined),
      open: (p) => track('open', () => { if (!files.has(p)) files.set(p, Buffer.alloc(0)); return handle(p); }),
      access: (p) => track('access', () => { if (!files.has(p)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } }),
      statfs: () => track('statfs', () => ({ bavail: Math.round(ctl.freeGb * 1e9 / 4096), bsize: 4096 })),
    },
  };
  const lines = (p) => String(files.get(p) || '').split('\n').filter((l) => l.length);
  return { fs, files, ctl, lines };
};

// every() / stopTimer() as gamemode's, by name, run by hand
const makeTimers = () => {
  const T = new Map();
  globalThis.__dboTimers = T;
  const every = (name, ms, fn) => { T.set(name, { ms, fn }); };
  const stopTimer = (name) => { T.delete(name); };
  const run = (name, n) => { for (let i = 0; i < (n || 1); i++) { const t = T.get(name); if (t) t.fn(); } };
  return { T, every, stopTimer, run };
};

// setTimeout(fn, 0) queued and run by hand; a real microtask drain for the async fs
const makeQueue = () => {
  const q = [];
  const real = global.setTimeout;
  const install = () => { global.setTimeout = (fn, ms) => { q.push(fn); return q.length; }; };
  const restore = () => { global.setTimeout = real; };
  const run = () => { let n = 0; while (q.length && n < 10000) { const f = q.shift(); n++; f(); } return n; };
  return { q, install, restore, run };
};
const settle = async (n) => { for (let i = 0; i < (n || 20); i++) await new Promise((r) => setImmediate(r)); };

const makeClock = (t0) => { const c = { t: t0 || Date.UTC(2026, 9, 13, 14, 0, 0), p: 0, perUs: 0 }; c.now = () => c.t; c.perf = () => (c.p += c.perUs / 1000); return c; };

module.exports = { makeMp, makeFs, makeTimers, makeQueue, makeClock, settle, spinFor };
