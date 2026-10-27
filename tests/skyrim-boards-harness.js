// The expedition boards Nat placed in the Skyrim holds (DragonBreak Strongholds Fix.esp, 27 Oct): in Skyrim they post the
// hold's contracts and the rest, NOT expeditions (no ruin there to send a party to yet). This drives the real dungeons.js
// with a mock gamemode api: a Skyrim board opens on its Contracts tab with no expeditions and sends no party, the Bruma halls'
// boards are as they were, and dungeons.boards turns expeditions on per province or per board.
//   node tests/skyrim-boards-harness.js   (from server/)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const DUNGEONS = path.resolve(__dirname, '..', 'dungeons.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-nate-skyrim-boards-'));
process.chdir(dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* left for the OS */ } });
global.setTimeout = () => 0;

const SYNOD = '20ff:BSHeartland.esm', WHITERUN = '1a26f:Skyrim.esm', TAMRIEL = '3c:Skyrim.esm', RUIN = 'ef1aa:BSHeartland.esm';
const SKY_BOARD = 0x4a000801, SKY_BOARD2 = 0x4a000802, SYNOD_BOARD = 0x3c144975;
const A = 0x14;   // a player with the board panel
const OLD = 0x15; // a player whose client has no board panel
fs.writeFileSync('dungeons.json', JSON.stringify({ dungeons: [] }));
fs.writeFileSync('expeditions.json', JSON.stringify({ expeditions: [{ id: 'CYRNiryastareLocation', name: 'Niryastare', type: 'ayleid', county: 'Kvatch County',
  cells: [{ desc: RUIN }], chests: [], zones: [],
  entrances: [{ expedition: true, cell: SYNOD, pos: [0, 0, 0], rot: [0, 0, 0], doorPos: [0, 0, 0], insideDesc: 'ef1ad:BSHeartland.esm', insideCell: RUIN, insidePos: [0, 0, 0], insideRot: [0, 0, 0] }] }] }));
const props = new Map();
const put = (id, k, v) => props.set(`${id >>> 0}|${k}`, v);
// The real base of every board, Nat's new ones included: DragonBreak.esp 000006, "Noticeboard" in DragonBreak.esp but
// ExpeditionBoard in its winning override (DragonBreak Online Edits.esp), which is what the server reads. The town notice
// boards are other bases (manny_up_NoticeBoardActivator, OBS_*, RP_NoticeBoard: notice-board-spots.json)
for (const b of [SKY_BOARD, SKY_BOARD2, SYNOD_BOARD]) put(b, 'baseDesc', '6:DragonBreak.esp');
put(SKY_BOARD, 'worldOrCellDesc', WHITERUN); put(SKY_BOARD2, 'worldOrCellDesc', TAMRIEL); put(SYNOD_BOARD, 'worldOrCellDesc', SYNOD);
const descOf = (id) => ((id >>> 24) === 0x4a ? `${(id & 0xffffff).toString(16)}:DragonBreak Strongholds Fix.esp` : `${(id >>> 0).toString(16)}:Skyrim.esm`);
let widgets = [], said = [];
const commands = new Map();
let ui = new Map();
let contractsView = { zone: 'Whiterun', list: [{ id: 1, what: 'wolves' }], enabled: true };
const load = (cfg) => {
  ui = new Map();
  globalThis.__dboDungeons = undefined; globalThis.__dboExpeditionPending = undefined;
  delete require.cache[DUNGEONS];
  require(DUNGEONS)({
    mp: {
      get: (id, p) => (p === 'profileId' ? (id === A ? 1 : id === OLD ? 2 : -1) : props.get(`${id >>> 0}|${p}`)),
      set: (id, p, v) => props.set(`${id >>> 0}|${p}`, v),
      getIdFromDesc: (d) => parseInt(String(d).split(':')[0], 16),
      getDescFromId: descOf,
      getActorsByProfileId: (p) => (p === 1 ? [A] : p === 2 ? [OLD] : []),
      lookupEspmRecordById: (id) => (id === 6 ? { record: { editorId: 'ExpeditionBoard' } } : { record: null }),
    },
    log: () => {}, personal: (a, t) => said.push([a, t]), system: (a, t) => said.push([a, t]), audit: () => {},
    registerChatCommand: (n, fn) => commands.set(n, fn), onUi: (n, fn) => { const l = ui.get(n) || []; l.push(fn); ui.set(n, l); },
    openWidget: (a, w, focus) => { widgets.push([a, w, focus]); return true; }, closeWidget: () => true,
    sendPacket: () => true, findByName: () => 0, display: String, who: String,
    profileOf: (a) => (a === A ? 1 : a === OLD ? 2 : -1), nameOf: () => 'P', onlineActors: () => [A, OLD],
    isAdmin: () => false, giveItem: () => true, cfg: { dungeons: cfg || {} }, every: () => {},
  });
  fire('uiCaps', A, ['expeditionBoard']);
};
globalThis.__dboContractsBoard = { view: () => contractsView };
const fire = (n, a, args) => (ui.get(n) || []).forEach((f) => f(a, args, 0));
let failures = 0;
const check = (label, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail !== undefined ? '   ' + JSON.stringify(detail).slice(0, 400) : ''}`); if (!ok) failures++; };
const last = (a) => { for (let i = said.length - 1; i >= 0; i--) if (said[i][0] === a) return said[i][1]; return ''; };
const board = (a) => { const w = widgets.filter((x) => x[0] === a && x[1].type === 'expeditionBoard').pop(); return w ? w[1] : null; };
const at = (a, cell) => put(a, 'worldOrCellDesc', cell);
const use = (ref, a) => { widgets = []; said = []; return globalThis.__dboDungeonActivate(ref, a); };

// ---- the shipped default: Skyrim's boards post no expeditions --------------------------------------------------------------
load();
at(A, WHITERUN);
let v = use(SKY_BOARD, A), w = board(A);
check('a Skyrim hold board opens the board panel', v === false && !!w, { v, said: last(A) });
check('...with no expeditions on it', !!w && Array.isArray(w.expeditions) && w.expeditions.length === 0, w && w.expeditions);
check('...on the Contracts tab, the hold\'s work there', !!w && w.tab === 'contracts' && w.contracts === contractsView, w && { tab: w.tab, c: w.contracts });
check('...named for the hold, and marked as posting none', !!w && w.hall === 'Whiterun' && w.expeditionsPosted === false, w && { hall: w.hall, p: w.expeditionsPosted });
check('...and never refused with "set out from the boards in ..."', !/set out from the boards/.test(last(A)), last(A));
fire('expeditionPick', A, ['CYRNiryastareLocation']);
check('a ruin picked from a Skyrim board sends no party (no gate panel)', !widgets.some((x) => x[1].type === 'dungeonGate'), widgets.map((x) => x[1].type));
use(SKY_BOARD, A);
widgets = [];
globalThis.__dboExpeditionBoardRefresh(A, 'contracts');
check('contracts.js\'s redraw after a take keeps the Skyrim board without expeditions', !!board(A) && board(A).expeditions.length === 0 && board(A).tab === 'contracts', board(A));
at(A, TAMRIEL);
v = use(SKY_BOARD2, A);
check('an outdoor Skyrim board (Tamriel) is the same', v === false && !!board(A) && board(A).expeditions.length === 0);
contractsView = undefined;
use(SKY_BOARD, A);
check('with nothing to post the Skyrim board says so, not "no expeditions are being organised"', !board(A) && /Nothing is posted on this board/.test(last(A)), last(A));
contractsView = { zone: 'Whiterun', list: [], enabled: true };
at(OLD, WHITERUN);
use(SKY_BOARD, OLD);
check('a client without the board panel is pointed at /contract, not given the expedition menu', !widgets.some((x) => x[0] === OLD) && /\/contract/.test(last(OLD)), { said: last(OLD), w: widgets.map((x) => x[1].type) });

// ---- the Bruma halls as they were --------------------------------------------------------------------------------------------
at(A, SYNOD);
v = use(SYNOD_BOARD, A); w = board(A);
check('the Synod Conclave\'s board still lists the ruins', v === false && !!w && w.expeditions.length === 1 && w.expeditions[0].name === 'Niryastare' && w.expeditionsPosted === true, w);
check('...on its Expeditions tab', !!w && w.tab === 'expeditions', w && w.tab);
fire('expeditionPick', A, ['CYRNiryastareLocation']);
check('...and a pick there still offers the party its gate', widgets.some((x) => x[1].type === 'dungeonGate') || /Niryastare/.test(last(A)), { said: last(A), w: widgets.map((x) => x[1].type) });

// ---- turned on later: per province, per board ---------------------------------------------------------------------------------
load({ boards: { expeditions: { skyrim: true } } });
at(A, WHITERUN);
use(SKY_BOARD, A);
check('dungeons.boards.expeditions.skyrim true: a Skyrim board posts expeditions (and, with no hall of its own, says where parties set out)', !board(A) && /set out from the boards/.test(last(A)), last(A));
load({ boards: { refs: { '801:DragonBreak Strongholds Fix.esp': { expeditions: true } } } });
use(SKY_BOARD, A);
check('a board of its own (refs by desc) turned on posts expeditions', /set out from the boards/.test(last(A)), last(A));
use(SKY_BOARD2, A);
check('...while the hold\'s other boards still post none', !!board(A) && board(A).expeditions.length === 0, last(A));
load({ boards: { refs: { '802:DragonBreak Strongholds Fix.esp': { province: 'cyrodiil' } } } });
at(A, TAMRIEL);
use(SKY_BOARD2, A);
check('a board given a province takes that province\'s setting', !board(A) && /set out from the boards/.test(last(A)), last(A));
load({ boards: { expeditions: { cyrodiil: false } } });
at(A, SYNOD);
use(SYNOD_BOARD, A);
check('and Cyrodiil\'s can be turned off the same way', !!board(A) && board(A).expeditions.length === 0 && board(A).tab === 'contracts', board(A));
widgets = []; said = [];
fire('expeditionPick', A, ['CYRNiryastareLocation']);
check('...and a ruin picked from that board, though in a hall parties leave from, sends no party', !widgets.some((x) => x[1].type === 'dungeonGate') && !/Niryastare/.test(last(A)), { said: last(A), w: widgets.map((x) => x[1].type) });

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
