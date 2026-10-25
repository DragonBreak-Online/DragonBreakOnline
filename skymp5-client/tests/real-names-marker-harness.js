// Scripted test for the staff real-names marker (server playermenu.js /realnames, Jake 14 Oct 2026; client 0.3.98). The
// server writes a staff member's own ff_knownIds as { reveal: 1, labels } while the mode is on; this client draws the
// label over a disguise. realNamesMarker.ts has no imports and transpiles on its own; the nametag and crosshair call
// sites are checked in the source, and the 0.3.97 rules (an array is the introductions list, anything else shows every
// name) must hold. Run it from skymp5-client:
//
//   ./node_modules/typescript/bin/tsc src/view/realNamesMarker.ts --outDir <dir> --module commonjs --target es2019
//   node tests/real-names-marker-harness.js <dir>/realNamesMarker.js
'use strict';
const fs = require('fs');
const path = require('path');
const { revealMarkerOf, revealLabelFor, revealTagText } = require(path.resolve(process.argv[2] || 'realNamesMarker.js'));
const SRC = path.resolve(__dirname, '..', 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\r\n/g, '\n');

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

// ---- what counts as the marker ----------------------------------------------------------------------------------------
const M = 0xff000022, B = 0xff000023, P = 0xff000021;
const marker = () => ({ reveal: 1, labels: { [M.toString(16)]: 'Aldric (masked)', [B.toString(16).toUpperCase()]: 'Bryn (Werewolf form)', bad: 7 } });
check('an introductions array is no marker', revealMarkerOf([M, P]) === null && revealMarkerOf([]) === null);
check('nothing, a number, a string or an object without reveal 1 is no marker', [undefined, null, 0, 'x', {}, { reveal: true }, { reveal: '1' }, { labels: {} }].every((v) => revealMarkerOf(v) === null));
check('{ reveal: 1 } with no labels is a marker with none', JSON.stringify(revealMarkerOf({ reveal: 1 })) === '{"reveal":1,"labels":{}}');
const mk = revealMarkerOf(marker());
check('{ reveal: 1, labels } is the marker; keys are read in lower case, non-strings dropped', !!mk && mk.labels[M.toString(16)] === 'Aldric (masked)' && mk.labels[B.toString(16)] === 'Bryn (Werewolf form)' && !('bad' in mk.labels), mk);
const same = marker();
check('the same object read twice gives the same answer (kept by identity)', revealMarkerOf(same) === revealMarkerOf(same));
check('a new object is read afresh', revealLabelFor({ reveal: 1, labels: {} }, M) === '' && revealLabelFor(marker(), M) === 'Aldric (masked)');

// ---- labels and the tag text --------------------------------------------------------------------------------------------
check('the label of a labelled actor, by its server id', revealLabelFor(marker(), M) === 'Aldric (masked)' && revealLabelFor(marker(), B) === 'Bryn (Werewolf form)');
check('no label for an unlabelled actor, for id 0, or without a marker', revealLabelFor(marker(), P) === '' && revealLabelFor(marker(), 0) === '' && revealLabelFor([M], M) === '');
check('tag text: the label first', revealTagText(marker(), M, 'Masked Person', false) === 'Aldric (masked)');
check('...else the name, with "(hooded)" under a hood', revealTagText(marker(), P, 'Pell', false) === 'Pell' && revealTagText(marker(), P, 'Pell', true) === 'Pell (hooded)');
check('...and "" without a marker, so the caller keeps the introductions rule', revealTagText([P], P, 'Pell', true) === '' && revealTagText(undefined, P, 'Pell', false) === '');

// ---- the call sites ---------------------------------------------------------------------------------------------------------
const fv = read('view/formView.ts');
const tag = fv.slice(fv.indexOf('private tagName('), fv.indexOf('private static ownerKnownIds('));
check('formView tagName: the marker first, then the 0.3.97 rules unchanged (not an array: the name; else Stranger unless introduced)',
  /if \(revealMarkerOf\(known\)\) \{\s*return revealTagText\(known, this\.getRemoteRefrId\(\), name, this\.isSweetHidePerson\(refr\)\);\s*\}\s*if \(!Array\.isArray\(known\)\) \{\s*return name;\s*\}\s*return known\.includes\(this\.getRemoteRefrId\(\)\) \? name : "Stranger";/.test(tag), tag);
const vis = fv.slice(fv.indexOf('const isVisibleByPlayer = '), fv.indexOf('if (isVisibleByPlayer) {'));
check('the nametag: a hood and a beast are drawn only for a viewer with the marker, a beast only with its label', /\(revealing \|\| !this\.isSweetHidePerson\(refr\)\)/.test(vis)
  && /\(!this\.isBeastCopy\(model\) \|\| \(revealing && revealLabelFor\(known, this\.getRemoteRefrId\(\)\) !== ""\)\)/.test(vis), vis);
check('...and every visibility rule stays for staff too: sneaking, distance, sight, hidden admins, Invisibility', /!model\.movement\?\.isSneaking/.test(vis) && /getDistance\(refr\) <= maxNicknameDrawDistance/.test(vis)
  && /hasLOS\(refr\)/.test(vis) && /adminViewOf\(model\) !== "hidden"/.test(vis) && /!this\.spellInvisible\(refr(, model)?\)/.test(vis));
const ip = read('services/services/interactionPromptService.ts');
const ap = ip.slice(ip.indexOf('private actorPromptFor('), ip.indexOf('private knowsTarget('));
check('the crosshair prompt: "Interact <label>" / "Search <label>" for a labelled player, after the vanilla and NPC cases', /if \(!isRemotePlayerCharacter\(remoteId\)\)[\s\S]*const staffLabel = revealLabelFor\(this\.ownerKnownIds\(\), remoteId\);\s*if \(staffLabel\) return \{ verb: dead \? "Search" : "Interact", label: staffLabel \};/.test(ap), ap);
const kt = ip.slice(ip.indexOf('private knowsTarget('), ip.indexOf('private ownerKnownIds('));
check('...and knowsTarget keeps the 0.3.97 rule (not an array: every name)', /if \(!Array\.isArray\(known\)\) return true;\s*return known\.includes\(remoteId\);/.test(kt), kt);

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
