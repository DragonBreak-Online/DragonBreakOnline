// What the native admin panel (swf/dbo_admin) is sent: one tab's worth of the admin data, already searched and paged.
// The browser panel holds everything and filters it itself; a Scaleform payload is capped (scaleformMenu MAX_PAYLOAD_CHARS)
// and its JSON is parsed by ActionScript, so adminMenuService keeps the catalogs and the staff widgets here and the SWF
// reports what it shows (admin::ui) and gets back that page. The rules (who sees which tab, what a Trial GM may press,
// how a search ranks) are the browser panel's, read from skymp5-front features/adminPanel. No imports, so a harness loads
// it on its own (tests/admin-native-view-harness.js).

export const PAGE_ROWS = 9;

// The tabs in rail order, as the browser's TABS; GM Calls is answered by the gamemode, which checks the rights itself
export const TAB_ORDER = ["debug", "players", "gmcalls", "thievery", "skills", "items", "enchant", "powers", "teleport", "place", "modes", "npcs"];
export const TAB_LABELS: Record<string, string> = {
  debug: "Debug", players: "Players", gmcalls: "GM Calls", thievery: "Thievery", skills: "Skills", items: "Items", enchant: "Enchant",
  powers: "Powers", teleport: "Teleport", place: "Place", modes: "Modes", npcs: "NPCs",
};
const GAMEPLAY_TABS = ["gmcalls"];
// The tabs that act on the character named in the status strip
export const ACTS_ON = ["players", "skills", "items", "enchant", "powers"];
export const REGIONS = ["Skyrim", "Cyrodiil", "Morrowind", "Hammerfell", "Other", "Custom"];
const SCHOOL_ORDER = ["Alteration", "Conjuration", "Destruction", "Illusion", "Restoration"];

// The staffData widgets the gamemode sends for the gamemode-fed tabs (front staffTabs.tsx, thieveryTab.tsx)
export const STAFF_WIDGETS = { gmcalls: 140, enchantCatalog: 141, enchantItems: 142, thievery: 162 };

// What the SWF says it shows; every field is optional and checked here
export interface AdminUi {
  tab?: string;
  page?: number;
  q?: string;
  online?: boolean;
  selected?: number;
  acting?: string;
  cat?: string;
  mod?: string;
  region?: string;
  world?: string;
  sub?: string;
  piece?: string;
  ench?: string;
  owner?: string;
  thief?: string;
  zone?: string;
  typing?: boolean;
  // how many rows the panel has room for on this view (1 to PAGE_ROWS)
  rows?: number;
}

export interface AdminCatalogs {
  items: Array<{ id: string; label: string; items: Array<[string, string, string?]> }> | null;
  locations: Array<{ name: string; region: string; worldName: string }> | null;
}

// ---- the browser's fuzzy search (skymp5-front components/SearchBar/fuzzy.ts), so a search ranks the same in both ----
const wordScore = (word: string, hay: string): number => {
  const at = hay.indexOf(word);
  if (at === 0) return 100;
  if (at > 0) return /[\s_:.\-(]/.test(hay[at - 1]) ? 90 : 70;
  let i = 0, first = -1, last = -1;
  for (let k = 0; k < hay.length && i < word.length; k++) {
    if (hay[k] === word[i]) { if (first < 0) first = k; last = k; i++; }
  }
  if (i < word.length) return 0;
  const spread = last - first + 1 - word.length;
  return Math.max(1, 40 - spread);
};

export const fuzzyScore = (query: string, hay: string): number => {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const h = String(hay || "").toLowerCase();
  let total = 0;
  for (const w of words) {
    const s = wordScore(w, h);
    if (!s) return 0;
    total += s;
  }
  return total / words.length;
};

export function fuzzyFilter<T>(rows: T[], query: string, hayOf: (row: T) => string): T[] {
  if (!String(query || "").trim()) return rows;
  const scored: Array<{ row: T; score: number; i: number }> = [];
  rows.forEach((row, i) => { const score = fuzzyScore(query, hayOf(row)); if (score) scored.push({ row, score, i }); });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map((x) => x.row);
}

// Editor ids read as words, as the browser's humanize
export const humanize = (edid: string): string =>
  String(edid || "")
    .replace(/^(DLC0?[12]|CYR|BSK|BS|CC[A-Z]{3}SSE\d+_?|dun|MQ\d*|TG\d*|DB\d*|MS\d*)/, "")
    .replace(/^(Armor|Clothes|Clothing|Weapon|Ench)(?=[A-Z])/, "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/(\D)(\d)/g, "$1 $2")
    .trim() || edid;

const str = (v: unknown, max = 80): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v)).slice(0, max);
const num = (v: unknown, d = 0): number => (typeof v === "number" && isFinite(v) ? v : d);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const plugin = (p: string): string => p.replace(/\.(esp|esm|esl)$/i, "");

// The rows a page holds: what the panel asked for, never more than nine
const rowsOf = (ui: AdminUi): number => Math.max(1, Math.min(PAGE_ROWS, Math.floor(num(ui && ui.rows, PAGE_ROWS))));

// One page of a list: the rows, where it starts and how many there are
export function pageOf<T>(rows: T[], page: unknown, size = PAGE_ROWS): { rows: T[]; page: number; pages: number; total: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.max(0, Math.min(pages - 1, Math.floor(num(page))));
  return { rows: rows.slice(p * size, p * size + size), page: p, pages, total: rows.length };
}

// The tabs this admin sees, as the browser's shownTabs
export const tabsFor = (data: any): string[] => {
  if (!data || !data.admin) return ["debug"];
  const allowed: string[] | null = data.caps && Array.isArray(data.caps.tabs) ? data.caps.tabs : null;
  return TAB_ORDER.filter((t) => !allowed || t === "debug" || GAMEPLAY_TABS.indexOf(t) !== -1 || allowed.indexOf(t) !== -1);
};

// The capability flags the browser derives from caps (index.tsx), so the SWF draws only what it may
export const capsOf = (data: any) => {
  const caps = (data && data.caps) || null;
  const actions: string[] | null = caps && Array.isArray(caps.actions) ? caps.actions : null;
  return {
    ban: !caps || caps.ban !== false,
    del: !caps || (caps.del !== undefined ? !!caps.del : caps.ban !== false),
    spawn: !caps || caps.spawn !== false,
    trial: !!(caps && caps.trial),
    actions: actions ? ["teleportTo", "summon", "kick", "rename"].filter((a) => actions.indexOf(a) !== -1) : ["teleportTo", "summon", "kick", "rename"],
  };
};

// Who an action happens to: you first, then everyone online (the browser's targets)
export const targetsOf = (data: any): Array<{ id: string; label: string; beast?: any }> => {
  const me = data && data.me ? data.me : null;
  return [{ id: "", label: "You", beast: me ? me.b : undefined }].concat(
    arr<any>(data && data.players).filter((pl) => pl && pl.online && pl.a).map((pl) => ({ id: str(pl.a, 16), label: str(pl.n) || "(no name)", beast: pl.b })),
  );
};

const pad2 = (n: number): string => (n < 10 ? "0" : "") + n;
export const formatCountdown = (totalSec: number): string => {
  const h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60), s = totalSec % 60;
  return h ? h + ":" + pad2(m) + ":" + pad2(s) : m + ":" + pad2(s);
};

// ---- per tab ----

const playersView = (data: any, ui: AdminUi) => {
  const filter = str(ui.q, 60).trim().toLowerCase();
  const all = arr<any>(data.players);
  const shown = all.filter((pl) => {
    if (ui.online && !pl.online) return false;
    if (!filter) return true;
    const hay = [pl.n, pl.t ? "#" + pl.t : "", pl.dn, pl.d, String(pl.p), pl.a || "", pl.ip, pl.hwid].join(" ").toLowerCase();
    return hay.indexOf(filter) !== -1;
  });
  const pg = pageOf(shown, ui.page, rowsOf(ui));
  const row = (pl: any) => ({
    p: num(pl.p), n: str(pl.n) || "-", t: str(pl.t, 8), a: str(pl.a, 16), online: !!pl.online,
    ping: pl.online && typeof pl.ping === "number" ? pl.ping : null, dn: str(pl.dn, 40), d: str(pl.d, 24), ip: str(pl.ip, 40), hwid: str(pl.hwid, 40),
  });
  const sel = all.find((pl) => pl.p === ui.selected) || null;
  return {
    rows: pg.rows.map(row), page: pg.page, pages: pg.pages, total: pg.total, all: all.length,
    selected: sel ? Object.assign(row(sel), { m: sel.m || null }) : null,
    bans: arr<any>(data.bans).slice(0, 40).map((b) => ({ id: str(b.id, 40), name: str(b.name) || "profile " + num(b.profileId), ip: str(b.ip, 40), until: num(b.until), by: str(b.by, 40) })),
    mastery: data.mastery || null,
  };
};

const masteryOf = (data: any, want: string) => {
  const mt = data.masteryTarget;
  if (!mt || !mt.detail) return mt ? { name: str(mt.name), target: str(mt.target, 16), detail: null } : null;
  if (want && mt.target !== want) return null;
  const d = mt.detail;
  const schools = Array.isArray(d.schools) ? d.schools : null;
  return {
    name: str(mt.name), target: str(mt.target, 16),
    detail: {
      skills: arr<any>(d.skills).map((s) => ({ id: str(s.id, 40), label: str(s.label), chosen: !!s.chosen, rank: num(s.rank), hours: num(s.hours) })),
      tierNames: arr<string>(d.tierNames).map((t) => str(t, 24)), maxChosen: num(d.maxChosen, 3),
      schools: schools ? SCHOOL_ORDER.map((n) => schools.find((x: any) => x && x.name === n)).filter(Boolean)
        .map((x: any) => ({ name: str(x.name), level: num(x.level), role: str(x.role, 24), roleLabel: str(x.roleLabel, 40) })) : null,
    },
  };
};

const itemsView = (cats: AdminCatalogs, ui: AdminUi) => {
  if (!cats.items) return { loading: true };
  const index: Array<{ desc: string; name: string; plugin: string; cat: string; catLabel: string; hay: string }> = [];
  const plugins: Record<string, boolean> = {};
  for (const c of cats.items) for (const it of c.items) {
    const name = it[2] === undefined ? humanize(it[1]) : it[1];
    if (it[2]) plugins[it[2]] = true;
    index.push({ desc: it[0], name, plugin: it[2] || "", cat: c.id, catLabel: c.label, hay: name + " " + it[1] + " " + it[0] });
  }
  const mod = str(ui.mod, 80);
  const q = str(ui.q, 60).trim();
  const cat = str(ui.cat, 40);
  const matches = fuzzyFilter(index.filter((r) => !mod || r.plugin === mod), q, (r) => r.hay);
  const rows = cat ? matches.filter((r) => r.cat === cat) : q ? matches : [];
  const counts: Record<string, number> = {};
  for (const r of matches) counts[r.cat] = (counts[r.cat] || 0) + 1;
  const pg = pageOf(rows, ui.page, rowsOf(ui));
  return {
    chips: [{ id: "", label: "All", count: matches.length }].concat(cats.items.map((c) => ({ id: c.id, label: c.label, count: counts[c.id] || 0 })).filter((c) => !q || c.count)),
    // the filter compares the full plugin name; the panel shows it without its extension
    plugins: Object.keys(plugins).sort((a, b) => a.localeCompare(b)).map((p) => ({ id: p, label: plugin(p) })),
    rows: pg.rows.map((r) => ({ desc: r.desc, name: r.name, cat: r.catLabel, plugin: plugin(r.plugin) })),
    page: pg.page, pages: pg.pages, total: pg.total, hint: !rows.length ? (q || cat ? "No items" : "Type to search, or pick a category") : "",
  };
};

const teleportView = (cats: AdminCatalogs, ui: AdminUi) => {
  if (!cats.locations) return { loading: true };
  const q = str(ui.q, 60).trim();
  const matches = fuzzyFilter(cats.locations, q, (l) => l.name + " " + l.worldName + " " + l.region);
  const counts: Record<string, number> = {};
  for (const l of matches) counts[l.region] = (counts[l.region] || 0) + 1;
  const regions = REGIONS.filter((r) => counts[r]).concat(Object.keys(counts).filter((r) => REGIONS.indexOf(r) === -1).sort());
  // As the browser: typing searches every region; with no text a region is always open
  let region = ui.region === undefined ? "Cyrodiil" : str(ui.region, 40);
  if (!q && (!region || !counts[region])) region = regions[0] || "";
  const inScope = region ? matches.filter((l) => l.region === region) : matches;
  const wc: Record<string, number> = {};
  for (const l of inScope) wc[l.worldName || "-"] = (wc[l.worldName || "-"] || 0) + 1;
  const worlds = Object.keys(wc).sort((a, b) => wc[b] - wc[a] || a.localeCompare(b)).map((w) => ({ w, n: wc[w] }));
  const world = worlds.some((x) => x.w === ui.world) ? str(ui.world, 80) : "";
  const list = world ? inScope.filter((l) => (l.worldName || "-") === world) : inScope;
  const rows = q ? list : list.slice().sort((a, b) => a.name.localeCompare(b.name));
  const pg = pageOf(rows, ui.page, rowsOf(ui));
  return {
    region, world,
    chips: (q ? [{ id: "", label: "All", count: matches.length }] : []).concat(regions.map((r) => ({ id: r, label: r, count: counts[r] || 0 }))),
    worlds: worlds.length > 1 ? [{ w: "", n: inScope.length }].concat(worlds) : [],
    rows: pg.rows.map((l) => ({ name: str(l.name), where: (q ? l.region + " - " : "") + str(l.worldName) })),
    page: pg.page, pages: pg.pages, total: pg.total,
  };
};

const powersView = (data: any, ui: AdminUi) => {
  const targets = targetsOf(data);
  const acting = targets.find((t) => t.id === str(ui.acting, 16)) || targets[0];
  const polymorph = data.polymorph && typeof data.polymorph === "object" ? data.polymorph : null;
  const forms: Array<{ key: string; name: string }> = polymorph ? arr<any>(polymorph.forms).map((f) => ({ key: str(f.key, 40), name: str(f.name, 40) })) : [];
  const now = Date.now();
  const polymorphed = targets.filter((t) => t.beast && t.beast.form && t.beast.creature === true).map((t) => ({
    id: t.id, label: t.label, form: str(t.beast.form, 40),
    name: ((forms.find((f) => f.key === t.beast.form) || { name: "" }).name) || humanize(t.beast.form),
    minutes: typeof t.beast.since === "number" && t.beast.since > 0 ? Math.max(0, Math.round((now - t.beast.since) / 60000)) : null,
  }));
  return {
    beast: acting && acting.beast ? acting.beast : null,
    selfBeast: data.me && data.me.b ? data.me.b : null,
    polymorph: polymorph ? { on: !!polymorph.on, setBy: str(polymorph.setBy, 40), forms } : null,
    polymorphed: polymorphed.slice(0, 20),
  };
};

const placeView = (data: any, ui: AdminUi) => {
  const sub = ["catalog", "placed", "sets", "warband"].indexOf(str(ui.sub, 12)) !== -1 ? str(ui.sub, 12) : "catalog";
  const meta = data.placeMeta || null;
  const out: any = { sub, meta: meta ? { categories: arr<any>(meta.categories).map((c) => ({ id: str(c.id, 40), label: str(c.label), kind: str(c.kind, 8), count: num(c.count) })), plugins: arr<string>(meta.plugins).map((p) => ({ id: str(p), label: plugin(str(p)) })), rights: meta.rights || null } : null };
  if (sub === "catalog" || sub === "warband") {
    const r = data.placeResults || null;
    // One results page from placement.js is up to 100 rows: the SWF gets nine of them, and asks the server for more past the end
    if (r) {
      const items = arr<any>(r.items).filter((it) => sub === "catalog" || it[4] === "npc");
      const pg = pageOf(items, ui.page, rowsOf(ui));
      out.results = {
        query: str(r.query, 60), category: str(r.category, 40), plugin: str(r.plugin, 80), total: num(r.total), loaded: items.length,
        rows: pg.rows.map((it) => ({ desc: str(it[0], 40), name: str(it[1]), plugin: plugin(str(it[2])), cat: str(it[3], 40), kind: str(it[4], 8) })),
        page: pg.page, pages: pg.pages,
      };
    } else out.results = null;
  }
  if (sub === "placed") {
    const p = data.placements || null;
    if (p) {
      const pg = pageOf(arr<any>(p.items), ui.page, rowsOf(ui));
      out.placements = {
        here: num(p.here), total: num(p.total), page: pg.page, pages: pg.pages, count: pg.total,
        rows: pg.rows.map((r) => ({ id: str(r.id, 24), base: str(r.base, 40), name: str(r.name), kind: str(r.kind, 8), hostile: !!r.hostile, dist: num(r.dist), mine: r.mine !== false, group: r.group ? str(r.group, 60).split("#")[0] : "", pos: arr<number>(r.pos).slice(0, 3), rot: arr<number>(r.rot).slice(0, 3) })),
      };
    } else out.placements = null;
  }
  if (sub === "sets") {
    const s = Array.isArray(data.placeSets) ? data.placeSets : null;
    if (s) {
      const pg = pageOf(s, ui.page, rowsOf(ui));
      out.sets = { rows: pg.rows.map((x: any) => ({ name: str(x.name, 40), count: num(x.count) })), page: pg.page, pages: pg.pages, total: pg.total };
    } else out.sets = null;
  }
  if (sub === "warband") {
    const w = data.warband || null;
    out.warband = w ? {
      members: arr<any>(w.members).slice(0, 25).map((m) => ({ id: str(m.id, 24), name: str(m.name), alive: !!m.alive, dist: m.dist === null ? null : num(m.dist), fighting: !!m.fighting, health: typeof m.health === "number" ? m.health : null, state: str(m.state, 16), target: str(m.target, 40) })),
      counts: arr<any>(w.counts).map((c) => ({ name: str(c.name), count: num(c.count) })),
      placed: arr<any>(w.placed).slice(0, 30).map((r) => ({ id: str(r.id, 24), name: str(r.name), hostile: !!r.hostile, alive: !!r.alive, dist: r.dist === null ? null : num(r.dist) })),
      players: arr<any>(w.players).slice(0, 12).map((p) => ({ id: str(p.id, 24), name: str(p.name), dist: p.dist === null ? null : num(p.dist) })),
      npcs: arr<any>(w.npcs).slice(0, 12).map((n) => ({ id: str(n.id, 24), name: str(n.name), gm: str(n.gm, 40), foe: !!n.foe, dist: n.dist === null ? null : num(n.dist) })),
      foes: arr<any>(w.foes).slice(0, 12).map((f) => ({ id: str(f.id, 24), name: str(f.name), dist: num(f.dist) })),
      target: w.target ? { id: str(w.target.id, 24), name: str(w.target.name), dist: w.target.dist === null ? null : num(w.target.dist) } : null,
      stance: str(w.stance, 16), side: str(w.side, 24), enemies: arr<string>(w.enemies).map((e) => str(e, 24)),
      plan: w.plan ? { calm: num(w.plan.calm), kept: str(w.plan.kept, 200), unread: str(w.plan.unread, 200) } : { calm: 0, kept: "", unread: "" },
      presets: arr<any>(w.presets).slice(0, 12).map((p) => ({ name: str(p.name, 32), count: num(p.count) })),
      onLogout: str(w.onLogout, 16), maxBand: num(w.maxBand, 25), maxRaise: num(w.maxRaise, 10),
      last: w.last ? str(w.last.text, 200) : "", info: w.info || null,
    } : null;
  }
  return out;
};

const npcsView = (data: any, ui: AdminUi) => {
  const zones = arr<any>(data.npcZones);
  const shown = fuzzyFilter(zones, str(ui.q, 60), (z) => str(z.name));
  const pg = pageOf(shown, ui.page, rowsOf(ui));
  const at = num(data.npcZonesAt, Date.now());
  const elapsed = Math.round((Date.now() - at) / 1000);
  return {
    sub: ui.sub === "add" ? "add" : "list",
    rows: pg.rows.map((z) => {
      const left = z.readyInSec < 0 ? -1 : Math.max(0, num(z.readyInSec) - elapsed);
      const ready = left === 0 ? "Ready" : left < 0 ? "No respawn" : "Ready in " + formatCountdown(left);
      const status = !z.active ? ready : (num(z.alive) + "/" + num(z.total) + " alive" + (left === 0 ? "" : ", " + ready.toLowerCase()));
      return { name: str(z.name), active: !!z.active, status };
    }),
    page: pg.page, pages: pg.pages, total: pg.total, all: zones.length,
  };
};

const enchantView = (staff: Record<number, any>, ui: AdminUi, acting: string) => {
  const catalog = staff[STAFF_WIDGETS.enchantCatalog] || null;
  const pack = staff[STAFF_WIDGETS.enchantItems] || null;
  const items = pack && str(pack.target, 16) === acting ? arr<any>(pack.items) : null;
  const piece = (items || []).find((p) => p.key === ui.piece) || null;
  const kind = piece ? piece.kind : "";
  const list = (catalog ? arr<any>(catalog.list) : []).filter((r) => !kind || r.k === kind);
  const rows = fuzzyFilter(list, str(ui.q, 60), (r) => r.n + " " + r.e + " " + r.p + " " + arr<any>(r.fx).map((f) => f[0]).join(" "));
  const pg = pageOf(rows, ui.page, rowsOf(ui));
  const ench = (catalog ? arr<any>(catalog.list) : []).find((r) => r.id === ui.ench) || null;
  return {
    loading: !catalog, packName: pack ? str(pack.targetName) : "", packLoading: !items,
    pieces: (items || []).slice(0, 40).map((p) => ({ key: str(p.key, 60), name: str(p.name), count: num(p.count, 1), kind: str(p.kind, 2), ok: !!p.ok, why: str(p.why, 60), now: str(p.now, 80) })),
    piece: piece ? str(piece.key, 60) : "",
    rows: pg.rows.map((r) => ({ id: str(r.id, 16), n: str(r.n), fx: arr<any>(r.fx).map((f) => str(f[0], 40) + (f[1] ? " " + f[1] : "")).join(", ").slice(0, 120), p: plugin(str(r.p)) })),
    page: pg.page, pages: pg.pages, total: pg.total, all: catalog ? arr<any>(catalog.list).length : 0,
    ench: ench && (!kind || ench.k === kind) ? { id: str(ench.id, 16), n: str(ench.n), m: num(ench.m), fx: arr<any>(ench.fx).slice(0, 8).map((f) => [str(f[0], 40), num(f[1]), num(f[2]), num(f[3])]) } : null,
    maxScale: catalog ? num(catalog.maxScale, 1) : 1,
  };
};

const gmcallsView = (staff: Record<number, any>, at: Record<number, number>, ui: AdminUi) => {
  const d = staff[STAFF_WIDGETS.gmcalls] || null;
  if (!d) return { loading: true };
  const serverNow = num(d.now) + (Date.now() - (at[STAFF_WIDGETS.gmcalls] || Date.now()));
  // A card is taller than a row: two calls a page, each with its last four lines
  const pg = pageOf(arr<any>(d.open), ui.page, 2);
  return {
    serverNow, quiet: !!d.quiet, canGoto: !!d.canGoto, openCount: arr(d.open).length, waiting: arr<any>(d.open).filter((c) => !c.takenBy).length,
    open: pg.rows.map((c) => ({ n: num(c.n), name: str(c.name), online: !!c.online, place: str(c.place), at: num(c.at), takenBy: str(c.takenBy, 40), mine: !!c.mine, ticket: str(c.ticket, 24),
      lines: arr<any>(c.lines).slice(-4).map((l) => ({ at: num(l.at), text: str(l.text, 300) })) })),
    page: pg.page, pages: pg.pages,
    closed: arr<any>(d.closed).slice(0, 5).map((c) => ({ n: num(c.n), name: str(c.name), how: str(c.how, 24), by: str(c.by, 40), at: num(c.at), note: str(c.note, 120) })),
  };
};

const thieveryView = (staff: Record<number, any>, at: Record<number, number>, ui: AdminUi) => {
  const d = staff[STAFF_WIDGETS.thievery] || null;
  if (!d) return { loading: true };
  const serverNow = num(d.now) + (Date.now() - (at[STAFF_WIDGETS.thievery] || Date.now()));
  const sub = ["factions", "approve", "raids", "ledger", "permits", "breaches"].indexOf(str(ui.sub, 12)) !== -1 ? str(ui.sub, 12) : "factions";
  const o = str(ui.owner, 40).trim().toLowerCase(), t = str(ui.thief, 40).trim().toLowerCase();
  const stolen = arr<any>(d.stolen);
  const ledger = stolen.filter((s) => (!o || str(s.owner).toLowerCase().indexOf(o) !== -1 || str(s.home).toLowerCase().indexOf(o) !== -1) && (!t || str(s.thief).toLowerCase().indexOf(t) !== -1));
  const raids = arr<any>(d.raids);
  const open = raids.filter((r) => r.state === "pending" || r.state === "approved");
  const out: any = {
    sub, serverNow, enabled: !!d.enabled, lead: !!d.lead, gm: !!d.gm,
    armed: d.armed ? { kind: str(d.armed.kind, 12), name: str(d.armed.name), until: num(d.armed.until) } : null,
    counts: { factions: arr(d.factions).length, raids: open.length, ledger: num(d.stolenTotal), permits: arr(d.permits).length + arr(d.breaches).length + arr(d.working).length },
    result: d.result && serverNow - num(d.result.at) < 60000 ? { ok: !!d.result.ok, text: str(d.result.text, 200) } : null,
  };
  if (sub === "factions" || sub === "approve") {
    out.factions = arr<any>(d.factions).slice(0, 20).map((f) => ({ id: str(f.id, 40), name: str(f.name), config: !!f.config,
      fence: f.fence ? { chest: str(f.fence.chest, 40), lots: num(f.fence.lots), frozen: num(f.fence.frozen) } : null }));
    out.candidates = arr<any>(d.candidates).slice(0, 20).map((c) => ({ id: str(c.id, 40), name: str(c.name) }));
  } else if (sub === "raids") {
    const pg = pageOf(raids, ui.page, 2);
    out.raids = pg.rows.map((r) => ({ n: num(r.n), faction: str(r.faction), state: str(r.state, 16), by: str(r.by, 40), evidence: str(r.evidence, 300), at: num(r.at), raidAt: num(r.raidAt), decidedBy: str(r.decidedBy, 40), reason: str(r.reason, 200) }));
    out.page = pg.page; out.pages = pg.pages;
  } else if (sub === "ledger") {
    const pg = pageOf(ledger, ui.page, rowsOf(ui));
    out.ledger = pg.rows.map((s) => ({ n: num(s.n), item: str(s.item), owner: str(s.owner, 40), home: str(s.home, 60), thief: str(s.thief, 40), at: num(s.at), state: str(s.state, 24), canSendBack: !!s.canSendBack }));
    out.page = pg.page; out.pages = pg.pages; out.shown = ledger.length; out.loaded = stolen.length; out.total = num(d.stolenTotal);
  } else {
    // Permits and Breaches share the data; the panel shows one or the other
    out.permits = arr<any>(d.permits).slice(0, 12).map((p) => ({ home: str(p.home, 60), homeName: str(p.homeName), thief: str(p.thief, 40), until: num(p.until), by: str(p.by, 40) }));
    out.working = arr<any>(d.working).slice(0, 8).map((w) => ({ thief: str(w.thief, 40), home: str(w.home, 60), kind: str(w.kind, 16), until: num(w.until) }));
    out.breaches = arr<any>(d.breaches).slice(0, 8).map((b) => ({ thief: str(b.thief, 40), home: str(b.home, 60), faction: str(b.faction, 40), until: num(b.until), at: num(b.at) }));
  }
  return out;
};

// The whole payload for the SWF: the frame (tabs, rights, who is acted on) plus the open tab's block
export const adminNativeView = (data: any, cats: AdminCatalogs, staff: Record<number, any>, staffAt: Record<number, number>, ui: AdminUi, widgetId: number): any => {
  const d = data || {};
  const tabs = tabsFor(d);
  const tab = tabs.indexOf(str(ui.tab, 16)) !== -1 ? str(ui.tab, 16) : "debug";
  const targets = targetsOf(d);
  const acting = targets.find((t) => t.id === str(ui.acting, 16)) || targets[0];
  const caps = capsOf(d);
  const out: any = {
    type: "adminPanel", id: widgetId, admin: !!d.admin, tier: str(d.tier, 16), tab, tabs: tabs.map((t) => ({ id: t, label: TAB_LABELS[t] })),
    caps, acting: { id: acting.id, label: acting.label }, events: d.events || {},
    // the admin's own actor, for the rows that name "You" (Mastery hours); the debug block travels on the Debug tab only
    selfId: str((d.me && d.me.a) || (d.debug && d.debug.actorId), 16),
  };
  if (d.admin && ACTS_ON.indexOf(tab) !== -1) out.targets = targets.slice(0, 120).map((t) => ({ id: t.id, label: t.label }));
  if (tab === "debug") out.debug = d.debug || null;
  else if (tab === "players") {
    out.players = playersView(d, ui);
    out.care = caps.spawn && !caps.trial ? masteryOf(d, acting.id || str(d.me && d.me.a, 16) || str(d.debug && d.debug.actorId, 16)) : null;
  } else if (tab === "skills") out.skills = masteryOf(d, "");
  else if (tab === "items") out.items = itemsView(cats, ui);
  else if (tab === "teleport") out.teleport = teleportView(cats, ui);
  else if (tab === "powers") out.powers = powersView(d, ui);
  else if (tab === "place") out.place = placeView(d, ui);
  else if (tab === "modes") out.modes = arr<any>(d.modes).map((m) => ({ id: str(m.id, 40), label: str(m.label), active: !!m.active }));
  else if (tab === "npcs") out.npcs = npcsView(d, ui);
  else if (tab === "enchant") out.enchant = enchantView(staff, ui, acting.id);
  else if (tab === "gmcalls") out.gmcalls = gmcallsView(staff, staffAt, ui);
  else if (tab === "thievery") out.thievery = thieveryView(staff, staffAt, ui);
  return out;
};
