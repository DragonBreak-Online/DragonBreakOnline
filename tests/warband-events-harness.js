// GM events, phase 1 (warband.js): the event record, the private.dboEvent tag, the paced sweep and the
// watchdog that ends an event across a restart. Design _work\warband-revamp-1101.md; Nat approved 1 Nov.
//
// A mock gamemode api, a mock mp with per-actor properties, and a mock __dboCompanions. No server and no
// game. The restart case is the point of the design, so it is simulated honestly: the in-memory state is
// dropped, the module is re-required, and **every dynamic id is reassigned** — because that is what the
// engine does, and it is why a member is stored as its change-form desc rather than its id.
//   node tests/warband-events-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE = path.resolve(__dirname, '..', 'warband.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-wbevents-'));
const home = process.cwd();
process.chdir(dir);

let failures = 0;
const check = (label, ok, got) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${got !== undefined && !ok ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

// ---- the mock world ------------------------------------------------------------------------------
const GM1 = 0x1001, GM2 = 0x1002;
let props, descToId, idToDesc, destroyed, nextId, said, audits, logs;
const reset = () => {
  props = new Map();                 // `${id}|${prop}` -> value
  descToId = new Map();
  idToDesc = new Map();
  destroyed = [];
  nextId = 0xff000100;
  said = [];
  audits = [];
  logs = [];
  companions = new Map();
  // The module keeps its state on globalThis so a hot reload does not lose it, and persists events to
  // disk - so a section that does not clear both is reading the previous section's event.
  delete globalThis.__dboWarband;
  delete globalThis.__dboWarbandSaid;
  try { fs.rmSync(path.join(dir, 'warband-events.json'), { force: true }); } catch (e) { /* not there */ }
};
const key = (id, p) => `${id >>> 0}|${p}`;
const mp = {
  get: (id, p) => {
    if (p === 'profileId') return id === GM1 ? 2 : id === GM2 ? 47 : undefined;
    return props.get(key(id, p));
  },
  set: (id, p, v) => { props.set(key(id, p), v); },
  getDescFromId: (id) => idToDesc.get(id >>> 0) || '',
  getIdFromDesc: (d) => descToId.get(String(d)) || 0,
  getActorPos: () => [100, 200, 300],
  destroyActor: (id) => { destroyed.push(id >>> 0); },
  makeProperty: () => {},
  lookupEspmRecordById: () => null,
};
// A companion as companionSystem would hand it out, with a change-form desc the way live has them
// (measured: bare dynamic indices like 'db41', no plugin).
let companions = new Map();          // owner -> [{ id, kind }]
const spawn = (owner, descName) => {
  const id = nextId++;
  descToId.set(descName, id);
  idToDesc.set(id, descName);
  props.set(key(id, 'isDead'), false);
  const list = companions.get(owner) || [];
  list.push({ id, kind: 'companion', name: descName });
  companions.set(owner, list);
  return id;
};
// Reassigning every dynamic id is what a restart does. The descs stay; the ids do not.
const reassignIds = () => {
  const pairs = Array.from(idToDesc.entries());
  const oldProps = props;
  props = new Map();
  descToId = new Map();
  idToDesc = new Map();
  for (const [oldId, desc] of pairs) {
    const id = nextId++;
    descToId.set(desc, id);
    idToDesc.set(id, desc);
    for (const [k, v] of oldProps) {
      const [kid, kprop] = k.split('|');
      if ((Number(kid) >>> 0) === (oldId >>> 0)) props.set(key(id, kprop), v);
    }
  }
  for (const [k, v] of oldProps) {                    // the GMs' own properties are not dynamic
    const [kid] = k.split('|');
    if ((Number(kid) >>> 0) === GM1 || (Number(kid) >>> 0) === GM2) props.set(k, v);
  }
  companions = new Map();
};

const load = (warbandCfg) => {
  const commands = {}, timers = {};
  globalThis.__dboCompanions = {
    list: (owner) => (companions.get(owner >>> 0) || []).slice(),
    release: () => true, dismiss: () => true, spawn: () => 0, follow: () => {}, stay: () => {}, attack: () => {},
  };
  const api = {
    mp, log: (...m) => logs.push(m.join(' ')), personal: (a, t) => said.push({ a, t }),
    audit: (t) => audits.push(String(t)), who: (a) => (a === GM1 ? 'GM One' : 'GM Two'),
    isAdmin: () => true, registerChatCommand: (n, fn) => { commands[n] = fn; },
    findByName: () => null, cfg: { warband: warbandCfg || {} }, onUi: () => {},
    onlineActors: () => [], every: (n, ms, fn) => { timers[n] = { ms, fn }; },
  };
  delete require.cache[MODULE];
  require(MODULE)(api);
  return { commands, timers, api };
};
const restart = (cfg) => {
  delete globalThis.__dboWarband;
  delete globalThis.__dboWarbandSaid;
  reassignIds();
  return load(cfg);
};
const lastSaid = () => (said.length ? said[said.length - 1].t : '');
const tagOf = (id) => props.get(key(id, 'private.dboEvent'));
const eventsFile = () => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'warband-events.json'), 'utf8')); }
  catch (e) { return null; }
};
const evByName = (name) => {
  const doc = eventsFile();
  return (doc && doc.events.find((e) => e.name === name)) || null;
};

// ---- 1. creating an event ------------------------------------------------------------------------
reset();
let W = load({ eventsMax: 2, eventMinutes: 60, eventRetirePerTick: 2 });
check('the /event command is registered', !!W.commands.event);
// One /event (2 Nov): a word that is not an event subcommand is an announcement, handed to stafftools.js
{
  const announced = [];
  globalThis.__dboEventAnnounce = (a, text) => announced.push([a, text]);
  W.commands.event(GM1, 'Wolves gather at the Bruma gate');
  check('/event <text> goes to the announcement (stafftools.js), not the event manager', announced.length === 1 && announced[0][1] === 'Wolves gather at the Bruma gate' && !eventsFile(), announced);
  W.commands.event(GM1, 'list');
  check('...while /event list still lists events', announced.length === 1 && /No event is running/.test(lastSaid()), lastSaid());
  delete globalThis.__dboEventAnnounce;
  W.commands.event(GM1, 'A second announcement');
  check('...and without stafftools.js loaded it says so rather than failing', /Event announcements are not loaded/.test(lastSaid()), lastSaid());
}
check('no new mp.on: the module loaded with an api that has none', !('on' in W.api));
check('the watchdog is one named timer, so a reload replaces it', W.timers.warbandEvents
  && W.timers.warbandEvents.ms === 1000, W.timers.warbandEvents && W.timers.warbandEvents.ms);

W.commands.event(GM1, 'new raid Forsworn at Bruma');
let doc = eventsFile();
const ev1 = evByName('Forsworn at Bruma');
check('a draft event is written to warband-events.json', !!ev1 && ev1.state === 'draft', ev1 && ev1.state);
check('...with its type, name, owner and a deadline', !!ev1 && ev1.type === 'raid'
  && ev1.name === 'Forsworn at Bruma' && ev1.owner.profile === 2 && ev1.deadlineAt > Date.now(),
  ev1 && { type: ev1.type, name: ev1.name, owner: ev1.owner.profile });
check('...and the place where the GM stood', !!ev1 && ev1.place.pos[0] === 100 && ev1.place.radius > 0,
  ev1 && ev1.place);

W.commands.event(GM1, 'new nonsense');
check('a type that is not one of the four is refused', /Usage: \/event new/.test(lastSaid()), lastSaid());

// ---- 2. attaching NPCs tags them ----------------------------------------------------------------
const a1 = spawn(GM1, 'e001'), a2 = spawn(GM1, 'e002'), a3 = spawn(GM1, 'e003');
const a4 = spawn(GM1, 'e004'), a5 = spawn(GM1, 'e005');
// one NPC already belongs to somebody else's event
props.set(key(a5, 'private.dboEvent'), 'siege-otherxx');
W.commands.event(GM1, 'attach');
check('attaching tags the band with private.dboEvent', tagOf(a1) === ev1.id && tagOf(a2) === ev1.id
  && tagOf(a3) === ev1.id, { a1: tagOf(a1), a2: tagOf(a2) });
check('an NPC already in another event is never stolen', tagOf(a5) === 'siege-otherxx', tagOf(a5));
const roster = evByName('Forsworn at Bruma');
check('the roster is stored by change-form desc, not by id',
  roster.members.length === 4 && roster.members.every((m) => /^e00[1-4]$/.test(m.desc)),
  roster.members.map((m) => m.desc));

W.commands.event(GM1, 'start');
check('the event runs once started', evByName('Forsworn at Bruma').state === 'running');

// ---- 3. eventsMax ------------------------------------------------------------------------------
W.commands.event(GM2, 'new siege Second');
W.commands.event(GM2, 'new invasion Third');
check('eventsMax refuses one event too many', /already running/.test(lastSaid()), lastSaid());

// ---- 4. the sweep only takes actors still carrying THIS event's tag ------------------------------
// A recycled id is the way a sweep could destroy a stranger, so the tag is re-read before every destroy.
props.set(key(a4, 'private.dboEvent'), 'raid-somethingelse');
W.commands.event(GM1, 'sweep');
for (let i = 0; i < 10; i++) W.timers.warbandEvents.fn();
check('the sweep destroyed the three it still owns', destroyed.length === 3
  && [a1, a2, a3].every((id) => destroyed.includes(id)), destroyed.map((x) => x.toString(16)));
check('...and left the one whose tag had changed', !destroyed.includes(a4), tagOf(a4));

// ---- 5. the sweep is paced, not simultaneous ----------------------------------------------------
// ActorKnowledge::NotifyListeners is 45 of 294 client crashes (W4), and both logged cases came from actors
// departing while combat ran. A teardown that destroys everything in one tick is that crash.
reset();
W = load({ eventsMax: 4, eventMinutes: 60, eventRetirePerTick: 2 });
W.commands.event(GM1, 'new siege Paced');
const paced = evByName('Paced').id;
for (let i = 1; i <= 5; i++) spawn(GM1, `p00${i}`);
W.commands.event(GM1, 'attach');
W.commands.event(GM1, `end ${paced}`);
check('ending queues but destroys nothing yet', destroyed.length === 0, destroyed.length);
W.timers.warbandEvents.fn();
check('the first tick destroys eventRetirePerTick (2), not all five', destroyed.length === 2, destroyed.length);
W.timers.warbandEvents.fn();
check('the second tick destroys two more', destroyed.length === 4, destroyed.length);
W.timers.warbandEvents.fn();
check('the third finishes the five', destroyed.length === 5, destroyed.length);
check('the event is recorded as ended', evByName('Paced').state === 'ended');
check('...and its outcome and who ended it are kept', evByName('Paced').endedBy === 'GM One'
  && !!evByName('Paced').outcome, evByName('Paced').outcome);

// ---- 6. an event's NPC zones go with it (staffguard.js, 2 Nov; event-zones-1102-harness.js) -------
// The F7 NPC Zones tab adds a zone only for the adder's open event (__dboWarbandEventOf), and ending the event
// removes them (__dboEventZonesEnd)
reset();
W = load({ eventsMax: 4 });
const zonesEnded = [];
globalThis.__dboEventZonesEnd = (id) => { zonesEnded.push(id); return ['gm-wolves', 'gm-bears']; };
check('a GM with no event has none to add zones for', globalThis.__dboWarbandEventOf(GM1) === null);
W.commands.event(GM1, 'new raid Zoned');
const zoned = evByName('Zoned').id;
check('...their draft event is the one, and not another GM\'s', (globalThis.__dboWarbandEventOf(GM1) || {}).id === zoned && globalThis.__dboWarbandEventOf(GM2) === null);
W.commands.event(GM1, 'start');
check('...still once it runs', (globalThis.__dboWarbandEventOf(GM1) || {}).id === zoned);
W.commands.event(GM1, `end ${zoned}`);
check('ending it removes its zones, once, and says so', zonesEnded.join() === zoned && audits.some((t) => new RegExp(`EVENT ${zoned} ended .*2 NPC zone\\(s\\) removed`).test(t)), audits);
check('...after which the GM has no event', globalThis.__dboWarbandEventOf(GM1) === null);
delete globalThis.__dboEventZonesEnd;
W.commands.event(GM1, 'new raid Unhooked');
W.commands.event(GM1, `end ${evByName('Unhooked').id}`);
check('without staffguard.js an event still ends', evByName('Unhooked').state === 'ended');

// ---- 6. any staff may end another GM's event ----------------------------------------------------
reset();
W = load({ eventsMax: 4, eventMinutes: 60, eventRetirePerTick: 4 });
W.commands.event(GM1, 'new raid Owned by one');
const owned = evByName('Owned by one').id;
spawn(GM1, 'o001');
W.commands.event(GM1, 'attach');
W.commands.event(GM2, `end ${owned}`);
check('any staff can end an event they do not own (Nat, 1 Nov)',
  evByName('Owned by one').state === 'ended' && evByName('Owned by one').endedBy === 'GM Two',
  evByName('Owned by one').endedBy);

// ---- 7. the watchdog ends an event whose deadline has passed -------------------------------------
reset();
W = load({ eventsMax: 4, eventMinutes: 60, eventRetirePerTick: 4 });
W.commands.event(GM1, 'new defence Deadline');
spawn(GM1, 'd001');
W.commands.event(GM1, 'attach');
W.commands.event(GM1, 'start');
W.commands.event(GM1, 'deadline 1');
const realNow = Date.now;
Date.now = () => realNow() + 2 * 60000;
W.timers.warbandEvents.fn();
Date.now = realNow;
check('the watchdog ends an event past its deadline', evByName('Deadline').state === 'ended',
  evByName('Deadline').state);
check('...naming the watchdog, not a GM', evByName('Deadline').endedBy === 'the watchdog',
  evByName('Deadline').endedBy);
for (let i = 0; i < 4; i++) W.timers.warbandEvents.fn();
check('...and its NPC is removed', destroyed.length === 1, destroyed.length);

// ---- 8. across a restart ------------------------------------------------------------------------
// The case the design exists for: the ids are all different afterwards, so only the descs can find them.
reset();
W = load({ eventsMax: 4, eventMinutes: 60, eventRetirePerTick: 4 });
W.commands.event(GM1, 'new raid Survives');
const survives = evByName('Survives').id;
const r1 = spawn(GM1, 'r001'), r2 = spawn(GM1, 'r002');
W.commands.event(GM1, 'attach');
W.commands.event(GM1, 'start');
check('before the restart, two NPCs are tagged', tagOf(r1) === survives && tagOf(r2) === survives);

W = restart({ eventsMax: 4, eventMinutes: 60, eventRetirePerTick: 4 });
W.timers.warbandEvents.fn();
const after = evByName('Survives');
const newR1 = descToId.get('r001'), newR2 = descToId.get('r002');
check('the restart really did reassign the ids', newR1 !== r1 && newR2 !== r2,
  { was: r1.toString(16), now: newR1 && newR1.toString(16) });
check('the event is still running after the restart (its deadline had not passed)',
  after.state === 'running', after.state);
check('...and both members were found again by desc under their new ids',
  after.members.length === 2 && after.members.map((m) => m.id).sort().join() === [newR1, newR2].sort().join(),
  after.members.map((m) => ({ desc: m.desc, id: (m.id || 0).toString(16) })));
W.commands.event(GM2, `end ${survives}`);
for (let i = 0; i < 4; i++) W.timers.warbandEvents.fn();
check('ending it after the restart destroys the NEW ids, not the stale ones',
  destroyed.length === 2 && destroyed.includes(newR1) && destroyed.includes(newR2),
  destroyed.map((x) => x.toString(16)));

// ---- 9. a restart finds an event whose deadline passed while the server was down ------------------
reset();
W = load({ eventsMax: 4, eventMinutes: 60, eventRetirePerTick: 4 });
W.commands.event(GM1, 'new siege Expired');
spawn(GM1, 'x001');
W.commands.event(GM1, 'attach');
W.commands.event(GM1, 'start');
// Backdate the deadline on disk, as if the server had been down past it
const onDisk = eventsFile();
onDisk.events.find((e) => e.name === 'Expired').deadlineAt = Date.now() - 60000;
fs.writeFileSync(path.join(dir, 'warband-events.json'), JSON.stringify(onDisk, null, 1));
W = restart({ eventsMax: 4, eventMinutes: 60, eventRetirePerTick: 4 });
W.timers.warbandEvents.fn();
check('an event whose deadline passed while the server was down is ended on load',
  evByName('Expired').state === 'ended', evByName('Expired').state);
for (let i = 0; i < 4; i++) W.timers.warbandEvents.fn();
check('...and its NPC is swept', destroyed.length === 1 && destroyed[0] === descToId.get('x001'),
  destroyed.map((x) => x.toString(16)));
check('...with the reason in the audit trail',
  audits.some((t) => /EVENT .* ended by the watchdog/.test(t)),
  audits.filter((t) => t.startsWith('EVENT')).slice(-2));

// ---- 10. an event whose NPCs all went while the server was down ----------------------------------
reset();
W = load({ eventsMax: 4, eventMinutes: 60, eventRetirePerTick: 4 });
W.commands.event(GM1, 'new raid Emptied');
spawn(GM1, 'y001');
W.commands.event(GM1, 'attach');
W.commands.event(GM1, 'start');
// companionSystem's own boot sweep takes tagged companions, so an event can come back to nothing
const gone = descToId.get('y001');
descToId.delete('y001');
idToDesc.delete(gone);
W = restart({ eventsMax: 4, eventMinutes: 60, eventRetirePerTick: 4 });
W.timers.warbandEvents.fn();
check('an event with nothing left is ended rather than left running',
  evByName('Emptied').state === 'ended', evByName('Emptied').state);
check('...and nothing was destroyed, because there was nothing to destroy', destroyed.length === 0,
  destroyed.length);

// ---- 11. the change-form census, and orphaned raiders --------------------------------------------
// The census must be budgeted: measured on live, a whole pass is ~6 s of blocking work (readdir of
// 130,547 entries 48 ms, read-and-parse 0.046 ms each), so it walks censusPerTick files a tick.
reset();
const cfDir = path.join(dir, 'world', 'changeForms');
fs.mkdirSync(cfDir, { recursive: true });
const form = (name, fields, profileId) => {
  fs.writeFileSync(path.join(cfDir, `${name}.json`), JSON.stringify({
    formDesc: name, baseDesc: '1e7e2:Skyrim.esm',
    profileId: profileId === undefined ? -1 : profileId, dynamicFields: fields,
  }));
};
// a live actor behind each desc, so the drain can re-check it
const place = (name, fields) => {
  const id = nextId++;
  descToId.set(name, id);
  idToDesc.set(id, name);
  for (const [k, v] of Object.entries(fields)) props.set(key(id, k), v);
  props.set(key(id, 'isDead'), false);
  return id;
};
const RAIDER = { 'private.dboCompanion': 'companion', ff_companionOf: 0, ff_hostile: true };
const GARRISON = { 'private.dboCompanion': 'companion', ff_companionOf: 0, ff_hostile: false };
const SUMMON = { 'private.dboCompanion': 'summon', ff_companionOf: 0, ff_hostile: true };
const OWNED = { 'private.dboCompanion': 'companion', ff_companionOf: 0x1001, ff_hostile: true };
form('o001', RAIDER); const o001 = place('o001', RAIDER);
form('o002', RAIDER); const o002 = place('o002', RAIDER);
form('g001', GARRISON); place('g001', GARRISON);
form('s001', SUMMON); place('s001', SUMMON);
form('c001', OWNED); place('c001', OWNED);
form('p001', RAIDER, 2);                                   // a player character carrying the tag
fs.writeFileSync(path.join(cfDir, 'broken.json'), '{ not json');
// Enough untagged filler to need several ticks: the budget has a floor of 50 a tick on purpose, because
// a smaller one would never finish a pass over the 130,547 forms live actually has.
for (let i = 0; i < 120; i++) {
  fs.writeFileSync(path.join(cfDir, `f${i}.json`),
    JSON.stringify({ formDesc: `f${i}`, profileId: -1, dynamicFields: {} }));
}

W = load({ eventsMax: 4, eventMinutes: 60, eventRetirePerTick: 2, censusMinutes: 1, censusPerTick: 50 });
// an event that claims one raider, so the census must leave it alone
W.commands.event(GM1, 'new raid Claims one');
const claimer = evByName('Claims one').id;
form('e001', Object.assign({}, RAIDER, { 'private.dboEvent': claimer }));
const e001 = place('e001', Object.assign({}, RAIDER, { 'private.dboEvent': claimer }));

const files = fs.readdirSync(cfDir).filter((n) => n.endsWith('.json')).length;
W.timers.warbandEvents.fn();
check('a census pass does not finish in one tick (it is budgeted, not a loop)',
  !logs.some((l) => l.includes('change-form census:')), logs.filter((l) => l.includes('census')).length);
for (let i = 0; i < Math.ceil(files / 50) + 1; i++) W.timers.warbandEvents.fn();
const line = logs.find((l) => l.includes('change-form census:')) || '';
check('...and logs once when the pass completes', !!line, logs.slice(-2));
check('the census counts the tagged forms, skipping the player character',
  / 6 tagged of /.test(line), line);
check('...and counts the hostile ones', / 5 hostile/.test(line), line);
check('...and breaks them down by kind', /companion 5, summon 1/.test(line), line);
check('...and reports the unreadable form rather than throwing', /1 unreadable/.test(line), line);
check('...and finds exactly the two orphaned raiders', / 2 orphaned raider\(s\)/.test(line), line);

// the four safety cases, which are the point of the narrow scope
W.commands.event(GM1, 'orphans');
// Assert the list itself, not the report text: the report prints only a count, so a check for the
// absence of a desc in it could never fail.
const orphanList = () => ((globalThis.__dboWarband.census || {}).last || {}).orphans || [];
check('exactly the two released hostile raiders are orphans',
  orphanList().slice().sort().join() === 'o001,o002', orphanList());
check('a settled garrison is never an orphan (companion, released, friendly)',
  !orphanList().includes('g001'), orphanList());
check('a released summon is never an orphan, whatever its flags',
  !orphanList().includes('s001'), orphanList());
check('an NPC a live event claims is never an orphan',
  !orphanList().includes('e001'), orphanList());
check('the report says 2 and explains what is excluded',
  /^2 orphaned raider/.test(lastSaid()) && /summons and thralls are never included/.test(lastSaid()),
  lastSaid());

// the live re-check: o002 is claimed again between the pass and the clear, so it must survive
props.set(key(o002, 'ff_companionOf'), 0x1002);
W.commands.event(GM1, 'orphans clear');
check('clearing queues both', /2 orphaned raider\(s\) queued/.test(lastSaid()), lastSaid());
for (let i = 0; i < 6; i++) W.timers.warbandEvents.fn();
check('only the one still orphaned is destroyed', destroyed.length === 1 && destroyed[0] === o001,
  destroyed.map((x) => x.toString(16)));
check('...and the one re-claimed since the pass survives the sweep', !destroyed.includes(o002));
check('...and the one a live event owns was never queued', !destroyed.includes(e001));

// a second pass reports the movement, which is what makes the count a leading indicator
logs.length = 0;
form('o003', RAIDER); place('o003', RAIDER);
const was = Date.now;
Date.now = () => was() + 2 * 60000;
for (let i = 0; i < Math.ceil((files + 2) / 50) + 2; i++) W.timers.warbandEvents.fn();
Date.now = was;
const second = logs.find((l) => l.includes('change-form census:')) || '';
check('a later pass says how the count moved since the last one', /since the last pass/.test(second), second);

// ---- done ----------------------------------------------------------------------------------------
process.chdir(home);
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* Windows EBUSY */ }
console.log('');
console.log(failures ? `${failures} FAILED` : 'all checks passed');
process.exit(failures ? 1 : 0);
