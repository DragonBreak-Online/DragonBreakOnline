// mod0422restore.js (ticket mod-0422, Jake 28 Oct 2026): the one-shot restore of The Plague Doctor #VKRS's goods from the
// Bruma Castle containers. Loads the real module, the real plan (tests/fixtures/mod0422/plan.json, made by build_plan.py
// from the evidence) and the real castle containers (the 24 Oct 00:01Z backup and the live change forms when the plan was
// made) against a fake mp, and proves: a dryrun changes nothing; an apply removes exactly the planned entries, matches the
// one-of-a-kind entries by their extra data, never touches the Steward's own goods, takes only the planned gold, delivers
// stage 1 only; a second apply is a no-op; stage 2 later delivers the rest once. Also the refusals and crash paths.
//   node tests/mod0422-restore-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
const MOD = path.join(SERVER, 'mod0422restore.js');
const FIX = path.join(__dirname, 'fixtures', 'mod0422');
let fails = 0, passes = 0;
const ok = (c, what, got) => { if (c) passes++; else fails++; console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got).slice(0, 400)}`); };
const clone = (o) => JSON.parse(JSON.stringify(o));
const PLAN0 = JSON.parse(fs.readFileSync(path.join(FIX, 'plan.json'), 'utf8'));
const WORLD = JSON.parse(fs.readFileSync(path.join(FIX, 'world.json'), 'utf8'));
const { takeFromContainer, packLetters, same } = require(MOD);
const hexId = (h) => parseInt(h, 16) >>> 0;
const GOLD = 0xf;
const A = {}; for (const [k, v] of Object.entries(PLAN0.actors)) A[k] = hexId(v.id);
const plainOf = (entries, base) => entries.reduce((n, e) => n + ((e.baseId >>> 0) === base && Object.keys(e).every((k) => k === 'baseId' || k === 'count') ? e.count : 0), 0);
const extrasOnly = (entries) => entries.filter((e) => Object.keys(e).some((k) => k !== 'baseId' && k !== 'count'));
const sig = (e) => JSON.stringify(Object.keys(e).sort().reduce((o, k) => (o[k] = e[k], o), {}));
const multiset = (entries) => { const m = new Map(); for (const e of entries) { const k = sig(Object.assign({}, e, { count: 0 })); m.set(k, (m.get(k) || 0) + e.count); } return m; };

// ---- pure ------------------------------------------------------------------------------------------------------------
ok(same({ chargePercent: 635.0630493164062 }, { chargePercent: 635.0630493164062 }) && !same({ chargePercent: 635.06 }, { chargePercent: 589.44 }) && !same({ a: 1 }, { a: 1, b: 2 }), 'same(): exact extra data, floats within a millionth');
{
  const c = { take: [{ base: '800e4', count: 5, keep: 3, seen: 10 }], uniques: [{ uid: 'u1', base: '13988', count: 1, match: { chargePercent: 5 } }] };
  const es = [{ baseId: 0x800e4, count: 10 }, { baseId: 0x13988, count: 1, chargePercent: 5 }, { baseId: 0x13988, count: 1, chargePercent: 6 }, { baseId: 0x13988, count: 2 }];
  const r = takeFromContainer(es, c, { strict: true });
  ok(r.taken.plain['800e4'] === 5 && r.taken.uniques.u1 && r.taken.uniques.u1.chargePercent === 5 && plainOf(r.entries, 0x800e4) === 5 && r.entries.some((e) => e.chargePercent === 6) && plainOf(r.entries, 0x13988) === 2, 'take: the planned count, and only the entry with the exact extra data', r);
  const r2 = takeFromContainer([{ baseId: 0x800e4, count: 7 }], c, { strict: true });
  ok(!r2.taken.plain['800e4'] && r2.refused.some((x) => x.status === 'short') && r2.refused.some((x) => x.status === 'missing') && plainOf(r2.entries, 0x800e4) === 7, 'take: a count not above the kept level is refused whole (strict), a missing one-of-a-kind is refused', r2.refused);
  const r3 = takeFromContainer([{ baseId: 0x800e4, count: 9 }], c, { strict: true });
  ok(r3.refused[1] && r3.refused.some((x) => x.status === 'changed') && plainOf(r3.entries, 0x800e4) === 9, 'take: strict refuses an entry whose count changed since the plan', r3.refused);
  const r4 = takeFromContainer([{ baseId: 0x800e4, count: 7 }], c, { strict: true, partial: true });
  ok(r4.taken.plain['800e4'] === 4 && plainOf(r4.entries, 0x800e4) === 3, 'take: partial takes only what is above the kept level', r4.taken);
  const L = packLetters([{ entry: { baseId: 1, count: 30 } }, { entry: { baseId: 2, count: 1, chargePercent: 3 }, unique: 'u2' }, { entry: { baseId: 3, count: 4 } }], 50, { maxWeight: 100 }, (b) => ({ 1: 5, 2: 8, 3: 30 }[b]));
  ok(L.length >= 3 && L.every((l) => l.weight <= 100) && L[0].gold === 50 && L.reduce((s, l) => s + l.entries.filter((e) => e.baseId === 1).reduce((n, e) => n + e.count, 0), 0) === 30 && L.filter((l) => l.uniques.includes('u2')).length === 1, 'pack: every letter within the weight, stacks split, a one-of-a-kind whole, gold in the first', L.map((l) => [l.weight, l.entries.length]));
}

// ---- the real plan against the evidence --------------------------------------------------------------------------
const sumTake = PLAN0.containers.reduce((s, c) => s + c.take.reduce((n, t) => n + t.count, 0) + c.uniques.reduce((n, u) => n + u.count, 0), 0);
ok(sumTake === PLAN0.totals.takePlain + PLAN0.totals.takeUniques && PLAN0.totals.takeUniques === 15 && PLAN0.uniques.length === 14, `plan: ${sumTake} items to take, 15 one-of-a-kind in 14 entries`);
ok(PLAN0.containers.every((c) => c.take.every((t) => t.keep + t.count <= plainOf(WORLD.live[c.ref], hexId(t.base)) && t.seen === plainOf(WORLD.live[c.ref], hexId(t.base)))), 'plan: every entry is within what the container held, above the level it keeps');
ok(PLAN0.containers.every((c) => c.take.every((t) => t.keep === plainOf(WORLD.c24[c.ref], hexId(t.base)))), 'plan: the kept level of every entry is the container\'s 24 Oct 00:01Z count (the Steward\'s own)');
ok(!Object.keys(PLAN0.leftAlone).some((r) => PLAN0.containers.some((c) => c.ref === r)), 'plan: 0807284D (Stibbons\' potions) is not touched');
ok(PLAN0.gold.want === 2095 && PLAN0.gold.from === 'count' && JSON.stringify(PLAN0.gold.order) === '["inventory","bank"]', 'plan: 2095 gold from the Count, pack first then bank');
const del = (k) => PLAN0.deliveries.find((d) => d.key === k);
const SILVER = ['9171b', '87833', '80aeb00', '10aa19'], MIKE = ['8300021', '8300023', '80c7f19', 'f6f24'];
ok(del('alt').to === 'alt' && SILVER.every((h) => del('alt').items.some((x) => x.base === h)) && !PLAN0.deliveries.filter((d) => d.to === 'player').some((d) => d.items.some((x) => SILVER.includes(x.base))), 'plan: the 4 silver pieces go to Winter #EBZN only');
ok(MIKE.every((h) => del('mike').items.some((x) => x.base === h && x.count === 1)) && PLAN0.actors.mike.tag === '5D8L', 'plan: Mike Morethi #5D8L gets his 4 armour pieces');
ok(PLAN0.deliveries.filter((d) => d.stage === 1).every((d) => d.items.every((x) => x.stage === 1)) && PLAN0.deliveries.filter((d) => d.stage === 2).every((d) => d.items.every((x) => x.stage === 2)), 'plan: every item rides in its own stage');
ok(PLAN0.totals.owedItems === sumTake + PLAN0.totals.minted, `plan: owed ${PLAN0.totals.owedItems} = taken back ${sumTake} + gifted ${PLAN0.totals.minted}`);

// ---- a fake world ----------------------------------------------------------------------------------------------------
const NOT_SILVER = /quicksilver|silver[-_ ]?(blood|eyes?|plow|hand|tooth|side|bird)|schematic/i;
const CLASS_REC = { Weapons: ['WEAP', 10], 'Enchanted Weapons': ['WEAP', 12], Armor: ['ARMO', 15], 'Enchanted Armor': ['ARMO', 15], Clothing: ['ARMO', 2], Jewelry: ['ARMO', 0.25],
  Arrows: ['AMMO', 0.1], 'Soul Gems': ['SLGM', 0.5], Potions: ['ALCH', 0.5], Food: ['ALCH', 0.5], Ingredients: ['INGR', 0.2], Books: ['BOOK', 1], Lights: ['LIGH', 1], Misc: ['MISC', 1] };
const OFF = { WEAP: 4, ARMO: 4, MISC: 4, INGR: 4, SLGM: 4, ALCH: 0, BOOK: 12, AMMO: 16, LIGH: 44 };
const records = new Map();
const recordFor = (h, cls, name) => {
  const [type, w] = CLASS_REC[String(cls || '').split('/')[0]] || ['MISC', String(cls || '').includes('gem') ? 0.1 : 1];
  const off = OFF[type]; const data = new Uint8Array(off + 8); new DataView(data.buffer).setFloat32(off, String(cls).includes('gem') ? 0.1 : w, true);
  records.set(hexId(h), { record: { type, editorId: String(name || h).replace(/[^A-Za-z0-9]/g, ''), fields: [{ type: 'DATA', data }] } });
};
for (const d of PLAN0.deliveries) for (const x of d.items) recordFor(x.base, x.class, x.name);
for (const u of PLAN0.uniques) recordFor(u.base, /Staff|Mace|Bow/.test(u.name) ? 'Weapons' : 'Misc', u.name);
for (const c of PLAN0.containers) for (const t of c.take) if (!records.has(hexId(t.base))) recordFor(t.base, 'Misc', t.name);
const DESC = new Map();
const addDesc = (d, h) => DESC.set(d, hexId(h));
for (const c of PLAN0.containers) { addDesc(c.desc, c.ref); for (const t of c.take) addDesc(t.desc, t.base); for (const u of c.uniques) addDesc(u.desc, u.base); }
for (const d of PLAN0.deliveries) for (const x of d.items) addDesc(x.desc, x.base);

const mkWorld = (containers, countGold, countBank) => {
  const props = new Map();
  const P = (id) => { if (!props.has(id >>> 0)) props.set(id >>> 0, {}); return props.get(id >>> 0); };
  for (const [ref, es] of Object.entries(containers)) P(hexId(ref)).inventory = { entries: clone(es) };
  const act = (k, extra) => { const p = P(A[k]); p['private.charTag'] = PLAN0.actors[k].tag; p.profileId = PLAN0.actors[k].profile; Object.assign(p, extra); };
  act('player', { inventory: { entries: [{ baseId: GOLD, count: 68 }] }, 'private.supernatural': { kind: 'vampire', pure: true }, 'private.pigeons': [1, 2, 3, 4, 5, 6].map((i) => ({ id: `old${i}`, from: 'The Bruma notice board', fromProfile: -1, text: 'Silver you could not bear to carry', at: 1000 + i, read: true, parcel: { gold: 0, items: [{ baseId: 0x10aa19, count: 1 }] } })) });
  act('alt', { inventory: { entries: [{ baseId: GOLD, count: 50 }] }, 'private.supernatural': null });
  act('mike', { inventory: { entries: [] }, 'private.supernatural': { kind: 'vampire' }, 'private.pigeons': [] });
  act('count', { inventory: { entries: [{ baseId: 0x12345, count: 3 }, { baseId: GOLD, count: countGold }] }, 'private.bankGold': countBank });
  act('steward', { inventory: { entries: [{ baseId: 0x1d4ec, count: 1 }] } });
  return props;
};
const env = (props, opts) => {
  const o = opts || {};
  const sets = []; const audits = []; const logs = []; const said = []; let timer = null;
  const get = (id, k) => { const p = props.get(id >>> 0); if (!p) throw new Error(`no form ${id}`); return p[k] === undefined ? undefined : clone(p[k]); };
  const set = (id, k, v) => { if (o.failSet && o.failSet(id, k)) throw new Error('boom'); sets.push([id >>> 0, k]); const p = props.get(id >>> 0); if (!p) throw new Error(`no form ${id}`); p[k] = clone(v); };
  const mp = { get, set, getIdFromDesc: (d) => { if (o.descShift && d === o.descShift) return 0x0bad0bad; const v = DESC.get(d); if (v === undefined) throw new Error(`unknown desc ${d}`); return v; }, lookupEspmRecordById: (id) => records.get(id >>> 0) || null };
  // gamemode.js letters, gold (same logic)
  const LETTERS_KEPT = 30;
  const lettersOf = (a) => { let box = []; try { box = get(a, 'private.pigeons'); } catch (e) { return []; } return (Array.isArray(box) ? box : []).map((m, i) => Object.assign({}, m, { id: String(m.id || `${m.at || 0}-${i}`) })); };
  const saveLetters = (a, list) => { const sorted = list.slice().sort((x, y) => (y.at || 0) - (x.at || 0)); let spare = sorted.length - LETTERS_KEPT; const kept = spare > 0 ? sorted.reverse().filter((m) => !(spare > 0 && m.read && !m.parcel && spare--)).reverse() : sorted; set(a, 'private.pigeons', kept); };
  const goldOf = (a) => ((get(a, 'inventory') || {}).entries || []).filter((e) => (e.baseId >>> 0) === GOLD).reduce((s, e) => s + e.count, 0);
  const takeGold = (a, n) => { const es = get(a, 'inventory').entries; const g = es.find((e) => (e.baseId >>> 0) === GOLD && !e.worn); if (!g || g.count < n) return false; g.count -= n; set(a, 'inventory', { entries: es.filter((e) => e.count > 0) }); return true; };
  globalThis.__dboCannotCarry = (a, base) => { const s = props.get(a >>> 0) && props.get(a >>> 0)['private.supernatural']; const r = records.get(base >>> 0); return !!(s && s.kind) && !!r && /silver/i.test(r.record.editorId) && !NOT_SILVER.test(r.record.editorId); };
  globalThis.__dboFormGone = (id) => !props.has(id >>> 0);
  delete require.cache[MOD];
  require(MOD)({ mp, log: (...a) => logs.push(a.join(' ')), audit: (t) => audits.push(t), personal: (a, t) => said.push([a, t]), onlineActors: () => o.online || [], every: (n, ms, fn) => { timer = fn; }, stopTimer: () => {},
    lettersOf, saveLetters, sendMailState: () => {}, takeGold, goldOf, GOLD_BASE: GOLD, runFile: o.runFile });
  return { sets, audits, logs, said, tick: () => timer(), lettersOf, mp };
};
const tmp = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'mod0422-'));
const files = (tag) => ({ run: path.join(tmp, `${tag}-run.json`), plan: path.join(tmp, `${tag}-plan.json`), ledger: path.join(tmp, `${tag}-ledger.json`), report: path.join(tmp, `${tag}-report.json`) });
const writeRun = (F, R, plan) => { fs.writeFileSync(F.plan, JSON.stringify(plan || PLAN0)); fs.writeFileSync(F.run, JSON.stringify(Object.assign({ planFile: path.basename(F.plan), ledgerFile: F.ledger, reportFile: F.report }, R))); };
const report = (F) => JSON.parse(fs.readFileSync(F.report, 'utf8'));
const ledger = (F) => JSON.parse(fs.readFileSync(F.ledger, 'utf8'));
const inv = (props, id) => clone((props.get(id >>> 0).inventory || {}).entries || []);
const letters = (props, id) => clone(props.get(id >>> 0)['private.pigeons'] || []);
const m0422 = (props, id) => letters(props, id).filter((m) => String(m.id).startsWith('m0422-'));
const lettersWeight = (l) => l.parcel.items.reduce((s, e) => { const r = records.get(e.baseId >>> 0); const t = r.record; const f = t.fields[0]; return s + new DataView(f.data.buffer).getFloat32(OFF[t.type], true) * e.count; }, 0);

// ==== the live snapshot, the shipped plan ===============================================================================
const F = files('main');
const props = mkWorld(WORLD.live, WORLD.count.gold, WORLD.count.bank);
const before = clone([...props.entries()]);
let E = env(props, { runFile: F.run });
// 1. dryrun
writeRun(F, { mode: 'dryrun', stages: [1] });
E.tick();
const R1 = report(F);
ok(E.sets.length === 0 && JSON.stringify([...props.entries()]) === JSON.stringify(before), 'dryrun: no mp.set, the world is byte-for-byte unchanged');
ok(!fs.existsSync(F.ledger), 'dryrun: no ledger written');
ok(E.audits.length === 0, 'dryrun: no audit line');
ok(R1.containers.every((c, i) => c.refused.length === 0 && c.takeItems === c.plannedItems && c.okEntries === PLAN0.containers[i].take.length && c.uniquesMatched === PLAN0.containers[i].uniques.length), 'dryrun: every planned entry found as expected in every container', R1.containers.map((c) => [c.ref, c.takeItems, c.plannedItems, c.uniquesMatched, c.refused.length]));
ok(R1.containers.reduce((s, c) => s + c.uniquesMatched, 0) === 14, 'dryrun: the 14 one-of-a-kind entries (15 items) matched by extra data');
ok(R1.gold.sources[0].src === 'inventory' && R1.gold.sources[0].n === Math.min(2095, WORLD.count.gold) && R1.gold.short === 2095 - Math.min(2095, WORLD.count.gold), 'dryrun: the gold the Count has, and the shortfall', R1.gold);
ok(R1.letters.length > 0 && R1.letters.every((l) => l.stage === 1) && R1.queued.includes('s2') && R1.queued.includes('s2m'), 'dryrun: stage 1 letters listed, stage 2 queued', R1.letters.map((l) => l.id));
ok(E.logs.some((l) => l.includes(`"confirm": "${PLAN0.confirm}"`)), 'dryrun: prints the confirm code for the apply');
// 2. apply without the code
writeRun(F, { mode: 'apply', stages: [1] });
E.tick();
ok(E.sets.length === 0 && !fs.existsSync(F.ledger), 'apply without the confirm code: refused, nothing changed');
// 3. apply stage 1
writeRun(F, { mode: 'apply', stages: [1], confirm: PLAN0.confirm });
const t0 = process.hrtime.bigint(); E.tick(); const ms = Number(process.hrtime.bigint() - t0) / 1e6;
const R3 = report(F); const L3 = ledger(F);
ok(ms < 3000, `apply: the whole stage-1 run takes ${ms.toFixed(0)} ms in one tick (ledger ${Math.round(fs.statSync(F.ledger).size / 1024)} KB)`);
for (const c of PLAN0.containers) {
  const was = WORLD.live[c.ref]; const now = inv(props, hexId(c.ref));
  const exact = c.take.every((t) => plainOf(now, hexId(t.base)) === plainOf(was, hexId(t.base)) - t.count);
  const others = [...new Set(was.map((e) => e.baseId >>> 0))].filter((b) => !c.take.some((t) => hexId(t.base) === b)).every((b) => plainOf(now, b) === plainOf(was, b));
  ok(exact && others, `apply ${c.ref}: exactly the planned count of each planned base left, every other base untouched`);
  // his own: what the container held on 24 Oct 00:01Z, as far as it was still there before the apply (he moved some himself)
  const kept = WORLD.c24[c.ref].every((e) => {
    if (Object.keys(e).length !== 2) return !was.some((x) => sig(x) === sig(e)) || now.some((x) => sig(x) === sig(e));
    const b = e.baseId >>> 0; const pre = plainOf(WORLD.c24[c.ref], b), w = plainOf(was, b), n = plainOf(now, b);
    return n >= Math.min(pre, w) && (w > pre || n === w);
  });
  ok(kept, `apply ${c.ref}: the Steward's own goods (24 Oct 00:01Z) all still there, plain and one-of-a-kind; a base at or below that level untouched`);
  const gone = c.uniques.every((u) => !now.some((x) => (x.baseId >>> 0) === hexId(u.base) && same(Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'baseId' && k !== 'count')), u.match)));
  const otherExtras = extrasOnly(was).filter((e) => !c.uniques.some((u) => (e.baseId >>> 0) === hexId(u.base) && same(Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'baseId' && k !== 'count')), u.match)));
  ok(gone && otherExtras.every((e) => now.some((x) => sig(x) === sig(e))), `apply ${c.ref}: the planned one-of-a-kind entries gone, every other enchanted or charged entry kept`);
}
ok(['0807284d'].every((r) => !E.sets.some(([id]) => id === hexId(r))), 'apply: 0807284D never written');
const countGold = inv(props, A.count).filter((e) => e.baseId === GOLD).reduce((s, e) => s + e.count, 0);
const tookGold = Math.min(2095, WORLD.count.gold);
ok(countGold === WORLD.count.gold - tookGold && props.get(A.count)['private.bankGold'] === WORLD.count.bank && inv(props, A.count).some((e) => e.baseId === 0x12345 && e.count === 3), `apply: the Count gives up ${tookGold} gold (all he has up to 2095), nothing else`, inv(props, A.count));
ok(L3.steps['gold:mint'] && L3.steps['gold:mint'].n === 2095 - tookGold, 'apply: the rest of the 2095 minted (plan policy), written in the ledger');
const P1 = m0422(props, A.player);
ok(P1.length === R3.letters.filter((l) => l.to === 'player').length && P1.every((m) => m.id.startsWith('m0422-s1')) && P1.length >= 2, `apply: #VKRS gets ${P1.length} stage-1 letters, no stage 2`, P1.map((m) => m.id));
ok(P1.reduce((s, m) => s + (m.parcel.gold || 0), 0) === 2095, 'apply: the letters carry exactly 2095 gold');
ok(P1.every((m) => m.fromProfile === -1 && m.read === false && m.parcel && Array.isArray(m.parcel.items)), 'apply: board letters with parcels (post.js format)');
ok(P1.every((m) => lettersWeight(m) <= 100.01 || m.parcel.items.length === 1), 'apply: every stage-1 letter of #VKRS weighs 100 or less', P1.map((m) => Math.round(lettersWeight(m))));
const allP1 = P1.flatMap((m) => m.parcel.items);
ok(PLAN0.uniques.every((u) => allP1.some((e) => (e.baseId >>> 0) === hexId(u.base) && e.count === u.count && same(Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'baseId' && k !== 'count')), u.match))), 'apply: the 15 one-of-a-kind items ride with their exact charge, temper and enchantment');
ok(!allP1.some((e) => globalThis.__dboCannotCarry(A.player, e.baseId)), 'apply: no silver in a letter to the vampire');
const want1 = new Map(); for (const d of PLAN0.deliveries.filter((x) => x.to === 'player' && x.stage === 1)) for (const x of d.items) want1.set(hexId(x.base), (want1.get(hexId(x.base)) || 0) + x.count);
const got1 = new Map(); for (const e of allP1) if (Object.keys(e).length === 2) got1.set(e.baseId >>> 0, (got1.get(e.baseId >>> 0) || 0) + e.count);
ok(want1.size === got1.size && [...want1].every(([b, n]) => got1.get(b) === n), 'apply: #VKRS stage 1 is exactly the plan (recovered and gifted)');
const ALT = m0422(props, A.alt), MK = m0422(props, A.mike);
ok(ALT.length === 1 && SILVER.every((h) => ALT[0].parcel.items.some((e) => (e.baseId >>> 0) === hexId(h) && e.count === 1)) && ALT[0].parcel.items.length === 4, 'apply: Winter #EBZN gets one letter with the 4 silver pieces');
ok(MK.length === 1 && MIKE.every((h) => MK[0].parcel.items.some((e) => (e.baseId >>> 0) === hexId(h) && e.count === 1)) && MK[0].parcel.items.length === 4, 'apply: Mike Morethi #5D8L gets one letter with his 4 armour pieces (none is silver he cannot carry)');
ok(letters(props, A.player).filter((m) => /^old/.test(m.id)).length === 6, 'apply: the letters already in the mailbox are kept');
const s2want = PLAN0.deliveries.find((d) => d.key === 's2').items.reduce((s, x) => s + x.count, 0);
ok(Object.values(L3.pool.plain).reduce((s, n) => s + n, 0) === s2want && Object.keys(L3.pool.uniques).length === 0 && L3.pool.gold === 0, `apply: stage 2 (${s2want} recovered items) waits in the ledger pool`, L3.pool.gold);
ok(E.audits.length === PLAN0.containers.length + Object.keys(L3.steps).filter((k) => k.startsWith('gold:')).length + R3.letters.length && E.audits.every((t) => t.startsWith('M0422 ')), `apply: one audit line per step (${E.audits.length})`);
ok(R3.shortfall.length === 0 && R3.held.length === 0 && R3.stuck.length === 0, 'apply: no shortfall, nothing held, nothing stuck', [R3.shortfall, R3.held]);
// 4. the same apply again
const sets3 = E.sets.length; const world3 = JSON.stringify([...props.entries()]); const aud3 = E.audits.length;
writeRun(F, { mode: 'apply', stages: [1], confirm: PLAN0.confirm, again: 1 });
E.tick();
ok(E.sets.length === sets3 && JSON.stringify([...props.entries()]) === world3 && E.audits.length === aud3, 'second apply: a no-op (no mp.set, no audit, the world unchanged)');
// a reload of the module and a third apply: still nothing
E = env(props, { runFile: F.run }); delete globalThis.__dboM0422; E.tick();
ok(E.sets.length === 0 && JSON.stringify([...props.entries()]) === world3, 'after a reload: the same apply is still a no-op');
// a dryrun now shows what is left (stage 2)
writeRun(F, { mode: 'dryrun', stages: [1, 2] }); E.tick();
const R4 = report(F);
ok(E.sets.length === 0 && R4.letters.filter((l) => l.status === 'would send').every((l) => l.stage === 2) && R4.letters.some((l) => l.stage === 2), 'dryrun after stage 1: only the stage-2 letters would go');
// 5. stage 2
writeRun(F, { mode: 'apply', stages: [1, 2], confirm: PLAN0.confirm }); E.tick();
const R5 = report(F); const L5 = ledger(F);
ok(!E.sets.some(([id]) => PLAN0.containers.some((c) => hexId(c.ref) === id)) && !E.sets.some(([id]) => id === A.count), 'stage 2: no container and no gold touched again');
const P2 = m0422(props, A.player).filter((m) => m.id.startsWith('m0422-s2'));
const got2 = P2.flatMap((m) => m.parcel.items).reduce((s, e) => s + e.count, 0);
const want2 = PLAN0.deliveries.filter((d) => d.stage === 2).reduce((s, d) => s + d.items.reduce((n, x) => n + x.count, 0), 0);
ok(got2 === want2 && P2.every((m) => m.parcel.items.length <= 40), `stage 2: #VKRS gets the bulk (${got2} items) in ${P2.length} letters of 40 stacks or fewer`);
ok(Object.values(L5.pool.plain).reduce((s, n) => s + n, 0) === 0, 'stage 2: the pool is empty');
const sets5 = E.sets.length; const world5 = JSON.stringify([...props.entries()]);
writeRun(F, { mode: 'apply', stages: [1, 2], confirm: PLAN0.confirm, again: 2 }); E.tick();
ok(E.sets.length === sets5 && JSON.stringify([...props.entries()]) === world5, 'stage 2 again: a no-op');
// every item owed went out exactly once
const out = new Map();
for (const who of ['player', 'alt', 'mike']) for (const m of m0422(props, A[who])) for (const e of m.parcel.items) out.set(e.baseId >>> 0, (out.get(e.baseId >>> 0) || 0) + e.count);
ok([...out.values()].reduce((s, n) => s + n, 0) === PLAN0.totals.owedItems, `all stages: ${PLAN0.totals.owedItems} items delivered in all, each once`);

// ==== collecting a letter with the real post.js keeps the exact entries =========================================================
{
  const POST = path.join(SERVER, 'post.js');
  delete require.cache[POST];
  const cwd = process.cwd(); process.chdir(tmp);
  const reader = A.player; const E2 = E;
  try {
    require(POST)({ mp: E2.mp, log: () => {}, personal: () => {}, audit: () => {}, who: (a) => (a >>> 0).toString(16), nameOf: () => 'x', tagOf: () => 'VKRS', profileOf: () => 101, discordOf: () => '', onlineActors: () => [], every: () => {}, cfg: {}, onUi: () => {},
      takeGold: () => false, giveItem: (a, b, n) => { const es = E2.mp.get(a, 'inventory').entries; const g = es.find((e) => e.baseId === b && Object.keys(e).length === 2); if (g) g.count += n; else es.push({ baseId: b, count: n }); E2.mp.set(a, 'inventory', { entries: es }); return true; },
      goldOf: () => 0, GOLD_BASE: GOLD, recordOf: (id) => records.get(id >>> 0) || null, depositToTreasury: () => 0, zoneById: () => null, boardZoneNear: () => 'bruma',
      lettersOf: E2.lettersOf, saveLetters: (a, l) => E2.mp.set(a, 'private.pigeons', l), sendMailState: () => {}, itemName: () => '' });
  } finally { process.chdir(cwd); }
  const P = globalThis.__dboPostApi;
  const first = m0422(props, reader).find((m) => m.parcel.items.some((e) => Object.keys(e).length > 2));
  const r = P.collect(reader, first.id);
  const mine = inv(props, reader);
  const uq = first.parcel.items.filter((e) => Object.keys(e).length > 2);
  ok(r.ok && uq.every((e) => mine.some((x) => sig(x) === sig(e))), `post.js collect of ${first.id}: the one-of-a-kind entries arrive with their extra data`, r);
}

// ==== the castle containers rebuilt from the 24 Oct 00:01Z backup (c24) plus the player's goods the plan takes ==========
{
  const built = {};
  for (const c of PLAN0.containers) {
    const es = clone(WORLD.c24[c.ref]);
    for (const t of c.take) es.push({ baseId: hexId(t.base), count: t.count });
    const lv = WORLD.live[c.ref];
    for (const u of c.uniques) { const e = lv.find((x) => (x.baseId >>> 0) === hexId(u.base) && same(Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'baseId' && k !== 'count')), u.match)); es.push(Object.assign({}, e, { count: u.count })); }
    built[c.ref] = es;
  }
  const G = files('c24'); const pr = mkWorld(built, 5000, 700);
  const E3 = env(pr, { runFile: G.run });
  writeRun(G, { mode: 'apply', stages: [1], confirm: PLAN0.confirm, strict: false });
  E3.tick();
  const back = PLAN0.containers.every((c) => { const a = multiset(inv(pr, hexId(c.ref))), b = multiset(WORLD.c24[c.ref]); return a.size === b.size && [...b].every(([k, n]) => a.get(k) === n); });
  ok(back, 'c24 world: after the apply each container holds exactly what it held on 24 Oct 00:01Z (the Steward\'s own goods, nothing more taken)');
  const cg = inv(pr, A.count).filter((e) => e.baseId === GOLD).reduce((s, e) => s + e.count, 0);
  ok(cg === 5000 - 2095 && pr.get(A.count)['private.bankGold'] === 700 && !ledger(G).steps['gold:mint'], 'c24 world: a Count with 5000 gold gives up exactly 2095, his bank is not touched, nothing minted');
  // strict: the counts differ from what the plan saw, so every changed entry is refused
  const H = files('strict'); const ps = mkWorld(built, 5000, 0); const E4 = env(ps, { runFile: H.run });
  writeRun(H, { mode: 'dryrun', stages: [1] }); E4.tick();
  const R6 = report(H);
  ok(R6.containers.some((c) => c.refused.some((x) => x.status === 'changed')) && R6.containers.every((c) => c.refused.every((x) => x.status === 'changed')), 'strict (default): an entry whose count differs from the plan is refused, never guessed');
  // gold from pack then bank
  const K = files('bank'); const pb = mkWorld(built, 1000, 5000); const E5 = env(pb, { runFile: K.run });
  writeRun(K, { mode: 'apply', stages: [1], confirm: PLAN0.confirm, strict: false }); E5.tick();
  ok(inv(pb, A.count).filter((e) => e.baseId === GOLD).reduce((s, e) => s + e.count, 0) === 0 && pb.get(A.count)['private.bankGold'] === 5000 - 1095, 'gold: 1000 from the pack, the other 1095 from the bank');
}

// ==== refusals ==================================================================================================================
{
  // a one-of-a-kind entry whose charge changed, and a plain stack the Steward took part of
  const lv = clone(WORLD.live); const c0 = PLAN0.containers[0]; const u0 = c0.uniques[0]; const t0 = c0.take.find((t) => t.count >= 2);
  const ue = lv[c0.ref].find((x) => (x.baseId >>> 0) === hexId(u0.base) && same(Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'baseId' && k !== 'count')), u0.match));
  ue.chargePercent = (ue.chargePercent || 0) + 1;
  const st = lv[c0.ref].find((x) => (x.baseId >>> 0) === hexId(t0.base) && Object.keys(x).length === 2); st.count -= 1;
  const G = files('refuse'); const pr = mkWorld(lv, 3000, 0); const E6 = env(pr, { runFile: G.run });
  writeRun(G, { mode: 'apply', stages: [1], confirm: PLAN0.confirm }); E6.tick();
  const R7 = report(G); const c = R7.containers[0];
  ok(c.refused.some((x) => x.uid === u0.uid && x.status === 'missing') && c.refused.some((x) => x.base === t0.base && x.status === 'short' || x.base === t0.base && x.status === 'changed'), 'refused: a changed one-of-a-kind and a stack below the plan, both logged', c.refused);
  ok(inv(pr, hexId(c0.ref)).some((x) => sig(x) === sig(ue)) && plainOf(inv(pr, hexId(c0.ref)), hexId(t0.base)) === st.count, 'refused: neither is taken');
  ok(R7.shortfall.some((x) => x.uid === u0.uid) && E6.logs.some((l) => l.includes(`refused ${c0.ref} ${u0.uid}`)), 'refused: the one-of-a-kind shows as a shortfall and in the log');
}
{
  // a silver item that slipped into a vampire's delivery is held back, not sent
  const plan = clone(PLAN0); const s1 = plan.deliveries.find((d) => d.key === 's1m');
  s1.items.push({ base: '10aa19', desc: plan.deliveries.find((d) => d.key === 'alt').items.find((x) => x.base === '10aa19').desc, name: 'Silver Sword', count: 1, src: 'minted', class: 'Weapons', stage: 1 });
  const G = files('silver'); const pr = mkWorld(WORLD.live, 3000, 0); const E7 = env(pr, { runFile: G.run });
  writeRun(G, { mode: 'apply', stages: [1], confirm: plan.confirm }, plan); E7.tick();
  ok(!m0422(pr, A.player).some((m) => m.parcel.items.some((e) => (e.baseId >>> 0) === 0x10aa19)) && report(G).held.some((x) => x.base === '10aa19'), 'silver guard: a silver piece in a vampire\'s delivery is held back and reported');
}
{
  // the gold from the Bruma treasury instead (goldOrder), and a later run cannot change the order once gold was taken
  const zone = { bruma: 5000 };
  globalThis.__dboTreasuryZoneKeep = globalThis.__dboTreasuryZone;
  const G = files('treasury'); const pr = mkWorld(WORLD.live, 400, 300); const E13 = env(pr, { runFile: G.run });
  globalThis.__dboTreasuryZone = { balance: (z) => zone[z] || 0, spend: (z, n) => { if ((zone[z] || 0) < n) return false; zone[z] -= n; return true; } };
  writeRun(G, { mode: 'apply', stages: [1], confirm: PLAN0.confirm, goldOrder: ['treasury:bruma'] }); E13.tick();
  const cg = inv(pr, A.count).filter((e) => e.baseId === GOLD).reduce((s, e) => s + e.count, 0);
  ok(zone.bruma === 5000 - 2095 && cg === 400 && pr.get(A.count)['private.bankGold'] === 300 && m0422(pr, A.player).reduce((s, m) => s + (m.parcel.gold || 0), 0) === 2095, 'gold from the Bruma treasury: 2095 taken there, the Count untouched, 2095 in the letters');
  writeRun(G, { mode: 'apply', stages: [1, 2], confirm: PLAN0.confirm, goldOrder: ['inventory', 'bank'] }); E13.tick();
  ok(inv(pr, A.count).filter((e) => e.baseId === GOLD).reduce((s, e) => s + e.count, 0) === 400 && pr.get(A.count)['private.bankGold'] === 300 && E13.logs.some((l) => l.includes('of the first apply hold')), 'gold: a changed order after the gold was taken is ignored (no second payment)');
  globalThis.__dboTreasuryZone = globalThis.__dboTreasuryZoneKeep;
}
{
  // a reader online is told once, however many letters
  const G = files('online'); const pr = mkWorld(WORLD.live, 3000, 0); const E12 = env(pr, { runFile: G.run, online: [A.player] });
  writeRun(G, { mode: 'apply', stages: [1], confirm: PLAN0.confirm }); E12.tick();
  ok(E12.said.length === 1 && E12.said[0][0] === A.player && /letters from DragonBreak Staff wait/.test(E12.said[0][1]), 'online: the reader is told once', E12.said);
}
{
  // the load order moved: nothing at all
  const G = files('lo'); const pr = mkWorld(WORLD.live, 3000, 0); const E8 = env(pr, { runFile: G.run, descShift: PLAN0.containers[0].take[0].desc });
  writeRun(G, { mode: 'apply', stages: [1], confirm: PLAN0.confirm }); E8.tick();
  ok(E8.sets.length === 0 && !fs.existsSync(G.ledger) && E8.logs.some((l) => l.includes('load order changed')), 'load order changed: the whole run is refused');
}
{
  // a container change that throws: nothing taken, the step can run again
  const G = files('crash'); const pr = mkWorld(WORLD.live, 3000, 0); const c0 = hexId(PLAN0.containers[0].ref);
  let E9 = env(pr, { runFile: G.run, failSet: (id, k) => id === c0 && k === 'inventory' });
  writeRun(G, { mode: 'apply', stages: [1], confirm: PLAN0.confirm }); E9.tick();
  ok(ledger(G).steps[`take:${PLAN0.containers[0].ref}`].status === 'failed' && JSON.stringify(inv(pr, c0)) === JSON.stringify(WORLD.live[PLAN0.containers[0].ref]), 'crash: a failed container write leaves it untouched and the step failed');
  ok(!m0422(pr, A.player).some((m) => m.parcel.items.some((e) => Object.keys(e).length > 2)), 'crash: the one-of-a-kind items of that container are not sent');
  delete globalThis.__dboM0422; E9 = env(pr, { runFile: G.run });
  writeRun(G, { mode: 'apply', stages: [1], confirm: PLAN0.confirm, again: 1 }); E9.tick();
  ok(ledger(G).steps[`take:${PLAN0.containers[0].ref}`].status === 'done' && plainOf(inv(pr, c0), hexId(PLAN0.containers[0].take[0].base)) === PLAN0.containers[0].take[0].keep + (PLAN0.containers[0].take[0].seen - PLAN0.containers[0].take[0].keep - PLAN0.containers[0].take[0].count), 'crash: the failed step runs on the next apply');
  // a step left "started" (crash between the ledger and the change) is never repeated until staff resolve it
  const L = ledger(G); L.steps[`take:${PLAN0.containers[1].ref}`] = { status: 'started', at: 'x', taken: { plain: {}, uniques: {} } }; delete L.steps[`take:${PLAN0.containers[2].ref}`];
  fs.writeFileSync(G.ledger, JSON.stringify(L));
  const c1 = hexId(PLAN0.containers[1].ref); const c2 = hexId(PLAN0.containers[2].ref);
  const was1 = JSON.stringify(inv(pr, c1));
  writeRun(G, { mode: 'apply', stages: [1], confirm: PLAN0.confirm, again: 2 }); E9.tick();
  ok(JSON.stringify(inv(pr, c1)) === was1 && report(G).stuck.includes(`take:${PLAN0.containers[1].ref}`), 'stuck: a started step is not repeated and is reported');
  writeRun(G, { mode: 'apply', stages: [1], confirm: PLAN0.confirm, resolve: { [`take:${PLAN0.containers[1].ref}`]: 'failed' } }); E9.tick();
  ok(ledger(G).steps[`take:${PLAN0.containers[1].ref}`].status === 'done', 'stuck: resolved "failed" by staff, it runs once');
  void c2;
}
{
  // a letter whose save threw after it reached the mailbox is not sent twice
  const G = files('letter'); const pr = mkWorld(WORLD.live, 3000, 0);
  const E10 = env(pr, { runFile: G.run });
  writeRun(G, { mode: 'apply', stages: [1], confirm: PLAN0.confirm }); E10.tick();
  const L = ledger(G); const id = Object.keys(L.letters).find((k) => L.letters[k].to === 'player'); L.letters[id].status = 'started'; fs.writeFileSync(G.ledger, JSON.stringify(L));
  const n0 = m0422(pr, A.player).length;
  writeRun(G, { mode: 'apply', stages: [1], confirm: PLAN0.confirm, again: 1 }); E10.tick();
  ok(m0422(pr, A.player).length === n0 && ledger(G).letters[id].status === 'done', 'letters: a letter left "started" that is already in the mailbox is marked done, not sent again');
}
{
  // the ledger belongs to one plan: another plan is refused
  const G = files('main'); const plan = clone(PLAN0); plan.hash = 'ffffffffffffffff'; plan.confirm = 'mod-0422-ffffffff';
  const E11 = env(props, { runFile: G.run }); const n = E11.sets.length;
  writeRun(G, { mode: 'apply', stages: [1, 2], confirm: plan.confirm }, plan); E11.tick();
  ok(E11.sets.length === n && E11.logs.some((l) => l.includes('belongs to plan')), 'ledger: a run with another plan is refused while the ledger exists');
}
// the module adds no handler (deploy-batch.sh hot-reload grep)
const src = fs.readFileSync(MOD, 'utf8');
ok(!/mp\.on\(|__dboHandlers *= |for \(const ev of \[/.test(src), 'no mp handler: the hot-reload grep finds nothing in the module');
ok(/require\(MOD0422_JS\)/.test(fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8')), 'gamemode.js loads the module');
ok(fs.readFileSync(path.join(SERVER, '.gitignore'), 'utf8').includes('mod0422-restore*.json'), 'the run, ledger and report files are gitignored');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* tmp */ }
console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
