// Scripted test for lapsed patron slots (Nate 16 Oct 2026): characters stored past the slots a player has now are sent as
// lockedCharacters (greyed on the select screen), never played or deleted, never moved into a lower free slot, and they
// play again in their own slot once the slots return. characters and maxCharacters stay exactly as before for older
// clients, and a Trial GM's staff slot works as before. It bundles spawn.ts with esbuild (settings and the backend
// faction API stubbed) and runs in a temp folder holding a test patron-tiers.json. Run it from skymp5-server with
// node_modules present:
//
//   node tests/patron-locked-slots-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-lockedslots-'));

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const PROFILE = 42, USER = 3, GOLD = 'ROLE_GOLD', TRIAL = 'ROLE_TRIAL';
let props, actors, packets, destroyed, created, assigned, nextId;
const reset = () => { props = {}; actors = []; packets = []; destroyed = []; created = []; assigned = []; nextId = 0xff000100; };
const addChar = (name, slot, extra) => {
  const a = nextId++;
  actors.push(a);
  props[a] = Object.assign({ name, 'private.charSlot': slot }, extra || {});
  return a;
};
const slotOf = (a) => props[a]['private.charSlot'];

const svr = {
  getActorsByProfileId: (p) => (p === PROFILE ? actors.slice() : []),
  get: (a, k) => { if (!props[a]) throw new Error('no form'); return props[a][k]; },
  set: (a, k, v) => { if (!props[a]) throw new Error('no form'); props[a][k] = v; },
  getActorName: (a) => props[a].name,
  sendCustomPacket: (u, s) => packets.push(JSON.parse(s)),
  lookupEspmRecordById: () => null,
  findFormsByPropertyValue: () => [],
  createActor: () => { const a = nextId++; actors.push(a); props[a] = { name: '' }; created.push(a); return a; },
  destroyActor: (a) => { destroyed.push(a); actors = actors.filter((x) => x !== a); delete props[a]; },
  setEnabled: () => {},
  setUserActor: (u, a) => assigned.push(a),
  setRaceMenuOpen: () => {},
  getUserActor: () => 0,
  getUserByActor: () => -1,
  isConnected: () => false,
};

(async () => {
  await esbuild.build({
    entryPoints: [path.join(root, 'ts', 'systems', 'spawn.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'spawn.js'), logLevel: 'error',
    plugins: [{
      name: 'stubs',
      setup(b) {
        b.onResolve({ filter: /^\.\.\/(settings|backendFactionApi)$/ }, (a) => ({ path: a.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({
          contents: a.path === '../settings'
            ? 'module.exports = { Settings: { get: async () => globalThis.__spawnSettings } };'
            : 'module.exports = { filterAccessForSlot: (x) => x };',
          loader: 'js',
        }));
      },
    }],
  });
  const cwd = process.cwd();
  process.chdir(out);
  fs.writeFileSync('patron-tiers.json', JSON.stringify({
    tiers: [{ id: 'gold', label: 'Gold', roleId: GOLD, extraSlots: 2 }], bonuses: [], reservedSlots: 0,
  }));
  globalThis.__spawnSettings = {
    startPoints: [{ pos: [0, 0, 0], angleZ: 0, worldOrCell: '0x3c' }],
    maxPlayers: 100,
    allSettings: { characterSelect: true, characterSelectMaxCharacters: 3, logoutGraceMs: 0, adminRoles: { trialgm: [TRIAL] } },
  };
  const { Spawn } = require(path.join(out, 'spawn.js'));
  const gm = new EventEmitter();
  const ctx = { svr, gm };
  const sys = new Spawn(() => {});
  await sys.initAsync(ctx);

  const login = (roles) => { sys.connect(USER); svr._onSpawnAllowed(USER, PROFILE, roles); return packets[packets.length - 1]; };
  const pick = (action, slot) => { sys.customPacket(USER, 'characterSelectResult', { action, slot }, ctx); return packets[packets.length - 1]; };
  const names = (menu) => menu.characters.map((c) => (c ? c.name : null));

  // 1. A Gold patron (5 slots) lapses to 3: slots 3 and 4 lock, the packet's old fields read as before
  reset();
  const a0 = addChar('Ana', 0), a1 = addChar('Bo', 1), a2 = addChar('Cy', 2), a3 = addChar('Dee', 3), a4 = addChar('Eli', 4);
  let menu = login([GOLD]);
  check('patron: 5 slots, nothing locked', menu.maxCharacters === 5 && names(menu).join() === 'Ana,Bo,Cy,Dee,Eli' && menu.lockedCharacters.length === 0, menu);
  menu = login([]);
  check('lapsed: maxCharacters 3', menu.maxCharacters === 3, menu.maxCharacters);
  check('lapsed: characters are the first three as before', names(menu).join() === 'Ana,Bo,Cy', names(menu));
  check('lapsed: Dee and Eli listed locked in slots 3, 4',
    menu.lockedCharacters.map((c) => `${c.name}@${c.slot}:${c.reason}`).join() === 'Dee@3:slots,Eli@4:slots', menu.lockedCharacters);
  check('lapsed: locked entries carry the card fields',
    menu.lockedCharacters.every((c) => 'race' in c && 'info' in c && 'detail' in c && c.dead === false), menu.lockedCharacters[0]);

  // 2. Locked slots cannot be played or deleted by slot number
  assigned = [];
  pick('play', 3); pick('play', 4); pick('delete', 3); pick('delete', 4);
  check('lapsed: play/delete slot 3 or 4 refused', assigned.length === 0 && destroyed.length === 0 && created.length === 0, { assigned, destroyed, created });

  // 3. Deleting a lower character frees a slot for a new one; it never pulls a locked character in
  pick('delete', 1);
  menu = packets[packets.length - 1];
  check('lapsed: delete slot 1 destroys Bo only', destroyed.join() === String(a1), destroyed);
  check('lapsed: slot 1 is empty afterwards, not Dee', menu.characters[1] === null, names(menu));
  check('lapsed: Dee and Eli still locked', menu.lockedCharacters.map((c) => c.name).join() === 'Dee,Eli', menu.lockedCharacters);
  check('lapsed: no locked charSlot rewritten', slotOf(a3) === 3 && slotOf(a4) === 4, [slotOf(a3), slotOf(a4)]);
  assigned = [];
  pick('play', 1);
  check('lapsed: play slot 1 creates a new character there', created.length === 1 && slotOf(created[0]) === 1 && assigned.join() === String(created[0]), { created, assigned });
  const fresh = created[0];
  props[fresh].name = 'Fen';

  // 4. The menu after the new character
  menu = login([]);
  check('lapsed: menu after the new character', names(menu).join() === 'Ana,Fen,Cy' && menu.lockedCharacters.length === 2, menu);

  // 5. Resubscribing restores both in their own slots
  menu = login([GOLD]);
  check('resubscribed: 5 slots in the original order', menu.maxCharacters === 5 && names(menu).join() === 'Ana,Fen,Cy,Dee,Eli', names(menu));
  check('resubscribed: nothing locked', menu.lockedCharacters.length === 0, menu.lockedCharacters);
  assigned = [];
  pick('play', 3);
  check('resubscribed: Dee plays from slot 3', assigned.join() === String(a3) && slotOf(a3) === 3, { assigned, slot: slotOf(a3) });
  check('no character was ever deleted except Bo', destroyed.join() === String(a1) && [a0, a2, a3, a4].every((a) => props[a]), destroyed);

  // 6. Legacy characters without a charSlot still fill a free slot, and wait locked (charSlot untouched) when none is free
  reset();
  addChar('One', 0); addChar('Two', 1); addChar('Three', 2);
  const legacy = addChar('Old', undefined);
  menu = login([]);
  check('legacy: no free slot -> locked with slot null, charSlot untouched',
    menu.lockedCharacters.length === 1 && menu.lockedCharacters[0].slot === null && slotOf(legacy) === undefined, menu.lockedCharacters);
  menu = login([GOLD]);
  check('legacy: a free slot -> placed in slot 3 as before', names(menu)[3] === 'Old' && slotOf(legacy) === 3, names(menu));

  // 7. A collision inside the slots is repaired into a free slot as before (not a lapse)
  reset();
  addChar('P', 0); const dup = addChar('Q', 0);
  menu = login([]);
  check('collision: the second slot-0 character moves to slot 1', names(menu).join() === 'P,Q,' && slotOf(dup) === 1, names(menu));

  // 8. Trial GM staff slot: follows the player slots as before; a lapsed patron character never takes it
  reset();
  const g0 = addChar('G0', 0), g3 = addChar('G3', 3), g4 = addChar('G4', 4), staff = addChar('Staff', 5, { 'private.dboStaffChar': true });
  menu = login([GOLD, TRIAL]);
  check('staff patron: 6 slots, staff character in slot 5', menu.maxCharacters === 6 && names(menu).join() === 'G0,,,G3,G4,Staff' && menu.lockedCharacters.length === 0, names(menu));
  menu = login([TRIAL]);
  check('staff lapsed: 4 slots, staff character follows to slot 3', menu.maxCharacters === 4 && names(menu).join() === 'G0,,,Staff' && slotOf(staff) === 3, names(menu));
  check('staff lapsed: G3 and G4 locked with their own slots', menu.lockedCharacters.map((c) => `${c.name}@${c.slot}`).join() === 'G3@3,G4@4' && slotOf(g3) === 3 && slotOf(g4) === 4, menu.lockedCharacters);
  assigned = [];
  pick('play', 3);
  check('staff lapsed: slot 3 plays the staff character', assigned.join() === String(staff), assigned);
  login([TRIAL]);
  assigned = [];
  pick('play', 1);
  check('staff lapsed: slot 1 creates a player character, G3 not pulled down', created.length === 1 && slotOf(created[0]) === 1 && slotOf(g3) === 3, { created, g3: slotOf(g3) });
  menu = login([GOLD, TRIAL]);
  check('staff resubscribed: G3/G4 back in 3 and 4, staff back in 5',
    names(menu).join() === `G0,${props[created[0]].name || 'Character 2'},,G3,G4,Staff` && slotOf(staff) === 5 && menu.lockedCharacters.length === 0, names(menu));
  menu = login([GOLD]);
  check('staff role lost: staff character locked with reason staff', menu.lockedCharacters.map((c) => `${c.name}:${c.reason}`).join() === 'Staff:staff' && slotOf(staff) === 5, menu.lockedCharacters);
  check('no character deleted in the staff run', destroyed.length === 0 && [g0, g3, g4, staff].every((a) => props[a]), destroyed);

  // 9. Actor-keyed refusal: a mapped character whose stored slot disagrees with the slot asked for is refused
  reset();
  const x0 = addChar('X0', 0);
  login([]);
  const realGet = svr.get;
  svr.get = (a, k) => (a === x0 && k === 'private.charSlot' ? 4 : realGet(a, k));
  const realSlotMap = sys.slotMap;
  sys.slotMap = function (c, p, m, s, locked) { const r = realSlotMap.call(this, c, p, m, s, locked); r[0] = x0; return r; };
  assigned = [];
  pick('play', 0); pick('delete', 0);
  check('actor check: a slot-4 character reached through slot 0 is neither played nor deleted', assigned.length === 0 && destroyed.length === 0, { assigned, destroyed });
  svr.get = realGet; sys.slotMap = realSlotMap;

  process.chdir(cwd);
  fs.rmSync(out, { recursive: true, force: true });
  console.log(failures ? `${failures} FAILED` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
