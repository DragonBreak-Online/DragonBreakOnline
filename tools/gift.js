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
  for (const [id, d] of done) console.log(`  ${id}  ${d.at}  ${d.to}  ${d.gold ? d.gold + ' gold ' : ''}${(d.items || []).length ? JSON.stringify(d.items) : ''}${d.schools ? `${(d.items || []).length ? ' ' : ''}schools ${JSON.stringify(d.schools)} ${d.schoolsGiven ? `given ${JSON.stringify(d.schoolsGiven)} ` : ''}${d.rest ? `rest queued as ${d.rest} ` : ''}` : ''} ${d.reason}`);
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
if (!gold && !items.length && !Object.keys(schools).length) die('nothing to give: --gold N, --item baseId:count and/or --school School:levels');
if (Object.keys(schools).length && !tag) die('--school needs --tag: school levels belong to one character, not a profile');
const reason = String(opt('reason') || '').slice(0, 200);
if (!reason) die('--reason is required: the player is told it');

// A school already gifted to this #TAG, waiting in the inbox or in the ledger (a gift's id carries its tag)
if (Object.keys(schools).length && !args.includes('--force')) {
  const read = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };
  let waiting = [];
  try { waiting = fs.readdirSync(INBOX).filter((f) => f.endsWith('.json')); } catch (e) { /* no inbox yet */ }
  const seen = [
    ...waiting.map((f) => [path.basename(f, '.json'), read(path.join(INBOX, f)), 'waiting']).filter(([, g]) => g && g.tag === tag),
    ...Object.entries((read(path.join(DIR, 'gift-ledger.json')) || {}).delivered || {}).filter(([id]) => id.split('-')[1] === tag).map(([id, d]) => [id, d, 'delivered']),
  ].filter(([, g]) => g && g.schools && Object.keys(schools).some((k) => g.schools[k]));
  if (seen.length) die(`#${tag} already has ${seen.map(([id, g, how]) => `${id} (${how}: ${JSON.stringify(g.schools)})`).join(', ')}; levels are added, so this would pay again. Add --force if it is really a new grant`);
}

const by = String(opt('by') || 'staff').slice(0, 40), at = new Date().toISOString();
const newId = () => `${at.replace(/[-:]/g, '').slice(0, 15)}-${tag || 'p' + profile}-${crypto.randomBytes(3).toString('hex')}`;
const gifts = [
  ...(gold || items.length ? [{ ...(tag ? { tag } : { profile }), ...(gold ? { gold } : {}), ...(items.length ? { items } : {}), reason, by, at }] : []),
  ...(Object.keys(schools).length ? [{ tag, schools, reason, by, at }] : []),
];
fs.mkdirSync(INBOX, { recursive: true });
for (const gift of gifts) {
  const id = newId();
  const tmp = path.join(INBOX, `.${id}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(gift, null, 1));
  fs.renameSync(tmp, path.join(INBOX, `${id}.json`));
  console.log(`queued ${id}: ${JSON.stringify(gift)}`);
}
