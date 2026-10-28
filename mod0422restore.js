'use strict';
// DragonBreak Online: ticket mod-0422, a one-shot restore (Jake, 28 Oct 2026). On 21-24 Oct the Bruma court moved The
// Plague Doctor #VKRS's goods out of the house at door 08000EF7 and into Bruma Castle containers. Jake: take the originals
// back from those containers and the 2095 gold back from the Count, gift only what is gone, stage the delivery (gold and
// valuables first, the bulk when the player has storage), the 4 silver pieces to Winter #EBZN (a vampire cannot carry
// silver), and Mike Morethi #5D8L's 4 armour pieces back to him. The house stays in character.
//
// Idle unless the run file mod0422-restore.json is in the server folder. Every POLL_MS it looks at that file; when the file
// is new or changed it runs once:
//   { "mode": "dryrun" | "apply" | "undo" | "off", "stages": [1] | [1, 2], "planFile": "mod0422-restore-plan.json" (or "plan": {..}),
//     "confirm": "<plan.confirm, printed by the dryrun; apply only>" | "undo-<plan.confirm>" (undo only),
//     "goldOrder": ["treasury:bruma"] | ["inventory", "bank"] ... (where the gold comes from; required when the plan has no
//     gold order: plan.gold.choices lists Jake's two), "goldShortfall": "mint" | "report" (default: the plan's; both fixed
//     by the first gold step that is done), "strict": true, "partial": false, "from": "DragonBreak Staff",
//     "resolve": { "<step id>": "done" | "failed" (a step a crash left "started") | "skip" (a take: step that failed or
//     never ran: nothing taken there, the deliveries go without it) }, "ledgerFile": "<path>" }
// The plan (mod0422/restore/plan.json, made by build_plan.py from the evidence) lists, per container, the exact entries to
// remove (plain stacks by base, count, the level the container keeps, the count seen when the plan was made; the 15
// one-of-a-kind entries by their exact extra data), the gold, and the deliveries (letters).
//
//   dryrun: changes nothing in the world and writes no ledger. Logs per container what it found against what the plan
//           expects, the one-of-a-kind matches, refusals and shortfalls, the gold (for each of the plan's gold choices when
//           none is chosen), and the letters it would send; writes the same as a report (mod0422-restore-report.json).
//   apply:  first a preflight (every reader of a delivery still to pack exists, the gold sources can be read, a gold order
//           is chosen): nothing at all is done when it fails. Then removes exactly the planned entries from each container
//           (an entry whose count is not there, or whose extra data does not match, is refused and logged), takes the gold
//           from the sources in order (never more than the plan's figure in all), and, only once every container step is
//           done, delivers the deliveries of the stages listed as board letters with parcels (post.js format: exact
//           entries, so charges, tempers and enchantments survive the collect). Goods of a stage not listed stay queued in
//           the ledger.
//   undo:   with "confirm": "undo-<plan.confirm>": takes back every letter still uncollected in its mailbox (its parcel
//           exactly as sent), puts every recovered item the ledger still holds back into the container it came from, the
//           gold back to its sources (minted gold and new copies are dropped), and closes the ledger (no further apply).
//           A collected letter is listed for staff. Without the code: a preview, nothing changed.
// Every step is written to the ledger (mod0422-restore-ledger.json beside world/) BEFORE it changes anything, and gets one
// audit line. A step that is done is never repeated, so a second apply is a no-op. A letter id carries the plan
// (m0422-<plan hash 8>-<delivery>-<n>) and is never pushed twice: a letter of that id already in the mailbox counts as
// sent only when the ledger left it "started" (a crash) and its parcel is the ledger's. A step left "started" is not
// repeated either; staff check it by hand and say so with "resolve".
// Kill switch: delete the run file or set "mode": "off". Nothing here touches mp handlers. A gamemode.js reload without this
// module (a rollback) stops its timer (generation guard, as console.js).
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
// A letter's id: the plan is in it, so a follow-up plan's letters never meet an earlier plan's
const letterId = (plan, key, n) => `${LETTER_PREFIX}${String((plan && plan.hash) || '').slice(0, 8)}-${key}-${n}`;
// A parcel's items as a multiset (base and exact extra data -> count), and whether a mailbox letter carries a ledger letter
const itemKey = (e) => { const o = extrasOf(e); return `${Number(e.baseId) >>> 0}|${JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]))}`; };
const tally = (items) => { const m = new Map(); for (const e of items || []) { if (!e) continue; const k = itemKey(e); m.set(k, (m.get(k) || 0) + (Number(e.count) || 0)); } return m; };
const sameItems = (a, b) => { const x = tally(a), y = tally(b); return x.size === y.size && [...x].every(([k, n]) => y.get(k) === n); };
const parcelIs = (m, lt) => !!(m && m.parcel) && (Number(m.parcel.gold) || 0) === (Number(lt.gold) || 0) && sameItems(m.parcel.items, lt.items);
const GOLD_SRC = /^(inventory|bank|treasury:[a-z0-9_-]+)$/;

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

// What goes back into one container (undo): plain counts by base and exact entries. -> the new entries
const putIntoContainer = (entries, plain, uniques) => {
  const out = (entries || []).filter((e) => e && (Number(e.count) || 0) > 0).map((e) => Object.assign({}, e));
  for (const [h, n] of Object.entries(plain || {})) {
    if (!(Number(n) > 0)) continue;
    const base = idOfHex(h); const e = out.find((x) => (Number(x.baseId) >>> 0) === base && isPlain(x) && !x.worn && !x.wornLeft);
    if (e) e.count = Number(e.count) + Number(n); else out.push({ baseId: base, count: Number(n) });
  }
  for (const e of uniques || []) out.push(Object.assign({}, e));
  return out;
};

// Letters for one delivery. items: [{ entry, unique?, minted? }]; weightOf(baseId) -> number|null.
// Plain stacks may be split across letters; a one-of-a-kind entry never is. Deterministic. Each letter says how many of
// each base in it are new copies (mintedBy), so an undo drops exactly those.
const packLetters = (items, gold, lim, weightOf) => {
  const maxW = Number(lim && lim.maxWeight) > 0 ? Number(lim.maxWeight) : Infinity;
  const maxS = Number(lim && lim.maxStacks) > 0 ? Number(lim.maxStacks) : Infinity;
  const w1 = (e) => { const w = weightOf(Number(e.baseId) >>> 0); return Number.isFinite(w) && w >= 0 ? w : 1; };
  const list = (items || []).map((x, i) => ({ x, w: w1(x.entry), i })).sort((a, b) => (b.w * b.x.entry.count) - (a.w * a.x.entry.count) || (Number(a.x.entry.baseId) >>> 0) - (Number(b.x.entry.baseId) >>> 0) || a.i - b.i);
  const letters = [];
  const room = (L) => maxW - L.weight;
  const open = () => { const L = { gold: 0, entries: [], weight: 0, minted: 0, mintedBy: {}, uniques: [] }; letters.push(L); return L; };
  const put = (L, x, n, w) => {
    const e = Object.assign({}, x.entry, { count: n });
    const plain = isPlain(e) && !x.unique;
    const hit = plain && L.entries.find((y) => isPlain(y) && (Number(y.baseId) >>> 0) === (Number(e.baseId) >>> 0) && !y.__u && !!y.__m === !!x.minted);
    if (hit) hit.count += n; else { if (x.unique) e.__u = x.unique; if (x.minted) e.__m = true; L.entries.push(e); }
    L.weight = Math.round((L.weight + w * n) * 100) / 100;
    if (x.minted) { L.minted += n; const h = hex(e.baseId); L.mintedBy[h] = (L.mintedBy[h] || 0) + n; }
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
  // the one audit line of every step (staff lines: the player log excludes the verb, playerlog-rules.js)
  const auditLine = (t) => audit(`M0422 ${t}`);
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
    if (!plan || plan.ticket !== 'mod-0422' || !Array.isArray(plan.containers) || !Array.isArray(plan.deliveries) || !plan.gold || !plan.actors || !plan.hash) return ['the plan is not a mod-0422 plan'];
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
  const poolAdd = (L, taken) => {
    for (const [h, n] of Object.entries(taken.plain || {})) L.pool.plain[h] = (Number(L.pool.plain[h]) || 0) + n;
    for (const [uid, e] of Object.entries(taken.uniques || {})) L.pool.uniques[uid] = e;
  };
  const openLedger = (plan, planSha, ledgerPath) => {
    const L = readJson(ledgerPath);
    if (L && (L.planHash !== plan.hash || L.planSha !== planSha)) {
      say(`the ledger ${ledgerPath} belongs to plan ${L.planHash}/${L.planSha}, not ${plan.hash}/${planSha}: nothing done (move the ledger aside only if no step of it ran)`);
      return { refused: 'ledger' };
    }
    return { L };
  };
  const takeSettled = (L, c) => { const st = L.steps[`take:${c.ref}`]; return !!st && (st.status === 'done' || st.status === 'skipped'); };
  const goldDone = (L) => Object.entries(L.steps).some(([k, st]) => k.startsWith('gold:') && k !== 'gold:mint' && st.status === 'done') || !!(L.steps['gold:mint'] && L.steps['gold:mint'].status === 'done');

  // ---- the gold sources: what one holds, and how to take from it -------------------------------------------------------
  const goldSource = (plan, src) => {
    if (src === 'inventory' || src === 'bank') {
      const count = actorOf(plan.actors[plan.gold.from]);
      if (!count.ok) return { error: `the Count: ${count.why}` };
      if (src === 'inventory') {
        let have = 0;
        try { have = Math.max(0, Number(goldOf(count.id)) || 0); } catch (e) { return { error: `the Count's gold cannot be read (${e.message})` }; }
        return { have, label: `the pack of ${count.label}`, take: (n) => {
          let ok = false; try { ok = takeGold(count.id, n) === true; } catch (e) { ok = false; }
          if (ok) return true;
          // gold in several stacks: takeGold reads one stack
          const es = inventoryOf(count.id); let left = n;
          for (const e of es) { if (left <= 0) break; if ((Number(e.baseId) >>> 0) !== GOLD || e.worn) continue; const k = Math.min(left, Number(e.count) || 0); e.count -= k; left -= k; }
          if (left !== 0) return false;
          mp.set(count.id, 'inventory', { entries: es.filter((e) => (Number(e.count) || 0) > 0) }); return true;
        }, give: (n) => {
          const es = inventoryOf(count.id); const g = es.find((e) => (Number(e.baseId) >>> 0) === GOLD && isPlain(e) && !e.worn);
          if (g) g.count = Number(g.count) + n; else es.push({ baseId: GOLD, count: n });
          mp.set(count.id, 'inventory', { entries: es }); return true;
        } };
      }
      let bank = 0;
      try { bank = Math.max(0, Math.floor(Number(mp.get(count.id, 'private.bankGold')) || 0)); } catch (e) { return { error: `the Count's bank cannot be read (${e.message})` }; }
      const plog = (from, to) => { try { const h = globalThis.__dboPlogHook; if (typeof h === 'function') h('bankwrite', count.id, 'restitution', from, to); } catch (e) { /* the player log is optional */ } };
      return { have: bank, label: `the bank account of ${count.label}`,
        take: (n) => { mp.set(count.id, 'private.bankGold', bank - n); plog(bank, bank - n); return true; },
        give: (n) => { mp.set(count.id, 'private.bankGold', bank + n); plog(bank, bank + n); return true; } };
    }
    if (/^treasury:[a-z0-9_-]+$/.test(src)) {
      const T = globalThis.__dboTreasuryZone; const zone = src.slice(9);
      if (!T || typeof T.balance !== 'function' || typeof T.spend !== 'function' || typeof T.deposit !== 'function') return { error: 'bank.js treasuries not loaded' };
      let have = 0;
      try { have = Math.max(0, Math.floor(Number(T.balance(zone)) || 0)); } catch (e) { return { error: `the ${zone} treasury cannot be read (${e.message})` }; }
      // bank.js zoneTake writes no BANK line: the module's own audit line is the record. A deposit with no income tag is
      // not counted as the hold's income (not tithed), as the Count's payment in was not
      return { have, label: `the ${zone} treasury`, take: (n) => T.spend(zone, n) === true, give: (n) => Number(T.deposit(zone, n)) === n };
    }
    return { error: `unknown gold source ${src}` };
  };

  // ---- one run (dryrun: sim = true, nothing in the world or the ledger changes) --------------------------------------
  const execute = (plan, R, sim, ledgerPath, planSha) => {
    const opts = { strict: R.strict !== false, partial: R.partial === true };
    const stages = (Array.isArray(R.stages) ? R.stages : [1]).map(Number).filter((s) => s === 1 || s === 2);
    const from = String(R.from || 'DragonBreak Staff').slice(0, 60);
    let shortfallPolicy = (R.goldShortfall || plan.gold.shortfall) === 'mint' ? 'mint' : 'report';
    const o = openLedger(plan, planSha, ledgerPath); if (o.refused) return { refused: [o.refused] };
    let L = o.L;
    if (L && L.closed) { say(`the ledger ${ledgerPath} was closed by an undo at ${L.closed}: nothing done (a new plan needs a new ledger)`); return { refused: ['closed'] }; }
    const fresh = !L;
    if (!L) L = newLedger(plan, planSha);
    if (sim) L = JSON.parse(JSON.stringify(L));
    const save = () => { if (sim) return; L.updated = iso(); writeJson(ledgerPath, L); };
    const note = (t) => { if (sim) return; L.log.push(`${iso()} ${t}`); auditLine(t); };
    const rep = { mode: sim ? 'dryrun' : 'apply', at: iso(), plan: plan.hash, confirm: plan.confirm, stages, strict: opts.strict, partial: opts.partial, goldShortfall: shortfallPolicy, containers: [], gold: null, deliveries: [], letters: [], held: [], shortfall: [], stuck: [], waiting: [], actors: {}, preflight: [] };

    // the gold order: the run file's, else the plan's; once a gold step is done, that run's order and policy hold
    let sources = Array.isArray(R.goldOrder) ? R.goldOrder.map(String) : (Array.isArray(plan.gold.order) ? plan.gold.order.map(String) : null);
    if (goldDone(L) && L.gold) {
      if (sources && (JSON.stringify(L.gold.order) !== JSON.stringify(sources) || L.gold.policy !== shortfallPolicy)) say(`gold: the order ${JSON.stringify(L.gold.order)} and policy ${L.gold.policy} of the first apply hold; the run file's are ignored`);
      sources = L.gold.order; shortfallPolicy = L.gold.policy; rep.goldShortfall = shortfallPolicy;
    }
    const goldSettled = () => !!sources && sources.every((k) => L.steps[`gold:${k}`] && L.steps[`gold:${k}`].status === 'done');

    // ---- preflight (apply): nothing at all is done unless it passes ------------------------------------------------------
    for (const [k, A] of Object.entries(plan.actors)) { const a = actorOf(A); rep.actors[k] = a.ok ? 'ok' : a.why; }
    {
      const bad = [];
      if (sources && !sources.every((x) => GOLD_SRC.test(x))) bad.push(`gold: unknown source in ${JSON.stringify(sources)}`);
      if (!sources) bad.push(`gold: no source chosen. Set "goldOrder" in the run file to one of the plan's choices: ${Object.entries(plan.gold.choices || {}).map(([k, v]) => `${k} ${JSON.stringify(v.order)}`).join(', ') || '(none)'}`);
      const allTaken = plan.containers.every((c) => takeSettled(L, c));
      // the takes take both stages' goods: every reader must exist before the first take; afterwards those still to pack
      const need = plan.deliveries.filter((d) => !allTaken || (stages.includes(Number(d.stage)) && !(L.steps[`pack:${d.key}`] && L.steps[`pack:${d.key}`].status === 'done')));
      for (const k of [...new Set(need.map((d) => d.to))]) { const a = actorOf(plan.actors[k]); if (!a.ok) bad.push(`reader ${k}: ${a.why}`); }
      if (sources && !goldSettled() && sources.every((x) => GOLD_SRC.test(x))) for (const src of sources) { if (L.steps[`gold:${src}`] && L.steps[`gold:${src}`].status === 'done') continue; const g = goldSource(plan, src); if (g.error) bad.push(`gold ${src}: ${g.error}`); }
      rep.preflight = bad;
      if (bad.length && !sim) { for (const b of bad) say(`preflight: ${b}`); say(`preflight failed (${bad.length}): nothing done`); rep.refused = ['preflight']; return rep; }
      for (const b of bad) say(`dryrun preflight: ${b} (an apply would do nothing)`);
    }
    if (fresh) save();
    // a step a crash left "started": staff looked and say what happened; a take step that failed or never ran can be skipped
    for (const [id, how] of Object.entries(R.resolve || {})) {
      const st = L.steps[id];
      if (how === 'skip' && id.startsWith('take:') && plan.containers.some((c) => `take:${c.ref}` === id) && (!st || st.status === 'failed')) {
        L.steps[id] = Object.assign({}, st || {}, { status: 'skipped', resolved: iso(), taken: { plain: {}, uniques: {} } });
        save(); note(`step ${id} skipped by staff: nothing taken there; its goods are reported not recovered`); continue;
      }
      if (!st || st.status !== 'started' || (how !== 'done' && how !== 'failed')) continue;
      st.status = how; st.resolved = iso();
      if (how === 'done' && id.startsWith('take:') && st.taken) poolAdd(L, st.taken);
      if (how === 'done' && id.startsWith('gold:') && st.n > 0) L.pool.gold = (L.pool.gold || 0) + st.n;
      save(); note(`step ${id} resolved by staff as ${how}`);
    }

    // 1. the containers: every planned entry, both stages (the court cannot scatter the bulk while it waits)
    const blocked = [];
    for (const c of plan.containers) {
      const sid = `take:${c.ref}`; const st = L.steps[sid];
      const cr = { ref: c.ref, label: c.label, plannedEntries: (c.take || []).length, plannedItems: c.totalPlain, plannedUniques: c.totalUniques };
      rep.containers.push(cr);
      if (st && st.status === 'done') { cr.status = 'done before'; continue; }
      if (st && st.status === 'skipped') { cr.status = 'skipped by staff'; continue; }
      if (st && st.status === 'started') { cr.status = 'stuck'; rep.stuck.push(sid); blocked.push(sid); say(`${sid} was started and never finished (a crash?): not repeated; check ${c.ref} by hand and set "resolve"`); continue; }
      const ref = idOfDesc(c.desc);
      let entries; try { entries = inventoryOf(ref); } catch (e) { cr.status = `unreadable (${e.message})`; blocked.push(sid); say(`${c.ref} could not be read: ${e.message}`); continue; }
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
      catch (e) { L.steps[sid].status = 'failed'; L.steps[sid].error = e.message; save(); say(`${c.ref}: the change failed (${e.message}); nothing taken, the step can run again`); cr.status = 'failed'; blocked.push(sid); continue; }
      poolAdd(L, r.taken); L.steps[sid].status = 'done'; L.steps[sid].done = iso(); save();
      note(`took ${took} items and ${cr.uniquesMatched} one-of-a-kind from ${c.label} (${c.ref}); ${r.refused.length} planned entries refused`);
    }

    // 2. the gold, from the sources in order: "inventory" (the Count's pack), "bank" (his account), "treasury:<zone>" (a
    // hold's treasury, bank.js). Never more than the plan's figure in all: what every done gold step took and what was
    // minted count against it. A dryrun with no order chosen shows each of the plan's choices.
    // dry: change nothing; toPool: a dryrun's copy of the pool gets the gold (so its letters show it), a choice preview's not
    const goldRun = (order, policy, dry, toPool) => {
      const g = plan.gold; const want = Math.max(0, Math.floor(Number(g.want) || 0));
      const gr = { want, policy, order, sources: [] };
      const goldSteps = () => Object.entries(L.steps).filter(([k]) => k.startsWith('gold:'));
      const doneSum = () => goldSteps().filter(([, st]) => st.status === 'done').reduce((s, [, st]) => s + (Number(st.n) || 0), 0); // minted included
      let settled = true; let simGot = 0;
      if (goldSteps().some(([, st]) => st.status === 'started')) { settled = false; gr.status = 'stuck'; if (!dry) { rep.stuck.push('gold'); say('a gold step was started and never finished: not repeated; check it by hand and set "resolve"'); } }
      for (const src of settled ? order : []) {
        const sid = `gold:${src}`; const st = L.steps[sid];
        if (st && st.status === 'done') { gr.sources.push({ src, n: st.n, status: 'done before' }); continue; }
        const need = Math.max(0, want - doneSum() - simGot);
        const G = goldSource(plan, src);
        if (G.error) { settled = false; gr.status = G.error; if (!dry) say(`gold: ${G.error}; nothing taken from ${src}`); break; }
        const n = Math.min(need, G.have);
        gr.sources.push({ src, have: G.have, n });
        if (dry) { simGot += n; if (toPool) L.pool.gold = (L.pool.gold || 0) + n; continue; } // the copy only
        L.steps[sid] = { status: 'started', at: iso(), want, have: G.have, n }; save(); // before the change
        let ok = n === 0;
        if (!ok) { try { ok = G.take(n) === true; } catch (e) { ok = false; } }
        if (!ok) { L.steps[sid].status = 'failed'; save(); settled = false; say(`gold: taking ${n} from ${src} failed; nothing taken, the step can run again`); break; }
        L.pool.gold = (L.pool.gold || 0) + n; L.steps[sid].status = 'done'; L.steps[sid].done = iso(); save();
        note(`took ${n} gold from ${G.label}`);
      }
      if (settled) {
        const got = doneSum() + simGot; const short = Math.max(0, want - got); gr.taken = got; gr.short = short;
        const sMint = L.steps['gold:mint'];
        if (short > 0 && policy === 'mint' && !(sMint && sMint.status === 'done')) {
          gr.minted = short;
          if (!dry || toPool) L.pool.gold = (L.pool.gold || 0) + short; // in a dryrun, the copy only
          if (!dry) { L.steps['gold:mint'] = { status: 'done', at: iso(), n: short, minted: true }; save(); note(`${short} of the ${want} gold could not be taken back: ${short} gold minted for the player (plan policy)`); }
        } else if (sMint && sMint.status === 'done') gr.minted = sMint.n;
        gr.status = 'ok';
      }
      return gr;
    };
    if (sources) {
      if (!sim) L.gold = L.gold && goldDone(L) ? L.gold : { order: sources, policy: shortfallPolicy };
      const gr = goldRun(sources, shortfallPolicy, sim, true); rep.gold = gr;
      if (gr.status === 'ok') say(`${sim ? 'dryrun' : 'apply'} gold: want ${gr.want}; ${gr.sources.map((x) => `${x.src} ${x.n}${x.have !== undefined ? ` of ${x.have}` : ''}`).join(', ') || 'no source'}; short ${gr.short} (${shortfallPolicy === 'mint' ? 'minted' : 'reported only'})`);
    } else {
      rep.gold = { want: plan.gold.want, status: 'no source chosen', choices: {} };
      for (const [k, ch] of Object.entries(plan.gold.choices || {})) {
        const gr = goldRun((ch.order || []).map(String), shortfallPolicy, true, false); rep.gold.choices[k] = gr;
        say(`dryrun gold choice "${k}" ${JSON.stringify(ch.order)}: ${gr.status === 'ok' ? `${gr.sources.map((x) => `${x.src} ${x.n} of ${x.have}`).join(', ')}; ${gr.minted ? `${gr.minted} minted` : 'nothing minted'}` : gr.status}`);
      }
    }
    const told = new Map();
    if (blocked.length) rep.waiting.push(...blocked);

    // 3. the deliveries of the stages asked for, once every container step is done; the rest stays queued
    const takesOk = !blocked.length && (sim || plan.containers.every((c) => takeSettled(L, c)));
    for (const d of plan.deliveries) {
      const dr = { key: d.key, to: d.to, stage: d.stage }; rep.deliveries.push(dr);
      const pk = `pack:${d.key}`;
      if (!stages.includes(Number(d.stage))) { dr.status = 'queued (stage not run)'; continue; }
      if (!(L.steps[pk] && L.steps[pk].status === 'done')) {
        if (!takesOk) { dr.status = `not packed: a container step is not done (${blocked.join(', ') || plan.containers.filter((c) => !takeSettled(L, c)).map((c) => `take:${c.ref}`).join(', ')}); resolve it, then apply again`; say(`${d.key}: ${dr.status}`); continue; }
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
        const ids = letters.map((l, i) => letterId(plan, d.key, i + 1));
        letters.forEach((l, i) => {
          L.letters[ids[i]] = { id: ids[i], delivery: d.key, stage: d.stage, to: d.to, actor: hex(a.id), status: 'packed',
            from, text: `${d.text}${letters.length > 1 ? ` (part ${i + 1} of ${letters.length})` : ''}`, gold: l.gold, items: l.entries, weight: l.weight, minted: l.minted, mintedBy: l.mintedBy, uniques: l.uniques };
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
      // 4. each letter: written to the ledger, then into the reader's mailbox once
      for (const id of ids) {
        const lt = L.letters[id];
        const lr = { id, to: lt.to, stage: lt.stage, gold: lt.gold, stacks: lt.items.length, items: lt.items.reduce((s, e) => s + (Number(e.count) || 0), 0), weight: lt.weight, minted: lt.minted, uniques: (lt.uniques || []).length, status: lt.status };
        rep.letters.push(lr);
        if (lt.status === 'done') { lr.status = 'sent before'; continue; }
        if (lt.status === 'conflict') { lr.status = `not sent: ${lt.note}`; continue; }
        const A = plan.actors[lt.to]; const a = actorOf(A);
        if (!a.ok || hex(a.id) !== lt.actor) { lr.status = `not sent: ${a.why || 'another character'}`; say(`${id}: ${lr.status}`); continue; }
        say(`${sim ? 'dryrun' : 'apply'} letter ${id} to ${a.label}: ${lt.gold} gold, ${lr.items} items in ${lr.stacks} stacks, ${lt.weight} weight${lt.minted ? `, ${lt.minted} minted` : ''}${lr.uniques ? `, ${lr.uniques} one-of-a-kind` : ''}`);
        if (sim) { lr.status = 'would send'; continue; }
        let box = lettersOf(a.id);
        const found = box.find((m) => m && String(m.id) === id);
        if (found) {
          // only a crash between the ledger and the mailbox leaves our own letter there; anything else is not ours to count
          if ((lt.status === 'started' || lt.status === 'failed') && (parcelIs(found, lt) || (found.collected && !found.parcel))) { lt.status = 'done'; lt.note = 'found in the mailbox (a crash before the ledger said so)'; save(); lr.status = 'sent before'; continue; }
          lt.status = 'conflict'; lt.note = `a letter with this id and another parcel is already in the mailbox`; save(); lr.status = `not sent: ${lt.note}`; say(`${id}: ${lr.status}`); continue;
        }
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

  // ---- undo: letters still uncollected come back, recovered goods go back where they were, the gold to its sources ------
  const undo = (plan, R, preview, ledgerPath, planSha) => {
    const o = openLedger(plan, planSha, ledgerPath); if (o.refused) return { refused: [o.refused] };
    if (!o.L) { say(`undo: no ledger at ${ledgerPath}: nothing was applied, nothing to undo`); return { mode: 'undo', refused: ['no ledger'] }; }
    let L = o.L;
    if (preview) L = JSON.parse(JSON.stringify(L));
    const save = () => { if (preview) return; L.updated = iso(); writeJson(ledgerPath, L); };
    const note = (t) => { if (preview) return; L.log.push(`${iso()} ${t}`); auditLine(t); };
    const rep = { mode: preview ? 'undo preview' : 'undo', at: iso(), plan: plan.hash, letters: [], containers: [], gold: [], collected: [], conflicts: [], stuck: [], dropped: { minted: 0, mintedGold: 0 } };
    const stuck = Object.entries(L.steps).filter(([, st]) => st.status === 'started').map(([k]) => k).concat(Object.values(L.letters).filter((lt) => lt.status === 'started').map((lt) => `letter:${lt.id}`));
    const stuckUndo = stuck.filter((k) => k.startsWith('undo:'));
    if (stuck.length && stuck.length !== stuckUndo.length) { rep.stuck = stuck; say(`undo: steps left "started" (${stuck.join(', ')}): resolve them first; nothing done`); rep.refused = ['stuck']; return rep; }
    if (stuckUndo.length) { rep.stuck = stuckUndo; say(`undo: undo steps left "started" by a crash (${stuckUndo.join(', ')}): check them by hand; nothing done`); rep.refused = ['stuck']; return rep; }
    const back = (lt) => { // a letter's goods into the pool: recovered units and one-of-a-kind entries; new copies dropped
      const mb = Object.assign({}, lt.mintedBy || {});
      for (const e of lt.items || []) {
        if (!isPlain(e)) continue;
        const h = hex(e.baseId); const m = Math.min(Number(mb[h]) || 0, Number(e.count) || 0); mb[h] = (Number(mb[h]) || 0) - m;
        const n = (Number(e.count) || 0) - m; rep.dropped.minted += m;
        if (n > 0) L.pool.plain[h] = (Number(L.pool.plain[h]) || 0) + n;
      }
      for (const uid of lt.uniques || []) { const e = (lt.items || []).find((x) => !isPlain(x) && (plan.uniques || []).some((u) => u.uid === uid && idOfHex(u.base) === (Number(x.baseId) >>> 0) && same(extrasOf(x), u.match))); if (e) L.pool.uniques[uid] = Object.assign({}, e); }
      L.pool.gold = (L.pool.gold || 0) + (Number(lt.gold) || 0);
    };
    // 1. letters
    const told = new Set();
    for (const lt of Object.values(L.letters)) {
      const sid = `undo:letter:${lt.id}`; const lr = { id: lt.id, to: lt.to, was: lt.status };
      rep.letters.push(lr);
      if (L.steps[sid] && L.steps[sid].status === 'done') { lr.status = 'recalled before'; continue; }
      if (lt.status === 'packed' || lt.status === 'failed' || lt.status === 'conflict') {
        lr.status = 'never in a mailbox: back to the ledger';
        if (!preview) { L.steps[sid] = { status: 'started', at: iso() }; back(lt); lt.status = 'recalled'; L.steps[sid].status = 'done'; save(); note(`undo: letter ${lt.id} never sent, its goods back to the ledger`); } else back(lt);
        continue;
      }
      if (lt.status === 'recalled') { lr.status = 'recalled before'; continue; }
      const a = idOfHex(lt.actor);
      let box = []; try { box = lettersOf(a); } catch (e) { lr.status = `mailbox unreadable (${e.message})`; rep.conflicts.push(lr); continue; }
      const m = box.find((x) => x && String(x.id) === lt.id);
      if (!m || !m.parcel) { lr.status = 'collected (or burnt after collecting): staff decision'; rep.collected.push({ id: lt.id, to: lt.to, gold: lt.gold, items: lt.items.reduce((s, e) => s + (Number(e.count) || 0), 0), uniques: lt.uniques || [] }); continue; }
      if (!parcelIs(m, lt)) { lr.status = 'in the mailbox with another parcel: left alone, staff decision'; rep.conflicts.push(lr); continue; }
      lr.status = preview ? 'would recall' : 'recalled';
      if (preview) { back(lt); continue; }
      L.steps[sid] = { status: 'started', at: iso() }; save();
      try {
        saveLetters(a, lettersOf(a).filter((x) => !(x && String(x.id) === lt.id)));
        if (lettersOf(a).some((x) => x && String(x.id) === lt.id)) throw new Error('the letter is still in the mailbox after the save');
      } catch (e) { L.steps[sid].status = 'failed'; L.steps[sid].error = e.message; save(); lr.status = `failed (${e.message})`; say(`undo: ${lt.id}: ${e.message}`); continue; }
      back(lt); lt.status = 'recalled'; L.steps[sid].status = 'done'; L.steps[sid].done = iso(); save();
      note(`undo: letter ${lt.id} taken back from ${lt.to}'s mailbox (${lt.gold} gold, ${lt.items.length} stacks)`);
      told.add(a);
    }
    // 2. the containers: what each take step took, as far as the ledger still holds it
    for (const c of plan.containers) {
      const st = L.steps[`take:${c.ref}`]; const sid = `undo:take:${c.ref}`; const cr = { ref: c.ref, label: c.label };
      rep.containers.push(cr);
      if (L.steps[sid] && L.steps[sid].status === 'done') { cr.status = 'put back before'; continue; }
      if (!st || st.status !== 'done') { cr.status = `nothing to put back (step ${st ? st.status : 'never ran'})`; continue; }
      const plain = {}; const uniques = []; const missing = [];
      for (const [h, n] of Object.entries((st.taken && st.taken.plain) || {})) {
        const k = Math.min(Number(n) || 0, Number(L.pool.plain[h]) || 0);
        if (k > 0) { plain[h] = k; L.pool.plain[h] -= k; if (!L.pool.plain[h]) delete L.pool.plain[h]; }
        if (k < n) missing.push({ base: h, want: n, back: k });
      }
      for (const uid of Object.keys((st.taken && st.taken.uniques) || {})) { if (L.pool.uniques[uid]) { uniques.push(L.pool.uniques[uid]); delete L.pool.uniques[uid]; } else missing.push({ uid }); }
      Object.assign(cr, { items: Object.values(plain).reduce((s, n) => s + n, 0), uniques: uniques.length, missing });
      if (preview) { cr.status = 'would put back'; continue; }
      const ref = idOfDesc(c.desc);
      L.steps[sid] = { status: 'started', at: iso(), plain, uniques }; save();
      try { mp.set(ref, 'inventory', { entries: putIntoContainer(inventoryOf(ref), plain, uniques) }); }
      catch (e) { // back into the pool: the step can run again
        for (const [h, n] of Object.entries(plain)) L.pool.plain[h] = (Number(L.pool.plain[h]) || 0) + n;
        for (const e2 of uniques) { const u = (plan.uniques || []).find((x) => idOfHex(x.base) === (Number(e2.baseId) >>> 0) && same(extrasOf(e2), x.match)); if (u) L.pool.uniques[u.uid] = e2; }
        L.steps[sid].status = 'failed'; L.steps[sid].error = e.message; save(); cr.status = `failed (${e.message})`; say(`undo: ${c.ref}: ${e.message}`); continue;
      }
      L.steps[sid].status = 'done'; L.steps[sid].done = iso(); save(); cr.status = 'put back';
      note(`undo: put ${cr.items} items and ${uniques.length} one-of-a-kind back into ${c.label} (${c.ref})${missing.length ? `; ${missing.length} entries not in the ledger any more (delivered and collected)` : ''}`);
    }
    // 3. the gold: what the sources gave goes back to them, last source first; the minted part is dropped
    const mintN = (L.steps['gold:mint'] && L.steps['gold:mint'].status === 'done') ? Number(L.steps['gold:mint'].n) || 0 : 0;
    const srcs = ((L.gold && L.gold.order) || []).slice().reverse();
    for (const src of srcs) {
      const st = L.steps[`gold:${src}`]; const sid = `undo:gold:${src}`;
      if (!st || st.status !== 'done' || !(Number(st.n) > 0)) continue;
      if (L.steps[sid] && L.steps[sid].status === 'done') { rep.gold.push({ src, status: 'returned before', n: L.steps[sid].n }); continue; }
      const n = Math.min(Number(st.n), Math.max(0, (Number(L.pool.gold) || 0)));
      const gr = { src, took: st.n, back: n }; rep.gold.push(gr);
      if (!(n > 0)) { gr.status = 'nothing in the ledger (the gold letter was collected): staff decision'; continue; }
      const G = goldSource(plan, src);
      if (G.error) { gr.status = G.error; say(`undo: gold ${src}: ${G.error}`); continue; }
      if (preview) { gr.status = 'would return'; L.pool.gold -= n; continue; }
      L.steps[sid] = { status: 'started', at: iso(), n }; save();
      let ok = false; try { ok = G.give(n) === true; } catch (e) { ok = false; }
      if (!ok) { L.steps[sid].status = 'failed'; save(); gr.status = 'failed'; say(`undo: returning ${n} gold to ${src} failed; it can run again`); continue; }
      L.pool.gold -= n; L.steps[sid].status = 'done'; L.steps[sid].done = iso(); save(); gr.status = 'returned';
      note(`undo: returned ${n} gold to ${G.label}`);
    }
    const leftGold = Number(L.pool.gold) || 0;
    rep.dropped.mintedGold = Math.min(leftGold, mintN);
    const allBack = rep.containers.every((c) => /put back|nothing to put back/.test(String(c.status))) && rep.gold.every((g) => /returned|nothing in the ledger/.test(String(g.status))) && rep.letters.every((l) => /recall|collected|never in a mailbox/.test(String(l.status)));
    if (!preview && allBack) {
      L.pool.gold = Math.max(0, leftGold - rep.dropped.mintedGold);
      L.closed = iso(); save(); note(`undo done: ledger closed (${rep.collected.length} letters already collected, left with their readers: staff decision)`);
    }
    rep.closed = !!L.closed;
    rep.pool = { plain: Object.values(L.pool.plain).reduce((s, n) => s + n, 0), uniques: Object.keys(L.pool.uniques).length, gold: L.pool.gold || 0 };
    const online = new Set((onlineActors() || []).map((x) => Number(x) >>> 0));
    for (const a of told) if (online.has(a >>> 0)) { try { sendMailState(a); } catch (e) { /* the marker only */ } }
    say(`${rep.mode}: ${rep.letters.filter((l) => /recall/.test(l.status)).length} letters ${preview ? 'to recall' : 'recalled'}, ${rep.collected.length} collected (staff), ${rep.conflicts.length} conflicts; containers ${rep.containers.map((c) => `${c.ref} ${c.status}`).join(', ')}; gold ${rep.gold.map((g) => `${g.src} ${g.back} ${g.status}`).join(', ') || 'none'}${rep.closed ? '; ledger closed' : ''}`);
    if (preview) say(`undo preview for plan ${plan.hash}: to undo, set "mode": "undo" and "confirm": "undo-${plan.confirm}"`);
    return rep;
  };

  const run = () => {
    let R;
    try { R = JSON.parse(fs.readFileSync(runPath, 'utf8')); } catch (e) { say(`${RUN_FILE} unreadable (${e.message}); nothing done`); return null; }
    const mode = String(R.mode || 'off').toLowerCase();
    if (mode !== 'dryrun' && mode !== 'apply' && mode !== 'undo') { say(`mode ${mode}: nothing done`); return null; }
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
    try {
      if (mode === 'undo') rep = undo(plan, R, String(R.confirm || '') !== `undo-${plan.confirm}`, ledgerPath, planSha);
      else rep = execute(plan, R, mode === 'dryrun', ledgerPath, planSha);
    } catch (e) { say(`${mode} stopped: ${e.stack || e.message}`); return null; }
    if (!rep) return null;
    if (rep.refused) { try { writeJson(R.reportFile ? path.resolve(String(R.reportFile)) : path.join(dir, REPORT_FILE), rep); } catch (e) { /* the log has it */ } return rep; }
    if (mode === 'dryrun') say(`dryrun done for plan ${plan.hash}: to apply, set "mode": "apply" and "confirm": "${plan.confirm}"${rep.gold && rep.gold.status === 'no source chosen' ? ' and "goldOrder" (Jake\'s choice)' : ''}`);
    if (mode !== 'undo') say(`${mode} summary: ${rep.letters.length} letters (${rep.letters.filter((x) => x.status === 'sent').length} sent now), ${rep.shortfall.length} shortfalls, ${rep.held.length} held, ${rep.stuck.length} stuck, ${rep.waiting.length} waiting, queued: ${rep.queued.join(' ') || 'none'}`);
    try { writeJson(R.reportFile ? path.resolve(String(R.reportFile)) : path.join(dir, REPORT_FILE), rep); } catch (e) { say(`the report could not be written (${e.message})`); }
    return rep;
  };

  // The generation guard (console.js): every gamemode.js load assigns a new __dboRunCommand early. Another one than ours
  // means a newer gamemode loaded without replacing this module (a rollback): stop
  const gen = api.gen; let mine = null;
  const tick = () => {
    if (gen !== undefined && globalThis.__dboRunCommand !== gen) {
      const timers = globalThis.__dboTimers;
      if (timers instanceof Map && mine && timers.get(TIMER) === mine) stopTimer(TIMER);
      if (!S.genStopped) { S.genStopped = true; say('a newer gamemode generation loaded without this module; stopped'); }
      return;
    }
    let st = null;
    try { st = fs.statSync(runPath); } catch (e) { if (S.handled) { S.handled = ''; say(`${RUN_FILE} is gone: idle`); } return; }
    let body = '';
    try { body = fs.readFileSync(runPath, 'utf8'); } catch (e) { return; }
    const sig = `${st.size}:${crypto.createHash('sha256').update(body).digest('hex').slice(0, 16)}`;
    if (sig === S.handled) return;
    S.handled = sig;
    S.last = run();
  };
  S.genStopped = false;
  globalThis.__dboM0422Tick = tick;
  if (typeof stopTimer === 'function') stopTimer(TIMER);
  every(TIMER, POLL_MS, tick);
  mine = globalThis.__dboTimers instanceof Map ? globalThis.__dboTimers.get(TIMER) || null : null;
  say(`loaded; ${fs.existsSync(runPath) ? `${RUN_FILE} found, read within ${POLL_MS / 1000} s` : `idle (no ${RUN_FILE})`}`);
};
module.exports.takeFromContainer = takeFromContainer;
module.exports.putIntoContainer = putIntoContainer;
module.exports.packLetters = packLetters;
module.exports.letterId = letterId;
module.exports.parcelIs = parcelIs;
module.exports.same = same;
module.exports.RUN_FILE = RUN_FILE;
module.exports.LEDGER_FILE = LEDGER_FILE;
