// The spellbook as a native panel (server spells.js, spellbook widget: the same object skymp5-front features/spellbook gets),
// opened by /spells. Every spell studied or taught is in the book; up to max of them are prepared, on the character.
// Preparing and putting away happen only at a magic college (atCollege); elsewhere the book opens to read, with the hint.
// Keys are the widget's own events: prepare and unprepare [nonce, spell], close (no arguments), as the browser's.

var DBO_SWF_VERSION = "spellbook-1";
var PANEL_W = 1000;
var PANEL_H = 640;
var PAD = 28;
BODY_W = PANEL_W - PAD * 2;
var NO_DATA_CLOSE_MS = 8000;
var BUSY_TIMEOUT_MS = 8000;
var SCHOOL_ORDER = ["Alteration", "Conjuration", "Destruction", "Illusion", "Restoration"];
var C_RED = 0xB23A3A;
var C_GREEN = 0x7FBF7F;

var panel;
var data = null;
var page = 0;
// busyId: the spell whose change is on its way; the server's answer (a new book) ends it
var busyId = "";
var busyAt = 0;
var builtAt = getTimer();

function ev(name)
{
   var fallback = {prepare: "dbo:spellbookPrepare", unprepare: "dbo:spellbookUnprepare", close: "dbo:spellbookClose"};
   return data != null && data.events != undefined && data.events[name] != undefined ? String(data.events[name]) : fallback[name];
}

function busy()
{
   return busyId != "" && getTimer() - busyAt < BUSY_TIMEOUT_MS;
}

function change(name, s)
{
   if (busy())
   {
      return;
   }
   busyId = String(s.id);
   busyAt = getTimer();
   dboSound("UIMenuOK");
   dboSend(ev(name), [String(data.nonce), String(s.id)]);
   draw();
}

function closeMenu()
{
   dboSound("UIMenuCancel");
   dboSend(ev("close"), []);
   dboClose();
}

function maxOf()
{
   return Number(data.max) || 3;
}

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

function byRankName(a, b)
{
   if (Number(a.rank) != Number(b.rank))
   {
      return Number(a.rank) - Number(b.rank);
   }
   var x = String(a.name).toLowerCase();
   var y = String(b.name).toLowerCase();
   return x < y ? -1 : x > y ? 1 : 0;
}

function schools(known)
{
   var out = [];
   var seen = {};
   for (var i = 0; i < known.length; i++)
   {
      var s = String(known[i].school);
      if (seen[s] != true)
      {
         seen[s] = true;
         out.push(s);
      }
   }
   out.sort(function(a, b) { return schoolOrder(a) - schoolOrder(b) || (a < b ? -1 : a > b ? 1 : 0); });
   return out;
}

// ---- drawing ----

function drawPrepared()
{
   var prepared = listOf(data.prepared);
   var max = maxOf();
   flowHeading("Prepared " + prepared.length + " of " + max);
   for (var i = 0; i < max; i++)
   {
      var s = prepared[i];
      if (s == undefined)
      {
         flowHint("    An empty place");
         continue;
      }
      var e = flowEntry(String(s.name), [[busyId == String(s.id) && busy() ? "..." : "Put away", function() { change("unprepare", this._parent.spell); }, undefined, data.atCollege != true || busy()]], s.school + "  ·  " + s.rankName);
      e.spell = s;
   }
   if (data.atCollege != true && data.hint != undefined && data.hint != "")
   {
      flowText(String(data.hint), 16, C_SECOND);
   }
}

function drawKnown()
{
   var known = listOf(data.known);
   if (!known.length)
   {
      flowHint("Your spellbook is empty. Study a spell tome at a spell study point to fill it.");
      return;
   }
   var full = listOf(data.prepared).length >= maxOf();
   var ss = schools(known);
   for (var i = 0; i < ss.length; i++)
   {
      var list = [];
      for (var k = 0; k < known.length; k++)
      {
         if (String(known[k].school) == ss[i])
         {
            list.push(known[k]);
         }
      }
      list.sort(byRankName);
      flowHeading(ss[i] + "  (" + list.length + ")");
      for (var j = 0; j < list.length; j++)
      {
         var s = list[j];
         var why = s.prepared == true ? "" : data.atCollege != true ? "only at a college" : full ? "put a prepared spell away first" : "";
         var sub = s.rankName + "  ·  " + (s.prepared == true ? "Prepared" : "In the book") + (why != "" ? "  ·  " + why : "");
         var e = flowEntry(String(s.name), s.prepared == true ? [] : [[busyId == String(s.id) && busy() ? "..." : "Prepare", function() { change("prepare", this._parent.spell); }, undefined, why != "" || busy()]], sub);
         e.spell = s;
      }
   }
}

function drawFoot(pages)
{
   var f = clear("foot", 60);
   var r = dboText(f, "result", 1, PAD, PANEL_H - 112, PANEL_W - PAD * 2, 44, dboFmt(F_MEDIUM, 17, data.resultKind == "refused" ? C_RED : data.resultKind == "ok" ? C_GREEN : C_SECOND, 0.5), true);
   r.text = data.result != undefined ? String(data.result) : "";
   dboDivider(f, PAD, PANEL_H - 62, PANEL_W - PAD * 2);
   var known = listOf(data.known).length;
   var paged = pages > 1;
   var h = dboText(f, "hint", 2, PAD, PANEL_H - (paged ? 54 : 46), PANEL_W - PAD * 2 - 140 - (paged ? 176 : 0), paged ? 44 : 24, dboFmt(F_MEDIUM, 15, C_SECOND, 0.5), paged);
   flowPager(f, 20, PANEL_W - PAD - 100 - 176, PANEL_H - 48, pages);
   h.text = known + " " + (known == 1 ? "spell" : "spells") + " in your book. Spells you knew before study are always yours and take no place."
      + (pages > 1 ? "   ·   Page " + (page + 1) + " of " + pages : "");
   button(f, "close", 10, PANEL_W - PAD - 100, PANEL_H - 48, 100, "Close", F_MEDIUM, 20, A_BUTTON_REST, function() { closeMenu(); });
}

function draw()
{
   actions = [];
   focus = -1;
   var h = clear("head", 20);
   dboTitle(h, "title", 1, PAD, 16, PANEL_W - PAD * 2, "Spellbook");
   dboDivider(h, PAD, 70, PANEL_W - PAD * 2);
   BODY_H = PANEL_H - 118 - 84;
   flowStart(panel, 50, PAD, 84);
   drawPrepared();
   drawKnown();
   var pages = flowShow(page);
   if (page >= pages)
   {
      page = pages - 1;
      flowShow(page);
   }
   drawFoot(pages);
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
   if (p == null || p.nonce == undefined || p.known == undefined)
   {
      dboLog("spellbook: unreadable payload");
      return;
   }
   data = p;
   // a re-sent book ends the change in flight
   busyId = "";
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = dboKey();
   if (code == 27)
   {
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
dboKeys(keys);

_root.onEnterFrame = function()
{
   if (data == null)
   {
      if (getTimer() - builtAt >= NO_DATA_CLOSE_MS)
      {
         dboLog("spellbook: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
         delete _root.onEnterFrame;
         dboClose();
      }
      return;
   }
   // a change that never came back frees the buttons
   if (busyId != "" && !busy())
   {
      busyId = "";
      draw();
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
