// Runs the native admin panel (swf/dbo_admin) on the stub stage against the real view builder (adminNativeView.ts): every
// admin::ui the panel sends is answered with the view adminMenuService would build, so the panel and the service's paging
// are tested together, and every other key is recorded as the browser panel would have sent it.
//   node tests/native-admin-harness.js [path to a compiled adminNativeView.js]
'use strict';
const path = require('path');
const S = require('./native-swf-stub');
// the fixture compiles adminNativeView.ts itself unless a build is given
if (process.argv[2]) process.env.ADMIN_VIEW_JS = path.resolve(process.argv[2]);
const T = S.checker();
const check = T.check;
const { EVENTS, DEBUG, ZONES, panel, open, P, B, sentOf, click, kids, railLabels, typeInto, ROSTER, MASTERY_T, ITEMS, LOCS, ENCH_CAT, ENCH_PACK, now0, GMCALLS, THIEF, PMETA, pitems, preq, WB } = require('./native-admin-fixture');

// ---- the frame ----
{
  const t = open(panel({ admin: false, caps: undefined, tier: '' }));
  check('says ready with the frame skse appeared on', sentOf(t, 'ready').length === 1, t.msgs());
  check('a player who is not staff sees the Debug tab only, titled Debug', JSON.stringify(railLabels(t)) === '["Debug"]' && P(t).head.title.text === 'DEBUG', railLabels(t));
  const a = open(panel());
  check('an admin sees the twelve tabs in the browser\'s order', railLabels(a).join(',') === 'Debug,Players,GM Calls,Thievery,Skills,Items,Enchant,Powers,Teleport,Place,Modes,NPCs', railLabels(a));
  check('...titled Admin Panel with the tier', P(a).head.title.text === 'ADMIN PANEL' && P(a).head.tier.text === '(senior)');
  const trial = open(panel({ caps: { ban: false, spawn: false, trial: true, tabs: ['players', 'teleport', 'modes'], actions: ['teleportTo', 'rename'] }, tier: 'trialgm' }));
  check('a Trial GM sees Debug, GM Calls and their allowed tabs only', railLabels(trial).join(',') === 'Debug,Players,GM Calls,Teleport,Modes', railLabels(trial));
  P(a).head.refresh.onRelease(); a.serve();
  check('Refresh asks for the debug block and the roster', sentOf(a, 'admin::debugrefresh').length === 1 && sentOf(a, 'admin::refresh').length === 1);
  P(a).head.close.onRelease();
  check('Close sends admin::close (no bare close) and closes', sentOf(a, 'admin::close').length === 1 && sentOf(a, 'close').length === 0 && a.closed());
  const e = open(panel());
  e.press(27);
  check('Escape closes the same way', sentOf(e, 'admin::close').length === 1 && e.closed());
}

// ---- Debug ----
{
  const t = open(panel());
  const v = (i) => B(t)['v' + i].text;
  check('Debug: account, character, form id, server', v(0) === 'nat' && v(1) === 'Aela' && v(2) === '0xFF00012A' && v(3) === 'DragonBreak', [v(0), v(1), v(2), v(3)]);
  check('...position rounded, the cell with its place', v(4) === '1000 -2001 300' && v(5) === '0x3C' && B(t).s5.text === 'Bruma (Cyrodiil)', [v(4), v(5)]);
  check('...target, the three bars in the browser\'s order', v(7) === 'Door 120 u' && v(8) === '50/80 | 100/120 | 90/90', [v(7), v(8)]);
  check('...game time and date in Tamriel\'s calendar', v(9) === '13:30' && B(t).s9.text === 'Tirdas, 3rd of Last Seed, 4E 201', B(t).s9.text);
  check('...the effect with its form id and elapsed time', B(t).fxn0.text === 'Fortify Health' && B(t).fxi0.text === '0xABC' && /^1:0[5-9]$/.test(B(t).fxe0.text), B(t).fxe0.text);
  const n = open(panel({ debug: null }));
  check('...no data yet: Waiting for game data', /Waiting for game data/.test(B(n).waiting.text));
}

// ---- Modes ----
{
  const t = open(panel());
  P(t).rail.t10.onRelease(); t.serve();
  check('Modes: one button each, the active one marked', B(t).m0.label.text === 'Invisible  (on)' && B(t).m1.label.text === 'Ghost' && B(t).m0.rest === 100);
  click(t, B(t).m1);
  check('...a press toggles it: admin::mode <id>', sentOf(t, 'admin::mode').length === 1 && sentOf(t, 'admin::mode')[0].args[0] === 'ghost');
}

// ---- NPCs ----
{
  const t = open(panel());
  P(t).rail.t11.onRelease(); t.serve();
  check('NPCs: opening the tab asks for the zone list', sentOf(t, 'admin::npclist').length === 1);
  const rows = kids(B(t), /^z\d$/);
  check('...nine zones a page of twelve, status as the browser writes it', rows.length === 9 && rows[0].c0.text === 'Zone 0' && rows[0].c1.text === '2/4 alive' && rows[3].c1.text === 'No respawn' && /^Ready in 1:[23]\d$/.test(rows[5].c1.text), rows.map((r) => r.c1.text));
  check('...the pager says so', /Page 1 of 2/.test(B(t).pgwhere.text));
  t.press(39); t.serve();
  check('Right turns to the last three', kids(B(t), /^z\d$/).length === 3 && B(t).z0.c0.text === 'Zone 9');
  t.press(37); t.serve();
  typeInto(t, B(t).zoneSearch, 'zone 1');
  check('typing a search narrows the list (the service searches)', kids(B(t), /^z\d$/).map((r) => r.c0.text).join(',') === 'Zone 1,Zone 10,Zone 11', kids(B(t), /^z\d$/).map((r) => r.c0.text));
  check('...and the game was given the keys back when typing ended', t.sent.filter((m) => m.e === 'allowTextInput').map((m) => m.on).join(',') === 'true,false', t.sent.filter((m) => m.e === 'allowTextInput'));
  t.press(50); t.serve();
  check('key 2 picks Zone 10', B(t).picked.text === 'Zone 10');
  click(t, B(t).tp);
  check('TP sends admin::npctp with the zone', sentOf(t, 'admin::npctp')[0].args[0] === 'Zone 10');
  click(t, B(t).reset);
  check('Reset sends admin::npcreset', sentOf(t, 'admin::npcreset')[0].args[0] === 'Zone 10');
  click(t, B(t).delete);
  check('Delete asks first (Sure?) and sends nothing yet', /^Sure\? Delete/.test(B(t).delete.label.text) && sentOf(t, 'admin::npcdelete').length === 0);
  click(t, B(t).delete);
  check('...the second press deletes it', sentOf(t, 'admin::npcdelete').length === 1 && sentOf(t, 'admin::npcdelete')[0].args[0] === 'Zone 10');
  const g = open(panel({ caps: { ban: false, spawn: false } }));
  P(g).rail.t11.onRelease(); g.serve();
  check('a GM without spawn sees TP but not Reset or Delete', !!B(g).tp && !B(g).reset && !B(g).delete);
  // the Add form
  click(t, B(t).subAdd);
  check('Add: Add is greyed until the form is valid', B(t).add.disabled === true);
  const fill = { zf_name: 'Test', zf_id: 'Tamriel', zf_x: '1', zf_y: '2', zf_z: '3', zf_npc: '00023A99 4; 23a99:Skyrim.esm 2' };
  for (const k of Object.keys(fill)) typeInto(t, B(t)[k], fill[k]);
  check('...filled, it is live', B(t).add.disabled !== true);
  click(t, B(t).add);
  const z = JSON.parse(sentOf(t, 'admin::npcadd')[0].args[0]);
  check('Add sends the NPC-Spawns.json entry, entries split, blanks left to the server', z.Name === 'Test' && z.ID === 'Tamriel' && z.POS.x === 1 && z.POS.z === 3 && JSON.stringify(z.NPC) === '["00023A99 4","23a99:Skyrim.esm 2"]' && z.Size === 2000 && z.Despawn === 120, z);
  check('...and goes back to the zones', kids(B(t), /^z\d$/).length > 0);
}

// ---- Players ----
{
  const data = panel({ players: ROSTER, bans: [{ id: 'b1', profileId: 99, name: 'Griefer', ip: '', until: 0, reason: '', by: 'nat', at: 0 }], mastery: { profession: null, label: '', rank: 0, rankName: '', hours: 2 }, me: { a: 'ff00012a' } });
  const t = open(data);
  P(t).rail.t1.onRelease(); t.serve();
  check('Players: opening the tab asks for the acted-on character\'s skills (Care)', sentOf(t, 'admin::request').some((m) => m.args[0] === 'adminMasteryRequest'));
  check('...four views for a senior: Roster, Punish, Care, Mastery', ['sub0', 'sub1', 'sub2', 'sub3'].every((n) => B(t)[n]) && B(t).sub3.label.text === 'Mastery');
  check('...the roster pages six at a time', kids(B(t), /^r\d$/).length === 6 && /Page 1 of 3/.test(B(t).pgwhere.text), kids(B(t), /^r\d$/).length);
  check('...a row as the browser\'s: ping, profile, name #tag, form id, discord', B(t).r0.c0.text === '40ms' && B(t).r0.c1.text === '100' && B(t).r0.c2.text === 'Player 0 #T0' && B(t).r0.c3.text === '0xff000100' && B(t).r0.c4.text === 'disc0');
  typeInto(t, B(t).search, 'player 1');
  check('search narrows the roster (Player 1, 10-13)', kids(B(t), /^r\d$/).map((r) => r.c2.text.split(' #')[0]).join(',') === 'Player 1,Player 10,Player 11,Player 12,Player 13', kids(B(t), /^r\d$/).map((r) => r.c2.text));
  click(t, B(t).online);
  check('Online only leaves the online one', kids(B(t), /^r\d$/).length === 1);
  click(t, B(t).online);
  typeInto(t, B(t).search, '');
  t.press(51); t.serve();
  check('key 3 picks Player 2: named under the list, and made the one acted on', B(t).selName.text === 'Player 2' && B(t).actingOn.text === 'Acting on: Player 2', [B(t).selName.text, B(t).actingOn.text]);
  click(t, B(t).tp); click(t, B(t).summon); click(t, B(t).kick);
  check('TP to, Summon, Kick send the browser\'s keys with the actor', sentOf(t, 'admin::tp')[0].args[0] === 'ff000102' && sentOf(t, 'admin::summon')[0].args[0] === 'ff000102' && sentOf(t, 'admin::kick')[0].args[0] === 'ff000102');
  click(t, B(t).ban);
  check('Ban asks first', sentOf(t, 'admin::ban').length === 0 && /^Sure\? Ban/.test(B(t).ban.label.text));
  click(t, B(t).ban);
  check('...then bans', sentOf(t, 'admin::ban')[0].args[0] === 'ff000102');
  typeInto(t, B(t).rename, '  Lydia  ');
  click(t, B(t).renameGo);
  const rn = sentOf(t, 'admin::action').find((m) => m.args[0] === 'rename');
  check('Rename sends admin::action rename with the trimmed name', rn && JSON.parse(rn.args[1]).target === 'ff000102' && JSON.parse(rn.args[1]).name === 'Lydia', rn);
  // the typing counter: a push in the middle of typing must not raise it twice
  const before = t.sent.filter((m) => m.e === 'allowTextInput').length;
  click(t, B(t).rename); t.refresh(); t.refresh();
  B(t).rename.text = 'x'; B(t).rename.onChanged(); t.press(27); t.serve();
  const allow = t.sent.filter((m) => m.e === 'allowTextInput').slice(before).map((m) => m.on);
  check('typing through two data pushes raises AllowTextInput once and lowers it once', allow.join(',') === 'true,false', allow);
  // Punish
  click(t, B(t).sub1);
  click(t, B(t).kill);
  check('Punish: Kill sends at once (it can be undone)', sentOf(t, 'admin::action').some((m) => m.args[0] === 'kill' && JSON.parse(m.args[1]).target === 'ff000102'));
  click(t, B(t).delete); click(t, B(t).ipban);
  check('Delete character and IP ban each ask first; a second button disarms the first', !sentOf(t, 'admin::action').some((m) => m.args[0] === 'deleteCharacter' || m.args[0] === 'ipBan') && /^Sure\? IP ban/.test(B(t).ipban.label.text) && !/^Sure/.test(B(t).delete.label.text));
  click(t, B(t).ipban);
  check('...and IP bans on its second press', sentOf(t, 'admin::action').some((m) => m.args[0] === 'ipBan'));
  click(t, B(t).len4);
  check('the 1 week chip sets 168 hours', B(t).hours.label.text === '168');
  click(t, B(t).tempban); click(t, B(t).tempban);
  const tb = sentOf(t, 'admin::action').find((m) => m.args[0] === 'tempBan');
  check('Temp ban (after its confirm) sends the hours', tb && JSON.parse(tb.args[1]).hours === 168 && JSON.parse(tb.args[1]).target === 'ff000102', tb);
  click(t, B(t).deity); click(t, B(t).deity);
  check('Reset deity: dbo:deityReset [actor, name, profile]', JSON.stringify(sentOf(t, 'dbo:deityReset')[0].args) === '["ff000102","Player 2",102]', sentOf(t, 'dbo:deityReset'));
  click(t, B(t).b0); click(t, B(t).unban);
  check('the ban list: pick Griefer, Unban', sentOf(t, 'admin::action').some((m) => m.args[0] === 'unban' && JSON.parse(m.args[1]).target === 'b1'));
  // an offline row: only Reset deity, by name
  click(t, B(t).sub0);
  typeInto(t, B(t).search, 'player 12');
  click(t, B(t).r0);
  click(t, B(t).sub1);
  check('an offline player: Kill greyed, Reset deity live', B(t).kill.disabled === true && B(t).deity.disabled !== true);
  click(t, B(t).deity); click(t, B(t).deity);
  check('...and Reset deity finds them by name and profile', JSON.stringify(sentOf(t, 'dbo:deityReset')[1].args) === '["","Player 12",112]', sentOf(t, 'dbo:deityReset')[1]);
  // Care, on the one acted on (Player 2 still)
  t.adm.data.masteryTarget = MASTERY_T('ff000102');
  click(t, B(t).sub2);
  check('Care: the strip names who it acts on', B(t).actingOn.text === 'Acting on: Player 2');
  click(t, B(t).disV); click(t, B(t).disV);
  check('a disease asks first, then giveDisease with target and kind', sentOf(t, 'admin::action').some((m) => m.args[0] === 'giveDisease' && m.args[1] === '{"target":"ff000102","kind":"vampire"}'));
  click(t, B(t).curse4); click(t, B(t).curse4);
  check('Cure: giveCurse kind cure', sentOf(t, 'admin::action').some((m) => m.args[0] === 'giveCurse' && JSON.parse(m.args[1]).kind === 'cure'));
  click(t, B(t).stage3); click(t, B(t).stage3);
  check('Stage 3: giveCurse kind stage, stage 3', sentOf(t, 'admin::action').some((m) => m.args[0] === 'giveCurse' && JSON.parse(m.args[1]).stage === 3));
  check('the schools: Destruction settable, Restoration follows Priest', B(t).school_Destruction && /follows Priest/.test(B(t).sp1.text) && B(t).set0.disabled === true);
  typeInto(t, B(t).school_Destruction, '55');
  click(t, B(t).set0);
  check('...Set sends setSchool with the level', sentOf(t, 'admin::action').some((m) => m.args[0] === 'setSchool' && m.args[1] === '{"target":"ff000102","school":"Destruction","level":55}'), sentOf(t, 'admin::action').map((m) => m.args));
  // the picker: act on yourself
  click(t, B(t).change);
  check('Change opens the picker, You first', B(t).pick0.c0.text === 'You' && B(t).pick2.c0.text === 'Player 1');
  click(t, B(t).pick0);
  check('...picking You acts on yourself: no target field', B(t).actingOn.text === 'Acting on: You');
  click(t, B(t).disW); click(t, B(t).disW);
  check('...a disease on yourself sends no target', sentOf(t, 'admin::action').some((m) => m.args[0] === 'giveDisease' && m.args[1] === '{"kind":"werewolf"}'));
  // Mastery, with Player 2 picked again on a cleared roster
  click(t, B(t).sub0);
  typeInto(t, B(t).search, '');
  t.press(51); t.serve();
  click(t, B(t).sub3);
  check('Mastery: a row for You and one for the picked player', B(t).mw0.text === 'You' && B(t).mw1.text === 'Player 2' && /No craft chosen \(2 h banked\)/.test(B(t).mi0.text) && /Smith - Apprentice - 3 hours/.test(B(t).mi1.text), [B(t).mi0.text, B(t).mi1.text]);
  typeInto(t, B(t).grant, '5');
  click(t, B(t).mg1);
  check('Grant sends admin::masterygrant [target, hours]', JSON.stringify(sentOf(t, 'admin::masterygrant')[0].args) === '["ff000102",5]');
  check('Reset craft greyed where no craft is chosen', B(t).mr0.disabled === true && B(t).mr1.disabled !== true);
  click(t, B(t).mr1); click(t, B(t).mr1);
  check('...and asks first, then admin::masteryreset', JSON.stringify(sentOf(t, 'admin::masteryreset')[0].args) === '["ff000102"]');
  typeInto(t, B(t).grant, '1001');
  check('...more than 1000 hours is refused (Grant greyed)', B(t).mg0.disabled === true);
}
{
  const tr = open(panel({ players: ROSTER, caps: { ban: false, spawn: false, trial: true, tabs: ['players'], actions: ['teleportTo', 'rename'] } }));
  P(tr).rail.t1.onRelease(); tr.serve();
  check('a Trial GM: the roster only, TP to and Rename, no Summon, Kick or Ban', !B(tr).sub0 && B(tr).tp && B(tr).rename && !B(tr).summon && !B(tr).kick && !B(tr).ban);
  check('...and no mastery request is sent for them', !sentOf(tr, 'admin::request').some((m) => m.args[0] === 'adminMasteryRequest'));
}

// ---- Skills ----
{
  const t = open(panel({ players: ROSTER }));
  t.adm.data.masteryTarget = MASTERY_T('');
  P(t).rail.t4.onRelease(); t.serve();
  check('Skills: opening it asks for the acted-on character\'s skills', sentOf(t, 'admin::request').some((m) => m.args[0] === 'adminMasteryRequest' && m.args[1] === '{}'));
  check('...a row per skill, the followed one with its tier and hours', B(t).n0.text === 'Smithing' && B(t).st0.text === 'Apprentice - 3' && B(t).st1.text === 'not followed');
  check('...the chosen tier lit, Set aside on the followed skill only', B(t).t0_1.rest === 100 && B(t).t0_0.rest === 50 && !!B(t).aside0 && !B(t).aside1);
  click(t, B(t).t1_2);
  const st = sentOf(t, 'admin::action').find((m) => m.args[0] === 'masterySetTier');
  check('a tier chip sends masterySetTier with skill and tier', st && st.args[1] === '{"target":"","skill":"alch","tier":2}', st);
  click(t, B(t).aside0);
  check('Set aside sends masteryDrop', sentOf(t, 'admin::action').some((m) => m.args[0] === 'masteryDrop' && JSON.parse(m.args[1]).skill === 'smith'));
  click(t, B(t).change); click(t, B(t).pick3);
  check('changing who is acted on asks again for theirs', sentOf(t, 'admin::request').filter((m) => m.args[0] === 'adminMasteryRequest').pop().args[1] === '{"target":"ff000102"}');
  const g = open(panel({ caps: { ban: false, spawn: false } }));
  g.adm.data.masteryTarget = MASTERY_T('');
  P(g).rail.t4.onRelease(); g.serve();
  check('a GM views the skills without the tier chips', !B(g).t0_0 && /Changing skills is for a Lead GM/.test(B(g).foot.text));
}

// ---- Items ----
{
  const t = open(panel({ players: ROSTER }));
  P(t).rail.t5.onRelease(); t.serve();
  check('Items: no catalog yet, so the tab asks for it', sentOf(t, 'admin::request').some((m) => m.args[0] === 'adminItemsRequest') && /Loading items/.test(B(t).loading.text));
  t.adm.cats.items = ITEMS; t.refresh();
  check('...arrived: All and a chip per category, with counts', B(t).cat0.label.text === 'All 5' && B(t).cat1.label.text === 'Weapons 3' && B(t).cat2.label.text === 'Armour 2');
  check('...nothing listed until a search or a category, as the browser', /Type to search, or pick a category/.test(B(t).none.text));
  click(t, B(t).cat1);
  check('a category lists its items with their mod', kids(B(t), /^r\d$/).map((r) => r.c0.text).join(',') === 'Iron Sword,Steel Sword,Cyrod Blade' && B(t).r2.c1.text === 'BSAssets');
  click(t, B(t).cat0);
  typeInto(t, B(t).search, 'iron');
  // the editor id DLC2ArmorNordicHeavyBoots holds i-r-o-n in order, so it ranks third, as in the browser's search
  check('a search ranks across every category, showing each one\'s category', kids(B(t), /^r\d$/).map((r) => r.c0.text).slice(0, 2).join(',') === 'Iron Sword,Iron Helmet' && B(t).r1.c1.text === 'Armour', kids(B(t), /^r\d$/).map((r) => r.c0.text));
  typeInto(t, B(t).search, 'nordic boots');
  check('an editor id reads as words (Nordic Heavy Boots)', B(t).r0.c0.text === 'Nordic Heavy Boots');
  typeInto(t, B(t).search, '');
  click(t, B(t).mod);
  check('the Mod button opens the mods: every mod first', B(t).mod0.c0.text === 'Every mod' && B(t).mod1.c0.text === 'BSAssets');
  click(t, B(t).mod1);
  click(t, B(t).cat1);
  check('...narrowed to BSAssets, Weapons holds one', kids(B(t), /^r\d$/).length === 1 && B(t).r0.c0.text === 'Cyrod Blade' && /BSAssets/.test(B(t).mod.label.text));
  click(t, B(t).r0);
  check('picking names it; Spawn becomes live', B(t).picked.text === 'Cyrod Blade' && B(t).spawn.disabled !== true);
  typeInto(t, B(t).count, '5');
  click(t, B(t).spawn);
  check('Spawn: giveItem with item, count and target', sentOf(t, 'admin::action').some((m) => m.args[0] === 'giveItem' && m.args[1] === '{"item":"1a2b:BS.esm","count":5}'), sentOf(t, 'admin::action'));
  click(t, B(t).r0);
  check('picking it again spawns it again (Enter twice in the browser)', sentOf(t, 'admin::action').filter((m) => m.args[0] === 'giveItem').length === 2);
  typeInto(t, B(t).count, '0');
  check('a count of 0 greys Spawn', B(t).spawn.disabled === true);
  t.adm.cats.recent = { items: ['13981:Skyrim.esm', 'gone:Old.esm'], teleport: [] };
  click(t, B(t).mod); click(t, B(t).mod0); click(t, B(t).cat0); t.refresh();
  check('no search and no category: what was spawned lately, named so (one no longer in the catalog left out)', !!B(t).recentHead && kids(B(t), /^r\d$/).length === 1 && B(t).r0.c0.text === 'Steel Sword', kids(B(t), /^r\d$/).map((r) => r.c0.text));
  const g = open(panel({ caps: { ban: false, spawn: false } }));
  g.adm.cats.items = ITEMS;
  P(g).rail.t5.onRelease(); g.serve();
  check('a GM sees the catalog but no Spawn', !B(g).spawn && /for a Lead GM/.test(B(g).spawnHint.text));
}

// ---- Teleport ----
{
  const t = open(panel());
  P(t).rail.t8.onRelease(); t.serve();
  check('Teleport: asks for the locations', sentOf(t, 'admin::request').some((m) => m.args[0] === 'adminLocationsRequest'));
  t.adm.cats.locations = LOCS; t.refresh();
  check('...Cyrodiil open by default, regions as chips in the browser\'s order', B(t).region0.label.text === 'Skyrim 1' && B(t).region1.label.text === 'Cyrodiil 3' && B(t).region1.rest === 100);
  check('...two worlds in Cyrodiil: All and each', B(t).world0.label.text === 'All 3' && B(t).world1.label.text === 'Cyrodiil 2');
  click(t, B(t).world2);
  check('a world narrows to its places', kids(B(t), /^r\d$/).length === 1 && B(t).r0.c0.text === 'Frostcrag Spire');
  click(t, B(t).r0);
  check('choosing a place teleports: admin::tploc <name>', sentOf(t, 'admin::tploc')[0].args[0] === 'Frostcrag Spire');
  typeInto(t, B(t).search, 'ald');
  check('a search reaches every region and names it', B(t).r0.c0.text === 'Ald Velothi' && B(t).r0.c1.text === 'Morrowind - Morrowind');
  typeInto(t, B(t).search, '');
  t.adm.cats.recent = { items: [], teleport: ['Frostcrag Spire', 'Bruma', 'Nowhere'] }; t.refresh();
  check('places teleported to lately: a Recent chip first, newest first, the unknown left out', B(t).region0.label.text === 'Recent 2');
  click(t, B(t).region0);
  check('...holding them in that order', kids(B(t), /^r\d$/).map((r) => r.c0.text).join(',') === 'Frostcrag Spire,Bruma', kids(B(t), /^r\d$/).map((r) => r.c0.text));
}

// ---- Powers ----
{
  const roster = ROSTER.map((p, i) => (i === 1 ? Object.assign({}, p, { b: { werewolf: true, vampirelord: false, form: 'fox', creature: true, since: Date.now() - 180000 } }) : i === 2 ? Object.assign({}, p, { b: { werewolf: true, vampirelord: false, form: null } }) : p));
  const t = open(panel({ players: roster, me: { a: 'ff00012a', b: { werewolf: false, vampirelord: false, form: null } }, polymorph: { on: true, setBy: 'admin', forms: [{ key: 'fox', name: 'Fox' }, { key: 'chicken', name: 'Chicken' }] } }));
  P(t).rail.t7.onRelease(); t.serve();
  check('Powers: polymorph on, set by an Owner, you in your own shape', /^on \(set by an Owner\), you are in your own shape$/.test(B(t).polyH.text), B(t).polyH.text);
  check('...the open animals as buttons', B(t).form0.label.text === 'Fox' && B(t).form1.label.text === 'Chicken');
  click(t, B(t).form1);
  check('taking a shape: polymorphSelf with the form, no target', sentOf(t, 'admin::action').some((m) => m.args[0] === 'polymorphSelf' && m.args[1] === '{"form":"chicken"}'));
  check('who is an animal now: Player 1 a fox for 3 min, with Revert', /^Player 1: Fox for 3 min$/.test(B(t).now0.text), B(t).now0.text);
  click(t, B(t).nowRevert0);
  check('...Revert sends beastForm revert with their actor', sentOf(t, 'admin::action').some((m) => m.args[0] === 'beastForm' && m.args[1] === '{"form":"fox","op":"revert","target":"ff000101"}'), sentOf(t, 'admin::action').map((m) => m.args[1]));
  click(t, B(t).change); click(t, B(t).pick3);
  check('acting on Player 2: werewolf power held, Vampire Lord not granted', B(t).bS0.text === 'power held' && B(t).bS1.text === 'not granted');
  click(t, B(t).grant1);
  check('Grant power: giveVampireLord with the target', sentOf(t, 'admin::action').some((m) => m.args[0] === 'giveVampireLord' && m.args[1] === '{"target":"ff000102"}'));
  click(t, B(t).nowwerewolf);
  check('Transform now: beastForm op now', sentOf(t, 'admin::action').some((m) => m.args[0] === 'beastForm' && JSON.parse(m.args[1]).op === 'now' && JSON.parse(m.args[1]).form === 'werewolf'));
  click(t, B(t).revokewerewolf); click(t, B(t).revokewerewolf);
  check('Revoke asks first, then beastForm op revoke', sentOf(t, 'admin::action').some((m) => m.args[0] === 'beastForm' && JSON.parse(m.args[1]).op === 'revoke'));
  click(t, B(t).spells);
  check('Give all spells asks first', !sentOf(t, 'admin::action').some((m) => m.args[0] === 'giveSpells') && /^Sure\?/.test(B(t).spells.label.text));
  click(t, B(t).spells);
  check('...then gives them to the one acted on', sentOf(t, 'admin::action').some((m) => m.args[0] === 'giveSpells' && m.args[1] === '{"target":"ff000102"}'));
  const g = open(panel({ players: roster, caps: { ban: false, spawn: false }, polymorph: { on: true, setBy: '', forms: [{ key: 'fox', name: 'Fox' }] } }));
  P(g).rail.t7.onRelease(); g.serve();
  check('a GM sees the states but no power buttons', !B(g).form0 && !B(g).grant0 && !B(g).spells && /Powers are for a Lead GM/.test(B(g).foot.text));
}

// ---- Enchant ----
{
  const t = open(panel({ players: ROSTER }));
  P(t).rail.t6.onRelease(); t.serve();
  check('Enchant: opening asks for the catalog and the pack of the one acted on', JSON.stringify(sentOf(t, 'dbo:staffEnchant').map((m) => m.args)) === '[["catalog"],["items",""]]', sentOf(t, 'dbo:staffEnchant'));
  t.adm.staff[141] = ENCH_CAT; t.adm.staff[142] = ENCH_PACK(''); t.refresh();
  check('...the pack as pieces, a worn one greyed with why', B(t).piece0.label.text === 'Iron Sword x2' && B(t).piece2.disabled === true && /Worn: take it off/.test(B(t).pieceSub2.text));
  click(t, B(t).piece0);
  check('a weapon narrows the enchantments to weapon ones', kids(B(t), /^r\d$/).length === 1 && B(t).r0.c0.text === 'Fire Damage');
  click(t, B(t).r0);
  check('...picked: its effect, and strength from 10 up to 20', /^Fire Damage: 10 \(main\)$/.test(B(t).fx0.text) && B(t).strH.text === 'own 10, max 20');
  typeInto(t, B(t).strength, '15');
  check('...the preview follows the strength', /^Fire Damage: 15/.test(B(t).fx0.text));
  typeInto(t, B(t).name, 'Ember');
  click(t, B(t).apply);
  check('Enchant: dbo:staffEnchant apply with target, piece, enchantment, strength and name', JSON.stringify(sentOf(t, 'dbo:staffEnchant').pop().args) === '["apply","{\\"target\\":\\"\\",\\"key\\":\\"k1\\",\\"ench\\":\\"e1\\",\\"name\\":\\"Ember\\",\\"strength\\":15}"]', sentOf(t, 'dbo:staffEnchant').pop());
  typeInto(t, B(t).strength, '25');
  check('more than the cap greys Enchant', B(t).apply.disabled === true);
  click(t, B(t).piece1);
  click(t, B(t).r0);
  check('a piece already enchanted: Replace enchantment, which asks first', /Replace enchantment/.test(B(t).apply.label.text));
  click(t, B(t).apply);
  check('...nothing sent on the first press', JSON.parse(sentOf(t, 'dbo:staffEnchant').pop().args[1] || '{}').key === 'k1');
  P(t).rail.t0.onRelease(); t.serve();
  check('leaving the tab closes the feed: dbo:staffEnchant close', sentOf(t, 'dbo:staffEnchant').pop().args[0] === 'close');
}

// ---- GM Calls ----
{
  const t = open(panel());
  P(t).rail.t2.onRelease(); t.serve();
  check('GM Calls: opening it watches the list', sentOf(t, 'dbo:staffGmCalls')[0].args[0] === 'watch');
  t.adm.staff[140] = GMCALLS; t.adm.staffAt[140] = Date.now(); t.refresh();
  check('...three open, one waiting; two cards a page', B(t).count.text === '3 open, 1 waiting' && B(t).name0.text === '#7 Bri' && B(t).name1.text === '#8 Cass (offline)' && !B(t).name2);
  check('...a card: place, age, its lines, waiting', B(t).place0.text === 'Bruma' && B(t).ago0.text === '12 min ago' && B(t).line0_0.text === 'stuck in a wall' && /^\+11 min  still stuck$/.test(B(t).line0_1.text) && B(t).state0.text === 'Waiting', B(t).line0_1.text);
  check('...yours: no Take, Release, Go to where they called, the ticket', !B(t).take1 && !!B(t).release1 && B(t).goto1.label.text === 'Go to (where they called)' && B(t).ticket1.text === 'Discord ticket #41');
  click(t, B(t).take0);
  check('Take: dbo:staffGmCalls take 7', JSON.stringify(sentOf(t, 'dbo:staffGmCalls').pop().args) === '["take",7,""]');
  typeInto(t, B(t).note7, 'teleported out');
  click(t, B(t).close0);
  check('Close asks first', sentOf(t, 'dbo:staffGmCalls').pop().args[0] === 'take');
  click(t, B(t).close0);
  check('...then closes with the note', JSON.stringify(sentOf(t, 'dbo:staffGmCalls').pop().args) === '["close",7,"teleported out"]');
  click(t, B(t).quiet);
  check('the banners switch: quiet on', JSON.stringify(sentOf(t, 'dbo:staffGmCalls').pop().args) === '["quiet","on"]');
  t.press(39); t.serve();
  check('Right shows the third call: Taken by kim, Take over', B(t).name0.text === '#9 Dov' && B(t).state0.text === 'Taken by kim' && B(t).take0.label.text === 'Take over');
  click(t, B(t).sub1);
  check('Lately closed: how, by whom, when and the note', B(t).cn0.text === '#3 Olaf' && B(t).ch0.text === 'closed by nat, 1 h 0 min ago' && B(t).cnote0.text === 'sorted');
  P(t).rail.t0.onRelease(); t.serve();
  check('leaving unwatches', sentOf(t, 'dbo:staffGmCalls').pop().args[0] === 'unwatch');
}

// ---- Thievery ----
{
  const t = open(panel());
  P(t).rail.t3.onRelease(); t.serve();
  check('Thievery: watched on open', sentOf(t, 'dbo:staffThievery')[0].args[0] === 'watch');
  t.adm.staff[162] = THIEF; t.adm.staffAt[162] = Date.now(); t.refresh();
  check('...views with counts, a Lead GM gets Approve; the last result in green', B(t).sub0.label.text === 'Factions & fences (2)' && B(t).sub1.label.text === 'Approve' && B(t).sub4.label.text === 'Permits (1)' && B(t).result.text === 'Fence marked.' && B(t).result.textColor === 0x8FBF7F);
  check('a faction from the config cannot be revoked; one with lots cannot be unmarked', B(t).revoke0.disabled === true && B(t).unmark0.disabled === true && B(t).mark1.label.text === 'Mark fence');
  click(t, B(t).mark1);
  check('Mark fence: dbo:staffThievery mark <id>', JSON.stringify(sentOf(t, 'dbo:staffThievery').pop().args) === '["mark","rats"]');
  click(t, B(t).revoke1); click(t, B(t).revoke1);
  check('Revoke asks first, then revokes', JSON.stringify(sentOf(t, 'dbo:staffThievery').pop().args) === '["revoke","rats"]');
  click(t, B(t).sub1);
  click(t, B(t).approve0); click(t, B(t).approve0);
  check('Approve a faction (after its confirm)', JSON.stringify(sentOf(t, 'dbo:staffThievery').pop().args) === '["approve","ravens"]');
  click(t, B(t).sub2);
  check('Raids: Deny greyed until a reason is typed', B(t).rdeny0.disabled === true);
  typeInto(t, B(t).reason4, 'not enough evidence');
  click(t, B(t).rdeny0); click(t, B(t).rdeny0);
  check('...Deny with the reason', JSON.stringify(sentOf(t, 'dbo:staffThievery').pop().args) === '["raid",4,"deny","not enough evidence"]');
  click(t, B(t).rwon1); click(t, B(t).rwon1);
  check('a Lead GM may rule early: Won', JSON.stringify(sentOf(t, 'dbo:staffThievery').pop().args) === '["raid",5,"won"]');
  click(t, B(t).sub3);
  check('Ledger: both lots, newest state shown', kids(B(t), /^r\d$/).length === 2 && B(t).r0.c3.text === 'fenced');
  typeInto(t, B(t).thief, 'cass');
  check('...a thief filter (the service filters)', kids(B(t), /^r\d$/).length === 1 && B(t).r0.c0.text === '#2 Ale');
  typeInto(t, B(t).thief, '');
  click(t, B(t).r1);
  check('...a carried lot cannot be sent back', B(t).sendback.disabled === true);
  click(t, B(t).r0); click(t, B(t).sendback); click(t, B(t).sendback);
  check('...a fenced one can (after its confirm)', JSON.stringify(sentOf(t, 'dbo:staffThievery').pop().args) === '["sendback",1]');
  click(t, B(t).sub4);
  typeInto(t, B(t).permitName, '#4SWL');
  click(t, B(t).grant);
  check('Permits: grant with the thief and the hours', JSON.stringify(sentOf(t, 'dbo:staffThievery').pop().args) === '["permit","#4SWL",24]');
  click(t, B(t).p0); click(t, B(t).unpermit); click(t, B(t).unpermit);
  check('...revoke a permit (after its confirm)', JSON.stringify(sentOf(t, 'dbo:staffThievery').pop().args) === '["unpermit","h1"]');
  click(t, B(t).sub5);
  check('At locks & breaches: Cass at the Inn door, no breach', B(t).wt0.text === 'Cass' && /at its door/.test(B(t).wh0.text) && /No home is breached/.test(B(t).noBreach.text));
  t.adm.staff[162] = Object.assign({}, THIEF, { armed: { kind: 'fence', fid: 'tg', name: 'Thieves Guild', until: now0 + 120000 } }); t.refresh();
  click(t, B(t).cancel);
  check('an armed tool can be cancelled', JSON.stringify(sentOf(t, 'dbo:staffThievery').pop().args) === '["cancel"]');
}

// ---- Place ----
{
  const t = open(panel());
  P(t).rail.t9.onRelease(); t.serve();
  check('Place: opening it asks for the catalog meta', preq(t, 'adminPlaceMeta').length === 1);
  t.adm.data.placeMeta = PMETA; t.refresh();
  const s0 = preq(t, 'adminPlaceSearch');
  check('...then the first category opens, searched on the server', s0.length === 1 && s0[0].category === 'npc:bandit' && s0[0].query === '' && s0[0].offset === 0, s0);
  t.adm.data.placeResults = { query: '', category: 'npc:bandit', plugin: '', offset: 0, total: 140, items: pitems(100, 0) }; t.refresh();
  check('...eight rows a page of the hundred loaded', kids(B(t), /^r\d$/).length === 8 && B(t).r0.c0.text === 'Bandit 0' && /Page 1 of 13, 100 of 140 loaded/.test(B(t).where.text), B(t).where && B(t).where.text);
  click(t, B(t).r0);
  check('picking a row names it and offers Hostile, on', B(t).picked.text === 'Bandit 0' && B(t).hostile && B(t).hostile.rest === 100);
  click(t, B(t).r0);
  const pl = sentOf(t, 'admin::place');
  check('picking it again places it: admin::place {desc, kind, name, hostile}', pl.length === 1 && JSON.stringify(JSON.parse(pl[0].args[0])) === '{"desc":"Skyrim.esm:3e8","kind":"npc","name":"Bandit 0","hostile":true}', pl);
  click(t, B(t).hostile); click(t, B(t).place);
  check('...Hostile off places it friendly', JSON.parse(sentOf(t, 'admin::place')[1].args[0]).hostile === false);
  click(t, B(t).select);
  check('Select tool: admin::placeselect', sentOf(t, 'admin::placeselect').length === 1);
  for (let i = 0; i < 12; i++) { t.press(39); t.serve(); }
  check('the last loaded page offers the rest', /Load 40 more/.test(B(t).next.label.text), B(t).next.label.text);
  t.press(39); t.serve();
  const more = preq(t, 'adminPlaceSearch').pop();
  check('...Right past it asks for the next hundred from where it stopped', more.offset === 100 && more.category === 'npc:bandit', more);
  typeInto(t, B(t).search, 'Bandit 4');
  const q = preq(t, 'adminPlaceSearch').pop();
  check('a typed search goes to the server across every category', q.query === 'bandit 4' && q.category === '' && q.offset === 0, q);
  t.adm.data.placeResults = { query: 'bandit 4', category: '', plugin: '', offset: 0, total: 1, items: [['Skyrim.esm:1', 'Bandit 4', 'Skyrim.esm', 'npc:bandit', 'npc']] }; t.refresh();
  check('...and its rows show their category', B(t).r0.c1.text === 'Bandits' && kids(B(t), /^r\d$/).length === 1);
  t.adm.data.placeResults = { query: 'old', category: '', plugin: '', offset: 0, total: 1, items: [['x', 'Stale', 'Skyrim.esm', 'npc:bandit', 'npc']] }; t.refresh();
  check('...a late answer to an older search is not shown', !B(t).r0 && /Searching/.test(B(t).searching.text));
  typeInto(t, B(t).search, '');
  click(t, B(t).mod);
  check('the mod button opens a picker of every mod', B(t).mod0.c0.text === 'Every mod' && B(t).mod2.c0.text === 'BSHeartland', [0, 1, 2].map((i) => B(t)['mod' + i] && B(t)['mod' + i].c0.text));
  t.press(27); t.serve();
  check('...Escape closes the picker, not the panel', !t.closed() && !B(t).mod0 && !!B(t).search);
  click(t, B(t).mod); click(t, B(t).mod2);
  const mq = preq(t, 'adminPlaceSearch').pop();
  check('...choosing one searches that mod by its file name', mq.plugin === 'BSHeartland.esm', mq);
  t.adm.data.placeMeta = Object.assign({}, PMETA, { rights: { place: false, hostile: false, others: false, placeNeeds: 'senior GM' } });
  t.adm.data.placeResults = { query: '', category: 'npc:bandit', plugin: 'BSHeartland.esm', offset: 0, total: 1, items: pitems(1, 0) }; t.refresh();
  click(t, B(t).r0);
  check('without the right to place, Place is greyed and says who may', B(t).place.disabled === true && /senior GM/.test(B(t).picked.text), B(t).picked.text);
}
{
  const t = open(panel({ placeMeta: PMETA }));
  P(t).rail.t9.onRelease(); t.serve();
  click(t, B(t).view1);
  check('Placed near me: asks for the list', preq(t, 'adminPlacementsRequest').length === 1);
  t.adm.data.placements = { here: 2, total: 5, items: [{ id: 'p1', base: 'Skyrim.esm:1', name: 'Chair', kind: 'obj', dist: 3, mine: true, group: 'g#1', pos: [1, 2, 3], rot: [0, 0, 90] }, { id: 'p2', base: 'Skyrim.esm:2', name: 'Bandit', kind: 'npc', hostile: true, dist: 9, mine: false, group: '', pos: [4, 5, 6], rot: [] }] }; t.refresh();
  check('...rows with kind, group and distance', B(t).r0.c0.text === 'Chair' && B(t).r1.c1.text === 'NPC, hostile' && B(t).r0.c2.text === 'g' && B(t).r0.c3.text === '3 m');
  click(t, B(t).r0); click(t, B(t).goto);
  check('Go to: adminPlacementGoto {id}', preq(t, 'adminPlacementGoto')[0].id === 'p1');
  click(t, B(t).edit);
  const ed = JSON.parse(sentOf(t, 'admin::placeedit')[0].args[0]);
  check('Edit hands it to the placement tool with its pose', ed.id === 'p1' && ed.base === 'Skyrim.esm:1' && ed.rot[2] === 90 && ed.pos[0] === 1, ed);
  click(t, B(t).remove);
  check('Remove asks first', preq(t, 'adminPlacementRemove').length === 0 && /^Sure\? Remove/.test(B(t).remove.label.text));
  click(t, B(t).remove);
  check('...then removes', preq(t, 'adminPlacementRemove')[0].id === 'p1');
  click(t, B(t).r0); click(t, B(t).clearGroup); click(t, B(t).clearGroup);
  check('Clear group asks first, then clears', preq(t, 'adminPlaceGroupClear').length === 1 && preq(t, 'adminPlaceGroupClear')[0].id === 'p1');
  click(t, B(t).r1);
  check('another GM placement cannot be changed without the right', B(t).edit.disabled === true && B(t).remove.disabled === true && B(t).another.disabled !== true);
  click(t, B(t).another);
  check('Place another of it', JSON.parse(sentOf(t, 'admin::place')[0].args[0]).desc === 'Skyrim.esm:2');
  click(t, B(t).undo);
  check('Undo: adminPlaceUndo', preq(t, 'adminPlaceUndo').length === 1);
  click(t, B(t).view2);
  check('Sets: asks for the sets', preq(t, 'adminPlaceSets').length === 1);
  t.adm.data.placeSets = [{ name: 'Camp', count: 12 }]; t.refresh();
  click(t, B(t).r0); click(t, B(t).putDown);
  check('...Put down here', preq(t, 'adminPlaceSetPlace')[0].name === 'Camp');
  click(t, B(t).deleteSet); click(t, B(t).deleteSet);
  check('...Delete set asks first, then deletes', preq(t, 'adminPlaceSetDelete')[0].name === 'Camp');
  check('...Save is greyed until named', B(t).saveSet.disabled === true);
  typeInto(t, B(t).setName, 'Watch post');
  click(t, B(t).radius2); click(t, B(t).saveSet);
  check('...Save with the name and radius', JSON.stringify(preq(t, 'adminPlaceSetSave')[0]) === '{"name":"Watch post","radius":40}', preq(t, 'adminPlaceSetSave'));
}
{
  const t = open(panel({ placeMeta: PMETA }));
  P(t).rail.t9.onRelease(); t.serve();
  click(t, B(t).view3);
  check('Warband: asks for the band', preq(t, 'adminWarbandView').length === 1);
  t.adm.data.warband = WB;
  t.adm.data.placeResults = { query: '', category: 'npc:bandit', plugin: '', offset: 0, total: 140, items: pitems(9, 0) }; t.refresh();
  check('...Raise lists NPCs only, with the last result', kids(B(t), /^r\d$/).length === 6 && B(t).last.text === 'Raised 2 bandits.' && kids(B(t), /^r\d$/).every((r) => /^Bandit [013467]$/.test(r.c0.text)), kids(B(t), /^r\d$/).map((r) => r.c0.text));
  t.press(39); t.serve();
  check('...More past the NPCs asks from the raw row the server stopped at, not the NPC count', preq(t, 'adminPlaceSearch').pop().offset === 9, preq(t, 'adminPlaceSearch'));
  check('...counts up to the raise cap', kids(B(t), /^count\d$/).map((c) => c.label.text).join(',') === '1,2,3,5,8,10');
  click(t, B(t).r1);
  check('picking an NPC asks for its preview: info <desc>', JSON.stringify(preq(t, 'adminWarband').pop()) === '{"text":"info Skyrim.esm:3e9"}');
  click(t, B(t).count3); click(t, B(t).raise);
  check('Raise: raise <desc> <count>', preq(t, 'adminWarband').pop().text === 'raise Skyrim.esm:3e9 5');
  click(t, B(t).wsub1);
  check('Band: members with state, health and distance', B(t).m0.c0.text === 'Bandit' && B(t).m0.c2.text === '80%' && B(t).m1.c1.text === 'dead' && B(t).m1.c3.text === 'elsewhere');
  click(t, B(t).hold);
  check('Hold: stay', preq(t, 'adminWarband').pop().text === 'stay');
  check('Follow greyed while following; Attack my target named', B(t).follow.disabled === true && B(t).attackTarget.label.text === 'Attack Troll');
  click(t, B(t).m0); click(t, B(t).dismissOne);
  check('Dismiss one: dismiss <id>', preq(t, 'adminWarband').pop().text === 'dismiss m1');
  click(t, B(t).settle);
  check('Settle shows the plan first', /1 will stay as a garrison/.test(B(t).plan.text) && /Wolf/.test(B(t).plan.text));
  t.press(27); t.serve();
  check('...Escape drops the plan, not the panel', !t.closed() && !B(t).plan && !!B(t).settle);
  click(t, B(t).settle); click(t, B(t).settleDismiss);
  check('...and the dismiss-the-rest choice', preq(t, 'adminWarband').pop().text === 'settle dismissrest');
  click(t, B(t).dismissAll);
  check('Dismiss all asks first', preq(t, 'adminWarband').pop().text === 'settle dismissrest');
  click(t, B(t).dismissAll);
  check('...then dismisses', preq(t, 'adminWarband').pop().text === 'dismiss');
  const tl = kids(B(t), /^target\d$/).map((b) => b.label.text);
  check('targets: the player and the enemy GM NPC', tl.length === 2 && /^Bri 10 m$/.test(tl[0]) && /^Enemy: Orc \(kim\)/.test(tl[1]), tl);
  click(t, B(t).target1);
  check('...attacknpc <id>', preq(t, 'adminWarband').pop().text === 'attacknpc n1');
  click(t, B(t).target0);
  check('...attack <player>', preq(t, 'adminWarband').pop().text === 'attack Bri');
  click(t, B(t).wsub2);
  typeInto(t, B(t).side, 'Legion');
  click(t, B(t).setSide);
  check('Sides: side <name>', preq(t, 'adminWarband').pop().text === 'side Legion');
  click(t, B(t).praise0);
  check('a saved band raises: preset raise <name>', preq(t, 'adminWarband').pop().text === 'preset raise Camp crew');
  click(t, B(t).pdelete0); click(t, B(t).pdelete0);
  check('...and deletes after its confirm', preq(t, 'adminWarband').pop().text === 'preset delete Camp crew');
  typeInto(t, B(t).preset, 'Night watch'); click(t, B(t).savePreset);
  check('...save this band as', preq(t, 'adminWarband').pop().text === 'preset save Night watch');
  click(t, B(t).onLogout);
  check('on logout: settle', preq(t, 'adminWarband').pop().text === 'onlogout settle');
  click(t, B(t).wsub3);
  check('Raiders & garrison: both listed', B(t).p0.c0.text === 'Raider' && /^garrison/.test(B(t).p1.c1.text));
  click(t, B(t).p1); click(t, B(t).removeOne);
  check('Remove one: raid clear <id>', preq(t, 'adminRaid').pop().text === 'clear g1');
  click(t, B(t).clearRaiders);
  check('Clear raiders asks first', preq(t, 'adminRaid').length === 1);
  click(t, B(t).clearRaiders);
  check('...then clears', preq(t, 'adminRaid').pop().text === 'clear raiders');
}

// ---- every way out of typing ----
// After N data pushes while typing, each exit gives the game its keys back exactly once: held 1 during, 0 after, never below 0
const held = (t) => t.sent.reduce((n, m) => n + (m.e === 'allowTextInput' ? (m.on ? 1 : -1) : 0), 0);
const lowest = (t) => t.sent.reduce((s, m) => { if (m.e === 'allowTextInput') { s.n += m.on ? 1 : -1; s.min = Math.min(s.min, s.n); } return s; }, { n: 0, min: 0 }).min;
const EXITS = [
  ['Enter', (t) => t.press(13), (t) => !t.closed()],
  ['Escape', (t) => t.press(27), (t) => !t.closed()],
  ['another tab', (t) => P(t).rail.t10.onRelease(), (t) => !!B(t).m0],
  ['Close', (t) => P(t).head.close.onRelease(), (t) => t.closed() && sentOf(t, 'admin::close').length === 1],
  // Refresh draws nothing itself: the box must still go back to a plain field
  ['Refresh', (t) => P(t).head.refresh.onRelease(), (t) => sentOf(t, 'admin::refresh').length === 1 && B(t).zoneSearch.type !== 'input'],
  ['a row pick', (t) => B(t).z0.onRelease(), (t) => B(t).picked.text === 'Zone 1'],
  ['a view chip', (t) => B(t).subAdd.onRelease(), (t) => !B(t).zoneSearch || B(t).zoneSearch.type !== 'input'],
];
for (const N of [0, 3]) {
  for (const [way, leave, after] of EXITS) {
    const t = open(panel());
    P(t).rail.t11.onRelease(); t.serve();
    click(t, B(t).zoneSearch);
    const box = B(t).zoneSearch;
    box.text = 'zone 1'; box.onChanged();
    t.st.time += 1000; t.tick(); t.serve();
    for (let i = 0; i < N; i++) t.refresh();
    const during = held(t);
    leave(t); t.serve();
    const done = !t.closed() ? t.adm.ui.typing !== true : true;
    check(`typing, ${N} pushes, then ${way}: keys held once while typing and given back once, the panel no longer typing`, during === 1 && held(t) === 0 && lowest(t) === 0 && done && after(t), [during, held(t), lowest(t), done, after(t)]);
  }
}
{
  // the picker replaces the tab, so the field being typed in is gone: typing ends, then choosing someone acts on them
  const t = open(panel({ players: ROSTER, me: { a: 'ff00012a' } }));
  P(t).rail.t1.onRelease(); t.serve();
  click(t, B(t).search);
  B(t).search.text = 'player'; B(t).search.onChanged();
  t.refresh(); t.refresh();
  const during = held(t);
  click(t, B(t).change);
  const atPicker = held(t);
  click(t, B(t).pick3);
  check('typing, then Change and a pick in the picker: given back at the picker, never below 0, the pick acts', during === 1 && atPicker === 0 && held(t) === 0 && lowest(t) === 0 && t.adm.ui.acting !== '' && t.adm.ui.typing !== true, [during, atPicker, held(t), lowest(t), t.adm.ui.acting]);
  click(t, B(t).search);
  check('...and a field can be typed in again afterwards: one count', held(t) === 1);
  t.press(27); t.serve();
  check('...given back once more', held(t) === 0 && lowest(t) === 0);
}
{
  // a push takes the field away while it is typed in: GM call 7 is closed elsewhere while its note is being written
  const t = open(panel());
  P(t).rail.t2.onRelease(); t.serve();
  t.adm.staff[140] = GMCALLS; t.adm.staffAt[140] = Date.now(); t.refresh();
  click(t, B(t).note7);
  B(t).note7.text = 'half a no'; B(t).note7.onChanged();
  t.refresh();
  const during = held(t);
  t.adm.staff[140] = Object.assign({}, GMCALLS, { open: GMCALLS.open.slice(1), openCount: 2 }); t.refresh();
  check('a push that takes the typed-in field away ends the typing: keys back once, panel keys work again', during === 1 && held(t) === 0 && lowest(t) === 0 && t.adm.ui.typing !== true && !B(t).note7, [during, held(t), lowest(t)]);
  t.press(27); t.serve();
  check('...so Escape closes the panel again', t.closed());
}
{
  // in the game the service answers a frame later: before it does, a press that draws nothing must already show a plain field
  const t = open(panel());
  P(t).rail.t11.onRelease(); t.serve();
  click(t, B(t).zoneSearch);
  P(t).head.refresh.onRelease();
  check('Refresh while typing: the box is a plain field again before the service answers', B(t).zoneSearch.type !== 'input' && held(t) === 0);
}
{
  // openTab's own release, for any way in that does not pass a press (the mouse path ends the typing before it runs)
  const t = open(panel());
  P(t).rail.t11.onRelease(); t.serve();
  click(t, B(t).zoneSearch);
  t.ctx.openTab('modes'); t.serve();
  check('switching tab while typing gives the keys back once', held(t) === 0 && lowest(t) === 0 && !!B(t).m0, [held(t), lowest(t)]);
}

T.done();
