// restitution.js (Nate, 12 Oct 2026, ticket #0138): what a thief took is removed, up to each count, from their pack, their
// bank balance (gold) and the containers they stashed it in (capped at what they put there). Loads the real restitution.js,
// restitution-cases.json and gamemode-config.json against a fake mp.
//   node tests/restitution-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };
const CFG = JSON.parse(fs.readFileSync(path.join(SERVER, 'gamemode-config.json'), 'utf8'));
const CASES = JSON.parse(fs.readFileSync(path.join(SERVER, 'restitution-cases.json'), 'utf8'));
const MOD = path.join(SERVER, 'restitution.js');
const { take, owed } = require(MOD);
const THIEF = 0xff000700, OTHER = 0xff000701, BOX = 0x0806535b;
const C0138 = CASES['0138'];

// the shipped case
ok(CFG.restitution && CFG.restitution.enabled === true && CFG.restitution.cases.includes('0138'), 'gamemode-config restitution on, case 0138');
const sum = (m) => Object.values(m).reduce((s, n) => s + n, 0);
ok(C0138.tag === 'MTK7' && sum(C0138.items) === 649 && C0138.items.f === 352 && Object.keys(C0138.items).length === 48, 'case 0138: #MTK7, 649 items in 48 kinds, 352 gold');
ok(Object.values(C0138.containers).every((cap) => Object.entries(cap).every(([h, n]) => n <= (C0138.items[h] || 0))), 'every container cap is within what was taken');
const gm = fs.readFileSync(path.join(SERVER, 'gamemode.js'), 'utf8');
ok(/__dboSprStripLogin\(a\);[^\n]*\n(?:\s*try \{ if \(globalThis\.__dboGearStripLogin\)[^\n]*\n)?\s*try \{ if \(globalThis\.__dboRestitutionLogin\)/.test(gm), 'gamemode.js: login hook (after the SPR strip, and the gear strip when there is one)');
ok(/__dboSprStripContainer\(targetId >>> 0\);[^\n]*\n(?:\s*try \{ if \(globalThis\.__dboGearStripContainer\)[^\n]*\n)?\s*try \{ if \(globalThis\.__dboRestitutionContainer\)/.test(gm), 'gamemode.js: container hook (after the SPR strip, and the gear strip when there is one)');
ok(fs.readFileSync(path.join(SERVER, '.gitignore'), 'utf8').includes('restitution-state.json'), 'state file is gitignored');

// pure
const t = take([{ baseId: 0xf, count: 100 }, { baseId: 0x800e4, count: 5, worn: true }, { baseId: 0x123, count: 2 }], { f: 30, '800e4': 9 });
ok(JSON.stringify(t.taken) === JSON.stringify({ f: 30, '800e4': 5 }) && t.entries.length === 2 && t.entries[0].count === 70 && t.worn[0] === '800e4', 'take: partial stack kept, whole stack removed, worn noted', t);
ok(JSON.stringify(owed({ f: 10, a: 2 }, { f: 4, a: 2 })) === JSON.stringify({ f: 6 }), 'owed: what is left');

// against a fake world, with a small case
const tmp = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-restitution-'));
const casesFile = path.join(tmp, 'cases.json');
fs.writeFileSync(casesFile, JSON.stringify({ T1: { tag: 'TEST', items: { f: 300, '800e4': 10, '5ace5': 4 }, containers: { '6535b:BSHeartland.esm': { '800e4': 3 } } } }));
const props = new Map(); const audits = []; const said = []; let failSet = false;
const set = (id, k, v) => { if (failSet && k === 'inventory') throw new Error('boom'); if (!props.has(id)) props.set(id, {}); props.get(id)[k] = JSON.parse(JSON.stringify(v)); };
const get = (id, k) => { const p = props.get(id); return p && k in p ? JSON.parse(JSON.stringify(p[k])) : undefined; };
const load = () => {
  let timer = null;
  delete require.cache[MOD];
  require(MOD)({
    mp: { get, set, getIdFromDesc: (d) => (d === '6535b:BSHeartland.esm' ? BOX : 0), getDescFromId: (id) => id.toString(16), callPapyrusFunction: () => {} },
    log: () => {}, personal: (a, m) => said.push([a, m]), audit: (m) => audits.push(m), who: (a) => a.toString(16),
    onlineActors: () => [THIEF, OTHER], every: (n, ms, fn) => { timer = fn; }, stopTimer: () => {},
    cfg: { restitution: { enabled: true, cases: ['T1'], casesFile, stateFile: path.join(tmp, 'state.json') } }
  });
  return () => timer && timer();
};
set(THIEF, 'private.charTag', 'TEST'); set(OTHER, 'private.charTag', 'ZZZZ');
set(THIEF, 'inventory', { entries: [{ baseId: 0xf, count: 120 }, { baseId: 0x800e4, count: 4 }, { baseId: 0x999, count: 1 }] });
set(THIEF, 'private.bankGold', 500);
set(OTHER, 'inventory', { entries: [{ baseId: 0xf, count: 1000 }, { baseId: 0x800e4, count: 50 }] });
set(BOX, 'inventory', { entries: [{ baseId: 0x800e4, count: 20 }, { baseId: 0x5ace5, count: 9 }] });
const sweep = load();
globalThis.__dboRestitutionLogin(THIEF);
const inv = (id) => get(id, 'inventory').entries.map((e) => `${e.baseId.toString(16)}:${e.count}`).join(' ');
ok(inv(THIEF) === '999:1', 'login: the stolen kinds leave the pack, other items stay', inv(THIEF));
ok(get(THIEF, 'private.bankGold') === 320, 'the gold still owed (180) comes from the bank', get(THIEF, 'private.bankGold'));
ok(said.length === 1 && said[0][0] === THIEF, 'the thief is told once');
sweep();
ok(inv(OTHER) === 'f:1000 800e4:50', 'another character is never touched', inv(OTHER));
ok(inv(BOX) === '800e4:17 5ace5:9', 'the container gives up only what was put there (3 strips), not the steel', inv(BOX));
globalThis.__dboRestitutionLogin(THIEF); sweep();
ok(get(THIEF, 'private.bankGold') === 320 && inv(BOX) === '800e4:17 5ace5:9', 'a second pass takes nothing more');
const st = globalThis.__dboRestitutionState().cases.T1;
ok(JSON.stringify(st.recovered) === JSON.stringify({ f: 300, '800e4': 7 }), 'state: 300 gold and 7 strips recovered', st.recovered);

// reload keeps the count; a failed change is put back
set(THIEF, 'inventory', { entries: [{ baseId: 0x800e4, count: 10 }, { baseId: 0x5ace5, count: 10 }] });
delete globalThis.__dboRestitutionS;
load();
failSet = true; globalThis.__dboRestitutionLogin(THIEF); failSet = false;
ok(JSON.stringify(globalThis.__dboRestitutionState().cases.T1.recovered) === JSON.stringify({ f: 300, '800e4': 7 }), 'a failed removal leaves the state as it was');
globalThis.__dboRestitutionLogin(THIEF);
ok(inv(THIEF) === '800e4:7 5ace5:6', 'after a reload, only the rest (3 strips, 4 steel) is taken', inv(THIEF));
ok(audits.every((a) => a.startsWith('RESTITUTION T1 took')), 'every removal is audited');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
