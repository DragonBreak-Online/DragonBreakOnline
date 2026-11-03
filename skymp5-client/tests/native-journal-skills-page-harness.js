// The native Skills tab's progress bar and its paged pages (swf/dbo_journal tabs/skills.as; live, 3 Nov): each held skill
// shows its progress to the next level from points.held[].xp, and a paged payload (journalskills.js) without Blacksmithing's
// recipes asks the server for that page when the player opens it, instead of drawing it empty.
//   node tests/native-journal-skills-page-harness.js
'use strict';
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;

const TABS = [{ id: 'profile', label: 'Profile' }, { id: 'skills', label: 'Skills' }];
const hub = (skills) => ({ type: 'journal', id: 50, nonce: 'n1', hub: 1, tabs: TABS, tab: 'skills', opened: 1, clock: { date: 'd', time: 't' }, head: { name: 'Olaf', title: 'J', race: 'Nord' }, skills });
const P = (t) => t.root.dboPanel;
const texts = (t) => { const out = []; const walk = (c) => { for (const x of Object.values(c.kids || {})) { if (typeof x.text === 'string') out.push(x.text); if (x.kids) walk(x); } }; walk(P(t).body); return out.join('|'); };
const findSkillButton = (t, id) => { let hit = null; const walk = (c) => { for (const x of Object.values(c.kids || {})) { if (x.skill === id && typeof x.onRelease === 'function') hit = hit || x; if (x.kids) walk(x); } }; walk(P(t).body); return hit; };
const textIn = (c) => { let out = typeof c.text === 'string' ? c.text : ''; for (const x of Object.values(c.kids || {})) out += '|' + textIn(x); return out; };
const allSkills = (t) => { let hit = null; const walk = (c) => { for (const x of Object.values(c.kids || {})) { if (!hit && typeof x.onRelease === 'function' && /All skills/.test(textIn(x))) hit = x; if (x.kids) walk(x); } }; walk(P(t).body); if (hit) hit.onRelease(); return !!hit; };
const sk = (id, label) => ({ id, category: 'profession', label, title: 'the ' + label, description: label + ' rule.', tiers: ['t0', 't1', 't2', 't3', 't4'], lore: '', tierLore: [] });
const points = (held) => ({ enabled: true, pool: 600, capPerSkill: 100, seatAbove: 75, seatCount: 2, expertAbove: 50, expertCount: 3, used: 40, offers: [], held });
const skills = (held, extra) => Object.assign({ tierNames: ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master'], skills: [sk('fighter', 'Fighting'), sk('blacksmith', 'Blacksmithing')], chosen: [], points: points(held) }, extra || {});

{
  const t = S.boot('dbo_journal');
  t.push(hub(skills([{ id: 'fighter', level: 40, xp: 37, tier: 1, lock: 'raise' }])));
  const tx = texts(t);
  check('a held skill shows its progress to the next level', /37% to the next level/.test(tx), tx.slice(0, 300));
}

{
  const t = S.boot('dbo_journal');
  t.push(hub(skills([{ id: 'fighter', level: 100, xp: 50, tier: 4, lock: 'raise' }])));
  check('...but not at its ceiling', !/to the next level/.test(texts(t)));
}

{
  const t = S.boot('dbo_journal');
  t.push(hub(skills([{ id: 'fighter', level: 40, xp: 37, tier: 1, lock: 'raise' }], { paged: true })));
  const before = t.msgs().length;
  allSkills(t);
  const b = findSkillButton(t, 'blacksmith');
  check('the skill list has a Blacksmithing button', !!b);
  if (b) b.onRelease();
  const asked = t.msgs().slice(before).filter((m) => m.key === 'dbo:journalTab');
  check('a paged payload without the recipes: opening Blacksmithing asks the server for that page', asked.length === 1 && asked[0].args[1] === 'skills' && asked[0].args[2] && asked[0].args[2].skill === 'blacksmith', asked);
}

{
  const t = S.boot('dbo_journal');
  t.push(hub(skills([{ id: 'fighter', level: 40, xp: 37, tier: 1, lock: 'raise' }])));
  const before = t.msgs().length;
  allSkills(t);
  const b = findSkillButton(t, 'blacksmith');
  if (b) b.onRelease();
  check('a whole payload (not paged): Blacksmithing opens here, nothing asked', !t.msgs().slice(before).some((m) => m.key === 'dbo:journalTab'), t.msgs().slice(before));
}

T.done();
