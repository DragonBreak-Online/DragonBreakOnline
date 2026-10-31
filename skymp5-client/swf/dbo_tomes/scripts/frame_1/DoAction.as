// The spell tome shop as a native panel (server spells.js, widget of type tomeShop: the same object skymp5-front
// features/tomeShop gets). The purse and this week's purchase, the buyer's spell skills, then the shelf by rank with a
// school and a rank to narrow it and a typed search. Buy asks once more ("your one tome this week") and goes out as
// dbo:tomeBuy with the shop's nonce and the tome; the server answers by sending the shop again. Close sends dbo:tomeClose.

var DBO_SWF_VERSION = "tomes-1";
var PANEL_W = 1100;
var PANEL_H = 640;
var PAD = 28;
BODY_W = PANEL_W - PAD * 2;
var NO_DATA_CLOSE_MS = 8000;
var BUSY_TIMEOUT_MS = 10000;
var TIER_COUNT = 5;
var ROW_H = 46;
var SCHOOL_ORDER = ["Alteration", "Conjuration", "Destruction", "Illusion", "Restoration"];
var C_RED = 0xB23A3A;
var C_GREEN = 0x7FBF7F;

var panel;
var data = null;
var page = 0;
var school = "";
var rank = -1;
var search = "";
// confirmId: the tome whose Buy waits for a second press; busyId: the tome being bought
var confirmId = "";
var busyId = "";
var busyAt = 0;
var typing = false;
var boxField = null;
var shownWait = "";
var builtAt = getTimer();
var bodyTop = 0;

function gold(n)
{
   var s = String(Math.floor(Math.abs(Number(n) || 0)));
   var out = "";
   while (s.length > 3)
   {
      out = "," + s.substr(s.length - 3) + out;
      s = s.substr(0, s.length - 3);
   }
   return (Number(n) < 0 ? "-" : "") + s + out;
}

function nowMs()
{
   return new Date().getTime();
}

// "3d 4h", "4h 12m" or "12m 30s", as the browser's
function untilText(ms)
{
   var s = Math.max(0, Math.ceil(ms / 1000));
   var d = Math.floor(s / 86400);
   var h = Math.floor((s % 86400) / 3600);
   var m = Math.floor((s % 3600) / 60);
   if (d > 0)
   {
      return d + "d " + h + "h";
   }
   if (h > 0)
   {
      return h + "h " + m + "m";
   }
   return m + "m " + (s % 60) + "s";
}

function tomes()
{
   return listOf(data.tomes);
}

function busy()
{
   return busyId != "" && getTimer() - busyAt < BUSY_TIMEOUT_MS;
}

function purchasable(t)
{
   return data.canBuy == true && (t.blocked == undefined || t.blocked == "") && t.canAfford == true;
}

function buyable(t)
{
   return purchasable(t) && !busy();
}

function tomeById(id)
{
   var list = tomes();
   for (var i = 0; i < list.length; i++)
   {
      if (String(list[i].id) == id)
      {
         return list[i];
      }
   }
   return null;
}

function closeMenu()
{
   endTyping();
   dboSound("UIMenuCancel");
   dboSend("dbo:tomeClose", [data != null ? data.nonce : ""]);
   dboClose();
}

function buy(t)
{
   confirmId = "";
   busyId = String(t.id);
   busyAt = getTimer();
   dboSound("UIMenuOK");
   dboSend("dbo:tomeBuy", [data.nonce, String(t.id)]);
   draw();
}

// ---- the weekly line ----

function weekly()
{
   if (data.canBuy == true)
   {
      return ["One tome this week: available", C_GREEN];
   }
   if (Number(data.nextPurchaseAt) > 0)
   {
      var left = Number(data.nextPurchaseAt) - nowMs();
      return [left > 0 ? "Next purchase in " + untilText(left) : "Your next tome is due. Reopen the shop to buy it.", C_TEXT];
   }
   return [data.whyNot != undefined && data.whyNot != "" ? String(data.whyNot) : "The Synod is not selling to you right now.", C_RED];
}

// ---- schools, ranks, search ----

function schoolOrder(s)
{
   for (var i = 0; i < SCHOOL_ORDER.length; i++)
   {
      if (SCHOOL_ORDER[i] == s)
      {
         return i;
      }
   }
   return SCHOOL_ORDER.length;
}

function schools()
{
   var out = [];
   var list = tomes();
   for (var i = 0; i < list.length; i++)
   {
      var s = String(list[i].school);
      var seen = false;
      for (var j = 0; j < out.length; j++)
      {
         if (out[j] == s)
         {
            seen = true;
         }
      }
      if (s != "" && s != "undefined" && !seen)
      {
         out.push(s);
      }
   }
   out.sort(function(a, b) { return schoolOrder(a) - schoolOrder(b) || (a < b ? -1 : a > b ? 1 : 0); });
   return out;
}

function activeSchool()
{
   var list = schools();
   for (var i = 0; i < list.length; i++)
   {
      if (list[i] == school)
      {
         return school;
      }
   }
   return "";
}

function inSchool()
{
   var s = activeSchool();
   var out = [];
   var list = tomes();
   for (var i = 0; i < list.length; i++)
   {
      if (s == "" || list[i].school == s)
      {
         out.push(list[i]);
      }
   }
   return out;
}

// The ranks on the shelf for the school shown, lowest first: [{rank, name}]
function ranks()
{
   var out = [];
   var list = inSchool();
   for (var i = 0; i < list.length; i++)
   {
      var seen = false;
      for (var j = 0; j < out.length; j++)
      {
         if (out[j].rank == Number(list[i].rank))
         {
            seen = true;
         }
      }
      if (!seen)
      {
         out.push({rank: Number(list[i].rank), name: String(list[i].rankName)});
      }
   }
   out.sort(function(a, b) { return a.rank - b.rank; });
   return out;
}

function activeRank()
{
   var list = ranks();
   for (var i = 0; i < list.length; i++)
   {
      if (list[i].rank == rank)
      {
         return rank;
      }
   }
   return -1;
}

function shown()
{
   var r = activeRank();
   var f = search.toLowerCase();
   var out = [];
   var list = inSchool();
   for (var i = 0; i < list.length; i++)
   {
      var t = list[i];
      if ((r < 0 || Number(t.rank) == r) && (f == "" || (t.spell + " " + t.name + " " + t.school).toLowerCase().indexOf(f) >= 0))
      {
         out.push(t);
      }
   }
   return out;
}

function countIn(s)
{
   var n = 0;
   var list = tomes();
   for (var i = 0; i < list.length; i++)
   {
      if (list[i].school == s)
      {
         n++;
      }
   }
   return n;
}

// ---- typing the search ----

function takeTyped()
{
   var text = boxField != null ? String(boxField.text) : "";
   while (text.charAt(0) == " ")
   {
      text = text.substr(1);
   }
   while (text.charAt(text.length - 1) == " ")
   {
      text = text.substr(0, text.length - 1);
   }
   search = text;
   page = 0;
   endTyping();
   dboSound("UIMenuOK");
   draw();
}

function endTyping()
{
   if (typing)
   {
      dboInputEnd();
   }
   typing = false;
   boxField = null;
}

// ---- drawing ----

function drawHead()
{
   var h = clear("head", 20);
   dboTitle(h, "title", 1, PAD, 16, PANEL_W - PAD * 2, data.title != undefined && data.title != "" ? String(data.title) : "Spell Tomes");
   var p = dboText(h, "purse", 2, PAD, 58, 300, 26, dboFmt(F_BOLD, 18, C_TEXT, 0.8), false);
   p.text = gold(data.gold) + " gold";
   var wk = weekly();
   var w = dboText(h, "weekly", 3, PAD + 300, 58, PANEL_W - PAD * 2 - 300, 26, dboFmt(F_MEDIUM, 17, wk[1], 0.8, "right"), false);
   w.text = wk[0];
   shownWait = wk[0];
   var y = 88;
   if (data.canBuy != true && Number(data.nextPurchaseAt) > 0 && data.whyNot != undefined && data.whyNot != "")
   {
      var why = dboText(h, "why", 4, PAD, y, PANEL_W - PAD * 2, 24, dboFmt(F_MEDIUM, 15, C_SECOND, 0.8), false);
      why.text = String(data.whyNot);
      y += 24;
   }
   var skills = listOf(data.skills);
   for (var i = 0; i < skills.length; i++)
   {
      var s = skills[i];
      // the browser's pips as words: the game's fonts carry no circle glyphs we can rely on
      var pips = Math.min(TIER_COUNT, Number(s.tier) + 1) + " of " + TIER_COUNT;
      var line = dboText(h, "skill" + i, 10 + i, PAD, y, PANEL_W - PAD * 2, 24, dboFmt(F_MEDIUM, 15, C_SECOND, 0.8), false);
      line.text = s.label + ": " + s.tierName + " (" + pips + ")" + (listOf(s.schools).length ? "   " + listOf(s.schools).join(" · ") : "");
      y += 24;
   }
   dboDivider(h, PAD, y + 6, PANEL_W - PAD * 2);
   return y + 16;
}

function drawConfirm(a, y, t)
{
   var q = dboText(a, "question", 1, PAD, y + 2, PANEL_W - PAD * 2 - 260, 28, dboFmt(F_MEDIUM, 18, C_TEXT, 0.8), false);
   q.text = t.name + " (" + t.spell + ", " + t.rankName + "): buy for " + gold(t.price) + " gold? This is your one tome this week.";
   button(a, "yes", 10, PANEL_W - PAD - 250, y, 120, "Buy", F_MEDIUM, 18, A_BUTTON_REST, function()
   {
      var c = tomeById(confirmId);
      if (c != null && buyable(c))
      {
         buy(c);
      }
   });
   button(a, "back", 11, PANEL_W - PAD - 120, y, 120, "Back", F_MEDIUM, 18, A_BUTTON_REST, function()
   {
      confirmId = "";
      dboSound("UIMenuCancel");
      draw();
   });
}

function drawTools(y)
{
   var a = clear("tools", 40);
   var c = confirmId != "" ? tomeById(confirmId) : null;
   if (c != null && buyable(c))
   {
      drawConfirm(a, y, c);
      return;
   }
   if (!tomes().length)
   {
      return;
   }
   var all = [""].concat(schools());
   var s = activeSchool();
   button(a, "school", 10, PAD, y, 250, "School: " + (s == "" ? "All" : s) + " (" + (s == "" ? tomes().length : countIn(s)) + ")", F_MEDIUM, 17, A_ROW_REST, function()
   {
      var list = [""].concat(schools());
      var now = activeSchool();
      for (var i = 0; i < list.length; i++)
      {
         if (list[i] == now)
         {
            school = list[(i + 1) % list.length];
            break;
         }
      }
      page = 0;
      dboSound("UIMenuFocus");
      draw();
   });
   var r = activeRank();
   var rs = ranks();
   var rname = "Every rank";
   for (var j = 0; j < rs.length; j++)
   {
      if (rs[j].rank == r)
      {
         rname = rs[j].name;
      }
   }
   button(a, "rank", 11, PAD + 258, y, 220, "Rank: " + rname, F_MEDIUM, 17, A_ROW_REST, function()
   {
      var list = ranks();
      var now = activeRank();
      var next = -1;
      if (now < 0 && list.length)
      {
         next = list[0].rank;
      }
      for (var i = 0; i < list.length; i++)
      {
         if (list[i].rank == now)
         {
            next = i + 1 < list.length ? list[i + 1].rank : -1;
         }
      }
      rank = next;
      page = 0;
      dboSound("UIMenuFocus");
      draw();
   });
   var x = PAD + 486;
   if (typing)
   {
      boxField = dboInput(a, "box", 2, x, y - 2, 300, 32, dboFmt(F_PLAIN, 18, C_TEXT, 0.5), 40, false);
      boxField.text = search;
      button(a, "done", 12, x + 308, y, 90, "Done", F_MEDIUM, 17, A_BUTTON_REST, function()
      {
         takeTyped();
      });
      return;
   }
   if (dboCanType())
   {
      button(a, "search", 12, x, y, 140, "Search...", F_MEDIUM, 17, A_ROW_REST, function()
      {
         typing = true;
         dboSound("UIMenuOK");
         draw();
      });
      x += 148;
   }
   if (search != "")
   {
      var f = dboText(a, "filter", 3, x, y + 2, 220, 28, dboFmt(F_MEDIUM, 17, C_SECOND, 0.8), false);
      f.text = "\"" + search + "\"";
      button(a, "clear", 13, x + 228, y, 90, "Clear", F_MEDIUM, 17, A_ROW_REST, function()
      {
         search = "";
         page = 0;
         dboSound("UIMenuCancel");
         draw();
      });
   }
}

function tomeRow(t)
{
   var at = flowNeed(ROW_H);
   var c = at.clip.createEmptyMovieClip(at.name, fd());
   c._y = at.y;
   var n = dboText(c, "label", 1, 0, 2, 420, 26, dboFmt(F_MEDIUM, 18, C_TEXT, 0.5), false);
   n.text = String(t.spell);
   var nm = dboText(c, "name", 2, 0, 24, 420, 22, dboFmt(F_MEDIUM, 14, C_SECOND, 0.5), false);
   nm.text = String(t.name);
   var blocked = t.blocked != undefined && t.blocked != "";
   var s = dboText(c, "sub", 3, 430, 8, BODY_W - 430 - 270, 26, dboFmt(F_MEDIUM, 15, blocked ? C_RED : C_SECOND, 0.5), false);
   s.text = t.school + "  ·  " + t.rankName + (blocked ? "  ·  " + t.blocked : "");
   var p = dboText(c, "price", 4, BODY_W - 262, 8, 120, 26, dboFmt(F_BOLD, 17, t.canAfford == true ? C_TEXT : C_RED, 0.5, "right"), false);
   p.text = gold(t.price) + " gold";
   var b = button(c, "btn0", 10, BODY_W - 128, 6, 124, busyId == String(t.id) && busy() ? "Buying..." : "Buy", F_MEDIUM, 17, A_BUTTON_REST, function()
   {
      confirmId = String(this.tome.id);
      dboSound("UIMenuOK");
      draw();
   });
   b.tome = t;
   if (!buyable(t))
   {
      disable(b);
   }
}

function drawList()
{
   var list = tomes();
   if (!list.length)
   {
      flowHint((data.seller != undefined && data.seller != "" ? data.seller : "The Synod") + " has no tomes on its shelves for you.");
      return;
   }
   var s = shown();
   var rs = ranks();
   var any = false;
   for (var i = 0; i < rs.length; i++)
   {
      var group = [];
      for (var j = 0; j < s.length; j++)
      {
         if (Number(s[j].rank) == rs[i].rank)
         {
            group.push(s[j]);
         }
      }
      if (!group.length)
      {
         continue;
      }
      any = true;
      flowHeading(rs[i].name + "  (" + group.length + ")");
      for (var k = 0; k < group.length; k++)
      {
         tomeRow(group[k]);
      }
   }
   if (!any)
   {
      flowHint("No tomes match.");
   }
}

function drawFoot(pages)
{
   var f = clear("foot", 60);
   var r = dboText(f, "result", 1, PAD, PANEL_H - 112, PANEL_W - PAD * 2, 44, dboFmt(F_MEDIUM, 17, data.resultKind == "refused" ? C_RED : data.resultKind == "ok" ? C_GREEN : C_SECOND, 0.5), true);
   r.text = data.result != undefined ? String(data.result) : "";
   dboDivider(f, PAD, PANEL_H - 62, PANEL_W - PAD * 2);
   var n = shown().length;
   var all = tomes().length;
   var hint = dboText(f, "hint", 2, PAD, PANEL_H - 46, 600, 24, dboFmt(F_MEDIUM, 15, C_SECOND, 0.5), false);
   hint.text = (n == all ? all + " tomes" : "Showing " + n + " of " + all + " tomes") + (pages > 1 ? "   ·   Page " + (page + 1) + " of " + pages + " (Left / Right)" : "");
   button(f, "close", 10, PANEL_W - PAD - 100, PANEL_H - 48, 100, "Close", F_MEDIUM, 20, A_BUTTON_REST, function()
   {
      closeMenu();
   });
}

// Where a control sits, so the focus can find it again after a redraw
function placeOf(c)
{
   return c._parent._name + "/" + c._name;
}

function draw()
{
   var was = focus >= 0 && focus < actions.length ? placeOf(actions[focus]) : "";
   var typed = typing && boxField != null ? String(boxField.text) : null;
   boxField = null;
   actions = [];
   focus = -1;
   var y = drawHead();
   drawTools(y);
   if (typed != null && boxField != null)
   {
      boxField.text = typed;
   }
   bodyTop = y + 44;
   BODY_H = PANEL_H - 118 - bodyTop;
   flowStart(panel, 50, PAD, bodyTop);
   drawList();
   var pages = flowShow(page);
   if (page >= pages)
   {
      page = pages - 1;
      flowShow(page);
   }
   drawFoot(pages);
   if (panel.tools.yes != undefined)
   {
      setFocus(panel.tools.yes.idx);
      return;
   }
   for (var i = 0; was != "" && i < actions.length; i++)
   {
      if (placeOf(actions[i]) == was)
      {
         setFocus(i);
         break;
      }
   }
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   dboFit(panel, PANEL_W, PANEL_H);
   var bg = panel.createEmptyMovieClip("bg", 1);
   dboGround(bg, PANEL_W, PANEL_H);
   dboWatermark(panel, 5, PANEL_W - 50, 150, 280);
   dboFadeIn(panel);
}

_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || p.nonce == undefined || p.tomes == undefined)
   {
      dboLog("tomes: unreadable payload");
      return;
   }
   data = p;
   // a re-sent shop ends the purchase in flight and drops a confirm that no longer applies, as the browser's does
   busyId = "";
   if (confirmId != "")
   {
      var c = tomeById(confirmId);
      if (c == null || !purchasable(c))
      {
         confirmId = "";
      }
   }
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = dboKey();
   if (typing)
   {
      if (code == 27)
      {
         dboSound("UIMenuCancel");
         endTyping();
         draw();
      }
      else if (code == 13)
      {
         takeTyped();
      }
      // every other key is typing while the box is open
      return;
   }
   if (code == 27)
   {
      if (confirmId != "")
      {
         confirmId = "";
         dboSound("UIMenuCancel");
         draw();
         return;
      }
      closeMenu();
      return;
   }
   if (data == null)
   {
      return;
   }
   if (code == 38 && actions.length)
   {
      setFocus(focus <= 0 ? actions.length - 1 : focus - 1);
   }
   else if (code == 40 && actions.length)
   {
      setFocus(focus < 0 || focus >= actions.length - 1 ? 0 : focus + 1);
   }
   else if (code == 13 && focus >= 0 && actions[focus].disabled != true)
   {
      actions[focus].onPick();
   }
   else if ((code == 37 || code == 33) && page > 0)
   {
      dboSound("UIMenuPrevNext");
      page--;
      draw();
   }
   else if ((code == 39 || code == 34) && flow != null && page + 1 < flow.pages.length)
   {
      dboSound("UIMenuPrevNext");
      page++;
      draw();
   }
};
Key.addListener(keys);

_root.onEnterFrame = function()
{
   if (data == null)
   {
      if (getTimer() - builtAt >= NO_DATA_CLOSE_MS)
      {
         dboLog("tomes: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
         delete _root.onEnterFrame;
         dboClose();
      }
      return;
   }
   // a purchase that never came back frees the Buy buttons; the wait counts down on its own (the head alone)
   if (busyId != "" && !busy())
   {
      busyId = "";
      draw();
   }
   else if (weekly()[0] != shownWait)
   {
      drawHead();
   }
};

_root.dboReady = false;
_root.dboVersion = DBO_SWF_VERSION;
build();
_root.dboReady = true;
dboBoot(function(frame)
{
   dboLog("panel built, version " + DBO_SWF_VERSION + ", skse appeared on frame " + frame);
   dboSend("ready", [frame], frame);
});
