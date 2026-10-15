// The free appearance change (appearance.js, Jake 15 Oct: "give 1 free appearance change to every new character", and
// every existing one): each character has appearance.freeChanges (default 1) /appearance uses that skip the gold and the
// daily wait. One is used only where the gold would have been taken (a saved changed look, or a RaceMenu-only change the
// save gate charges), the cooldown then starts as for a paid change, and closing unchanged keeps it. Every other block
// stays. A character is told once (gamemode.js login and the arrival from the Realm), never while still being made.
// freeChanges 0 is the quick undo: /appearance exactly as before. A GM's /grantappearance gives one more, logged.
// Stub mp, the real module (SERVER_ROOT=<dir> runs it against another tree's appearance.js, gamemode.js and rules).
//   node tests/appearance-free-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = process.env.SERVER_ROOT ? path.resolve(process.env.SERVER_ROOT) : path.resolve(__dirname, '..');
const MOD = path.join(ROOT, 'appearance.js');
let fails = 0;
const ok = (c, label, got) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${label}${c || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!c) fails++; };
// A section that throws (a missing function, say) fails by name and the rest still run
const section = (name, fn) => { try { fn(); } catch (e) { ok(false, `${name}: threw`, e.message); } };

const A = 0xff000101; // the player
const G = 0xff000202; // a GM
let props, said, sys, audits, cmds, opened;
const look = () => ({ raceId: 0x13746, isFemale: false, name: 'Brand Stoneborn', weight: 50, skinColor: 1, hairColor: 2, headpartIds: [1, 2], headTextureSetId: 3, options: [0], presets: [0], tints: [] });
// gold: A's gold; app: extra appearance config; top: extra top-level config
const load = (gold, app, top) => {
  props = new Map([[`${A}|inventory`, { entries: [{ baseId: 0xf, count: gold }, { baseId: 0x1d4ec, count: 1 }] }], [`${A}|appearance`, look()],
    [`${G}|appearance`, Object.assign(look(), { name: 'Gale' })]]);
  said = []; sys = []; audits = []; cmds = new Map(); opened = 0;
  delete require.cache[MOD];
  delete globalThis.__dboRaceMenuSaveWindows; delete globalThis.__dboRaceMenuRefusedToldAt; delete globalThis.__dboAppearanceRefusedAt;
  globalThis.__dboCombatAt = new Map(); globalThis.__dboIsDowned = null; globalThis.__dboBeastOriginalRace = null; globalThis.__dboDungeonCells = new Set();
  globalThis.__dboTellsRetake = () => {}; globalThis.__dboFeralDue = new Map(); globalThis.__dboAppearanceFreeLogin = undefined;
  return require(MOD)({
    mp: { get: (id, k) => props.get(`${id >>> 0}|${k}`), set: (id, k, v) => props.set(`${id >>> 0}|${k}`, v), setRaceMenuOpen: () => { opened++; }, lookupEspmRecordById: () => { throw new Error('no record'); } },
    log: () => {}, personal: (a, t) => said.push([a >>> 0, t]), system: (a, t) => sys.push([a >>> 0, t]), audit: (t) => audits.push(t),
    who: (a) => ((a >>> 0) === G ? 'Gale #GGGG (profile 9)' : 'Brand #BBBB (profile 7)'), display: (a) => ((a >>> 0) === G ? 'Gale #GGGG' : 'Brand #BBBB'),
    findByName: (q) => (/brand|#bbbb/i.test(q) ? A : /gale|#gggg/i.test(q) ? G : 0),
    registerChatCommand: (n, fn, opts) => cmds.set(n, { fn, opts: opts || {} }), cfg: Object.assign({ appearance: Object.assign({ cost: 500, cooldownHours: 24 }, app || {}) }, top || {}),
    userOf: () => 3, profileOf: () => 7, later: () => {},
  });
};
const gold = () => props.get(`${A}|inventory`).entries.filter((e) => e.baseId === 0xf).reduce((s, e) => s + e.count, 0);
const run = () => cmds.get('appearance').fn(A, '');
const lastSaid = () => (said.filter(([a]) => a === A).at(-1) || [])[1] || '';
const lastSys = () => (sys.filter(([a]) => a === A).at(-1) || [])[1] || '';
const finish = (app) => { props.set(`${A}|appearance`, JSON.parse(JSON.stringify(app))); return globalThis.__dboAppearanceEdit.finish(A, app); };
const changed = () => Object.assign(look(), { hairColor: 9 });
const cooldown = () => Number(props.get(`${A}|private.dboAppearanceAt`)) || 0;
const pending = () => !!globalThis.__dboAppearanceEdit.pending(A);
const freeLeft = (a) => globalThis.__dboAppearanceEdit.freeLeft((a || A) >>> 0);
const notice = (a) => globalThis.__dboAppearanceFreeLogin((a || A) >>> 0);

// 1. An existing character (nothing stored about free changes) with 0 gold: the editor opens, the change is free
section('free use with 0 gold', () => {
  load(0);
  ok(freeLeft() === 1, 'an existing character, never told of it, has one free change', freeLeft());
  run();
  ok(opened === 1 && pending(), 'with 0 gold the editor opens', lastSaid());
  ok(/This change is free \(your one free appearance change\)\./.test(lastSaid()) && /race, sex and name stay/.test(lastSaid()) && !/costs 500/.test(lastSaid()),
    'the player is told plainly that this change is free, and what stays', lastSaid());
  ok(audits.some((t) => /opened the appearance editor \(free/.test(t)), 'the opening is audited as free', audits);
  finish(changed());
  ok(props.get(`${A}|appearance`).hairColor === 9 && gold() === 0, 'a changed look is saved and no gold is taken', [props.get(`${A}|appearance`).hairColor, gold()]);
  ok(freeLeft() === 0 && Number(props.get(`${A}|private.dboAppearanceFreeUsed`)) === 1, 'the free change is used up (one number on the character)', props.get(`${A}|private.dboAppearanceFreeUsed`));
  ok(cooldown() > 0, 'the cooldown starts as for a paid change');
  ok(/It used your free appearance change, so no gold was taken/.test(lastSys()), 'the player is told it was free', lastSys());
  ok(audits.some((t) => t === 'APPEARANCE Brand #BBBB (profile 7) changed their look with their free appearance change (no gold)'), 'the audit line says it was free', audits);
});

// 2. The second change is paid again: the daily wait, then the gold
section('the second change is paid again', () => {
  said = []; run();
  ok(opened === 1 && /again in/.test(lastSaid()), 'right after the free change the daily wait applies', lastSaid());
  props.set(`${A}|private.dboAppearanceAt`, Date.now() - 25 * 3600000);
  run();
  ok(opened === 1 && /costs 500 gold. You have 0/.test(lastSaid()), 'after the wait, with 0 gold, it is refused as before', lastSaid());
  props.set(`${A}|inventory`, { entries: [{ baseId: 0xf, count: 800 }] });
  run();
  ok(opened === 2 && /costs 500 gold/.test(lastSaid()) && !/free/.test(lastSaid()), 'with the gold it opens at the price', lastSaid());
  finish(Object.assign(look(), { hairColor: 4 }));
  ok(gold() === 300 && /500 gold paid\./.test(lastSys()) && !/free/.test(lastSys()), 'and the second change costs 500 gold', [gold(), lastSys()]);
});

// 3. The cooldown is skipped for the free use
section('the cooldown is skipped for the free use', () => {
  load(0); props.set(`${A}|private.dboAppearanceAt`, Date.now() - 3600000);
  run();
  ok(opened === 1 && /This change is free/.test(lastSaid()), 'a paid change an hour ago: the free change still opens at once', lastSaid());
  finish(changed());
  ok(freeLeft() === 0 && gold() === 0 && cooldown() > Date.now() - 60000, 'used, no gold, the cooldown starts again from now', [freeLeft(), gold()]);
});

// 4. Closing unchanged keeps it; so does a refused race or sex change; a RaceMenu-only save uses it in place of the gold
section('closing unchanged keeps the free change', () => {
  load(0); run(); finish(look());
  ok(freeLeft() === 1 && !cooldown() && gold() === 0, 'closed unchanged: the free change is kept, no cooldown', [freeLeft(), cooldown()]);
  ok(/Your standard look is unchanged\./.test(lastSys()) && /use your free appearance change when they are saved; otherwise it stays yours/.test(lastSys()) && !/500 gold/.test(lastSys()),
    'the player is told it stays theirs, with no price named', lastSys());
  // A RaceMenu-only change of that close: the first save of a kind is free as before and uses nothing
  let v = globalThis.__dboRaceMenuSaveGate(A, 'face', true);
  ok(v.ok && v.free && freeLeft() === 1 && !cooldown(), 'a first RaceMenu save stays free and does not use the free change', v);
  v = globalThis.__dboRaceMenuSaveGate(A, 'face', false);
  ok(v.ok && v.freeChange && !v.paid && gold() === 0 && freeLeft() === 0 && cooldown() > 0, 'a RaceMenu-only change uses the free change where the gold would be taken', [v, gold(), freeLeft()]);
  ok(/They used your free appearance change, so no gold was taken/.test(lastSys()) && audits.some((t) => /RaceMenu details \(face\) with their free appearance change/.test(t)), 'told and audited as free', [lastSys(), audits.at(-1)]);
  v = globalThis.__dboRaceMenuSaveGate(A, 'extras', false);
  ok(v.ok && !v.paid && !v.freeChange && freeLeft() === 0, 'one use covers the extras of the same close', v);
  // A face write that fails gives the free change back, the cooldown as it was and the price back on the window
  load(0); run(); finish(look());
  v = globalThis.__dboRaceMenuSaveGate(A, 'face', false, { hold: true });
  ok(v.ok && v.freeChange && typeof v.settle === 'function' && freeLeft() === 0, 'a held face save takes the free change at once', v);
  v.settle(false);
  ok(freeLeft() === 1 && !cooldown() && gold() === 0, 'a failed write gives the free change back and no cooldown is left', [freeLeft(), cooldown()]);
  v = globalThis.__dboRaceMenuSaveGate(A, 'face', false, { hold: true }); v.settle(true);
  ok(freeLeft() === 0 && /They used your free appearance change/.test(lastSys()), 'sent again and written: used once, told once it is on disk', lastSys());
  // A race or a sex change is put back: nothing saved, the free change kept
  load(0); run(); finish(Object.assign(changed(), { raceId: 0x13745 }));
  ok(freeLeft() === 1 && props.get(`${A}|appearance`).raceId === 0x13746 && /Race can't be changed/.test(lastSys()) && /free appearance change is still yours/.test(lastSys()),
    'a race change: the previous look back, the free change kept and the player told', lastSys());
  load(0); run(); finish(Object.assign(changed(), { isFemale: true }));
  ok(freeLeft() === 1 && props.get(`${A}|appearance`).isFemale === false, 'so does a sex change');
  // The name stays as for a paid change
  load(0); run(); finish(Object.assign(changed(), { name: 'Brandy' }));
  ok(freeLeft() === 0 && props.get(`${A}|appearance`).name === 'Brand Stoneborn' && props.get(`${A}|appearance`).hairColor === 9 && gold() === 0, 'a renamed free look keeps the old name and the new hair', props.get(`${A}|appearance`));
});

// 5. Every block /appearance has today still applies to the free change
section('every block still applies', () => {
  const refused = (setup, re, label) => { load(0); setup(); said = []; run(); ok(opened === 0 && re.test(lastSaid()) && freeLeft() === 1, label, lastSaid()); };
  refused(() => globalThis.__dboCombatAt.set(A, Date.now() - 5000), /fight/, 'free, but refused in a fight');
  refused(() => { globalThis.__dboIsDowned = (a) => a === A; }, /down/, 'refused while down');
  refused(() => { globalThis.__dboBeastOriginalRace = () => 0x13746; }, /beast form/, 'refused in a beast form');
  refused(() => globalThis.__dboFeralDue.set(A, Date.now() + 30000), /beast is coming/, 'refused while a forced beast change is coming');
  refused(() => props.set(`${A}|private.dboSentence`, { until: Date.now() + 60000 }), /jail/, 'refused in jail');
  refused(() => props.set(`${A}|private.restrained`, true), /bound/, 'refused while bound');
  refused(() => { props.set(`${A}|worldOrCellDesc`, '1234:Skyrim.esm'); globalThis.__dboDungeonCells = new Set(['1234:skyrim.esm']); }, /dungeon/, 'refused inside a dungeon');
  refused(() => props.set(`${A}|isDead`, true), /dead/, 'refused while dead');
  refused(() => props.set(`${A}|private.creationPending`, true), /Finish making/, 'refused during character creation');
  refused(() => props.set(`${A}|private.rerollPending`, true), /Finish making/, 'refused during a reroll');
  refused(() => props.set(`${A}|private.dboAppearanceEdit`, { at: 1, before: look() }), /already open/, 'refused while an edit is already open');
  refused(() => props.set(`${A}|appearance`, null), /could not be read/, 'refused when the look cannot be read');
  load(0); said = []; run();
  ok(opened === 1 && /This change is free/.test(lastSaid()), '(control) with none of them set, the free editor opens', lastSaid());
});

// 6. freeChanges 0 is today's /appearance exactly
section('freeChanges 0 restores today', () => {
  load(0, { freeChanges: 0 }); run();
  ok(opened === 0 && /costs 500 gold. You have 0/.test(lastSaid()), 'switched off: 0 gold is refused as before', lastSaid());
  load(800, { freeChanges: 0 }); props.set(`${A}|private.dboAppearanceAt`, Date.now() - 3600000); run();
  ok(opened === 0 && /again in/.test(lastSaid()), 'switched off: the daily wait applies', lastSaid());
  load(800, { freeChanges: 0 }); run();
  ok(/costs 500 gold; closing it unchanged costs nothing/.test(lastSaid()) && !/free/.test(lastSaid()), 'switched off: the price is named as before', lastSaid());
  finish(changed());
  ok(gold() === 300 && /500 gold paid/.test(lastSys()) && !props.get(`${A}|private.dboAppearanceFreeUsed`), 'switched off: paid, and nothing is counted', [gold(), lastSys()]);
  ok(freeLeft() === 0 && notice() === false && !sys.some(([, t]) => /free appearance change/.test(t)), 'switched off: no free change left and no notice');
  // A switch turned off by a hot reload while a free editor is open: that editor skipped the gold and the daily wait, so its
  // close charges nothing and keeps the previous look (review, 15 Oct: it used to be paid, with no daily wait checked)
  load(800); run(); ok(/This change is free/.test(lastSaid()), 'opened free');
  const edit = props.get(`${A}|private.dboAppearanceEdit`);
  load(800, { freeChanges: 0 }); props.set(`${A}|private.dboAppearanceEdit`, edit);
  finish(changed());
  ok(gold() === 800 && props.get(`${A}|appearance`).hairColor === 2 && !cooldown() && /no longer there \(used meanwhile, or switched off\), so your previous look was kept and nothing was charged/.test(lastSys()),
    'switched off mid-edit: the previous look is kept, no gold is taken, no cooldown starts, the player is told why', [gold(), cooldown(), lastSys()]);
  ok(audits.some((t) => t === 'APPEARANCE Brand #BBBB (profile 7) closed a free appearance editor with no free change left: previous look kept, nothing charged'), '...and staff see it in the audit', audits.slice(-1));
  load(100); run(); const edit2 = props.get(`${A}|private.dboAppearanceEdit`);
  load(100, { freeChanges: 0 }); props.set(`${A}|private.dboAppearanceEdit`, edit2);
  finish(changed());
  ok(gold() === 100 && props.get(`${A}|appearance`).hairColor === 2 && /free appearance change is no longer there/.test(lastSys()), '...and the same without the gold', lastSys());
  // Neither an unchanged free close: its RaceMenu-only changes are refused with no gold taken; a first save stays free
  load(800); run(); const edit3 = props.get(`${A}|private.dboAppearanceEdit`);
  load(800, { freeChanges: 0 }); props.set(`${A}|private.dboAppearanceEdit`, edit3); finish(look());
  ok(/not charged and are kept only if you have none saved yet/.test(lastSys()) && !/500 gold/.test(lastSys()), 'switched off mid-edit, closed unchanged: told nothing from it is charged', lastSys());
  let v = globalThis.__dboRaceMenuSaveGate(A, 'face', false);
  ok(!v.ok && v.code === 'gold' && gold() === 800 && !cooldown() && /weren't saved: your free appearance change is no longer there, and nothing was charged/.test(lastSys()),
    '...a RaceMenu-only change of it is then refused, with no gold taken and no cooldown', [v, gold(), lastSys()]);
  ok(globalThis.__dboRaceMenuRefused(A, 'face', v.code) === false, '...told once (by the gate), as a gold refusal is');
  v = globalThis.__dboRaceMenuSaveGate(A, 'face', true);
  ok(v.ok && v.free && gold() === 800, '...but a first save of a kind stays free, as before', v);
});

// 7. The free change used meanwhile (a RaceMenu save of an earlier close) leaves the open editor with none: one free change,
// not two, and no gold from an editor opened free (it never checked the gold or the daily wait)
section('one free change, not two', () => {
  load(800); run(); finish(look());
  run(); ok(pending() && /This change is free/.test(lastSaid()), 'reopened at once, still free');
  let v = globalThis.__dboRaceMenuSaveGate(A, 'face', false);
  ok(v.ok && v.freeChange && freeLeft() === 0, 'the earlier close\'s RaceMenu change uses the free change', v);
  const at = cooldown();
  finish(changed());
  ok(gold() === 800 && props.get(`${A}|appearance`).hairColor === 2 && Number(props.get(`${A}|private.dboAppearanceFreeUsed`)) === 1 && cooldown() === at
    && /no longer there/.test(lastSys()), 'the open editor\'s change is then not saved and not charged (no paid change inside the daily wait)', [gold(), lastSys()]);
  // The same overlap closed unchanged: its RaceMenu-only change is refused, no gold
  load(800); run(); finish(look()); run();
  globalThis.__dboRaceMenuSaveGate(A, 'face', false);
  finish(look());
  v = globalThis.__dboRaceMenuSaveGate(A, 'extras', false);
  ok(!v.ok && v.code === 'gold' && gold() === 800 && Number(props.get(`${A}|private.dboAppearanceFreeUsed`)) === 1, '...closed unchanged, its RaceMenu-only change is refused with no gold taken', [v, gold()]);
});

// 8. The notice: once per character, never while still being made, existing and new characters both
section('the notice shows once', () => {
  load(0);
  ok(notice() === true && sys.filter(([a, t]) => a === A && t === 'You have one free appearance change. Type /appearance to use it.').length === 1, 'an existing character is told at login', sys);
  ok(notice() === false && sys.filter(([a]) => a === A).length === 1, 'the next login says nothing', sys);
  ok(Number(props.get(`${A}|private.dboAppearanceFreeTold`)) === 1, 'told is one number on the character');
  // A new character: nothing while it is being made, told once it is made, and the free change is theirs
  load(0); props.set(`${A}|private.creationPending`, true); props.set(`${A}|appearance`, null);
  ok(notice() === false && sys.length === 0, 'a character still in creation is not told');
  props.set(`${A}|private.rerollPending`, true); props.set(`${A}|appearance`, look()); props.delete(`${A}|private.creationPending`);
  ok(notice() === false && sys.length === 0, 'nor one being rerolled');
  props.delete(`${A}|private.rerollPending`);
  ok(freeLeft() === 1 && notice() === true && /one free appearance change/.test(lastSys()), 'once made, the new character is told and has the free change', lastSys());
  run(); ok(opened === 1 && /This change is free/.test(lastSaid()), 'and a new character\'s /appearance is free');
  // No notice when none is left, nor when offline
  load(0); props.set(`${A}|private.dboAppearanceFreeUsed`, 1);
  ok(notice() === false && sys.length === 0, 'a character who already used it is not told');
  load(0); props.set(`${A}|isOnline`, false);
  ok(notice() === false && sys.length === 0 && !props.get(`${A}|private.dboAppearanceFreeTold`), 'nobody is told while offline (the next login tells them)');
  load(0, { enabled: false });
  ok(notice() === false, '/appearance switched off: no notice');
  load(0, { freeChanges: 2 });
  ok(freeLeft() === 2 && notice() === true && /You have 2 free appearance changes/.test(lastSys()), 'freeChanges 2: two, and the notice says so', lastSys());
});

// 9. A GM's /grantappearance
section('grant', () => {
  load(0);
  const g = cmds.get('grantappearance');
  ok(!!g && g.opts.admin === true, '/grantappearance is registered for staff (GM and above)', g && g.opts);
  props.set(`${A}|private.dboAppearanceFreeUsed`, 1);
  g.fn(G, '#BBBB');
  ok(freeLeft() === 1 && /Brand #BBBB now has 1 free appearance change\./.test((said.filter(([a]) => a === G).at(-1) || [])[1]), 'a used-up character gets one more', said);
  ok(/A GM gave you a free appearance change/.test(lastSys()), 'the player is told');
  const line = audits.find((t) => / granted /.test(t));
  ok(line === 'APPEARANCE Gale #GGGG (profile 9) granted Brand #BBBB (profile 7) a free appearance change (1 left)', 'audited with both', audits);
  g.fn(G, '#BBBB');
  ok(freeLeft() === 2, 'a second grant stacks', freeLeft());
  ok(notice() === false, 'a granted change was told at the grant, not again at login');
  said = []; g.fn(G, '#ZZZZ');
  ok(/No such player online/.test((said.at(-1) || [])[1]), 'nobody online by that tag: refused', said);
  said = []; g.fn(G, '');
  ok(/Use \/grantappearance/.test((said.at(-1) || [])[1]), 'no name: the usage', said);
  load(0, { freeChanges: 0 }); said = []; cmds.get('grantappearance').fn(G, '#BBBB');
  ok(/switched off/.test((said.at(-1) || [])[1]) && !props.get(`${A}|private.dboAppearanceFreeUsed`), 'switched off: no grant', said);
});

// 10. The player log reads the free lines as act.APPEARANCE, the grant's target as the target; every new site is pinned
section('player log', () => {
  const R = require(path.join(ROOT, 'playerlog-rules.js'));
  const p = R.parseAudit('APPEARANCE Brand #BBBB (profile 7) changed their look with their free appearance change (no gold)');
  ok(p.events.length === 1 && p.events[0].ev === 'act.APPEARANCE' && /with their free appearance change/.test(p.events[0].f.text), 'the free change reaches the player log saying it was free', p.events);
  const q = R.parseAudit('APPEARANCE Gale #GGGG (profile 9) granted Brand #BBBB (profile 7) a free appearance change (1 left)');
  ok(q.events.length === 1 && q.events[0].actor === 0 && JSON.stringify(q.events[0].others) === '[[1,"target"]]', 'the grant: the GM acts, the player is the target', q.events);
  const src = fs.readFileSync(MOD, 'utf8');
  const pins = new Set(R.AUDIT_SITES.filter((s) => s.file === 'appearance.js').map((s) => s.hash));
  const want = ['opened the appearance editor (free: ${left} free change(s) left)', 'with their free appearance change (no gold)${', 'could not be written: their free appearance change given back',
    'with their free appearance change (no gold)`', 'granted ${who(t)} a free appearance change (${left} left)',
    'with no free change left: not saved, nothing charged', 'closed a free appearance editor with no free change left: previous look kept, nothing charged'];
  ok(want.every((w) => src.includes(w)), 'the free audit lines are in appearance.js');
  ok(pins.size >= 19, 'the appearance.js audit sites are pinned (12 before, 7 free ones)', pins.size);
  ok(Object.prototype.hasOwnProperty.call(R.COMMAND_SCHEMA, 'grantappearance') && R.COMMAND_SCHEMA.grantappearance.target, 'the player log knows /grantappearance and its target');
});

// 11. gamemode.js: the module gets the lookup, and the notice runs at login and on leaving the Realm, never in creation
section('gamemode wiring', () => {
  const gm = fs.readFileSync(path.join(ROOT, 'gamemode.js'), 'utf8');
  ok(/require\(APPEARANCE_JS\)\(\{[^}]*findByName[^}]*display[^}]*\}\)/.test(gm), 'appearance.js is loaded with findByName and display');
  ok(/globalThis\.__dboAppearanceFreeLogin = null/.test(gm), 'a failed load clears the notice hook');
  const ready = gm.slice(gm.indexOf('const onCharacterReady = '), gm.indexOf('const startLoginWait = '));
  const setup = ready.slice(ready.indexOf("setTimeout(timed('loginSetup'"));
  ok(/__dboAppearanceFreeLogin && !creationPending\(a\) && !inCreatorRealm\(a\)\) globalThis\.__dboAppearanceFreeLogin\(a\)/.test(setup), 'the login setup tells a made character, not one in creation');
  const arrival = gm.slice(gm.indexOf('const sendToArrival = '), gm.indexOf('function inHubForName'));
  ok(/setTimeout\(\(\) => \{ try \{ if \(globalThis\.__dboAppearanceFreeLogin && !creationPending\(a\) && !inCreatorRealm\(a\)\)/.test(arrival), 'a new character is told after leaving the Realm');
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'gamemode-config.json'), 'utf8'));
  ok(cfg.appearance && cfg.appearance.freeChanges === 1, 'gamemode-config.json: appearance.freeChanges 1', cfg.appearance);
});

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
