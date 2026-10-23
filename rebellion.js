// DragonBreak Online: risings against a hold's ruler (Nate, 22 Oct 2026). Loaded by gamemode.js after realm.js, raids.js,
// citizenship.js and outlaws.js. Off until config rebellion.enabled is true (feature flags are switched on with Nate).
//
// The petition (secret). Any citizen of a hold (citizenship.js) who is not of its court starts one against the hold's
// ruler (its first office: Jarl, Count): /rebellion petition. It gets a code the starter hands on in character; other
// citizens sign with it (/rebellion sign <code>), one signature per account. The ruler and the court cannot sign against
// their own hold: anyone of an account seated in any of the hold's offices, and anyone of the hold's household (its own
// faction) above its Citizen rank. Nobody but the petition's starter and its leader sees who signed; the signers see only
// the count, and staff see everything (/rebellion show, the audit log). One petition per hold at a time; it lapses after
// petitionDays.
//
// The declaration (public). Once minSignatures accounts have signed AND minShare of the hold's citizen accounts (config
// thresholdMode 'any' takes either), the petition's leader (its starter, or a signer the starter hands it to) declares:
// /rebellion declare [death]. The signers become a temporary rebel faction (guilds.js kind 'rebellion', "The <Hold>
// Rising" or the name the leader chose through the charter name check), its leader in the faction's leader rank (a
// leadership seat: leadership.js refuses a leader who already holds one), and the rising is a war (realm.js, kind
// 'rebellion') of the rebels against the hold's own faction for the hold's capital, with noticeDays of notice and
// windowsPerWar battle windows. No fee and no muster. Its battles run while rebellion.enabled is on, even with war.enabled
// off. A citizen of the hold may join the declared rising until it ends (/rebellion join).
//
// Victory: taking the capital deposes the ruler and the whole court (each office unseated, its household rank with it),
// the rebel faction is dissolved, the capital goes back to the hold's own faction, and the rebels' claimant (the leader,
// or a signer the leader names) is seated as ruler "by the rebellion", taking the hold's treasury with the seat.
// Defeat (the last window closes, or the leader withdraws): everyone who rose becomes an outlaw of the hold: their
// citizenship of it is taken and barred for outlawDays, they are wanted there for outlawBounty gold (outlaws.js: the
// hold's guards jail them and the bounty is claimed), and they cannot rise again for outlawDays. No permadeath unless the
// rising was declared and accepted as a war to the death (realm.js deathWar). Peace (a treaty in the war) ends it with
// no outlaws. Every rising leaves the hold holdCooldownDays and everyone who rose charCooldownDays before another.
//
// Raids: while a rising is under way, the rebel leader may raid the hold's land for the loyalists' homes, and the ruler the
// same land for the declared rebels' homes (raids.js, its own rules: /rebellion raid <territory>).
//
// Chat: /rebellion [status] | petition [hold] | sign <code> | unsign | name <name> | leader <name|#TAG> |
//   claimant <name|#TAG> | abandon | declare [death] | join [hold] | raid <territory> | death accept|refuse | withdraw |
//   yield; staff: list | show <hold|id> | cancel <hold> | end <id> won|lost|peace|cancel.
// State in rebellion.json (runtime, gitignored): { nextId, petitions: { zone: petition }, risings: [rising],
//   holdCooldowns: { zone: until }, charCooldowns: { actorHex: until } }
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = (api) => {
  const { mp, log, personal, system, audit, who, cfg, registerChatCommand, onlineActors, every, profileOf, zoneById, readOfficials } = api;
  const isAdmin = typeof api.isAdmin === 'function' ? api.isAdmin : () => false;
  const isLeadStaff = typeof api.isLeadStaff === 'function' ? api.isLeadStaff : () => false;
  const zoneOfActor = typeof api.zoneOfActor === 'function' ? api.zoneOfActor : () => null;
  const rankTitle = typeof api.rankTitle === 'function' ? api.rankTitle : (r) => String(r);
  const officialTarget = typeof api.officialTarget === 'function' ? api.officialTarget : () => ({ error: 'Nobody can be looked up just now.' });
  const seatOfficial = typeof api.seatOfficial === 'function' ? api.seatOfficial : null;
  const unseatOfficialBy = typeof api.unseatOfficialBy === 'function' ? api.unseatOfficialBy : null;
  const accountActors = typeof api.accountActors === 'function' ? api.accountActors : () => [];
  const staffNote = typeof api.staffNote === 'function' ? api.staffNote : () => {};
  const rulerFit = typeof api.rulerFit === 'function' ? api.rulerFit : () => '';
  const sendPacket = typeof api.sendPacket === 'function' ? api.sendPacket : () => false;
  const nameOf = (a) => { try { const n = typeof api.ownNameOf === 'function' ? api.ownNameOf(a) : ''; return String(n || '') || `character ${hex(a)}`; } catch (e) { return `character ${hex(a)}`; } };
  const display = (a) => { try { return typeof api.display === 'function' ? api.display(a) : nameOf(a); } catch (e) { return nameOf(a); } };

  const C = Object.assign({
    enabled: false,
    // The petition's thresholds: accounts that signed, and their share of the hold's citizen accounts. thresholdMode
    // 'both' needs the two, 'any' either one
    minSignatures: 10, minShare: 0.25, thresholdMode: 'both', petitionDays: 14,
    // The war: a rising gives less notice than a declared war (7 days)
    noticeDays: 3, windowsPerWar: 3, windowHours: 2, deathWar: true,
    holdCooldownDays: 30, charCooldownDays: 14,
    // Defeat: barred from the hold's citizenship and from rising again for outlawDays, wanted for outlawBounty gold
    // (outlaws.js holds it to its own max)
    outlawDays: 30, outlawBounty: 1000,
    // The household ranks of the hold's own faction that are no court: these may sign
    courtExemptTitles: ['Citizen'],
    joinAfterDeclare: true,
  }, (cfg && cfg.rebellion) || {});
  const DAY = 86400000;
  const FILE = path.resolve('rebellion.json');
  const LIVE = new Set(['notice', 'active']);

  // ---- state, kept across hot reloads ----------------------------------------------------------------------------------
  const S = globalThis.__dboRebellion || (globalThis.__dboRebellion = { data: null });
  const fill = (d) => {
    for (const k of ['petitions', 'holdCooldowns', 'charCooldowns']) if (!d[k] || typeof d[k] !== 'object' || Array.isArray(d[k])) d[k] = {};
    if (!Array.isArray(d.risings)) d.risings = [];
    if (!(Number(d.nextId) >= 1)) d.nextId = 1 + d.risings.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
    return d;
  };
  const data = () => {
    if (S.data) return S.data;
    let d = null; try { d = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { d = null; }
    S.data = fill(d && typeof d === 'object' ? d : {});
    return S.data;
  };
  if (S.data) fill(S.data);
  const save = () => {
    try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(data(), null, 1)); fs.renameSync(FILE + '.tmp', FILE); }
    catch (e) { log('rebellion: saving failed', e.message); }
  };

  // ---- helpers ----------------------------------------------------------------------------------------------------------
  const fn = (n) => (typeof globalThis[n] === 'function' ? globalThis[n] : null);
  const call = (n, ...args) => { const f = fn(n); if (!f) return undefined; try { return f(...args); } catch (e) { log(`rebellion: ${n} failed`, e.message); return undefined; } };
  const hex = (a) => (Number(a) >>> 0).toString(16);
  const pidOf = (a) => { try { return Number(profileOf(a >>> 0)); } catch (e) { return -1; } };
  const exists = (a) => { try { mp.get(a >>> 0, 'type'); return true; } catch (e) { return false; } };
  const isOnline = (a) => onlineActors().includes(a >>> 0);
  const tell = (a, text) => { if (a && isOnline(a)) personal(a >>> 0, text); };
  const dateText = (t) => new Date(Number(t) || 0).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const staff = (a, what, text) => { try { staffNote(a, what, text); } catch (e) { log('rebellion: staff note failed', e.message); } };
  const announce = (text) => { for (const a of onlineActors()) { system(a, text); try { sendPacket(a, { customPacketType: 'dboBanner', text, seconds: 6 }); } catch (e) { /* old client */ } } };
  const zone = (zid) => { try { return zoneById(String(zid || '')) || null; } catch (e) { return null; } };
  const holdName = (zid) => { const z = zone(zid); return z ? z.name : String(zid); };
  const rulerOffice = (z) => ((z && z.officials) || [])[0];
  const seatsOf = (zid) => (readOfficials() || {})[zid] || {};
  const rulerPids = (z) => (seatsOf(z.id)[rulerOffice(z)] || []).map(Number);
  const holdFaction = (zid) => call('__dboHoldFactionOf', zid) || null;
  const factionName = (fid) => ((call('__dboGuildInfo', fid) || {}).name) || fid;
  const citizenHolds = (a) => call('__dboCitizenHolds', a >>> 0) || [];
  const citizenOf = (a, zid) => citizenHolds(a).includes(zid);
  const guildsOf = (a) => call('__dboGuildsOf', a >>> 0) || [];
  // A hold a rising may be against: one that grants citizenship (its first office a ruler's)
  const isHold = (zid) => { const z = zone(zid); return !!z && ['jarl', 'count'].includes(rulerOffice(z)) && !!holdFaction(z.id); };

  // The ruler and the court: anyone of an account seated in any of the hold's offices, or of its household above Citizen
  const ofCourt = (a, zid) => {
    const pid = pidOf(a);
    if (pid >= 0 && Object.values(seatsOf(zid)).some((list) => (list || []).map(Number).includes(pid))) return true;
    const fid = holdFaction(zid);
    const exempt = (C.courtExemptTitles || []).map((t) => String(t).toLowerCase());
    return !!fid && guildsOf(a).some((g) => g.id === fid && !exempt.includes(String(g.title || '').toLowerCase()));
  };
  const cooldownOf = (a) => { const t = Number(data().charCooldowns[hex(a)]) || 0; return t > Date.now() ? t : 0; };
  const holdCooldown = (zid) => { const t = Number(data().holdCooldowns[zid]) || 0; return t > Date.now() ? t : 0; };
  // Why this character may not put their name to a rising against zid, or ''
  const signRefusal = (a, zid) => {
    if (!citizenOf(a, zid)) return `Only a citizen of ${holdName(zid)} may rise against its ruler.`;
    if (ofCourt(a, zid)) return `You serve the court of ${holdName(zid)}; you cannot put your name to a rising against it.`;
    const cd = cooldownOf(a);
    if (cd) return `You rose not long ago. You may rise again from ${dateText(cd)}.`;
    return '';
  };

  // ---- petitions ---------------------------------------------------------------------------------------------------------
  const petitionOf = (zid) => {
    const p = data().petitions[zid];
    if (p && Date.now() > Number(p.expiresAt)) {
      delete data().petitions[zid]; save();
      audit(`REBELLION petition #${p.id} against ${holdName(zid)} lapsed with ${p.signers.length} signature(s)`);
      tell(p.leader.actor, `Your petition against the ruler of ${holdName(zid)} has lapsed: ${C.petitionDays} days passed without a rising.`);
      return null;
    }
    return p || null;
  };
  const petitionSignedBy = (a) => Object.keys(data().petitions).map(petitionOf).filter(Boolean).find((p) => p.signers.some((s) => (s.actor >>> 0) === (a >>> 0))) || null;
  const risingOf = (zid) => data().risings.find((r) => r.zone === zid && LIVE.has(r.status)) || null;
  const risingById = (id) => data().risings.find((r) => r.id === Number(id)) || null;
  // The signatures that still stand: a character that exists, is still a citizen, not of the court, not on a cooldown
  const validSigners = (p) => p.signers.filter((s) => exists(s.actor) && !signRefusal(s.actor, p.zone));
  const needed = (zid) => {
    const citizens = Number(call('__dboCitizenAccountCount', zid)) || 0;
    return { min: Math.max(1, Math.floor(Number(C.minSignatures) || 0)), share: Math.max(1, Math.ceil((Number(C.minShare) || 0) * citizens)), citizens };
  };
  const thresholdMet = (p) => {
    const n = new Set(validSigners(p).map((s) => s.pid)).size; const need = needed(p.zone);
    const met = C.thresholdMode === 'any' ? (n >= need.min || n >= need.share) : (n >= need.min && n >= need.share);
    return { n, need, met };
  };
  const needText = (t) => `${t.n} of ${C.thresholdMode === 'any' ? `either ${t.need.min} accounts or ${t.need.share}` : `${Math.max(t.need.min, t.need.share)}`} (${t.need.min} accounts${C.thresholdMode === 'any' ? ' or' : ' and'} ${Math.round((Number(C.minShare) || 0) * 100)}% of the hold's ${t.need.citizens} citizen accounts)`;
  const makeCode = () => { for (;;) { const c = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6); if (!Object.values(data().petitions).some((p) => p.code === c)) return c; } };
  const entry = (a) => ({ actor: a >>> 0, pid: pidOf(a), name: nameOf(a), at: Date.now() });

  const startPetition = (a, zid) => {
    if (!zid) return { error: 'Stand in the hold you would rise against, or name it: /rebellion petition <hold>.' };
    const z = zone(zid); if (!z || !isHold(zid)) return { error: 'That land has no throne to rise against.' };
    const no = signRefusal(a, zid); if (no) return { error: no };
    if (!rulerPids(z).length) return { error: `${z.name} has no ${rankTitle(rulerOffice(z), zid)} to rise against.` };
    const hc = holdCooldown(zid); if (hc) return { error: `${z.name} rose not long ago. No new rising may begin there before ${dateText(hc)}.` };
    if (risingOf(zid)) return { error: `${z.name} is already in revolt. /rebellion join to rise with it.` };
    if (petitionOf(zid)) return { error: `A petition already passes from hand to hand in ${z.name}. Find whoever carries it, and ask them for its word.` };
    if (petitionSignedBy(a)) return { error: 'You have already put your name to a petition. /rebellion unsign takes it back.' };
    const d = data();
    const p = { id: d.nextId++, zone: zid, code: makeCode(), startedAt: Date.now(), expiresAt: Date.now() + C.petitionDays * DAY, starter: entry(a), leader: entry(a), claimant: null, name: '', signers: [entry(a)] };
    d.petitions[zid] = p; save();
    audit(`REBELLION petition #${p.id} begun in secret against the ruler of ${z.name} by ${who(a)} (code ${p.code})`);
    staff(a, 'rebellion petition', `began a secret petition (#${p.id}) against the ruler of ${z.name}. Staff: /rebellion show ${zid}`);
    return { text: `You begin a secret petition against the ${rankTitle(rulerOffice(z), zid)} of ${z.name}. Its word is ${p.code}: those you trust sign it with /rebellion sign ${p.code}. It needs ${needText(thresholdMet(p))}, within ${C.petitionDays} days. Nobody but you and staff sees who signed.` };
  };
  const sign = (a, code) => {
    const p = Object.keys(data().petitions).map(petitionOf).filter(Boolean).find((x) => x.code === String(code || '').trim().toUpperCase());
    if (!p) return { error: 'No petition goes by that word.' };
    const no = signRefusal(a, p.zone); if (no) return { error: no };
    if (p.signers.some((s) => (s.actor >>> 0) === (a >>> 0))) return { error: 'Your name is on it already.' };
    if (p.signers.some((s) => s.pid === pidOf(a))) return { error: 'Another of your characters has signed it. One name per account.' };
    if (petitionSignedBy(a)) return { error: 'You have put your name to another petition. /rebellion unsign takes it back.' };
    p.signers.push(entry(a)); save();
    const t = thresholdMet(p);
    audit(`REBELLION petition #${p.id} (${holdName(p.zone)}) signed by ${who(a)}: ${t.n} account(s)`);
    for (const x of new Set([p.starter.actor >>> 0, p.leader.actor >>> 0])) tell(x, `${nameOf(a)} has signed your petition against the ruler of ${holdName(p.zone)}: ${needText(t)}.${t.met ? ' It has enough names: /rebellion declare when you are ready.' : ''}`);
    return { text: `You sign the petition against the ruler of ${holdName(p.zone)}. It has ${needText(t)}.` };
  };
  const unsign = (a) => {
    const p = petitionSignedBy(a); if (!p) return { error: 'Your name is on no petition.' };
    if ((p.starter.actor >>> 0) === (a >>> 0) || (p.leader.actor >>> 0) === (a >>> 0)) return { error: 'You carry this petition: /rebellion abandon tears it up.' };
    p.signers = p.signers.filter((s) => (s.actor >>> 0) !== (a >>> 0));
    if (p.claimant && (p.claimant.actor >>> 0) === (a >>> 0)) p.claimant = null;
    save();
    audit(`REBELLION petition #${p.id} (${holdName(p.zone)}): ${who(a)} took their name back`);
    return { text: 'You take your name back from the petition.' };
  };
  // The petition this character carries (its starter or leader)
  const carried = (a) => Object.keys(data().petitions).map(petitionOf).filter(Boolean).find((p) => (p.leader.actor >>> 0) === (a >>> 0) || (p.starter.actor >>> 0) === (a >>> 0)) || null;
  // q: a name or #TAG (chat), or { actor } (the panel's signer list, which names the very signer)
  const signerByQuery = (p, q) => {
    if (q && typeof q === 'object') {
      const s = p.signers.find((x) => (x.actor >>> 0) === (Number(q.actor) >>> 0));
      return s ? { s } : { error: 'They have not signed the petition.' };
    }
    const tg = officialTarget(q); if (tg.error) return { error: tg.error };
    const s = p.signers.find((x) => (x.actor >>> 0) === (tg.actor >>> 0));
    return s ? { s } : { error: `${tg.label} has not signed the petition.` };
  };
  const setLeader = (a, q) => {
    const p = carried(a); if (!p || (p.starter.actor >>> 0) !== (a >>> 0)) return { error: 'Only the one who began the petition hands on its leadership.' };
    const f = signerByQuery(p, q); if (f.error) return f;
    p.leader = Object.assign({}, f.s); save();
    audit(`REBELLION petition #${p.id} (${holdName(p.zone)}): ${who(a)} handed its leadership to ${f.s.name}`);
    tell(f.s.actor, `${nameOf(a)} hands you the petition against the ruler of ${holdName(p.zone)}: you lead it now. /rebellion status shows it.`);
    return { text: `${f.s.name} leads the petition now.` };
  };
  const setClaimant = (a, q) => {
    const p = carried(a); if (!p || (p.leader.actor >>> 0) !== (a >>> 0)) return { error: 'Only the petition\'s leader names who would take the throne.' };
    const f = signerByQuery(p, q); if (f.error) return f;
    const z = zone(p.zone); const unfit = rulerFit(f.s.actor, z, rulerOffice(z));
    if (unfit) return { error: unfit };
    p.claimant = Object.assign({}, f.s); save();
    audit(`REBELLION petition #${p.id} (${holdName(p.zone)}): ${who(a)} names ${f.s.name} to take the throne`);
    return { text: `${f.s.name} would take the throne of ${holdName(p.zone)}.` };
  };
  const setName = (a, raw) => {
    const p = carried(a); if (!p || (p.leader.actor >>> 0) !== (a >>> 0)) return { error: 'Only the petition\'s leader names the rising.' };
    if (!fn('__dboCharterNameCheck')) return { error: 'Names cannot be checked just now (the charter system is not loaded), so none can be given. Tell staff.' };
    const chk = call('__dboCharterNameCheck', raw, 'company') || {};
    if (chk.error) return { error: chk.error };
    p.name = String(chk.name || raw).trim(); save();
    audit(`REBELLION petition #${p.id} (${holdName(p.zone)}): ${who(a)} names the rising ${p.name}`);
    return { text: `If it comes to it, the rising will be ${p.name}.` };
  };
  const abandon = (a) => {
    const p = carried(a); if (!p) return { error: 'You carry no petition.' };
    delete data().petitions[p.zone]; save();
    audit(`REBELLION petition #${p.id} against ${holdName(p.zone)} torn up by ${who(a)}`);
    return { text: 'You tear up the petition.' };
  };
  const defaultName = (zid) => `The ${holdName(zid).replace(/^The /, '').replace(/ Hold$/, '')} Rising`;

  // ---- the declaration ---------------------------------------------------------------------------------------------------
  const declare = (a, toDeath) => {
    if (!C.enabled) return { error: 'Risings are not in force.' };
    const p = carried(a); if (!p || (p.leader.actor >>> 0) !== (a >>> 0)) return { error: 'Only the petition\'s leader declares the rising.' };
    const z = zone(p.zone);
    const no = signRefusal(a, p.zone); if (no) return { error: no };
    const t = thresholdMet(p); if (!t.met) return { error: `The petition has ${needText(t)}. It needs more names.` };
    if (!rulerPids(z).length) return { error: `${z.name} has no ${rankTitle(rulerOffice(z), z.id)} to rise against.` };
    const hc = holdCooldown(z.id); if (hc) return { error: `${z.name} rose not long ago. No rising may begin there before ${dateText(hc)}.` };
    const holdFid = holdFaction(z.id);
    const cap = call('__dboRealmHoldCapital', z.id);
    if (!holdFid || !cap) return { error: `${z.name} has no seat of power to take.` };
    if (call('__dboRealmOwnerOf', cap.id) !== holdFid) return { error: `${cap.name} is not in the hands of ${z.name}'s own court; a rising takes the throne from its ruler.` };
    if (!fn('__dboRealmStartWar') || !fn('__dboRebelFactionFound')) return { error: 'The realm is not ready for a rising just now. Tell staff.' };
    const claimant = p.claimant && exists(p.claimant.actor) && !signRefusal(p.claimant.actor, z.id) ? p.claimant : p.leader;
    const unfit = rulerFit(claimant.actor, z, rulerOffice(z));
    if (unfit) return { error: `${unfit} Name another to take the throne: /rebellion claimant <name>.` };
    const id = data().nextId++;
    const fid = `rising-${z.id}-${id}`;
    if ((claimant.actor >>> 0) !== (a >>> 0)) {
      const busy = call('__dboLeadershipRefusal', claimant.actor, null);
      if (busy) return { error: `${busy} Name another to take the throne.` };
    }
    const signers = validSigners(p).map((s) => s.actor >>> 0);
    const made = call('__dboRebelFactionFound', { id: fid, name: p.name || defaultName(z.id), rebellion: id, zone: z.id }, a >>> 0, signers) || { error: 'The rising could not be raised.' };
    if (made.error) return { error: made.error };
    const war = call('__dboRealmStartWar', { attacker: fid, defender: holdFid, goal: [cap.id], by: pidOf(a), noticeDays: C.noticeDays, windowsPerWar: C.windowsPerWar,
      windowHours: C.windowHours, death: !!toDeath && C.deathWar, kind: 'rebellion', rebellion: id }) || { ok: false, text: 'The war could not begin.' };
    if (!war.ok) { call('__dboRebelFactionDissolve', fid); return { error: war.text }; }
    const r = { id, zone: z.id, faction: fid, name: made.name, petition: p.id, warId: war.war.id, holdFaction: holdFid, capital: cap.id, status: 'notice',
      leader: Object.assign({}, p.leader), claimant: Object.assign({}, claimant), declaredAt: Date.now(), startsAt: war.war.startsAt,
      rebels: made.joined.map((x) => ({ actor: x, pid: pidOf(x), name: nameOf(x) })), refused: made.refused.map((x) => ({ actor: x.actor, why: x.why })), endedAt: 0, outcome: '' };
    data().risings.push(r);
    delete data().petitions[z.id];
    save();
    audit(`REBELLION #${id} declared by ${who(a)} against the ruler of ${z.name}: ${r.name} (${fid}), ${r.rebels.length} rebel(s): ${r.rebels.map((x) => x.name).join(', ')}; war ${r.warId} for ${cap.name}, first battle ${dateText(r.startsAt)}${war.war.death ? '; proposed to the death' : ''}${r.refused.length ? `; not taken in: ${r.refused.map((x) => `${hex(x.actor)} (${x.why})`).join('; ')}` : ''}`);
    staff(a, 'rebellion declared', `declared ${r.name} (#${id}) against the ruler of ${z.name} with ${r.rebels.length} rebels; first battle ${dateText(r.startsAt)}. /rebellion show ${id}`);
    announce(`${z.name} is in revolt! ${r.name}, led by ${nameOf(a)}, rises against its ${rankTitle(rulerOffice(z), z.id)}. The first battle for ${cap.name} is ${dateText(r.startsAt)}.`);
    for (const x of onlineActors()) if (ofCourt(x, z.id) && war.war.death) personal(x, `The rebels ask for a war to the death. The ${rankTitle(rulerOffice(z), z.id)} answers with /rebellion death accept or /rebellion death refuse before the first battle.`);
    for (const x of r.refused) tell(x.actor, `You could not be taken into ${r.name}: ${x.why}`);
    return { text: `${r.name} has risen: ${r.rebels.length} rebels, its first battle for ${cap.name} at ${dateText(r.startsAt)}. Join them with /rebellion join; raid the loyalists with /rebellion raid <territory>.` };
  };
  const join = (a, zid) => {
    if (!C.enabled) return { error: 'Risings are not in force.' };
    const r = zid ? risingOf(zid) : data().risings.find((x) => LIVE.has(x.status) && citizenOf(a, x.zone));
    if (!r) return { error: 'There is no rising here to join.' };
    if (!C.joinAfterDeclare) return { error: 'The rising takes no one after its declaration.' };
    const no = signRefusal(a, r.zone); if (no) return { error: no };
    const err = call('__dboRebelFactionJoin', r.faction, a >>> 0);
    if (err) return { error: err };
    if (!r.rebels.some((x) => (x.actor >>> 0) === (a >>> 0))) r.rebels.push({ actor: a >>> 0, pid: pidOf(a), name: nameOf(a) });
    save();
    audit(`REBELLION #${r.id} (${holdName(r.zone)}): ${who(a)} joined ${r.name}`);
    for (const x of r.rebels) if ((x.actor >>> 0) !== (a >>> 0)) tell(x.actor, `${nameOf(a)} has joined ${r.name}.`);
    return { text: `You rise with ${r.name}. Win the throne, and the hold is yours; lose, and you are an outlaw of ${holdName(r.zone)}.` };
  };

  // ---- the end of a rising ---------------------------------------------------------------------------------------------
  const targetOf = (pid, actor) => {
    const on = onlineActors().find((x) => pidOf(x) === Number(pid)) || 0;
    const a = (actor >>> 0) || accountActors(Number(pid))[0] || 0;
    return { pid: Number(pid), actor: a, online: on, label: a ? nameOf(a) : `profile ${pid}`, who: a ? who(a) : `profile ${pid}` };
  };
  // Every office of the hold unseated through the court's own path, so the household ranks follow
  const depose = (r) => {
    const z = zone(r.zone); if (!z) return;
    const o = readOfficials() || {};
    const pids = [...new Set(Object.values(o[z.id] || {}).flat().map(Number))];
    for (const pid of pids) { if (unseatOfficialBy) { const x = unseatOfficialBy(z, targetOf(pid, 0), `the rising ${r.name}`); if (x && x.error) log(`rebellion: unseating profile ${pid}: ${x.error}`); } }
    audit(`REBELLION #${r.id}: the court of ${z.name} is deposed (${pids.length} official(s))`);
  };
  const cooldownAll = (r, days) => {
    const until = Date.now() + days * DAY;
    for (const x of r.rebels) data().charCooldowns[hex(x.actor)] = Math.max(Number(data().charCooldowns[hex(x.actor)]) || 0, until);
    data().holdCooldowns[r.zone] = Date.now() + C.holdCooldownDays * DAY;
  };
  const seatClaimant = (r) => {
    const z = zone(r.zone); const office = rulerOffice(z);
    for (const c of [r.claimant, r.leader]) {
      if (!c || !exists(c.actor) || !seatOfficial) continue;
      const unfit = rulerFit(c.actor, z, office); if (unfit) { log(`rebellion: ${c.name} cannot take the throne: ${unfit}`); continue; }
      const res = seatOfficial(z, office, targetOf(pidOf(c.actor) >= 0 ? pidOf(c.actor) : c.pid, c.actor), { who: 'the rebellion', staff: false, via: `, by the rising ${r.name}` });
      if (res && res.error) { log(`rebellion: seating ${c.name}: ${res.error}`); continue; }
      return c;
    }
    return null;
  };
  // how: 'won' | 'lost' | 'peace' | 'staff'
  const settle = (r, how, why) => {
    if (!r || !LIVE.has(r.status)) return;
    const z = zone(r.zone);
    // Everyone on the roll at the end, and everyone who rose and left it before: they rose
    for (const x of call('__dboGuildMembers', r.faction) || []) if (!r.rebels.some((y) => (y.actor >>> 0) === (x >>> 0))) r.rebels.push({ actor: x >>> 0, pid: pidOf(x), name: nameOf(x) });
    r.status = how === 'won' ? 'won' : how === 'lost' ? 'lost' : how === 'peace' ? 'peace' : 'cancelled';
    r.endedAt = Date.now(); r.outcome = why || r.status;
    save();
    // The rebel faction goes first: its leader's seat is free for the throne
    call('__dboRebelFactionDissolve', r.faction);
    if (how === 'won') {
      if (call('__dboRealmOwnerOf', r.capital) !== r.holdFaction) call('__dboRealmRestoreOwner', r.capital, r.holdFaction, `the rising ${r.name} took the throne`);
      const seated = seatClaimant(r);
      r.ruler = seated ? Object.assign({}, seated) : null;
      cooldownAll(r, C.charCooldownDays);
      save();
      audit(`REBELLION #${r.id} WON: ${r.name} took the throne of ${z ? z.name : r.zone}; ${seated ? `${seated.name} is its ${rankTitle(rulerOffice(z), r.zone)}` : 'nobody could be seated: the throne stands empty'}`);
      announce(`${r.name} has taken the throne of ${z ? z.name : r.zone}.${seated ? ` ${seated.name} rules as ${rankTitle(rulerOffice(z), r.zone)}.` : ''}`);
    } else if (how === 'lost') {
      const until = Date.now() + C.outlawDays * DAY;
      for (const x of r.rebels) {
        const c = call('__dboCitizenOutlaw', x.actor, r.zone, until, `the failed rising ${r.name}`) || {};
        const pid = pidOf(x.actor) >= 0 ? pidOf(x.actor) : x.pid;
        call('__dboOutlawDeclare', r.zone, pid, C.outlawBounty, `rose with ${r.name}`, x.name, `the court of ${z ? z.name : r.zone}`);
        data().charCooldowns[hex(x.actor)] = Math.max(Number(data().charCooldowns[hex(x.actor)]) || 0, until);
        tell(x.actor, `${r.name} has failed. You are an outlaw of ${z ? z.name : r.zone}: ${c.removed ? 'your citizenship is taken, ' : ''}you are wanted there for your part in it, and barred from its citizenship until ${dateText(until)}.${c.auto ? ' (You stay its citizen through the faction or court you serve there.)' : ''}`);
      }
      data().holdCooldowns[r.zone] = Date.now() + C.holdCooldownDays * DAY;
      save();
      audit(`REBELLION #${r.id} LOST: ${r.name} failed (${r.outcome}); ${r.rebels.length} outlaw(s) of ${z ? z.name : r.zone} until ${dateText(until)}: ${r.rebels.map((x) => x.name).join(', ')}`);
      announce(`${r.name} has failed. Its rebels are outlaws of ${z ? z.name : r.zone}.`);
    } else {
      cooldownAll(r, C.charCooldownDays);
      save();
      audit(`REBELLION #${r.id} ended (${r.status}): ${r.outcome}`);
      if (how === 'peace') announce(`${r.name} has made peace with the court of ${z ? z.name : r.zone}.`);
    }
  };
  // realm.js, mid-capture: the rising takes the capital; the court is unseated before realm clears the officials
  globalThis.__dboRebellionCapitalFalling = (w) => { const r = risingById(w && w.rebellion); if (r && LIVE.has(r.status)) depose(r); };
  // realm.js, right after: the rising has won
  globalThis.__dboRebellionCapitalTaken = (w) => {
    const r = risingById(w && w.rebellion); if (!r || !LIVE.has(r.status)) return;
    settle(r, 'won', `${r.name} took ${(call('__dboRealmTerritory', r.capital) || { name: r.capital }).name}`);
    call('__dboRealmEndWar', r.warId, `${r.name} took the throne`, 'won');
  };
  // realm.js: the rising's war ended by its windows closing, a withdrawal, peace or staff
  globalThis.__dboRebellionWarEnded = (w, how) => {
    const r = risingById(w && w.rebellion); if (!r || !LIVE.has(r.status)) return;
    if (how === 'won') depose(r);
    settle(r, how, w.outcome);
  };
  // realm.js's tick runs the risings' battles while this is on, whatever war.enabled says
  globalThis.__dboRebellionOpen = () => !!C.enabled;
  // raids.js: whether a rising is under way, and its two sides
  globalThis.__dboRebellionLive = (id) => { const r = risingById(id); return !!C.enabled && !!r && LIVE.has(r.status); };
  globalThis.__dboRebellionRaidSides = (raider, target, tid) => {
    if (!C.enabled) return null;
    const t = call('__dboRealmTerritory', tid); if (!t) return null;
    const r = data().risings.find((x) => LIVE.has(x.status) && x.zone === t.zone && ((x.faction === raider && x.holdFaction === target) || (x.holdFaction === raider && x.faction === target)));
    return r ? { id: r.id, raided: target, rebels: r.faction } : null;
  };

  // ---- raids, the war's own answers ---------------------------------------------------------------------------------------
  const leadsRising = (a) => data().risings.find((r) => LIVE.has(r.status) && call('__dboRealmLeads', a, r.faction)) || null;
  const rulesRising = (a) => data().risings.find((r) => LIVE.has(r.status) && call('__dboRealmLeads', a, r.holdFaction)) || null;
  const raid = (a, tid) => {
    if (!C.enabled) return { error: 'Risings are not in force.' };
    if (!fn('__dboRaidStart')) return { error: 'Raids cannot be sent just now.' };
    const mine = leadsRising(a); const theirs = mine ? null : rulesRising(a);
    const r = mine || theirs; if (!r) return { error: 'Only a rising\'s leader, or the ruler it rises against, sends a raid.' };
    const t = call('__dboRealmTerritory', tid);
    if (!t || t.zone !== r.zone) return { error: `Name a territory of ${holdName(r.zone)}: ${(call('__dboRealmTerritoriesIn', r.zone) || []).map((x) => x.id).join(', ')}.` };
    const res = mine ? fn('__dboRaidStart')(a, r.faction, tid, r.holdFaction) : fn('__dboRaidStart')(a, r.holdFaction, tid, r.faction);
    if (res && res.ok) audit(`REBELLION #${r.id}: ${who(a)} sent a raid on ${t.name} against the ${mine ? 'loyalists' : 'rebels'}`);
    return res && res.ok ? { text: res.text } : { error: (res && res.text) || 'The raid could not be sent.' };
  };
  const answerDeath = (a, accept) => {
    const r = rulesRising(a); if (!r) return { error: 'Only the ruler a rising stands against answers it.' };
    const res = call('__dboRealmAnswerDeath', a, r.warId, accept) || { ok: false, text: 'There is nothing to answer.' };
    return res.ok ? { text: res.text } : { error: res.text };
  };
  const giveUp = (a, side) => {
    const r = side === 'rebels' ? leadsRising(a) : rulesRising(a);
    if (!r) return { error: side === 'rebels' ? 'You lead no rising.' : 'No rising stands against you.' };
    const res = call('__dboRealmSurrender', a, r.warId) || { ok: false, text: 'It cannot be done just now.' };
    if (res.ok) audit(`REBELLION #${r.id}: ${who(a)} ${side === 'rebels' ? 'withdrew the rising' : 'yielded the throne'}`);
    return res.ok ? { text: res.text } : { error: res.text };
  };

  // ---- status -----------------------------------------------------------------------------------------------------------
  const risingLine = (r, all) => {
    const w = call('__dboRealmWar', r.warId);
    return `#${r.id} ${r.name} against the ruler of ${holdName(r.zone)} [${r.status}]: led by ${r.leader.name}, ${r.claimant ? `${r.claimant.name} to take the throne, ` : ''}${r.rebels.length} rebel(s)${all || LIVE.has(r.status) ? ` (${r.rebels.map((x) => x.name).join(', ')})` : ''}${w ? `; battles ${w.windows.map((x) => dateText(x.start)).join(', ')}${w.death ? `; to the death: ${w.death}` : ''}` : ''}${r.outcome ? `; ${r.outcome}` : ''}`;
  };
  const status = (a) => {
    const lines = [];
    const p = petitionSignedBy(a);
    if (p) {
      const t = thresholdMet(p);
      const lead = (p.leader.actor >>> 0) === (a >>> 0) || (p.starter.actor >>> 0) === (a >>> 0);
      lines.push(`Your name is on the secret petition against the ruler of ${holdName(p.zone)}: ${needText(t)}${t.met ? ', enough to rise' : ''}. It lapses ${dateText(p.expiresAt)}.`);
      if (lead) lines.push(`You ${(p.leader.actor >>> 0) === (a >>> 0) ? 'lead it' : 'began it'}. Its word: ${p.code}. Signed: ${p.signers.map((s) => s.name).join(', ')}. To take the throne: ${(p.claimant || p.leader).name}. Name: ${p.name || defaultName(p.zone)}.`);
    }
    // Declared risings are public: anyone may read who rose
    const live = data().risings.filter((r) => LIVE.has(r.status));
    if (live.length) lines.push(...live.map((r) => risingLine(r)));
    if (!lines.length) lines.push(C.enabled ? 'No rising is under way. A citizen begins one in secret with /rebellion petition.' : 'Risings are not in force.');
    return { text: lines.join(' ') };
  };

  // ---- staff ------------------------------------------------------------------------------------------------------------
  const staffAct = (a, sub, rest) => {
    if (sub === 'list') {
      const ps = Object.keys(data().petitions).map(petitionOf).filter(Boolean);
      const rs = data().risings.filter((r) => LIVE.has(r.status) || Date.now() - r.endedAt < 14 * DAY);
      return { text: [`Risings are ${C.enabled ? 'in force' : 'OFF (config rebellion.enabled)'}.`, ps.length ? `Petitions: ${ps.map((p) => `#${p.id} ${holdName(p.zone)} (${new Set(p.signers.map((s) => s.pid)).size} accounts, by ${p.starter.name})`).join('; ')}` : 'No petitions.',
        rs.length ? `Risings: ${rs.map((r) => `#${r.id} ${r.name} ${holdName(r.zone)} [${r.status}]`).join('; ')}` : 'No risings.'].join(' ') };
    }
    if (sub === 'show') {
      const q = String(rest[0] || '');
      const p = petitionOf(q);
      if (p) { const t = thresholdMet(p); return { text: `Petition #${p.id} against ${holdName(p.zone)} (word ${p.code}), begun by ${p.starter.name} ${dateText(p.startedAt)}, led by ${p.leader.name}, lapses ${dateText(p.expiresAt)}: ${needText(t)}. Signed: ${p.signers.map((s) => `${s.name} (${hex(s.actor)}, profile ${s.pid})`).join(', ')}.` }; }
      const r = risingById(q) || risingOf(q);
      return r ? { text: risingLine(r, true) } : { error: 'No such petition or rising.' };
    }
    if (sub === 'cancel') {
      const p = petitionOf(String(rest[0] || '')); if (!p) return { error: 'No petition in that hold.' };
      delete data().petitions[p.zone]; save();
      audit(`REBELLION petition #${p.id} against ${holdName(p.zone)} cancelled by staff ${who(a)}`);
      staff(a, 'rebellion petition cancelled', `cancelled petition #${p.id} against ${holdName(p.zone)}`);
      tell(p.leader.actor, `Your petition against the ruler of ${holdName(p.zone)} was cancelled by the staff.`);
      return { text: `Petition #${p.id} cancelled.` };
    }
    if (sub === 'end') {
      const r = risingById(rest[0]); const how = String(rest[1] || '').toLowerCase();
      if (!r || !LIVE.has(r.status)) return { error: 'No such rising under way.' };
      const map = { won: 'won', lost: 'lost', peace: 'peace', cancel: 'staff' };
      if (!map[how]) return { error: 'Usage: /rebellion end <id> won|lost|peace|cancel' };
      const outcome = `ended by staff (${display(a)}): ${how}`;
      if (!call('__dboRealmEndWar', r.warId, outcome, map[how])) { if (map[how] === 'won') depose(r); settle(r, map[how], outcome); }
      staff(a, 'rebellion ended', `ended rising #${r.id} (${r.name}) as ${how}`);
      return { text: `Rising #${r.id} ended: ${how}.` };
    }
    return null;
  };

  // ---- chat -------------------------------------------------------------------------------------------------------------
  const USAGE = 'Usage: /rebellion [status] | petition [hold] | sign <word> | unsign | name <name> | leader <name|#TAG> | claimant <name|#TAG> | abandon | declare [death] | join [hold] | raid <territory> | death accept|refuse | withdraw | yield';
  registerChatCommand('rebellion', (a, args) => {
    const [sub0, ...rest] = String(args || '').trim().split(/\s+/);
    const sub = String(sub0 || 'status').toLowerCase();
    const tail = String(args || '').trim().slice(String(sub0 || '').length).trim();
    if (['list', 'show', 'cancel', 'end'].includes(sub)) {
      if (!isLeadStaff(a)) return personal(a, 'Staff only (Lead GM and above).');
      const r = staffAct(a, sub, rest); return personal(a, r.error || r.text);
    }
    if (!C.enabled && sub !== 'status') return personal(a, 'Risings are not in force.');
    let r;
    try {
      if (sub === 'status') r = status(a);
      else if (sub === 'petition') r = startPetition(a, rest[0] ? String(rest[0]).toLowerCase() : zoneOfActor(a));
      else if (sub === 'sign') r = sign(a, rest[0]);
      else if (sub === 'unsign') r = unsign(a);
      else if (sub === 'name') r = setName(a, tail);
      else if (sub === 'leader') r = setLeader(a, tail);
      else if (sub === 'claimant') r = setClaimant(a, tail);
      else if (sub === 'abandon') r = abandon(a);
      else if (sub === 'declare') r = declare(a, /^death$/i.test(rest[0] || ''));
      else if (sub === 'join') r = join(a, rest[0] ? String(rest[0]).toLowerCase() : null);
      else if (sub === 'raid') r = raid(a, String(rest[0] || ''));
      else if (sub === 'death') r = answerDeath(a, /^accept$/i.test(rest[0] || ''));
      else if (sub === 'withdraw') r = giveUp(a, 'rebels');
      else if (sub === 'yield') r = giveUp(a, 'ruler');
      else r = { error: USAGE };
    } catch (e) { log('rebellion: command failed', e.stack || e.message); r = { error: 'That cannot be done just now.' }; }
    personal(a, r.error || r.text);
  }, { help: 'risings against a hold\'s ruler: petition, sign, declare, join, raid (staff: list | show | cancel | end)' });

  // ---- the Rebellion tab of the F3 Faction panel (front features/faction/rebellion.tsx) --------------------------------
  // null while rebellion.enabled is off: the tab is hidden entirely. Signer names follow status(): only the petition's
  // starter and leader (and Lead GMs, in staffPetitions) see them; a signer sees the count. Declared risings are public.
  const stamp = (x) => (x ? { actor: x.actor >>> 0, name: x.name } : null);
  const petitionView = (p, a, staffView) => {
    const t = thresholdMet(p);
    const me = a >>> 0;
    const starter = (p.starter.actor >>> 0) === me, leader = (p.leader.actor >>> 0) === me;
    const sees = starter || leader || staffView;
    return {
      id: p.id, zone: p.zone, holdName: holdName(p.zone), code: p.code, startedAt: p.startedAt, expiresAt: p.expiresAt,
      count: t.n, needMin: t.need.min, needShare: t.need.share, citizens: t.need.citizens, mode: C.thresholdMode === 'any' ? 'any' : 'both',
      needed: C.thresholdMode === 'any' ? Math.min(t.need.min, t.need.share) : Math.max(t.need.min, t.need.share), met: t.met, needText: needText(t),
      starter: starter, leader: leader, starterName: sees ? p.starter.name : '', leaderName: sees ? p.leader.name : '',
      claimant: sees ? stamp(p.claimant || p.leader) : null, name: p.name || defaultName(p.zone), named: !!p.name,
      signers: sees ? p.signers.map((x) => ({ actor: x.actor >>> 0, name: x.name, starter: (x.actor >>> 0) === (p.starter.actor >>> 0), leader: (x.actor >>> 0) === (p.leader.actor >>> 0) })) : [],
    };
  };
  const risingView = (r, a) => {
    const w = call('__dboRealmWar', r.warId) || null;
    const terr = (tid) => (call('__dboRealmTerritory', tid) || { name: tid }).name;
    const leads = !!call('__dboRealmLeads', a, r.faction), rules = !!call('__dboRealmLeads', a, r.holdFaction);
    const rebel = r.rebels.some((x) => (x.actor >>> 0) === (a >>> 0));
    return {
      id: r.id, name: r.name, zone: r.zone, holdName: holdName(r.zone), status: r.status, declaredAt: r.declaredAt, startsAt: r.startsAt,
      leaderName: r.leader.name, claimantName: r.claimant ? r.claimant.name : '', capital: terr(r.capital), rebels: r.rebels.map((x) => x.name),
      rebel, leads, rules,
      canJoin: !!C.joinAfterDeclare && !rebel && citizenOf(a, r.zone) && !signRefusal(a, r.zone),
      war: w ? { status: w.status, startsAt: w.startsAt, windows: (w.windows || []).map((x) => ({ start: x.start, end: x.end })), death: w.death || null,
        captures: (w.captures || []).map((c) => ({ territory: terr(c.territory), at: c.at, byRebels: c.by === r.faction })) } : null,
      // The ruler answers a proposed war to the death before the first battle
      canAnswerDeath: rules && !!w && w.death === 'proposed' && Date.now() < Number(w.startsAt),
    };
  };
  globalThis.__dboRebellionView = (a) => {
    if (!C.enabled) return null;
    a >>>= 0;
    const mine = petitionSignedBy(a);
    const lead = isLeadStaff(a);
    const holds = citizenHolds(a).filter(isHold).map((zid) => ({ id: zid, name: holdName(zid), open: !signRefusal(a, zid) && !holdCooldown(zid) && !risingOf(zid) && !petitionOf(zid) }));
    return {
      rules: { noticeDays: C.noticeDays, windowsPerWar: C.windowsPerWar, windowHours: C.windowHours, deathWar: !!C.deathWar, petitionDays: C.petitionDays,
        outlawDays: C.outlawDays, outlawBounty: C.outlawBounty, joinAfterDeclare: !!C.joinAfterDeclare },
      petition: mine ? petitionView(mine, a, false) : null,
      holds: mine ? [] : holds,
      cooldownUntil: cooldownOf(a),
      risings: data().risings.filter((r) => LIVE.has(r.status)).map((r) => risingView(r, a)),
      staffPetitions: lead ? Object.keys(data().petitions).map(petitionOf).filter(Boolean).map((p) => petitionView(p, a, true)) : null,
    };
  };
  // Each button is the /rebellion command's own function; the panel is redrawn with its answer (guilds.js)
  if (typeof api.onUi === 'function') {
    const nonceOk = (a, args) => typeof globalThis.__dboFactionNonceOk === 'function' && globalThis.__dboFactionNonceOk(a, (args || [])[0]);
    const clean = (v) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80);
    const tab = (event, act) => api.onUi(event, (a, args) => {
      if (!nonceOk(a, args)) return;
      let r;
      try { r = C.enabled ? act(a >>> 0, (args || []).slice(1)) : { error: 'Risings are not in force.' }; }
      catch (e) { log('rebellion: panel action failed', e.stack || e.message); r = { error: 'That cannot be done just now.' }; }
      r = r || { error: 'That cannot be done just now.' };
      if (typeof globalThis.__dboFactionRefresh !== 'function' || !globalThis.__dboFactionRefresh(a, r.error || r.text, !r.error)) personal(a, r.error || r.text);
    });
    tab('rebellionTabPetition', (a, [zid]) => startPetition(a, clean(zid).toLowerCase() || zoneOfActor(a)));
    tab('rebellionTabSign', (a, [code]) => sign(a, clean(code)));
    tab('rebellionTabUnsign', (a) => unsign(a));
    tab('rebellionTabLeader', (a, [actor]) => setLeader(a, { actor: Number(actor) >>> 0 }));
    tab('rebellionTabClaimant', (a, [actor]) => setClaimant(a, { actor: Number(actor) >>> 0 }));
    tab('rebellionTabName', (a, [name]) => setName(a, clean(name)));
    tab('rebellionTabAbandon', (a) => abandon(a));
    tab('rebellionTabDeclare', (a, [death]) => declare(a, death === true || death === 'death'));
    tab('rebellionTabJoin', (a, [zid]) => join(a, clean(zid).toLowerCase() || null));
    tab('rebellionTabDeath', (a, [accept]) => answerDeath(a, accept === true || accept === 'accept'));
  }

  // ---- the tick: lapsed petitions, a war that began, and a war that ended without telling us (a reload between) ----------
  const tick = () => {
    for (const zid of Object.keys(data().petitions)) petitionOf(zid);
    for (const r of data().risings) {
      if (!LIVE.has(r.status)) continue;
      const w = call('__dboRealmWar', r.warId);
      if (!w) continue;
      if (w.status === 'active' && r.status === 'notice') { r.status = 'active'; save(); }
      if (w.status === 'ended') { if (w.how === 'won') depose(r); settle(r, w.how || 'lost', w.outcome); }
    }
  };
  if (typeof every === 'function') every('rebellion', 30000, () => { try { tick(); } catch (e) { log('rebellion: tick failed', e.message); } });
  log(`rebellion ${C.enabled ? 'ON' : 'off (rebellion.enabled false)'}: ${Object.keys(data().petitions).length} petition(s), ${data().risings.filter((r) => LIVE.has(r.status)).length} rising(s) under way`);
  return { startPetition, sign, unsign, setLeader, setClaimant, setName, abandon, declare, join, raid, answerDeath, giveUp, status, staffAct, settle, tick, thresholdMet, ofCourt, data };
};
