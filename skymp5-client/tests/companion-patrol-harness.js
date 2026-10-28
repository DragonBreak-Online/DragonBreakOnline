// Scripted test for companionPatrol.ts and its use in companionService.ts: a GM's warband defending an area (server
// warband.js /warband defend) walks about in it while it holds with nothing to fight, instead of standing on its spot (Nat,
// 28 Oct: "it rubber-bands them back to the spot rather than patrol around"). Run from skymp5-client:
//
//   node tests/companion-patrol-harness.js [path to esbuild's package dir]
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const esbuildDir = [process.argv[2], path.resolve(__dirname, '../../skymp5-server/node_modules/esbuild'),
  path.join(os.homedir(), 'dragonbreak/fork/skymp5-server/node_modules/esbuild'), 'E:/DragonBreak Online Dev files/fork/skymp5-server/node_modules/esbuild'].find((p) => p && fs.existsSync(p));
if (!esbuildDir) { console.log('SKIP companion-patrol (no esbuild)'); process.exit(0); }
const esbuild = require(esbuildDir);

let failures = 0;
const check = (name, ok, got) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? '   ' + JSON.stringify(got) : ''}`);
  if (!ok) failures++;
};

function run(m) {
  const pkt = { customPacketType: 'companionPatrol', centre: [1000, -2000, 300], radius: 1200, ids: [0xff000101, 0xff000102, 0xff000103] };
  const p = m.parsePatrol(pkt);
  check('the server\'s packet reads as a patrol: centre, radius and members', p && p.radius === 1200 && p.centre.join() === '1000,-2000,300' && p.ids.length === 3, p);
  check('ids [] ends the patrol, even with a centre and radius', m.parsePatrol(Object.assign({}, pkt, { ids: [] })) === null && m.parsePatrol({ customPacketType: 'companionPatrol', ids: [] }) === null);
  check('a malformed centre or radius is no patrol', m.parsePatrol(Object.assign({}, pkt, { centre: [1, 2] })) === null && m.parsePatrol(Object.assign({}, pkt, { radius: -5 })) === null
    && m.parsePatrol(Object.assign({}, pkt, { radius: 'far' })) === null && m.parsePatrol(Object.assign({}, pkt, { centre: [1, NaN, 2] })) === null);

  // Every walk point lies inside the area, within 0.8 of its radius, at the centre's height
  let worst = 0, flat = true;
  const pts = [];
  for (const id of p.ids) for (let n = 1; n <= 200; n++) {
    const q = m.patrolPoint(p, id, n);
    worst = Math.max(worst, Math.hypot(q[0] - 1000, q[1] + 2000));
    if (q[2] !== 300) flat = false;
    pts.push(q);
  }
  check('600 walk points all lie within 0.8 of the radius (the area\'s edge is never a destination)', worst <= 1200 * 0.8 + 1e-6, worst);
  check('...at the centre\'s height', flat);
  check('...and they cover the area, not one spot (some beyond half the radius, some near the centre)', pts.some((q) => Math.hypot(q[0] - 1000, q[1] + 2000) > 600) && pts.some((q) => Math.hypot(q[0] - 1000, q[1] + 2000) < 300));
  const first = p.ids.map((id) => m.patrolPoint(p, id, 1).map(Math.round).join());
  check('members set out for different points', new Set(first).size === 3, first);
const dirs = p.ids.map((x) => { const q = m.patrolPoint(p, x, 1); return Math.round(Math.atan2(q[1] + 2000, q[0] - 1000) * 100); });
check('...in different directions from the centre, not one line', new Set(dirs).size === 3, dirs);
  check('a member\'s next walk goes somewhere new', m.patrolPoint(p, p.ids[0], 1).join() !== m.patrolPoint(p, p.ids[0], 2).join());
  check('the same member and walk give the same point (deterministic)', m.patrolPoint(p, p.ids[0], 5).join() === m.patrolPoint(p, p.ids[0], 5).join());

  // Timing: one walk every 15 s, staggered by up to 3 s per member
  const id = p.ids[0];
  check('a member walks at once the first time', m.patrolDue(0, 1e9, id));
  check('...not again before 15 s', !m.patrolDue(1e9, 1e9 + 14999, id));
  check('...and again by 18 s', m.patrolDue(1e9, 1e9 + 18000, id));
  const stagger = p.ids.map((x) => { let t = 15000; while (!m.patrolDue(0, t, x)) t += 100; return t; });
  check('members are staggered within 15-18 s, not all at once', stagger.every((t) => t >= 15000 && t <= 18000) && new Set(stagger).size > 1, stagger);

  // The service: the packet, the walk, the marker
  const src = fs.readFileSync(path.resolve(__dirname, '../src/services/services/companionService.ts'), 'utf8');
  check('companionService reads the companionPatrol packet, and an ended one clears the markers',
    /content\["customPacketType"\] === "companionPatrol"\) \{\s*this\.patrol = parsePatrol\(content\);\s*if \(!this\.patrol\) this\.clearPatrolMarkers\(\);/.test(src));
  check('the walk runs only in the staying branch, after stay()', /\} else if \(c\.staying\) \{\s*this\.stay\(actor, state, player\);\s*try \{ this\.patrolStep\(actor, c, state, now, player\);/.test(src));
  check('...and only with no target, out of combat, for a listed member', /if \(!p \|\| c\.target \|\| actor\.isInCombat\(\) \|\| !p\.ids\.includes\(c\.id >>> 0\)\) return;/.test(src));
  check('it walks with pathToReference to the member\'s own XMarker (Skyrim.esm 00003B), moved to the point first',
    /const XMARKER = 0x00003b;/.test(src) && /getFormFromFile\(XMARKER, "Skyrim\.esm"\)/.test(src) && /marker\.setPosition\(point\[0\], point\[1\], point\[2\]\)\.then\(/.test(src) && /a\.pathToReference\(m, 0\.5\)/.test(src));
  check('a new connection drops the patrol and its markers', /this\.setCompanions\(\[\]\);\s*this\.patrol = null;\s*this\.clearPatrolMarkers\(\);/.test(src));
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'claude-nate-companion-patrol-'));
  const out = path.join(tmp, 'companionPatrol.js');
  try {
    await esbuild.build({ entryPoints: [path.resolve(__dirname, '../src/services/services/companionPatrol.ts')], bundle: true,
      platform: 'node', format: 'cjs', outfile: out, logLevel: 'error' });
    run(require(out));
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* left for the OS */ }
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
