// DragonBreak Online: weapon racks in homes. Loaded by gamemode.js on every hot reload.
//
// Why this exists (10 Oct, "these dont work for holding weapons in weapon racks"): a vanilla rack is a rack mesh (ACTI with
// WeaponRackTriggerSCRIPT, a trigger volume holding *Pivot01 nodes) plus an ACTIVATOR at the same spot (ACTI with
// WeaponRackActivateSCRIPT), linked by WRackTrigger / WRackActivator, and an optional starting weapon on the activator's
// keyword-less link. The server runs the activator's script from Skyrim - Misc.bsa, but GlobalVariable.GetValue/SetValue are
// missing there, so the script shows its tutorial message on every use and stops; the placing half needs DropObject,
// MoveToNode, SetMotionType, GetEquippedWeapon and trigger events, none of which the server has. So the rack is done here:
//
//   - Activating a rack's activator or its mesh: an empty slot takes the weapon in the player's right hand (the shield, on a
//     shield rack), the vanilla way; a slot holding a weapon put there this way gives it back. Only the home's owner and its
//     key holders (housingSystem's claim and key names) may do either. Answering here also stops the vanilla script's
//     OnActivate (MpObjectReference only sends it when the activation was allowed), so the tutorial box goes away.
//   - The weapon itself is kept in this module's state file, inventory entry and extras included (enchantment, temper, name,
//     poison); what hangs on the rack is a display-only copy (private.dboRackDisplay), placed at the slot's pivot. Activating
//     the copy is the same as activating its rack. Nothing ever picks a copy up, so a copy is never a second weapon.
//   - A slot holding a plugin-placed starting weapon is full and stays decoration (blockPlacedPickup keeps those in place).
//   - When a home changes hands, is given up or is seized, its racked weapons go back to the previous owner (the home's owner
//     when each was racked, whoever of the household racked it): into that owner's pending list, delivered to their character
//     straight away when online, else within a sweep of their next login (Nate, 10 Oct).
//   - A hold's managers (jarl, baron, steward, chieftain, bane, count of the building's own hold, as housingSystem.ts manages
//     property) may take racked weapons down into their own hands; each such take is audited with who, rank and hold. Staff
//     have no override.
//   - Raids never take racked weapons: raids.js takes only from a home's containers, the weapons are not in one, and a raider
//     activating a rack or a copy is refused here like any other stranger (this hook runs before the raid hook).
//
// Every change is written to the state file BEFORE the inventory changes, so a failure in between can lose a weapon to the
// pending list but never makes a second one.
//
// Slot poses come from weapon-racks.json (Nat's PC, read from the rack NIFs: per rack mesh and activator editor id, per pivot
// node, { pos, rot, m }: pos in the mesh root's space, rot in radians (NiMatrix3::ToEulerAnglesXYZ), m the same rotation as a
// row-major 3x3, used when present). The server has no meshes, so without that table, or without the slot's node in
// it, a rack refuses to take a weapon ("This rack is not ready yet") rather than guess a pose. Taking back always works.
//
// Pose maths (M below). The rack's angles become its matrix with NiMatrix3::SetEulerAnglesXYZ, the slot is
// P + scale * (M_rack @ pos), and the weapon's angles are ToEulerAnglesXYZ(M_rack @ m_node), the angles MoveToNode itself
// writes (Nat's PC, from CommonLibSSE e3626d22). Units: the server keeps reference angles in DEGREES (LocationalDataUtils::GetRot
// turns a REFR's radians into degrees; the 'angle' property returns them; SetAngle stores its arguments as given; the client
// hands them to ObjectReference.setAngle), so radians are only used inside the maths.
//
// Config "weaponRacks": { enabled, sweepMs, ownerChangeConfirmMs, bootGraceMs, poseFile, stateFile }.

const fs = require('fs');
const path = require('path');

// Weapon type keywords, read from Skyrim.esm KYWD records (and the activators' own VMAD properties), 10 Oct
const KW = {
  sword: 0x0001e711, waraxe: 0x0001e712, dagger: 0x0001e713, mace: 0x0001e714, bow: 0x0001e715, staff: 0x0001e716,
  warhammer: 0x0006d930, greatsword: 0x0006d931, battleaxe: 0x0006d932, shield: 0x000965b2,
};
// The node WeaponRackActivateSCRIPT.HandleWeaponPlacement moves each kind to (MoveToNode(TriggerMarker, ...))
const NODE = {
  sword: 'SwordPivot01', waraxe: 'WarAxePivot01', mace: 'MacePivot01', greatsword: 'GreatSwordPivot01', battleaxe: 'BattleAxePivot01',
  warhammer: 'WarhammerPivot01', bow: 'BowPivot01', staff: 'StaffPivot01', dagger: 'DaggerPivot01', shield: 'ShieldPivot01',
};
const NAMES = { sword: 'sword', waraxe: 'war axe', mace: 'mace', greatsword: 'greatsword', battleaxe: 'battleaxe', warhammer: 'warhammer', bow: 'bow', staff: 'staff', dagger: 'dagger', shield: 'shield' };
const WRACK_TRIGGER = 0x0006d95e; // on the activator: -> the rack mesh
const WRACK_ACTIVATOR = 0x0006d95f; // on the rack mesh: -> the activator
const KEY_BASE_ID = 0x000db0e2; // housingSystem.ts KEY_BASE_ID: the key's name extra carries the credential
// Skyrim.esm activator bases and their RackType (VMAD property; 1 when the script's default stands):
// 1 any weapon, 2 shields only, 3 no daggers or bows (the COA swords), 4 daggers only
const ACTIVATORS = new Map([
  [0x0008af59, 1], [0x0006a4a4, 1], [0x0007400c, 2], [0x000e49cb, 2], [0x000e49bb, 3], [0x000e49bd, 3], [0x000e49c9, 1],
  [0x000e49cd, 1], [0x00084cf1, 1], [0x000db2a2, 1], [0x000e946d, 1], [0x000d5081, 4], [0x0006abc1, 1],
]);
// The rack meshes (WeaponRackTriggerSCRIPT); each links back to its activator with WRackActivator
const MESHES = new Set([0x0008af5b, 0x0006a4a3, 0x0007400d, 0x000e49ca, 0x000e49ba, 0x000e49bc, 0x000e49c8, 0x000e49cc, 0x00084cf2,
  0x000db2a3, 0x001019bc, 0x000e946e, 0x000d505b, 0x0006abbd]);
const DISPLAY_TAG = 'private.dboRackDisplay';
const accepts = (rackType, kind) => {
  if (rackType === 2) return kind === 'shield' ? '' : 'Only a shield hangs on this rack.';
  if (rackType === 4) return kind === 'dagger' ? '' : 'Only a dagger sits on this display.';
  if (kind === 'shield') return 'Shields hang on a shield rack.';
  if (rackType === 3 && (kind === 'dagger' || kind === 'bow')) return 'Daggers and bows do not hang on this rack.';
  return '';
};

// ---- pose maths, NiMatrix3 conventions (row-major, p_parent = m @ p_child) ----------------------------------------------------
const M = {
  // NiMatrix3::SetEulerAnglesXYZ(x, y, z), radians
  fromEuler: ([x, y, z]) => {
    const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
    return [[cy * cz, cy * sz, -sy], [sx * sy * cz - cx * sz, sx * sy * sz + cx * cz, sx * cy], [cx * sy * cz + sx * sz, cx * sy * sz - sx * cz, cx * cy]];
  },
  // NiMatrix3::ToEulerAnglesXYZ, radians
  toEuler: (e) => [-Math.atan2(-e[1][2], e[2][2]), -Math.asin(Math.max(-1, Math.min(1, e[0][2]))), -Math.atan2(-e[0][1], e[0][0])],
  mul: (a, b) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j])),
  apply: (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]),
  deg: (r) => { const d = (r * 180) / Math.PI; return ((d % 360) + 360) % 360; },
  rad: (d) => (Number(d) || 0) * Math.PI / 180,
  // A table entry's rotation: m when it is a 3x3 of numbers, else rot (radians)
  nodeMatrix: (p) => {
    if (!p || !Array.isArray(p.pos) || p.pos.length !== 3 || !p.pos.every(Number.isFinite)) return null;
    if (Array.isArray(p.m) && p.m.length === 3 && p.m.every((r) => Array.isArray(r) && r.length === 3 && r.every(Number.isFinite))) return p.m.map((r) => r.map(Number));
    if (Array.isArray(p.rot) && p.rot.length === 3 && p.rot.every(Number.isFinite)) return M.fromEuler(p.rot.map(Number));
    return null;
  },
  // A rack at pos with angles in degrees and scale s; a pivot at local pos with matrix m -> world pos and SetAngle degrees
  compose: (rackPos, rackAngleDeg, s, localPos, m) => {
    const R = M.fromEuler(rackAngleDeg.map(M.rad));
    const d = M.apply(R, localPos);
    return { pos: [0, 1, 2].map((i) => Number(rackPos[i]) + s * d[i]), rot: M.toEuler(M.mul(R, m)).map(M.deg) };
  },
};

module.exports = (api) => {
  const { mp, log, personal, audit, who } = api;
  const C = Object.assign({ enabled: true, sweepMs: 30000, ownerChangeConfirmMs: 60000, bootGraceMs: 180000,
    poseFile: 'weapon-racks.json', stateFile: '' }, (api.cfg || {}).weaponRacks || {});
  const S = globalThis.__dboWeaponRacks || (globalThis.__dboWeaponRacks = { state: null, homes: new Map(), suspect: new Map(), bootAt: Date.now() });
  // A state file found unreadable is read again on the next reload (after someone repaired it)
  if (S.readOnly) { S.readOnly = false; S.state = null; }
  const hex = (id) => (Number(id) >>> 0).toString(16);
  const now = () => (typeof api.now === 'function' ? api.now() : Date.now());

  const recordOf = (id) => {
    if (typeof api.recordOf === 'function') return api.recordOf(id >>> 0);
    try { const r = mp.lookupEspmRecordById(id >>> 0); return r && r.record ? r : null; } catch (e) { return null; }
  };
  const fields = (r, type) => ((r && r.record && r.record.fields) || []).filter((f) => f && f.type === type && f.data instanceof Uint8Array);
  const u32 = (f, at) => new DataView(f.data.buffer, f.data.byteOffset, f.data.byteLength).getUint32(at, true);
  const globalId = (r, local) => { if (!local) return 0; try { return typeof r.toGlobalRecordId === 'function' ? (r.toGlobalRecordId(local) >>> 0) : (local >>> 0); } catch (e) { return 0; } };
  const baseOf = (ref) => { try { return mp.getIdFromDesc(String(mp.get(ref, 'baseDesc') || '')) >>> 0; } catch (e) { return 0; } };
  const profileOf = (a) => { try { const p = Number(mp.get(a, 'profileId')); return Number.isFinite(p) ? p : -1; } catch (e) { return -1; } };
  const typeOf = (id) => { const r = recordOf(id); return r ? String(r.record.type || '') : ''; };
  const edidOf = (id) => { const r = recordOf(id); return r ? String(r.record.editorId || '') : ''; };
  const keywordsOf = (id) => {
    const r = recordOf(id); const out = new Set();
    for (const f of fields(r, 'KWDA')) for (let i = 0; i + 4 <= f.data.byteLength; i += 4) out.add(globalId(r, u32(f, i)));
    return out;
  };
  // A plugin reference's XLKR links: [{ kw, ref }] as load-order ids (kw 0: the link without a keyword)
  const linksOf = (ref) => {
    if (ref >= 0xff000000) return [];
    const r = recordOf(ref);
    return fields(r, 'XLKR').filter((f) => f.data.byteLength >= 8).map((f) => ({ kw: globalId(r, u32(f, 0)), ref: globalId(r, u32(f, 4)) }));
  };
  const kindOf = (baseId) => {
    const kws = keywordsOf(baseId);
    for (const [k, id] of Object.entries(KW)) if (kws.has(id)) return k;
    return '';
  };
  const papyrus = (cls, fn, self, args) => mp.callPapyrusFunction('method', cls, fn, { type: 'form', desc: mp.getDescFromId(self) }, args);

  // ---- the pose table (weapon-racks.json, Nat's PC) -------------------------------------------------------------------
  // { "<rack or activator edid>": { "<Pivot node>": { pos: [x,y,z] (mesh root space), rot: [x,y,z] radians, m: 3x3, scale? } } }
  const POSE_FILE = path.resolve(C.poseFile);
  const poses = () => {
    let st = null; try { st = fs.statSync(POSE_FILE); } catch (e) { S.poses = null; S.posesAt = 0; return null; }
    if (S.poses && S.posesAt === st.mtimeMs) return S.poses;
    try {
      const raw = JSON.parse(fs.readFileSync(POSE_FILE, 'utf8'));
      const table = raw && typeof raw.racks === 'object' ? raw.racks : raw;
      const out = {};
      for (const [edid, nodes] of Object.entries(table || {})) {
        if (edid.startsWith('_') || !nodes || typeof nodes !== 'object') continue;
        for (const [node, p] of Object.entries(nodes)) {
          const m = M.nodeMatrix(p);
          if (!m) { log(`weaponracks: ${C.poseFile} ${edid}.${node} has no usable pos and rot/m; left out`); continue; }
          (out[edid.toLowerCase()] = out[edid.toLowerCase()] || {})[node.toLowerCase()] = { pos: p.pos.map(Number), m };
        }
      }
      S.poses = out; S.posesAt = st.mtimeMs;
      log(`weaponracks: ${Object.keys(out).length} rack entries in ${C.poseFile}`);
      return out;
    } catch (e) { log(`weaponracks: ${C.poseFile} unreadable: ${e.message}`); S.poses = null; S.posesAt = 0; return null; }
  };
  const pivotsOf = (ref) => { const t = poses(); return t ? (t[edidOf(baseOf(ref)).toLowerCase()] || null) : null; };
  // A plugin reference's own scale (XSCL), 1 without one
  const scaleOf = (ref) => {
    if (ref >= 0xff000000) return 1;
    const f = fields(recordOf(ref), 'XSCL')[0];
    if (!f || f.data.byteLength < 4) return 1;
    const v = new DataView(f.data.buffer, f.data.byteOffset, 4).getFloat32(0, true);
    return Number.isFinite(v) && v > 0 ? v : 1;
  };
  // The slot's world pose { where, pos, rot (degrees, for SetAngle) }, or null when the table or the rack cannot give one.
  // Weapons are posed from the rack mesh (WRackTrigger's target), as the vanilla script's MoveToNode(TriggerMarker, node)
  // does; an activator with no mesh link falls back to itself (its edid carries the same pivots).
  const slotPose = (poseRef, node) => {
    const pivots = pivotsOf(poseRef); if (!pivots) return null;
    const p = pivots[String(node).toLowerCase()]; if (!p) return null;
    let pos, ang, where;
    try { pos = mp.get(poseRef, 'pos'); ang = mp.get(poseRef, 'angle') || [0, 0, 0]; where = String(mp.get(poseRef, 'worldOrCellDesc') || ''); } catch (e) { return null; }
    if (!Array.isArray(pos) || !where || !Array.isArray(ang)) return null;
    return Object.assign({ where }, M.compose(pos, ang, scaleOf(poseRef), p.pos, p.m));
  };
  // The pivot a weapon goes to: the vanilla script's node for its type; a crossbow (a bow by keyword, animation type 9 in
  // its DNAM) takes CrossbowPivot01 where the rack has one. The variant nodes (StaffPivot02/03, StaffPivotFalmer and
  // the other named staves, ShieldPivotDaedric and the other named shields, CrossbowPivot02, BogusPivot) are not used.
  const animTypeOf = (baseId) => { const f = fields(recordOf(baseId), 'DNAM')[0]; return f && f.data.byteLength >= 1 ? f.data[0] : -1; };
  const nodeFor = (kind, baseId, poseRef) => {
    if (kind === 'bow' && animTypeOf(baseId) === 9) { const pv = pivotsOf(poseRef); if (pv && pv.crossbowpivot01) return 'CrossbowPivot01'; }
    return NODE[kind];
  };

  // ---- state: { racks: { activatorHex: slot }, pending: { profileId: [{ entry, from, at }] } } ---------------------------
  const stateDir = () => { try { return path.dirname(fs.realpathSync(path.resolve('world'))); } catch (e) { return path.resolve('.'); } };
  const STATE_FILE = C.stateFile ? path.resolve(C.stateFile) : path.join(stateDir(), 'weapon-racks-state.json');
  const state = () => {
    if (S.state && S.stateFile === STATE_FILE) return S.state;
    let st = { racks: {}, pending: {} };
    try { const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); st = { racks: raw.racks || {}, pending: raw.pending || {} }; }
    catch (e) { if (e.code !== 'ENOENT') log(`weaponracks: ${STATE_FILE} unreadable (${e.message}); starting empty, the file is left as it is`); if (e.code !== 'ENOENT') S.readOnly = true; }
    S.state = st; S.stateFile = STATE_FILE;
    return st;
  };
  // One synchronous write; false when it did not land (the caller undoes its change and refuses)
  const save = () => {
    if (S.readOnly) { log('weaponracks: state file was unreadable at load; refusing to overwrite it'); return false; }
    try { fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(state(), null, 1)); fs.renameSync(STATE_FILE + '.tmp', STATE_FILE); return true; }
    catch (e) { log('weaponracks: state write failed', e.message); return false; }
  };
  const itemName = (entry) => (entry && entry.name) || edidOf(Number(entry && entry.baseId) >>> 0) || 'weapon';

  // ---- homes: the claimed property whose door stands in the rack's interior cell ---------------------------------------
  const housing = () => globalThis.__dboHousing || null;
  const claimedRefs = () => { try { const l = JSON.parse(fs.readFileSync(path.resolve('housing.json'), 'utf8')); return Array.isArray(l) ? l.map((x) => Number(x) >>> 0) : []; } catch (e) { return []; } };
  const cellOf = (ref) => { try { return String(mp.get(ref, 'worldOrCellDesc') || '').toLowerCase(); } catch (e) { return ''; } };
  const isInterior = (cellDesc) => { try { return typeOf(mp.getIdFromDesc(cellDesc) >>> 0) === 'CELL'; } catch (e) { return false; } };
  const homeOf = (ref) => {
    const H = housing(); if (!H) return null;
    const cell = cellOf(ref); if (!cell || !isInterior(cell)) return null;
    const cached = S.homes.get(cell);
    const pick = (primary) => { const rec = H.recordOf(primary); return rec && rec.owner ? { primary, rec } : null; };
    if (cached && now() - cached.at < 60000) return cached.primary ? pick(cached.primary) : null;
    let found = 0;
    for (const p of claimedRefs()) {
      let rec = null; try { rec = H.recordOf(p); } catch (e) { rec = null; }
      if (!rec || !rec.owner) continue;
      if ([p, Number(rec.partner) >>> 0].filter(Boolean).some((r) => cellOf(r) === cell)) { found = Number(H.primaryOf(p)) >>> 0 || p; break; }
    }
    S.homes.set(cell, { primary: found, at: now() });
    return found ? pick(found) : null;
  };
  // Property per character (fork housingSystem.ts housingOwnerPerCharacter): a home is its owning character's, and what is
  // kept for an owner is keyed "c<actor hex>"; with the switch off (or an older fork) the account's, keyed by profile
  const housingFn = (name) => { const H = housing(); return H && typeof H[name] === 'function' ? H[name] : null; };
  const perChar = () => { try { const f = housingFn('perCharacter'); return !!f && f() === true; } catch (e) { return false; } };
  const keyOfActor = (a) => (perChar() ? `c${hex(a)}` : String(profileOf(a)));
  const keysOfActor = (a) => [`c${hex(a)}`, String(profileOf(a))];
  const ownerKeyOf = (rec) => { try { const f = housingFn('ownerKeyOf'); if (f) return String(f(rec)); } catch (e) { /* the account's */ } return String(Number(rec.owner) || 0); };
  const owns = (a, rec) => { try { const f = housingFn('ownsRecord'); if (f) return f(rec, a) === true; } catch (e) { /* the account's */ } return profileOf(a) === Number(rec.owner); };
  // Property keys are the vanilla key or a record of house-keys.json's pool (fork houseKeys.ts), re-read when it changes
  const KEY_POOL_FILE = path.resolve('house-keys.json');
  const keyBases = () => {
    let at = -1; try { at = fs.statSync(KEY_POOL_FILE).mtimeMs; } catch (e) { /* no pool */ }
    if (S.keyPoolAt !== at || !S.keyPool) {
      const ids = new Set([KEY_BASE_ID]);
      try { for (const d of (JSON.parse(fs.readFileSync(KEY_POOL_FILE, 'utf8')) || {}).pool || []) { try { const id = mp.getIdFromDesc(String(d)) >>> 0; if (id) ids.add(id); } catch (e) { /* not in this load order */ } } } catch (e) { /* no pool */ }
      S.keyPool = ids; S.keyPoolAt = at;
    }
    return S.keyPool;
  };
  // housingSystem.ts hasAccessWith, owner and keys (its keyOpens when the fork has it): a key named as issued, or ending in
  // "(PRIMARY[-serial])"
  const mayUse = (a, home) => {
    const rec = home.rec;
    if (owns(a, rec)) return true;
    try { const f = housingFn('keyOpens'); if (f) return f(home.primary, a) === true; } catch (e) { /* the check below */ }
    const credential = rec.serial > 1 ? `(${home.primary.toString(16).toUpperCase()}-${rec.serial})` : `(${home.primary.toString(16).toUpperCase()})`;
    const issued = Array.isArray(rec.issued) ? rec.issued : [];
    let entries = []; try { const inv = mp.get(a, 'inventory'); entries = inv && Array.isArray(inv.entries) ? inv.entries : []; } catch (e) { return false; }
    const bases = keyBases();
    return entries.some((e) => bases.has(Number(e.baseId) >>> 0) && typeof e.name === 'string' && (issued.includes(e.name) || e.name.endsWith(credential)));
  };

  // A hold's managers (housingSystem.ts MANAGER_RANKS, officials.json by zone and the backend's "hold:<zone>:<rank>" rows) may
  // take racked weapons down in a building of their own hold, into their own hands: the hold's authority decides where they
  // go (Nate, 10 Oct: "hold leadership is fine for the racked weapons and who owns them"). Staff get no override here.
  const MANAGER_RANKS = ['jarl', 'baron', 'steward', 'chieftain', 'bane', 'count'];
  const OFFICIALS = path.resolve('officials.json');
  const officials = () => {
    let st = null; try { st = fs.statSync(OFFICIALS); } catch (e) { return {}; }
    if (S.officials && S.officialsAt === st.mtimeMs) return S.officials;
    try { S.officials = JSON.parse(fs.readFileSync(OFFICIALS, 'utf8')) || {}; S.officialsAt = st.mtimeMs; } catch (e) { log(`weaponracks: officials.json unreadable: ${e.message}`); return S.officials || {}; }
    return S.officials;
  };
  // The managing rank a caster holds in hold, or ''
  const managerRank = (a, hold) => {
    if (!hold) return '';
    const p = profileOf(a); if (p < 0) return '';
    const table = officials()[hold] || {};
    // A seat bound to a character (gamemode.js officials-seats.json, Nate 19 Oct) manages for that character alone
    const seatIsMine = (rank) => { let held = 0; try { held = typeof globalThis.__dboSeatHolder === 'function' ? Number(globalThis.__dboSeatHolder(hold, rank, p)) >>> 0 : 0; } catch (e) { held = 0; } return !held || held === (Number(a) >>> 0); };
    for (const rank of MANAGER_RANKS) if ((table[rank] || []).map(Number).includes(p) && seatIsMine(rank)) return rank;
    try {
      const access = mp.get(a, 'private.skympAccess');
      for (const row of (access && Array.isArray(access.factions) ? access.factions : [])) {
        const parts = String((row && row.requirementId) || '').split(':');
        if (parts.length === 3 && parts[0] === 'hold' && parts[1] === hold && MANAGER_RANKS.includes(parts[2])) return parts[2];
      }
    } catch (e) { /* no access rows */ }
    return '';
  };
  const holdOfHome = (home) => { const H = housing(); try { return H && typeof H.holdOf === 'function' ? String(H.holdOf(home.primary) || '') : ''; } catch (e) { return ''; } };

  // ---- the rack a reference belongs to ---------------------------------------------------------------------------------
  // { act, mesh, rackType, start } for an activator or a rack mesh, else null
  const rackOf = (ref) => {
    const base = baseOf(ref);
    if (ACTIVATORS.has(base)) {
      const links = linksOf(ref);
      const mesh = (links.find((l) => l.kw === WRACK_TRIGGER) || {}).ref || 0;
      const start = (links.find((l) => l.kw === 0) || {}).ref || 0;
      return { act: ref >>> 0, mesh, rackType: ACTIVATORS.get(base), start };
    }
    if (MESHES.has(base)) {
      const act = (linksOf(ref).find((l) => l.kw === WRACK_ACTIVATOR) || {}).ref || 0;
      return act && ACTIVATORS.has(baseOf(act)) ? rackOf(act) : null;
    }
    return null;
  };
  // A plugin-placed starting weapon still on its rack: decoration, the slot is full
  const startingWeaponThere = (rack) => {
    if (!rack.start) return false;
    try { return mp.get(rack.start, 'isDisabled') !== true; } catch (e) { return false; }
  };

  // ---- the display copies ----------------------------------------------------------------------------------------------
  const displayOk = (slot, act) => {
    if (!slot.display) return false;
    try { const t = mp.get(parseInt(slot.display, 16) >>> 0, DISPLAY_TAG); return !!t && t.rack === act; } catch (e) { return false; }
  };
  const removeDisplay = (idHex) => {
    if (!idHex) return;
    const id = parseInt(idHex, 16) >>> 0;
    try { mp.set(id, DISPLAY_TAG, null); } catch (e) { /* gone already */ }
    try { papyrus('ObjectReference', 'Delete', id, []); } catch (e) { log(`weaponracks: could not delete display ${idHex}: ${e.message}`); }
  };
  const spawnDisplay = (act, slot) => {
    const pose = slotPose(parseInt(slot.mesh, 16) >>> 0, slot.node);
    if (!pose) { log(`weaponracks: no pose for rack ${act} (${slot.node}); its display waits`); return false; }
    try {
      const res = papyrus('ObjectReference', 'PlaceAtMe', parseInt(act, 16) >>> 0, [{ type: 'espm', desc: mp.getDescFromId(Number(slot.entry.baseId) >>> 0) }, 1, false, false]);
      if (!res || !res.desc) { log(`weaponracks: PlaceAtMe gave nothing for rack ${act}`); return false; }
      const id = mp.getIdFromDesc(res.desc) >>> 0;
      mp.set(id, DISPLAY_TAG, { rack: act, base: hex(slot.entry.baseId) });
      papyrus('ObjectReference', 'SetPosition', id, pose.pos);
      papyrus('ObjectReference', 'SetAngle', id, pose.rot);
      // Clients already watching saw it appear at the rack's origin; a disable and enable sends it where it now stands
      mp.set(id, 'isDisabled', true);
      mp.set(id, 'isDisabled', false);
      slot.display = hex(id);
      return true;
    } catch (e) { log(`weaponracks: display for rack ${act} failed: ${e.message}`); return false; }
  };

  // ---- inventory ---------------------------------------------------------------------------------------------------------
  const inventoryOf = (a) => { const inv = mp.get(a, 'inventory'); return inv && Array.isArray(inv.entries) ? inv.entries.map((e) => Object.assign({}, e)) : []; };
  // The inventory entry held in the right hand (a shield on a shield rack), from the client's equipment report
  const heldEntry = (a, wantShield) => {
    let eq = null; try { eq = mp.get(a, 'equipment'); } catch (e) { return null; }
    const worn = (eq && eq.inv && Array.isArray(eq.inv.entries) ? eq.inv.entries : []).filter((e) => e && (e.worn || e.wornLeft));
    const held = worn.find((e) => {
      const t = typeOf(Number(e.baseId) >>> 0);
      if (wantShield) return t === 'ARMO' && keywordsOf(Number(e.baseId) >>> 0).has(KW.shield);
      return t === 'WEAP' && e.worn && !e.wornLeft;
    });
    if (!held) return null;
    const baseId = Number(held.baseId) >>> 0;
    const inv = inventoryOf(a);
    // The worn copy first: it is the one with the hand's extras
    let at = inv.findIndex((e) => (Number(e.baseId) >>> 0) === baseId && (e.worn || e.wornLeft) && (Number(e.count) || 0) > 0);
    if (at < 0) at = inv.findIndex((e) => (Number(e.baseId) >>> 0) === baseId && (Number(e.count) || 0) > 0);
    return at < 0 ? null : { inv, at, baseId };
  };
  const plainEntry = (e) => Object.keys(e).every((k) => k === 'baseId' || k === 'count' || e[k] === undefined || e[k] === null);
  const giveEntry = (a, entry) => {
    const inv = inventoryOf(a);
    const copy = Object.assign({}, entry); delete copy.worn; delete copy.wornLeft;
    const stack = plainEntry(copy) ? inv.find((e) => (Number(e.baseId) >>> 0) === (Number(copy.baseId) >>> 0) && plainEntry(Object.assign({}, e, { worn: undefined, wornLeft: undefined }))) : null;
    if (stack) stack.count = (Number(stack.count) || 0) + (Number(copy.count) || 1);
    else inv.push(Object.assign(copy, { count: Number(copy.count) || 1 }));
    mp.set(a, 'inventory', { entries: inv });
  };

  // ---- pending returns ---------------------------------------------------------------------------------------------------
  // key: the owner's character ("c<hex>") or profile (keyOfActor, ownerKeyOf)
  const queue = (key, entry, from) => {
    const st = state(); const k = String(key);
    (st.pending[k] = st.pending[k] || []).push({ entry, from, at: new Date(now()).toISOString() });
  };
  // Pending list cleared and written first, then given; a give that fails goes back on the list
  const deliver = (a, quiet) => {
    const st = state();
    // Kept for this character, and for its account before property was per character
    const keys = keysOfActor(a).filter((k) => Array.isArray(st.pending[k]) && st.pending[k].length);
    if (!keys.length) return 0;
    const list = [].concat(...keys.map((k) => st.pending[k]));
    const was = keys.map((k) => [k, st.pending[k]]);
    for (const k of keys) delete st.pending[k];
    const k = keys[0];
    if (!save()) { for (const [key, l] of was) st.pending[key] = l; return 0; }
    const given = [], failed = [];
    for (const p of list) { try { giveEntry(a, p.entry); given.push(p); } catch (e) { failed.push(p); log(`weaponracks: return to ${who(a)} failed: ${e.message}`); } }
    if (failed.length) { st.pending[k] = (st.pending[k] || []).concat(failed); save(); }
    if (given.length) {
      audit(`WEAPONRACK returned ${given.map((p) => itemName(p.entry)).join(', ')} to ${who(a)} (${given.map((p) => p.from).join(', ')})`);
      if (!quiet) personal(a, given.length === 1 ? `Your ${itemName(given[0].entry)} was taken down from a weapon rack and given back to you.` : `${given.length} weapons were taken down from weapon racks and given back to you: ${given.map((p) => itemName(p.entry)).join(', ')}.`);
    }
    return given.length;
  };

  // ---- place and take ----------------------------------------------------------------------------------------------------
  const place = (a, rack, home) => {
    const held = heldEntry(a, rack.rackType === 2);
    if (!held) return rack.rackType === 2 ? 'Hold a shield to hang it on the rack.' : 'Hold the weapon you want to put on the rack.';
    const kind = kindOf(held.baseId);
    if (!kind) return 'That will not sit on a weapon rack.';
    const no = accepts(rack.rackType, kind); if (no) return no;
    const poseRef = rack.mesh || rack.act;
    if (!poses() || !pivotsOf(poseRef)) return 'This rack is not ready yet.';
    const node = nodeFor(kind, held.baseId, poseRef);
    if (!slotPose(poseRef, node)) return pivotsOf(poseRef)[node.toLowerCase()] ? 'This rack is not ready yet.' : `A ${NAMES[kind]} will not fit on this rack.`;
    const src = held.inv[held.at];
    const entry = Object.assign({}, src, { count: 1 }); delete entry.worn; delete entry.wornLeft;
    const act = hex(rack.act);
    const st = state();
    st.racks[act] = { entry, kind, node, mesh: hex(poseRef), home: hex(home.primary), owner: Number(home.rec.owner), ownerKey: ownerKeyOf(home.rec), by: perChar() ? keyOfActor(a) : profileOf(a), at: new Date(now()).toISOString(), display: null };
    if (!save()) { delete st.racks[act]; return 'Something went wrong there. Try again in a moment.'; }
    try { papyrus('Actor', 'UnequipItem', a, [{ type: 'espm', desc: mp.getDescFromId(held.baseId) }, false, true]); } catch (e) { /* the inventory change below unequips it anyway */ }
    try {
      const inv = held.inv;
      if ((Number(src.count) || 1) > 1) { inv[held.at] = Object.assign({}, src, { count: Number(src.count) - 1 }); delete inv[held.at].worn; delete inv[held.at].wornLeft; }
      else inv.splice(held.at, 1);
      mp.set(a, 'inventory', { entries: inv });
    } catch (e) {
      delete st.racks[act]; save();
      log(`weaponracks: taking ${itemName(entry)} from ${who(a)} failed: ${e.message}`);
      return 'Something went wrong there. Try again in a moment.';
    }
    if (spawnDisplay(act, st.racks[act])) save();
    audit(`WEAPONRACK ${who(a)} racked ${itemName(entry)} (${hex(entry.baseId)}) on ${act} in home ${hex(home.primary)} (owner ${home.rec.owner})`);
    personal(a, `You set your ${itemName(entry)} on the rack.`);
    return '';
  };
  // as: { rank, hold } when a hold manager takes it down rather than the household
  const take = (a, act, slot, as) => {
    const st = state();
    delete st.racks[act];
    queue(keyOfActor(a), slot.entry, `rack ${act}`);
    if (!save()) { st.racks[act] = slot; const k = keyOfActor(a); st.pending[k].pop(); if (!st.pending[k].length) delete st.pending[k]; return 'Something went wrong there. Try again in a moment.'; }
    removeDisplay(slot.display);
    deliver(a, true);
    if (as) {
      audit(`WEAPONRACK hold manager ${who(a)} took ${itemName(slot.entry)} (${hex(slot.entry.baseId)}) down from ${act} in home ${slot.home} (owner profile ${slot.owner}, racked by ${slot.by}): as ${as.rank} of ${as.hold}`);
      personal(a, `As ${as.rank} of the hold, you take the ${itemName(slot.entry)} down from the rack.`);
      return '';
    }
    audit(`WEAPONRACK ${who(a)} took ${itemName(slot.entry)} (${hex(slot.entry.baseId)}) from ${act}`);
    personal(a, `You take your ${itemName(slot.entry)} from the rack.`);
    return '';
  };

  const notice = (a, text) => {
    if (!text) return;
    const k = `${a}:${text}`; const t = now();
    if (S.told && S.told.k === k && t - S.told.at < 1500) return; // a held activate key repeats
    S.told = { k, at: t };
    personal(a, text);
  };
  const isPlayer = (a) => { try { const u = mp.getUserByActor(a); return u !== undefined && u !== null && u !== 65535 && u >= 0; } catch (e) { return profileOf(a) >= 0; } };

  // gamemode.js, early in the activate chain: true means the activation was a rack's and ends here (the engine is refused)
  globalThis.__dboWeaponRack = (target, caster) => {
    if (C.enabled === false) return false;
    target >>>= 0; caster >>>= 0;
    let tag = null;
    if (target >= 0xff000000) { try { tag = mp.get(target, DISPLAY_TAG); } catch (e) { tag = null; } }
    let rack = null, act = '';
    if (tag && tag.rack) {
      act = String(tag.rack);
      const slot = state().racks[act];
      if (!slot || slot.display !== hex(target)) { removeDisplay(hex(target)); log(`weaponracks: removed stray display ${hex(target)} (rack ${act})`); return true; }
      rack = rackOf(parseInt(act, 16) >>> 0) || { act: parseInt(act, 16) >>> 0, mesh: parseInt(slot.mesh, 16) >>> 0, rackType: 1, start: 0 };
    } else {
      rack = rackOf(target);
      if (!rack) return false;
      act = hex(rack.act);
    }
    if (!isPlayer(caster)) return true; // an NPC neither racks nor takes
    const slot = state().racks[act];
    const home = homeOf(rack.act);
    if (slot) {
      if (home && mayUse(caster, home)) { notice(caster, take(caster, act, slot)); return true; }
      const hold = home ? holdOfHome(home) : '';
      const rank = hold ? managerRank(caster, hold) : '';
      if (!rank) { notice(caster, 'That is not yours to take.'); return true; }
      notice(caster, take(caster, act, slot, { rank, hold }));
      return true;
    }
    if (startingWeaponThere(rack)) { notice(caster, "This rack's weapon is only for show."); return true; }
    if (!home) { notice(caster, 'This rack is in no one\'s home.'); return true; }
    if (!mayUse(caster, home)) { notice(caster, 'Only the household can use this rack.'); return true; }
    notice(caster, place(caster, rack, home));
    return true;
  };

  // ---- the sweep: homes that changed hands, displays to put back, pending returns ----------------------------------------
  const sweep = () => {
    const st = state(); const H = housing();
    let changed = false;
    if (H && now() - S.bootAt >= C.bootGraceMs) {
      for (const [act, slot] of Object.entries(st.racks)) {
        let rec = null, readable = true;
        try { rec = H.recordOf(parseInt(slot.home, 16) >>> 0); } catch (e) { readable = false; }
        if (!readable) continue;
        const owner = rec && rec.owner ? Number(rec.owner) : 0;
        // The same account, and the same character where both name one (a hand-over to an alt is a change of hands)
        const was = String(slot.ownerKey || slot.owner), nowKey = owner ? ownerKeyOf(rec) : '';
        if (owner === Number(slot.owner) && !(was[0] === 'c' && nowKey[0] === 'c' && was !== nowKey)) {
          S.suspect.delete(act);
          // A slot racked before the switch learns its character, so a later hand-over to an alt is seen
          if (nowKey[0] === 'c' && was[0] !== 'c') { slot.ownerKey = nowKey; changed = true; }
          continue;
        }
        // Housing records can read as unowned for a moment (boot, a write in flight): two sweeps a while apart must agree
        const first = S.suspect.get(act);
        if (!first) { S.suspect.set(act, now()); continue; }
        if (now() - first < C.ownerChangeConfirmMs) continue;
        S.suspect.delete(act);
        delete st.racks[act];
        queue(was, slot.entry, `rack ${act}, home ${slot.home} ${owner ? `now owned by ${nowKey || owner}` : 'given up'}`);
        changed = true;
        audit(`WEAPONRACK home ${slot.home} changed hands (${was} -> ${nowKey || 'nobody'}): ${itemName(slot.entry)} from ${act} goes back to ${was}`);
        S.dropDisplays = (S.dropDisplays || []).concat(slot.display ? [slot.display] : []);
      }
    }
    if (changed && !save()) { log('weaponracks: sweep could not write; it runs again'); S.state = null; return; }
    for (const d of (S.dropDisplays || [])) removeDisplay(d);
    S.dropDisplays = [];
    let respawned = false;
    for (const [act, slot] of Object.entries(st.racks)) if (!displayOk(slot, act)) { if (slot.display) removeDisplay(slot.display); slot.display = null; if (spawnDisplay(act, slot)) respawned = true; }
    if (respawned) save();
    const online = typeof api.onlineActors === 'function' ? api.onlineActors() : [];
    for (const a of online) if (keysOfActor(a).some((k) => st.pending[k])) deliver(a >>> 0, false);
  };
  globalThis.__dboWeaponRackSweep = sweep;
  if (typeof api.every === 'function') api.every('weaponRacks', C.sweepMs, sweep);

  const st = state();
  log(`weaponracks ${C.enabled === false ? 'off' : 'on'}: ${Object.keys(st.racks).length} racked, ${Object.keys(st.pending).length} owner(s) with weapons to return, pose table ${poses() ? 'loaded' : 'missing (racks refuse to take weapons)'}`);
};
module.exports.poseMath = M;
