'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (api) => {
  const { mp, log, personal, audit, who, display, nameOf, tagOf, profileOf,
    onlineActors, isLeadStaff, isAdmin, giveItem, registerChatCommand } = api;

  const descOf = (id) => { try { return String(mp.getDescFromId(id >>> 0)); } catch (e) { return ''; } };
  const idOf = (desc) => {
    try {
      if (typeof desc === 'number') return desc >>> 0;
      const s = String(desc || '').trim();
      if (/^0x[0-9a-fA-F]+$/i.test(s) || /^\d+$/.test(s)) return Number(s) >>> 0;
      if (s.includes(':')) {
        let norm = s;
        const m = /^([^:]+):0*([0-9a-fA-F]+)$/.exec(s);
        if (m) norm = `${m[2]}:${m[1]}`;
        try { const id1 = mp.getIdFromDesc(norm) >>> 0; if (id1) return id1; } catch (e) {}
        try { const id2 = mp.getIdFromDesc(s) >>> 0; if (id2) return id2; } catch (e) {}
      }
      return 0;
    } catch (e) { return 0; }
  };

  // Load catalogs
  let tomesList = [];
  try {
    const tomesData = JSON.parse(fs.readFileSync(path.resolve('spell-tomes.json'), 'utf8'));
    tomesList = Array.isArray(tomesData.tomes) ? tomesData.tomes : [];
  } catch (e) { log('staffitemspells: spell-tomes.json unreadable', e.message); }

  let itemsCatalog = [];
  try {
    const itemsData = JSON.parse(fs.readFileSync(path.resolve('admin-items.json'), 'utf8'));
    for (const cat of (itemsData.categories || [])) {
      for (const it of (cat.items || [])) {
        if (Array.isArray(it) && it.length >= 2) itemsCatalog.push(it);
      }
    }
  } catch (e) { log('staffitemspells: admin-items.json unreadable', e.message); }

  const resolveSpell = (query) => {
    const q = String(query || '').trim();
    if (!q) return null;
    const directId = idOf(q);
    if (directId) {
      let name = q;
      try {
        const spRecord = mp.lookupEspmRecordById(directId);
        if (spRecord && spRecord.record && spRecord.record.name) name = String(spRecord.record.name);
      } catch (e) {}
      return { id: directId, name, desc: descOf(directId) };
    }
    const qLower = q.toLowerCase();
    for (const t of tomesList) {
      if (t.spellName && t.spellName.toLowerCase() === qLower) {
        const sid = idOf(t.spellId);
        if (sid) return { id: sid, name: t.spellName, desc: descOf(sid), tomeId: idOf(t.id), school: t.school };
      }
      if (t.fullName && t.fullName.toLowerCase() === qLower) {
        const sid = idOf(t.spellId);
        if (sid) return { id: sid, name: t.spellName, desc: descOf(sid), tomeId: idOf(t.id), school: t.school };
      }
    }
    for (const t of tomesList) {
      if (t.spellName && t.spellName.toLowerCase().includes(qLower)) {
        const sid = idOf(t.spellId);
        if (sid) return { id: sid, name: t.spellName, desc: descOf(sid), tomeId: idOf(t.id), school: t.school };
      }
      if (t.fullName && t.fullName.toLowerCase().includes(qLower)) {
        const sid = idOf(t.spellId);
        if (sid) return { id: sid, name: t.spellName, desc: descOf(sid), tomeId: idOf(t.id), school: t.school };
      }
    }
    return null;
  };

  const resolveItem = (query) => {
    const q = String(query || '').trim();
    if (!q) return null;
    const directId = idOf(q);
    if (directId) {
      let name = q;
      try {
        const rec = mp.lookupEspmRecordById(directId);
        if (rec && rec.record && rec.record.name) name = String(rec.record.name);
      } catch (e) {}
      return { id: directId, name, desc: descOf(directId) };
    }
    const qLower = q.toLowerCase();
    for (const it of itemsCatalog) {
      if (it[1].toLowerCase() === qLower) {
        const iId = idOf(it[0]);
        if (iId) return { id: iId, name: it[1], desc: it[0] };
      }
    }
    for (const it of itemsCatalog) {
      if (it[1].toLowerCase().includes(qLower)) {
        const iId = idOf(it[0]);
        if (iId) return { id: iId, name: it[1], desc: it[0] };
      }
    }
    for (const t of tomesList) {
      if ((t.fullName && t.fullName.toLowerCase().includes(qLower)) || (t.spellName && t.spellName.toLowerCase().includes(qLower))) {
        const tId = idOf(t.id);
        if (tId) return { id: tId, name: t.fullName || `Spell Tome: ${t.spellName}`, desc: t.id };
      }
    }
    return null;
  };

  const resolveTarget = (query) => {
    const q = String(query || '').trim();
    if (!q) return null;
    if (q.startsWith('#') || q.length === 4) {
      const wantTag = q.toLowerCase().replace(/^#/, '');
      for (const a of onlineActors()) {
        try {
          const t = String(tagOf(a) || '').toLowerCase().replace(/^#/, '');
          if (t === wantTag) return { actor: a >>> 0, online: true, name: display(a), tag: tagOf(a), pid: profileOf(a) };
        } catch (e) {}
      }
    }
    for (const a of onlineActors()) {
      try {
        const n = String(nameOf(a) || '').toLowerCase();
        if (n === q.toLowerCase() || n.includes(q.toLowerCase())) {
          return { actor: a >>> 0, online: true, name: display(a), tag: tagOf(a), pid: profileOf(a) };
        }
      } catch (e) {}
    }
    if (typeof api.officialTarget === 'function') {
      const tgt = api.officialTarget(q);
      if (tgt && !tgt.error && tgt.actor) {
        return { actor: tgt.actor >>> 0, online: !!tgt.online, name: tgt.label || q, tag: tagOf(tgt.actor) || q, pid: tgt.pid };
      }
    }
    return null;
  };

  // 1. /giveitem
  registerChatCommand('giveitem', (caller, args) => {
    if (!isLeadStaff(caller) && !isAdmin(caller)) {
      return personal(caller, 'Only a Lead GM or above manages player items.');
    }
    const raw = String(args || '').trim();
    if (!raw) return personal(caller, 'Usage: /giveitem <#TAG|name> <item name or id> [count] [ticket:<id>]');
    const parts = raw.split(/\s+/);
    if (parts.length < 2) return personal(caller, 'Usage: /giveitem <#TAG|name> <item name or id> [count] [ticket:<id>]');

    const targetQuery = parts[0];
    let count = 1;
    let itemParts = [];
    let reason = '';

    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      if (/^(ticket|call):/i.test(p)) {
        reason += (reason ? ' ' : '') + p;
      } else if (/^\d+$/.test(p) && itemParts.length > 0 && count === 1 && i >= parts.length - 2) {
        count = Number(p);
      } else {
        itemParts.push(p);
      }
    }
    const itemQuery = itemParts.join(' ');
    const it = resolveItem(itemQuery);
    if (!it) return personal(caller, `Could not find any item matching '${itemQuery}'.`);

    const tgt = resolveTarget(targetQuery);
    if (!tgt) return personal(caller, `Could not find player '${targetQuery}'.`);

    if (tgt.online && tgt.actor) {
      const ok = giveItem(tgt.actor, it.id, count);
      if (!ok) return personal(caller, `Failed to give ${it.name} to ${tgt.name}.`);
      personal(tgt.actor, `Staff gave you: ${it.name} x${count}.`);
      audit(`STAFF ${who(caller)} gave ${count}x ${it.name} (0x${it.id.toString(16)}) to ${tgt.name}${reason ? ` (${reason})` : ''}`);
      return personal(caller, `Gave ${it.name} x${count} to ${tgt.name}.`);
    } else {
      try {
        const inboxDir = path.resolve('gifts-inbox');
        if (!fs.existsSync(inboxDir)) fs.mkdirSync(inboxDir, { recursive: true });
        const giftId = `item-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const giftPayload = {
          tag: String(tgt.tag || targetQuery).replace(/^#/, '').toUpperCase(),
          profile: tgt.pid > 0 ? tgt.pid : undefined,
          items: [{ baseId: it.id, count }],
          reason: reason || 'Granted by staff',
          by: who(caller),
          at: Date.now()
        };
        fs.writeFileSync(path.join(inboxDir, `${giftId}.json`), JSON.stringify(giftPayload, null, 2));
        audit(`STAFF ${who(caller)} queued gift ${count}x ${it.name} for offline ${tgt.name}${reason ? ` (${reason})` : ''}`);
        return personal(caller, `Player is offline. Queued ${it.name} x${count} to be delivered on their next login.`);
      } catch (err) {
        return personal(caller, `Failed to queue offline gift: ${err.message}`);
      }
    }
  }, { admin: true, help: '<#TAG|name> <item> [count] [ticket:<id>]: give an item to a player (online or offline)' });

  // 2. /takeitem
  registerChatCommand('takeitem', (caller, args) => {
    if (!isLeadStaff(caller) && !isAdmin(caller)) {
      return personal(caller, 'Only a Lead GM or above manages player items.');
    }
    const raw = String(args || '').trim();
    if (!raw) return personal(caller, 'Usage: /takeitem <#TAG|name> <item name or id> [count] [ticket:<id>]');
    const parts = raw.split(/\s+/);
    if (parts.length < 2) return personal(caller, 'Usage: /takeitem <#TAG|name> <item name or id> [count] [ticket:<id>]');

    const targetQuery = parts[0];
    let count = 1;
    let itemParts = [];
    let reason = '';

    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      if (/^(ticket|call):/i.test(p)) {
        reason += (reason ? ' ' : '') + p;
      } else if (/^\d+$/.test(p) && itemParts.length > 0 && count === 1 && i >= parts.length - 2) {
        count = Number(p);
      } else {
        itemParts.push(p);
      }
    }
    const itemQuery = itemParts.join(' ');
    const it = resolveItem(itemQuery);
    if (!it) return personal(caller, `Could not find any item matching '${itemQuery}'.`);

    const tgt = resolveTarget(targetQuery);
    if (!tgt || !tgt.online || !tgt.actor) {
      return personal(caller, `Player '${targetQuery}' must be online to take items from inventory.`);
    }

    try {
      const inv = mp.get(tgt.actor, 'inventory') || { entries: [] };
      let entries = Array.isArray(inv.entries) ? inv.entries.map((e) => Object.assign({}, e)) : [];
      const hit = entries.find((e) => e && (Number(e.baseId) >>> 0) === (it.id >>> 0));
      if (!hit || (Number(hit.count) || 0) <= 0) {
        return personal(caller, `${tgt.name} does not have ${it.name} in their inventory.`);
      }
      const taken = Math.min(count, Number(hit.count) || 0);
      hit.count = (Number(hit.count) || 0) - taken;
      entries = entries.filter((e) => (Number(e.count) || 0) > 0);
      mp.set(tgt.actor, 'inventory', { entries });
      if ((it.id >>> 0) === 0x0000000f && typeof api.goldChanged === 'function') api.goldChanged(tgt.actor);

      personal(tgt.actor, `Staff removed from your inventory: ${it.name} x${taken}.`);
      audit(`STAFF ${who(caller)} took ${taken}x ${it.name} from ${tgt.name}${reason ? ` (${reason})` : ''}`);
      return personal(caller, `Removed ${it.name} x${taken} from ${tgt.name}'s inventory.`);
    } catch (e) {
      return personal(caller, `Failed to take item: ${e.message}`);
    }
  }, { admin: true, help: '<#TAG|name> <item> [count] [ticket:<id>]: take an item from an online player' });

  // 3. /givespell
  registerChatCommand('givespell', (caller, args) => {
    if (!isLeadStaff(caller) && !isAdmin(caller)) {
      return personal(caller, 'Only a Lead GM or above manages player spells.');
    }
    const raw = String(args || '').trim();
    if (!raw) return personal(caller, 'Usage: /givespell <#TAG|name> <spell name or id> [ticket:<id>]');
    const parts = raw.split(/\s+/);
    if (parts.length < 2) return personal(caller, 'Usage: /givespell <#TAG|name> <spell name or id> [ticket:<id>]');

    const targetQuery = parts[0];
    let spellParts = [];
    let reason = '';
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      if (/^(ticket|call):/i.test(p)) reason += (reason ? ' ' : '') + p;
      else spellParts.push(p);
    }
    const spellQuery = spellParts.join(' ');
    const sp = resolveSpell(spellQuery);
    if (!sp) return personal(caller, `Could not find any spell matching '${spellQuery}'.`);

    const tgt = resolveTarget(targetQuery);
    if (!tgt || !tgt.online || !tgt.actor) {
      return personal(caller, `Player '${targetQuery}' must be online to learn spells.`);
    }

    try {
      const selfForm = { type: 'form', desc: descOf(tgt.actor) };
      mp.callPapyrusFunction('method', 'Actor', 'AddSpell', selfForm, [{ type: 'espm', desc: descOf(sp.id) }]);

      if (typeof globalThis.__dboSpellsGrant === 'function') {
        const school = (sp.school || 'arcane').toLowerCase();
        globalThis.__dboSpellsGrant(tgt.actor, sp.id, school === 'restoration' ? 'priest' : school);
      }

      personal(tgt.actor, `Staff granted you the spell: ${sp.name}.`);
      audit(`STAFF ${who(caller)} granted spell ${sp.name} (0x${sp.id.toString(16)}) to ${tgt.name}${reason ? ` (${reason})` : ''}`);
      return personal(caller, `Granted spell '${sp.name}' to ${tgt.name}.`);
    } catch (e) {
      return personal(caller, `Failed to grant spell: ${e.message}`);
    }
  }, { admin: true, help: '<#TAG|name> <spell> [ticket:<id>]: grant a spell to an online player' });

  // 4. /removespell
  registerChatCommand('removespell', (caller, args) => {
    if (!isLeadStaff(caller) && !isAdmin(caller)) {
      return personal(caller, 'Only a Lead GM or above manages player spells.');
    }
    const raw = String(args || '').trim();
    if (!raw) return personal(caller, 'Usage: /removespell <#TAG|name> <spell name or id> [ticket:<id>]');
    const parts = raw.split(/\s+/);
    if (parts.length < 2) return personal(caller, 'Usage: /removespell <#TAG|name> <spell name or id> [ticket:<id>]');

    const targetQuery = parts[0];
    let spellParts = [];
    let reason = '';
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      if (/^(ticket|call):/i.test(p)) reason += (reason ? ' ' : '') + p;
      else spellParts.push(p);
    }
    const spellQuery = spellParts.join(' ');
    const sp = resolveSpell(spellQuery);
    if (!sp) return personal(caller, `Could not find any spell matching '${spellQuery}'.`);

    const tgt = resolveTarget(targetQuery);
    if (!tgt || !tgt.online || !tgt.actor) {
      return personal(caller, `Player '${targetQuery}' must be online to remove spells.`);
    }

    try {
      const selfForm = { type: 'form', desc: descOf(tgt.actor) };
      mp.callPapyrusFunction('method', 'Actor', 'RemoveSpell', selfForm, [{ type: 'espm', desc: descOf(sp.id) }]);

      try {
        const prep = (mp.get(tgt.actor, 'private.dboPrepared') || []).filter((x) => (x >>> 0) !== (sp.id >>> 0));
        mp.set(tgt.actor, 'private.dboPrepared', prep);
      } catch (e) {}

      try {
        const studied = mp.get(tgt.actor, 'private.dboStudied') || {};
        for (const k of Object.keys(studied)) {
          if (Array.isArray(studied[k])) studied[k] = studied[k].filter((x) => (x >>> 0) !== (sp.id >>> 0));
        }
        mp.set(tgt.actor, 'private.dboStudied', studied);
      } catch (e) {}

      try {
        const PROP = 'private.dboMagicSchools';
        const s = mp.get(tgt.actor, PROP);
        if (s && s.picks) {
          for (const sc of Object.keys(s.picks)) {
            if (s.picks[sc] && s.picks[sc].first) {
              const f = s.picks[sc].first;
              if (f.spell === descOf(sp.id) || f.spell === sp.name) delete s.picks[sc].first;
            }
          }
          mp.set(tgt.actor, PROP, s);
        }
      } catch (e) {}

      if (typeof globalThis.__dboSpellsLearnedChanged === 'function') {
        try { globalThis.__dboSpellsLearnedChanged(tgt.actor); } catch (e) {}
      }

      personal(tgt.actor, `Staff removed the spell: ${sp.name}.`);
      audit(`STAFF ${who(caller)} removed spell ${sp.name} (0x${sp.id.toString(16)}) from ${tgt.name}${reason ? ` (${reason})` : ''}`);
      return personal(caller, `Removed spell '${sp.name}' from ${tgt.name}.`);
    } catch (e) {
      return personal(caller, `Failed to remove spell: ${e.message}`);
    }
  }, { admin: true, help: '<#TAG|name> <spell> [ticket:<id>]: remove a spell from an online player' });

  log('staffitemspells: loaded (/giveitem, /takeitem, /givespell, /removespell registered; /unstuck stays gamemode.js)');
};

