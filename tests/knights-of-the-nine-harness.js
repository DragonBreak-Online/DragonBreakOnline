// The Knights of the Nine as a lore faction (Nat, 25 Oct: "make the Knights of the Nine a faction on the live server"),
// checked as data: the guild-defs entry with Oblivion's ranks and the server's crafting seats, the faction limits beside
// the Vigil of Stendarr (a guild slot, never with a Daedric cult, open to player guilds), and the Knight-Errant set as its
// faction gear, made only by its own smiths, with recipes regions.json knows.
//
//   node tests/knights-of-the-nine-harness.js   (from server/)
'use strict';
const fs = require('fs');
const path = require('path');

const SERVER = path.resolve(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(SERVER, f), 'utf8'));
const DEFS = read('guild-defs.json');
const CFG = read('gamemode-config.json');
const GEAR = read('faction-gear.json');
const RECIPES = read('regions.json').recipes;
const ID = 'knights-of-the-nine';

let fail = 0;
const ok = (c, what, extra) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${what}${c || extra === undefined ? '' : ': ' + JSON.stringify(extra)}`); if (!c) fail++; };

// ---- the faction ----
const f = DEFS.factions.find((x) => x.id === ID);
ok(!!f, 'guild-defs.json defines knights-of-the-nine');
if (f) {
  ok(f.name === 'Knights of the Nine' && f.kind === 'guild', 'a guild named the Knights of the Nine', [f.name, f.kind]);
  ok(DEFS.factions.filter((x) => x.id === ID).length === 1, 'defined once');
  const titles = f.ranks.map((r) => r.title);
  ok(JSON.stringify(titles) === JSON.stringify(['Divine Crusader', 'Knight Commander', 'Armorer', 'Clothier', 'Knight Errant', 'Pilgrim']),
    "Oblivion's ranks highest first, with the crafting seats", titles);
  const role = (t) => (f.ranks.find((r) => r.title === t) || {}).role;
  ok(role('Divine Crusader') === 'leader' && role('Knight Commander') === 'officer', 'the Divine Crusader leads, Knight Commanders are officers');
  ok(role('Armorer') === 'blacksmith' && role('Clothier') === 'tailor', 'an Armorer and a Clothier make the gear (blacksmith, tailor)');
  ok(f.ranks[f.ranks.length - 1].title === 'Pilgrim' && role('Pilgrim') === 'member', 'a new Knight joins as a Pilgrim (the last rank)');
  const roles = new Set(Object.keys(DEFS.roles || {}));
  ok(!roles.size || f.ranks.every((r) => roles.has(r.role)), 'every rank names a known role', f.ranks.map((r) => r.role));
  ok(!f.hall, 'no hall until Nat picks one (the Priory of the Nine is not in the load order)');
}

// ---- the faction limits, beside the Vigil ----
const L = CFG.factions.limits;
const cats = Object.entries(L.categories).filter(([, c]) => (c.ids || []).includes(ID)).map(([k]) => k);
ok(JSON.stringify(cats) === '["guild"]', 'it takes the guild slot, and only that one', cats);
const cults = DEFS.factions.filter((x) => x.kind === 'cult').map((x) => x.id);
const vsCults = L.conflicts.find((c) => (c.a || []).includes(ID));
ok(!!vsCults && cults.every((c) => vsCults.b.includes(c)), 'never alongside a Daedric cult, as the Vigil and the churches', vsCults && vsCults.a);
ok((CFG.playerGuilds.compatibleIds || []).includes(ID), 'a Knight may also join a player guild, as the Vigil may');
ok(/^#[0-9a-f]{6}$/i.test(String(((CFG.war || {}).colours || {})[ID] || '')), 'it has a war colour (config war.colours)', ((CFG.war || {}).colours || {})[ID]);

// ---- the gear ----
const mine = Object.entries(GEAR.items).filter(([, v]) => v.factions.includes(ID));
ok(mine.length === 6, 'six Knight-Errant pieces are its faction gear', mine.map(([, v]) => v.name));
ok(mine.every(([k, v]) => k.endsWith(':knighterrant.esp') && /^Knight-Errant /.test(v.name) && v.set === 'Knights of the Nine'),
  'all from knighterrant.esp, named Knight-Errant, in the Knights of the Nine set');
ok(mine.every(([, v]) => v.factions.length === 1 && v.role === 'blacksmith'), "made only by the order's own smiths (all are forge recipes)");
ok(mine.every(([k, v]) => v.recipes.length && v.recipes.every((r) => RECIPES[r] && RECIPES[r].item === k)), 'each recipe is one regions.json knows, making that item');
ok(!Object.values(GEAR.items).some((v) => /^Knight-Errant /.test(v.name) && !v.factions.includes(ID)), 'no other faction holds a Knight-Errant piece');

console.log('');
console.log(fail ? `${fail} FAILED` : 'all checks passed');
process.exit(fail ? 1 : 0);
