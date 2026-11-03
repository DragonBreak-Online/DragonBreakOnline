// The font probe (swf/dbo_fontprobe) on the stub stage: its lines ask for the right fonts, embedded where they should be,
// and the engine's measure of each goes to the server on ready. Whether an embedded font draws is the game's to say;
// the stub only proves the panel asks the question it means to. The fonts themselves are checked in the built swf.
//   node tests/native-fontprobe-harness.js
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('./native-swf-stub');
const T = S.checker();
const check = T.check;
const msgs = (t) => t.msgs().filter((m) => m.key === 'dbo:fontProbe');

const t = S.boot('dbo_fontprobe');
const P = t.root.dboPanel;
const lines = [0, 1, 2, 3, 4].map((i) => P['s' + i]);
check('five sample lines: two of Skyrim\'s fonts, then DboBody embedded and not, then DboTitle embedded',
  lines.map((l) => l.fmt.font + ':' + l.embedFonts).join('|') === '$EverywhereFont:false|$EverywhereMediumFont:false|DboBody:true|DboBody:false|DboTitle:true', lines.map((l) => l.fmt.font + ':' + l.embedFonts));
check('each line says which font it asks for', /DboBody, embedded/.test(P.cap2.text) && /DboTitle/.test(P.cap4.text) && /\$EverywhereFont/.test(P.cap0.text));
const r = msgs(t)[0];
check('on ready it reports one measure per line, with its font and embedding', r && r.args[0].version === 'fontprobe-1' && r.args[0].lines.length === 5 && r.args[0].lines[2].font === 'DboBody' && r.args[0].lines[2].embed === true, r);
t.press(27);
check('Escape closes it', t.closed());

// the xml's placeholders and fonts.txt agree, and every font it names is OFL with its licence beside it
const dir = path.resolve(__dirname, '../swf');
const xml = fs.readFileSync(path.join(dir, 'dbo_fontprobe/dbo_fontprobe.xml'), 'utf8');
const want = fs.readFileSync(path.join(dir, 'dbo_fontprobe/fonts.txt'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split(' '));
check('fonts.txt fills each placeholder font in the xml', want.length === 2 && want.every(([id]) => new RegExp('DefineFont3Tag[^>]*fontID="' + id + '"').test(xml)), want);
check('each font file is there with an SIL OFL 1.1 licence beside it', want.every(([, f]) => {
  const ttf = path.join(dir, 'fonts', f);
  const ofl = path.join(path.dirname(ttf), 'OFL.txt');
  return fs.existsSync(ttf) && fs.existsSync(ofl) && /SIL Open Font License, Version 1\.1/.test(fs.readFileSync(ofl, 'utf8'));
}));
T.done();
