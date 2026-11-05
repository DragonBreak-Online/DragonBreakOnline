#!/usr/bin/env node
// Queue a staff gift for a character's next time in the world (gifts.js delivers it). One file per gift in gifts-inbox/,
// written whole and renamed into place, so the server never reads half a gift.
//
//   sudo node tools/gift.js --tag KKVT --gold 50 --reason "Sorry, the update ended your dungeon run" --by Nate
//   sudo node tools/gift.js --profile 71 --item 0x1397e:1 --reason "..."
//   sudo node tools/gift.js --tag 8YDB --school Destruction:21 --reason "..."   levels added to a school (repeatable)
//
// School levels need a --tag (they belong to one character) and are written as a gift of their own, beside any gold and
// items, so a server whose gifts.js knows no schools (before the update, or after a rollback) leaves them waiting instead
// of paying the gold and dropping the levels. A second gift of the same school to the same #TAG, waiting or delivered,
// is refused unless --force is given: levels are added, so queueing one twice pays twice.
//   sudo node tools/gift.js --tag 8YDB --appearance-free 1 --reason "..."   free /appearance changes (1-3)
// Free appearance changes need a --tag and are a gift of their own the same way; a second to the same #TAG needs --force.
//   sudo node tools/gift.js --batch 20261105T220000 --tag 8YDB --gold 500 --appearance-free 1 --reason "..."   fixed ids
// With --batch the ids are <stamp>-<TAG>-c0e001 (gold, items), -c0e002 (free changes) and -c0e003 (schools), so a bulk script
// run again writes nothing twice: an id already waiting or delivered is left alone, and one with other contents stops the run.
//   sudo node tools/gift.js --list            what waits in the inbox, and the last deliveries
//
// GIFTS_DIR is the live server folder (default /opt/alduinak/build/dist/server).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = process.env.GIFTS_DIR || '/opt/alduinak/build/dist/server';
const INBOX = path.join(DIR, 'gifts-inbox');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i === -1 ? undefined : args[i + 1]; };
const all = (k) => args.reduce((out, a, i) => (a === `--${k}` && args[i + 1] !== undefined ? out.concat(args[i + 1]) : out), []);
const die = (m) => { console.error(m); process.exit(2); };

if (args.includes('--list')) {
  let files = [];
  try { files = fs.readdirSync(INBOX).filter((f) => f.endsWith('.json')); } catch (e) { /* no inbox yet */ }
  console.log(`waiting (${files.length}):`);
  for (const f of files) console.log(`  ${f}  ${fs.readFileSync(path.join(INBOX, f), 'utf8').replace(/\s+/g, ' ')}`);
  let l = {};
  try { l = JSON.parse(fs.readFileSync(path.join(DIR, 'gift-ledger.json'), 'utf8')).delivered || {}; } catch (e) { /* none yet */ }
  const done = Object.entries(l).slice(-10);
  console.log(`delivered (last ${done.length} of ${Object.keys(l).length}):`);
  for (const [id, d] of done) console.log(`  ${id}  ${d.at}  ${d.to}  ${d.gold ? d.gold + ' gold ' : ''}${(d.items || []).length ? JSON.stringify(d.items) : ''}${d.schools ? `${(d.items || []).length ? ' ' : ''}schools ${JSON.stringify(d.schools)} ${d.schoolsGiven ? `given ${JSON.stringify(d.schoolsGiven)} ` : ''}${d.rest ? `rest queued as ${d.rest} ` : ''}${d.restNotQueued ? `rest NOT queued ${JSON.stringify(d.restNotQueued)} ` : ''}` : ''}${d.appearanceFree ? `appearanceFree ${d.appearanceFree} given ${d.appearanceFreeGiven === undefined ? '?' : d.appearanceFreeGiven} ` : ''} ${d.reason}`);
  process.exit(0);
}

const tag = opt('tag') ? String(opt('tag')).replace(/^#/, '').toUpperCase() : undefined;
const profile = opt('profile') !== undefined ? Number(opt('profile')) : undefined;
if (!tag === (profile === undefined)) die('give exactly one of --tag XXXX or --profile N');
if (tag && !/^[A-Z0-9]{4}$/.test(tag)) die('a tag is four letters or digits, like KKVT');
if (profile !== undefined && !(Number.isInteger(profile) && profile > 0)) die('--profile is a positive whole number');
const gold = opt('gold') !== undefined ? Number(opt('gold')) : undefined;
if (gold !== undefined && !(Number.isInteger(gold) && gold > 0 && gold <= 100000)) die('--gold is 1-100000');
const items = all('item').map((s) => {
  const m = /^(0x[0-9a-f]+|\d+):(\d+)$/i.exec(s);
  if (!m) die(`--item is baseId:count, like 0x1397e:1 (got ${s})`);
  return { baseId: Number(m[1]), count: Number(m[2]) };
});
// Restoration is not one: it follows Priest on the Wheel
const SCHOOLS = ['Alteration', 'Conjuration', 'Destruction', 'Illusion'];
const schools = {};
for (const s of all('school')) {
  const m = /^([a-z]+):(\d+)$/i.exec(s);
  const name = m && SCHOOLS.find((n) => n.toLowerCase() === m[1].toLowerCase());
  if (!name) die(`--school is School:levels, one of ${SCHOOLS.join(', ')}, like Destruction:21 (got ${s})`);
  if (!(Number(m[2]) >= 1 && Number(m[2]) <= 100)) die(`--school levels are 1-100 (got ${s})`);
  if (schools[name]) die(`--school ${name} is given twice`);
  schools[name] = Number(m[2]);
}
const free = args.includes('--appearance-free') ? Number(opt('appearance-free')) : undefined;
if (free !== undefined && !(Number.isInteger(free) && free >= 1 && free <= 3)) die(`--appearance-free is 1-3 free /appearance changes (got ${opt('appearance-free')})`);
if (!gold && !items.length && !Object.keys(schools).length && !free) die('nothing to give: --gold N, --item baseId:count, --school School:levels and/or --appearance-free N');
if (Object.keys(schools).length && !tag) die('--school needs --tag: school levels belong to one character, not a profile');
if (free && !tag) die('--appearance-free needs --tag: free appearance changes belong to one character, not a profile');
const reason = String(opt('reason') || '').slice(0, 200);
if (!reason) die('--reason is required: the player is told it');

const batch = args.includes('--batch') ? String(opt('batch')) : '';
if (args.includes('--batch') && !/^\d{8}T\d{6}$/.test(batch)) die('--batch is a UTC stamp YYYYMMDDTHHMMSS, like 20261105T220000');

const by = String(opt('by') || 'staff').slice(0, 40), at = new Date().toISOString();
const newId = (kind) => `${batch || at.replace(/[-:]/g, '').slice(0, 15)}-${tag || 'p' + profile}-${batch ? kind : crypto.randomBytes(3).toString('hex')}`;
const gifts = [
  ...(gold || items.length ? [[newId('c0e001'), { ...(tag ? { tag } : { profile }), ...(gold ? { gold } : {}), ...(items.length ? { items } : {}), reason, by, at }]] : []),
  ...(Object.keys(schools).length ? [[newId('c0e003'), { tag, schools, reason, by, at }]] : []),
  ...(free ? [[newId('c0e002'), { tag, appearanceFree: free, reason, by, at }]] : []),
];

const read = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };
let waiting = [];
try { waiting = fs.readdirSync(INBOX).filter((f) => f.endsWith('.json')); } catch (e) { /* no inbox yet */ }
const delivered = (read(path.join(DIR, 'gift-ledger.json')) || {}).delivered || {};

// A batch id already waiting or delivered is that same gift, so it is not written again; one with other contents stops the run
const shape = (g) => JSON.stringify([g.gold || 0, g.items || [], g.schools ? Object.entries(g.schools).sort() : null, g.appearanceFree || 0]);
const found = (id) => (delivered[id] ? [delivered[id], 'delivered'] : waiting.includes(`${id}.json`) ? [read(path.join(INBOX, `${id}.json`)) || {}, 'waiting'] : null);
const again = gifts.map(([id, g]) => {
  const f = found(id);
  if (f && shape(f[0]) !== shape(g)) die(`${id} is already ${f[1]} with other contents (${JSON.stringify(f[0])}); nothing written. Use another --batch stamp`);
  return f ? f[1] : '';
});
const own = (id) => gifts.some(([x]) => id === x || id.startsWith(`${x}-rest`));

// Schools or free appearance changes already gifted to this #TAG, waiting in the inbox or in the ledger (a gift's id carries its tag)
if ((Object.keys(schools).length || free) && !args.includes('--force')) {
  const forTag = [
    ...waiting.map((f) => [path.basename(f, '.json'), read(path.join(INBOX, f)), 'waiting']).filter(([id, g]) => g && g.tag === tag && !own(id)),
    ...Object.entries(delivered).filter(([id]) => id.split('-')[1] === tag && !own(id)).map(([id, d]) => [id, d, 'delivered']),
  ];
  const seen = forTag.filter(([, g]) => g && g.schools && Object.keys(schools).some((k) => g.schools[k]));
  if (seen.length) die(`#${tag} already has ${seen.map(([id, g, how]) => `${id} (${how}: ${JSON.stringify(g.schools)})`).join(', ')}; levels are added, so this would pay again. Add --force if it is really a new grant`);
  const seenFree = free ? forTag.filter(([, g]) => g && g.appearanceFree) : [];
  if (seenFree.length) die(`#${tag} already has ${seenFree.map(([id, g, how]) => `${id} (${how}: ${g.appearanceFree} free appearance change(s))`).join(', ')}; free changes are added, so this would give them again. Add --force if it is really a new grant`);
}

fs.mkdirSync(INBOX, { recursive: true });
gifts.forEach(([id, gift], i) => {
  if (again[i]) { console.log(`already ${again[i]} ${id}: not written again`); return; }
  const tmp = path.join(INBOX, `.${id}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(gift, null, 1));
  fs.renameSync(tmp, path.join(INBOX, `${id}.json`));
  console.log(`queued ${id}: ${JSON.stringify(gift)}`);
});
