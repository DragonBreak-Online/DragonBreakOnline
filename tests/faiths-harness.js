// Faiths (prayer.js + faiths.json, Nate 18 Oct): a faith first, then a patron in it; every shrine of the faith answers;
// a new patron within the faith takes a day, a new faith the week; the new gods and the other names are in the roster.
//   node tests/faiths-harness.js   (from server/)
'use strict';
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
process.chdir(SERVER);
const PRAYER = path.join(SERVER, 'prayer.js');
const SKILLS = require(path.join(SERVER, 'skills.json'));
const FAITHS = require(path.join(SERVER, 'faiths.json'));
let wallClock = 1780000000000; Date.now = () => wallClock;
globalThis.performance = { now: () => 0 };
const idOf = (d) => parseInt(String(d).split(':')[0], 16) >>> 0;
const choiceOf = (id) => SKILLS.deities.choices.find((c) => c.id === id);
const ACTOR = 0x14, BOSMER = 0x15, NORD = 0x16;
const MARA_SHRINE = 0x2002, AZURA_SHRINE = 0x2003;
const props = new Map();
props.set(MARA_SHRINE + '|baseDesc', choiceOf('mara').shrines[0]);
props.set(AZURA_SHRINE + '|baseDesc', choiceOf('azura').shrines[0]);
const RACES = { 0x100: 'ImperialRace', 0x101: 'WoodElfRace', 0x102: 'NordRace' };
props.set(ACTOR + '|appearance', { raceId: 0x100 }); props.set(BOSMER + '|appearance', { raceId: 0x101 }); props.set(NORD + '|appearance', { raceId: 0x102 });
const records = new Map([[idOf(choiceOf('mara').shrines[0]), { record: { type: 'ACTI', editorId: 'ShrineofMara' } }],
  [idOf(choiceOf('azura').shrines[0]), { record: { type: 'ACTI', editorId: 'ShrineofAzura' } }]]);
for (const [id, e] of Object.entries(RACES)) records.set(Number(id), { record: { type: 'RACE', editorId: e } });
const said = []; const handlers = new Map(); const answers = [];
const api = {
  mp: { getIdFromDesc: (d) => idOf(d), getDescFromId: (id) => String(id), get: (id, p) => props.get(id + '|' + p), set: (id, p, v) => props.set(id + '|' + p, v),
    lookupEspmRecordById: (id) => records.get(id) || null, callPapyrusFunction: () => {} },
  log: () => {}, personal: (a, t) => said.push(t), audit: () => {}, display: () => 'Tester', who: () => 'Tester',
  cfg: { prayer: { clientJudged: false } }, distanceMeters: () => 2, openWidget: () => true, closeWidget: () => true,
  onUi: (ev, fn) => { const l = handlers.get(ev) || []; l.push(fn); handlers.set(ev, l); }, registerChatCommand: () => {},
  onlineActors: () => [ACTOR], every: () => {}, skills: SKILLS, takeGold: () => true, treasuryHere: (a, n) => n, hasUiCap: () => false,
};
globalThis.__dboJournalFresh = () => true;
globalThis.__dboJournalLimited = (a, fn) => answers.push(fn());
require(PRAYER)(api);
let fails = 0; const ok = (l, c, g) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${l}${!c && g !== undefined ? `: got ${JSON.stringify(g)}` : ''}`); if (!c) fails++; };
const choose = (a, id, faith) => { answers.length = 0; (handlers.get('journalDeity') || []).forEach((f) => f(a, ['N', id, faith || ''])); return answers.at(-1) || {}; };
const rec = (a) => props.get(a + '|private.dboDeity') || {};

let v = globalThis.__dboDeityView(ACTOR);
ok('the roster is skills.json\'s gods then the 15 new ones', v.choices.length === SKILLS.deities.choices.length + 15 && v.choices.slice(0, SKILLS.deities.choices.length).map((c) => c.id).join() === SKILLS.deities.choices.map((c) => c.id).join());
ok('13 faiths, the Green Pact among them with Y\'ffre', v.faiths.length === 13 && v.faiths.find((f) => f.id === 'greenpact').patrons.includes('yffre'));
ok('other names: Kynareth is also Kyne and Khenarthi', ['Kyne', 'Khenarthi'].every((n) => v.choices.find((c) => c.id === 'kynareth').alsoKnownAs.includes(n)));
ok('the suggested faith follows the race (a Bosmer: the Green Pact)', globalThis.__dboDeityView(BOSMER).faiths.find((f) => f.id === 'greenpact').suggested && !globalThis.__dboDeityView(BOSMER).faiths.find((f) => f.id === 'imperial').suggested);
ok('Sithis is hunted', v.choices.find((c) => c.id === 'sithis').lawful === false && /Hunted/.test(v.choices.find((c) => c.id === 'sithis').unlawfulWhere));

let r = choose(ACTOR, 'akatosh', 'imperial');
ok('an Imperial takes Akatosh in the Imperial Cult', r.kind === 'ok' && rec(ACTOR).faith === 'imperial' && /in The Imperial Cult/.test(r.text), r);
ok('a Mara shrine hears an Akatosh follower: the same faith', !globalThis.__dboPrayerRefusal(ACTOR, MARA_SHRINE), globalThis.__dboPrayerRefusal(ACTOR, MARA_SHRINE));
ok('an Azura shrine does not: another faith', /no ear/.test(String(globalThis.__dboPrayerRefusal(ACTOR, AZURA_SHRINE))));
r = choose(ACTOR, 'mara', 'imperial');
ok('a new patron within the faith waits a day', r.kind === 'refused' && /in 1 day/.test(r.text), r);
wallClock += 1.1 * 86400000;
r = choose(ACTOR, 'mara', 'imperial');
ok('...then Mara is taken, still in the Imperial Cult', r.kind === 'ok' && rec(ACTOR).id === 'mara' && rec(ACTOR).faith === 'imperial', r);
wallClock += 1.1 * 86400000;
r = choose(ACTOR, 'azura', 'daedric');
ok('a new faith waits the week', r.kind === 'refused' && /in \d+ days/.test(r.text), r);
r = choose(ACTOR, 'azura', 'imperial');
ok('a god outside the faith named is refused', r.kind === 'refused' && /no god of that faith/.test(r.text), r);
r = choose(BOSMER, 'yffre');
ok('a Bosmer takes Y\'ffre: the Green Pact', r.kind === 'ok' && rec(BOSMER).faith === 'greenpact', r);
ok('...and the Green Pact can ask for it', JSON.stringify(globalThis.__dboFaithOf(BOSMER)) === JSON.stringify({ faith: 'greenpact', patron: 'yffre', sworn: 'greenpact' }));
r = choose(NORD, 'mara');
ok('a Nord taking Mara with no faith named stands in the Old Ways', r.kind === 'ok' && rec(NORD).faith === 'oldways', rec(NORD));
props.set(NORD + '|private.dboDeity', { id: 'kynareth', name: 'Kynareth', at: 1, convertedAt: 1 });
ok('a god taken before faiths finds its faith by the race (a Nord\'s Kynareth: the Old Ways)', globalThis.__dboFaithOf(NORD).faith === 'oldways', globalThis.__dboFaithOf(NORD));
ok('a god taken before the faiths is not sworn', globalThis.__dboFaithOf(NORD).sworn === '');
// /greenpact swear (greenpact.js): a wood elf whose old god is of the Pact swears to it; nobody else can
const OLDBOSMER = 0x17; props.set(OLDBOSMER + '|appearance', { raceId: 0x101 });
props.set(OLDBOSMER + '|private.dboDeity', { id: 'zenithar', name: 'Zenithar', at: 1, convertedAt: 1 });
ok('a wood elf with Zenithar from before resolves to the Green Pact, unsworn', globalThis.__dboFaithOf(OLDBOSMER).faith === 'greenpact' && globalThis.__dboFaithOf(OLDBOSMER).sworn === '');
ok('...swears to it, keeping the god and the days', globalThis.__dboSwearFaith(OLDBOSMER, 'greenpact') === '' && rec(OLDBOSMER).faith === 'greenpact' && rec(OLDBOSMER).id === 'zenithar' && rec(OLDBOSMER).convertedAt === 1);
ok('...and is told when already sworn', /already sworn/.test(globalThis.__dboSwearFaith(OLDBOSMER, 'greenpact')));
ok('a Nord cannot swear the Green Pact', /does not place you/.test(globalThis.__dboSwearFaith(NORD, 'greenpact')));
// The three server boons: Xarxes reads at half Hermaeus Mora's value, Y'ffre's meat x2, Alkosh a combat boon
const blessWith = (a, deity) => props.set(a + '|private.dboBlessing', { deity, until: wallClock + 3600000 });
blessWith(ACTOR, 'xarxes');
ok('Xarxes: scholarBoon 0.5', globalThis.__dboBlessingValue(ACTOR, 'scholarBoon') === 0.5 && globalThis.__dboBlessedWith(ACTOR, 'scholarBoon'));
blessWith(ACTOR, 'hermaeusmora');
ok('Hermaeus Mora: scholarBoon 1', globalThis.__dboBlessingValue(ACTOR, 'scholarBoon') === 1);
blessWith(ACTOR, 'yffre');
ok('Y\'ffre: meatBoon 2, nothing for reading', globalThis.__dboBlessingValue(ACTOR, 'meatBoon') === 2 && globalThis.__dboBlessingValue(ACTOR, 'scholarBoon') === 0);
props.set(ACTOR + '|private.dboBlessing', { deity: 'yffre', until: wallClock - 1 });
ok('an expired blessing is worth nothing', globalThis.__dboBlessingValue(ACTOR, 'meatBoon') === 0);
ok('the three boons are the server\'s now', ['xarxes', 'yffre', 'alkosh'].every((id) => FAITHS.deities.find((d) => d.id === id).blessingSource === 'server'));
ok('every patron of every faith is a god in the roster', FAITHS.faiths.every((f) => f.patrons.every((id) => v.choices.some((c) => c.id === id))));
console.log(fails ? `${fails} FAILED` : 'all checks passed'); process.exit(fails ? 1 : 0);
