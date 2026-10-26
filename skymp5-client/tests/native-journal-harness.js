// Runs the native Character Journal (swf/dbo_journal) on the stub stage with hub payloads shaped as journal.js hubPayload
// builds them: the shell (tabs, head, clock, footer, paging, the Ask overlay, the browser hand-off) and each native tab.
//   node tests/native-journal-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;

const TABS = [{ id: 'profile', label: 'Profile' }, { id: 'stats', label: 'Stats' }, { id: 'wanted', label: 'Wanted', badge: '2' },
  { id: 'world', label: 'World' }, { id: 'settings', label: 'Settings', pinned: true }];
const hub = (tab, extra) => Object.assign({ type: 'journal', id: 50, nonce: 'n1', hub: 1, tabs: TABS, tab, opened: 1,
  clock: { date: 'Morndas, 26th of Frostfall', time: '14:05', moons: 'Masser full' }, head: { name: 'Olaf', title: 'Wanderer', race: 'Nord' } }, extra || {});
const stats = { groups: [{ name: 'Combat', rows: [{ label: 'Kills', value: '12' }, { label: 'Deaths', value: '3', hint: 'two to wolves' }] },
  { name: 'Travel', rows: [{ label: 'Walked', value: '41 km' }] }] };
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const P = (t) => t.root.dboPanel;
const pages = (t) => Object.keys(P(t).body.flowClip.kids).map((k) => P(t).body.flowClip[k]);
const shownPage = (t) => pages(t).find((p) => p._visible);
// every text on the shown page, in drawing order (an entry's label and sub included)
const texts = (t) => {
  const out = [];
  const walk = (c) => { for (const k of Object.keys(c.kids)) { const x = c.kids[k]; if (typeof x.text === 'string' && !x.kids) out.push(x.text); else if (x.kids) walk(x); } };
  walk(shownPage(t));
  return out;
};
const buttonsOf = (t) => { const out = []; const walk = (c) => { for (const k of Object.keys(c.kids)) { const x = c.kids[k]; if (x.kids && x.label && x.onPick) out.push(x); else if (x.kids) walk(x); } }; walk(shownPage(t)); return out; };
const btn = (t, label) => buttonsOf(t).find((b) => b.label.text === label);
const btnStarting = (t, label) => buttonsOf(t).find((b) => b.label.text.indexOf(label) === 0);
const closed = (t) => t.sent.some((m) => m.e === 'closeMenu');

{
  const t = S.boot('dbo_journal');
  check('says ready with the frame skse appeared on', msgs(t, 'ready').length === 1 && msgs(t, 'ready')[0].args[0] === 1);
  t.push(hub('stats', { stats }));
  check('the head: name, title and race; the clock at the right', P(t).head.name.text === 'Olaf' && P(t).head.subtitle.text === 'Wanderer  -  Nord' && /Frostfall\n14:05  -  Masser full/.test(P(t).head.clock.text), [P(t).head.subtitle.text, P(t).head.clock.text]);
  const tabs = Object.keys(P(t).tabs.kids).filter((k) => /^t\d$/.test(k)).map((k) => P(t).tabs[k]);
  check('every tab the server lists is in the strip, the open one bright, a badge in brackets', tabs.length === 5 && tabs[1]._alpha === 100 && tabs[0]._alpha === 30 && tabs[2].label.text === 'Wanted  (2)', tabs.map((x) => x.label.text));
  check('a pinned tab sits at the right end', tabs[4]._x > tabs[3]._x && tabs[4]._x + 0 > 900, tabs.map((x) => x._x));
  check('Stats draws its groups and rows, a hint after the value', texts(t).join('|') === 'Combat|Kills|12|Deaths|3   two to wolves|Travel|Walked|41 km', texts(t).join('|'));
  tabs[0].onRelease();
  check('a click on Profile asks the server for it (it moves the journal to the browser)', msgs(t, 'dbo:journalTab').pop().args.join('|') === 'n1|profile' && !closed(t));
  check('...and the page says it is turning meanwhile', /Turning to the page/.test(texts(t).join('|')), texts(t));
  t.push(hub('world', { world: { groups: [{ name: 'Who is about', command: 'players', lines: ['Olaf', 'Gemma'] }] } }));
  check('World: a group per command, its lines under it', texts(t).join('|') === 'The world|Read when this page opened. Turn to another tab and back to read it again.|Who is about|Olaf|Gemma', texts(t).join('|'));
  t.push(hub('stats', { result: 'Saved.', resultKind: 'ok' }));
  check('a section already received is drawn from the cache while the next is on its way', /Kills/.test(texts(t).join('|')) && P(t).foot.result.text === 'Saved.');
  t.press(82);
  check('R turns to the next tab', msgs(t, 'dbo:journalTab').pop().args[1] === 'wanted');
  t.press(81); t.press(81);
  check('Q twice goes back two', msgs(t, 'dbo:journalTab').pop().args[1] === 'profile');
  t.press(27);
  check('Escape sends journalClose with the nonce and closes', msgs(t, 'dbo:journalClose').pop().args[0] === 'n1' && closed(t));
}

{
  const t = S.boot('dbo_journal');
  const mine = [{ zone: 'bruma', name: 'Bruma', amount: 40, reason: 'assault', here: true }, { zone: 'cheydinhal', name: 'Cheydinhal', amount: 15, reason: 'theft', here: false }];
  const wanted = [{ pid: 7, name: 'Bram', amount: 200, reason: 'murder', by: 'Jarl Narri', at: 1790000000000 }];
  t.push(hub('wanted', { wanted: { hold: { id: 'bruma', name: 'Bruma' }, mine, wanted, canDeclare: true, max: 5000, goldPerMinute: 10 } }));
  const tx = texts(t).join('|');
  check('Wanted: your bounties, the one payable here with Pay', /Your bounties\|Bruma: 40 gold/.test(tx) && btn(t, 'Pay') && /pay it standing in Cheydinhal/.test(tx), tx);
  check('the hold list with who set it and when', /Wanted in Bruma\|Bram   200 gold\|murder  -  set by Jarl Narri, \w{3} \d+ \w{3}, \d+:\d\d/.test(tx), tx);
  btn(t, 'Pay').onRelease();
  check('Pay asks first, in place of the tab', /Pay your bounty of 40 gold to Bruma\?/.test(texts(t).join('|')) && btn(t, 'Pay') && btn(t, 'No') && msgs(t, 'dbo:outlawJ').length === 0, texts(t));
  btn(t, 'No').onRelease();
  check('No goes back to the tab, nothing sent', /Your bounties/.test(texts(t).join('|')) && msgs(t, 'dbo:outlawJ').length === 0);
  btn(t, 'Clear').onRelease();
  check('Clear asks too, in red', /Lift the bounty on Bram\?/.test(texts(t).join('|')) && btn(t, 'Clear').label.textColor === 0xB23A3A);
  btn(t, 'Clear').onRelease();
  const c = msgs(t, 'dbo:outlawJ');
  check('Yes sends outlawJ with the nonce, the action and the player', c.length === 1 && c[0].args.join('|') === 'n1|clear|7', c);
  check('the footer shows the answer is on its way', P(t).foot.result.text === '...');
  btn(t, 'Pay').onRelease(); btn(t, 'Pay') && btn(t, 'Pay').onRelease();
  check('while busy a second action is not sent', msgs(t, 'dbo:outlawJ').length === 1);
  t.push(hub('wanted', { nonce: 'n2', result: 'The bounty on Bram is lifted.', resultKind: 'ok', wanted: { hold: { id: 'bruma', name: 'Bruma' }, mine, wanted: [], canDeclare: true, max: 5000, goldPerMinute: 10 } }));
  check('a new nonce ends busy; the answer is in the footer and the list redraws', P(t).foot.result.text === 'The bounty on Bram is lifted.' && /Nobody is wanted here/.test(texts(t).join('|')));
  btn(t, 'Set a bounty...').onRelease();
  const h = msgs(t, 'dbo:journalTab').pop();
  check('Set a bounty hands this tab to the browser journal', h.args[0] === 'n2' && h.args[1] === 'wanted' && h.args[2] === null && h.args[3] === 'browser', h);
  t.push(hub('wanted', { nonce: 'n3', result: 'No such hold.', resultKind: 'refused' }));
  check('a refusal shows red', P(t).foot.result.textColor === 0xB23A3A);
  const r = S.boot('dbo_journal');
  r.push(hub('wanted', { readOnly: 1, wanted: { hold: { id: 'bruma', name: 'Bruma' }, mine: [], wanted, canDeclare: true, max: 5000, goldPerMinute: 10 } }));
  btn(r, 'Clear').onRelease(); btn(r, 'Clear') && btn(r, 'Clear').onRelease();
  check("read-only (staff reading another's journal): nothing is sent, the footer says whose it is", msgs(r, 'dbo:outlawJ').length === 0 && /reading Olaf's journal/.test(P(r).foot.hint.text));
}

{
  const t = S.boot('dbo_journal');
  const groups = Array.from({ length: 6 }, (_, g) => ({ name: `Group ${g}`, rows: Array.from({ length: 6 }, (_, i) => ({ label: `Row ${g}.${i}`, value: String(i) })) }));
  t.push(hub('stats', { stats: { groups } }));
  check('a long tab is split into pages', pages(t).length > 1 && P(t).foot.page.text === `Page 1 of ${pages(t).length}`, pages(t).length);
  check('no block runs past the body', pages(t).every((p) => Object.keys(p.kids).every((k) => (p.kids[k]._y || 0) + (p.kids[k]._height || 0) <= 410)), pages(t).map((p) => Object.keys(p.kids).map((k) => (p.kids[k]._y || 0) + (p.kids[k]._height || 0))));
  check('Previous is greyed on the first page', P(t).foot.prev.disabled === true && !P(t).foot.next.disabled);
  const first = texts(t)[0];
  P(t).foot.next.onRelease();
  check('Next page shows the next one', texts(t)[0] !== first && P(t).foot.page.text.indexOf('Page 2') === 0);
  t.wheel(1);
  check('the wheel turns back', P(t).foot.page.text.indexOf('Page 1') === 0);
  t.press(34);
  check('so does Page Down forward', P(t).foot.page.text.indexOf('Page 2') === 0);
  t.push(hub('stats', { stats: { groups }, result: 'x' }));
  check('a redraw of the same tab keeps its page', P(t).foot.page.text.indexOf('Page 2') === 0);
  t.push(hub('stats', { stats: { groups }, opened: 2 }));
  check('a new opening starts at the first page with a fresh cache', P(t).foot.page.text.indexOf('Page 1') === 0);
}

{
  const t = S.boot('dbo_journal', true);
  t.tick(); t.st.time += 8000; t.tick();
  check('without skse nothing is sent', t.sent.length === 0);
  t.arrive(); t.tick();
  check('once skse appears: ready, then the self-close for the missing payload', t.msgs()[0].key === 'ready' && closed(t));
  const u = S.boot('dbo_journal');
  u.push({ type: 'journal', nonce: 'x', tab: 'profile' });
  check('a journal without the hub is not drawn', u.logs.some((l) => l.indexOf('unreadable payload') >= 0) && !P(u).body);
  const b = S.boot('dbo_journal');
  b.push(hub('stats', { stats: null }));
  check('a section the server could not build says so', /cannot be shown just now/.test(texts(b).join('|')));
}

// ---- Keys ----
{
  const t = S.boot('dbo_journal');
  const keys = { offer: { from: 'Gemma', key: 'Rose Hall key' }, near: [{ actor: 0xff01, name: 'Gemma' }, { actor: 0xff02, name: 'Bram' }],
    keys: [{ name: 'Rose Hall key', place: 'Rose Hall', opens: true }, { name: 'Old key', place: '', opens: false }],
    owned: [{ ref: 0x5000, place: 'Rose Hall', copies: [{ name: 'Rose Hall key 2', holder: 'Bram' }] }] };
  t.push(hub('keys', { tabs: TABS.concat([{ id: 'keys', label: 'Keys' }]), keys }));
  const tx = texts(t).join('|');
  check('Keys: the offer, your keys by place, your locks with the copies out', /Gemma offers you Rose Hall key\./.test(tx) && /Rose Hall\|    Rose Hall key   Opens/.test(tx) && /Other keys\|    Old key   Opens nothing/.test(tx) && /Held by Bram/.test(tx), tx);
  btn(t, 'Accept').onRelease();
  check('Accept answers the offer', msgs(t, 'dbo:keyRingAnswer').pop().args.join('|') === 'n1|true');
  t.push(hub('keys', { nonce: 'n2', tabs: TABS.concat([{ id: 'keys', label: 'Keys' }]), keys }));
  buttonsOf(t).filter((b) => b.label.text === 'Give')[0].onRelease();
  check('Give lists the players beside you', btn(t, 'Gemma') && btn(t, 'Bram') && btn(t, 'Cancel'));
  btn(t, 'Bram').onRelease();
  check('picking one gives that key to them', msgs(t, 'dbo:keyRingGive').pop().args.join('|') === `n2|Rose Hall key|${0xff02}`);
  t.push(hub('keys', { nonce: 'n3', tabs: TABS.concat([{ id: 'keys', label: 'Keys' }]), keys }));
  btn(t, 'Cut for...').onRelease(); btn(t, 'Gemma').onRelease();
  check('Cut for... cuts one for the player picked', msgs(t, 'dbo:keyRingCut').pop().args.join('|') === `n3|${0x5000}|${0xff01}`);
  t.push(hub('keys', { nonce: 'n4', tabs: TABS.concat([{ id: 'keys', label: 'Keys' }]), keys }));
  btn(t, 'Take back').onRelease();
  check('Take back names the lock and the copy', msgs(t, 'dbo:keyRingTake').pop().args.join('|') === `n4|${0x5000}|Rose Hall key 2`);
}

// ---- Deity ----
{
  const god = (id, name, kind, extra) => Object.assign({ id, name, kind, sphere: 'of ' + name, boon: name + "'s boon", reachable: true, inBruma: 1, prayAnywhere: false, lawful: true, unlawfulWhere: '', aspectOf: '', alsoKnownAs: [] }, extra || {});
  const choices = [god('akatosh', 'Akatosh', 'divine'), god('mara', 'Mara', 'divine'), god('aurielfaith', 'Auri-El', 'divine', { aspectOf: 'akatosh' }), god('boethiah', 'Boethiah', 'daedra', { lawful: false, unlawfulWhere: 'Proscribed in Cyrodiil.', reachable: false })];
  const faiths = [{ id: 'nine', name: 'The Nine', patrons: ['akatosh', 'mara'], suggested: false }, { id: 'aldmeri', name: 'The Aldmeri Pantheon', patrons: ['aurielfaith'], suggested: true }];
  const t = S.boot('dbo_journal');
  const T2 = TABS.concat([{ id: 'deity', label: 'Deity' }]);
  t.push(hub('deity', { tabs: T2, deity: { current: 'mara', faith: 'nine', patronDaysLeft: 0, patronChangeDays: 2, faiths, first: false, daysLeft: 3, cooldownDays: 7, canChoose: true, choices } }));
  let tx = texts(t).join('|');
  check('Deity: the faiths, the one of your people first, yours open onto its patrons', /The faiths\|The Aldmeri Pantheon   of your people\|The Nine   your faith\|Akatosh\|Mara   your god/.test(tx), tx);
  check('the page is your god: name, sphere, boon, shrines, the law, and that it is yours', /Mara\|of Mara\|Boon\|Mara's boon\|Shrines\|1 shrine in Bruma\. Any shrine of The Nine hears you/.test(tx) && /Mara is your god\./.test(tx) && /You follow Mara, in The Nine\. Another faith in 3 days\./.test(tx), tx);
  btnStarting(t, 'Akatosh').onRelease();
  check('another patron in your faith: Turn to it', btn(t, 'Turn to Akatosh') && !btn(t, 'Turn to Akatosh').disabled);
  btn(t, 'Turn to Akatosh').onRelease();
  tx = texts(t).join('|');
  check('it asks first, with how long the new god is kept', /Turn from Mara to Akatosh within The Nine\? You keep a new god at least 2 days\./.test(tx) && btn(t, 'Not yet'), tx);
  check('nothing is sent yet', msgs(t, 'journalDeity').length === 0 && msgs(t, 'dbo:journalDeity').length === 0);
  btn(t, 'Turn to Akatosh').onRelease();
  check('the second press sends journalDeity with the god and the faith', msgs(t, 'dbo:journalDeity').pop().args.join('|') === 'n1|akatosh|nine', t.msgs().map((m) => m.key));
  t.push(hub('deity', { nonce: 'n2', tabs: T2, deity: { current: 'mara', faith: 'nine', patronDaysLeft: 0, patronChangeDays: 2, faiths, first: false, daysLeft: 3, cooldownDays: 7, canChoose: true, choices } }));
  btnStarting(t, 'The Aldmeri Pantheon').onRelease();
  tx = texts(t).join('|');
  check('opening another faith shows its patron, an aspect named as such', /Auri-El \(an aspect of Akatosh\)/.test(tx) && /An aspect of Akatosh/.test(tx), tx);
  check('another faith while the faith wait runs: greyed, with the days', btn(t, 'Turn to Auri-El').disabled === true && /You may turn again in 3 days/.test(tx), tx);
  const g = S.boot('dbo_journal');
  g.push(hub('deity', { tabs: T2, deity: { current: '', first: true, daysLeft: 0, cooldownDays: 7, canChoose: true, choices } }));
  tx = texts(g).join('|');
  check('without faiths: the gods by kind, an aspect under its god', /The gods\|The Divines\|Akatosh\|Auri-El \(the Aldmeri Akatosh\)\|Mara\|The Daedric Princes\|Boethiah   Unlawful  -  no shrine within reach/.test(tx), tx);
  check('a first choice is free', /Your first choice is free and needs no shrine\./.test(tx) && btn(g, 'Take Akatosh'));
  btnStarting(g, 'Boethiah').onRelease();
  check('an unlawful god says where, in red', texts(g).includes('Proscribed in Cyrodiil.'));
}

// ---- Magic ----
{
  const V = require('./native-journal-magic.json');
  const T3 = TABS.concat([{ id: 'magic', label: 'Magic' }]);
  const t = S.boot('dbo_journal');
  t.push(hub('magic', { tabs: T3, magic: V.mage }));
  let tx = texts(t).join('|');
  check('Magic opens on Schools at the primary school', /Destruction 40/.test(tx) && /Destruction\|The Art of Ruin/.test(tx) && /What your rank allows/.test(tx), tx);
  check('the school chips: the closed ones without a level', btn(t, 'Illusion') && btn(t, 'Destruction 40')._alpha === 100);
  check('the next tomes, with where to get them', /Next tomes for you/.test(tx), tx);
  btn(t, 'Spell book').onRelease();
  tx = texts(t).join('|');
  check('Spell book: prepared of max, Put away where you may prepare', /Prepared \(1 \/ 3\)/.test(tx) && btn(t, 'Put away') && /Known spells/.test(tx), tx);
  btn(t, 'Put away').onRelease();
  const pa = msgs(t, 'dbo:journalMagic').pop();
  check('Put away sends unprepare with the spell', pa.args[0] === 'n1' && pa.args[1] === 'unprepare' && pa.args[2] === V.mage.book.prepared[0].id, pa);
  btn(t, 'Master').onRelease();
  check('a rank chip with nothing in it says so', /No Master spell is known\./.test(texts(t).join('|')));
  const open = JSON.parse(JSON.stringify(V.mage));
  open.schools[0].firstSpell = { state: 'open', stage: 'Apprentice', at: 50, held: true, choices: [{ id: 'aa:Skyrim.esm', name: 'Firebolt', blurb: 'a bolt of fire', line: 'fire' }, { id: 'bb:Skyrim.esm', name: 'Ice Spike', blurb: 'a spike of ice' }] }; // verify-formids: ignore
  open.apprenticeship = { apprentice: { teacher: 'Gemma', spell: 'Flames', school: 'Destruction', rank: 'Novice', xp: 4, need: 10, today: 1, dailyXp: 3, near: false, canLeave: true }, apprentices: [{ id: 'p9', name: 'Bram', spell: 'Sparks' }], max: 2 };
  const o = S.boot('dbo_journal');
  o.push(hub('magic', { tabs: T3, magic: open }));
  tx = texts(o).join('|');
  check('a pick waiting: its heading, the line spell first, and that study is held', /Choose your Apprentice spell/.test(tx) && /The first follow a spell you know/.test(tx) && /goes no further until you choose/.test(tx), tx);
  check('the choices run over onto the next page', buttonsOf(o).filter((b) => b.label.text === 'Choose').length === 1 && !o.root.dboPanel.foot.next.disabled);
  o.root.dboPanel.foot.next.onRelease();
  buttonsOf(o).filter((b) => b.label.text === 'Choose')[0].onRelease();
  btn(o, 'Learn').onRelease();
  check('Choose, then Learn, sends firstSpell with the school and the spell', msgs(o, 'dbo:journalMagic').pop().args.join('|') === 'n1|firstSpell|Destruction|bb:Skyrim.esm'); // verify-formids: ignore
  o.push(hub('magic', { nonce: 'n2', tabs: T3, magic: open }));
  const all = () => { const out = []; for (let i = 0; i < 4; i++) { out.push(...texts(o)); if (!o.root.dboPanel.foot.next || o.root.dboPanel.foot.next.disabled) break; o.root.dboPanel.foot.next.onRelease(); } return out.join('|'); };
  tx = all();
  check('the apprenticeship and your apprentices are listed', /Apprentice of Gemma in Flames \(Novice Destruction\): 4 of 10 studied, 1 of 3 today\./.test(tx) && /Your apprentices \(1 of 2\):/.test(tx), tx);
  btn(o, 'Release').onRelease();
  check('Release asks first', /Release Bram\?/.test(texts(o).join('|')));
  btn(o, 'Release Bram').onRelease();
  check('then sends apprenticeRelease with the apprentice', msgs(o, 'dbo:journalMagic').pop().args.join('|') === 'n2|apprenticeRelease|p9');
  const c = S.boot('dbo_journal');
  c.push(hub('magic', { tabs: T3, magic: { v: 1, open: false, note: 'Magic opens with Arcane Arts.' } }));
  check('a closed Magic says why', texts(c).join('|') === 'Magic opens with Arcane Arts.');
}

// ---- Skills ----
{
  const T4 = TABS.concat([{ id: 'skills', label: 'Skills' }, { id: 'magic', label: 'Magic' }]);
  const sk = (id, category, label, extra) => Object.assign({ id, category, label, title: 'the ' + label, description: label + ' rule.', tiers: ['t0', 't1', 't2', 't3', 't4'], lore: label + ' lore.', tierLore: ['l0', '', '', '', ''] }, extra || {});
  const points = { enabled: true, pool: 30, used: 12, capPerSkill: 100, seatAbove: 90, seatCount: 1, expertAbove: 75, expertCount: 3, transferFloor: 25, waningFloor: 10,
    held: [{ id: 'oneHanded', level: 60, xp: 40, tier: 2, lock: 'raise' }, { id: 'arcane', level: 30, xp: 10, tier: 1, lock: 'hold' }], offers: [{ id: 'archery', banked: 3 }] };
  const skills = { points, tierNames: ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master'], skills: [sk('oneHanded', 'combat', 'One-Handed'), sk('archery', 'combat', 'Archery'), sk('arcane', 'support', 'Arcane Arts'), sk('smithing', 'profession', 'Smithing', { openable: 'station', hint: 'an anvil' })],
    chosen: [], magicSchools: { castCap: 20, chosen: true, firstAt: 25, schools: [{ name: 'Destruction', role: 'primary', level: 40, castToday: 20 }, { name: 'Illusion', role: 'closed', level: 0, castToday: 0 }] } };
  const t = S.boot('dbo_journal');
  t.push(hub('skills', { tabs: T4, skills }));
  let tx = texts(t).join('|');
  check('it opens on the first held skill: its page, level of ceiling, the three moons with its own bright', /One-Handed, the One-Handed\|One-Handed lore\.\|One-Handed rule\.\|60 of 100   Adept/.test(tx) && btn(t, 'Raise')._alpha === 100 && btn(t, 'Hold')._alpha < 100, tx);
  btn(t, 'Lower').onRelease();
  check('a moon sends journalSkill lock with the skill and the mode', msgs(t, 'dbo:journalSkill').pop().args.join('|') === 'n1|lock|oneHanded|lower');
  t.push(hub('skills', { nonce: 'n2', tabs: T4, skills }));
  btn(t, 'All skills').onRelease();
  tx = texts(t).join('|');
  check('All skills: the spokes of the Wheel, the groups with their skills as chips', /12 \/ 30 spokes of the Wheel\|Combat/.test(tx) && btn(t, 'One-Handed 60') && btn(t, 'Arcane Arts 30 hold') && btn(t, 'Archery'), tx);
  btn(t, 'Archery').onRelease();
  tx = texts(t).join('|');
  check('an offered skill: the banked work and Take up', /3 unit\(s\) of work already stand to your name\./.test(tx) && btn(t, 'Take up Archery - one spoke'), tx);
  btn(t, 'Take up Archery - one spoke').onRelease();
  check('Take up sends takeUp', msgs(t, 'dbo:journalSkill').pop().args.join('|') === 'n2|takeUp|archery');
  t.push(hub('skills', { nonce: 'n3', tabs: T4, skills }));
  btn(t, 'All skills').onRelease();
  btn(t, 'Arcane Arts 30 hold').onRelease();
  const all = () => { const out = []; for (let i = 0; i < 4; i++) { out.push(...texts(t)); if (!t.root.dboPanel.foot.next || t.root.dboPanel.foot.next.disabled) break; t.root.dboPanel.foot.next.onRelease(); } return out.join('|'); };
  tx = all();
  check('Arcane Arts: the schools with today\'s casting, and the way to Magic', /Destruction\|Primary  -  40   Casting limit reached today/.test(tx) && /Your schools of magic are on the Magic tab\./.test(tx), tx);
  check('a held skill says so', /Held: it neither rises nor falls\./.test(tx));
  check('the five tiers with their lore and where each begins', /Novice\|l0  t0   the first spoke/.test(tx) && /Adept\|t2   level 50/.test(tx), tx);
  t.push(hub('skills', { nonce: 'n4', tabs: T4, skills: Object.assign({}, skills, { focus: 'smithing' }) }));
  tx = texts(t).join('|');
  check('a focus from elsewhere (Profile\'s meters) opens that skill; an untaken one names its station', /Untaken\. Set your hand to an anvil and the first spoke is yours\./.test(tx), tx);
}

T.done();
