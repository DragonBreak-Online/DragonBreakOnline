// DragonBreak Online: the Thalmor's lore advantages (Nate, 11 Oct 2026: "the playerbase is against them"). Loaded by
// gamemode.js after guilds.js, jail.js, prayer.js and journal.js, on every hot reload. Registers no mp.on listener.
//
// 1. Concordat authority. The White-Gold Concordat (4E 175) outlawed the worship of Talos in the Empire and let the
//    Thalmor enforce it there. In 4E 211 Bruma is an Imperial county, so a Thalmor of an arresting rank (concordat.
//    arrestRoles: by default leader, officer, sergeant = First Emissary, Justiciar, Inquisitor) may arrest a character
//    whose god is Talos (prayer.js private.dboDeity.id, concordat.heresies) while they stand in concordat.provinces
//    (Cyrodiil, by regions.js). Skyrim's Holds are independent and the Concordat binds only the Empire, so there it
//    gives nothing. X on the worshipper: "Arrest under the Concordat" (playermenu.js asks __dboConcordatEntries and
//    hands the choice to __dboConcordatAction). The arrest is a warrant for warrantMinutes: the arrested player is told
//    why in plain words; the Justiciar restrains them as any lawful rank does (captureSystem, instant for them) and
//    takes them to a cell door in a jail of the Empire, where jail.js offers "The Concordat's sentence"
//    (sentenceMinutes, default 30) beside the usual lengths. That sentence is lawful: it carries concordat { by, at },
//    and only the Thalmor's releaseRoles or a Lead GM may release it early or add to it (__dboConcordatMayRelease);
//    the hold's own guards and officials leave it be. There is no player crime record to keep it off: an arrest is
//    never logged as an assault, and __dboConcordatLawful(captor, target) answers for any later crime system.
//    Every attempt, refused or not, is audited (CONCORDAT). A refused "no charge" waits retrySeconds per pair, so the
//    entry cannot be used to sweep a crowd for Talos worshippers.
// 2. Informants and dossiers. (a) When anyone kneels at a shrine of a proscribed god (informants.heresies; prayer.js
//    calls __dboThalmorInformant on kneeling), every online Thalmor of informants.roles is told the shrine, the place
//    and the hour, never the name, and the report is kept (the last informants.keep). (b) Dossiers: notes on named
//    characters, read by dossiers.readRoles and written or struck by dossiers.writeRoles (default leader, officer:
//    First Emissary and Justiciar). Capped by noteMax characters, notesPer note per dossier, max dossiers and maxBytes
//    of file, filtered by the journal's prose filter, every write audited. (c) The F3 journal's Thalmor tab
//    (journal section 'thalmor', front features/journal/tabs/ThalmorTab) shows both, to members of those ranks only.
//    Staff fallback: /dossier (list, read, add, strike) and /concordat (warrants, races).
// 3. The Dominion stipend is economy.js (economy.dominionStipend). 4. The race rule is guilds.js (factions.raceRules).
//
// State: thalmor-intel.json (runtime, gitignored) { reports: [{ at, shrine, place, world }], dossiers: { key: { actor,
// name, tag, notes: [{ at, by, byName, text }] } } }. Warrants live in memory (globalThis), lost at a restart.
// Config "thalmor" in gamemode-config.json; enabled false (or concordat/informants/dossiers .enabled false) turns a
// part off.
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, audit, who, display, nameOf, tagOf, cfg, onUi, onlineActors, registerChatCommand } = api;
  const system = typeof api.system === 'function' ? api.system : personal;
  const isAdmin = typeof api.isAdmin === 'function' ? api.isAdmin : () => false;
  const isLeadStaff = typeof api.isLeadStaff === 'function' ? api.isLeadStaff : () => false;
  const findAnyByName = typeof api.findAnyByName === 'function' ? api.findAnyByName : () => 0;
  const zoneOfActor = typeof api.zoneOfActor === 'function' ? api.zoneOfActor : () => null;

  const RAW = (cfg && cfg.thalmor) || {};
  const C = Object.assign({ enabled: true, faction: 'thalmor', file: 'thalmor-intel.json' }, RAW);
  C.concordat = Object.assign({
    enabled: true, heresies: ['talos'], provinces: ['cyrodiil'], arrestRoles: ['leader', 'officer', 'sergeant'],
    releaseRoles: ['leader', 'officer', 'sergeant'], sentenceMinutes: 30, warrantMinutes: 60, retrySeconds: 600,
  }, RAW.concordat || {});
  C.informants = Object.assign({ enabled: true, heresies: ['talos'], provinces: [], roles: ['leader', 'officer', 'sergeant'], keep: 50, repeatSeconds: 120 }, RAW.informants || {});
  C.dossiers = Object.assign({ enabled: true, readRoles: ['leader', 'officer', 'sergeant'], writeRoles: ['leader', 'officer'], noteMax: 500, notesPer: 20, max: 150, maxBytes: 1000000 }, RAW.dossiers || {});
  const FID = String(C.faction);
  const FILE = path.resolve(String(C.file));
  const MIN = 60000;

  // ---- state ------------------------------------------------------------------------------------------------------
  const S = globalThis.__dboThalmor || (globalThis.__dboThalmor = { data: null, warrants: new Map(), refused: new Map(), lastReport: new Map(), seen: new Map() });
  for (const k of ['warrants', 'refused', 'lastReport', 'seen']) if (!(S[k] instanceof Map)) S[k] = new Map();
  const data = () => {
    if (!S.data) {
      let d = null; try { d = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { d = null; }
      S.data = d && typeof d === 'object' ? d : {};
    }
    if (!Array.isArray(S.data.reports)) S.data.reports = [];
    if (!S.data.dossiers || typeof S.data.dossiers !== 'object') S.data.dossiers = {};
    return S.data;
  };
  const save = () => {
    try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(data(), null, 1)); fs.renameSync(FILE + '.tmp', FILE); return true; }
    catch (e) { log('thalmor: thalmor-intel.json write failed', e.message); return false; }
  };

  // ---- who is who -------------------------------------------------------------------------------------------------
  const get = (a, k, d) => { try { const v = mp.get(a >>> 0, k); return v === undefined || v === null ? d : v; } catch (e) { return d; } };
  const membership = (a) => {
    try { return (typeof globalThis.__dboGuildsOf === 'function' ? globalThis.__dboGuildsOf(a >>> 0) || [] : []).find((g) => g && g.id === FID) || null; } catch (e) { return null; }
  };
  const hasRole = (a, roles) => { const m = membership(a); return !!m && (roles || []).includes(m.role); };
  // "First Emissary, Justiciar and Inquisitor": the rank titles of these roles, as members read them
  const titlesOf = (roles) => {
    let list = []; try { list = typeof globalThis.__dboGuildRankList === 'function' ? globalThis.__dboGuildRankList(FID) || [] : []; } catch (e) { list = []; }
    let shown = {}; try { shown = typeof globalThis.__dboGuildRankShown === 'function' ? globalThis.__dboGuildRankShown(FID) || {} : {}; } catch (e) { shown = {}; }
    const t = list.filter((r) => (roles || []).includes(r.role)).map((r) => shown[r.title] || r.title);
    return t.length <= 1 ? (t[0] || 'no rank') : `${t.slice(0, -1).join(', ')} and ${t[t.length - 1]}`;
  };
  const faithOf = (t) => { const f = get(t, 'private.dboDeity', null); return f && typeof f === 'object' && f.id ? String(f.id) : ''; };
  const heretic = (t) => (C.concordat.heresies || []).includes(faithOf(t));
  const provinceOfDesc = (desc) => { const R = globalThis.__dboRegions; try { return R && typeof R.placeOf === 'function' ? String((R.placeOf(String(desc || '')) || {}).province || '') : ''; } catch (e) { return ''; } };
  const provinceOf = (a) => provinceOfDesc(get(a, 'worldOrCellDesc', ''));
  const inAuthority = (a) => (C.concordat.provinces || []).includes(provinceOf(a));
  const provinceName = (p) => { const R = globalThis.__dboRegions; try { return R && typeof R.provinceName === 'function' ? R.provinceName(p) : p; } catch (e) { return p; } };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const lengthText = (m) => (m >= 60 && m % 60 === 0 ? plural(m / 60, 'hour') : plural(m, 'minute'));
  const sentenceMinutes = () => Math.max(1, Math.min(240, Math.floor(Number(C.concordat.sentenceMinutes) || 30)));
  const on = (part) => C.enabled !== false && !!part && part.enabled !== false;

  // ---- 1. Concordat arrests ---------------------------------------------------------------------------------------
  const warrantOf = (t) => {
    const w = S.warrants.get(t >>> 0);
    if (!w) return null;
    if (Date.now() - w.at > Math.max(1, Number(C.concordat.warrantMinutes) || 60) * MIN) { S.warrants.delete(t >>> 0); return null; }
    return w;
  };
  const busyPrisoner = (t) => { const s = get(t, 'private.dboSentence', null); return !!(s && Number(s.totalMs) > 0); };
  // Why this arrest is refused, or '' (kind tells the audit and the retry wait apart)
  const arrestRefusal = (a, t) => {
    if (!on(C.concordat)) return { text: 'The Concordat is not enforced on this server.', kind: 'off' };
    if (!hasRole(a, C.concordat.arrestRoles)) return { text: `Only the Thalmor's ${titlesOf(C.concordat.arrestRoles)} arrest under the Concordat.`, kind: 'rank' };
    if (!inAuthority(a)) {
      return { text: `The White-Gold Concordat binds the Empire, and you stand in ${provinceName(provinceOf(a)) || 'no province of it'}. Here the Thalmor have no authority to arrest anyone.`, kind: 'region' };
    }
    if (isAdmin(t)) return { text: 'Staff cannot be arrested this way.', kind: 'staff' };
    if (busyPrisoner(t)) return { text: 'They are already serving a sentence.', kind: 'serving' };
    const k = `${a >>> 0}:${t >>> 0}`;
    const until = Number(S.refused.get(k)) || 0;
    if (until > Date.now()) return { text: `You found nothing against them a short while ago. Try again in ${plural(Math.ceil((until - Date.now()) / MIN), 'minute')}.`, kind: 'wait' };
    if (!heretic(t)) return { text: 'You have no charge against them under the Concordat.', kind: 'charge' };
    return null;
  };
  globalThis.__dboConcordatEntries = (a, t) => {
    if (!on(C.concordat) || !hasRole(a, C.concordat.arrestRoles) || !inAuthority(a)) return [];
    const w = warrantOf(t);
    return w ? [] : [{ id: 'concordat:arrest', label: 'Arrest under the Concordat' }];
  };
  globalThis.__dboConcordatAction = (a, id, t, nameFor) => {
    if (id !== 'concordat:arrest') return false;
    a = a >>> 0; t = t >>> 0;
    const named = (viewer, x) => { try { return typeof nameFor === 'function' ? nameFor(viewer, x) : nameOf(x); } catch (e) { return nameOf(x); } };
    const no = arrestRefusal(a, t);
    if (no) {
      if (no.kind === 'charge') S.refused.set(`${a}:${t}`, Date.now() + Math.max(0, Number(C.concordat.retrySeconds) || 0) * 1000);
      audit(`CONCORDAT refused (${no.kind}) ${who(a)} -> ${who(t)}`);
      personal(a, no.text);
      return true;
    }
    const m = membership(a) || {};
    const mins = sentenceMinutes();
    const w = { by: a, byWho: who(a), title: m.shown || m.title || 'Thalmor', at: Date.now(), province: provinceOf(a), minutes: mins, faith: faithOf(t) };
    S.warrants.set(t, w);
    const wm = Math.max(1, Number(C.concordat.warrantMinutes) || 60);
    system(t, `${named(t, a)}, ${w.title} of the Thalmor, arrests you under the White-Gold Concordat: the worship of Talos is outlawed in the Empire, and you are known to follow him. This is a lawful arrest, and the guards will not stop it. If you are taken to a cell you serve ${lengthText(mins)}.`);
    personal(t, `You are under arrest by the Thalmor for the worship of Talos (the White-Gold Concordat). In a cell of the Empire's jails it is ${lengthText(mins)}.`);
    personal(a, `${named(a, t)} is under arrest under the Concordat for the next ${plural(wm, 'minute')}. Restrain them and take them to a cell door in a jail of the Empire: the door offers the Concordat's sentence of ${lengthText(mins)}.`);
    audit(`CONCORDAT ARREST ${who(a)} (${w.title}) arrested ${who(t)} for the worship of ${w.faith} in ${w.province} at ${get(a, 'worldOrCellDesc', '?')}`);
    return true;
  };
  // jail.js, at a cell door: the Concordat sentence this guard may pass here, or null
  globalThis.__dboConcordatWarrant = (guard, prisoner, cell, cellRaw) => {
    if (!on(C.concordat) || !hasRole(guard, C.concordat.arrestRoles)) return null;
    const w = warrantOf(prisoner); if (!w) return null;
    if (!(C.concordat.provinces || []).includes(provinceOfDesc(cellRaw || cell))) return null;
    if (!heretic(prisoner)) return null;
    return { minutes: w.minutes || sentenceMinutes() };
  };
  globalThis.__dboConcordatJailed = (guard, prisoner, mins, where) => {
    const w = warrantOf(prisoner);
    S.warrants.delete(prisoner >>> 0);
    audit(`CONCORDAT JAIL ${who(guard)} jailed ${who(prisoner)} for ${mins} min in ${where}${w ? ` (arrested by ${w.byWho})` : ''}`);
    // The arrest goes into the prisoner's dossier, as the Thalmor's own record
    if (on(C.dossiers)) addNote(null, prisoner >>> 0, `Arrested under the Concordat for the worship of Talos; ${lengthText(mins)} in ${where}${w ? `, by ${w.title}` : ''}.`, { system: true });
  };
  globalThis.__dboConcordatMayRelease = (a) => hasRole(a, C.concordat.releaseRoles);
  // For any crime check to come: a Concordat arrest by this captor of this target stands, so it is no assault
  globalThis.__dboConcordatLawful = (captor, target) => { const w = warrantOf(target); return !!w && hasRole(captor, C.concordat.arrestRoles); };

  // ---- 2a. informants ---------------------------------------------------------------------------------------------
  const cellName = (desc) => {
    try {
      const r = mp.lookupEspmRecordById(mp.getIdFromDesc(String(desc)) >>> 0);
      if (!r || !r.record || String(r.record.type) !== 'CELL') return '';
      return String(r.record.editorId || '').replace(/^(CYR|BSK|BSH)/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\d+$/, '').trim();
    } catch (e) { return ''; }
  };
  const placeOfActor = (a) => {
    const z = (() => { try { return zoneOfActor(a); } catch (e) { return null; } })();
    const zone = z && typeof z === 'object' ? String(z.name || '') : '';
    const room = cellName(get(a, 'worldOrCellDesc', ''));
    return room && zone ? `${room}, ${zone}` : room || zone || 'the wilds';
  };
  const worldTime = () => {
    const c = globalThis.__dboClock;
    try {
      if (!c || typeof c.summary !== 'function') return '';
      const s = c.summary(); const total = Math.round((Number(s.hour) || 0) * 60) % 1440;
      const hh = Math.floor(total / 60), mm = total % 60;
      return `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'in the morning' : hh < 17 ? 'in the afternoon' : hh < 22 ? 'in the evening' : 'at night'}, ${s.day} ${s.month}`;
    } catch (e) { return ''; }
  };
  const utc = (ms) => new Date(ms).toISOString().slice(11, 16) + ' UTC';
  globalThis.__dboThalmorInformant = (caster, targetId, d, shrineName) => {
    if (!on(C.informants) || !d || !(C.informants.heresies || []).includes(String(d.id))) return false;
    const prov = provinceOf(caster);
    if ((C.informants.provinces || []).length && !C.informants.provinces.includes(prov)) return false;
    const k = `${caster >>> 0}:${targetId >>> 0}`;
    if (Date.now() - (Number(S.lastReport.get(k)) || 0) < Math.max(0, Number(C.informants.repeatSeconds) || 0) * 1000) return false;
    S.lastReport.set(k, Date.now());
    const r = { at: Date.now(), shrine: String(shrineName || `Shrine of ${d.name}`), place: placeOfActor(caster), world: worldTime(), god: String(d.name || d.id) };
    const list = data().reports;
    list.push(r);
    const keep = Math.max(1, Math.floor(Number(C.informants.keep) || 50));
    if (list.length > keep) list.splice(0, list.length - keep);
    save();
    const to = onlineActors().filter((a) => (a >>> 0) !== (caster >>> 0) && hasRole(a, C.informants.roles));
    for (const a of to) personal(a, `An informant reports: someone knelt at the ${r.shrine} (${r.place})${r.world ? ` at ${r.world}` : ''}, ${utc(r.at)}. The Thalmor tab of your journal (F3) keeps the reports.`);
    audit(`THALMOR INFORMANT ${who(caster)} knelt at ${r.shrine} (${r.place}); reported, without the name, to ${to.length} online`);
    return true;
  };

  // ---- 2b. dossiers -----------------------------------------------------------------------------------------------
  const keyOf = (t) => (t >>> 0).toString(16);
  const cleanText = (v) => String(v === undefined || v === null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const proseProblem = (text) => { try { return typeof globalThis.__dboProseProblem === 'function' ? globalThis.__dboProseProblem(text) : null; } catch (e) { return null; } };
  // { ok, text }. by null: the Thalmor's own record (a Concordat jailing); every other write needs writeRoles or a Lead GM
  const addNote = (by, t, raw, opts) => {
    const sys = !!(opts && opts.system);
    if (!on(C.dossiers)) return { ok: false, text: 'Dossiers are closed on this server.' };
    if (!sys && !hasRole(by, C.dossiers.writeRoles) && !isLeadStaff(by)) return { ok: false, text: `Only the Thalmor's ${titlesOf(C.dossiers.writeRoles)} write in the dossiers.` };
    if (!t) return { ok: false, text: 'No character by that name or #TAG.' };
    const text = cleanText(raw);
    if (!text) return { ok: false, text: 'Write something first.' };
    const max = Math.max(20, Math.floor(Number(C.dossiers.noteMax) || 500));
    if (text.length > max) return { ok: false, text: `A note holds at most ${max} characters; this one has ${text.length}.` };
    if (!sys) { const bad = proseProblem(text); if (bad) return { ok: false, text: `The journal does not take the word "${bad}". Change it and write again.` }; }
    const D = data().dossiers; const key = keyOf(t);
    if (!D[key] && Object.keys(D).length >= Math.max(1, Number(C.dossiers.max) || 150)) return { ok: false, text: `The Thalmor keep at most ${C.dossiers.max} dossiers. Strike an old one first.` };
    const doc = D[key] || { actor: t >>> 0, name: String(nameOf(t) || ''), tag: String(tagOf(t) || ''), notes: [] };
    const per = Math.max(1, Math.floor(Number(C.dossiers.notesPer) || 20));
    if (doc.notes.length >= per) {
      if (!sys) return { ok: false, text: `This dossier is full (${per} notes). Strike an old note first.` };
      doc.notes.splice(0, doc.notes.length - per + 1);
    }
    const note = { at: Date.now(), by: sys ? '' : who(by), byName: sys ? 'Concordat record' : String(nameOf(by) || ''), text };
    doc.notes.push(note);
    doc.name = String(nameOf(t) || doc.name); doc.tag = String(tagOf(t) || doc.tag);
    D[key] = doc;
    if (JSON.stringify(data()).length > Math.max(10000, Number(C.dossiers.maxBytes) || 1000000)) {
      doc.notes.pop(); if (!doc.notes.length) delete D[key];
      return { ok: false, text: 'The Thalmor archive is full. Strike old notes first.' };
    }
    if (!save()) { doc.notes.pop(); if (!doc.notes.length) delete D[key]; return { ok: false, text: 'The note could not be kept. Try again.' }; }
    audit(`THALMOR DOSSIER ${sys ? 'record' : who(by)} wrote on ${who(t)}: "${text.slice(0, 160)}${text.length > 160 ? '...' : ''}" (${text.length} chars)`);
    return { ok: true, text: `Noted in the dossier on ${doc.name}.` };
  };
  const strikeNote = (by, key, at) => {
    if (!on(C.dossiers)) return { ok: false, text: 'Dossiers are closed on this server.' };
    if (!hasRole(by, C.dossiers.writeRoles) && !isLeadStaff(by)) return { ok: false, text: `Only the Thalmor's ${titlesOf(C.dossiers.writeRoles)} strike notes from the dossiers.` };
    const D = data().dossiers; const doc = D[String(key)];
    if (!doc) return { ok: false, text: 'There is no such dossier.' };
    const i = doc.notes.findIndex((n) => Number(n.at) === Number(at));
    if (i < 0) return { ok: false, text: 'That note is no longer there.' };
    const [gone] = doc.notes.splice(i, 1);
    if (!doc.notes.length) delete D[String(key)];
    if (!save()) { doc.notes.splice(i, 0, gone); D[String(key)] = doc; return { ok: false, text: 'The note could not be struck. Try again.' }; }
    audit(`THALMOR DOSSIER ${who(by)} struck a note on ${doc.name} #${doc.tag} (by ${gone.byName || 'the record'}): "${String(gone.text).slice(0, 160)}"`);
    return { ok: true, text: `Struck from the dossier on ${doc.name}.` };
  };
  const findSubject = (q) => {
    const s = String(q || '').trim();
    if (!s) return { error: 'Name the character, or their #TAG.' };
    const D = data().dossiers;
    if (/^[0-9a-f]{1,8}$/i.test(s) && D[s.toLowerCase()]) return { t: Number(D[s.toLowerCase()].actor) >>> 0 };
    const t = findAnyByName(s);
    if (t < 0) return { error: `${-t} characters have that name. Use their #TAG.` };
    if (!t) return { error: 'No character by that name or #TAG.' };
    return { t: t >>> 0 };
  };

  // ---- 2c. the journal's Thalmor tab ------------------------------------------------------------------------------
  const readRoles = () => [...new Set([].concat(C.dossiers.readRoles || [], C.informants.roles || []))];
  const canSee = (a) => C.enabled !== false && (on(C.dossiers) || on(C.informants)) && hasRole(a, readRoles());
  const view = (a) => {
    const m = membership(a) || {};
    const reports = on(C.informants) && hasRole(a, C.informants.roles) ? data().reports.slice().reverse() : [];
    const read = on(C.dossiers) && hasRole(a, C.dossiers.readRoles);
    const dossiers = read ? Object.entries(data().dossiers).map(([key, d]) => ({
      key, name: String(d.name || ''), tag: String(d.tag || ''),
      updated: d.notes.length ? Number(d.notes[d.notes.length - 1].at) || 0 : 0,
      notes: d.notes.map((n) => ({ at: Number(n.at) || 0, byName: String(n.byName || ''), text: String(n.text || '') })),
    })).sort((x, y) => y.updated - x.updated) : [];
    S.seen.set(a >>> 0, Date.now());
    return {
      rank: String(m.shown || m.title || ''), canRead: read,
      canWrite: on(C.dossiers) && hasRole(a, C.dossiers.writeRoles), canArrest: on(C.concordat) && hasRole(a, C.concordat.arrestRoles),
      concordat: { on: on(C.concordat), minutes: sentenceMinutes(), where: (C.concordat.provinces || []).map(provinceName).join(', '), here: inAuthority(a),
        arrestRanks: titlesOf(C.concordat.arrestRoles) },
      reports: reports.map((r) => ({ at: r.at, shrine: r.shrine, place: r.place, world: r.world || '', god: r.god || '' })),
      dossiers, limits: { noteMax: Number(C.dossiers.noteMax) || 500, notesPer: Number(C.dossiers.notesPer) || 20 },
    };
  };
  const SECTIONS = globalThis.__dboJournalSections && typeof globalThis.__dboJournalSections === 'object'
    ? globalThis.__dboJournalSections : (globalThis.__dboJournalSections = {});
  SECTIONS.thalmor = {
    label: 'Thalmor',
    visible: (a) => {
      if (!canSee(a)) return false;
      const since = Number(S.seen.get(a >>> 0)) || 0;
      const fresh = hasRole(a, C.informants.roles) ? data().reports.filter((r) => r.at > since).length : 0;
      return fresh && since ? { badge: fresh } : true;
    },
    view: (a) => (canSee(a) ? view(a) : null),
  };
  const answer = (a, args, fn) => {
    if (typeof globalThis.__dboJournalFresh !== 'function' || !globalThis.__dboJournalFresh(a, (args || [])[0])) return;
    globalThis.__dboJournalLimited(a, () => { const r = fn(); return { tab: 'thalmor', text: r.text, kind: r.ok ? 'ok' : 'refused' }; });
  };
  // thalmorNote [nonce, name|#TAG|dossier key, text]
  onUi('thalmorNote', (a, args) => answer(a, args, () => {
    if (!canSee(a)) return { ok: false, text: 'That is for the Thalmor.' };
    const f = findSubject((args || [])[1]); if (f.error) return { ok: false, text: f.error };
    return addNote(a, f.t, (args || [])[2]);
  }));
  // thalmorStrike [nonce, dossier key, note at]
  onUi('thalmorStrike', (a, args) => answer(a, args, () => strikeNote(a, String((args || [])[1] || ''), Number((args || [])[2]))));

  // ---- staff fallback ---------------------------------------------------------------------------------------------
  const split = (args) => { const s = String(Array.isArray(args) ? args.join(' ') : args || '').trim(); const i = s.indexOf(' '); return i < 0 ? [s.toLowerCase(), ''] : [s.slice(0, i).toLowerCase(), s.slice(i + 1).trim()]; };
  const when = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  registerChatCommand('dossier', (a, args) => {
    const [sub, rest] = split(args);
    const D = data().dossiers;
    if (sub === 'list' || !sub) {
      const list = Object.values(D).map((d) => `${d.name} #${d.tag} (${d.notes.length})`);
      return personal(a, list.length ? `Thalmor dossiers: ${list.join(', ')}` : 'The Thalmor keep no dossiers yet.');
    }
    if (sub === 'read') {
      const f = findSubject(rest); if (f.error) return personal(a, f.error);
      const d = D[keyOf(f.t)]; if (!d) return personal(a, `No dossier on ${nameOf(f.t)}.`);
      personal(a, `Dossier on ${d.name} #${d.tag}:`);
      d.notes.forEach((n, i) => personal(a, `${i + 1}. ${when(n.at)} ${n.byName}: ${n.text}`));
      return;
    }
    if (sub === 'add') {
      if (!isLeadStaff(a)) return personal(a, 'Only a Lead GM or above writes in the dossiers from chat.');
      const sp = rest.indexOf(' '); const f = findSubject(sp < 0 ? rest : rest.slice(0, sp)); if (f.error) return personal(a, f.error);
      return personal(a, addNote(a, f.t, sp < 0 ? '' : rest.slice(sp + 1)).text);
    }
    if (sub === 'strike') {
      if (!isLeadStaff(a)) return personal(a, 'Only a Lead GM or above strikes dossier notes from chat.');
      const m = rest.match(/^(.*\S)\s+(\d+)$/); if (!m) return personal(a, 'Usage: /dossier strike <name|#TAG> <note number>');
      const f = findSubject(m[1]); if (f.error) return personal(a, f.error);
      const d = D[keyOf(f.t)]; const n = d && d.notes[Number(m[2]) - 1];
      return personal(a, n ? strikeNote(a, keyOf(f.t), n.at).text : 'No such note.');
    }
    if (sub === 'reports') {
      const r = data().reports.slice(-10).reverse();
      return personal(a, r.length ? `Informant reports: ${r.map((x) => `${when(x.at)} ${x.shrine} (${x.place})`).join(' | ')}` : 'No informant reports.');
    }
    personal(a, 'Usage: /dossier list | read <name|#TAG> | add <name|#TAG> <text> | strike <name|#TAG> <n> | reports');
  }, { admin: true, help: 'the Thalmor dossiers and informant reports (staff; members use the Thalmor tab in F3)' });
  registerChatCommand('concordat', (a, args) => {
    const [sub] = split(args);
    if (sub === 'races') {
      const ids = typeof globalThis.__dboGuildMembers === 'function' ? globalThis.__dboGuildMembers(FID) : [];
      const ranks = typeof globalThis.__dboGuildRankList === 'function' ? globalThis.__dboGuildRankList(FID) || [] : [];
      const rankOf = (t) => { const g = membership(t); return g ? ranks.findIndex((r) => r.title === g.title) : -1; };
      const out = ids.map((t) => ({ t, why: typeof globalThis.__dboFactionRaceBreak === 'function' ? globalThis.__dboFactionRaceBreak(t, FID, Math.max(0, rankOf(t))) : '' })).filter((x) => x.why);
      return personal(a, out.length ? `Thalmor outside the race rule (kept, never removed): ${out.map((x) => `${display(x.t)} (${x.why === 'lead' ? 'leading rank, not a High Elf' : 'not of the Dominion\'s peoples'})`).join(', ')}` : `All ${ids.length} Thalmor fit the race rule.`);
    }
    const list = [...S.warrants.entries()].filter(([t]) => warrantOf(t)).map(([t, w]) => `${display(t)} by ${w.byWho} ${Math.round((Date.now() - w.at) / MIN)} min ago`);
    personal(a, list.length ? `Concordat arrests standing: ${list.join(' | ')}` : 'No Concordat arrest stands. (/concordat races: Thalmor outside the race rule)');
  }, { admin: true, help: '[races] Concordat arrests standing, or Thalmor outside the race rule (staff)' });

  log(`thalmor ${C.enabled === false ? 'off' : 'on'}: concordat ${on(C.concordat) ? `on (${(C.concordat.provinces || []).join('/')}, ${sentenceMinutes()} min)` : 'off'}, informants ${on(C.informants) ? 'on' : 'off'}, dossiers ${on(C.dossiers) ? `on (${Object.keys(data().dossiers).length})` : 'off'}, ${data().reports.length} reports kept`);
  return { arrestRefusal, addNote, strikeNote, view, warrantOf };
};
