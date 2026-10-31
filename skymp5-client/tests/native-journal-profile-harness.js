// The Character Journal's Profile tab drawn natively (swf/dbo_journal tabs/profile.as), against the browser's ProfileTab: the
// facts, the title, the story written in a form (an unsaved page kept for later), the most proficient skills, the status,
// the racial powers and their clocks, and the Help actions, each sending the browser's own action with the journal nonce.
//   node tests/native-journal-profile-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const held = (t) => t.sent.reduce((n, m) => n + (m.e === 'allowTextInput' ? (m.on ? 1 : -1) : 0), 0);

const TABS = [{ id: 'profile', label: 'Profile' }, { id: 'skills', label: 'Skills' }];
const hub = (profile, extra) => Object.assign({ type: 'journal', id: 50, nonce: 'n1', hub: 1, tabs: TABS, tab: 'profile', opened: 1, clock: { date: 'd', time: 't' }, head: { name: 'Olaf', title: 'J', race: 'N' }, profile }, extra || {});
const msgs = (t, key) => t.msgs().filter((m) => m.key === key);
const last = (t, key) => msgs(t, key).slice(-1)[0];
const P = (t) => t.root.dboPanel;
const shownPage = (t) => Object.values(P(t).body.flowClip.kids).find((p) => p._visible);
const texts = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids)) { if (typeof x.text === 'string' && !x.kids) out.push(x.text); else if (x.kids) walk(x); } }; walk(shownPage(t)); return out.join('|'); };
const buttonsOf = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids)) { if (x.kids && x.label && x.onPick) out.push(x); else if (x.kids) walk(x); } }; walk(shownPage(t)); return out; };
const btn = (t, label) => buttonsOf(t).find((b) => b.label.text === label);
const first = (t) => { for (let i = 0; i < 6; i++) t.press(33); };
const seek = (t, label, test) => { const ok = (b) => (test ? test(b) : b.label.text === label); let b = buttonsOf(t).find(ok); if (b) return b; first(t); for (let i = 0; i < 8 && !(b = buttonsOf(t).find(ok)); i++) { const n = P(t).foot.next; if (!n || n.disabled) break; n.onRelease(); } return b; };
const press = (t, label) => { const b = seek(t, label); if (!b) throw new Error('no button ' + label + ' among ' + buttonsOf(t).map((x) => x.label.text).join('|')); b.onRelease(); };
const everyPage = (t) => { first(t); const out = []; for (let i = 0; i < 8; i++) { out.push(texts(t)); const n = P(t).foot.next; if (!n || n.disabled) break; n.onRelease(); } return out.join('|'); };
const boxOf = (t) => { let f = null; const walk = (c) => { for (const k of Object.values(c.kids || {})) { if (k.type === 'input') f = k; if (k.kids) walk(k); } }; walk(shownPage(t)); return f; };
const field = (t, label) => seek(t, null, (b) => b.label.text === 'Type...' && b._parent.label && b._parent.label.text.indexOf(label) === 0);
// every page's texts as they stand, without turning (a turn would redraw)
const asDrawn = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids)) { if (typeof x.text === 'string' && !x.kids) out.push(x.text); else if (x.kids) walk(x); } }; walk(P(t).body.flowClip); return out.join('|'); };
const vm = require('vm');
const typeOn = (t, label, text) => { const r = field(t, label); if (!r) throw new Error('no field ' + label); r.onRelease(); boxOf(t).text = text; if (boxOf(t).multiline) press(t, 'Done'); else t.press(13); };

const profile = {
  name: 'Olaf', race: 'Nord', playtime: '12 h', created: '3 Oct 2026', joined: '1 Oct 2026', backstory: 'A smith from Bruma.', origin: '', backstoryMax: 4000, originMax: 1000,
  skills: [{ id: 'smithing', name: 'Smithing', level: 42, tier: 2, tierName: 'Adept', epithet: 'of the Forge' }, { id: 'archery', name: 'Archery', level: 20, tier: 1, tierName: 'Apprentice', epithet: '' },
    { id: 'sneak', name: 'Sneak', level: 5, tier: 0, tierName: 'Novice', epithet: '' }, { id: 'alchemy', name: 'Alchemy', level: 1, tier: 0, tierName: 'Novice', epithet: '' }],
  status: [{ label: 'Hunger', value: 'Peckish', hint: 'eat soon' }], canReroll: true, levelPoints: 2,
  racialPower: { name: 'Battle Cry', seconds: 30, ready: true, key: 'battlecry', buffs: { meleeDamage: 0.1, damageTaken: 0.05, staminaRegen: 2 },
    others: [{ name: 'Nordic Frost', seconds: 60, key: 'frost', waitMs: 2 * 3600000, effect: 'cold cannot touch you', cooldownHours: 6 }] },
  title: 'Wanderer', titleEpithet: 'who came in the snow', titleId: 'wanderer', titles: [{ id: 'wanderer', label: 'Wanderer' }, { id: 'smith', label: 'Smith of Bruma' }],
};

{
  const t = S.boot('dbo_journal');
  t.push(hub(profile));
  const tx = everyPage(t);
  check('Profile: the facts, the title among those earned, its epithet', /Race\|Nord/.test(tx) && /Time in Tamriel\|12 h/.test(tx) && /Character made\|3 Oct 2026/.test(tx) && /First arrived\|1 Oct 2026/.test(tx) && /who came in the snow/.test(tx), tx);
  check('...the story, an empty origin asking for one', /Backstory\|A smith from Bruma\./.test(tx) && /Where you were born, your family/.test(tx));
  check('...the three most proficient skills only', /1\.  Smithing   42\|Adept  -  of the Forge/.test(tx) && /3\.  Sneak   5/.test(tx) && !/Alchemy/.test(tx), tx);
  check('...status, powers, Help', /Hunger\|Peckish   eat soon/.test(tx) && /Racial Powers/.test(tx) && /Help/.test(tx));
  check('no browser hand-off anywhere', !msgs(t, 'dbo:journalTab').length);
  press(t, 'Smith of Bruma');
  check('a title picked sends journalTitle', last(t, 'dbo:journalTitle').args.join('|') === 'n1|smith');
  t.push(hub(profile, { nonce: 'n2' }));
  seek(t, 'Open').onRelease();
  check('a skill\'s Open turns to its page in Skills', last(t, 'dbo:journalTab').args[1] === 'skills' && last(t, 'dbo:journalTab').args[2].skill === 'smithing');
}

// ---- writing the story ----
{
  const t = S.boot('dbo_journal');
  t.push(hub(profile));
  press(t, 'Write');
  check('Write opens the story with what is saved, Save greyed until it changes', /Your story/.test(texts(t)) && /A smith from Bruma\./.test(everyPage(t)) && seek(t, 'Save').disabled === true);
  field(t, 'Backstory').onRelease();
  check('the backstory is a page of several lines, holding the server\'s most, with its count', boxOf(t).multiline === true && boxOf(t).maxChars === 4000 && /Backstory  \(19 \/ 4000\)/.test(texts(t)) && held(t) === 1);
  boxOf(t).text = 'A smith from Bruma.\rNow a soldier.'; press(t, 'Done');
  typeOn(t, 'Origin', 'Born in Pale Pass.');
  press(t, 'Save');
  check('Save sends journalProfile with both, the line kept', last(t, 'dbo:journalProfile').args.join('|') === 'n1|A smith from Bruma.\nNow a soldier.|Born in Pale Pass.');
  t.push(hub(profile, { nonce: 'n2' }));
  press(t, 'Write');
  typeOn(t, 'Origin', 'Half written');
  t.press(27);
  check('Escape sets the page aside: it says so, and Write comes back to it', /An unsaved page is waiting\./.test(everyPage(t)) && !!seek(t, 'Go back to the page'));
  t.push(hub(Object.assign({}, profile, { name: 'Gemma' }), { nonce: 'n2c' }));
  check('another character\'s profile does not show this page as waiting', !/An unsaved page is waiting\./.test(everyPage(t)) && !!seek(t, 'Write'));
  t.push(hub(profile, { nonce: 'n2d' }));
  press(t, 'Go back to the page');
  check('...with what was typed', /Half written/.test(everyPage(t)));
  press(t, 'Discard');
  check('Discard throws it away', !/An unsaved page is waiting\./.test(everyPage(t)) && !!seek(t, 'Write'));
  const r = S.boot('dbo_journal');
  r.push(hub(profile, { readOnly: 1, subject: 'ff1' }));
  check('reading another\'s journal offers no Write', !seek(r, 'Write') && !seek(r, 'Go back to the page'));
}

// ---- powers and Help ----
{
  const t = S.boot('dbo_journal');
  t.push(hub(profile));
  let tx = everyPage(t);
  check('a power: what it does, for how long, how often', /Battle Cry\|\+10% melee damage, -5% damage taken, stamina regenerates x2, for 30 seconds\. Once a day\./.test(tx), tx);
  check('another on its wait, its effect and its own wait', /Nordic Frost\|Cold cannot touch you, for 60 seconds\. Again 6 h after each use\.\|Returns in 2 h/.test(tx), tx);
  press(t, 'Call on Battle Cry');
  check('Call on sends racialPower with the power\'s key', last(t, 'dbo:journalAction').args.join('|') === 'n1|racialPower|battlecry');
  const on = JSON.parse(JSON.stringify(profile)); on.racialPower.activeMs = 12000; on.racialPower.others = [];
  t.push(hub(on, { nonce: 'n2' }));
  check('upon you: the seconds left', /Upon you: 12 s/.test(everyPage(t)));
  t.st.time += 3000; t.tick();
  check('...counting down by themselves', /Upon you: 9 s/.test(asDrawn(t)), asDrawn(t));
  t.push(hub(on, { nonce: 'n2b', tab: 'skills', skills: { held: [], skills: [] } }));
  check('another tab stops the clock', vm.runInContext('tabTick', t.ctx) === null);
  t.push(hub(profile, { nonce: 'n3' }));
  press(t, '+1 Magicka');
  check('a level point spent sends level:magicka', last(t, 'dbo:journalAction').args.join('|') === 'n3|level:magicka');
  t.push(hub(profile, { nonce: 'n4' }));
  press(t, 'Call a GM...');
  typeOn(t, 'What to say', 'hi');
  check('a GM call needs three letters', seek(t, 'Send').disabled === true);
  typeOn(t, 'What to say', 'I am stuck');
  press(t, 'Send');
  check('...and sends gm with the text', last(t, 'dbo:journalAction').args.join('|') === 'n4|gm|I am stuck');
  t.push(hub(profile, { nonce: 'n5' }));
  press(t, 'Report...');
  typeOn(t, 'What to say', 'four');
  check('a report needs five', seek(t, 'Send').disabled === true);
  typeOn(t, 'What to say', 'wolf floats');
  press(t, 'Send');
  check('...and sends report', last(t, 'dbo:journalAction').args.join('|') === 'n5|report|wolf floats');
  t.push(hub(profile, { nonce: 'n6' }));
  press(t, 'Unstuck');
  check('Unstuck asks first', /Move to the respawn point\?/.test(texts(t)) && !msgs(t, 'dbo:journalAction').some((m) => m.args[1] === 'unstuck'));
  press(t, 'Move me');
  check('...then sends unstuck', last(t, 'dbo:journalAction').args.join('|') === 'n6|unstuck');
  t.push(hub(profile, { nonce: 'n7' }));
  press(t, 'Reroll');
  check('Reroll asks first', /Spend a reroll now\?/.test(texts(t)));
  press(t, 'Reroll');
  check('...then sends reroll', last(t, 'dbo:journalAction').args.join('|') === 'n7|reroll');
  t.push(hub(profile, { nonce: 'n8' }));
  press(t, 'Open a ticket with staff');
  check('a ticket opens the player menu at Trouble', last(t, 'dbo:menuOpen').args.join('|') === 'trouble');
  press(t, 'Every command (U)');
  check('...and every command at everything', last(t, 'dbo:menuOpen').args.join('|') === '');
  const plain = Object.assign({}, profile, { canReroll: false, levelPoints: 0, racialPower: null, titles: [{ id: 'wanderer', label: 'Wanderer' }] });
  t.push(hub(plain, { nonce: 'n9' }));
  tx = everyPage(t);
  check('no points, no reroll, no power, one title: none of them shown, the title as text', !seek(t, '+1 Health') && !seek(t, 'Reroll') && !/Racial Power/.test(tx) && !seek(t, 'Wanderer') && /Known as\|Wanderer/.test(tx), tx);
  const old = Object.assign({}, profile, { status: undefined, skills: [] });
  t.push(hub(old, { nonce: 'n10' }));
  check('an older server without status: no Status and no Help; no skills says so', !/Help/.test(everyPage(t)) && /No skill has been taken up yet\./.test(everyPage(t)));
}

T.done();
