// Release check: a plugin that is new or changed in a release must have its generated catalogue rows in the same release
// (2 Nov: the Flesh Colossus reached dev with no admin-placeables row). For each such plugin, counts the records it adds
// (form ids in its own index, not overrides) by type and fails when a type the catalogues offer has no row naming it.
// A plugin with deliberately no rows goes in tooling/list-check-exempt.json { "exempt": [{ "plugin", "types", "reason" }] }.
//   node tooling/release_lists_check.js <old SHA256SUMS or -> <new SHA256SUMS> <plugin dir> [server dir]
// Prints FAIL lines and exits 1 when any plugin is missing rows; a plugin file it cannot read is a FAIL too.
'use strict';
const fs = require('fs');
const path = require('path');

const [OLD, NEW, PLUGINS, SERVER = path.resolve('.')] = process.argv.slice(2);
if (!NEW || !PLUGINS) { console.log('usage: node tooling/release_lists_check.js <old SHA256SUMS or -> <new SHA256SUMS> <plugin dir> [server dir]'); process.exit(2); }

// Record types each catalogue offers (ck-mcp/admin_catalog.py, admin_placeables.py)
const CATALOGUES = {
  'admin-placeables.json': ['NPC_', 'STAT', 'MSTT', 'FURN', 'CONT', 'ACTI', 'LIGH', 'FLOR', 'TREE', 'DOOR'],
  'admin-items.json': ['WEAP', 'ARMO', 'AMMO', 'BOOK', 'ALCH', 'INGR', 'MISC', 'SCRL', 'SLGM', 'KEYM'],
};
const PLUGIN_RE = /\.(esp|esm|esl)$/i;

const sums = (f) => {
  const m = new Map();
  if (f === '-') return m;
  for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const hit = l.match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (hit && PLUGIN_RE.test(hit[2])) m.set(path.basename(hit[2]).toLowerCase(), { sha: hit[1], name: path.basename(hit[2]) });
  }
  return m;
};

// New records per type: a form id whose top byte is the plugin's master count is the plugin's own
const ownRecords = (file) => {
  const b = fs.readFileSync(file);
  if (b.toString('latin1', 0, 4) !== 'TES4') throw new Error('not a plugin');
  const hdrEnd = 24 + b.readUInt32LE(4);
  let masters = 0;
  for (let p = 24; p < hdrEnd;) { const t = b.toString('latin1', p, p + 4); const n = b.readUInt16LE(p + 4); if (t === 'MAST') masters++; p += 6 + n; }
  const counts = {};
  for (let g = hdrEnd; g < b.length;) {
    if (b.toString('latin1', g, g + 4) !== 'GRUP') throw new Error(`no group at ${g}`);
    const size = b.readUInt32LE(g + 4), label = b.toString('latin1', g + 8, g + 12);
    if (Object.values(CATALOGUES).some((ts) => ts.includes(label))) {
      for (let r = g + 24; r < g + size;) {
        const type = b.toString('latin1', r, r + 4), n = b.readUInt32LE(r + 4);
        if (type === 'GRUP') { r += n; continue; }
        const flags = b.readUInt32LE(r + 8), id = b.readUInt32LE(r + 12);
        // Deleted records never; non-playable items (flag 0x4) are left out by admin_catalog.py too
        const offered = !(flags & 0x20) && !(CATALOGUES['admin-items.json'].includes(type) && (flags & 0x4));
        if ((id >>> 24) === masters && offered) counts[type] = (counts[type] || 0) + 1;
        r += 24 + n;
      }
    }
    g += size;
  }
  return counts;
};

// Plugins named by catalogue rows ([desc, name, plugin]), per file
const rowsByPlugin = {};
for (const f of Object.keys(CATALOGUES)) {
  const s = new Map();
  for (const c of JSON.parse(fs.readFileSync(path.join(SERVER, f), 'utf8')).categories || []) {
    for (const it of c.items || []) { const p = String(it[2] || String(it[0]).slice(String(it[0]).indexOf(':') + 1)).toLowerCase(); s.set(p, (s.get(p) || 0) + 1); }
  }
  rowsByPlugin[f] = s;
}
// A row held out on purpose (tooling/catalog-holds.json) counts as covered
const holdsFile = path.join(SERVER, 'tooling', 'catalog-holds.json');
for (const h of fs.existsSync(holdsFile) ? JSON.parse(fs.readFileSync(holdsFile, 'utf8')).held || [] : []) {
  const s = rowsByPlugin[h.file];
  if (!s) continue;
  const p = String(h.desc).slice(String(h.desc).indexOf(':') + 1).toLowerCase();
  s.set(p, (s.get(p) || 0) + 1);
}
const exemptFile = path.join(SERVER, 'tooling', 'list-check-exempt.json');
const exempt = fs.existsSync(exemptFile) ? JSON.parse(fs.readFileSync(exemptFile, 'utf8')).exempt || [] : [];
const isExempt = (plugin, type) => exempt.some((e) => String(e.plugin).toLowerCase() === plugin && (!e.types || e.types.includes(type)));

const before = sums(OLD), after = sums(NEW);
const touched = [...after.entries()].filter(([k, v]) => !before.has(k) || before.get(k).sha !== v.sha);
let fails = 0;
console.log(`${touched.length} plugin(s) new or changed of ${after.size}`);
for (const [key, { name }] of touched) {
  const file = path.join(PLUGINS, name);
  let counts;
  try { counts = ownRecords(file); } catch (e) { console.log(`FAIL ${name}: unreadable (${e.message})`); fails++; continue; }
  const status = before.has(key) ? 'changed' : 'new';
  for (const [cat, types] of Object.entries(CATALOGUES)) {
    const own = types.filter((t) => counts[t] && !isExempt(key, t));
    if (!own.length) continue;
    const rows = rowsByPlugin[cat].get(key) || 0;
    const what = own.map((t) => `${counts[t]} ${t}`).join(', ');
    if (rows) console.log(`ok   ${name} (${status}): ${what}; ${rows} row(s) in ${cat}`);
    else { console.log(`FAIL ${name} (${status}): ${what} of its own, no row in ${cat}`); fails++; }
  }
}
console.log(fails ? `\n${fails} FAIL(s): regenerate the catalogues (ck-mcp/admin_catalog.py, admin_placeables.py, then tooling/admin_catalog_merge.js) or exempt the plugin` : '\nall lists cover the release');
process.exit(fails ? 1 : 0);
