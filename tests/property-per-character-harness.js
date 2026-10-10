// Property per character (Nate, 10 Oct): economy.js charges a house's weekly tax to the character who owns it, not the
// richest of its account, and tells only that character; ledgersale.js pays a ledger's owner share into the owning
// character's bank. The housing view stands in for fork housingSystem.ts (ownsRecord, ownerActorsOf, ownerKeyOf), with
// housingOwnerPerCharacter on and off; off, both go by the account as before.
//
//   node tests/property-per-character-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
process.chdir(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-propchar-')));

let failures = 0;
const check = (label, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail !== undefined ? '   ' + JSON.stringify(detail) : ''}`); if (!ok) failures++; };

let now = Date.UTC(2026, 8, 26, 12, 0); // Saturday
Date.now = () => now;

// Account 11 has two characters: 0x20 (Lydia, owns the house) and 0x21 (an alt, richer)
const HOUSE = 0x100, HOUSE_OUT = 0x200, SHOP = 0x300;
fs.writeFileSync('housing.json', JSON.stringify([HOUSE]));
const rec = { owner: 11, ownerChar: 0x20, ownerName: 'Lydia', partner: HOUSE_OUT };
const chars = { 11: [0x20, 0x21] };
const props = new Map();
const places = { [HOUSE]: 'c1:Test.esm', [HOUSE_OUT]: 'w:Test.esm', [SHOP]: 'c1:Test.esm' };
const ids = { 'c1:Test.esm': 0xc1, 'w:Test.esm': 0xee };
const mp = {
  get: (id, p) => {
    if (p === 'worldOrCellDesc') return places[id];
    if (p === 'pos') return id === HOUSE_OUT ? [1, 1, 0] : [0, 0, 0];
    if (p === 'private.housing') return id === HOUSE ? rec : undefined;
    if (p === 'type') return 'ObjectReference';
    return props.get(`${id}|${p}`);
  },
  set: (id, p, v) => props.set(`${id}|${p}`, v),
  getActorsByProfileId: (pid) => chars[pid] || [],
  getIdFromDesc: (d) => { if (!(d in ids)) throw new Error('no desc'); return ids[d]; },
  getDescFromId: (id) => Object.keys(ids).find((k) => ids[k] === id) || '',
  lookupEspmRecordById: (id) => (id === 0xc1 ? { record: { type: 'CELL' } } : id === 0xee ? { record: { type: 'WRLD' } } : null),
};
const bal = (a) => props.get(`${a}|private.bankGold`) || 0;
const setBal = (a, n) => props.set(`${a}|private.bankGold`, n);

let perChar = true;
const ownerChar = (r) => (perChar && r.ownerChar ? r.ownerChar >>> 0 : 0);
globalThis.__dboHousing = {
  recordOf: (r) => (r === HOUSE ? rec : null), primaryOf: (r) => (r === HOUSE ? r : 0), isManager: () => false, isBuilding: () => true,
  perCharacter: () => perChar,
  ownsRecord: (r, a) => (ownerChar(r) ? ownerChar(r) === (a >>> 0) : (chars[r.owner] || []).includes(a >>> 0)),
  ownerActorsOf: (r) => (ownerChar(r) ? [ownerChar(r)] : chars[r.owner] || []),
  ownerKeyOf: (r) => (ownerChar(r) ? `c${ownerChar(r).toString(16)}` : String(r.owner)),
};
const treasuries = { 'county-bruma': 1000 };
globalThis.__dboTreasury = { balance: (f) => treasuries[f] || 0, spend: () => false, deposit: (f, n) => { treasuries[f] = (treasuries[f] || 0) + n; return true; } };
globalThis.__dboRealmTerritoryAt = (w) => (w === 'w:Test.esm' ? { id: 'applewatch', name: 'Applewatch' } : null);
globalThis.__dboRealmOwnerOf = () => 'county-bruma';
globalThis.__dboRealmLeads = (a, f) => a === 1 && f === 'county-bruma';
globalThis.__dboRealmFactionsLedBy = (a) => (a === 1 ? ['county-bruma'] : []);
globalThis.__dboGuildInfo = (f) => ({ id: f, name: 'County of Bruma', kind: 'hold', zone: 'bruma' });
globalThis.__dboGuildMembers = () => [];
globalThis.__dboGuildsOf = () => [];
globalThis.__dboGuildRanks = () => [];
globalThis.__dboFactionNonceOk = () => true;
const replies = [];
globalThis.__dboFactionRefresh = (a, text, ok) => { replies.push({ a, text, ok }); return true; };

const out = { personal: [], audits: [] };
const handlers = new Map(); const timers = new Map();
const api = {
  mp, log: () => {}, personal: (a, t) => out.personal.push({ a, t }), audit: (t) => out.audits.push(t), who: (a) => `P${a.toString(16)}`,
  cfg: { economy: { enabled: true, wageShare: 1 } }, onUi: (ev, f) => handlers.set(ev, f), onlineActors: () => [1, 0x20, 0x21], every: (n, ms, f) => timers.set(n, f),
  readOfficials: () => ({}), zoneById: () => null, depositToTreasury: (z, n) => { treasuries[`hold:${z}`] = (treasuries[`hold:${z}`] || 0) + n; return n; }, zoneOfActor: () => 'bruma',
};

// ---- economy: the weekly tax ---------------------------------------------------------------------------------------
const ECON = path.join(SERVER, 'economy.js');
const reckon = () => {
  try { fs.unlinkSync('economy.json'); } catch (e) { /* first run */ }
  delete globalThis.__dboEconomy;
  handlers.clear(); delete require.cache[ECON]; require(ECON)(api);
  replies.length = 0; handlers.get('econRate')(1, ['nonce', 'county-bruma', 10]);
  now = Date.UTC(2026, 8, 26, 12, 0); timers.get('economy')();
  now = Date.UTC(2026, 8, 27, 0, 1); timers.get('economy')();
};
setBal(0x20, 250); setBal(0x21, 300); out.personal.length = 0;
perChar = true; reckon();
check('per character: the 200 gold tax (10% of 2,000) comes from the owning character, not the richer alt', bal(0x20) === 50 && bal(0x21) === 300, [bal(0x20), bal(0x21)]);

setBal(0x20, 100); setBal(0x21, 300); out.personal.length = 0;
reckon();
const overdue = JSON.parse(fs.readFileSync('economy.json', 'utf8')).overdue[String(HOUSE)];
check('per character: an owner who cannot pay is overdue even while the alt could', bal(0x20) === 100 && bal(0x21) === 300 && !!overdue && overdue.gold === 200, { b: [bal(0x20), bal(0x21)], overdue });
check('...and only the owning character is told', out.personal.some((x) => x.a === 0x20 && /overdue/.test(x.t)) && !out.personal.some((x) => x.a === 0x21 && /overdue/.test(x.t)), out.personal);

setBal(0x20, 250); setBal(0x21, 300); out.personal.length = 0;
perChar = false; reckon();
check('account (the switch off): the tax comes from the richest character of the account, as before', bal(0x21) === 100 && bal(0x20) === 250, [bal(0x20), bal(0x21)]);

// ---- ledgersale: the owner's share of a ledger sale --------------------------------------------------------------
const LS = path.join(SERVER, 'ledgersale.js');
const sell = () => { delete require.cache[LS]; require(LS)(Object.assign({}, api, { cfg: { ledgerSale: { enabled: true, sinkShare: 0.1, defaultTax: 0.1 } } })); return globalThis.__dboLedgerSale({ buyer: 0x50, place: SHOP, price: 100, what: 'bread' }); };
setBal(0x20, 0); setBal(0x21, 0);
perChar = true;
let r = sell();
check('per character: 80 of a 100 gold sale goes to the owning character\'s bank, though the account lists another first', bal(0x20) === 80 && bal(0x21) === 0 && r.owner.kind === 'bank', { b: [bal(0x20), bal(0x21)], r });
chars[11] = [0x21, 0x20]; setBal(0x20, 0); setBal(0x21, 0);
r = sell();
check('...whatever order the account lists its characters in', bal(0x20) === 80 && bal(0x21) === 0, [bal(0x20), bal(0x21)]);
perChar = false; setBal(0x20, 0); setBal(0x21, 0);
r = sell();
check('account (the switch off): the account\'s first character is paid, as before', bal(0x21) === 80 && bal(0x20) === 0, [bal(0x20), bal(0x21)]);

console.log(failures ? `${failures} failure(s)` : 'all passed');
process.exit(failures ? 1 : 0);
