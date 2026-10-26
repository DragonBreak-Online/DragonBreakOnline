// The interact menu (X on a player or a companion) as a native panel: a port of skymp5-front features/contextMenu.
// The widget comes from client playerActionService; its events (events.action with the entry id, events.close) go back
// through the client router as the browser's would, and the service closes the menu. The gamemode picks the entries.

var DBO_SWF_VERSION = "context-1";
var STAGE_W = 1280;
var STAGE_H = 720;
var PANEL_W = 380;
var PAD = 22;
var ROW_H = 34;
var MAX_ROWS = 9;
var GAP = 18;
var LONG_TITLE = 20;
var BODY_MAX = 360;
var NO_DATA_CLOSE_MS = 8000;
var DEFAULT_EVENTS = {action: "pa:action", close: "pa:close"};
var LAW = ["search", "capture", "release", "carry", "putdown", "ropelead", "ropeleave", "ropecut"];

var panel;
var data = null;
var page = 0;
var builtAt = getTimer();

function ev(k)
{
   return data.events != undefined && data.events[k] != undefined ? String(data.events[k]) : DEFAULT_EVENTS[k];
}

function startsWith(s, p)
{
   return s.substr(0, p.length) == p;
}

// The X menu's headings by id (specs/f3-hub-design.md 3.8), as the browser's GROUPS; an id no group knows stays first
function groupOf(id)
{
   if (id == "party" || id == "partykick" || id == "partyleave")
   {
      return 1;
   }
   if (startsWith(id, "faction:"))
   {
      return 2;
   }
   for (var i = 0; i < LAW.length; i++)
   {
      if (LAW[i] == id)
      {
         return 3;
      }
   }
   if (id == "pickpocket" || id == "rob")
   {
      return 4;
   }
   if (startsWith(id, "super:"))
   {
      return 5;
   }
   if (startsWith(id, "voice:"))
   {
      return 6;
   }
   return 0;
}

// [heading, entry] in display order: a heading row has no entry. Law without Search is a player's rope, headed Rope
function rowsOf(actions)
{
   var heads = ["", "Party", "Faction", "Law", "Shadows", "Your nature", "Voice"];
   var groups = [[], [], [], [], [], [], []];
   var search = false;
   for (var i = 0; i < actions.length; i++)
   {
      var a = actions[i];
      if (a == null || a.id == undefined)
      {
         continue;
      }
      groups[groupOf(String(a.id))].push(a);
      if (a.id == "search")
      {
         search = true;
      }
   }
   if (!search)
   {
      heads[3] = "Rope";
   }
   var out = [];
   for (var g = 0; g < groups.length; g++)
   {
      if (!groups[g].length)
      {
         continue;
      }
      if (heads[g] != "")
      {
         out.push([heads[g], null]);
      }
      for (var k = 0; k < groups[g].length; k++)
      {
         out.push(["", groups[g][k]]);
      }
   }
   return out;
}

// Pages of at most nine entries; a group cut by the page break carries its heading onto the next page
function pagesOf(rows)
{
   var pages = [];
   var cur = [];
   var n = 0;
   var head = null;
   for (var i = 0; i < rows.length; i++)
   {
      if (rows[i][1] == null)
      {
         head = rows[i];
      }
      if (rows[i][1] != null && n == MAX_ROWS)
      {
         if (cur[cur.length - 1][1] == null)
         {
            cur.pop();
         }
         pages.push(cur);
         cur = head != null ? [head] : [];
         n = 0;
      }
      cur.push(rows[i]);
      if (rows[i][1] != null)
      {
         n++;
      }
   }
   pages.push(cur);
   return pages;
}

// The owner closes or re-sends: playerActionService closes on its action, a gameplay menu (alchemy) redraws in place
function pick(id)
{
   dboSound("UIMenuOK");
   dboSend(ev("action"), [id]);
}

// A wrapped line's height: about 34 characters a line at 18 px across the panel
function lineHeight(s)
{
   return Math.max(1, Math.ceil(s.length / 34)) * 22 + 4;
}

// Inspect lines in pages no taller than BODY_MAX, so Close is never pushed off the screen
function linePages(lines)
{
   var pages = [];
   var cur = [];
   var h = 0;
   for (var i = 0; i < lines.length; i++)
   {
      var t = String(lines[i]);
      var lh = Math.min(BODY_MAX, lineHeight(t));
      if (cur.length && h + lh > BODY_MAX)
      {
         pages.push(cur);
         cur = [];
         h = 0;
      }
      cur.push(t);
      h += lh;
   }
   pages.push(cur);
   return pages;
}

function pageCount()
{
   if (data.mode == "inspect")
   {
      return linePages(data.lines instanceof Array ? data.lines : []).length;
   }
   return pagesOf(rowsOf(data.actions instanceof Array ? data.actions : [])).length;
}

function closeMenu()
{
   dboSound("UIMenuCancel");
   dboSend(ev("close"), []);
   dboClose();
}

function draw()
{
   actions = [];
   focus = -1;
   var b = clear("body", 20);
   var inspect = data.mode == "inspect";
   var kick = dboText(b, "kicker", 1, PAD, 14, PANEL_W - PAD * 2, 22, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8), false);
   kick.text = inspect ? "Inspect" : "Interact";
   var name = String(data.targetName);
   var twoLines = name.length > LONG_TITLE;
   var title = dboText(b, "title", 2, PAD, 36, PANEL_W - PAD * 2, twoLines ? 52 : 36, dboFmt(F_PLAIN, twoLines ? 20 : 26, C_TEXT, 1.0), twoLines);
   title.text = name;
   var y = twoLines ? 92 : 76;
   dboRule(b, PAD, y, PANEL_W - PAD * 2);
   y += 10;
   var pages = pageCount();
   if (page >= pages)
   {
      page = pages - 1;
   }
   if (inspect)
   {
      var lines = linePages(data.lines instanceof Array ? data.lines : [])[page];
      for (var i = 0; i < lines.length; i++)
      {
         var lh = Math.min(BODY_MAX, lineHeight(lines[i]));
         var lt = dboText(b, "line" + i, 10 + i, PAD, y, PANEL_W - PAD * 2, lh, dboFmt(F_MEDIUM, 18, C_TEXT, 0.8), true);
         lt.text = lines[i];
         y += lh;
      }
   }
   else
   {
      var rows = pagesOf(rowsOf(data.actions instanceof Array ? data.actions : []))[page];
      var n = 0;
      for (var r = 0; r < rows.length; r++)
      {
         if (rows[r][1] == null)
         {
            var h = dboText(b, "head" + r, 40 + r, PAD, y + 6, PANEL_W - PAD * 2, 22, dboFmt(F_BOLD, 16, C_SECOND, 0), false);
            h.text = rows[r][0];
            y += 28;
            continue;
         }
         var a = rows[r][1];
         var c = b.createEmptyMovieClip("r" + n, 60 + n);
         c._x = PAD;
         c._y = y;
         dboBox(c, 0, 0, PANEL_W - PAD * 2, ROW_H - 4, 0x000000, 1);
         var kt = dboText(c, "key", 1, 0, 3, 24, ROW_H - 6, dboFmt(F_BOLD, 20, C_SECOND, 0), false);
         kt.text = String(n + 1);
         var lb = dboText(c, "label", 2, 28, 2, PANEL_W - PAD * 2 - 28, ROW_H - 4, dboFmt(F_MEDIUM, 22, C_TEXT, 0.8), false);
         lb.text = String(a.label);
         c.rest = A_ROW_REST;
         c._alpha = A_ROW_REST;
         c.actionId = String(a.id);
         c.rowIndex = n;
         c.idx = actions.length;
         actions.push(c);
         c.onPick = function()
         {
            pick(this.actionId);
         };
         c.onRollOver = function()
         {
            setFocus(this.idx);
         };
         c.onRollOut = function()
         {
            this._alpha = this.rest;
         };
         c.onRelease = function()
         {
            this.onPick();
         };
         y += ROW_H;
         n++;
      }
   }
   if (pages > 1)
   {
      y += 4;
      var prev = button(b, "prev", 90, PAD, y, 100, "Previous", F_MEDIUM, 18, A_BUTTON_REST, function()
      {
         turnPage(-1);
      });
      var next = button(b, "next", 91, PAD + 106, y, 70, "Next", F_MEDIUM, 18, A_BUTTON_REST, function()
      {
         turnPage(1);
      });
      if (page == 0)
      {
         disable(prev);
      }
      if (page >= pages - 1)
      {
         disable(next);
      }
      var pt = dboText(b, "page", 92, PAD + 180, y + 4, PANEL_W - PAD * 2 - 180, 22, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8, "right"), false);
      pt.text = "Page " + (page + 1) + " of " + pages;
      y += 30;
   }
   y += 6;
   dboRule(b, PAD, y, PANEL_W - PAD * 2);
   y += 10;
   button(b, "close", 95, PAD, y, 120, "Close", F_MEDIUM, 22, A_BUTTON_REST, function()
   {
      closeMenu();
   });
   var height = y + 32 + PAD - 6;
   panel.bg.clear();
   dboBox(panel.bg, 0, 0, PANEL_W, height, 0x000000, 80);
   // down-right of the crosshair, kept on the screen, as the browser menu opens
   panel._x = STAGE_W / 2 + GAP;
   panel._y = Math.max(40, Math.min(STAGE_H - 40 - height, STAGE_H / 2 - height / 3));
}

function turnPage(d)
{
   var pages = pageCount();
   if (page + d < 0 || page + d >= pages)
   {
      return;
   }
   dboSound("UIMenuPrevNext");
   page += d;
   draw();
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   panel._x = STAGE_W / 2 + GAP;
   panel._y = 200;
   panel.createEmptyMovieClip("bg", 1);
   dboFadeIn(panel);
}

// A re-send (the salvage menu after every breakdown) redraws in place
_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || p.targetName == undefined || !(p.actions instanceof Array || p.lines instanceof Array))
   {
      dboLog("context: unreadable payload");
      return;
   }
   if (data == null || String(p.targetName) != String(data.targetName) || p.mode != data.mode)
   {
      page = 0;
   }
   data = p;
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = Key.getCode();
   dboLog("context key " + code);
   if (code == 27 || code == 9)
   {
      if (data == null)
      {
         dboClose();
         return;
      }
      closeMenu();
      return;
   }
   if (data == null)
   {
      return;
   }
   if (code >= 49 && code <= 57)
   {
      for (var i = 0; i < actions.length; i++)
      {
         if (actions[i].rowIndex == code - 49)
         {
            actions[i].onPick();
            return;
         }
      }
   }
   else if ((code == 38 || code == 87) && actions.length)
   {
      setFocus(focus <= 0 ? actions.length - 1 : focus - 1);
   }
   else if ((code == 40 || code == 83) && actions.length)
   {
      setFocus(focus < 0 || focus >= actions.length - 1 ? 0 : focus + 1);
   }
   else if ((code == 13 || code == 69) && focus >= 0)
   {
      actions[focus].onPick();
   }
   else if (code == 37 || code == 33)
   {
      turnPage(-1);
   }
   else if (code == 39 || code == 34)
   {
      turnPage(1);
   }
};
Key.addListener(keys);

var wheel = {};
wheel.onMouseWheel = function(delta)
{
   if (data != null)
   {
      turnPage(delta > 0 ? -1 : 1);
   }
};
Mouse.addListener(wheel);

_root.onEnterFrame = function()
{
   if (data == null && getTimer() - builtAt >= NO_DATA_CLOSE_MS)
   {
      dboLog("context: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
      delete _root.onEnterFrame;
      dboClose();
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
