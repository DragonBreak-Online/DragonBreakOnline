// Merges freshly generated admin catalogues into the tracked ones without losing what the generators do not make (Nat, 1 Nov:
// "add all the new spells... and all of the new weapons/armor/NPCs"; the Leader: hand-added rows must survive, nothing may
// silently disappear). A row a generator no longer produces is KEPT and counted, as tools/faction_gear.py does, unless it
// has a stated reason to go:
//   - its plugin is not in the target load order (an id the server would not have);
//   - it is a weapon the generator left out as creature-only (ck-mcp/admin_catalog.py, weaponBands.creature);
//   - a location the generator now names differently at the same place (same world, within 1 unit): the new name wins.
// The generated name wins for every row both sides have. Reasons and counts are printed per file and category.
// What the tracked files hold out on purpose stays out, read from where the code keeps it:
//   - an item no one may obtain (staffitemspells.js UNOBTAINABLE, the Dwemer Mantis armour) is never offered;
//   - a removed or suspended spell (gamemode-config.json spells.removedSpells, suspendedSpells) is never given;
//   - admin-powers.json keeps its own layout: shouts stays as tracked (empty since 17 Oct), the generated shouts go into
//     shoutsGate (combat.js's player shout gate), every other key and the _comment are kept, spellSources is recounted.
// Each file is written as its generator writes it: the same layout, and non-ASCII escaped as Python's json.dump does
// (admin_placeables.py alone writes UTF-8).
//   node tooling/admin_catalog_merge.js <generated dir> <load order file> [--write]     (from server/; without --write, a dry run)
'use strict';
const fs = require('fs');
const path = require('path');

const [GEN, ORDER] = process.argv.slice(2);
const WRITE = process.argv.includes('--write');
if (!GEN || !ORDER) { console.log('usage: node tooling/admin_catalog_merge.js <generated dir> <load order file> [--write]'); process.exit(2); }
const order = new Set(fs.readFileSync(ORDER, 'utf8').split(/\r?\n/).map((l) => l.replace(/^\*/, '').trim().toLowerCase()).filter((l) => l && !l.startsWith('#')));
const inOrder = (plugin) => order.has(String(plugin || '').toLowerCase());
const pluginOf = (desc) => String(desc).slice(String(desc).indexOf(':') + 1);
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const report = {};
// What stays out on purpose
const UNOBTAINABLE = (() => {
  const src = fs.readFileSync(path.resolve('staffitemspells.js'), 'utf8');
  const m = src.match(/const UNOBTAINABLE = new Set\(\[([^\]]*)\]\.map\(\(x\) => `\$\{x\}:([^`]+)`\)\)/);
  if (!m) throw new Error('staffitemspells.js UNOBTAINABLE not found in its known shape: read it before merging');
  return new Set(m[1].split(',').map((x) => `${x.trim().replace(/['"]/g, '')}:${m[2]}`.toLowerCase()));
})();
const SPELLS_HELD = (() => {
  const s = (read(path.resolve('gamemode-config.json')).spells) || {};
  return new Set([].concat(s.removedSpells || [], s.suspendedSpells || []).map((d) => String(d).toLowerCase()));
})();
const note = (file, cat, what, row) => {
  const r = (report[file] = report[file] || {}); const c = (r[cat] = r[cat] || {});
  (c[what] = c[what] || []).push(row);
};

// ---- the category files: admin-items.json, admin-placeables.json ([desc, name, plugin] rows in categories) ----------------
const mergeCategories = (file, leftOut) => {
  const old = read(path.resolve(file)), gen = read(path.join(GEN, file));
  const have = new Set(); const genName = new Map(); const inCat = new Set();
  for (const c of gen.categories) for (const it of c.items) { have.add(it[0]); genName.set(it[0], it[1]); inCat.add(`${c.id}|${it[0]}`); }
  const cats = new Map(gen.categories.map((c) => [c.id, c]));
  for (const c of old.categories || []) {
    for (const it of c.items || []) {
      if (inCat.has(`${c.id}|${it[0]}`)) continue;
      // Made by the generator in another category: this row was placed here by hand (the Briarheart altar in a category of
      // its own, the Scholars' Ledger and the Class Lectern among the Crafting Stations), so it stays here as well
      if (have.has(it[0])) {
        {
          let into = cats.get(c.id);
          if (!into) { into = Object.assign({}, c, { items: [] }); cats.set(c.id, into); gen.categories.push(into); }
          into.items.push(it); inCat.add(`${c.id}|${it[0]}`);
          note(file, c.id, 'kept: its own category or label (the generator makes it elsewhere as well)', [it[0], `${it[1]}  (also: ${genName.get(it[0])})`]);
        }
        continue;
      }
      const plugin = it[2] || pluginOf(it[0]);
      if (!inOrder(plugin)) { note(file, c.id, 'dropped: plugin not in the load order', it); continue; }
      if (leftOut.has(it[0])) { note(file, c.id, 'dropped: creature-only weapon', it); continue; }
      let into = cats.get(c.id);
      if (!into) { into = Object.assign({}, c, { items: [] }); cats.set(c.id, into); gen.categories.push(into); }
      into.items.push(it); have.add(it[0]); inCat.add(`${c.id}|${it[0]}`);
      note(file, c.id, 'kept: not produced by the generator (hand-added or no longer matched)', it);
    }
  }
  if (file === 'admin-items.json') for (const c of gen.categories) c.items = c.items.filter((it) => { const out = UNOBTAINABLE.has(String(it[0]).toLowerCase()); if (out) note(file, c.id, 'left out: no one may obtain it (staffitemspells.js UNOBTAINABLE)', it); return !out; });
  for (const c of gen.categories) c.items.sort((x, y) => String(x[1]).toLowerCase().localeCompare(String(y[1]).toLowerCase()) || String(x[0]).localeCompare(String(y[0])));
  return gen;
};

// ---- admin-powers.json: spells [desc, name], shouts {shout, name, words} ---------------------------------------------------
const mergePowers = () => {
  const file = 'admin-powers.json';
  const old = read(path.resolve(file)), gen = read(path.join(GEN, file));
  // The generated spells, less the held ones, then every old spell it does not make
  const spells = gen.spells.filter((s) => { const held = SPELLS_HELD.has(String(s[0]).toLowerCase()); if (held) note(file, 'spells', 'left out: removed or suspended (gamemode-config.json spells)', s); return !held; });
  const have = new Set(spells.map((s) => s[0]));
  for (const s of old.spells || []) {
    if (have.has(s[0])) continue;
    if (!inOrder(pluginOf(s[0]))) { note(file, 'spells', 'dropped: plugin not in the load order', s); continue; }
    spells.push(s); have.add(s[0]);
    note(file, 'spells', 'kept: not produced by the generator (hand-added or no longer matched)', s);
  }
  spells.sort((x, y) => String(x[1]).toLowerCase().localeCompare(String(y[1]).toLowerCase()));
  // The tracked layout, every key kept; the spell list, its counts by plugin and the shout gate refreshed
  const out = Object.assign({}, old);
  out.spells = spells;
  const sources = {}; for (const s of spells) sources[pluginOf(s[0])] = (sources[pluginOf(s[0])] || 0) + 1;
  out.spellSources = Object.fromEntries(Object.entries(sources).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  // The staff-only list (/givespell; the Leader, 1 Nov): castable spells no tome teaches, never the held ones - a removed
  // spell is taken from its holder at the next login and a suspended one is held for a crash or a desync (gamemode-config.json
  // spells); old rows the generator no longer makes are kept, as everywhere here
  if (Array.isArray(gen.staffSpells)) {
    const staff = gen.staffSpells.filter((s) => { const held = SPELLS_HELD.has(String(s[0]).toLowerCase()); if (held) note(file, 'staffSpells', 'left out: removed or suspended (gamemode-config.json spells)', s); return !held; });
    const inStaff = new Set(staff.map((s) => s[0]));
    for (const s of old.staffSpells || []) if (!inStaff.has(s[0]) && inOrder(pluginOf(s[0]))) { staff.push(s); inStaff.add(s[0]); note(file, 'staffSpells', 'kept: not produced by the generator', s); }
    staff.sort((x, y) => String(x[1]).toLowerCase().localeCompare(String(y[1]).toLowerCase()) || String(x[0]).localeCompare(String(y[0])));
    // after spells, as the generator writes it
    const keys = Object.keys(out); const at = keys.indexOf('spells') + 1;
    const ordered = {}; keys.slice(0, at).forEach((k) => { ordered[k] = out[k]; }); ordered.staffSpells = staff; keys.slice(at).forEach((k) => { if (k !== 'staffSpells') ordered[k] = out[k]; });
    for (const k of Object.keys(out)) delete out[k];
    Object.assign(out, ordered);
  }
  if (Array.isArray(old.shoutsGate)) {
    const gate = new Set((gen.shouts || []).map((s) => s.shout));
    for (const s of old.shoutsGate) if (!gate.has(s.shout)) note(file, 'shoutsGate', 'kept: not produced by the generator', s.shout);
    out.shoutsGate = (gen.shouts || []).concat(old.shoutsGate.filter((s) => !gate.has(s.shout)));
  }
  return out;
};

// ---- admin-locations.json: {name, world, pos, rot, region} ---------------------------------------------------------------
const mergeLocations = () => {
  const file = 'admin-locations.json';
  const old = read(path.resolve(file)), gen = read(path.join(GEN, file));
  const key = (l) => `${l.world}|${l.name}`;
  const have = new Set(gen.locations.map(key));
  const near = (a, b) => a.world === b.world && Array.isArray(a.pos) && Array.isArray(b.pos) && Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]) <= 1;
  for (const l of old.locations || []) {
    if (have.has(key(l))) continue;
    if (!inOrder(pluginOf(l.world))) { note(file, l.region || 'Other', 'dropped: plugin not in the load order', l.name); continue; }
    // The generator's own rename only: the same marker name at the same place, but for the " x,y" it adds to tell two apart
    // and punctuation ("Black-Briar Lodge 0,1" -> "Black Briar Lodge"). A hand label there ("Boss: Karstaag ...") is kept
    const bare = (s) => String(s).replace(/\s+-?\d+,-?\d+$/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const same = gen.locations.find((g) => near(g, l) && bare(g.name) === bare(l.name));
    if (same) { note(file, l.region || 'Other', 'renamed at the same place (the new name wins)', `${l.name} -> ${same.name}`); continue; }
    gen.locations.push(l); have.add(key(l));
    note(file, l.region || 'Other', 'kept: not produced by the generator (hand-added or no longer matched)', l.name);
  }
  gen.locations.sort((a, b) => String(a.region).localeCompare(String(b.region)) || String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase()));
  return gen;
};

const leftOutFile = path.join(GEN, 'admin-items.creature-left-out.json');
const leftOut = new Set((fs.existsSync(leftOutFile) ? read(leftOutFile) : []).map((r) => r[0]));
const out = {
  'admin-items.json': mergeCategories('admin-items.json', leftOut),
  'admin-placeables.json': mergeCategories('admin-placeables.json', new Set()),
  'admin-powers.json': mergePowers(),
  'admin-locations.json': mergeLocations(),
};
for (const [file, cats] of Object.entries(report)) {
  console.log(`== ${file}`);
  for (const [cat, whats] of Object.entries(cats)) for (const [what, rows] of Object.entries(whats)) {
    console.log(`   ${cat}: ${what}: ${rows.length}`);
    for (const r of rows.slice(0, 40)) console.log(`      ${Array.isArray(r) ? `${r[0]} | ${r[1]}` : typeof r === 'string' ? r : JSON.stringify(r)}`);
  }
}
for (const [file, j] of Object.entries(out)) {
  const n = file === 'admin-powers.json' ? `${j.spells.length} spells, ${(j.shouts || []).length} shouts, ${(j.shoutsGate || []).length} in the shout gate` : file === 'admin-locations.json' ? `${j.locations.length} locations` : `${j.categories.reduce((s, c) => s + c.items.length, 0)} rows in ${j.categories.length} categories`;
  console.log(`${WRITE ? 'wrote' : 'would write'} ${file}: ${n}`);
  if (WRITE) {
    const was = fs.readFileSync(path.resolve(file), 'utf8');
    // As its generator writes it: Python's json.dump escapes non-ASCII (\uXXXX) unless told not to, as admin_placeables.py is
    const ascii = (s) => s.replace(/[\u007f-￿]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
    // The tracked layouts: powers and locations indented by one space, the two big category files compact
    // Numbers as admin_catalog.py writes them: every pos value a Python float (168.0, not 168), and rot as [0, 0, z] with only
    // z a float (its first two are ints there)
    const floats = (t) => {
      let arr = '', i = 0;
      return t.split('\n').map((l) => {
        const open = l.match(/"(pos|rot)": \[$/);
        if (open) { arr = open[1]; i = 0; return l; }
        if (arr && /^\s*\]/.test(l)) { arr = ''; return l; }
        if (!arr) return l;
        const isFloat = arr === 'pos' || i === 2; i++;
        return isFloat ? l.replace(/^(\s*-?\d+)(,?)$/, '$1.0$2') : l;
      }).join('\n');
    };
    const text = file === 'admin-powers.json' ? ascii(JSON.stringify(j, null, 1))
      : file === 'admin-locations.json' ? floats(ascii(JSON.stringify(j, null, 1)))
      : file === 'admin-items.json' ? ascii(JSON.stringify(j)) : JSON.stringify(j);
    fs.writeFileSync(path.resolve(file), text + (was.endsWith('\n') ? '\n' : ''));
  }
}
