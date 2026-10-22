// Scripted test for server\gifts.js and tools\gift.js with a mock gamemode api, in a scratch folder: a queued gift waits
// while its character is offline, is handed over once they are in the world (tag or profile), the player is told the
// reason, the ledger records it and the inbox file goes; a gift already in the ledger never pays twice; bad files are
// refused and left alone. School levels (mod-0311): a gift of them goes through schools.js __dboSchoolsGrant (mocked here;
// tests/schools-grant-harness.js runs the real one), once, alone or with gold and items, and waits while it is missing,
// while schools.js refuses a school or while nothing can be given yet; levels held at a pick are queued again.
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
const toolErr = (...a) => { try { gift(...a); return ''; } catch (e) { return String(e.stderr); } };
const fileOf = (re) => { const f = inbox().find((x) => re.test(x)); return f ? JSON.parse(fs.readFileSync(path.join(dir, 'gifts-inbox', f), 'utf8')) : null; };
const filesOf = (re) => inbox().filter((x) => re.test(x)).map((f) => JSON.parse(fs.readFileSync(path.join(dir, 'gifts-inbox', f), 'utf8')));
// The mocked hook: grants are the real calls, asks the dry ones gifts.js makes before it spends a gift
const grants = [], asks = [];
let grantAnswer = (a, school, n) => ({ ok: true, text: '', school, from: 64, to: 64 + n, added: n, heldFor: '' });
const hook = (...a) => { (a[5] ? asks : grants).push(a); return grantAnswer(...a); };
const said = (a) => out.personal.filter((x) => x.a === a).map((x) => x.t);
delete globalThis.__dboSchoolsGrant;

const q1 = tryGift('--tag', '#kkvt', '--school', 'destruction:21', '--reason', 'Your classes were underpaid under the old rule', '--by', 'Jake');
const f1 = fileOf(/-KKVT-/);
check('the tool queues a schools-only gift: { schools: { Destruction: 21 } }, no gold or items', !!q1 && f1 && JSON.stringify(f1.schools) === '{"Destruction":21}' && f1.gold === undefined && f1.items === undefined && f1.tag === 'KKVT' && f1.by === 'Jake', f1);
check('...and a second one of the same school to the same #TAG is refused while the first waits', /#KKVT already has \S+-KKVT-\S+ \(waiting: \{"Destruction":21\}\).*--force/.test(toolErr('--tag', 'KKVT', '--school', 'Destruction:21', '--reason', 'twice')) && inbox().length === 1, inbox());
let n0 = out.given.length; tick();
check('schools.js not loaded: the schools gift waits in the inbox, said once in the log', inbox().length === 1 && grants.length === 0 && out.logs.filter((t) => /waits: schools\.js is not loaded/.test(t)).length === 1 && out.given.length === n0, out.logs.slice(-2));
tick();
check('...and the log is not repeated every look', out.logs.filter((t) => /waits: schools\.js is not loaded/.test(t)).length === 1);
globalThis.__dboSchoolsGrant = hook;
tick();
check('with the hook: one grant of 21 Destruction to #KKVT, by and reason passed', grants.length === 1 && grants[0][0] === A && grants[0][1] === 'Destruction' && grants[0][2] === 21 && grants[0][3] === 'Jake' && grants[0][4] === 'Your classes were underpaid under the old rule', grants);
check('...asked first with a dry run of the same grant', asks.length === 1 && JSON.stringify(asks[0]) === JSON.stringify([...grants[0], true]), asks);
check('...told in one plain line with the reason', said(A).slice(-1)[0] === 'A gift from the staff: 21 levels of Destruction. Your classes were underpaid under the old rule', said(A).slice(-1));
const [id1, l1] = Object.entries(ledger()).find(([, d]) => d.schools) || [];
check('...the ledger records the schools asked and given and the file goes', l1 && JSON.stringify(l1.schools) === '{"Destruction":21}' && JSON.stringify(l1.schoolsGiven) === '{"Destruction":21}' && !l1.rest && l1.to === 'Pff000014' && inbox().length === 0, l1);
check('...the audit lists it, from and to', out.audits.some((t) => /^GIFT \S+-KKVT-\S+ by Jake to Pff000014: 21 Destruction levels \(64 to 85\); Your classes/.test(t)), out.audits.slice(-1));
tick(); loadGifts(); tick();
check('...a second look and a reload grant nothing more', grants.length === 1, grants.length);
check('...and once delivered, the same school again for #KKVT is refused by the tool unless --force', /#KKVT already has \S+ \(delivered: \{"Destruction":21\}\)/.test(toolErr('--tag', 'KKVT', '--school', 'Destruction:21', '--reason', 'twice')) && inbox().length === 0, inbox());
// The ledger the only guard: the file comes back (a crash between the ledger and the unlink, or a restored backup)
let nA = out.audits.length, nS = said(A).length;
fs.writeFileSync(path.join(dir, 'gifts-inbox', `${id1}.json`), JSON.stringify(f1));
tick();
check('the delivered schools gift\'s file back in the inbox: cleared, nothing asked, granted, told or audited', grants.length === 1 && asks.length === 1 && inbox().length === 0 && out.audits.length === nA && said(A).length === nS, [grants.length, asks.length, inbox()]);
fs.writeFileSync(path.join(dir, 'gifts-inbox', `${id1}.json`), JSON.stringify(f1));
loadGifts(); tick();
check('...and after a reload the same', grants.length === 1 && asks.length === 1 && inbox().length === 0 && out.audits.length === nA && said(A).length === nS, [grants.length, asks.length, inbox()]);

// Gold, items and schools from the tool: two files, so a gifts.js without schools keeps the levels waiting
online = [A];
const q2 = tryGift('--tag', '44YG', '--gold', '50', '--item', '0x1397e:2', '--school', 'Destruction:10', '--school', 'Illusion:1', '--reason', 'Sorry for the class pay');
const two = filesOf(/-44YG-/);
check('the tool writes gold and items as one gift and the school levels as another', !!q2 && two.length === 2 && two.some((g) => g.gold === 50 && g.items.length === 1 && !g.schools) && two.some((g) => JSON.stringify(g.schools) === '{"Destruction":10,"Illusion":1}' && !g.gold && !g.items), two);
tick();
check('...for someone offline both wait, nothing granted', grants.length === 1 && inbox().length === 2);
online = [A, B]; n0 = out.given.length; tick();
check('...in the world: the gold and the item given, then both schools granted', out.given.length === n0 + 2 && grants.length === 3 && grants[1][0] === B && grants[1][1] === 'Destruction' && grants[1][2] === 10 && grants[2][1] === 'Illusion' && grants[2][2] === 1 && inbox().length === 0, grants.slice(1));
check('...told in a line for each', said(B).slice(-2).sort().join('|') === 'A gift from the staff: 10 levels of Destruction, 1 level of Illusion. Sorry for the class pay|A gift from the staff: 50 gold. Sorry for the class pay', said(B).slice(-2));
// One file with all three (written by hand) is still delivered whole
fs.writeFileSync(path.join(dir, 'gifts-inbox', 'mixed.json'), JSON.stringify({ tag: '44YG', gold: 7, items: [{ baseId: 0x1397e, count: 1 }], schools: { Conjuration: 2 }, reason: 'mixed' }));
n0 = out.given.length; tick();
check('a hand-written gift of gold, an item and a school: all given, one line, one audit line', out.given.length === n0 + 2 && grants.length === 4 && grants[3][1] === 'Conjuration' && said(B).slice(-1)[0] === 'A gift from the staff: 7 gold, 2 levels of Conjuration. mixed' && out.audits.some((t) => /^GIFT mixed by staff to Pff000015: 7 gold, 1x 0x1397e, 2 Conjuration levels \(64 to 66\); mixed$/.test(t)), [said(B).slice(-1), out.audits.slice(-1)]);
check('the tool refuses school levels for a profile (they belong to one character)', /--school needs --tag/.test(toolErr('--profile', '88', '--school', 'Destruction:10', '--reason', 'x')) && inbox().length === 0, inbox());

// Held at a pick: what fits is given, the rest queued again and paid once the spell is chosen; capped at 100: told
online = [A];
const fullAnswer = (a, school) => ({ ok: false, text: 'Mira\'s Illusion is already 100.', school, from: 100, to: 100, added: 0, heldFor: '' });
grantAnswer = (a, school, n) => (school === 'Destruction' ? { ok: true, text: '', school, from: 40, to: 50, added: 10, heldFor: 'Adept' } : school === 'Illusion' ? fullAnswer(a, school) : { ok: true, text: '', school, from: 95, to: 100, added: 5, heldFor: '' });
tryGift('--tag', 'KKVT', '--school', 'Destruction:20', '--school', 'Illusion:5', '--school', 'Conjuration:8', '--reason', 'held', '--force');
nA = out.logs.length; tick();
const [hid, hl] = Object.entries(ledger()).find(([, d]) => d.reason === 'held') || [];
check('a grant held at a pick: told where it stopped and that the rest follows; capped: told it is 100', said(A).slice(-1)[0] === 'A gift from the staff: 10 levels of Destruction (it stops at 50 until you choose its Adept spell; the other 10 levels follow then), 5 levels of Conjuration (it is now 100, the most there is). held', said(A).slice(-1));
check('...the ledger records what each school got and the rest\'s id', hl && JSON.stringify(hl.schoolsGiven) === '{"Destruction":10,"Illusion":0,"Conjuration":5}' && hl.rest === `${hid}-rest1`, hl);
const rest1 = fileOf(/-rest1\.json$/);
check('...the 10 not given wait in the inbox as <id>-rest1, for #KKVT, with the reason and giver', inbox().length === 1 && rest1 && rest1.tag === 'KKVT' && JSON.stringify(rest1.schools) === '{"Destruction":10}' && rest1.reason === 'held' && rest1.after === hid, [inbox(), rest1]);
check('...the audit shows the queued rest, the cap and the refusal', out.audits.some((t) => t === `GIFT ${hid} by staff to Pff000014: 10 Destruction levels (40 to 50, 10 more queued as ${hid}-rest1), 5 Conjuration levels (95 to 100, 3 not given) of 20 Destruction levels, 5 Illusion levels, 8 Conjuration levels (Illusion: Mira's Illusion is already 100.); held`), out.audits.slice(-1));
check('...and the levels not given (cap, refusal) are logged for staff', out.logs.slice(nA).some((t) => new RegExp(`^gifts: ${hid}: Illusion gave 0 of 5, Conjuration gave 5 of 8; see its GIFT audit line$`).test(t)), out.logs.slice(nA));
// Still held: the rest waits, logged once, nothing spent
grantAnswer = (a, school) => ({ ok: false, text: 'Mira\'s Destruction is held at 50 until its Adept spell is chosen.', school, from: 50, to: 50, added: 0, heldFor: 'Adept' });
let g0 = grants.length; nA = out.logs.length; tick(); tick();
check('the rest while the spell is still unchosen: not spent, nothing granted, said once in the log', grants.length === g0 && inbox().length === 1 && !ledger()[`${hid}-rest1`] && out.logs.slice(nA).filter((t) => /-rest1\.json waits: nothing can be given yet \(Destruction: Mira's Destruction is held at 50/.test(t)).length === 1, out.logs.slice(nA));
// Chosen: the rest is paid in full
grantAnswer = (a, school, n) => ({ ok: true, text: '', school, from: 51, to: 51 + n, added: n, heldFor: '' });
tick();
check('...once chosen, the other 10 are granted and the rest is in the ledger', grants.length === g0 + 1 && grants[g0][2] === 10 && inbox().length === 0 && ledger()[`${hid}-rest1`] && JSON.stringify(ledger()[`${hid}-rest1`].schoolsGiven) === '{"Destruction":10}' && said(A).slice(-1)[0] === 'A gift from the staff: 10 levels of Destruction. held', [said(A).slice(-1), ledger()[`${hid}-rest1`]]);
// Nothing at all to give (already 100): it waits, it is not spent
grantAnswer = fullAnswer;
tryGift('--tag', 'KKVT', '--school', 'Illusion:3', '--reason', 'full', '--force');
g0 = grants.length; nA = out.logs.length; const nP = out.personal.length; tick();
check('a schools-only gift that can give nothing: kept in the inbox, not in the ledger, nobody told, logged with why', grants.length === g0 && inbox().length === 1 && !Object.values(ledger()).some((d) => d.reason === 'full') && out.personal.length === nP && out.logs.slice(nA).some((t) => /waits: nothing can be given yet \(Illusion: Mira's Illusion is already 100\.\)/.test(t)), out.logs.slice(nA));
for (const f of inbox()) fs.unlinkSync(path.join(dir, 'gifts-inbox', f));
// schools.js refuses a school the tool and gifts.js know (the live config can drop Alteration): the gift waits
grantAnswer = (a, school) => ({ ok: false, text: `${school} is not a school of magic. Schools: Conjuration, Destruction, Illusion.` });
tryGift('--tag', 'KKVT', '--gold', '5', '--school', 'Alteration:3', '--reason', 'refused');
g0 = grants.length; nA = out.logs.length; n0 = out.given.length; tick();
check('a school schools.js refuses: that gift is kept and logged once, not spent (its gold, a gift of its own, is paid)', grants.length === g0 && inbox().length === 1 && fileOf(/-KKVT-/).schools.Alteration === 3 && !Object.values(ledger()).some((d) => d.schools && d.reason === 'refused') && out.given.length === n0 + 1 && out.logs.slice(nA).filter((t) => /refused by schools\.js \(Alteration: Alteration is not a school of magic/.test(t)).length === 1, out.logs.slice(nA));
for (const f of inbox()) fs.unlinkSync(path.join(dir, 'gifts-inbox', f));

// Bad schools in a file are refused and kept; the tool refuses them before writing
n0 = grants.length;
const badSchools = [{ Restoration: 5 }, { Destruction: 0 }, { Destruction: 101 }, { Destruction: 2.5 }, { destruction: 5 }, {}, [5], { Destruction: '5' }];
badSchools.forEach((sc, i) => fs.writeFileSync(path.join(dir, 'gifts-inbox', `badschool${i}.json`), JSON.stringify({ tag: 'KKVT', schools: sc, reason: 'x' })));
fs.writeFileSync(path.join(dir, 'gifts-inbox', 'badprofile.json'), JSON.stringify({ profile: 71, schools: { Destruction: 5 }, reason: 'x' }));
online = [A, B]; tick();
check('Restoration, 0, 101, a fraction, a wrong name, nothing, a list or a string are refused and kept', grants.length === n0 && out.logs.filter((t) => /badschool\d\.json refused \(bad schools/.test(t)).length === badSchools.length, out.logs.slice(-3));
check('...and so are school levels for a profile', grants.length === n0 && inbox().length === badSchools.length + 1 && out.logs.some((t) => /badprofile\.json refused \(schools need a #TAG, not a profile\)/.test(t)), out.logs.slice(-1));
for (const f of inbox()) fs.unlinkSync(path.join(dir, 'gifts-inbox', f));
let refusedSchools = 0;
for (const bad of [['Restoration:5'], ['Destruction:0'], ['Destruction:101'], ['Fire:3'], ['Destruction:x'], ['Destruction:5', '--school', 'destruction:2']]) {
  try { gift('--tag', 'KKVT', '--school', ...bad, '--reason', 'x'); } catch (e) { if (/--school/.test(String(e.stderr))) refusedSchools++; }
}
check('the tool refuses Restoration, 0, 101, an unknown school, a bad number and a school twice, naming --school', refusedSchools === 6 && inbox().length === 0, refusedSchools);
tryGift('--tag', 'KKVT', '--school', 'Alteration:4', '--reason', 'list me', '--force');
const listed = tryGift('--list') || '';
check('--list shows the schools waiting, and delivered with what was given and the rest\'s id', /"schools": \{ "Alteration": 4 \}/.test(listed) && /schools \{"Destruction":21\} given \{"Destruction":21\}/.test(listed) && new RegExp(`given \\{"Destruction":10,"Illusion":0,"Conjuration":5\\} rest queued as ${hid}-rest1`).test(listed), listed);

process.chdir(cwd);
fs.rmSync(dir, { recursive: true, force: true });
console.log(failures ? `${failures} failure(s)` : 'all passed');
process.exit(failures ? 1 : 0);
