// Place (server placement.js and warband.js): the catalog of every NPC and object searched on the server a page at a time,
// what was placed near you, saved sets, and the warband, as the browser's Place tab. Placing hands the screen to
// PlacementService (admin::place / placeedit / placeselect, and the panel closes); everything else is an admin::request.
// The browser's one long Warband screen is four views here: Raise, Band, Sides & saved, Raiders.
var PLACE_VIEWS = [["catalog", "Catalog"], ["placed", "Placed near me"], ["sets", "Sets"], ["warband", "Warband"]];
var WB_VIEWS = [["raise", "Raise"], ["band", "Band"], ["sides", "Sides & saved"], ["raiders", "Raiders & garrison"]];
var WARBAND_COUNTS = [1, 2, 3, 5, 8, 10, 15, 20, 25];
var SET_RADII = [10, 20, 40, 60];
// asked: the search last sent, so a late answer to an older one is not shown; picked: the chosen catalog row
var placeLocal = {asked: null, picked: null, hostile: true, placedPick: "", setPick: "", setName: "", setRadius: 20, bandCount: 1, side: "", preset: "",
   member: "", raider: "", wsub: "raise", settling: false, modPicking: false, modPage: 0};

function placeMeta()
{
   return data.place != undefined && data.place.meta != null ? data.place.meta : null;
}

function rights()
{
   var m = placeMeta();
   return m != null && m.rights != null ? m.rights : null;
}

function mayPlace()
{
   return rights() == null || rights().place == true;
}

function mayHostile()
{
   return rights() == null || rights().hostile == true;
}

// The server search for what the panel shows now: typed text across every category, or a category's list
function placeSearch(offset)
{
   var q = trimText(ui.q).toLowerCase();
   var cat = q != "" ? "" : str(ui.cat);
   if (q == "" && cat == "")
   {
      return;
   }
   placeLocal.asked = {query: q, category: cat, plugin: str(ui.mod)};
   req("adminPlaceSearch", {query: q, category: cat, plugin: str(ui.mod), offset: offset == undefined ? 0 : offset});
}

// The results, only when they answer what was asked last
function placeResults()
{
   var r = data.place != undefined ? data.place.results : null;
   var a = placeLocal.asked;
   if (r == null || r == undefined || a == null)
   {
      return null;
   }
   return r.query == a.query && r.category == a.category && r.plugin == a.plugin ? r : null;
}

function warband(text)
{
   placeLocal.settling = false;
   armedKey = "";
   dboSound("UIMenuOK");
   req("adminWarband", {text: text});
   // a settle plan or an armed button is done with at once, before the server's answer redraws the band
   draw();
}

function meters(d)
{
   return d == null || d == undefined ? "elsewhere" : d + " m";
}

function placeStart(row)
{
   if (row == null || !mayPlace())
   {
      return;
   }
   dboSound("UIMenuOK");
   dboSend("admin::place", [dboJson({desc: row.desc, kind: row.kind, name: row.name, hostile: row.kind == "npc" && placeLocal.hostile && mayHostile()})]);
}

function catLabel(id)
{
   var m = placeMeta();
   if (m != null)
   {
      for (var i = 0; i < m.categories.length; i++)
      {
         if (m.categories[i].id == id)
         {
            return m.categories[i].label;
         }
      }
   }
   return id;
}

// The search box, the category chips and the mod button; returns the y under them
function drawSearchBar(c, x, y, w, placeholder)
{
   var m = placeMeta();
   field(c, "search", 20, x, y, 380, str(ui.q), placeholder, 60, function(text)
   {
      ui.q = text;
      ui.page = 0;
      placeSearch(0);
      sendUi();
   }, true);
   btn(c, "mod", 21, x + 396, y - 2, 0, "Mod: " + (str(ui.mod) != "" ? cut(str(ui.mod).split(".esp").join("").split(".esm").join("").split(".esl").join(""), 22) : "every mod"), function()
   {
      dboSound("UIMenuOK");
      placeLocal.modPicking = true;
      placeLocal.modPage = 0;
      draw();
   });
   if (m == null)
   {
      return y + 38;
   }
   var cats = [];
   for (var i = 0; i < m.categories.length && i < 14; i++)
   {
      cats.push([m.categories[i].id, m.categories[i].label + " " + m.categories[i].count]);
   }
   return chips(c, "cat", 30, x, y + 36, x + w, cats, trimText(ui.q) != "" ? "" : str(ui.cat), function()
   {
      dboSound("UIMenuPrevNext");
      ui.cat = this.key;
      ui.q = "";
      ui.page = 0;
      placeSearch(0);
      sendUi();
   });
}

function drawPlaceModPicker(c, x, y, w)
{
   var m = placeMeta();
   var list = [{id: "", label: "Every mod"}].concat(m != null && m.plugins instanceof Array ? m.plugins : []);
   var pages = Math.max(1, Math.ceil(list.length / MAX_ROWS));
   placeLocal.modPage = Math.max(0, Math.min(pages - 1, placeLocal.modPage));
   section(c, "modHead", 100, x, y, w, "Narrow to one mod");
   var ly = rowList(c, "mod", 110, x, y + 34, w, list.slice(placeLocal.modPage * MAX_ROWS, placeLocal.modPage * MAX_ROWS + MAX_ROWS), function(o)
   {
      return [[o.label, 0, w - 40]];
   }, function(o)
   {
      placeLocal.modPicking = false;
      ui.mod = o.id;
      ui.page = 0;
      placeSearch(0);
      sendUi();
      draw();
   }, function(o)
   {
      return o.id == str(ui.mod);
   });
   pageTurn = function(d)
   {
      var p = Math.max(0, Math.min(pages - 1, placeLocal.modPage + d));
      if (p != placeLocal.modPage)
      {
         dboSound("UIMenuPrevNext");
         placeLocal.modPage = p;
         draw();
      }
   };
   if (pages > 1)
   {
      hint(c, "modWhere", 140, x, ly + 8, 400, "Page " + (placeLocal.modPage + 1) + " of " + pages + "  (Left / Right)");
   }
   btn(c, "modCancel", 141, x, CB - 34, 110, "Cancel", function()
   {
      dboSound("UIMenuCancel");
      placeLocal.modPicking = false;
      draw();
   });
}

// The result rows of the current search, with More when the server has more than is loaded
function drawResults(c, x, y, w, onlyNpc, onPick, isOn)
{
   var R = placeResults();
   if (placeMeta() == null || R == null)
   {
      empty(c, "searching", 50, x, y + 6, w, placeMeta() != null ? "Searching" : "Loading the catalog");
      return y + 40;
   }
   var rows = R.rows instanceof Array ? R.rows : [];
   if (!rows.length)
   {
      empty(c, "none", 51, x, y + 6, w, onlyNpc ? "No NPC matches" : "Nothing matches");
   }
   var showCat = trimText(ui.q) != "";
   var ly = rowList(c, "r", 60, x, y, w, rows, function(r)
   {
      return showCat ? [[cut(r.name, 40), 0, 430], [cut(catLabel(r.cat), 20), 440, 220, C_SECOND], [cut(r.plugin, 20), 670, w - 700, C_SECOND]] : [[cut(r.name, 50), 0, 560], [cut(r.plugin, 26), 580, w - 610, C_SECOND]];
   }, onPick, isOn);
   var page = Number(R.page);
   var pages = Number(R.pages);
   var more = Number(R.offset) < Number(R.total);
   pageTurn = function(d)
   {
      var p = page + d;
      if (p >= 0 && p < pages)
      {
         dboSound("UIMenuPrevNext");
         setUi("page", p, true);
      }
      else if (d > 0 && more)
      {
         dboSound("UIMenuPrevNext");
         placeSearch(Number(R.offset));
      }
   };
   hint(c, "where", 80, x, ly + 6, 360, "Page " + (page + 1) + " of " + pages + ", " + R.offset + " of " + R.total + " loaded");
   btn(c, "prev", 81, x + 370, ly + 2, 110, "Previous", function()
   {
      pageTurn(-1);
   }, page <= 0);
   btn(c, "next", 82, x + 486, ly + 2, 0, page < pages - 1 ? "Next" : "Load " + Math.min(100, Number(R.total) - Number(R.offset)) + " more", function()
   {
      pageTurn(1);
   }, page >= pages - 1 && !more);
   return ly + 40;
}

function drawCatalog(c, x, y, w)
{
   if (placeLocal.modPicking)
   {
      drawPlaceModPicker(c, x, y, w);
      return;
   }
   var ry = drawSearchBar(c, x, y, w, "Search every NPC and object");
   drawResults(c, x, ry, w, false, function(r)
   {
      // the second choice of the same row places it, as the browser's double-click
      if (placeLocal.picked != null && placeLocal.picked.desc == r.desc)
      {
         placeStart(r);
         return;
      }
      placeLocal.picked = r;
      draw();
   }, function(r)
   {
      return placeLocal.picked != null && r.desc == placeLocal.picked.desc;
   });
   var ay = CB - 36;
   var rt = rights();
   var p = placeLocal.picked;
   label(c, "picked", 90, x, ay + 4, 360, !mayPlace() && rt != null ? "Placing is " + rt.placeNeeds : p != null ? cut(p.name, 34) : "Pick something (pick it twice to place)", 18, p != null ? C_TEXT : C_SECOND);
   var bx = x + 370;
   if (p != null && p.kind == "npc" && mayPlace())
   {
      var hb = chip(c, "hostile", 91, bx, ay + 2, "Hostile", placeLocal.hostile && mayHostile(), function()
      {
         dboSound("UIMenuPrevNext");
         placeLocal.hostile = !placeLocal.hostile;
         draw();
      });
      if (!mayHostile())
      {
         disable(hb, "Hostile: a higher tier");
      }
      bx += 130;
   }
   btn(c, "place", 92, bx, ay, 100, "Place", function()
   {
      placeStart(placeLocal.picked);
   }, p == null || !mayPlace());
   btn(c, "select", 93, bx + 108, ay, 130, "Select tool", function()
   {
      dboSound("UIMenuOK");
      dboSend("admin::placeselect", []);
   });
}

function placedRow()
{
   var P = data.place != undefined ? data.place.placements : null;
   if (P == null || P == undefined)
   {
      return null;
   }
   for (var i = 0; i < P.rows.length; i++)
   {
      if (P.rows[i].id == placeLocal.placedPick)
      {
         return P.rows[i];
      }
   }
   return null;
}

function drawPlaced(c, x, y, w)
{
   var P = data.place != undefined ? data.place.placements : null;
   if (P == null || P == undefined)
   {
      empty(c, "loading", 20, x, y, w, "Loading what was placed");
      return;
   }
   if (!P.rows.length)
   {
      empty(c, "none", 21, x, y, w, "Nothing placed here" + (P.total ? " (" + P.total + " elsewhere)" : ""));
   }
   var ly = rowList(c, "r", 30, x, y, w, P.rows, function(r)
   {
      return [[cut(r.name, 34), 0, 360], [r.kind == "npc" ? (r.hostile == true ? "NPC, hostile" : "NPC, friendly") : "Object", 370, 170, C_SECOND], [cut(r.group, 20), 550, 220, C_SECOND], [r.dist + " m", 780, w - 810]];
   }, function(r)
   {
      placeLocal.placedPick = r.id;
      draw();
   }, function(r)
   {
      return r.id == placeLocal.placedPick;
   });
   pager(c, "pg", 50, x, ly + 4, Number(P.page), Number(P.pages), Number(P.count), "placement");
   var r = placedRow();
   var rt = rights();
   var mayChange = r != null && (r.mine != false || rt == null || rt.others == true);
   var ay = CB - 74;
   label(c, "picked", 60, x, ay + 4, w, r != null ? cut(r.name, 40) : P.here + " here, " + P.total + " in all (nearest 50 shown)", 18, r != null ? C_TEXT : C_SECOND);
   var by = ay + 36;
   btn(c, "goto", 61, x, by, 90, "Go to", function()
   {
      dboSound("UIMenuOK");
      req("adminPlacementGoto", {id: placeLocal.placedPick});
   }, r == null);
   btn(c, "edit", 62, x + 96, by, 80, "Edit", function()
   {
      var p = placedRow();
      dboSound("UIMenuOK");
      dboSend("admin::placeedit", [dboJson({id: p.id, base: p.base, kind: p.kind, name: p.name, hostile: p.hostile == true, pos: p.pos, rot: p.rot.length ? p.rot : [0, 0, 0]})]);
   }, !mayChange || r == null || str(r.base) == "" || !(r.pos instanceof Array) || !r.pos.length);
   btn(c, "another", 63, x + 182, by, 140, "Place another", function()
   {
      var p = placedRow();
      dboSound("UIMenuOK");
      dboSend("admin::place", [dboJson({desc: p.base, kind: p.kind, name: p.name, hostile: p.kind == "npc" && p.hostile == true && mayHostile()})]);
   }, r == null || str(r.base) == "" || !mayPlace());
   confirmBtn(c, "remove", 64, x + 328, by, 0, "Remove", "placeRemove:" + placeLocal.placedPick, function()
   {
      dboSound("UIMenuOK");
      req("adminPlacementRemove", {id: placeLocal.placedPick});
      placeLocal.placedPick = "";
   }, !mayChange);
   confirmBtn(c, "clearGroup", 65, x + 486, by, 0, "Clear group", "placeGroup:" + placeLocal.placedPick, function()
   {
      dboSound("UIMenuOK");
      req("adminPlaceGroupClear", {id: placeLocal.placedPick});
      placeLocal.placedPick = "";
   }, !mayChange || r == null || str(r.group) == "");
   btn(c, "undo", 66, x + 684, by, 80, "Undo", function()
   {
      dboSound("UIMenuOK");
      req("adminPlaceUndo", {});
   });
   btn(c, "refresh", 67, x + 770, by, 100, "Refresh", function()
   {
      dboSound("UIMenuOK");
      req("adminPlacementsRequest", {});
   });
}

function drawSets(c, x, y, w)
{
   var S = data.place != undefined ? data.place.sets : null;
   if (S == null || S == undefined)
   {
      empty(c, "loading", 20, x, y, w, "Loading the sets");
   }
   else
   {
      if (!S.rows.length)
      {
         empty(c, "none", 21, x, y, w, "No sets yet. Place things, stand among them and save them as a set below.");
      }
      var ly = rowList(c, "r", 30, x, y, w, S.rows, function(r)
      {
         return [[cut(r.name, 40), 0, 420], [plural(r.count, "placement"), 430, 300, C_SECOND]];
      }, function(r)
      {
         placeLocal.setPick = r.name;
         draw();
      }, function(r)
      {
         return r.name == placeLocal.setPick;
      });
      pager(c, "pg", 50, x, ly + 4, Number(S.page), Number(S.pages), Number(S.total), "set");
   }
   var ay = CB - 84;
   label(c, "picked", 60, x, ay + 4, 300, placeLocal.setPick != "" ? cut(placeLocal.setPick, 30) : "Pick a set", 18, placeLocal.setPick != "" ? C_TEXT : C_SECOND);
   btn(c, "putDown", 61, x + 310, ay, 150, "Put down here", function()
   {
      dboSound("UIMenuOK");
      req("adminPlaceSetPlace", {name: placeLocal.setPick});
   }, placeLocal.setPick == "" || !mayPlace());
   confirmBtn(c, "deleteSet", 62, x + 468, ay, 0, "Delete set", "setDelete:" + placeLocal.setPick, function()
   {
      dboSound("UIMenuOK");
      req("adminPlaceSetDelete", {name: placeLocal.setPick});
      placeLocal.setPick = "";
   }, placeLocal.setPick == "");
   var ny = ay + 44;
   field(c, "setName", 70, x, ny + 2, 280, placeLocal.setName, "Name for a new set", 40, function(text)
   {
      placeLocal.setName = text;
   });
   var radii = [];
   for (var i = 0; i < SET_RADII.length; i++)
   {
      radii.push([String(SET_RADII[i]), "within " + SET_RADII[i] + " m"]);
   }
   chips(c, "radius", 71, x + 292, ny, x + 760, radii, String(placeLocal.setRadius), function()
   {
      dboSound("UIMenuPrevNext");
      placeLocal.setRadius = Number(this.key);
      draw();
   });
   btn(c, "saveSet", 80, x + w - 240, ny, 240, "Save placements near me", function()
   {
      dboSound("UIMenuOK");
      req("adminPlaceSetSave", {name: trimText(placeLocal.setName), radius: placeLocal.setRadius});
   }, trimText(placeLocal.setName) == "");
}

function drawWarband(c, x, y, w)
{
   var W = data.place != undefined ? data.place.warband : null;
   var sub = placeLocal.wsub;
   var cy = chips(c, "wsub", 10, x, y, x + w, WB_VIEWS, sub, function()
   {
      dboSound("UIMenuPrevNext");
      placeLocal.wsub = this.key;
      placeLocal.settling = false;
      setUi("page", 0, true);
      draw();
   });
   if (W != null && W != undefined && str(W.last) != "")
   {
      label(c, "last", 15, x, cy, w, cut(W.last, 120), 16, C_GOLD);
      cy += 24;
   }
   if (sub == "raise")
   {
      drawWbRaise(c, x, cy + 2, w, W);
   }
   else if (sub == "band")
   {
      drawWbBand(c, x, cy + 2, w, W);
   }
   else if (sub == "sides")
   {
      drawWbSides(c, x, cy + 2, w, W);
   }
   else
   {
      drawWbRaiders(c, x, cy + 2, w, W);
   }
}

function drawWbRaise(c, x, y, w, W)
{
   if (placeLocal.modPicking)
   {
      drawPlaceModPicker(c, x, y, w);
      return;
   }
   var ry = drawSearchBar(c, x, y, w, "Search NPCs to raise");
   var band = placeLocal.picked != null && placeLocal.picked.kind == "npc" ? placeLocal.picked : null;
   drawResults(c, x, ry, w, true, function(r)
   {
      placeLocal.picked = r;
      warband("info " + r.desc);
   }, function(r)
   {
      return band != null && r.desc == band.desc;
   });
   var ay = CB - 72;
   label(c, "picked", 90, x, ay + 4, 300, band != null ? cut(band.name, 30) : "Pick an NPC above", 18, band != null ? C_TEXT : C_SECOND);
   var max = W != null && W != undefined ? Math.min(Number(W.maxRaise), Number(W.maxBand)) : 25;
   var counts = [];
   for (var i = 0; i < WARBAND_COUNTS.length; i++)
   {
      if (WARBAND_COUNTS[i] <= max)
      {
         counts.push([String(WARBAND_COUNTS[i]), String(WARBAND_COUNTS[i])]);
      }
   }
   chips(c, "count", 91, x + 310, ay + 2, x + w - 240, counts, String(placeLocal.bandCount), function()
   {
      dboSound("UIMenuPrevNext");
      placeLocal.bandCount = Number(this.key);
      draw();
   });
   btn(c, "raise", 105, x + w - 220, ay, 100, "Raise", function()
   {
      var b = placeLocal.picked;
      warband("raise " + b.desc + " " + placeLocal.bandCount);
   }, band == null || !mayPlace());
   btn(c, "refresh", 106, x + w - 112, ay, 112, "Refresh", function()
   {
      dboSound("UIMenuOK");
      req("adminWarbandView", {});
   });
   var info = W != null && W != undefined ? W.info : null;
   if (band != null && info != null && info != undefined && info.desc == band.desc)
   {
      hint(c, "info", 107, x, ay + 40, w, cut(band.name + ": " + warbandInfoLine(info), 120));
   }
}

function warbandInfoLine(i)
{
   if (str(i.error) != "")
   {
      return i.error;
   }
   var parts = [i.kind == "leveled list" ? "leveled list of " + i.entries : str(i.kind), str(i.level) != "" ? "level " + i.level : "", str(i.race), str(i.aggression),
      i.kind == "leveled list" ? "" : i.settles == true ? "can settle as a garrison" : "would not settle", str(i.refused) != "" ? "refused: " + i.refused : ""];
   var out = [];
   for (var k = 0; k < parts.length; k++)
   {
      if (parts[k] != "")
      {
         out.push(parts[k]);
      }
   }
   return out.join(" - ");
}

function drawWbBand(c, x, y, w, W)
{
   if (W == null || W == undefined)
   {
      empty(c, "loading", 20, x, y, w, "Loading your warband");
      return;
   }
   var members = W.members instanceof Array ? W.members : [];
   if (!members.length)
   {
      empty(c, "none", 21, x, y, w, "You lead no warband. Raise one, or a saved band.");
      return;
   }
   var per = 5;
   var page = Math.max(0, Math.min(Math.ceil(members.length / per) - 1, Number(ui.page)));
   var rows = members.slice(page * per, page * per + per);
   var ly = rowList(c, "m", 30, x, y, w, rows, function(m)
   {
      var st = str(m.state) != "" ? (m.state == "fighting" && str(m.target) != "" ? "fighting " + m.target : m.state) : (m.alive == true ? (m.fighting == true ? "fighting" : "") : "dead");
      return [[cut(m.name, 30), 0, 300], [cut(st, 26), 310, 260, C_SECOND], [m.alive == true && m.health != null ? m.health + "%" : "", 580, 80], [meters(m.dist), 670, w - 700, C_SECOND]];
   }, function(m)
   {
      placeLocal.member = m.id;
      draw();
   }, function(m)
   {
      return m.id == placeLocal.member;
   });
   var pages = Math.max(1, Math.ceil(members.length / per));
   pageTurn = function(d)
   {
      var p = Math.max(0, Math.min(pages - 1, page + d));
      if (p != page)
      {
         dboSound("UIMenuPrevNext");
         setUi("page", p, true);
      }
   };
   var counts = [];
   for (var i = 0; i < W.counts.length; i++)
   {
      counts.push(W.counts[i].count + " " + W.counts[i].name);
   }
   hint(c, "status", 50, x, ly + 4, w - 130, cut(counts.join(", ") + " - " + members.length + "/" + W.maxBand + " - " + (W.stance == "charging" ? "charging" : W.stance == "stay" ? "holding" : "following") + (pages > 1 ? " - page " + (page + 1) + " of " + pages : ""), 110));
   btn(c, "dismissOne", 51, x + w - 120, ly, 120, "Dismiss", function()
   {
      warband("dismiss " + placeLocal.member);
      placeLocal.member = "";
   }, placeLocal.member == "");
   var by = ly + 40;
   btn(c, "follow", 52, x, by, 90, "Follow", function()
   {
      warband("follow");
   }, W.stance == "follow");
   btn(c, "hold", 53, x + 96, by, 80, "Hold", function()
   {
      warband("stay");
   }, W.stance == "stay");
   btn(c, "attackTarget", 54, x + 182, by, 0, W.target != null ? cut("Attack " + W.target.name, 24) : "Attack my target", function()
   {
      warband("attacktarget");
   }, W.target == null);
   btn(c, "attackNearest", 55, x + 450, by, 0, "Attack nearest foe", function()
   {
      warband("attacknearest");
   }, !(W.foes instanceof Array) || !W.foes.length);
   btn(c, "unleash", 56, x + 660, by, 0, "Unleash (raid)", function()
   {
      warband("unleash");
   }, !mayHostile());
   var sy = by + 40;
   if (placeLocal.settling)
   {
      label(c, "plan", 60, x, sy, w, cut(W.plan.calm + " will stay as a garrison." + (str(W.plan.kept) != "" ? " Aggressive by nature, not settled: " + W.plan.kept + "." : "") + (str(W.plan.unread) != "" ? " Cannot be checked, not settled: " + W.plan.unread + "." : ""), 120), 16, C_TEXT);
      var px = x;
      btn(c, "settleCalm", 61, px, sy + 26, 0, "Settle the calm ones", function()
      {
         warband("settle calm");
      }, !W.plan.calm);
      px += textW("Settle the calm ones", 18) + 6;
      if (str(W.plan.kept) != "" || str(W.plan.unread) != "")
      {
         btn(c, "settleUnleash", 62, px, sy + 26, 0, "...and unleash the rest", function()
         {
            warband("settle unleashrest");
         }, !mayHostile());
         px += textW("...and unleash the rest", 18) + 6;
         btn(c, "settleDismiss", 63, px, sy + 26, 0, "...and dismiss the rest", function()
         {
            warband("settle dismissrest");
         });
         px += textW("...and dismiss the rest", 18) + 6;
      }
      btn(c, "settleCancel", 64, px, sy + 26, 90, "Cancel", function()
      {
         dboSound("UIMenuCancel");
         placeLocal.settling = false;
         draw();
      });
   }
   else
   {
      btn(c, "settle", 60, x, sy, 0, "Settle (garrison)", function()
      {
         dboSound("UIMenuOK");
         placeLocal.settling = true;
         draw();
      });
      confirmBtn(c, "dismissAll", 61, x + 190, sy, 0, "Dismiss all", "wbDismissAll", function()
      {
         warband("dismiss");
      });
   }
   // what the band may be set on: the foes near, the players and the other GMs' NPCs
   var ty = sy + 66;
   label(c, "targetsHead", 70, x, ty, w, "Targets near you" + ((W.players.length || W.npcs.length || (W.foes instanceof Array && W.foes.length)) ? "" : ": none") + (W.target != null ? "" : " (strike something and it becomes your target)"), 16, C_SECOND);
   var tx = x;
   var tyy = ty + 24;
   var targets = [];
   var foes = W.foes instanceof Array ? W.foes : [];
   for (var a = 0; a < foes.length; a++)
   {
      targets.push(["Foe: " + foes[a].name + " " + meters(foes[a].dist), "attacknpc " + foes[a].id]);
   }
   for (var b = 0; b < W.players.length; b++)
   {
      targets.push([W.players[b].name + " " + meters(W.players[b].dist), "attack " + W.players[b].name]);
   }
   for (var n = 0; n < W.npcs.length; n++)
   {
      targets.push([(W.npcs[n].foe == true ? "Enemy: " : "") + W.npcs[n].name + " (" + W.npcs[n].gm + ") " + meters(W.npcs[n].dist), "attacknpc " + W.npcs[n].id]);
   }
   for (var t = 0; t < targets.length && t < 6; t++)
   {
      var tw = Math.min(w, textW(cut(targets[t][0], 34), 18));
      if (tx + tw > x + w)
      {
         tx = x;
         tyy += 36;
      }
      var tb = btn(c, "target" + t, 80 + t, tx, tyy, tw, cut(targets[t][0], 34), function()
      {
         warband(this.order);
      });
      tb.order = targets[t][1];
      tx += tw + 6;
   }
}

function drawWbSides(c, x, y, w, W)
{
   section(c, "sideHead", 20, x, y, 300, "Side, for a staged battle");
   field(c, "side", 21, x, y + 30, 260, placeLocal.side, W != null && W != undefined && str(W.side) != "" ? "Side: " + W.side : "Side (for a staged battle)", 24, function(text)
   {
      placeLocal.side = text;
   });
   btn(c, "setSide", 22, x + 276, y + 28, 110, "Set side", function()
   {
      warband("side " + trimText(placeLocal.side));
      placeLocal.side = "";
   }, trimText(placeLocal.side) == "");
   btn(c, "noSide", 23, x + 392, y + 28, 100, "No side", function()
   {
      warband("side none");
   }, W == null || W == undefined || str(W.side) == "");
   btn(c, "charge", 24, x + 498, y + 28, 110, W != null && W != undefined && W.stance == "charging" ? "Charging" : "Charge", function()
   {
      warband("charge");
   }, W == null || W == undefined || str(W.side) == "" || !W.members.length);
   hint(c, "enemies", 25, x, y + 70, w, W != null && W != undefined && str(W.side) != "" ? (W.enemies.length ? "Enemies: " + W.enemies.join(", ") : "No GM on another side yet") : "No side: every GM's band is a friend");
   var py = y + 110;
   dboDivider(c, x, py, w);
   section(c, "presetHead", 30, x, py + 10, 300, "Saved bands");
   var presets = W != null && W != undefined ? W.presets : [];
   if (!presets.length)
   {
      hint(c, "noPresets", 31, x + 200, py + 14, 200, "none yet");
   }
   for (var i = 0; i < presets.length && i < 5; i++)
   {
      var ry = py + 44 + i * 40;
      label(c, "pn" + i, 40 + i * 3, x, ry + 2, 300, cut(presets[i].name + " (" + presets[i].count + ")", 30), 18, C_TEXT);
      var rb = btn(c, "praise" + i, 41 + i * 3, x + 320, ry, 100, "Raise", function()
      {
         warband("preset raise " + this.preset);
      }, !mayPlace());
      rb.preset = presets[i].name;
      var db = confirmBtn(c, "pdelete" + i, 42 + i * 3, x + 426, ry, 0, "Delete", "preset:" + presets[i].name, function()
      {
         warband("preset delete " + this.preset);
      });
      db.preset = presets[i].name;
   }
   if (presets.length > 5)
   {
      hint(c, "morePresets", 58, x + 640, py + 14, 300, (presets.length - 5) + " more saved, not shown");
   }
   var sy = py + 44 + 5 * 40;
   field(c, "preset", 60, x, sy + 2, 280, placeLocal.preset, "Save this band as...", 32, function(text)
   {
      placeLocal.preset = text;
   });
   btn(c, "savePreset", 61, x + 296, sy, 90, "Save", function()
   {
      warband("preset save " + trimText(placeLocal.preset));
      placeLocal.preset = "";
   }, trimText(placeLocal.preset) == "" || W == null || W == undefined || !W.members.length);
   var settle = W != null && W != undefined && W.onLogout == "settle";
   hint(c, "logout", 62, x, sy + 46, 520, "When you log out, your followers " + (settle ? "settle where they stand (the calm ones)." : "are dismissed."));
   btn(c, "onLogout", 63, x + 530, sy + 42, 0, settle ? "Dismiss them instead" : "Settle the calm ones instead", function()
   {
      warband("onlogout " + (data.place.warband.onLogout == "settle" ? "dismiss" : "settle"));
   }, W == null || W == undefined);
}

function drawWbRaiders(c, x, y, w, W)
{
   var placed = W != null && W != undefined ? W.placed : [];
   if (!placed.length)
   {
      empty(c, "none", 20, x, y, w, "No raiders or garrison of yours stand.");
   }
   var per = 7;
   var pages = Math.max(1, Math.ceil(placed.length / per));
   var page = Math.max(0, Math.min(pages - 1, Number(ui.page)));
   var ly = rowList(c, "p", 30, x, y, w, placed.slice(page * per, page * per + per), function(r)
   {
      return [[cut(r.name + (r.alive == true ? "" : " (dead)"), 34), 0, 380], [(r.hostile == true ? "raider" : "garrison") + " - " + meters(r.dist), 390, w - 420, C_SECOND]];
   }, function(r)
   {
      placeLocal.raider = r.id;
      draw();
   }, function(r)
   {
      return r.id == placeLocal.raider;
   });
   pageTurn = function(d)
   {
      var p = Math.max(0, Math.min(pages - 1, page + d));
      if (p != page)
      {
         dboSound("UIMenuPrevNext");
         setUi("page", p, true);
      }
   };
   var ay = CB - 36;
   btn(c, "removeOne", 50, x, ay, 110, "Remove", function()
   {
      dboSound("UIMenuOK");
      req("adminRaid", {text: "clear " + placeLocal.raider});
      placeLocal.raider = "";
   }, placeLocal.raider == "");
   var anyRaider = false;
   var anyGarrison = false;
   for (var i = 0; i < placed.length; i++)
   {
      if (placed[i].hostile == true)
      {
         anyRaider = true;
      }
      else
      {
         anyGarrison = true;
      }
   }
   confirmBtn(c, "clearRaiders", 51, x + 120, ay, 0, "Clear raiders", "clearRaiders", function()
   {
      dboSound("UIMenuOK");
      req("adminRaid", {text: "clear raiders"});
   }, !anyRaider);
   confirmBtn(c, "clearGarrison", 52, x + 340, ay, 0, "Clear garrison", "clearGarrison", function()
   {
      dboSound("UIMenuOK");
      req("adminRaid", {text: "clear garrison"});
   }, !anyGarrison);
   hint(c, "clearHint", 53, x + 580, ay + 4, w - 580, "Clear removes every one of yours, and their dead");
}

TABS.place = {
   escape: function()
   {
      var was = placeLocal.modPicking || placeLocal.settling;
      placeLocal.modPicking = false;
      placeLocal.settling = false;
      return was;
   },
   open: function()
   {
      req("adminPlaceMeta", {});
      placeLocal.modPicking = false;
      if (str(ui.sub) == "placed")
      {
         req("adminPlacementsRequest", {});
      }
   },
   leave: function()
   {
      placeLocal.modPicking = false;
      placeLocal.settling = false;
   },
   draw: function(c, x, y, w, h)
   {
      var sub = str(ui.sub);
      if (sub != "placed" && sub != "sets" && sub != "warband")
      {
         sub = "catalog";
      }
      // the first category opens once the categories are known, as the browser's
      var m = placeMeta();
      if (m != null && m.categories.length && str(ui.cat) == "" && trimText(ui.q) == "" && (sub == "catalog" || sub == "warband"))
      {
         ui.cat = m.categories[0].id;
         placeSearch(0);
         sendUi();
      }
      var cy = chips(c, "view", 1, x, y, x + w, PLACE_VIEWS, sub, function()
      {
         dboSound("UIMenuPrevNext");
         placeLocal.modPicking = false;
         ui.sub = this.key;
         ui.page = 0;
         if (this.key == "placed")
         {
            req("adminPlacementsRequest", {});
         }
         else if (this.key == "sets")
         {
            req("adminPlaceSets", {});
         }
         else if (this.key == "warband")
         {
            req("adminWarbandView", {});
         }
         sendUi();
      });
      if (sub == "placed")
      {
         drawPlaced(c, x, cy + 4, w);
      }
      else if (sub == "sets")
      {
         drawSets(c, x, cy + 4, w);
      }
      else if (sub == "warband")
      {
         drawWarband(c, x, cy + 4, w);
      }
      else
      {
         drawCatalog(c, x, cy + 4, w);
      }
   }
};
