// The admin panel (F7) as a native panel: a port of skymp5-front features/adminPanel, in Nat's branded look (STYLE.md 11).
// adminMenuService owns the data (adminNativeView.ts): this panel says what it shows (admin::ui) and gets back that tab's
// page. Every button sends the browser panel's own key with its arguments; the server checks rank and target for all.
// Names, amounts and searches are typed in the panel (dboInput). Tabs are drawn by dbo_admin/tabs/*.as into TABS.

var DBO_SWF_VERSION = "admin-1";
var PANEL_W = 1200;
var PANEL_H = 640;
var RAIL_W = 150;
var CX = 196;
var CW = PANEL_W - CX - PAD;
var CY = 82;
var CB = PANEL_H - 28;
var NO_DATA_CLOSE_MS = 8000;

var panel;
var builtAt = getTimer();
var picking = false;
var pickPage = 0;

function tabOf(id)
{
   return TABS[id] != undefined ? TABS[id] : null;
}

function actsOn(id)
{
   return id == "players" || id == "skills" || id == "items" || id == "enchant" || id == "powers";
}

function caps()
{
   return data != null && data.caps != undefined ? data.caps : {ban: true, del: true, spawn: true, trial: false, actions: ["teleportTo", "summon", "kick", "rename"]};
}

function openTab(id)
{
   if (id == ui.tab)
   {
      return;
   }
   dboSound("UIMenuPrevNext");
   leaveTab();
   if (editing != null)
   {
      editing = null;
      dboInputEnd();
   }
   armedKey = "";
   picking = false;
   ui = {tab: id, page: 0, acting: ui.acting};
   sendUi();
   var t = tabOf(id);
   if (t != null && t.open != undefined)
   {
      t.open();
   }
   draw();
}

function leaveTab()
{
   var t = tabOf(ui.tab);
   if (t != null && t.leave != undefined)
   {
      t.leave();
   }
}

function setActing(id)
{
   dboSound("UIMenuOK");
   picking = false;
   setUi("acting", id, true);
   var t = tabOf(ui.tab);
   if (t != null && t.acting != undefined)
   {
      t.acting();
   }
   draw();
}

function closeAdmin()
{
   leaveTab();
   // the game gets its keys back whatever was being typed
   if (editing != null)
   {
      editing = null;
      dboInputEnd();
   }
   dboSound("UIMenuCancel");
   dboSend(ev("close"), []);
   dboClose();
}

function refresh()
{
   dboSound("UIMenuOK");
   dboSend(ev("debugRefresh"), []);
   if (data != null && data.admin == true)
   {
      dboSend(ev("refresh"), []);
   }
   var t = tabOf(ui.tab);
   if (t != null && t.open != undefined)
   {
      t.open();
   }
}

function drawHead()
{
   var h = clear("head", 20);
   dboTitle(h, "title", 1, PAD, 16, 520, data.admin == true ? "Admin Panel" : "Debug");
   if (data.admin == true && str(data.tier) != "")
   {
      hint(h, "tier", 2, PAD + (data.admin == true ? 290 : 120), 28, 200, "(" + data.tier + ")");
   }
   btn(h, "refresh", 10, PANEL_W - PAD - 220, 20, 104, "Refresh", function()
   {
      refresh();
   });
   btn(h, "close", 11, PANEL_W - PAD - 108, 20, 104, "Close", function()
   {
      closeAdmin();
   });
   dboDivider(h, PAD, 66, PANEL_W - PAD * 2);
}

function drawRail()
{
   var r = clear("rail", 30);
   var tabs = data.tabs instanceof Array ? data.tabs : [{id: "debug", label: "Debug"}];
   for (var i = 0; i < tabs.length; i++)
   {
      var on = tabs[i].id == ui.tab;
      var b = button(r, "t" + i, 10 + i, PAD, CY + i * 38, RAIL_W - 10, tabs[i].label, F_BOLD, 18, on ? A_FOCUS : A_ROW_REST, function()
      {
         openTab(this.tabId);
      });
      b.tabId = tabs[i].id;
      if (on)
      {
         dboTabMark(b, textW(tabs[i].label, 18) - 28);
      }
   }
   dboBox(r, CX - 14, CY, 1, CB - CY, C_STONE, 60);
}

// "Acting on: <name>" over the tabs that act on somebody, with the picker that changes it
function drawStrip(c)
{
   var who = data.acting != undefined ? str(data.acting.label) : "You";
   label(c, "actingOn", 1, CX, CY, 420, "Acting on: " + who, 20, C_TEXT);
   btn(c, "change", 2, CX + 430, CY - 2, 100, "Change", function()
   {
      dboSound("UIMenuOK");
      picking = true;
      pickPage = 0;
      draw();
   }, !(data.targets instanceof Array) || data.targets.length < 2);
   var cp = caps();
   if (cp.spawn == false)
   {
      hint(c, "tierHint", 3, CX + 540, CY + 4, CW - 540, cp.trial == true ? "Trial GM: TP to a player or a location, Rename, Invisible and Ghost" : "GM: you observe; changes are for a Lead GM and above");
   }
   dboRule(c, CX, CY + 34, CW);
}

// Who to act on: you first, then everyone online, nine at a time
function drawPicker(c)
{
   var list = data.targets instanceof Array ? data.targets : [];
   var pages = Math.max(1, Math.ceil(list.length / MAX_ROWS));
   pickPage = Math.max(0, Math.min(pages - 1, pickPage));
   section(c, "pickHead", 1, CX, CY + 44, CW, "Act on whom?");
   var rows = list.slice(pickPage * MAX_ROWS, pickPage * MAX_ROWS + MAX_ROWS);
   var y = rowList(c, "pick", 10, CX, CY + 78, CW, rows, function(t)
   {
      return [[t.label, 0, 600], [t.id == "" ? "yourself" : "0x" + t.id, 620, 300, C_SECOND]];
   }, function(t)
   {
      setActing(t.id);
   }, function(t)
   {
      return data.acting != undefined && t.id == data.acting.id;
   });
   pageTurn = function(d)
   {
      var p = Math.max(0, Math.min(pages - 1, pickPage + d));
      if (p != pickPage)
      {
         dboSound("UIMenuPrevNext");
         pickPage = p;
         draw();
      }
   };
   if (pages > 1)
   {
      hint(c, "pickWhere", 40, CX, y + 10, 300, "Page " + (pickPage + 1) + " of " + pages);
      btn(c, "pickPrev", 41, CX + 310, y + 6, 110, "Previous", function()
      {
         pageTurn(-1);
      }, pickPage <= 0);
      btn(c, "pickNext", 42, CX + 426, y + 6, 80, "Next", function()
      {
         pageTurn(1);
      }, pickPage >= pages - 1);
   }
   btn(c, "pickCancel", 43, CX, CB - 34, 110, "Cancel", function()
   {
      dboSound("UIMenuCancel");
      picking = false;
      draw();
   });
}

function draw()
{
   if (data == null)
   {
      return;
   }
   // the focused control keeps its place across a redraw (a data push, the clock)
   var kept = focus;
   actions = [];
   focus = -1;
   pageTurn = null;
   var c = clear("body", 40);
   var y = CY;
   if (data.admin == true && actsOn(ui.tab))
   {
      drawStrip(c);
      y = CY + 46;
   }
   if (picking)
   {
      drawPicker(c);
   }
   else
   {
      var t = tabOf(ui.tab);
      if (t != null)
      {
         t.draw(c, CX, y, CW, CB - y);
      }
   }
   drawRail();
   drawHead();
   if (kept >= 0 && kept < actions.length && actions[kept].disabled != true)
   {
      focus = kept;
      actions[kept]._alpha = A_FOCUS;
      dboWash(actions[kept], true);
   }
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   dboFit(panel, PANEL_W, PANEL_H);
   var bg = panel.createEmptyMovieClip("bg", 1);
   dboGround(bg, PANEL_W, PANEL_H);
   dboWatermark(panel, 5, PANEL_W - 60, 150, 380);
   dboFadeIn(panel);
}

// The whole view for the tab shown; the tab the service settled on wins (a demoted admin goes back to Debug)
_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || p.tab == undefined || !(p.tabs instanceof Array))
   {
      dboLog("admin: unreadable payload");
      return;
   }
   var first = data == null;
   data = p;
   dataAt = getTimer();
   if (str(p.tab) != ui.tab && !first)
   {
      ui.tab = str(p.tab);
      ui.page = 0;
   }
   if (first)
   {
      ui.tab = str(p.tab);
      var t = tabOf(ui.tab);
      if (t != null && t.open != undefined)
      {
         t.open();
      }
   }
   if (p.acting != undefined)
   {
      ui.acting = str(p.acting.id);
   }
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = dboKey();
   // typing: Enter keeps the text, Escape puts it back, every other key is the text
   if (editing != null)
   {
      if (code == 13)
      {
         finishEdit(true);
      }
      else if (code == 27)
      {
         dboSound("UIMenuCancel");
         finishEdit(false);
      }
      return;
   }
   if (code == 27)
   {
      if (picking)
      {
         dboSound("UIMenuCancel");
         picking = false;
         draw();
         return;
      }
      if (armedKey != "")
      {
         dboSound("UIMenuCancel");
         armedKey = "";
         draw();
         return;
      }
      closeAdmin();
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
   else if ((code == 13 || code == 69) && focus >= 0 && actions[focus].disabled != true)
   {
      actions[focus].onPick();
   }
   else if ((code == 37 || code == 33) && pageTurn != null)
   {
      pageTurn(-1);
   }
   else if ((code == 39 || code == 34) && pageTurn != null)
   {
      pageTurn(1);
   }
};
Key.addListener(keys);

var wheel = {};
wheel.onMouseWheel = function(delta)
{
   if (pageTurn != null && editing == null)
   {
      pageTurn(delta > 0 ? -1 : 1);
   }
};
Mouse.addListener(wheel);

_root.onEnterFrame = function()
{
   liveTick();
   // an armed button that was not pressed again goes back to itself
   if (armedKey != "" && getTimer() - armedAt >= CONFIRM_MS)
   {
      armedKey = "";
      draw();
   }
   var t = tabOf(ui.tab);
   if (t != null && t.tick != undefined && data != null)
   {
      t.tick();
   }
   if (data == null && getTimer() - builtAt >= NO_DATA_CLOSE_MS)
   {
      dboLog("admin: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
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
