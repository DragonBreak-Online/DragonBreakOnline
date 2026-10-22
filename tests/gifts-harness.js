// Scripted test for server\gifts.js and tools\gift.js with a mock gamemode api, in a scratch folder: a queued gift waits
// while its character is offline, is handed over once they are in the world (tag or profile), the player is told the
// reason, the ledger records it and the inbox file goes; a gift already in the ledger never pays twice; bad files are
// refused and left alone. School levels (mod-0311): a gift of them goes through schools.js __dboSchoolsGrant (mocked here;
// tests/schools-grant-harness.js runs the real one), once, alone or with gold and items, and waits while it is missing.
// Run it from this folder's parent with
//
//   node tests\gifts-harness.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || (fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir()), 'claude-nate-gifts-'));
const cwd = process.cwd(); process.chdir(dir);
let failures = 0;
const check = (label, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? '   ' + JSON.stringify(detail) : ''}`); if (!ok) failures++; };

const A = 0xff000014, B = 0xff000015;
const props = { [A]: { 'private.charTag': 'KKVT', profileId: 71 }, [B]: { 'private.charTag': '44YG', profileId: 88 } };
let online = [];
const out = { personal: [], audits: [], given: [], logs: [] };
let tick = null;
const api = {
  mp: { get: (id, k) => (props[id] || {})[k] },
  log: (t) => out.logs.push(t), personal: (a, t) => out.personal.push({ a, t }), audit: (t) => out.audits.push(t), who: (a) => `P${a.toString(16)}`,
  onlineActors: () => online, profileOf: (a) => (props[a] || {}).profileId,
  giveItem: (a, baseId, count) => { out.given.push({ a, baseId, count }); return true; },
  every: (name, ms, fn) => { tick = fn; },
};
const loadGifts = () => { delete require.cache[path.join(root, 'gifts.js')]; require(path.join(root, 'gifts.js'))(api); };
loadGifts();
const gift = (...a) => execFileSync(process.execPath, [path.join(root, 'tools', 'gift.js'), ...a], { env: { ...process.env, GIFTS_DIR: dir }, encoding: 'utf8' });
const inbox = () => { try { return fs.readdirSync(path.join(dir, 'gifts-inbox')).filter((f) => f.endsWith('.json')); } catch (e) { return []; } };
const ledger = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'gift-ledger.json'), 'utf8')).delivered; } catch (e) { return {}; } };

gift('--tag', '#kkvt', '--gold', '50', '--reason', 'Sorry, the update ended your dungeon run', '--by', 'Nate');
gift('--profile', '88', '--gold', '50', '--item', '0x1397e:1', '--reason', 'Sorry, the update ended your dungeon run');
check('the tool queues two gifts', inbox().length === 2, inbox());
tick();
check('nobody online: nothing is given and both wait', out.given.length === 0 && inbox().length === 2);

online = [A];
tick();
check('#KKVT in the world gets 50 gold', out.given.length === 1 && out.given[0].a === A && out.given[0].baseId === 0xf && out.given[0].count === 50, out.given);
check('they are told the reason', out.personal.some((x) => x.a === A && /50 gold\. Sorry, the update ended your dungeon run/.test(x.t)), out.personal);
check('the ledger records it and its file goes', Object.keys(ledger()).length === 1 && inbox().length === 1);
check('the audit names the gift and the giver', out.audits.some((t) => /^GIFT .*by Nate to Pff000014: 50 gold;/.test(t)), out.audits);
tick();
check('a second look gives nothing more', out.given.length === 1);

online = [A, B];
tick();
check('profile 88 gets the gold and the item', out.given.filter((g) => g.a === B).length === 2 && out.given.some((g) => g.a === B && g.baseId === 0x1397e && g.count === 1));
check('the inbox is empty and the ledger holds two', inbox().length === 0 && Object.keys(ledger()).length === 2);

// A gift already in the ledger (the file came back, say from a restored backup) is cleared, not paid again
const [firstId] = Object.keys(ledger());
fs.writeFileSync(path.join(dir, 'gifts-inbox', `${firstId}.json`), JSON.stringify({ tag: 'KKVT', gold: 50, reason: 'again' }));
const before = out.given.length; tick();
check('a delivered gift never pays twice', out.given.length === before && inbox().length === 0);

// Bad files are refused and left for staff
fs.writeFileSync(path.join(dir, 'gifts-inbox', 'bad1.json'), JSON.stringify({ tag: 'KKVT', gold: 5000000, reason: 'x' }));
fs.writeFileSync(path.join(dir, 'gifts-inbox', 'bad2.json'), '{ not json');
fs.writeFileSync(path.join(dir, 'gifts-inbox', '.half.tmp'), '{"tag":"KKVT","gold":50}');
tick();
check('too much gold, broken JSON and a half-written file are refused and kept', out.given.length === before && inbox().length === 2);

let refused = 0;
for (const bad of [['--gold', '50', '--reason', 'x'], ['--tag', 'KKVT', '--reason', 'x'], ['--tag', 'KKVT', '--gold', '50'], ['--tag', 'TOOLONG', '--gold', '5', '--reason', 'x']]) {
  try { gift(...bad); } catch (e) { refused++; }
}
check('the tool refuses a gift with no one, nothing, no reason or a bad tag', refused === 4);

// ---- school levels (mod-0311) ----
for (const f of inbox()) fs.unlinkSync(path.join(dir, 'gifts-inbox', f));
const tryGift = (...a) => { try { return gift(...a); } catch (e) { return null; } };
const fileOf = (re) => { const f = inbox().find((x) => re.test(x)); return f ? JSON.parse(fs.readFileSync(path.join(dir, 'gifts-inbox', f), 'utf8')) : null; };
const grants = [];
let grantAnswer = (a, school, n) => ({ ok: true, school, from: 64, to: 64 + n, added: n, heldFor: '' });
const hook = (...a) => { grants.push(a); return grantAnswer(...a); };
const said = (a) => out.personal.filter((x) => x.a === a).map((x) => x.t);
delete globalThis.__dboSchoolsGrant;

const q1 = tryGift('--tag', '#kkvt', '--school', 'destruction:21', '--reason', 'Your classes were underpaid under the old rule', '--by', 'Jake');
const f1 = fileOf(/-KKVT-/);
check('the tool queues a schools-only gift: { schools: { Destruction: 21 } }, no gold or items', !!q1 && f1 && JSON.stringify(f1.schools) === '{"Destruction":21}' && f1.gold === undefined && f1.items === undefined && f1.tag === 'KKVT' && f1.by === 'Jake', f1);
let n0 = out.given.length; tick();
check('schools.js not loaded: the schools gift waits in the inbox, said once in the log', inbox().length === 1 && grants.length === 0 && out.logs.filter((t) => /waits: schools\.js is not loaded/.test(t)).length === 1 && out.given.length === n0, out.logs.slice(-2));
tick();
check('...and the log is not repeated every look', out.logs.filter((t) => /waits: schools\.js is not loaded/.test(t)).length === 1);
globalThis.__dboSchoolsGrant = hook;
tick();
check('with the hook: one grant of 21 Destruction to #KKVT, by and reason passed', grants.length === 1 && grants[0][0] === A && grants[0][1] === 'Destruction' && grants[0][2] === 21 && grants[0][3] === 'Jake' && grants[0][4] === 'Your classes were underpaid under the old rule', grants);
check('...told in one plain line with the reason', said(A).slice(-1)[0] === 'A gift from the staff: 21 levels of Destruction. Your classes were underpaid under the old rule', said(A).slice(-1));
const l1 = Object.values(ledger()).find((d) => d.schools);
check('...the ledger records the schools and the file goes', l1 && JSON.stringify(l1.schools) === '{"Destruction":21}' && l1.to === 'Pff000014' && inbox().length === 0, l1);
check('...the audit lists it, from and to', out.audits.some((t) => /^GIFT \S+-KKVT-\S+ by Jake to Pff000014: 21 Destruction levels \(64 to 85\); Your classes/.test(t)), out.audits.slice(-1));
tick(); loadGifts(); tick();
check('...a second look and a reload grant nothing more', grants.length === 1, grants.length);

// Offline waits; then gold, an item and two schools together
online = [A];
tryGift('--profile', '88', '--gold', '50', '--item', '0x1397e:2', '--school', 'Destruction:10', '--school', 'Illusion:1', '--reason', 'Sorry for the class pay');
tick();
check('a mixed gift for someone offline waits, nothing granted', grants.length === 1 && inbox().length === 1 && fileOf(/-p88-/) && fileOf(/-p88-/).schools && fileOf(/-p88-/).schools.Illusion === 1);
online = [A, B]; n0 = out.given.length; tick();
check('...in the world: the gold and the item given, then both schools granted', out.given.length === n0 + 2 && grants.length === 3 && grants[1][0] === B && grants[1][1] === 'Destruction' && grants[1][2] === 10 && grants[2][1] === 'Illusion' && grants[2][2] === 1, grants.slice(1));
check('...one line for it all', said(B).slice(-1)[0] === 'A gift from the staff: 50 gold, 10 levels of Destruction, 1 level of Illusion. Sorry for the class pay', said(B).slice(-1));
check('...the audit lists gold, item and schools', out.audits.some((t) => /: 50 gold, 2x 0x1397e, 10 Destruction levels \(64 to 74\), 1 Illusion level \(64 to 65\); Sorry for the class pay$/.test(t)), out.audits.slice(-1));

// Held at a pick or refused: the player is told what came, the audit what did not
grantAnswer = (a, school, n) => (school === 'Destruction' ? { ok: true, school, from: 40, to: 50, added: 10, heldFor: 'Adept' } : { ok: false, text: 'Mira\'s Illusion is already 100.', added: 0 });
tryGift('--tag', 'KKVT', '--school', 'Destruction:20', '--school', 'Illusion:5', '--reason', 'held');
tick();
check('a grant held at a pick: told where it stopped and why', said(A).slice(-1)[0] === 'A gift from the staff: 10 levels of Destruction (held at 50 until you choose its Adept spell). held', said(A).slice(-1));
check('...the audit shows the part not given and the refusal', out.audits.some((t) => /: 10 Destruction levels \(40 to 50, 10 not given\) of 20 Destruction levels, 5 Illusion levels \(Illusion: Mira's Illusion is already 100\.\); held$/.test(t)), out.audits.slice(-1));
grantAnswer = () => ({ ok: false, text: 'no', added: 0 });
n0 = out.personal.length;
tryGift('--tag', 'KKVT', '--school', 'Conjuration:3', '--reason', 'refused');
tick();
check('a schools-only gift refused by schools.js: nobody told, audited as NOTHING with the reason, never retried', out.personal.length === n0 && out.audits.some((t) => /: NOTHING \(give failed\) of 3 Conjuration levels \(Conjuration: no\); refused$/.test(t)) && inbox().length === 0, out.audits.slice(-1));

// Bad schools in a file are refused and kept; the tool refuses them before writing
n0 = grants.length;
const badSchools = [{ Restoration: 5 }, { Destruction: 0 }, { Destruction: 101 }, { Destruction: 2.5 }, { destruction: 5 }, {}, [5], { Destruction: '5' }];
badSchools.forEach((sc, i) => fs.writeFileSync(path.join(dir, 'gifts-inbox', `badschool${i}.json`), JSON.stringify({ tag: 'KKVT', schools: sc, reason: 'x' })));
tick();
check('Restoration, 0, 101, a fraction, a wrong name, nothing, a list or a string are refused and kept', grants.length === n0 && inbox().length === badSchools.length && out.logs.filter((t) => /badschool\d\.json refused \(bad schools/.test(t)).length === badSchools.length, out.logs.slice(-3));
for (const f of inbox()) fs.unlinkSync(path.join(dir, 'gifts-inbox', f));
let refusedSchools = 0;
for (const bad of [['Restoration:5'], ['Destruction:0'], ['Destruction:101'], ['Fire:3'], ['Destruction:x'], ['Destruction:5', '--school', 'destruction:2']]) {
  try { gift('--tag', 'KKVT', '--school', ...bad, '--reason', 'x'); } catch (e) { if (/--school/.test(String(e.stderr))) refusedSchools++; }
}
check('the tool refuses Restoration, 0, 101, an unknown school, a bad number and a school twice, naming --school', refusedSchools === 6 && inbox().length === 0, refusedSchools);
tryGift('--tag', 'KKVT', '--school', 'Alteration:4', '--reason', 'list me');
const listed = tryGift('--list') || '';
check('--list shows the schools waiting and delivered', /"schools": \{ "Alteration": 4 \}/.test(listed) && /schools \{"Destruction":21\}/.test(listed), listed);

process.chdir(cwd);
fs.rmSync(dir, { recursive: true, force: true });
console.log(failures ? `${failures} failure(s)` : 'all passed');
process.exit(failures ? 1 : 0);
