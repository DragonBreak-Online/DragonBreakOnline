// DragonBreak Online: outlaw bounties (Nate, 18 Oct: "bounties pay back in some way ... not a expense but a transaction").
// Loaded by gamemode.js after jail.js and bank.js.
//
// A hold's ruler or Steward (a Lead GM too) puts a bounty of up to max gold on a character, with a reason: /bounty set.
// The bounty is the hold's own: it is claimed only when the outlaw is jailed in that hold (hold only, Nate). The outlaw
// then pays it as a fine, from the gold they carry and then from their bank account, and it goes to the one who locked
// them in. What they cannot pay is served as extra time in the cell, a minute for every goldPerMinute gold. An outlaw may
// pay their own bounty first (/bounty pay, standing in the hold); that gold goes to the hold's treasury. The hold itself
// never pays a bounty.
//
// State: outlaws.json beside the server, { zones: { <zone id>: { <profile id>: { amount, reason, name, by, at } } } }
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, system, audit, who, display, cfg, registerChatCommand, zoneOfActor, zoneById, readOfficials,
    profileOf, officialTarget, onlineActors, giveItem, isLeadStaff } = api;
  const C = Object.assign({ enabled: true, max: 1000, goldPerMinute: 10, maxExtraMinutes: 240 }, cfg.outlaws || {});
  const FILE = path.resolve('outlaws.json');
  const GOLD = 0xf;
  const S = globalThis.__dboOutlaws || (globalThis.__dboOutlaws = { data: null });
  const data = () => {
    if (!S.data) { try { S.data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { S.data = {}; } }
    if (!S.data.zones || typeof S.data.zones !== 'object') S.data.zones = {};
    return S.data;
  };
  const save = () => {
    try { const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data(), null, 1)); fs.renameSync(tmp, FILE); }
    catch (e) { log('outlaws: saving failed', e.message); }
  };
  const holdName = (zid) => { const z = zoneById(zid); return z ? z.name : zid; };
  const wantedIn = (zid) => data().zones[zid] || (data().zones[zid] = {});
  const pidOf = (a) => Number(profileOf(a));

  // The ruler is the hold's first office; the Steward its 'steward'
  const mayDeclare = (a, zid) => {
    if (isLeadStaff(a)) return true;
    const z = zoneById(zid); if (!z) return false;
    const seats = (readOfficials() || {})[zid] || {};
    const pid = pidOf(a);
    const ruler = (z.officials || [])[0];
    return [ruler, 'steward'].some((o) => o && (seats[o] || []).map(Number).includes(pid));
  };

  // ---- gold: carried first, then the bank (bank.js keeps the balance on the character) ----------------------------
  const takeCarried = (a, n) => {
    try {
      const inv = mp.get(a, 'inventory');
      const entries = (inv && Array.isArray(inv.entries) ? inv.entries : []).map((e) => Object.assign({}, e));
      const g = entries.find((e) => (Number(e.baseId) >>> 0) === GOLD);
      const have = g ? Math.max(0, Number(g.count) || 0) : 0;
      const take = Math.min(have, n);
      if (take <= 0) return 0;
      g.count = have - take;
      mp.set(a, 'inventory', { entries: entries.filter((e) => (Number(e.count) || 0) > 0) });
      return take;
    } catch (e) { log('outlaws: taking carried gold failed', e.message); return 0; }
  };
  const takeBank = (a, n, where) => {
    try { return typeof globalThis.__dboBankTake === 'function' ? Number(globalThis.__dboBankTake(a, n, where)) || 0 : 0; }
    catch (e) { log('outlaws: taking bank gold failed', e.message); return 0; }
  };
  const collect = (a, n, where) => { const carried = takeCarried(a, n); return carried + (carried < n ? takeBank(a, n - carried, where) : 0); };

  // ---- the jail: jail.js asks how many minutes to add when it locks someone in -----------------------------------------
  // The bounty of the hold the cell stands in is claimed: paid to the jailer as far as the outlaw can, the rest served
  globalThis.__dboOutlawJailed = (guard, prisoner) => {
    if (!C.enabled) return 0;
    const zid = zoneOfActor(prisoner); if (!zid) return 0;
    const list = data().zones[zid]; const key = String(pidOf(prisoner));
    const b = list && list[key]; if (!b) return 0;
    delete list[key]; save();
    const amount = Math.max(0, Math.floor(Number(b.amount) || 0));
    const paid = collect(prisoner, amount, `bounty ${holdName(zid)}`);
    if (paid > 0) giveItem(guard, GOLD, paid);
    const short = amount - paid;
    const extra = short > 0 ? Math.min(Number(C.maxExtraMinutes) || 0, Math.ceil(short / Math.max(1, Number(C.goldPerMinute) || 10))) : 0;
    system(prisoner, `Your bounty in ${holdName(zid)} (${amount} gold) is settled: ${paid} gold paid${extra ? `, and ${extra} more minutes in the cell for the ${short} you could not pay` : ''}.`);
    personal(guard, `${display(prisoner)} was wanted in ${holdName(zid)} for ${amount} gold. ${paid ? `You collect ${paid} gold of the bounty.` : 'They had no gold to pay it.'}${extra ? ` They serve ${extra} more minutes for the rest.` : ''}`);
    audit(`BOUNTY claimed: ${who(prisoner)} jailed in ${holdName(zid)} by ${who(guard)}: ${amount} gold, ${paid} paid to the jailer, ${extra} min added`);
    return extra;
  };

  // ---- /bounty --------------------------------------------------------------------------------------------------------
  const listText = (a, zid) => {
    const lines = [];
    const mine = Object.entries(data().zones).filter(([, l]) => l[String(pidOf(a))]).map(([z, l]) => `${holdName(z)}: ${l[String(pidOf(a))].amount} gold (${l[String(pidOf(a))].reason})`);
    if (mine.length) lines.push(`You are wanted in ${mine.join('; ')}.`);
    if (!zid) { lines.push('Stand in a hold to read its wanted list.'); return lines.join(' '); }
    const here = Object.values(data().zones[zid] || {});
    lines.push(here.length ? `Wanted in ${holdName(zid)}: ${here.map((b) => `${b.name}, ${b.amount} gold (${b.reason})`).join('; ')}.` : `Nobody is wanted in ${holdName(zid)}.`);
    return lines.join(' ');
  };
  const setBounty = (a, zid, rest) => {
    if (!zid) return 'Stand in the hold whose bounty you set.';
    if (!mayDeclare(a, zid)) return `Only the ruler or the Steward of ${holdName(zid)} sets a bounty there.`;
    const m = /^(.+?)\s+(\d+)\s+(.+)$/.exec(String(rest || '').trim());
    if (!m) return `Usage: /bounty set <name or #TAG> <gold, up to ${C.max}> <reason>`;
    const amount = Number(m[2]);
    if (!(amount >= 1 && amount <= Number(C.max))) return `A bounty is 1 to ${C.max} gold.`;
    const tg = officialTarget(m[1]); if (tg.error) return tg.error;
    if (!(Number(tg.pid) >= 0)) return 'That character has no profile.';
    if (Number(tg.pid) === pidOf(a)) return 'You cannot set a bounty on yourself.';
    const reason = m[3].trim().slice(0, 120);
    wantedIn(zid)[String(tg.pid)] = { amount, reason, name: tg.label, by: display(a), at: Date.now() };
    save();
    if (tg.online) system(tg.online, `${holdName(zid)} has put a bounty of ${amount} gold on you: ${reason}. Pay it with /bounty pay in the hold, or answer for it in its jail.`);
    audit(`BOUNTY set: ${who(a)} put ${amount} gold on ${tg.who} in ${holdName(zid)}: ${reason}`);
    return `${tg.label} is wanted in ${holdName(zid)} for ${amount} gold.`;
  };
  const clearBounty = (a, zid, rest) => {
    if (!zid) return 'Stand in the hold whose bounty you clear.';
    if (!mayDeclare(a, zid)) return `Only the ruler or the Steward of ${holdName(zid)} clears a bounty there.`;
    const tg = officialTarget(String(rest || '').trim()); if (tg.error) return tg.error;
    const list = data().zones[zid] || {};
    if (!list[String(tg.pid)]) return `${tg.label} is not wanted in ${holdName(zid)}.`;
    delete list[String(tg.pid)]; save();
    if (tg.online) system(tg.online, `Your bounty in ${holdName(zid)} is lifted.`);
    audit(`BOUNTY cleared: ${who(a)} lifted the bounty on ${tg.who} in ${holdName(zid)}`);
    return `The bounty on ${tg.label} in ${holdName(zid)} is lifted.`;
  };
  const payBounty = (a, zid) => {
    if (!zid) return 'Stand in the hold whose bounty you pay.';
    const list = data().zones[zid] || {}; const key = String(pidOf(a));
    const b = list[key]; if (!b) return `You are not wanted in ${holdName(zid)}.`;
    const amount = Math.floor(Number(b.amount) || 0);
    let carried = 0; try { const inv = mp.get(a, 'inventory'); const g = ((inv && inv.entries) || []).find((e) => (Number(e.baseId) >>> 0) === GOLD); carried = g ? Number(g.count) || 0 : 0; } catch (e) { carried = 0; }
    let bank = 0; try { bank = Math.max(0, Math.floor(Number(mp.get(a, 'private.bankGold')) || 0)); } catch (e) { bank = 0; }
    if (carried + bank < amount) return `Your bounty in ${holdName(zid)} is ${amount} gold, more than you have.`;
    const paid = collect(a, amount, `bounty ${holdName(zid)}`);
    if (paid < amount) { if (paid > 0) giveItem(a, GOLD, paid); return 'The payment did not go through. Nothing was taken.'; }
    delete list[key]; save();
    try { if (globalThis.__dboTreasuryZone) globalThis.__dboTreasuryZone.deposit(zid, paid); } catch (e) { log('outlaws: treasury deposit failed', e.message); }
    audit(`BOUNTY paid: ${who(a)} paid their ${amount} gold bounty in ${holdName(zid)} to its treasury`);
    return `You pay your bounty of ${amount} gold to ${holdName(zid)}. You are no longer wanted there.`;
  };
  if (typeof registerChatCommand === 'function') {
    registerChatCommand('bounty', (a, args) => {
      if (!C.enabled) return personal(a, 'Outlaw bounties are not in force.');
      const [sub, ...rest] = String(args || '').trim().split(/\s+/);
      const zid = zoneOfActor(a);
      const s = String(sub || '').toLowerCase();
      if (!s || s === 'list') return personal(a, listText(a, zid));
      if (s === 'set') return personal(a, setBounty(a, zid, rest.join(' ')));
      if (s === 'clear') return personal(a, clearBounty(a, zid, rest.join(' ')));
      if (s === 'pay') return personal(a, payBounty(a, zid));
      personal(a, `Usage: /bounty (who is wanted here), /bounty pay, and for the ruler or Steward /bounty set <name or #TAG> <gold> <reason>, /bounty clear <name or #TAG>`);
    }, { help: '[set|clear|pay] outlaw bounties of the hold you stand in' });
  }
  log(`outlaws ${C.enabled ? 'on' : 'off'}: ${Object.values(data().zones).reduce((n, l) => n + Object.keys(l).length, 0)} bounties, up to ${C.max} gold, ${C.goldPerMinute} gold a minute unpaid`);
  return { setBounty, clearBounty, payBounty, listText, mayDeclare };
};
