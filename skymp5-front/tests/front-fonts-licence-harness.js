// The front's fonts are ours to ship (Nat, 3 Nov: Futura PT, DIN Pro and Bankir-Retro came with an Adobe app and may not
// be redistributed): every @font-face in src/main.scss points at a file that is there, none at the old faces, and every
// file in src/fonts/ofl has its OFL licence beside it.
//   node tests/front-fonts-licence-harness.js        (from skymp5-front)
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = path.resolve(__dirname, '..', 'src');
let failures = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || got === undefined ? '' : '   ' + JSON.stringify(got)}`); if (!ok) failures++; };

const main = fs.readFileSync(path.join(SRC, 'main.scss'), 'utf8');
const urls = [...main.matchAll(/@font-face\s*\{[^}]*?src:\s*url\('([^']+)'\)/g)].map((m) => m[1]);
check('main.scss declares the faces', urls.length >= 10, urls.length);
const missing = urls.filter((u) => !fs.existsSync(path.join(SRC, u)));
check('every @font-face points at a file that is there', missing.length === 0, missing);
const OLD = /bankir-retro\.ttf|din-pro|futura-pt|Futura Condensed (Bold|Light|Medium)\.ttf/i;
check('none points at the old, unlicensed faces', !urls.some((u) => OLD.test(u)), urls.filter((u) => OLD.test(u)));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const left = walk(SRC).filter((f) => /\.(ttf|otf|woff2?)$/i.test(f) && OLD.test(path.basename(f)));
check('the old font files are gone from src', left.length === 0, left.map((f) => path.relative(SRC, f)));
const OFL = path.join(SRC, 'fonts', 'ofl');
const fonts = fs.readdirSync(OFL).filter((f) => /\.woff2$/.test(f));
const unlicensed = fonts.filter((f) => { const pkg = f.replace(/-latin(-ext)?-\d+-(normal|italic)\.woff2$/, ''); const lic = path.join(OFL, `${pkg}-OFL.txt`); return !fs.existsSync(lic) || !/SIL Open Font License/.test(fs.readFileSync(lic, 'utf8')); });
check('every OFL font file has its licence beside it', fonts.length > 0 && unlicensed.length === 0, unlicensed);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
