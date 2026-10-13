// Does /help tell a player the rank /teach actually needs?
//
//   node tests\teach-tier-hint-harness.js
//
// spells.js owns the gate (CFG.teacherMinTier, named through skills.json tierNames). Two other places repeat it: the
// /teach command's own help line and the "Classes" hint in gamemode.js HELP_GROUPS. The hint said "At Expert" while
// the live gate was Master (gamemode-config spells.teacherMinTier 4), so a player read the wrong rule in /help and
// asked on Discord instead. Both are now derived; this fails if either is written out by hand again.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let fails = 0, checks = 0;
const ok = (label, cond, got) => { checks++; if (!cond) { fails++; console.log(`  FAIL ${label}${got !== undefined ? `: got ${JSON.stringify(got)}` : ''}`); } };

const spells = read('spells.js');
const gamemode = read('gamemode.js');
const tierNames = (() => {
  try { return JSON.parse(read('skills.json')).tierNames; } catch { return null; }
})();
ok('skills.json names the tiers', Array.isArray(tierNames) && tierNames.length >= 5, tierNames);

// The gate's own default, as spells.js declares it.
const declared = /teacherMinTier:\s*(\d+)/.exec(spells);
ok('spells.js declares a teacherMinTier default', !!declared, declared && declared[1]);
const defaultTier = declared ? Number(declared[1]) : null;

// Neither repeat may hard-code a tier word.
const TIER_WORDS = (tierNames || []).join('|');
const teachHelp = /registerChatCommand\('teach'[\s\S]{0,1600}?\{\s*help:\s*([`'"])([\s\S]*?)\1\s*\}/.exec(spells);
ok('the /teach help line is found', !!teachHelp);
if (teachHelp) {
  const text = teachHelp[2];
  ok('the /teach help line does not spell a tier out by hand',
     !new RegExp(`\\b(${TIER_WORDS})\\b`).test(text), text);
  ok('...it reads the configured tier instead', /TIER_NAMES\[CFG\.teacherMinTier\]/.test(text), text);
}

const hint = /Classes: a Class Lectern\.[^`'"]*/.exec(gamemode);
ok('the Classes hint is found', !!hint);
if (hint) {
  ok('the Classes hint does not spell a tier out by hand',
     !new RegExp(`\\b(${TIER_WORDS})\\b`).test(hint[0]), hint[0]);
  ok('...it reads the configured tier instead', /\$\{TEACH_TIER_NAME\}/.test(hint[0]), hint[0]);
}

// And the deriving helper must agree with the gate, on the default and on whatever the live config sets.
const helper = /const TEACH_TIER_NAME = \(\(\) => \{[\s\S]*?\}\)\(\);/.exec(gamemode);
ok('gamemode derives the tier name', !!helper);
if (helper && defaultTier !== null) {
  const fallback = /let tier = (\d+);/.exec(helper[0]);
  ok('the hint falls back to the same tier spells.js defaults to',
     !!fallback && Number(fallback[1]) === defaultTier, fallback && fallback[1]);
  ok('the hint reads spells.teacherMinTier from the config',
     /\(cfg\.spells \|\| \{\}\)\.teacherMinTier/.test(helper[0]));
  // help-harness and gmcall-harness splice this range into a new Function without cfg, fs or path, so an unguarded
  // read here is a ReferenceError that fails those two instead of this one.
  ok('both reads are guarded, so the spliced harnesses still run',
     (helper[0].match(/catch \(e\)/g) || []).length >= 2, helper[0]);
}

console.log(`${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
