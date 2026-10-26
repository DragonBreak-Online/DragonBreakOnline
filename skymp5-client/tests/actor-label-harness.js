// Names over bosses' heads (Nat, 25 Oct: "can bosses have names over their head so we know what's a boss"): the server's
// bosses.js sends dboActorLabels { list: [{ id, text, color }] } to players near a boss, only when their list changes, and
// this client draws each name at the head node + 96 with an optional title line at + 70 (above TrueHUD's bar at + 30) while the actor is alive, in line of sight and within 3000 units.
// Runs actorLabelPlan.ts (transpiled with the client's TypeScript) and checks the service's wiring in its source. Run it
// from skymp5-client with node_modules present:
//
//   node tests/actor-label-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

const client = path.resolve(__dirname, '..');
const svc = path.join(client, 'src', 'services', 'services');
const ts = require(path.join(client, 'node_modules', 'typescript'));
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

// ---- the plan ----
const planJs = ts.transpileModule(fs.readFileSync(path.join(svc, 'actorLabelPlan.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
const plan = {}; new Function('exports', planJs)(plan);
const GOLD = [1, 0.84, 0.35, 0.95], PALE = [0.85, 0.75, 0.55, 0.9];
// bosses.js 337cba11's own rows: a boss in gold, its guardian in a paler gold
let m = plan.parseLabels({ customPacketType: 'dboActorLabels', list: [{ id: 0xff000123, text: 'Rahgot', color: GOLD }, { id: 0xff000124, text: 'The guardian', color: PALE }] });
check('the server\'s rows: a boss and its guardian, each with its colour', m.size === 2 && m.get(0xff000123).text === 'Rahgot' && m.get(0xff000124).color.join() === PALE.join(), [...m]);
check('an empty list clears every label', plan.parseLabels({ list: [] }).size === 0 && plan.parseLabels({}).size === 0 && plan.parseLabels(null).size === 0);
m = plan.parseLabels({ list: [{ id: 0, text: 'x' }, { id: 5, text: '' }, { id: 6, text: 7 }, null, 'junk', { id: 7, text: '  Ice   Wraith \n' }] });
check('rows without an id or a text are skipped; whitespace folds to one line', m.size === 1 && m.get(7).text === 'Ice Wraith', [...m]);
m = plan.parseLabels({ list: [{ id: 8, text: 'x'.repeat(200) }] });
check('a text is cut to 48 characters', m.get(8).text.length === plan.MAX_TEXT && plan.MAX_TEXT === 48);
m = plan.parseLabels({ list: [{ id: 9, text: 'a', color: [2, 0, 0, 1] }, { id: 10, text: 'b', color: 'red' }, { id: 11, text: 'c' }, { id: 12, text: 'd', color: [0, 0, 0] }] });
check('a missing or bad colour falls back to the boss gold', [9, 10, 11, 12].every((i) => m.get(i).color.join() === GOLD.join()) && plan.DEFAULT_COLOR.join() === GOLD.join(), [...m]);
m = plan.parseLabels({ list: [{ id: 13, text: 'first' }, { id: 13, text: 'second' }] });
check('a later row for the same id wins', m.size === 1 && m.get(13).text === 'second');
const base = { found: true, dead: false, distance: 1000, los: true };
check('drawn: alive, in sight, near', plan.shouldDraw(base) === true);
check('not drawn: dead (a kill clears it before the next packet)', plan.shouldDraw(Object.assign({}, base, { dead: true })) === false);
check('not drawn: out of line of sight', plan.shouldDraw(Object.assign({}, base, { los: false })) === false);
check('drawn at exactly 3000 units, not beyond', plan.shouldDraw(Object.assign({}, base, { distance: 3000 })) && !plan.shouldDraw(Object.assign({}, base, { distance: 3000.5 })) && plan.MAX_DISTANCE === 3000);
check('not drawn: no actor loaded, or no distance', !plan.shouldDraw(Object.assign({}, base, { found: false })) && !plan.shouldDraw(Object.assign({}, base, { distance: NaN })));

// ---- the service's wiring ----
const src = fs.readFileSync(path.join(svc, 'actorLabelService.ts'), 'utf8');
const index = fs.readFileSync(path.join(client, 'src', 'index.ts'), 'utf8');
const caps = fs.readFileSync(path.join(client, 'src', 'lib', 'clientUiCaps.ts'), 'utf8');
check('it listens for dboActorLabels', /content\["customPacketType"\] !== "dboActorLabels"/.test(src));
check('the packet\'s list replaces the labels: one no longer listed is dropped', /for \(const id of Array\.from\(this\.entries\.keys\(\)\)\) if \(!wanted\.has\(id\)\) this\.drop\(id\);/.test(src));
check('the server id goes through remoteIdToLocalId', /Actor\.from\(Game\.getFormEx\(remoteIdToLocalId\(id\)\)\)/.test(src));
check('the plan decides, from isDead, getDistance and hasLOS', /shouldDraw\(\{ found: !!actor, dead: !!actor && actor\.isDead\(\), distance: actor \? player\.getDistance\(actor\) : Infinity, los: !!actor && player\.hasLOS\(actor\) \}\)/.test(src));
check('a name above TrueHUD\'s health bar at the head + 96, its title line under it at + 70, the bar at + 30 (Nat 26 Oct)', /const LABEL_HEIGHT = 96;/.test(src) && /const SUB_HEIGHT = 70;/.test(src) && /hz \+ LABEL_HEIGHT/.test(src) && /hz \+ SUB_HEIGHT/.test(src));
{ const m = plan.parseLabels({ list: [{ id: 5, text: 'Gromm Stonefist', sub: '  the Chieftain   of Blizzard Rest ' }, { id: 6, text: 'Plain' }] });
  check('the title line is parsed and tidied; a row without one has none', m.get(5).sub === 'the Chieftain of Blizzard Rest' && m.get(6).sub === ''); }
check('behind the camera it is hidden', /if \(!p \|\| p\[2\] <= 0\) \{ this\.hide\(e\); continue; \}/.test(src));
check('a hidden label destroys its text; a text is made once and moved after', /destroyText\(e\.textId\)/.test(src) && /e\.textId = createText\(x, y, e\.text, e\.color\)/.test(src) && /setTextPos\(e\.textId, x, y\)/.test(src));
check('a changed name or colour updates the text in place', /setTextString\(e\.textId, e\.text\)/.test(src) && /setTextColor\(e\.textId, e\.color\)/.test(src));
check('it is registered in index.ts', /import \{ ActorLabelService \} from "\.\/services\/services\/actorLabelService";/.test(index) && /new ActorLabelService\(sp, controller\),/.test(index));
check('the client announces actorLabels in its UI caps', /CLIENT_UI_CAPS: ReadonlyArray<string> = \[[^\]]*"actorLabels"/.test(caps) && /"creatureBody"/.test(caps));
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
