// Property per character (fork housingSystem.ts, Nate 10 Oct: "dont keep property shared, breaks rp"). With
// housingOwnerPerCharacter a claim whose record names its character (ownerChar) opens for that character, a key holder,
// the managers and staff, and not for another character of the same account; an assigned room for its character only;
// the one-property cap counts per character; a claim or a hand-over writes the character. A record not yet migrated stays
// the account's. Off (the default), everything goes by the account as before. The owner migration names each claim's
// character from its ownerName (dry run: a plan only; apply: once, after a backup, and a rerun changes nothing).
//   node tests/housing-owner-character-harness.js <bundled housingSystem.js>
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const bundle = process.argv[2];
if (!bundle) { console.error('usage: node tests/housing-owner-character-harness.js <bundled housingSystem.js>'); process.exit(2); }
const { HousingSystem } = require(path.resolve(bundle));
if (typeof HousingSystem.prototype.ownsAs !== 'function') { require('./expect')('housing-owner-character', 'this housingSystem has no per-character owners'); console.log('skipped: no per-character owners in this housingSystem'); process.exit(0); }
process.chdir(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-ownerchar-')));
let fails = 0;
const ok = (c, what, got) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}${!c && got !== undefined ? '   ' + JSON.stringify(got).slice(0, 400) : ''}`); if (!c) fails++; };
const H = (n) => (0x08000000 | n) >>> 0;
const HOUSE = H(0x100), HOUSE_IN = H(0x101), CHEST = H(0x102), ROOM = H(0x103), OTHER = H(0x200), OTHER_IN = H(0x201), LOOSE = H(0x300);
const WORLD = 'w:Test.esm', INSIDE = 'c1:Test.esm', INSIDE2 = 'c2:Test.esm';
const CELLS = { [HOUSE]: WORLD, [HOUSE_IN]: INSIDE, [CHEST]: INSIDE, [ROOM]: INSIDE, [OTHER]: WORLD, [OTHER_IN]: INSIDE2, [LOOSE]: WORLD };
const TYPES = { [HOUSE]: 'DOOR', [HOUSE_IN]: 'DOOR', [CHEST]: 'CONT', [ROOM]: 'DOOR', [OTHER]: 'DOOR', [OTHER_IN]: 'DOOR', [LOOSE]: 'CONT' };
const PARTNER = { [HOUSE]: HOUSE_IN, [HOUSE_IN]: HOUSE, [OTHER]: OTHER_IN, [OTHER_IN]: OTHER };
// Account 60: Kojus (0xff000060, slot 0, owns the house) and his alt Pesrae (0xff000061, slot 1); a key holder, a stranger
const KOJUS = 0xff000060, ALT = 0xff000061, THIRD = 0xff000067, KEYHOLDER = 0xff000063, STRANGER = 0xff000062, ADMIN = 0xff000064, MASKED = 0xff000065, LONE = 0xff000066;
const PROFILE = { [KOJUS]: 60, [ALT]: 60, [THIRD]: 60, [KEYHOLDER]: 63, [STRANGER]: 62, [ADMIN]: 64, [MASKED]: 70, [LONE]: 71 };
const NAME = { [KOJUS]: 'Kojus Animus', [ALT]: 'Pesrae Animus', [THIRD]: 'Third Animus', [KEYHOLDER]: 'Holder', [STRANGER]: 'Stranger One', [ADMIN]: 'Staff', [MASKED]: 'Masked Person', [LONE]: 'Renamed Now' };
const SLOT = { [KOJUS]: 0, [ALT]: 1, [THIRD]: 2, [KEYHOLDER]: 0, [STRANGER]: 0, [ADMIN]: 0, [MASKED]: 0, [LONE]: 0 };
const props = new Map();
const keyItem = (name) => ({ baseId: 0xdb0e2, count: 1, name });
const inventories = { [KEYHOLDER]: [keyItem('Key to Kojus Hall')] };
const mp = {
  get: (id, k) => {
    id >>>= 0;
    if (k === 'profileId') return PROFILE[id] || 0;
    if (k === 'appearance') return NAME[id] ? { name: NAME[id] } : undefined;
    if (k === 'private.charSlot') { if (!(id in SLOT)) throw new Error('gone'); return SLOT[id]; }
    if (k === 'maskName') return id === MASKED ? 'Raven The Shield' : undefined;
    if (k === 'inventory') return { entries: inventories[id] || [] };
    if (k === 'worldOrCellDesc') return CELLS[id];
    const v = props.get(`${id}:${k}`); return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  },
  set: (id, k, v) => props.set(`${id >>> 0}:${k}`, JSON.parse(JSON.stringify(v))),
  getActorsByProfileId: (p) => Object.keys(PROFILE).map(Number).filter((a) => PROFILE[a] === p),
  getUserByActor: () => -1, getUserActor: () => 0, isConnected: () => false, sendCustomPacket: () => {},
};
const ctx = { svr: mp };
const base = (o) => Object.assign({ owner: 60, ownerName: 'Kojus Animus', name: 'Kojus Hall', locked: true, serial: 1, partner: 0, containers: [], issued: ['Key to Kojus Hall'] }, o);
const reset = () => {
  props.clear();
  props.set(`${HOUSE}:private.housing`, base({ ownerChar: KOJUS, partner: HOUSE_IN, place: { cells: [INSIDE], builtAt: 1 }, assigned: { [ROOM.toString(16)]: { profile: 60, name: 'Pesrae Animus', char: ALT } } }));
  props.set(`${HOUSE_IN}:private.housing`, { primary: HOUSE });
  props.set(`${CHEST}:private.housing`, base({ ownerChar: KOJUS, memberOf: HOUSE, ownerOnly: true, locked: false, issued: [] }));
};
reset();
const sys = new HousingSystem(() => {});
sys.holdOf = () => null; sys.isAdmin = (c, a) => a === ADMIN; sys.holdRanks = () => []; sys.saveRegistry = () => {};
sys.primaryOf = (c, id) => (PARTNER[id >>> 0] && (id >>> 0) > PARTNER[id >>> 0] ? PARTNER[id >>> 0] : id >>> 0);
sys.partnerOf = (c, id) => PARTNER[id >>> 0] || 0;
sys.userOf = () => -1; sys.notice = () => {}; sys.send = () => {};
sys.claimed = [HOUSE, CHEST];
sys.baseTypeOf = (c, id) => TYPES[id >>> 0] || '';
sys.isWorldDesc = (c, d) => d === WORLD;
sys.placeMigration = 'apply';
sys.refsInCell = () => [];
const rec = (id) => sys.read(ctx, id);
const access = (id, who) => sys.hasAccess(ctx, id, rec(id), who);
const opens = (id, who) => sys.onActivate(ctx, id, who);

// ---- off (the default): the account, as before ------------------------------------------------------------------------
sys.perCharacter = false;
ok(access(HOUSE, KOJUS) === true && access(HOUSE, ALT) === true, 'off: the owner and his alt (one account) both hold the house, as before');
ok(opens(CHEST, ALT) === true, "off: the alt opens the owner-only chest, as before");
ok(sys.overCap(ctx, 60, ALT, true, true) !== '', 'off: the alt cannot take a second property; the account holds one');

// ---- on: one character ------------------------------------------------------------------------------------------------
sys.perCharacter = true;
ok(access(HOUSE, KOJUS) === true, 'on: the owning character holds the house');
ok(access(HOUSE, ALT) === false, 'on: his alt does not');
ok(access(HOUSE, KEYHOLDER) === true, 'on: a key holder still gets in');
ok(access(HOUSE, STRANGER) === false, 'on: a stranger does not');
ok(access(HOUSE, ADMIN) === true, 'on: staff keep their powers');
ok(opens(CHEST, KOJUS) === true && opens(CHEST, ALT) === false && opens(CHEST, KEYHOLDER) === false, "on: the owner-only chest opens for the owning character only (not the alt, not the household)");
ok(sys.placeRefAccess(ctx, HOUSE, rec(HOUSE), ROOM, sys.viewerAccess(ctx, ALT)) === true && sys.placeRefAccess(ctx, HOUSE, rec(HOUSE), ROOM, sys.viewerAccess(ctx, KOJUS)) === true,
  'on: the room assigned to the alt (a character of its own) opens for her and for the owner');
const assignedToKojusAccount = base({ ownerChar: KOJUS, partner: HOUSE_IN, place: { cells: [INSIDE], builtAt: 1 }, assigned: { [ROOM.toString(16)]: { profile: 63, name: 'Holder', char: KEYHOLDER } } });
ok(sys.placeRefAccess(ctx, HOUSE, assignedToKojusAccount, ROOM, sys.viewerAccess(ctx, ALT)) === false, 'on: a room assigned to another character is not the alt\'s');
ok(sys.overCap(ctx, 60, KOJUS, true, true) !== '', 'on: the owning character cannot take a second property');
ok(sys.overCap(ctx, 60, ALT, true, true) === '', 'on: his alt may hold one of her own (the cap counts per character)');
// At most two houses an account (Nate, 10 Oct): with the alt holding one too, a third character of the account is refused
props.set(`${OTHER}:private.housing`, base({ ownerChar: ALT, ownerName: 'Pesrae Animus', partner: OTHER_IN, place: { cells: [INSIDE2], builtAt: 1 } }));
sys.claimed.push(OTHER);
ok(/between them, the most one account may/.test(sys.overCap(ctx, 60, THIRD, true, true)), 'on: a third character of an account already holding two houses is refused, with its own line', sys.overCap(ctx, 60, THIRD, true, true));
ok(sys.overCap(ctx, 60, THIRD, true, false) === '', '...a loose chest or room is no house and is not refused');
ok(sys.isStaff(ctx, 60, THIRD) === false && (() => { const was = sys.isStaff; sys.isStaff = () => true; const r = sys.overCap(ctx, 60, THIRD, true, true); sys.isStaff = was; return r === ''; })(), '...staff are exempt');
sys.placeCapPerAccount = 3;
ok(sys.overCap(ctx, 60, THIRD, true, true) === '', '...housingPlaceCapPerAccount 3 lets it through');
sys.placeCapPerAccount = 2;
sys.claimed.pop(); props.delete(`${OTHER}:private.housing`);
// A record the migration has not named yet is still the account's
props.set(`${HOUSE}:private.housing`, Object.assign(rec(HOUSE), { ownerChar: undefined }));
ok(access(HOUSE, ALT) === true, 'on: a claim not yet migrated (no ownerChar) stays the account\'s');
reset();

// ---- the view the gameplay asks ---------------------------------------------------------------------------------------
sys.exposeTenancy(ctx);
const V = globalThis.__dboHousing;
ok(V.perCharacter() === true && V.ownsRecord(rec(HOUSE), KOJUS) === true && V.ownsRecord(rec(HOUSE), ALT) === false, '__dboHousing.ownsRecord: the character, not the account');
ok(JSON.stringify(V.ownerActorsOf(rec(HOUSE))) === JSON.stringify([KOJUS]) && V.ownerKeyOf(rec(HOUSE)) === `c${KOJUS.toString(16)}`, '__dboHousing.ownerActorsOf / ownerKeyOf: the owning character');
ok(V.keyOpens(HOUSE, KEYHOLDER) === true && V.keyOpens(HOUSE, STRANGER) === false && V.keyOpens(HOUSE, KOJUS) === false, '__dboHousing.keyOpens: a key the actor carries, and only that');
sys.perCharacter = false;
ok(V.ownerActorsOf(rec(HOUSE)).length === 3 && V.ownerKeyOf(rec(HOUSE)) === '60' && V.ownsRecord(rec(HOUSE), ALT) === true, '...off: the account\'s characters and its profile id');
sys.perCharacter = true;

// ---- claims and hand-overs write the character ------------------------------------------------------------------------
sys.openClaims = true; sys.nearProperty = () => true; sys.withinReach = () => true; sys.actorOf = (c, u) => u; sys.sendMenu = () => {};
sys.isBuilding = () => false; sys.ensurePlace = () => {};
sys.onPropertyRequest(ctx, ALT, { target: LOOSE, action: 'claim' });
ok(rec(LOOSE) && rec(LOOSE).owner === 60 && rec(LOOSE).ownerChar === ALT && rec(LOOSE).ownerName === 'Pesrae Animus', 'a claim records its character', rec(LOOSE));
sys.lastRequestMs = new Map();
sys.onPropertyRequest(ctx, ALT, { target: LOOSE, action: 'transfer', recipient: KOJUS });
ok(rec(LOOSE).ownerChar === KOJUS && rec(LOOSE).owner === 60, 'on: handed to another character of the same account, it is his now', rec(LOOSE));
sys.perCharacter = false; sys.lastRequestMs = new Map();
sys.onPropertyRequest(ctx, KOJUS, { target: LOOSE, action: 'transfer', recipient: ALT });
ok(rec(LOOSE).ownerChar === KOJUS, 'off: a hand-over within one account is refused ("They already own it"), as before');
sys.perCharacter = true;
sys.lastRequestMs = new Map();
sys.onPropertyRequest(ctx, KOJUS, { target: LOOSE, action: 'abandon' });
ok(rec(LOOSE).owner === 0 && rec(LOOSE).ownerChar === undefined, 'giving it up clears the character with the owner', rec(LOOSE));

// ---- a masked claim records the real name --------------------------------------------------------------------------
sys.lastRequestMs = new Map();
sys.onPropertyRequest(ctx, MASKED, { target: LOOSE, action: 'claim' });
ok(rec(LOOSE).ownerName === 'Raven The Shield' && rec(LOOSE).ownerChar === MASKED, 'a masked character\'s claim records the real name, not "Masked Person"', rec(LOOSE));

// ---- a faction's hall follows its current leader (guilds.js __dboHallLeader) ---------------------------------------
sys.isBuilding = HousingSystem.prototype.isBuilding;
let hallLeader = STRANGER;
globalThis.__dboHallLeader = (refs, a) => refs.includes(HOUSE) && a === hallLeader;
sys.lastRequestMs = new Map();
sys.onPropertyRequest(ctx, STRANGER, { target: HOUSE, action: 'rename', name: 'Guild House' });
ok(rec(HOUSE).name === 'Guild House', "the faction's leader has the owner's powers over its hall (renames it), whoever owns the building", rec(HOUSE).name);
hallLeader = KEYHOLDER; sys.lastRequestMs = new Map();
sys.onPropertyRequest(ctx, STRANGER, { target: HOUSE, action: 'rename', name: 'Old Leader' });
ok(rec(HOUSE).name === 'Guild House', '...a leader who has stepped down has them no more');
sys.lastRequestMs = new Map();
sys.onPropertyRequest(ctx, KEYHOLDER, { target: HOUSE, action: 'rename', name: 'New Leader' });
ok(rec(HOUSE).name === 'New Leader', '...the new leader has them at once');
delete globalThis.__dboHallLeader;
reset();

// ---- the owner migration ----------------------------------------------------------------------------------------------
const fixture = () => {
  props.clear(); sys.claimed = [];
  const put = (ref, r) => { props.set(`${ref}:private.housing`, r); sys.claimed.push(ref); };
  put(H(0x400), base({ ownerName: 'Pesrae Animus', partner: 0 }));                            // names the alt (slot 1)
  put(H(0x401), base({ ownerName: 'Kojus Animus', partner: 0, place: { cells: [INSIDE], builtAt: 1 }, assigned: { abc: { profile: 60, name: 'Pesrae Animus' } } }));
  put(H(0x402), base({ ownerName: 'Somebody Old', partner: 0, memberOf: H(0x401) }));         // a member goes with its root
  put(H(0x403), base({ owner: 70, ownerName: 'Raven The Shield', partner: 0 }));              // masked now: by the real name
  put(H(0x404), base({ owner: 71, ownerName: 'Old Name', partner: 0 }));                      // renamed, the only character
  put(H(0x405), base({ ownerName: 'Masked Person', partner: 0 }));                             // names no one: the first by slot
  put(H(0x406), base({ owner: 99, ownerName: 'Ghost', partner: 0 }));                          // no characters left
  put(H(0x407), base({ ownerName: 'Kojus', partner: 0 }));                                     // part of a name
  put(H(0x408), base({ ownerName: 'Pesrae Animus', ownerChar: KOJUS, partner: 0 }));           // named already: kept
};
fixture();
sys.ownerMigration = 'dryrun';
ok(sys.dryRunOwners(ctx) === true, 'the dry run plans once every claim is readable');
const plan = JSON.parse(fs.readFileSync('housing-owners-plan.json', 'utf8'));
const dec = (ref, room = '') => plan.decisions.find((d) => d.ref === H(ref).toString(16) && d.room === room) || {};
ok(dec(0x400).char === ALT.toString(16) && dec(0x400).how === 'name', 'by its ownerName: the alt\'s claim is the alt\'s', dec(0x400));
ok(dec(0x401).char === KOJUS.toString(16) && dec(0x401, 'abc').char === ALT.toString(16), 'the house is Kojus\'s, its room assigned to Pesrae is hers', [dec(0x401), dec(0x401, 'abc')]);
ok(dec(0x402).char === KOJUS.toString(16) && dec(0x402).how === 'root', 'a member of a place goes with its root, whatever name it carries', dec(0x402));
ok(dec(0x403).char === MASKED.toString(16) && dec(0x403).how === 'name', 'a masked character is found by the real name it keeps', dec(0x403));
ok(dec(0x404).char === LONE.toString(16) && dec(0x404).how === 'only', 'a renamed owner: the account\'s only character', dec(0x404));
ok(dec(0x405).char === KOJUS.toString(16) && dec(0x405).how === 'first' && /names no one/.test(dec(0x405).note), '"Masked Person" names no one: the first character by slot, flagged', dec(0x405));
ok(dec(0x406).char === '' && dec(0x406).how === 'none', 'an account with no characters left: nobody, left to the account', dec(0x406));
ok(dec(0x407).char === KOJUS.toString(16) && dec(0x407).how === 'name-partial', 'part of a name ("Kojus"): the one character it fits', dec(0x407));
ok(dec(0x408).how === 'kept' && dec(0x408).char === KOJUS.toString(16), 'a record that names its character is kept as it is', dec(0x408));
ok(rec(H(0x400)).ownerChar === undefined && !fs.readdirSync('.').some((f) => f.startsWith('housing-owners-backup-')), 'dry run: nothing written, no backup');

sys.ownerMigration = 'apply';
sys.dryRunOwners(ctx);
const backups = fs.readdirSync('.').filter((f) => f.startsWith('housing-owners-backup-'));
ok(backups.length === 1 && JSON.parse(fs.readFileSync(backups[0], 'utf8')).records[H(0x400).toString(16)].ownerName === 'Pesrae Animus', 'apply: a backup of the records as they were, first');
ok(rec(H(0x400)).ownerChar === ALT && rec(H(0x401)).ownerChar === KOJUS && rec(H(0x402)).ownerChar === KOJUS && rec(H(0x401)).assigned.abc.char === ALT, 'apply: ownerChar and the room\'s char written');
ok(rec(H(0x406)).ownerChar === undefined && rec(H(0x408)).ownerChar === KOJUS, 'apply: the unresolved and the named are left as they are');
const before = JSON.stringify([...props.entries()]);
sys.dryRunOwners(ctx);
ok(JSON.stringify([...props.entries()]) === before && fs.readdirSync('.').filter((f) => f.startsWith('housing-owners-backup-')).length === 1, 'a second apply changes nothing and takes no backup (idempotent)');
const plan2 = JSON.parse(fs.readFileSync('housing-owners-plan.json', 'utf8'));
ok(plan2.decisions.filter((d) => d.how !== 'none').every((d) => d.how === 'kept'), 'the rerun plan reads every resolved claim as kept', plan2.counts);
// An unreadable claim holds the plan back until the last try, and nothing is applied on it
fixture(); sys.claimed.push(H(0x499));
props.set(`${H(0x499)}:private.housing`, 'garbage');
ok(sys.dryRunOwners(ctx) === false, 'an unreadable claim: the plan waits for a later try');
ok(sys.dryRunOwners(ctx, true) === true && rec(H(0x400)).ownerChar === undefined, '...on the last try it plans and applies nothing');

console.log(fails ? `${fails} failure(s)` : 'all passed');
process.exit(fails ? 1 : 0);
