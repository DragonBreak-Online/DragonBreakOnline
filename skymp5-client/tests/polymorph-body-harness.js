// Scripted test for the staff polymorph's watcher side (server beastform.js creature forms, Jake 22 Oct). The server lists a
// polymorphed player's creature race in dboBeastBody, to a client that announced 'creatureBody'. This client takes only the
// eight POLYMORPH_RACES (kept apart from the beast races, so world NPC copies are unchanged), protects a player's copy in
// one the way it protects a werewolf's (settle, no 3D rebuild, no name tag, no queued 3D reset, no caster variables), never
// makes it aggressive by its race, and adds 'creatureBody' to the page's caps itself. The real beastRaceIds, beastBody,
// clientUiCaps, niNodeQueue and dboRelayService run on stubs; formView's methods run cut out of the source. From skymp5-client:
//
//   node tests/polymorph-body-harness.js [path to typescript's package dir]
'use strict';
const fs = require('fs');
const path = require('path');

const tsDir = [process.argv[2], process.env.TS_DIR, path.resolve(__dirname, '../node_modules/typescript')].find((p) => p && fs.existsSync(p));
if (!tsDir) { console.log('SKIP polymorph-body (no typescript)'); process.exit(0); }
const ts = require(tsDir);

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};
const attempt = (fn) => { try { return fn(); } catch (e) { return `threw: ${e && e.message}`; } };

const SRC = path.resolve(__dirname, '..', 'src');
const src = (p) => path.join(SRC, p);
const read = (p) => fs.readFileSync(src(p), 'utf8');
const exists = (p) => fs.existsSync(src(p));

// Any export of a stubbed module is a do-nothing function: it can be called, constructed and extended
const stub = () => new Proxy({}, { get: (_, k) => (k === '__esModule' ? true : function Stub() {}) });
// Loads file with the real modules listed in real (absolute paths) and the given stand-ins (by import specifier)
const load = (file, real = [], fakes = {}) => {
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  const req = (spec) => {
    if (Object.prototype.hasOwnProperty.call(fakes, spec)) return fakes[spec];
    const base = spec.startsWith('.') ? path.resolve(path.dirname(file), spec) : null;
    const hit = base && real.find((r) => r.replace(/\.(ts|tsx|js)$/, '') === base);
    return hit ? load(hit, real, fakes) : stub();
  };
  new Function('require', 'module', 'exports', out)(req, mod, mod.exports);
  return mod.exports;
};
// A TypeScript function body cut out of a source file, run as JS with the named stand-ins in scope
const fnFrom = (body, params, scope) => {
  const js = ts.transpileModule(`module.exports = function (${params.map((p) => p + ': any').join(', ')}): any {${body}};`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
  const mod = { exports: {} };
  new Function('module', ...Object.keys(scope), js)(mod, ...Object.values(scope));
  return mod.exports;
};
const methodBody = (text, head) => {
  const at = text.indexOf(head);
  if (at < 0) return null;
  const open = text.indexOf('{', at + head.length - 1);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
};

const WEREWOLF = 0x000cdd84, VAMPIRE_LORD = 0x0200283a, NORD = 0x00013746, DRAUGR = 0x00000d53;
const WOLF_RACE = 0x0001320a, HORSE_RACE = 0x000131fd, ELK_RACE = 0x000131ed, SABRE_CAT = 0x00013200;
const CREATURES = { ChickenRace: 0x000a919d, HareRace: 0x0006dc99, GoatDomesticsRace: 0x0006fc4a, FoxRace: 0x00109c7c,
  DogRace: 0x000131ee, SkeeverRace: 0x00013201, MudcrabRace: 0x000ba545, DeerRace: 0x000cf89b };
const CHICKEN = CREATURES.ChickenRace, DEER = CREATURES.DeerRace;
const JAKE = 0xff000b01, WOLFPLAYER = 0xff000b02, OTHER = 0xff000b03;

// ---- the allow-list -------------------------------------------------------------------------------------------------
const ids = load(src('sync/beastRaceIds.ts'));
check('beastRaceIds exports POLYMORPH_RACES, isPolymorphRaceId and isBeastOrPolymorphRaceId', ids.POLYMORPH_RACES instanceof Map &&
  typeof ids.isPolymorphRaceId === 'function' && typeof ids.isBeastOrPolymorphRaceId === 'function', Object.keys(ids));
// An older beastRaceIds still runs every check below, so each one shows what it lacks
const P = ids.POLYMORPH_RACES instanceof Map ? ids.POLYMORPH_RACES : new Map();
const isPolymorph = typeof ids.isPolymorphRaceId === 'function' ? ids.isPolymorphRaceId : () => false;
const isBeastOrPolymorph = typeof ids.isBeastOrPolymorphRaceId === 'function' ? ids.isBeastOrPolymorphRaceId : ids.isBeastRaceId;
check('exactly the eight wave-1 animals: chicken, hare, domestic goat, fox, dog, skeever, mudcrab, deer', P.size === 8 &&
  Object.entries(CREATURES).every(([edid, id]) => P.get(id) === edid), [...P.entries()].map(([k, v]) => `${k.toString(16)} ${v}`));
const nh = read('sync/nonHumanoidRaceList.ts');
const listed = Object.entries(CREATURES).filter(([edid, id]) =>
  new RegExp(`\\["Skyrim\\.esm", 0x0*${id.toString(16)}, "${edid}"\\]`).test(nh));
check('each id and editor id is the Skyrim.esm record the generated non-humanoid race list names', listed.length === 8,
  Object.keys(CREATURES).filter((e) => !listed.some(([l]) => l === e)));
check('every one is a polymorph race, signed ids too', Object.values(CREATURES).every((id) => isPolymorph(id) && isPolymorph(id | 0)));
check('wolf, horse, elk, sabre cat, a Nord, a draugr, the beasts and no race are not', [WOLF_RACE, HORSE_RACE, ELK_RACE, SABRE_CAT, NORD, DRAUGR,
  WEREWOLF, VAMPIRE_LORD, 0, null, undefined].every((id) => !isPolymorph(id)));
check('kept apart: no animal is a beast race, and the beast set is still the werewolf and the Vampire Lord',
  Object.values(CREATURES).every((id) => !ids.isBeastRaceId(id) && ids.vanillaBeastRaceOf(id) === 0) &&
  ids.BEAST_RACE_IDS.size === 2 && ids.BEAST_RACE_IDS.has(WEREWOLF) && ids.BEAST_RACE_IDS.has(VAMPIRE_LORD));
check('a beast or polymorph body: both beasts and all eight animals, nothing else',
  [WEREWOLF, VAMPIRE_LORD, ...Object.values(CREATURES)].every((id) => isBeastOrPolymorph(id)) &&
  [NORD, DRAUGR, WOLF_RACE, HORSE_RACE, 0].every((id) => !isBeastOrPolymorph(id)));
const snap = () => ({ booleans: new Uint8Array(4), floats: new Uint8Array(8), integers: new Uint8Array(8) });
ids.setNonHumanoidRaceIds([]);
check('an animal copy takes no caster variables even before the non-humanoid list resolves', Object.values(CREATURES).every((id) =>
  ids.isGuardedRaceId(id) && ids.casterVariablesFor(id, snap()).floats.length === 0));
check('...and a Nord copy still takes them (the guard did not widen past the animals)', !ids.isGuardedRaceId(NORD) && ids.casterVariablesFor(NORD, snap()).floats.length === 8);
const fv = read('view/formView.ts');
const ambush = (fv.match(/private static readonly ambushRaces = \[([^\]]*)\]/) || [])[1] || '';
const ambushIds = ambush.split(',').map((s) => Number(s.trim()) >>> 0);
check('no animal is one of formView\'s ambush races (wolf 1320a is, so it stays out)', ambushIds.length > 5 && ambushIds.includes(WOLF_RACE) &&
  Object.values(CREATURES).every((id) => !ambushIds.includes(id)), ambush);
const lips = read('services/services/lipSyncService.ts');
check('world NPCs unchanged: lip sync still asks isBeastRaceId (every animal race lacks a FaceGen head, so it skips them already)',
  /return race \? isBeastRaceId\(race\.getFormID\(\)\) : null;/.test(lips) && !/Polymorph/.test(lips));
check('...and the beast loadout is still found by vanillaBeastRaceOf, which no animal has (no beast perks or spells)',
  /BEAST_LOADOUT\[vanillaBeastRaceOf\(raceId\)\]/.test(read('services/services/beastFormService.ts')));

// ---- the body list ----------------------------------------------------------------------------------------------------
const body = load(src('sync/beastBody.ts'), [src('sync/beastRaceIds.ts')]);
body.setBeastBodies([{ id: JAKE, race: CHICKEN }, { id: WOLFPLAYER, race: WEREWOLF }, { id: OTHER, race: DEER }]);
check('a listed chicken is shown in its body', body.beastBodyOf(JAKE) === CHICKEN);
check('...next to a listed werewolf, who keeps his (one list carries both)', body.beastBodyOf(WOLFPLAYER) === WEREWOLF && body.beastBodyOf(OTHER) === DEER);
body.setBeastBodies(Object.values(CREATURES).map((race, i) => ({ id: 0xff000c00 + i, race })));
check('every one of the eight is taken', Object.values(CREATURES).every((race, i) => body.beastBodyOf(0xff000c00 + i) === race));
body.setBeastBodies([{ id: JAKE, race: WOLF_RACE }, { id: WOLFPLAYER, race: HORSE_RACE }, { id: OTHER, race: NORD }, { id: 0, race: CHICKEN }]);
check('a race off the list (wolf, horse, a Nord) or an entry with no id is dropped', body.beastBodyOf(JAKE) === 0 && body.beastBodyOf(WOLFPLAYER) === 0 &&
  body.beastBodyOf(OTHER) === 0);
body.setBeastBodies([]);
const pkt = (bodies) => ({ customPacketType: 'dboBeastBody', bodies });
const parsed = attempt(() => body.parseBeastBodies(pkt([{ id: JAKE, race: CHICKEN }, { id: WOLFPLAYER, race: WEREWOLF }, { id: OTHER, race: WOLF_RACE },
  { id: String(0xff000b04), race: String(DEER) }, { id: 0xff000b05, race: SABRE_CAT }])));
check('the packet keeps the animals and the werewolf, and drops the wolf and the sabre cat', JSON.stringify(parsed) ===
  JSON.stringify([{ id: JAKE, race: CHICKEN }, { id: WOLFPLAYER, race: WEREWOLF }, { id: 0xff000b04, race: DEER }]), parsed);
const look = body.beastBodyAppearance({ isFemale: false, raceId: NORD, weight: 40, headpartIds: [1, 2], tints: [{}], options: [1], presets: [2],
  headTextureSetId: 9, name: 'Chicken' }, CHICKEN);
check('a chicken\'s copy is built bare in ChickenRace, named Chicken', look.raceId === CHICKEN && !look.headpartIds.length && !look.tints.length &&
  look.headTextureSetId === 0 && look.name === 'Chicken');
body.setBeastBodies([{ id: JAKE, race: CHICKEN }]);
check('a listed chicken\'s copy gets no caster variables while the engine still reads it as a Nord',
  ids.casterVariablesFor(body.beastBodyOf(JAKE) || NORD, snap()).floats.length === 0);
body.setBeastBodies([]);
const races = read('sync/beastRaces.ts');
check('guardedRaceOf still answers the listed race first (remote id), so the list guards the copy before its respawn',
  /const listed = beastBodyOf\(remoteId\);\s*if \(listed\) return listed;/.test(races));

// ---- a player's copy in an animal body is a beast copy ------------------------------------------------------------------
const copyBody = methodBody(fv, 'private isBeastCopy(model: FormModel): boolean {');
check('formView.isBeastCopy is there', !!copyBody);
const isBeastCopy = copyBody ? fnFrom(copyBody, ['model'], { isBeastRaceId: ids.isBeastRaceId, isBeastOrPolymorphRaceId: isBeastOrPolymorph }) : () => false;
const playerIn = (raceId) => ({ appearance: { raceId, name: 'x' }, numAppearanceChanges: 1 });
check('a player\'s copy shown as a chicken, fox or deer is a beast copy (1.5 s settle, no 3D rebuild, no name tag)',
  [CHICKEN, CREATURES.FoxRace, DEER].every((r) => isBeastCopy(playerIn(r)) === true));
check('...as is a werewolf or a Vampire Lord, as before', isBeastCopy(playerIn(WEREWOLF)) === true && isBeastCopy(playerIn(VAMPIRE_LORD)) === true);
check('a world NPC chicken or deer copy is not (it has a base, no appearance)', isBeastCopy({ baseId: 0xa91a0 }) === false &&
  isBeastCopy({ baseId: 0x23a91, appearance: undefined }) === false);
check('a mortal player is not', isBeastCopy(playerIn(NORD)) === false);
check('the settle reads isBeastCopy', /private isSettlingBeast\(model: FormModel\): boolean \{\s*return this\.isBeastCopy\(model\) && \(this\.spawnMoment === 0 \|\| Date\.now\(\) - this\.spawnMoment < BEAST_SPAWN_SETTLE_MS\);/.test(fv));
check('the on-screen 3D rebuild is refused for it', /onScreenRebuildDue\(this\.rebuild, isOnScreen, loaded, this\.isBeastCopy\(model\),/.test(fv) &&
  /if \(entering && this\.isBeastCopy\(model\)\) faceSync\.skip\(this\.refrId, "beast"\);/.test(fv));
check('the floating name tag is hidden over it (staff with real names on excepted)',
  /&& \(!this\.isBeastCopy\(model\) \|\| \(revealing && revealLabelFor\(known, this\.getRemoteRefrId\(\)\) !== ""\)\);/.test(fv));
check('the listed body is swapped in before anything reads the model', /const beastRace = beastBodyOf\(this\.remoteRefrId\);\s*if \(beastRace && model\.appearance\) model = this\.withBeastBody\(model, beastRace\);/.test(fv));

// ---- never aggressive by its race -------------------------------------------------------------------------------------
const aggroBody = methodBody(fv, 'private static attacksEveryone(actor: Actor, model: FormModel, remoteId: number | undefined): boolean {');
check('formView.attacksEveryone is there', !!aggroBody);
const attacksEveryone = aggroBody ? fnFrom(aggroBody, ['actor', 'model', 'remoteId'], {
  FormView: { ambushRaces: ambushIds }, isOwnCompanion: () => false, isAnyCompanion: () => false,
  Game: { getPlayer: () => ({}) } }) : () => true;
const actorOf = (race, aggression = 0, reaction = 0) => ({ getRace: () => ({ getFormID: () => race }), getActorValue: () => aggression,
  getFactionReaction: () => reaction });
check('a player\'s copy whose engine race is an ambush race (a wave-2 wolf) is never made aggressive',
  attacksEveryone(actorOf(WOLF_RACE), playerIn(WOLF_RACE), JAKE) === false);
check('...nor one in an animal body, nor a mortal one', attacksEveryone(actorOf(CHICKEN), playerIn(CHICKEN), JAKE) === false &&
  attacksEveryone(actorOf(NORD), playerIn(NORD), JAKE) === false);
check('a world NPC of an ambush race (a draugr, a wolf) still attacks everyone', attacksEveryone(actorOf(DRAUGR), { baseId: 1 }, 0xff000d01) === true &&
  attacksEveryone(actorOf(WOLF_RACE), { baseId: 1 }, 0xff000d02) === true);
check('...a world chicken does not, and the server\'s false flag still wins', attacksEveryone(actorOf(CHICKEN), { baseId: 1 }, 0xff000d03) === false &&
  attacksEveryone(actorOf(DRAUGR), { baseId: 1, ff_hostile: false }, 0xff000d04) === false);
check('...a hostile-flagged NPC and a plugin-aggressive one still do, an already raised one is left as it is',
  attacksEveryone(actorOf(NORD, 0), { baseId: 1, ff_hostile: true }, 0xff000d05) === true &&
  attacksEveryone(actorOf(NORD, 1), { baseId: 1 }, 0xff000d06) === true && attacksEveryone(actorOf(NORD, 2), { baseId: 1 }, 0xff000d07) === false);

// ---- no queued 3D reset on the copy or on the polymorphed player ------------------------------------------------------
const COPY = 0xff000123, NPC = 0xff000124;
const G = { race: NORD, copyRace: NORD, npcRace: NORD, sent: 0, copySent: [], ons: [], traces: [], dropped: [] };
const actor = (id, raceOf) => ({ getFormID: () => id, getRace: () => ({ getFormID: raceOf }), is3DLoaded: () => true,
  queueNiNodeUpdate: () => { if (id === 0x14) G.sent++; else G.copySent.push(id); } });
const player = actor(0x14, () => G.race), copy = actor(COPY, () => G.copyRace), npc = actor(NPC, () => G.npcRace);
const sp = { Game: { getPlayer: () => player, getFormEx: (id) => ((id >>> 0) === COPY ? copy : (id >>> 0) === NPC ? npc : null) },
  Actor: { from: (a) => a }, on: (ev, fn) => G.ons.push(fn), printConsole() {} };
const Q = load(src('view/niNodeQueue.ts'), [src('view/niNodeQueuePlan.ts'), src('sync/beastRaceIds.ts')], {
  skyrimPlatform: sp, '../lib/clientDiag': { trace: (t) => G.traces.push(t) },
  './faceSyncDiag': new Proxy({}, { get: (_, k) => (k === 'dropped' ? (id, why) => G.dropped.push([id >>> 0, why]) : () => {}) }) });
const frames = (n) => { for (let i = 0; i < n; i++) G.ons.forEach((fn) => fn()); };
const playerSent = (race) => { G.race = race; G.sent = 0; Q.queuePlayerNiNodeUpdate(); frames(3); return G.sent; };
check('a mortal player\'s own NiNode update goes out', playerSent(NORD) === 1);
check('a polymorphed player\'s does not, for every animal (no 3D reset on a creature graph)', Object.values(CREATURES).every((r) => playerSent(r) === 0));
check('...and says so in the trace', G.traces.includes('ni self skip=beast'), G.traces);
check('a werewolf player\'s still does not', playerSent(WEREWOLF) === 0);
check('after the revert the next one goes out again', playerSent(NORD) === 1);
G.race = NORD;
const copySent = (race) => { G.copyRace = race; G.copySent = []; frames(3); Q.queueCopyNiNodeUpdate(COPY); frames(4); return G.copySent.filter((id) => id === COPY).length; };
check('a mortal copy\'s queued 3D update goes out', copySent(NORD) === 1);
check('a copy that is now a chicken is dropped from the queue, not sent', copySent(CHICKEN) === 0 &&
  G.dropped.some(([id, why]) => id === COPY && why === 'beast'), G.dropped);
check('...a deer or a mudcrab too, and a werewolf as before', copySent(DEER) === 0 && copySent(CREATURES.MudcrabRace) === 0 && copySent(WEREWOLF) === 0);
check('a copy back in its mortal race is sent again', copySent(NORD) === 1);

// ---- the cap ----------------------------------------------------------------------------------------------------------
check('the client\'s own caps live in lib/clientUiCaps.ts', exists('lib/clientUiCaps.ts'));
const caps = exists('lib/clientUiCaps.ts') ? load(src('lib/clientUiCaps.ts')) : {};
check('creatureBody is a client cap', Array.isArray(caps.CLIENT_UI_CAPS) && caps.CLIENT_UI_CAPS.includes('creatureBody'), caps.CLIENT_UI_CAPS);
const sent = [];
const handlers = {};
const controller = { on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); }, once() {}, emitter: { on() {} } };
const relay = attempt(() => load(src('services/services/dboRelayService.ts'), [src('lib/clientUiCaps.ts')], {
  './customPacketUtil': { sendCustomPacket: (c, p) => sent.push(p), parseCustomPacket: () => null, notifyNextUpdate() {} } }));
const made = relay && relay.DboRelayService ? attempt(() => new relay.DboRelayService({}, controller)) : relay;
check('the relay service loads and listens for the page', typeof made === 'object' && (handlers.browserMessage || []).length === 1, String(made));
const fromPage = (...a) => { sent.length = 0; (handlers.browserMessage || []).forEach((fn) => fn({ arguments: a })); return sent[0]; };
const capsPkt = fromPage('dbo:uiCaps', 'bank', 'beastBody', 'journal');
check('the page\'s dbo:uiCaps reaches the server with creatureBody added, after the page\'s own',
  !!capsPkt && capsPkt.event === 'uiCaps' && JSON.stringify(capsPkt.args) === JSON.stringify(['bank', 'beastBody', 'journal', 'creatureBody']), capsPkt);
const twice = fromPage('dbo:uiCaps', 'beastBody', 'creatureBody');
check('...once only, if the page already said it', !!twice && twice.args.filter((c) => c === 'creatureBody').length === 1, twice);
const other = fromPage('dbo:bankDeposit', '25');
check('any other page message is forwarded as it was', !!other && other.event === 'bankDeposit' && JSON.stringify(other.args) === '["25"]', other);
const hud = fs.readFileSync(path.resolve(__dirname, '..', '..', 'skymp5-front', 'src', 'features', 'hud', 'index.tsx'), 'utf8');
const uiCaps = (hud.match(/const UI_CAPS = \[[^\]]*\];/) || [''])[0];
check('the front still announces beastBody, and never creatureBody (a front built ahead of this client cannot claim it)',
  /'beastBody'/.test(uiCaps) && !/creatureBody/.test(hud));

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
