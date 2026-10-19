// DragonBreak Online: outlaw bounties (Nate, 18 Oct: "bounties pay back in some way ... not a expense but a transaction").
// Loaded by gamemode.js after jail.js and bank.js.
//
// A hold's ruler or Steward (a Lead GM too) puts a bounty of up to max gold on a character, with a reason: /bounty set.
// The bounty is the hold's own: it is claimed only when the outlaw is jailed in that hold (hold only, Nate). The outlaw
// then pays it as a fine, from the gold they carry and then from their bank account, into the hold's treasury (payJailer
// true restores the first design, where it all went to the guard who locked them in). What they cannot pay is served as
// extra time in the cell, a minute for every goldPerMinute gold. An outlaw may pay their own bounty first (/bounty pay,
// standing in the hold); that gold goes to the hold's treasury. The hold itself never pays a bounty.
//
// Bounty hunting shares (Nate, 18-19 Oct: factions earn through roleplay, no new gold): of a bounty PAID at the jail,
// hunterShare (0.25) goes to the treasury of the faction of whoever brought the outlaw in (jail.js: the one carrying
// them, else the one who bound them, else the guard at the door); the hold keeps the rest, and only what it keeps is
// marked as its income for the Imperial tithe. Time served pays no share. The faction: one in hunterFactions the arrester
// belongs to, else their only faction, else the one they rank highest in; never the outlaw's own, never for staff. An
// official of the hold itself (its guards) or a member of no faction leaves it all with the hold: no personal payout.
//
// State: outlaws.json beside the server, { zones: { <zone id>: { <profile id>: { amount, reason, name, by, at } } } }
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, system, audit, who, display, cfg, registerChatCommand, zoneOfActor, zoneById, readOfficials,
    profileOf, officialTarget, onlineActors, giveItem, isLeadStaff, onUi } = api;
  const C = Object.assign({ enabled: true, max: 1000, goldPerMinute: 10, maxExtraMinutes: 240,
    payJailer: false, hunterShare: 0.25, hunterFactions: ['imperial-legion', 'fighters-guild'] }, cfg.outlaws || {});
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

  // ---- bounty hunting shares --------------------------------------------------------------------------------------------
  const guildsOf = (a) => { try { return typeof globalThis.__dboGuildsOf === 'function' ? globalThis.__dboGuildsOf(a >>> 0) || [] : []; } catch (e) { return []; } };
  const isStaffActor = (a) => { try { if (typeof globalThis.__dboIsStaff === 'function') return globalThis.__dboIsStaff(a >>> 0) === true; } catch (e) { /* no gamemode */ } return !!isLeadStaff(a); };
  // An office of this hold (its ruler, Steward, guards...): the hold's own man, so the hold keeps it all
  const holdOfficial = (a, zid) => { const pid = pidOf(a); const seats = (readOfficials() || {})[zid] || {}; return pid >= 0 && Object.values(seats).some((l) => Array.isArray(l) && l.map(Number).includes(pid)); };
  const shareRate = () => { const r = Number(C.hunterShare); return Number.isFinite(r) ? Math.max(0, Math.min(1, r)) : 0; };
  // Rank standing within a faction, 0 the leader .. 1 the lowest rank (guild-defs lists the leader first)
  const standing = (g) => {
    try { const list = typeof globalThis.__dboGuildRankList === 'function' ? globalThis.__dboGuildRankList(g.id) || [] : []; const i = list.findIndex((r) => r.title === g.title); if (i >= 0 && list.length > 1) return i / (list.length - 1); } catch (e) { /* unknown */ }
    return g.role === 'leader' ? 0 : g.role === 'officer' ? 0.25 : 1;
  };
  // Which faction a share goes to: { fid, name } or { why } when the hold keeps it
  const hunterFactionOf = (arrester, outlaw, zid) => {
    if (!arrester) return { why: 'nobody brought them in' };
    if (isStaffActor(arrester)) return { why: 'staff arrests earn no share' };
    if (holdOfficial(arrester, zid)) return { why: `${who(arrester)} serves ${holdName(zid)} itself` };
    const own = new Set(guildsOf(outlaw).map((g) => g.id));
    let holdFid = null; try { holdFid = typeof globalThis.__dboHoldFactionOf === 'function' ? globalThis.__dboHoldFactionOf(zid) : null; } catch (e) { holdFid = null; }
    const all = guildsOf(arrester);
    const mine = all.filter((g) => !own.has(g.id));
    if (!mine.length) return { why: all.length ? 'the outlaw shares their factions' : `${who(arrester)} belongs to no faction` };
    const flagged = (C.hunterFactions || []).map(String);
    const pick = mine.find((g) => flagged.includes(g.id)) || (mine.length === 1 ? mine[0] : mine.slice().sort((x, y) => standing(x) - standing(y))[0]);
    if (pick.id === holdFid) return { why: `${pick.name} is ${holdName(zid)}'s own` };
    return { fid: pick.id, name: pick.name || pick.id };
  };
  // Leaders of a faction who are online hear of a share
  const tellLeaders = (fid, text) => { for (const x of onlineActors()) if (guildsOf(x).some((g) => g.id === fid && g.role === 'leader')) personal(x, text); };
  const toHold = (zid, n) => { if (!(n > 0)) return 0; try { return globalThis.__dboTreasuryZone ? Number(globalThis.__dboTreasuryZone.deposit(zid, n, { income: 'bounties' })) || 0 : 0; } catch (e) { log('outlaws: treasury deposit failed', e.message); return 0; } };

  // ---- the jail: jail.js asks how many minutes to add when it locks someone in -----------------------------------------
  // The bounty of the hold the cell stands in is claimed: paid as far as the outlaw can (the hold's, less the hunter's
  // faction share), the rest served. arrester: who brought them in (jail.js), else the guard
  globalThis.__dboOutlawJailed = (guard, prisoner, arrester) => {
    if (!C.enabled) return 0;
    const zid = zoneOfActor(prisoner); if (!zid) return 0;
    const list = data().zones[zid]; const key = String(pidOf(prisoner));
    const b = list && list[key]; if (!b) return 0;
    delete list[key]; save();
    const amount = Math.max(0, Math.floor(Number(b.amount) || 0));
    const paid = collect(prisoner, amount, `bounty ${holdName(zid)}`);
    const by = Number(arrester) >>> 0 || guard >>> 0;
    let where = '', share = 0, fac = null, kept = 0;
    if (C.payJailer === true) {
      if (paid > 0) giveItem(guard, GOLD, paid);
      where = `${paid} paid to the jailer`;
    } else if (paid > 0) {
      const h = hunterFactionOf(by, prisoner, zid);
      share = h.fid ? Math.min(paid, Math.floor(paid * shareRate())) : 0;
      if (share > 0) {
        let okShare = false;
        try { const T = globalThis.__dboTreasury; okShare = !!(T && typeof T.deposit === 'function' && T.deposit(h.fid, share, `bounty share: ${b.name} brought in to ${holdName(zid)} by ${who(by)}`, { income: 'bounty share' })); } catch (e) { log('outlaws: share deposit failed', e.message); }
        if (okShare) fac = h; else { share = 0; h.why = `the treasury of ${h.name} would not take it`; }
      }
      kept = toHold(zid, paid - share);
      where = `${kept}/${paid - share} to the ${holdName(zid)} treasury, ${fac ? `${share} share to ${fac.fid}` : `no share (${h.why || 'none due'})`}`;
      if (fac) {
        audit(`BOUNTY share: ${share} gold of ${who(prisoner)}'s ${paid} gold bounty paid in ${holdName(zid)} to the treasury of ${fac.fid}, brought in by ${who(by)} (${Math.round(shareRate() * 100)}%)`);
        tellLeaders(fac.fid, `${display(by)} brought ${display(prisoner)} in to ${holdName(zid)}'s jail: ${share} gold of the bounty went to the treasury of ${fac.name}.`);
      }
    }
    const short = amount - paid;
    const extra = short > 0 ? Math.min(Number(C.maxExtraMinutes) || 0, Math.ceil(short / Math.max(1, Number(C.goldPerMinute) || 10))) : 0;
    system(prisoner, `Your bounty in ${holdName(zid)} (${amount} gold) is settled: ${paid} gold paid${extra ? `, and ${extra} more minutes in the cell for the ${short} you could not pay` : ''}.`);
    const told = C.payJailer === true
      ? (paid ? `You collect ${paid} gold of the bounty.` : 'They had no gold to pay it.')
      : (paid ? `${paid} gold of the bounty is paid to ${holdName(zid)}${fac ? `, ${share} of it to the treasury of ${fac.name}` : ''}.` : 'They had no gold to pay it.');
    personal(guard, `${display(prisoner)} was wanted in ${holdName(zid)} for ${amount} gold. ${told}${extra ? ` They serve ${extra} more minutes for the rest.` : ''}`);
    if (fac && by !== (guard >>> 0)) { try { if (onlineActors().map((x) => x >>> 0).includes(by)) personal(by, `${display(prisoner)} is in ${holdName(zid)}'s jail: ${share} gold of the bounty went to the treasury of ${fac.name}.`); } catch (e) { /* offline */ } }
    audit(`BOUNTY claimed: ${who(prisoner)} jailed in ${holdName(zid)} by ${who(guard)}${by !== (guard >>> 0) ? `, brought in by ${who(by)}` : ''}: ${amount} gold, ${paid} paid (${where || 'nothing'}), ${extra} min added`);
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
    try { if (globalThis.__dboTreasuryZone) globalThis.__dboTreasuryZone.deposit(zid, paid, { income: 'bounties' }); } catch (e) { log('outlaws: treasury deposit failed', e.message); }
    audit(`BOUNTY paid: ${who(a)} paid their ${amount} gold bounty in ${holdName(zid)} to its treasury`);
    return `You pay your bounty of ${amount} gold to ${holdName(zid)}. You are no longer wanted there.`;
  };
  // A bounty lifted from the journal names its outlaw by profile id, not by a name to look up again
  const clearByPid = (a, zid, pid) => {
    if (!zid) return 'Stand in the hold whose bounty you clear.';
    if (!mayDeclare(a, zid)) return `Only the ruler or the Steward of ${holdName(zid)} clears a bounty there.`;
    const list = data().zones[zid] || {}; const b = list[String(Number(pid))];
    if (!b) return 'That bounty is already gone.';
    delete list[String(Number(pid))]; save();
    audit(`BOUNTY cleared: ${who(a)} lifted the bounty on ${b.name} (profile ${pid}) in ${holdName(zid)}`);
    return `The bounty on ${b.name} in ${holdName(zid)} is lifted.`;
  };

  // ---- the F3 Wanted tab (front journal tab 'wanted'): the wanted list of the hold you stand in, your own bounties with
  // Pay where you stand, and for its ruler or Steward the form to set one and Clear on each ----------------------------------
  const tabView = (a) => {
    const zid = zoneOfActor(a);
    const pid = String(pidOf(a));
    return {
      hold: zid ? { id: zid, name: holdName(zid) } : null,
      wanted: zid ? Object.entries(data().zones[zid] || {}).map(([p, b]) => ({ pid: Number(p), name: b.name, amount: b.amount, reason: b.reason, by: b.by, at: b.at }))
        .sort((x, y) => y.amount - x.amount) : [],
      mine: Object.entries(data().zones).filter(([, l]) => l[pid]).map(([z, l]) => ({ zone: z, name: holdName(z), amount: l[pid].amount, reason: l[pid].reason, here: z === zid })),
      canDeclare: !!zid && mayDeclare(a, zid), max: Number(C.max), goldPerMinute: Number(C.goldPerMinute) || 10,
    };
  };
  const sections = globalThis.__dboJournalSections || (globalThis.__dboJournalSections = {});
  if (C.enabled) sections.wanted = {
    // Shown where a hold has outlaws, to an outlaw, and to a ruler or Steward; a badge while you are wanted
    visible: (a) => { const v = tabView(a); return v.mine.length ? { badge: v.mine.length } : (v.wanted.length || v.canDeclare); },
    view: (a) => tabView(a), label: () => 'Wanted',
  };
  else delete sections.wanted;
  const journalFresh = (a, args) => typeof globalThis.__dboJournalFresh === 'function' && !!globalThis.__dboJournalFresh(a, String((args || [])[0] || ''));
  if (typeof onUi === 'function') onUi('outlawJ', (a, args) => {
    if (!C.enabled || !journalFresh(a, args)) return;
    const act = () => {
      const zid = zoneOfActor(a); const what = String(args[1] || '');
      let text = '';
      try {
        if (what === 'set') text = setBounty(a, zid, `${String(args[2] || '').trim()} ${Math.floor(Number(args[3]) || 0)} ${String(args[4] || '').trim().slice(0, 120)}`);
        else if (what === 'clear') text = clearByPid(a, zid, args[2]);
        else if (what === 'pay') text = payBounty(a, zid);
        else text = 'That cannot be done.';
      } catch (e) { log('outlaws: tab action failed', e.stack || e.message); text = 'That cannot be done just now.'; }
      const refused = !/is wanted in|is lifted|no longer wanted/.test(text);
      return { tab: 'wanted', text, kind: refused ? 'refused' : 'ok' };
    };
    if (typeof globalThis.__dboJournalLimited === 'function') globalThis.__dboJournalLimited(a, act);
  });

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
  return { setBounty, clearBounty, clearByPid, payBounty, listText, mayDeclare, tabView };
};
