// NPC zones belong to an event (the Leader for Nat, 2 Nov: "the only way to bring NPCs is the warbands and those systems";
// the F7 NPC Zones tab "requires an active /event, the zones belong to the event and go with it"). staffguard.js:
//   - an NPC zone of any tier needs the adder's own open /event (warband.js __dboWarbandEventOf), system zones aside;
//   - the zone is recorded for that event in gm-event-zones.json, and __dboEventZonesEnd(eventId), which warband.js endEvent
//     calls, takes that event's zones out of NPC-Spawns.json and the record, keeping every other zone, audited;
//   - gmEventZones.needEvent false is the old rule.
// warband-events-harness.js checks endEvent calls it. Mutants of a copy of staffguard.js must fail.
//   node tests/event-zones-1102-harness.js [staffguard.js to test]   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MOD, CAST, load, check, done } = require('./lib/staffguard-fakes');
const { GM, GM2, LEAD, OWNER } = Object.fromEntries(Object.entries(CAST).map(([k, v]) => [k, v.id]));

const SRC = fs.readFileSync(path.resolve(process.argv[2] || MOD), 'utf8').replace(/\r\n/g, '\n');
const home = process.cwd();
const dir = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'claude-nate-eventzones-'));
process.on('exit', () => { process.chdir(home); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* the OS */ } });
const realNow = Date.now;
let now = Date.UTC(2026, 10, 2, 18, 0, 0);
Date.now = () => now;

let n = 0;
const run = (src, check) => {
  const d = path.join(dir, `run-${n++}`);
  fs.mkdirSync(d);
  process.chdir(d);
  // The events open now, by adder (warband.js __dboWarbandEventOf: the adder's own draft or running event)
  const open = new Map();
  globalThis.__dboWarbandEventOf = (a) => open.get(a) || null;
  const copy = path.join(d, 'staffguard-under-test.js');
  fs.writeFileSync(copy, src);
  const boot = (cfg, opts) => { const f = load(cfg, opts); delete require.cache[copy]; require(copy)(f.api); return f; };
  let f = boot({});
  const gate = () => globalThis.__dboAdminGate;
  const zone = (Name, count) => ({ Name, ID: 'a764b:BSHeartland.esm', POS: [0, 0, 0], NPC: [{ id: '1:Skyrim.esm', count: count || 1 }] }); // verify-formids: ignore (a fake zone row)
  const add = (a, z) => gate()(a, 'npcZoneAdd', { zone: z, zoneName: z.Name });
  const record = () => { try { return JSON.parse(fs.readFileSync('gm-event-zones.json', 'utf8')); } catch (e) { return {}; } };
  fs.writeFileSync('NPC-Spawns.json', JSON.stringify({ _comment: 'hand', zones: [zone('wild:wolf:1'), zone('dungeon:x:1'), zone('hand-made')] }));
  // npcSpawnSystem's addZone, which the fork runs only after the gate let the zone through
  const panelAdd = (a, z) => { const no = add(a, z); if (!no) { const p = JSON.parse(fs.readFileSync('NPC-Spawns.json', 'utf8')); p.zones.push(z); fs.writeFileSync('NPC-Spawns.json', JSON.stringify(p)); } return no; };
  const names = () => JSON.parse(fs.readFileSync('NPC-Spawns.json', 'utf8')).zones.map((z) => z.Name);

  check('a GM with no open event adds no NPC zone, told to start one', /belong to an event: start one with \/event new/.test(add(GM, zone('gm-wolves'))) && !record()['gm-wolves']);
  check('...nor a Lead GM, nor an owner', /belong to an event/.test(add(LEAD, zone('lead-wolves', 8))) && /belong to an event/.test(add(OWNER, zone('owner-wolves'))));
  check('a Lead GM still edits a system zone with no event (world upkeep)', panelAdd(LEAD, zone('wild:extra', 4)) === '');
  open.set(GM, { id: 'raid-1102aaa' });
  check('with an open event a GM adds one, recorded for that event', panelAdd(GM, zone('gm-wolves', 2)) === '' && record()['gm-wolves'] && record()['gm-wolves'].event === 'raid-1102aaa');
  check('...audited with the event', f.audits.some((t) => /^GMEVENTZONE GM Gemma .* added 'gm-wolves' with 2 NPC\(s\) for event raid-1102aaa$/.test(t)), f.audits);
  check('...and a GM\'s limits still hold', /at most 5 NPCs/.test(add(GM, zone('gm-big', 6))));
  open.set(LEAD, { id: 'siege-1102bbb' });
  check('a Lead GM with an open event adds one, recorded for it and audited', panelAdd(LEAD, zone('lead-camp', 8)) === '' && record()['lead-camp'].event === 'siege-1102bbb' && f.audits.some((t) => /added 'lead-camp' for event siege-1102bbb/.test(t)));
  now += 31000;
  check('another event\'s zone (GM2\'s)', (open.set(GM2, { id: 'raid-1102ccc' }), panelAdd(GM2, zone('gm2-camp'))) === '');
  now += 31000;
  check('a second zone of the GM\'s event', panelAdd(GM, zone('gm-bears')) === '');
  check('a Lead GM deleting a zone drops its record', (record()['lead-camp'] && gate()(LEAD, 'npcZoneDelete', { zoneName: 'lead-camp' }) === '') && !record()['lead-camp'], record());

  f.audits.length = 0;
  const gone = globalThis.__dboEventZonesEnd('raid-1102aaa');
  check('ending the event removes its zones from NPC-Spawns.json', gone.sort().join() === 'gm-bears,gm-wolves' && !names().includes('gm-wolves') && !names().includes('gm-bears'), names());
  check('...keeping every other zone: system, hand-made, another event\'s', ['wild:wolf:1', 'dungeon:x:1', 'hand-made', 'wild:extra', 'gm2-camp', 'lead-camp'].every((z) => names().includes(z)) && JSON.parse(fs.readFileSync('NPC-Spawns.json', 'utf8'))._comment === 'hand', names());
  check('...and their records', !record()['gm-wolves'] && !record()['gm-bears'] && record()['gm2-camp'], record());
  check('...audited once', f.audits.length === 1 && /^GMEVENTZONE event raid-1102aaa ended: removed 2 zone\(s\)/.test(f.audits[0]), f.audits);
  check('ending it again, or an event with no zones: nothing', globalThis.__dboEventZonesEnd('raid-1102aaa').length === 0 && globalThis.__dboEventZonesEnd('nope').length === 0 && f.audits.length === 1);
  f = boot({}, { reset: false });
  check('the record survives a hot reload', globalThis.__dboEventZonesEnd('raid-1102ccc').join() === 'gm2-camp' && !names().includes('gm2-camp'));
  open.clear();
  delete globalThis.__dboWarbandEventOf;
  check('without warband.js there is no event, so no zone', /belong to an event/.test(add(GM2, zone('gm2-late'))));
  f = boot({ gmEventZones: { needEvent: false } });
  now += 31000;
  check('needEvent false: the old rule (a GM adds within the limits, no event)', add(GM2, zone('gm2-free')) === '' && !record()['gm2-free'].event);
  process.chdir(dir);
};

run(SRC, check);
const MUTANTS = [
  ['no event needed', "if (!ev || !ev.id) return 'NPC zones belong", "if (false) return 'NPC zones belong"],
  ['the switch is off by default', 'needEvent: true,', 'needEvent: false,'],
  ['a Lead GM needs no event', "    if (tier !== 'gm') {\n      if (ev && action", "    if (tier !== 'gm' && tier !== 'leadgm') {\n      if (ev && action"],
  ['system zones need an event too', 'if (name && !isSystemZone(name)) {', 'if (name) {'],
  ['the GM\'s zone is not tied to the event', "Object.assign({ profile: me, at: Date.now() }, ev ? { event: ev.id } : {})", '{ profile: me, at: Date.now() }'],
  ['the zones stay in NPC-Spawns.json', "fs.renameSync(file + '.eventzones.tmp', file);", ''],
  ['every event zone goes', "zones[k] && zones[k].event === String(eventId)", 'zones[k] && zones[k].event'],
  ['the records stay', '    for (const k of names) delete zones[k];\n', ''],
];
for (const [name, from, to] of MUTANTS) {
  if (!SRC.includes(from)) { check(`mutant "${name}": its line is still in staffguard.js`, false, from); continue; }
  let bad = 0;
  try { run(SRC.replace(from, to), (_n, ok) => { if (!ok) bad++; }); } catch (e) { bad++; }
  check(`mutant caught: ${name}`, bad > 0);
}
Date.now = realNow;
done();
