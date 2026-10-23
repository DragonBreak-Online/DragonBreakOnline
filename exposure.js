// DragonBreak Online: a werewolf or a Vampire Lord seen changing is known for what it is (bundle 23 Oct, part 1c). Loaded by
// gamemode.js after outlaws.js; beastform.js reports every change it shows to people near (__dboBeastWitnessed), the hit hook
// every blow (__dboExposureHit).
//
// Exposed: at least `witnesses` (3) players saw the change, not counting staff in an admin mode or anyone invisible. The
// character is then a known beast in that hold for `days` (7) real days. The hold is the realm.js territory of the place
// (an interior: of the last place outside), else the hold zone the character stands in. Below the threshold nothing happens.
//   bounty   through outlaws.js (__dboOutlawDeclare): cityBounty (500) in a city, wildsBounty (200) in the wilds, times
//            hurtMultiplier (2) when the beast hurt someone in that shape; paid or served in the jail like any other.
//   guards   while a bounty from it stands, ff_huntedIn names the hold to every client as the character walks in it: the client
//            that hosts the hold's guard NPCs sets them on the character (client part). Player guards and every official of
//            the hold get a notice of what was seen and where, naming nobody (Nate, 23 Oct), and the F3 Court tab lists it;
//            only when the beast holds a seat of that court are its fellow office holders told who (the court-powers rule).
//   court    an exposed character holding office in that hold loses its powers there until cleared (__dboExposureBarred:
//            bounties, appointments, property sales, tax and wages).
//   hunters  the orders that hunt each kind (config hunters: werewolf the Vigil of Stendarr and the Silver Hand, vampireLord the
//            Dawnguard and the Vigil) are told what and where, never who, each member when next online; a witness of such an
//            order is recorded on the case for staff (/exposure, the Court tab, the audit). No contract is posted: contracts.js posts only kill contracts on spawned NPCs, and commissions.js needs a
//            poster's gold held, so neither can carry a hunt for a player.
//   exempt   the Companions' Circle (Harbinger, Elders of Jorrvaskr) in Whiterun Hold, by config.
// Cleared by a cure of the curse (the character is no longer of that kind, checked on the tick), by time, or by a Lead GM with
// a reason (/exposure clear, audited). The bounty itself goes as any bounty does: paid, or served in the jail.
//
// State: exposure.json beside the server, { cases: { <actor id>: { actor, pid, name, holds: { <zone>: { at, until, place,
//   form, city, seen, hunters: [{ who, order }], hurt, bounty, told: [actor ids] } } } } }
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, system, audit, who, display, cfg, registerChatCommand, zoneOfActor, zoneById, readOfficials,
    profileOf, officialTarget, onlineActors, isAdmin, isLeadStaff, every } = api;
  const C = Object.assign({
    enabled: true, witnesses: 3, days: 7, cityBounty: 500, wildsBounty: 200, hurtMultiplier: 2,
    // A capital territory's marker within cityRadius, or one of the walled cities' own worldspaces (Whiterun 1a26f, Windhelm
    // 1691d, Riften 16bb4, Markarth 16d71, Solitude 37edf: gamemode.js TAMRIEL_FRAME)
    cityRadius: 5000, cityWorlds: ['1a26f:Skyrim.esm', '1691d:Skyrim.esm', '16bb4:Skyrim.esm', '16d71:Skyrim.esm', '37edf:Skyrim.esm'],
    guardsHostile: true, courtPowers: true, notices: true,
    guardTitles: ['Guard', 'Guard Sergeant', 'Guard Captain'],
    // guild-defs.json ids (verified 23 Oct): vigil-of-stendarr, silver-hand, dawnguard
    hunters: { werewolf: ['vigil-of-stendarr', 'silver-hand'], vampireLord: ['dawnguard', 'vigil-of-stendarr'] },
    exempt: [{ faction: 'companions', zone: 'whiterun', titles: ['Harbinger', 'Elder of Jorrvaskr'], roles: ['leader', 'officer'] }],
    tickSeconds: 15,
  }, cfg.exposure || {});
  const DAY = 86400000;
  const FILE = path.resolve('exposure.json');
  const PROP = 'ff_huntedIn';
  try { mp.makeProperty(PROP, { isVisibleByOwner: true, isVisibleByNeighbors: true, updateOwner: '', updateNeighbor: '' }); } catch (e) { /* registered before a hot reload */ }

  const S = globalThis.__dboExposure || (globalThis.__dboExposure = { data: null, session: new Map(), hurt: new Map() });
  const data = () => {
    if (!S.data) { try { S.data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { S.data = {}; } }
    if (!S.data.cases || typeof S.data.cases !== 'object') S.data.cases = {};
    return S.data;
  };
  const save = () => {
    try { const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data(), null, 1)); fs.renameSync(tmp, FILE); }
    catch (e) { log('exposure: saving failed', e.message); }
  };
  const id = (a) => Number(a) >>> 0;
  const holdName = (zid) => { const z = zoneById(zid); return z ? z.name : zid; };
  const g = (name) => (typeof globalThis[name] === 'function' ? globalThis[name] : null);
  const safe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };
  const get = (a, prop) => safe(() => mp.get(a, prop), null);
  const guildsOf = (a) => safe(() => (g('__dboGuildsOf') ? g('__dboGuildsOf')(id(a)) || [] : []), []);
  const nameTo = (viewer, a) => safe(() => (g('__dboNameFor') ? String(g('__dboNameFor')(id(viewer), id(a))) : ''), '') || 'someone';
  const beastForm = (a) => { const b = get(a, 'private.beast'); return b && typeof b === 'object' ? b : null; };
  // The beast forms watched: beastform.js keys, the supernatural.js kind each belongs to, and the words for it
  const FORMS = { werewolf: { kind: 'werewolf', hunters: 'werewolf', noun: 'a werewolf', crime: 'seen changing into a werewolf' },
    vampirelord: { kind: 'vampire', hunters: 'vampireLord', noun: 'a Vampire Lord', crime: 'seen rising as a Vampire Lord' } };
  const formOf = (h) => FORMS[(h && h.form) || 'werewolf'] || FORMS.werewolf;
  const stillOfKind = (a, form) => { const s = get(a, 'private.supernatural'); return !!(s && s.kind === (FORMS[form] || FORMS.werewolf).kind); };
  const ordersFor = (form) => { const l = (C.hunters || {})[(FORMS[form] || FORMS.werewolf).hunters]; return Array.isArray(l) ? l.map(String) : []; };
  const orderOf = (x, form) => { const mine = guildsOf(x); return ordersFor(form).find((o) => mine.some((gm) => gm.id === o)) || ''; };
  const orderName = (fid) => safe(() => (g('__dboGuildInfo') ? (g('__dboGuildInfo')(fid) || {}).name : ''), '') || fid;

  // ---- the place: hold, territory, city or wilds ------------------------------------------------------------------------
  const placeOf = (a) => {
    let world = String(get(a, 'worldOrCellDesc') || ''); let pos = get(a, 'pos');
    let t = safe(() => (g('__dboRealmTerritoryAt') ? g('__dboRealmTerritoryAt')(world, pos) : null), null);
    if (!t) { const last = get(a, 'private.lastOutside'); if (last && last.world) { world = String(last.world); pos = last.pos; t = safe(() => (g('__dboRealmTerritoryAt') ? g('__dboRealmTerritoryAt')(world, pos) : null), null); } }
    const zid = (t && t.zone && zoneById(t.zone) ? t.zone : null) || safe(() => zoneOfActor(a), null);
    const w = world.toLowerCase();
    const inCityWorld = (C.cityWorlds || []).some((x) => String(x).toLowerCase() === w);
    const nearCapital = !!t && t.kind === 'capital' && Array.isArray(pos) && t.marker && Array.isArray(t.marker.pos)
      && Math.hypot(pos[0] - t.marker.pos[0], pos[1] - t.marker.pos[1]) <= Number(C.cityRadius);
    return { zid, city: inCityWorld || nearCapital, place: t ? t.name : zid ? holdName(zid) : 'the wilds' };
  };

  // ---- who counts and who is spared ---------------------------------------------------------------------------------------
  const modesOf = (a) => { const m = get(a, 'ff_adminModes'); return m && typeof m === 'object' ? m : {}; };
  const isStaff = (a) => safe(() => (g('__dboIsStaff') ? g('__dboIsStaff')(id(a)) === true : !!isAdmin(a)), false);
  const countsAsWitness = (o) => {
    if (!(Number(profileOf(o)) >= 0)) return false;
    const m = modesOf(o);
    if (m.invis === true) return false;
    if (isStaff(o) && Object.values(m).some((v) => v === true)) return false;
    return true;
  };
  const exemptIn = (a, zid) => (C.exempt || []).some((x) => x && String(x.zone) === zid && guildsOf(a).some((gm) => gm.id === x.faction
    && ((x.titles || []).includes(gm.title) || (x.roles || []).includes(gm.role))));

  // ---- cases --------------------------------------------------------------------------------------------------------------
  const live = (h) => h && Number(h.until) > Date.now();
  const caseOf = (a) => data().cases[String(id(a))] || null;
  const exposedIn = (a, zid) => { const c = caseOf(a); return !!(c && zid && live(c.holds[zid])); };
  const bountyIn = (zid, pid) => safe(() => { const z = ((globalThis.__dboOutlaws || {}).data || {}).zones; return !!(z && z[zid] && z[zid][String(pid)]); }, false);
  const amountFor = (h) => Math.round((h.city ? Number(C.cityBounty) : Number(C.wildsBounty)) * (h.hurt ? Number(C.hurtMultiplier) || 1 : 1));
  const declare = (a, zid, h) => {
    const amount = amountFor(h);
    const f = formOf(h);
    // The public Wanted list and /bounty show only a plain reason, never the beast (Nate, 23 Oct: the bounty must not give the
    // beast away); what was seen goes to the staff log and /exposure, and to the hold's court through its own notices
    const reason = h.hurt ? String(C.publicReasonHurt || 'wanted by order of the hold, for violence') : String(C.publicReason || 'wanted by order of the hold');
    const ok = safe(() => (g('__dboOutlawDeclare') ? g('__dboOutlawDeclare')(zid, Number(profileOf(a)), amount, reason, h.name || display(a), holdName(zid)) === true : false), false);
    if (ok) log(`exposure: bounty ${amount} on ${display(a)} in ${zid} for ${h.hurt ? `${f.crime}, and hurt people in that shape` : f.crime} (seen as ${f.noun}; public reason "${reason}")`);
    if (ok) h.bounty = Math.max(Number(h.bounty) || 0, amount);
    else log(`exposure: no bounty set on ${display(a)} in ${zid} (outlaws off or not loaded)`);
    return ok;
  };

  const expose = (a, zid, place, seen, hurt, form, hunters) => {
    const f = FORMS[form] || FORMS.werewolf;
    if (form === 'werewolf' && exemptIn(a, zid)) {
      log(`exposure: ${display(a)} seen changing in ${holdName(zid)} by ${seen}, spared as of the Companions' Circle`);
      audit(`EXPOSURE ${who(a)} ${f.crime} by ${seen} in ${holdName(zid)}: exempt (Circle of the Companions)`);
      return false;
    }
    const cases = data().cases; const key = String(id(a));
    const c = cases[key] || (cases[key] = { actor: id(a), pid: Number(profileOf(a)), name: display(a), holds: {} });
    c.name = safe(() => (g('__dboOwnName') ? String(g('__dboOwnName')(id(a))) : ''), '') || c.name;
    const was = live(c.holds[zid]) ? c.holds[zid] : null;
    const h = was || { at: Date.now(), told: [], hunters: [] };
    const known = new Set((h.hunters || []).map((x) => x.who));
    Object.assign(h, { form, until: Date.now() + Number(C.days) * DAY, place: place.place, city: !!(h.city || place.city), seen: Math.max(Number(h.seen) || 0, seen),
      hunters: (h.hunters || []).concat((hunters || []).filter((x) => !known.has(x.who))).slice(-20), hurt: !!(h.hurt || hurt), name: c.name });
    c.holds[zid] = h;
    declare(a, zid, h);
    save();
    audit(`EXPOSURE ${who(a)} ${f.crime} by ${seen} at ${place.place} (${holdName(zid)}, ${place.city ? 'city' : 'wilds'}${hurt ? ', hurt people' : ''}): known for ${C.days} days, bounty ${h.bounty || 0}${h.hunters.length ? `; hunters among the witnesses: ${h.hunters.map((x) => `${x.who} (${x.order})`).join(', ')}` : ''}`);
    system(a, was ? `You were seen in the beast's shape again in ${holdName(zid)}. The word against you there will not die down soon.`
      : `You were seen ${form === 'werewolf' ? 'changing into a beast' : 'rising as a Vampire Lord'} near ${place.place}. Word will spread through ${holdName(zid)}: ${h.bounty ? `the hold has put a bounty of ${h.bounty} gold on you, and ` : ''}its guards will know you on sight.`);
    tick();
    return true;
  };

  // beastform.js witness(): who saw the change (players near, in the same cell or worldspace). phase 'in' or 'out'
  globalThis.__dboBeastWitnessed = (a, form, seers, phase) => {
    a = id(a);
    if (phase === 'in') { const b = beastForm(a); S.session.set(a, b ? Number(b.at) || Date.now() : Date.now()); }
    if (!C.enabled || !FORMS[form]) return false;
    const counted = (Array.isArray(seers) ? seers : []).map(id).filter((o) => o !== a && countsAsWitness(o));
    const seen = counted.length;
    const hunters = counted.map((o) => ({ o, order: orderOf(o, form) })).filter((x) => x.order).map((x) => ({ who: who(x.o), order: x.order }));
    if (seen < Number(C.witnesses)) { log(`exposure: ${display(a)} changed before ${seen} witness(es), under ${C.witnesses}`); return false; }
    const place = placeOf(a);
    if (!place.zid) { log(`exposure: ${display(a)} seen by ${seen} but in no hold`); return false; }
    const hurt = (S.hurt.get(a) || {}).session === S.session.get(a);
    return expose(a, place.zid, place, seen, hurt && phase === 'out', form, hunters);
  };

  // A blow landed by a werewolf or a Vampire Lord in that shape, on a player or a person (an NPC of a humanoid race); an exposed one's bounty
  // doubles in the hold it stands in. True when a bounty was set or raised (the frenzy worker's call, __dboExposureBounty)
  const PEOPLE = /^(Nord|Imperial|Breton|Redguard|HighElf|WoodElf|DarkElf|Orc|Argonian|Khajiit|Reach|Elder)/i;
  const isPerson = (t) => {
    if (Number(profileOf(t)) >= 0) return true;
    return safe(() => {
      const base = mp.lookupEspmRecordById(Number(get(t, 'baseId')) >>> 0);
      const rnam = base && base.record && (base.record.fields || []).find((f) => f && f.type === 'RNAM' && f.data instanceof Uint8Array);
      if (!rnam) return false;
      const raceId = base.toGlobalRecordId(new DataView(rnam.data.buffer, rnam.data.byteOffset, rnam.data.byteLength).getUint32(0, true)) >>> 0;
      const race = mp.lookupEspmRecordById(raceId);
      return PEOPLE.test(String((race && race.record && race.record.editorId) || ''));
    }, false);
  };
  const hurtBy = (a, t, force) => {
    a = id(a); t = id(t);
    if (!C.enabled || a === t) return false;
    const b = beastForm(a);
    if (!b || !FORMS[b.form]) return false;
    if (!force && !isPerson(t)) return false;
    S.hurt.set(a, { session: Number(b.at) || S.session.get(a), at: Date.now() });
    const place = placeOf(a);
    const c = caseOf(a); const h = c && place.zid ? c.holds[place.zid] : null;
    if (!live(h) || h.hurt || formOf(h) !== FORMS[b.form]) return false;
    h.hurt = true;
    const ok = declare(a, place.zid, h);
    save();
    audit(`EXPOSURE ${who(a)}, known as ${formOf(h).noun} in ${holdName(place.zid)}, hurt ${display(t)} in that shape: bounty ${h.bounty || 0}`);
    return ok;
  };
  globalThis.__dboExposureHit = (agg, tgt) => { try { hurtBy(agg, tgt, false); } catch (e) { log('exposure: hit failed', e.message); } };
  globalThis.__dboExposureBounty = (a, victim) => { try { return hurtBy(a, victim, true); } catch (e) { log('exposure: bounty failed', e.message); return false; } };

  // ---- court powers -------------------------------------------------------------------------------------------------------
  // '' when the actor may use a court's powers in zid (the hold it stands in when left out), else why not
  globalThis.__dboExposureBarred = (a, zid) => {
    if (!C.enabled || !C.courtPowers) return '';
    if (safe(() => isAdmin(a), false)) return '';
    const z = zid || safe(() => placeOf(a).zid, null);
    if (!z || !exposedIn(a, z)) return '';
    return `You were seen in the beast's shape in ${holdName(z)}. Its court will not take your word until you are cleared.`;
  };
  globalThis.__dboExposedIn = (a, zid) => !!C.enabled && exposedIn(a, zid);

  // ---- notices ------------------------------------------------------------------------------------------------------------
  // The hold's own: anyone seated in one of its offices (the character, leadership.js), and its faction's guards by title
  const seatedIn = (x, zid) => {
    const pid = Number(profileOf(x)); if (!(pid >= 0)) return false;
    const seats = (readOfficials() || {})[zid] || {};
    const sh = g('__dboSeatHolder');
    return Object.entries(seats).some(([r, l]) => Array.isArray(l) && l.map(Number).includes(pid) && (() => { const held = sh ? Number(safe(() => sh(zid, r, pid), 0)) >>> 0 : 0; return !held || held === id(x); })());
  };
  const servesHold = (x, zid) => {
    if (seatedIn(x, zid)) return true;
    const fid = safe(() => (g('__dboHoldFactionOf') ? g('__dboHoldFactionOf')(zid) : null), null);
    return !!fid && guildsOf(x).some((gm) => gm.id === fid && (C.guardTitles || []).includes(gm.title));
  };
  // Nobody is named (Nate, 23 Oct): a notice says what was seen and where. The one exception is the court-powers rule: when
  // the beast holds office in the hold, its court is told which of its own lost them, named as each reader knows them.
  const timeOfDay = (at) => { const hr = new Date(at).getUTCHours(); return hr < 5 ? 'in the night' : hr < 12 ? 'in the morning' : hr < 18 ? 'in the afternoon' : 'in the evening'; };
  const notify = (c, zid, h, online) => {
    const a = c.actor;
    const ofCourt = seatedIn(a, zid);
    // Named as the reader's own character knows them, never by a beast's name: wait for the mortal shape
    if (ofCourt && online.includes(a) && beastForm(a)) return false;
    const f = formOf(h);
    const what = `${f.noun.charAt(0).toUpperCase()}${f.noun.slice(1)} was seen near ${h.place}, in ${holdName(zid)}, ${timeOfDay(h.at)}`;
    let changed = false;
    for (const x of online) {
      if (x === a || h.told.includes(x)) continue;
      const official = servesHold(x, zid); const order = orderOf(x, h.form || 'werewolf');
      if (!official && !order) continue;
      h.told.push(x); changed = true;
      if (official) {
        let line = `A notice from the court of ${holdName(zid)}: ${what.charAt(0).toLowerCase()}${what.slice(1)}.${h.bounty ? ' The hold has put a bounty on the beast.' : ''}`;
        if (ofCourt && seatedIn(x, zid)) {
          const n = nameTo(x, a);
          const named = /^(stranger|someone|masked person)$/i.test(n) ? 'one of this court' : `${n}, of this court,`;
          line += ` It was ${named} and they hold no court powers in ${holdName(zid)} until cleared.`;
        }
        system(x, `${line} See the Court tab of your journal (F3).`);
      }
      if (order) system(x, `Word reaches ${orderName(order)}: ${what.charAt(0).toLowerCase()}${what.slice(1)}.`);
    }
    return changed;
  };

  // ---- the tick: expiry, cures, the guards' flag, notices ----------------------------------------------------------------
  const huntedSet = new Map();
  function tick() {
    if (!C.enabled) return;
    const online = onlineActors().map(id);
    let dirty = false;
    for (const [key, c] of Object.entries(data().cases)) {
      const on = online.includes(c.actor);
      for (const [zid, h] of Object.entries(c.holds)) {
        if (on && !stillOfKind(c.actor, h.form || 'werewolf')) {
          delete c.holds[zid]; dirty = true;
          audit(`EXPOSURE ${who(c.actor)} is no longer ${formOf(h).kind === 'vampire' ? 'a vampire' : 'a werewolf'} (cured): cleared in ${holdName(zid)}`);
          continue;
        }
        if (!live(h)) { delete c.holds[zid]; dirty = true; log(`exposure: ${c.name} is no longer known as ${formOf(h).noun} in ${zid} (time)`); continue; }
        if (!Array.isArray(h.told)) h.told = [];
        if (C.notices && notify(c, zid, h, online)) dirty = true;
      }
      if (!Object.keys(c.holds).length) { delete data().cases[key]; dirty = true; }
    }
    if (dirty) save();
    for (const a of online) {
      let want = null;
      if (C.guardsHostile) {
        const c = caseOf(a);
        if (c) { const zid = placeOf(a).zid; if (zid && live(c.holds[zid]) && bountyIn(zid, Number(profileOf(a)))) want = zid; }
      }
      if ((huntedSet.get(a) || null) === want && (get(a, PROP) || null) === want) continue;
      try { mp.set(a, PROP, want); huntedSet.set(a, want); } catch (e) { /* offline */ }
    }
    for (const a of [...huntedSet.keys()]) if (!online.includes(a)) huntedSet.delete(a);
  }
  if (typeof every === 'function') every('exposure', Math.max(5, Number(C.tickSeconds) || 15) * 1000, () => tick());
  // Off: nobody is hunted any longer
  if (!C.enabled) { for (const a of safe(() => onlineActors(), [])) { try { if (get(a, PROP)) mp.set(a, PROP, null); } catch (e) { /* offline */ } } }

  // ---- the F3 Court tab (court.js zoneView): the hold's known beasts, for its officials and staff ----------------------------
  globalThis.__dboExposureCourtView = (viewer, zid) => {
    if (!C.enabled) return null;
    if (!safe(() => isAdmin(viewer), false) && !servesHold(id(viewer), zid)) return null;
    const out = [];
    for (const c of Object.values(data().cases)) {
      const h = c.holds[zid]; if (!live(h)) continue;
      const staff = safe(() => isAdmin(viewer), false);
      // Staff see who; the court sees who only when it is one of its own seats (court-powers rule); otherwise unnamed
      const name = staff ? c.name : seatedIn(c.actor, zid) && seatedIn(id(viewer), zid) ? nameTo(viewer, c.actor) : '';
      out.push(Object.assign({ name, what: formOf(h).noun, place: h.place, at: h.at, until: h.until, bounty: Number(h.bounty) || 0, hurt: !!h.hurt,
        wanted: bountyIn(zid, c.pid) }, staff ? { seen: Number(h.seen) || 0, hunters: (h.hunters || []).map((x) => `${x.who} (${orderName(x.order)})`) } : {}));
    }
    return out.sort((x, y) => y.at - x.at);
  };

  // ---- staff: /exposure [list] | clear <name|#TAG|profile id> [zone] <reason> ----------------------------------------------
  const clearCase = (a, rest) => {
    const parts = String(rest || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return 'Usage: /exposure clear <name|#TAG|profile id> [hold] <reason>';
    const tg = officialTarget(parts[0]); if (tg.error) return tg.error;
    let zid = null; let reason = parts.slice(1);
    if (zoneById(parts[1]) && parts.length > 2) { zid = zoneById(parts[1]).id; reason = parts.slice(2); }
    const text = reason.join(' ').slice(0, 160);
    const keys = Object.keys(data().cases).filter((k) => { const c = data().cases[k]; return tg.actor ? c.actor === id(tg.actor) : c.pid === Number(tg.pid); });
    let n = 0;
    for (const k of keys) {
      const c = data().cases[k];
      for (const z of Object.keys(c.holds)) if (!zid || z === zid) { delete c.holds[z]; n++; }
      if (!Object.keys(c.holds).length) delete data().cases[k];
    }
    if (!n) return `${tg.label} is not known as a beast${zid ? ` in ${holdName(zid)}` : ''}.`;
    save(); tick();
    audit(`EXPOSURE GM ${who(a)} cleared ${tg.who}${zid ? ` in ${holdName(zid)}` : ` in ${n} hold(s)`}: ${text}`);
    return `${tg.label} is no longer known as a beast${zid ? ` in ${holdName(zid)}` : ''}. Any bounty stands until paid or lifted (/bounty clear).`;
  };
  const listText = () => {
    const lines = [];
    for (const c of Object.values(data().cases)) for (const [z, h] of Object.entries(c.holds)) if (live(h)) lines.push(`${c.name} (${who(c.actor)}), ${formOf(h).noun}, in ${holdName(z)} near ${h.place}, seen by ${h.seen}${(h.hunters || []).length ? ` (hunters: ${h.hunters.map((x) => `${x.who} of ${orderName(x.order)}`).join(', ')})` : ''}, ${h.hurt ? 'hurt people, ' : ''}bounty ${h.bounty || 0}, until ${new Date(h.until).toISOString().slice(0, 16)}Z`);
    return lines.length ? lines.join('\n') : 'Nobody is known as a beast.';
  };
  if (typeof registerChatCommand === 'function') {
    registerChatCommand('exposure', (a, args) => {
      if (!isLeadStaff(a)) return personal(a, 'Only a Lead GM or above may use /exposure.');
      const [sub, ...rest] = String(args || '').trim().split(/\s+/);
      const s = String(sub || '').toLowerCase();
      if (!s || s === 'list') return personal(a, `Werewolf exposure is ${C.enabled ? 'on' : 'off'}. ${listText()}`);
      if (s === 'clear') return personal(a, clearCase(a, rest.join(' ')));
      personal(a, 'Usage: /exposure [list] | clear <name|#TAG|profile id> [hold] <reason>');
    }, { admin: true, help: '[list|clear <who> [hold] <reason>] werewolves and Vampire Lords known in a hold after being seen changing (Lead GM)' });
  }

  log(`exposure ${C.enabled ? 'on' : 'off'}: ${Object.keys(data().cases).length} known beasts, ${C.witnesses} witnesses, ${C.days} days, ${C.cityBounty}/${C.wildsBounty} gold x${C.hurtMultiplier} when hurt`);
  return { tick, placeOf, expose, clearCase, listText };
};
