'use strict';
// npcoff.js: every listed ref gets isDisabled in batches, unknown refs are counted, enabled:false undoes it, a reload
// stops the previous pass. Run from the server folder: node tests/npcoff-harness.js
const path = require('path');
const assert = require('assert');
process.chdir(path.join(__dirname, '..'));
const data = require(path.resolve('npc-off.json'));
let ok = 0; const t = (name, f) => { f(); ok++; console.log('ok', name); };
const mkMp = (missingEvery) => {
  const st = new Map(); const ids = new Map(); let n = 0;
  return { st, mp: {
    getIdFromDesc: (d) => { n++; if (missingEvery && n % missingEvery === 0) throw new Error('no'); if (!ids.has(d)) ids.set(d, 0x01000000 + ids.size); return ids.get(d); },
    get: (id, p) => (p === 'isDisabled' ? st.get(id) === true : undefined),
    set: (id, p, v) => { assert.strictEqual(p, 'isDisabled'); st.set(id, v); },
  } };
};
const runAll = (cfg, m) => new Promise((res) => {
  const logs = [];
  delete require.cache[path.resolve('npcoff.js')];
  require(path.resolve('npcoff.js'))({ mp: m.mp, log: (...a) => logs.push(a.join(' ')), cfg: { npcOff: Object.assign({ tickMs: 1, perTick: 500, startDelayMs: 0 }, cfg) } });
  const w = () => (logs.some((l) => /^npcoff: (disabled|enabled)/.test(l)) ? res(logs) : setTimeout(w, 5)); w();
});
(async () => {
  t('list is pass 2: 3,493 unique refs, no mannequins', () => {
    assert.strictEqual(data.refs.length, 3493);
    assert.strictEqual(new Set(data.refs.map((r) => r[0].toLowerCase())).size, 3493);
    assert.ok(data.refs.every((r) => /^[0-9a-f]+:.+\.es[mpl]$/i.test(r[0])));
    assert.ok(!data.refs.some((r) => /mannequin/i.test(r[1])));
  });
  const m = mkMp(0);
  let logs = await runAll({}, m);
  t('all disabled', () => { assert.strictEqual(m.st.size, 3493); assert.ok([...m.st.values()].every((v) => v === true)); assert.ok(logs.some((l) => l.includes('disabled 3493 of 3493'))); });
  const m2 = mkMp(100);
  logs = await runAll({}, m2);
  t('missing refs counted, never thrown', () => { assert.ok(logs.some((l) => / 34 not found/.test(l)), logs.join('\n')); });
  logs = await runAll({ enabled: false }, m);
  t('enabled:false enables them again', () => { assert.ok([...m.st.values()].every((v) => v === false)); assert.ok(logs.some((l) => l.includes('enabled again 3493'))); });
  console.log(`${ok}/4 passed`);
  process.exit(ok === 4 ? 0 : 1);
})();
