'use strict';
// DragonBreak Online: ticket mod-0422, a one-shot restore (Jake, 28 Oct 2026). On 21-24 Oct the Bruma court moved The
// Plague Doctor #VKRS's goods out of the house at door 08000EF7 and into Bruma Castle containers. Jake: take the originals
// back from those containers and the 2095 gold back from the Count, gift only what is gone, stage the delivery (gold and
// valuables first, the bulk when the player has storage), the 4 silver pieces to Winter #EBZN (a vampire cannot carry
// silver), and Mike Morethi #5D8L's 4 armour pieces back to him. The house stays in character.
//
// Idle unless the run file mod0422-restore.json is in the server folder. Every POLL_MS it looks at that file; when the file
// is new or changed it runs once:
//   { "mode": "dryrun" | "apply" | "off", "stages": [1] | [1, 2], "planFile": "mod0422-restore-plan.json" (or "plan": {..}),
//     "confirm": "<plan.confirm, printed by the dryrun; apply only>", "strict": true, "partial": false,
//     "goldShortfall": "mint" | "report" (default: the plan's), "goldOrder": ["inventory", "bank"] | ["treasury:bruma"] ...
//     (default: the plan's; both are fixed by the first gold step that is done), "from": "DragonBreak Staff",
//     "resolve": { "<step id>": "done" | "failed" } (only for a step left "started" by a crash), "ledgerFile": "<path>" }
// The plan (mod0422/restore/plan.json, made by build_plan.py from the evidence) lists, per container, the exact entries to
// remove (plain stacks by base, count, the level the container keeps, the count seen when the plan was made; the 15
// one-of-a-kind entries by their exact extra data), the gold to take from the Count, and the deliveries (letters).
//
//   dryrun: changes nothing in the world and writes no ledger. Logs per container what it found against what the plan
//           expects, the one-of-a-kind matches, refusals and shortfalls, the gold, and the letters it would send; writes
//           the same as a report (mod0422-restore-report.json beside world/).
//   apply:  removes exactly the planned entries from each container (an entry whose count is not there, or whose extra
//           data does not match, is refused and logged), takes the gold from the sources in order (the Count's pack,
//           his bank account, or a hold's treasury; never more than the plan's figure in all), and delivers the
//           deliveries of the stages listed as board letters with parcels (post.js format: exact entries, so charges,
//           tempers and enchantments survive the collect). Goods of a stage not listed stay queued in the ledger.
// Every step is written to the ledger (mod0422-restore-ledger.json beside world/) BEFORE it changes anything, and gets one
// audit line. A step that is done is never repeated, so a second apply is a no-op. A letter has a fixed id and is never
// pushed twice (its mailbox is checked first). A step left "started" (a crash between the ledger write and the change) is
// not repeated either; staff check it by hand and say so with "resolve".
// Kill switch: delete the run file or set "mode": "off". Nothing here touches mp handlers.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RUN_FILE = 'mod0422-restore.json';
const LEDGER_FILE = 'mod0422-restore-ledger.json';
const REPORT_FILE = 'mod0422-restore-report.json';
const TIMER = 'mod0422Restore';
const POLL_MS = 10000;
const LETTER_PREFIX = 'm0422-';

// ---- pure helpers (the harness uses them) ----------------------------------------------------------------------------
const hex = (n) => (Number(n) >>> 0).toString(16);
const idOfHex = (h) => parseInt(String(h), 16) >>> 0;
const SKIP = new Set(['baseId', 'count', 'worn', 'wornLeft']);
const extrasOf = (e) => { const o = {}; for (const k of Object.keys(e || {})) if (!SKIP.has(k) && e[k] !== undefined && e[k] !== null) o[k] = e[k]; return o; };
const isPlain = (e) => Object.keys(extrasOf(e)).length === 0;
// Extra data compared exactly; floats within a millionth (a JSON round trip keeps them exact anyway)
const same = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined && a[k] !== null).sort();
    const kb = Object.keys(b).filter((k) => b[k] !== undefined && b[k] !== null).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && same(a[k], b[k]));
  }
  return a === b;
};
const matchesUnique = (e, base, match) => !!e && (Number(e.baseId) >>> 0) === base && !e.worn && !e.wornLeft && same(extrasOf(e), match || {});
const plainCount = (entries, base) => entries.reduce((n, e) => n + ((Number(e.baseId) >>> 0) === base && isPlain(e) ? Number(e.count) || 0 : 0), 0);

// What leaves one container. entries: its inventory; c: the plan's container; opts { strict, partial }.
// -> { entries, taken: { plain: { hex: n }, uniques: { uid: entry } }, rows: [..], refused: [..] }
const takeFromContainer = (entries, c, opts) => {
  const o = opts || {};
  const out = (entries || []).filter((e) => e && (Number(e.count) || 0) > 0).map((e) => Object.assign({}, e));
  const taken = { plain: {}, uniques: {} }; const rows = []; const refused = [];
  // the one-of-a-kind entries first: an exact entry is never counted as part of a plain stack
  for (const u of c.uniques || []) {
    const base = idOfHex(u.base); const n = Number(u.count) || 1;
    const i = out.findIndex((e) => Number(e.count) >= n && matchesUnique(e, base, u.match));
    if (i < 0) { const r = { uid: u.uid, base: u.base, name: u.name, want: n, got: 0, status: 'missing', why: 'no entry with this exact extra data' }; rows.push(r); refused.push(r); continue; }
    const e = out[i]; const t = Object.assign({}, e, { count: n }); delete t.worn; delete t.wornLeft;
    taken.uniques[u.uid] = t;
    if (Number(e.count) > n) e.count = Number(e.count) - n; else out.splice(i, 1);
    rows.push({ uid: u.uid, base: u.base, name: u.name, want: n, got: n, status: 'ok' });
  }
  for (const t of c.take || []) {
    const base = idOfHex(t.base); const want = Number(t.count) || 0; const keep = Math.max(0, Number(t.keep) || 0);
    const have = plainCount(out, base); const room = Math.max(0, have - keep);
    let status = 'ok'; let n = want;
    if (room < want) { status = 'short'; n = o.partial ? room : 0; }
    else if (o.strict !== false && t.seen !== undefined && have !== Number(t.seen)) { status = 'changed'; n = 0; }
    const row = { base: t.base, name: t.name, want, have, keep, seen: t.seen, got: n, status };
    rows.push(row);
    if (status !== 'ok') refused.push(Object.assign({ why: status === 'short' ? `only ${room} above the ${keep} the container keeps` : `the container holds ${have}, not the ${t.seen} the plan saw` }, row));
    if (!(n > 0)) continue;
    let left = n;
    for (let i = out.length - 1; i >= 0 && left > 0; i--) {
      const e = out[i];
      if ((Number(e.baseId) >>> 0) !== base || !isPlain(e)) continue;
      const k = Math.min(left, Number(e.count) || 0);
      e.count = Number(e.count) - k; left -= k;
      if (e.count <= 0) out.splice(i, 1);
    }
    taken.plain[t.base] = (taken.plain[t.base] || 0) + n;
  }
  return { entries: out, taken, rows, refused };
};

// Letters for one delivery. items: [{ entry, unique?, minted? }]; weightOf(baseId) -> number|null.
// Plain stacks may be split across letters; a one-of-a-kind entry never is. Deterministic.
const packLetters = (items, gold, lim, weightOf) => {
  const maxW = Number(lim && lim.maxWeight) > 0 ? Number(lim.maxWeight) : Infinity;
  const maxS = Number(lim && lim.maxStacks) > 0 ? Number(lim.maxStacks) : Infinity;
  const w1 = (e) => { const w = weightOf(Number(e.baseId) >>> 0); return Number.isFinite(w) && w >= 0 ? w : 1; };
  const list = (items || []).map((x, i) => ({ x, w: w1(x.entry), i })).sort((a, b) => (b.w * b.x.entry.count) - (a.w * a.x.entry.count) || (Number(a.x.entry.baseId) >>> 0) - (Number(b.x.entry.baseId) >>> 0) || a.i - b.i);
  const letters = [];
  const room = (L) => maxW - L.weight;
  const open = () => { const L = { gold: 0, entries: [], weight: 0, minted: 0, uniques: [] }; letters.push(L); return L; };
  const put = (L, x, n, w) => {
    const e = Object.assign({}, x.entry, { count: n });
    const plain = isPlain(e) && !x.unique;
    const hit = plain && L.entries.find((y) => isPlain(y) && (Number(y.baseId) >>> 0) === (Number(e.baseId) >>> 0) && !y.__u && !!y.__m === !!x.minted);
    if (hit) hit.count += n; else { if (x.unique) e.__u = x.unique; if (x.minted) e.__m = true; L.entries.push(e); }
    L.weight = Math.round((L.weight + w * n) * 100) / 100;
    if (x.minted) L.minted += n;
    if (x.unique) L.uniques.push(x.unique);
  };
  for (const { x, w } of list) {
    let left = Number(x.entry.count) || 0;
    if (x.unique) {
      const tw = w * left;
      let L = letters.find((y) => y.entries.length < maxS && room(y) >= tw);
      if (!L) L = open();
      put(L, x, left, w); continue;
    }
    while (left > 0) {
      let L = letters.find((y) => (y.entries.length < maxS || y.entries.some((e) => isPlain(e) && !e.__u && !!e.__m === !!x.minted && (Number(e.baseId) >>> 0) === (Number(x.entry.baseId) >>> 0))) && (w === 0 || room(y) >= w));
      if (!L) L = open();
      const fit = w === 0 ? left : Math.max(1, Math.floor(room(L) / w + 1e-9));
      const n = Math.min(left, fit);
      put(L, x, n, w); left -= n;
    }
  }
  if (Number(gold) > 0) (letters[0] || open()).gold = Number(gold);
  for (const L of letters) for (const e of L.entries) { delete e.__u; delete e.__m; }
  return letters;
};

module.exports = (api) => {
  const { mp, log, audit, personal, onlineActors, every, stopTimer, lettersOf, saveLetters, sendMailState, takeGold, goldOf } = api;
  const GOLD = Number(api.GOLD_BASE) >>> 0 || 0xf;
  const S = globalThis.__dboM0422 || (globalThis.__dboM0422 = { handled: '' });
  const say = (t) => log(`m0422: ${t}`);
  const iso = () => new Date().toISOString();
  const runPath = api.runFile ? path.resolve(api.runFile) : path.resolve(RUN_FILE);
  const stateDir = () => { try { return path.dirname(fs.realpathSync(path.resolve('world'))); } catch (e) { return path.resolve('.'); } };

  // ---- world reads ---------------------------------------------------------------------------------------------------
  const descCache = new Map();
  const idOfDesc = (d) => { if (descCache.has(d)) return descCache.get(d); let v = 0; try { v = mp.getIdFromDesc(String(d)) >>> 0; } catch (e) { v = 0; } descCache.set(d, v); return v; };
  const inventoryOf = (id) => { const inv = mp.get(id, 'inventory'); return inv && Array.isArray(inv.entries) ? inv.entries.map((e) => Object.assign({}, e)) : []; };
  const gone = (id) => { try { return typeof globalThis.__dboFormGone === 'function' && !!globalThis.__dboFormGone(id >>> 0); } catch (e) { return false; } };
  const actorOf = (A) => {
    if (!A) return { ok: false, why: 'not in the plan' };
    const id = idOfHex(A.id);
    if (gone(id)) return { ok: false, id, why: 'the character no longer exists' };
    let tag = null, prof = null;
    try { tag = mp.get(id, 'private.charTag'); prof = Number(mp.get(id, 'profileId')); } catch (e) { return { ok: false, id, why: `cannot be read (${e.message})` }; }
    if (tag !== A.tag) return { ok: false, id, why: `tag is ${tag}, not ${A.tag}` };
    if (prof !== Number(A.profile)) return { ok: false, id, why: `profile is ${prof}, not ${A.profile}` };
    return { ok: true, id, label: `${A.name} #${A.tag}` };
  };
  const supernaturalOf = (id) => { try { const s = mp.get(id, 'private.supernatural'); return !!(s && s.kind); } catch (e) { return false; } };
  // Silver a vampire or werewolf cannot carry (supernatural.js): it never goes into their letters
  const cannotCarry = (id, base) => {
    const f = globalThis.__dboCannotCarry;
    if (typeof f === 'function') { try { return !!f(id, base); } catch (e) { return supernaturalOf(id); } }
    return supernaturalOf(id); // supernatural.js not loaded: hold everything for a supernatural reader
  };
  // A base's weight from its record (bank.js weightOf, the same offsets)
  const WEIGHT_AT = { WEAP: 4, ARMO: 4, MISC: 4, INGR: 4, KEYM: 4, SLGM: 4, SCRL: 4, ALCH: 0, BOOK: 12, AMMO: 16, LIGH: 44 };
  const weights = new Map();
  const weightOf = (baseId) => {
    const id = Number(baseId) >>> 0;
    if (id === GOLD) return 0;
    if (weights.has(id)) return weights.get(id);
    let w = null;
    try {
      const r = mp.lookupEspmRecordById(id); const t = r && r.record ? String(r.record.type) : '';
      const off = WEIGHT_AT[t];
      const f = off === undefined ? null : (r.record.fields || []).find((x) => x && x.type === 'DATA' && x.data instanceof Uint8Array && x.data.byteLength >= off + 4);
      if (f) { const v = new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getFloat32(off, true); w = Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null; }
    } catch (e) { w = null; }
    weights.set(id, w);
    return w;
  };

  // ---- plan checks -----------------------------------------------------------------------------------------------------
  const checkPlan = (plan) => {
    const bad = [];
    if (!plan || plan.ticket !== 'mod-0422' || !Array.isArray(plan.containers) || !Array.isArray(plan.deliveries) || !plan.gold || !plan.actors) return ['the plan is not a mod-0422 plan'];
    const idCheck = (desc, h, what) => { const got = idOfDesc(desc); if (got !== idOfHex(h)) bad.push(`${what}: ${desc} is ${got ? hex(got) : 'unknown'} now, the plan says ${h} (load order changed? rebuild the plan)`); };
    for (const c of plan.containers) {
      idCheck(c.desc, c.ref, `container ${c.ref}`);
      for (const t of c.take || []) idCheck(t.desc, t.base, t.name);
      for (const u of c.uniques || []) idCheck(u.desc, u.base, u.name);
    }
    for (const d of plan.deliveries) for (const x of d.items || []) idCheck(x.desc, x.base, x.name);
    return bad;
  };

  // ---- ledger ------------------------------------------------------------------------------------------------------------
  const sha = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);
  const newLedger = (plan, planSha) => ({ ticket: plan.ticket, planHash: plan.hash, planSha, created: iso(), updated: iso(), steps: {}, letters: {}, pool: { plain: {}, uniques: {}, gold: 0 }, shortfall: [], held: [], log: [] });
  const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
  const writeJson = (p, o) => { fs.writeFileSync(p + '.tmp', JSON.stringify(o)); fs.renameSync(p + '.tmp', p); };

  // ---- one run (dryrun: sim = true, nothing in the world or the ledger changes) --------------------------------------
  const execute = (plan, R, sim, ledgerPath, planSha) => {
    const opts = { strict: R.strict !== false, partial: R.partial === true };
    const stages = (Array.isArray(R.stages) ? R.stages : [1]).map(Number).filter((s) => s === 1 || s === 2);
    const from = String(R.from || 'DragonBreak Staff').slice(0, 60);
    let shortfallPolicy = (R.goldShortfall || plan.gold.shortfall) === 'mint' ? 'mint' : 'report';
    let L = readJson(ledgerPath);
    if (L && (L.planHash !== plan.hash || L.planSha !== planSha)) {
      say(`the ledger ${ledgerPath} belongs to plan ${L.planHash}/${L.planSha}, not ${plan.hash}/${planSha}: nothing done (move the ledger aside only if no step of it ran)`);
      return null;
    }
    const fresh = !L;
    if (!L) L = newLedger(plan, planSha);
    if (sim) L = JSON.parse(JSON.stringify(L));
    const save = () => { if (sim) return; L.updated = iso(); writeJson(ledgerPath, L); };
    const note = (t) => { if (sim) return; L.log.push(`${iso()} ${t}`); audit(`M0422 ${t}`); };
    const rep = { mode: sim ? 'dryrun' : 'apply', at: iso(), plan: plan.hash, confirm: plan.confirm, stages, strict: opts.strict, partial: opts.partial, goldShortfall: shortfallPolicy, containers: [], gold: null, deliveries: [], letters: [], held: [], shortfall: [], stuck: [], actors: {} };
    if (fresh) save();
    // a step a crash left "started": staff looked and say what happened
    for (const [id, how] of Object.entries(R.resolve || {})) {
      const st = L.steps[id];
      if (!st || st.status !== 'started' || (how !== 'done' && how !== 'failed')) continue;
      st.status = how; st.resolved = iso();
      if (how === 'done' && id.startsWith('take:') && st.taken) poolAdd(L, st.taken);
      if (how === 'done' && id.startsWith('gold:') && st.n > 0) L.pool.gold = (L.pool.gold || 0) + st.n;
      save(); note(`step ${id} resolved by staff as ${how}`);
    }
    for (const [k, A] of Object.entries(plan.actors)) { const a = actorOf(A); rep.actors[k] = a.ok ? 'ok' : a.why; }

    // 1. the containers: every planned entry, both stages (the court cannot scatter the bulk while it waits)
    for (const c of plan.containers) {
      const sid = `take:${c.ref}`; const st = L.steps[sid];
      const cr = { ref: c.ref, label: c.label, plannedEntries: (c.take || []).length, plannedItems: c.totalPlain, plannedUniques: c.totalUniques };
      rep.containers.push(cr);
      if (st && st.status === 'done') { cr.status = 'done before'; continue; }
      if (st && st.status === 'started') { cr.status = 'stuck'; rep.stuck.push(sid); say(`${sid} was started and never finished (a crash?): not repeated; check ${c.ref} by hand and set "resolve"`); continue; }
      const ref = idOfDesc(c.desc);
      let entries; try { entries = inventoryOf(ref); } catch (e) { cr.status = `unreadable (${e.message})`; say(`${c.ref} could not be read: ${e.message}`); continue; }
      const r = takeFromContainer(entries, c, opts);
      const took = Object.values(r.taken.plain).reduce((s, n) => s + n, 0);
      Object.assign(cr, { status: sim ? 'would take' : 'taken', foundItems: entries.reduce((s, e) => s + (Number(e.count) || 0), 0), takeItems: took,
        okEntries: r.rows.filter((x) => x.status === 'ok' && !x.uid).length, uniquesMatched: Object.keys(r.taken.uniques).length, refused: r.refused });
      say(`${sim ? 'dryrun' : 'apply'} ${c.ref} ${c.label}: ${cr.okEntries}/${(c.take || []).length} entries ok, ${took}/${c.totalPlain} items, ${cr.uniquesMatched}/${(c.uniques || []).length} one-of-a-kind matched, ${r.refused.length} refused (${r.refused.filter((x) => x.status === 'short').length} short, ${r.refused.filter((x) => x.status === 'changed').length} changed, ${r.refused.filter((x) => x.status === 'missing').length} missing)`);
      for (const x of r.refused.slice(0, 25)) say(`  refused ${c.ref} ${x.uid || x.base} ${x.name}: ${x.why}`);
      for (const x of r.refused) rep.shortfall.push(Object.assign({ container: c.ref }, x));
      if (sim) { poolAdd(L, r.taken); continue; }
      L.steps[sid] = { status: 'started', at: iso(), taken: r.taken, refused: r.refused };
      save(); // before the change
      try { mp.set(ref, 'inventory', { entries: r.entries }); }
      catch (e) { L.steps[sid].status = 'failed'; L.steps[sid].error = e.message; save(); say(`${c.ref}: the change failed (${e.message}); nothing taken, the step can run again`); cr.status = 'failed'; continue; }
      poolAdd(L, r.taken); L.steps[sid].status = 'done'; L.steps[sid].done = iso(); save();
      note(`took ${took} items and ${cr.uniquesMatched} one-of-a-kind from ${c.label} (${c.ref}); ${r.refused.length} planned entries refused`);
    }

    // 2. the gold, from the sources in order (plan.gold.order, or "goldOrder" in the run file): "inventory" (the Count's
    // pack), "bank" (his account), "treasury:<zone>" (a hold's treasury, bank.js). Never more than the plan's figure in all:
    // what every done gold step took (whatever the order now) and what was minted count against it.
    let sources = (Array.isArray(R.goldOrder) ? R.goldOrder : (plan.gold.order || ['inventory', 'bank'])).map(String);
    // Once a gold step is done, the order and the shortfall policy of that run hold (no overpaying, no gold left without a letter)
    if (Object.entries(L.steps).some(([k, st]) => k.startsWith('gold:') && st.status === 'done') && L.gold) {
      if (JSON.stringify(L.gold.order) !== JSON.stringify(sources) || L.gold.policy !== shortfallPolicy) say(`gold: the order ${JSON.stringify(L.gold.order)} and policy ${L.gold.policy} of the first apply hold; the run file's are ignored`);
      sources = L.gold.order; shortfallPolicy = L.gold.policy; rep.goldShortfall = shortfallPolicy;
    } else L.gold = { order: sources, policy: shortfallPolicy };
    const goldSettled = () => sources.every((k) => L.steps[`gold:${k}`] && L.steps[`gold:${k}`].status === 'done');
    {
      const g = plan.gold; const want = Math.max(0, Math.floor(Number(g.want) || 0));
      const gr = { want, policy: shortfallPolicy, order: sources, sources: [] }; rep.gold = gr;
      const count = actorOf(plan.actors[g.from]);
      const goldSteps = () => Object.entries(L.steps).filter(([k]) => k.startsWith('gold:'));
      const doneSum = () => goldSteps().filter(([, st]) => st.status === 'done').reduce((s, [, st]) => s + (Number(st.n) || 0), 0);
      let settled = true; let simGot = 0;
      if (goldSteps().some(([, st]) => st.status === 'started')) { settled = false; gr.status = 'stuck'; rep.stuck.push('gold'); say('a gold step was started and never finished: not repeated; check it by hand and set "resolve"'); }
      for (const src of settled ? sources : []) {
        const sid = `gold:${src}`; const st = L.steps[sid];
        if (st && st.status === 'done') { gr.sources.push({ src, n: st.n, status: 'done before' }); continue; }
        const need = Math.max(0, want - doneSum() - simGot);
        let have = 0; let take = null;
        if (src === 'inventory' || src === 'bank') {
          if (!count.ok) { settled = false; gr.status = `the Count: ${count.why}`; say(`gold: ${gr.status}; nothing taken from ${src}`); break; }
          if (src === 'inventory') {
            try { have = Math.max(0, Number(goldOf(count.id)) || 0); } catch (e) { have = 0; }
            take = (n) => {
              let ok = false; try { ok = takeGold(count.id, n) === true; } catch (e) { ok = false; }
              if (ok) return true;
              // gold in several stacks: takeGold reads one stack
              const es = inventoryOf(count.id); let left = n;
              for (const e of es) { if (left <= 0) break; if ((Number(e.baseId) >>> 0) !== GOLD || e.worn) continue; const k = Math.min(left, Number(e.count) || 0); e.count -= k; left -= k; }
              if (left !== 0) return false;
              mp.set(count.id, 'inventory', { entries: es.filter((e) => (Number(e.count) || 0) > 0) }); return true;
            };
          } else {
            try { have = Math.max(0, Math.floor(Number(mp.get(count.id, 'private.bankGold')) || 0)); } catch (e) { have = 0; }
            const bank = have;
            take = (n) => {
              mp.set(count.id, 'private.bankGold', bank - n);
              // the player log's record of the bank (restitution.js does the same)
              try { const h = globalThis.__dboPlogHook; if (typeof h === 'function') h('bankwrite', count.id, 'restitution', bank, bank - n); } catch (e) { /* the player log is optional */ }
              return true;
            };
          }
        } else if (/^treasury:[a-z0-9_-]+$/.test(src)) {
          const T = globalThis.__dboTreasuryZone; const zone = src.slice(9);
          if (!T || typeof T.balance !== 'function' || typeof T.spend !== 'function') { settled = false; gr.status = 'bank.js treasuries not loaded'; say(`gold: ${gr.status}`); break; }
          try { have = Math.max(0, Math.floor(Number(T.balance(zone)) || 0)); } catch (e) { have = 0; }
          take = (n) => T.spend(zone, n) === true;
        } else { settled = false; gr.status = `unknown gold source ${src}`; say(`gold: ${gr.status}; nothing taken`); break; }
        const n = Math.min(need, have);
        gr.sources.push({ src, have, n });
        if (sim) { simGot += n; L.pool.gold = (L.pool.gold || 0) + n; continue; } // the copy only
        L.steps[sid] = { status: 'started', at: iso(), want, have, n }; save(); // before the change
        let ok = n === 0;
        if (!ok) { try { ok = take(n) === true; } catch (e) { ok = false; } }
        if (!ok) { L.steps[sid].status = 'failed'; save(); settled = false; say(`gold: taking ${n} from ${src} failed; nothing taken, the step can run again`); break; }
        L.pool.gold = (L.pool.gold || 0) + n; L.steps[sid].status = 'done'; L.steps[sid].done = iso(); save();
        note(`took ${n} gold from ${src === 'inventory' ? `the pack of ${count.label}` : src === 'bank' ? `the bank account of ${count.label}` : `the ${src.slice(9)} treasury`}`);
      }
      if (settled) {
        const got = doneSum() + simGot; const short = Math.max(0, want - got); gr.taken = got; gr.short = short;
        const sMint = L.steps['gold:mint'];
        if (short > 0 && shortfallPolicy === 'mint' && !(sMint && sMint.status === 'done')) {
          gr.minted = short;
          L.pool.gold = (L.pool.gold || 0) + short; // in a dryrun, the copy only
          if (!sim) { L.steps['gold:mint'] = { status: 'done', at: iso(), n: short, minted: true }; save(); note(`${short} of the ${want} gold could not be taken back: ${short} gold minted for the player (plan policy)`); }
        } else if (sMint && sMint.status === 'done') gr.minted = sMint.n;
        gr.status = 'ok';
        say(`${sim ? 'dryrun' : 'apply'} gold: want ${want}; ${gr.sources.map((x) => `${x.src} ${x.n}${x.have !== undefined ? ` of ${x.have}` : ''}`).join(', ') || 'no source'}; short ${short} (${shortfallPolicy === 'mint' ? 'minted' : 'reported only'})`);
      }
    }
    const told = new Map();

    // 3. the deliveries of the stages asked for; the rest stays queued
    for (const d of plan.deliveries) {
      const dr = { key: d.key, to: d.to, stage: d.stage }; rep.deliveries.push(dr);
      const pk = `pack:${d.key}`;
      if (!stages.includes(Number(d.stage))) { dr.status = 'queued (stage not run)'; continue; }
      if (!(L.steps[pk] && L.steps[pk].status === 'done')) {
        const a = actorOf(plan.actors[d.to]);
        if (!a.ok) { dr.status = `not packed: ${d.to} ${a.why}`; say(`${d.key}: ${dr.status}`); continue; }
        if (d.gold && !goldSettled() && !sim) { dr.status = 'not packed: the gold is not settled yet'; say(`${d.key}: ${dr.status}`); continue; }
        const items = []; const short = []; const held = [];
        for (const x of d.items || []) {
          const base = idOfHex(x.base); const want = Number(x.count) || 0;
          if (cannotCarry(a.id, base)) { held.push({ delivery: d.key, base: x.base, name: x.name, count: want, src: x.src, why: `${a.label} cannot carry it (silver)` }); continue; }
          if (x.src === 'minted') { items.push({ entry: { baseId: base, count: want }, minted: true }); continue; }
          const have = Number(L.pool.plain[x.base]) || 0; const n = Math.min(have, want);
          if (n > 0) { items.push({ entry: { baseId: base, count: n } }); L.pool.plain[x.base] = have - n; if (!L.pool.plain[x.base]) delete L.pool.plain[x.base]; }
          if (n < want) short.push({ delivery: d.key, base: x.base, name: x.name, want, got: n, why: 'not recovered' });
        }
        for (const uid of d.uniques || []) {
          const e = L.pool.uniques[uid]; const u = (plan.uniques || []).find((y) => y.uid === uid) || { uid };
          if (!e) { short.push({ delivery: d.key, uid, base: u.base, name: u.name, want: u.count, got: 0, why: 'not recovered' }); continue; }
          if (cannotCarry(a.id, Number(e.baseId) >>> 0)) { held.push({ delivery: d.key, uid, name: u.name, why: `${a.label} cannot carry it (silver)` }); continue; }
          items.push({ entry: e, unique: uid }); delete L.pool.uniques[uid];
        }
        let gold = 0;
        if (d.gold) { gold = Math.max(0, Number(L.pool.gold) || 0); L.pool.gold = 0; }
        const letters = packLetters(items, gold, { maxWeight: d.maxWeight, maxStacks: d.maxStacks }, weightOf);
        const ids = letters.map((l, i) => `${LETTER_PREFIX}${d.key}-${i + 1}`);
        letters.forEach((l, i) => {
          L.letters[ids[i]] = { id: ids[i], delivery: d.key, stage: d.stage, to: d.to, actor: hex(a.id), status: 'packed',
            from, text: `${d.text}${letters.length > 1 ? ` (part ${i + 1} of ${letters.length})` : ''}`, gold: l.gold, items: l.entries, weight: l.weight, minted: l.minted, uniques: l.uniques };
        });
        L.steps[pk] = { status: 'done', at: iso(), letters: ids, short, held };
        for (const x of short) L.shortfall.push(x);
        for (const x of held) L.held.push(x);
        rep.held.push(...held); rep.shortfall.push(...short);
        save();
        if (held.length) say(`${d.key}: ${held.length} held back (silver the reader cannot carry): ${held.map((x) => x.name).join(', ')}`);
      }
      const ids = (L.steps[pk] && L.steps[pk].letters) || [];
      dr.letters = ids; dr.status = sim ? 'would send' : 'sent';
      // 4. each letter: written to the ledger, then into the reader's mailbox once (its id is checked first)
      for (const id of ids) {
        const lt = L.letters[id];
        const lr = { id, to: lt.to, stage: lt.stage, gold: lt.gold, stacks: lt.items.length, items: lt.items.reduce((s, e) => s + (Number(e.count) || 0), 0), weight: lt.weight, minted: lt.minted, uniques: (lt.uniques || []).length, status: lt.status };
        rep.letters.push(lr);
        if (lt.status === 'done') { lr.status = 'sent before'; continue; }
        const A = plan.actors[lt.to]; const a = actorOf(A);
        if (!a.ok || hex(a.id) !== lt.actor) { lr.status = `not sent: ${a.why || 'another character'}`; say(`${id}: ${lr.status}`); continue; }
        say(`${sim ? 'dryrun' : 'apply'} letter ${id} to ${a.label}: ${lt.gold} gold, ${lr.items} items in ${lr.stacks} stacks, ${lt.weight} weight${lt.minted ? `, ${lt.minted} minted` : ''}${lr.uniques ? `, ${lr.uniques} one-of-a-kind` : ''}`);
        if (sim) { lr.status = 'would send'; continue; }
        let box = lettersOf(a.id);
        if (box.some((m) => m && String(m.id) === id)) { lt.status = 'done'; lt.note = 'found in the mailbox'; save(); lr.status = 'sent before'; continue; }
        lt.status = 'started'; lt.at = iso(); save();
        try {
          box = lettersOf(a.id);
          box.push({ id, from: lt.from, fromProfile: -1, text: lt.text, at: Date.now(), read: false, parcel: { gold: lt.gold, items: lt.items.map((e) => Object.assign({}, e)) } });
          saveLetters(a.id, box);
          if (!lettersOf(a.id).some((m) => m && String(m.id) === id)) throw new Error('the letter is not in the mailbox after the save');
        } catch (e) { lt.status = 'failed'; lt.error = e.message; save(); lr.status = 'failed'; say(`${id}: the letter could not be saved (${e.message}); it can be sent again`); continue; }
        lt.status = 'done'; lt.done = iso(); save(); lr.status = 'sent';
        note(`letter ${id} to ${a.label}: ${lt.gold} gold, ${lr.items} items in ${lr.stacks} stacks (${lt.weight} weight)${lt.minted ? `, ${lt.minted} of them new copies` : ''}`);
        told.set(a.id, (told.get(a.id) || 0) + 1);
      }
    }
    // one line and one mail marker per reader who is online, however many letters
    const online = new Set((onlineActors() || []).map((x) => Number(x) >>> 0));
    for (const [id, n] of told) {
      if (!online.has(id)) continue;
      try { personal(id, n > 1 ? `${n} letters from ${from} wait for you at the notice boards.` : `A letter from ${from} waits for you at the notice boards.`); } catch (e) { /* the marker only */ }
      try { sendMailState(id); } catch (e) { /* the marker only */ }
    }
    rep.pool = { plain: Object.values(L.pool.plain).reduce((s, n) => s + n, 0), uniques: Object.keys(L.pool.uniques).length, gold: L.pool.gold || 0 };
    rep.queued = rep.deliveries.filter((x) => String(x.status).startsWith('queued')).map((x) => x.key);
    return rep;
  };
  const poolAdd = (L, taken) => {
    for (const [h, n] of Object.entries(taken.plain || {})) L.pool.plain[h] = (Number(L.pool.plain[h]) || 0) + n;
    for (const [uid, e] of Object.entries(taken.uniques || {})) L.pool.uniques[uid] = e;
  };

  const run = () => {
    let R;
    try { R = JSON.parse(fs.readFileSync(runPath, 'utf8')); } catch (e) { say(`${RUN_FILE} unreadable (${e.message}); nothing done`); return null; }
    const mode = String(R.mode || 'off').toLowerCase();
    if (mode !== 'dryrun' && mode !== 'apply') { say(`mode ${mode}: nothing done`); return null; }
    let plan = R.plan;
    try { if (!plan && R.planFile) plan = JSON.parse(fs.readFileSync(path.resolve(path.dirname(runPath), String(R.planFile)), 'utf8')); }
    catch (e) { say(`the plan file is unreadable (${e.message}); nothing done`); return null; }
    const bad = checkPlan(plan);
    if (bad.length) { for (const b of bad.slice(0, 20)) say(`plan check: ${b}`); say(`${bad.length} plan problems: nothing done`); return { mode, refused: bad }; }
    if (mode === 'apply' && String(R.confirm || '') !== String(plan.confirm)) { say(`apply needs "confirm": "${'<the code the dryrun printed>'}" for plan ${plan.hash}; nothing done`); return { mode, refused: ['confirm'] }; }
    const planSha = sha(plan);
    const dir = stateDir();
    const ledgerPath = R.ledgerFile ? path.resolve(String(R.ledgerFile)) : path.join(dir, LEDGER_FILE);
    let rep = null;
    try { rep = execute(plan, R, mode === 'dryrun', ledgerPath, planSha); }
    catch (e) { say(`${mode} stopped: ${e.stack || e.message}`); return null; }
    if (!rep) return null;
    if (mode === 'dryrun') say(`dryrun done for plan ${plan.hash}: to apply, set "mode": "apply" and "confirm": "${plan.confirm}"`);
    say(`${mode} summary: ${rep.letters.length} letters (${rep.letters.filter((x) => x.status === 'sent').length} sent now), ${rep.shortfall.length} shortfalls, ${rep.held.length} held, ${rep.stuck.length} stuck, queued: ${rep.queued.join(' ') || 'none'}`);
    try { writeJson(R.reportFile ? path.resolve(String(R.reportFile)) : path.join(dir, REPORT_FILE), rep); } catch (e) { say(`the report could not be written (${e.message})`); }
    return rep;
  };

  const tick = () => {
    let st = null;
    try { st = fs.statSync(runPath); } catch (e) { if (S.handled) { S.handled = ''; say(`${RUN_FILE} is gone: idle`); } return; }
    let body = '';
    try { body = fs.readFileSync(runPath, 'utf8'); } catch (e) { return; }
    const sig = `${st.size}:${crypto.createHash('sha256').update(body).digest('hex').slice(0, 16)}`;
    if (sig === S.handled) return;
    S.handled = sig;
    S.last = run();
  };
  globalThis.__dboM0422Tick = tick;
  if (typeof stopTimer === 'function') stopTimer(TIMER);
  every(TIMER, POLL_MS, tick);
  say(`loaded; ${fs.existsSync(runPath) ? `${RUN_FILE} found, read within ${POLL_MS / 1000} s` : `idle (no ${RUN_FILE})`}`);
};
module.exports.takeFromContainer = takeFromContainer;
module.exports.packLetters = packLetters;
module.exports.same = same;
module.exports.RUN_FILE = RUN_FILE;
module.exports.LEDGER_FILE = LEDGER_FILE;
