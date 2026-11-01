// adminModeService.teachShouts: the server re-sends the "all shouts" list at every login, and re-teaching it all made a wall
// of popups at every login (Nat, 25 Oct). Only a word not yet unlocked is unlocked, only a shout not yet held is added, and the
// summary counts what was really new or says nothing. No word is ever taught: TeachWord raises the engine's "Word of Power
// Learned" banner, and UnlockWord with AddShout is the vanilla werewolf's silent grant (shout-silent-1101; Nat, 1 Nov). The method is cut from the source and transpiled on its own, then run against a fake game. Run from skymp5-client:
//
//   node tests/shout-teach-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const ts = require(path.resolve(__dirname, '..', 'node_modules', 'typescript'));

let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`); if (!ok) failures++; };

const src = fs.readFileSync(path.resolve(__dirname, '../src/services/services/adminModeService.ts'), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('  private teachShouts(');
const method = start < 0 ? '' : src.slice(start, src.indexOf('\n  }\n', start) + 4);
check('teachShouts is there', !!method);
const js = ts.transpileModule(`class T {\n${method.replace('private ', '')}\n}\nmodule.exports = T;`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
const notes = [];
const T = new Function('module', 'showSystemNotification', `${js}; return module.exports;`)({ exports: {} }, (sp, text) => notes.push(text));

// The fake game: words by id, which are unlocked, which shouts the player holds; every call that would pop up is counted
const game = (unlocked, held) => {
  const calls = { teach: 0, unlock: 0, add: 0 };
  const form = (id) => ({ id });
  const sp = {
    Game: {
      getPlayer: () => player,
      getFormFromFile: (id, file) => (file === 'Skyrim.esm' ? form(id) : null),
      isWordUnlocked: (w) => unlocked.has(w.id),
      teachWord: () => { calls.teach++; },
      unlockWord: (w) => { calls.unlock++; unlocked.add(w.id); },
    },
    WordOfPower: { from: (f) => f },
    Shout: { from: (f) => f },
  };
  const player = {
    hasSpell: (s) => held.has(s.id),
    addShout: (s) => { calls.add++; held.add(s.id); return true; },
  };
  const t = new T(); t.sp = sp;
  return { t, calls };
};
const LIST = [
  { shout: '13e07:Skyrim.esm', words: ['602a3:Skyrim.esm', '602a4:Skyrim.esm', '602a5:Skyrim.esm'] },
  { shout: '13e08:Skyrim.esm', words: ['5fb94:Skyrim.esm', '5fb95:Skyrim.esm', '5fb96:Skyrim.esm'] },
];

// A first grant: everything is new
let g = game(new Set(), new Set());
notes.length = 0;
g.t.teachShouts(LIST);
check('a first grant unlocks every word and teaches none (no "Word of Power Learned" banner)', g.calls.teach === 0 && g.calls.unlock === 6, g.calls);
check('...adds both shouts', g.calls.add === 2, g.calls);
check('...and says so with the real counts', notes.length === 1 && notes[0] === 'Learned 2 shouts (6 words).', notes);

// The next login: the server sends the same list again
const unlocked = new Set([0x602a3, 0x602a4, 0x602a5, 0x5fb94, 0x5fb95, 0x5fb96]);
g = game(unlocked, new Set([0x13e07, 0x13e08]));
notes.length = 0;
g.t.teachShouts(LIST);
check('a later login teaches, unlocks and adds nothing, so no popups', g.calls.teach === 0 && g.calls.unlock === 0 && g.calls.add === 0, g.calls);
check('...and shows no summary', notes.length === 0, notes);

// One new shout of three words, the other already known
g = game(new Set([0x602a3, 0x602a4, 0x602a5]), new Set([0x13e07]));
notes.length = 0;
g.t.teachShouts(LIST);
check('only the new shout\'s words are unlocked, none taught', g.calls.teach === 0 && g.calls.unlock === 3, g.calls);
check('...only the new shout is added', g.calls.add === 1, g.calls);
check('...and the summary counts only them', notes[0] === 'Learned 1 shouts (3 words).', notes);

// A word missing from this load order is skipped, not counted
g = game(new Set(), new Set());
notes.length = 0;
g.t.teachShouts([{ shout: '13e07:Skyrim.esm', words: ['1:Missing.esp', '602a3:Skyrim.esm'] }]);
check('a word not in the load order is skipped', g.calls.unlock === 1 && g.calls.teach === 0 && notes[0] === 'Learned 1 shouts (1 words).', [g.calls, notes]);
// The beast form's howl (beastFormService.equipShout) unlocks its word the same way, once, never teaching it
const beastSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'services', 'beastFormService.ts'), 'utf8');
check('the beast form\'s howl unlocks its word without teaching it', /if \(word && !this\.sp\.Game\.isWordUnlocked\(word\)\) this\.sp\.Game\.unlockWord\(word\);/.test(beastSrc) && !/teachWord\(/.test(beastSrc));
check('no teachWord call is left in the client', !fs.readdirSync(path.join(__dirname, '..', 'src', 'services', 'services')).some((f) => /\.ts$/.test(f) && /this\.sp\.Game\.teachWord\(|Game\.teachWord\(/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'services', f), 'utf8').replace(/^\s*\/\/.*$/gm, ''))));

console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
