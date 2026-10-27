// The home decorating panel (widget 171, server decor.js): catalogue, placed pieces and people. The server builds every row.

var DBO_SWF_VERSION = "decor-1";
var STAGE_W = 1280;
var PANEL_W = 920;
var PANEL_H = 600;
var PAD = 28;
var ROW_H = 46;
var LIST_X = 230;
var LIST_TOP = 168;
// the rows that fit above the footer; the server pages at 8 for native:decor (decor.js PANEL_CAPS)
var MAX_ROWS = 8;
var C_AMBER = 0xC9A86A;
var C_RED = 0xB23A3A;
var NO_DATA_CLOSE_MS = 8000;
var TABS = [["catalog", "Catalogue"], ["placed", "Placed"], ["people", "Carpenters"]];

var panel;
var data = null;
var focus = -1;
var actions = [];
var builtAt = getTimer();

function send(key, args)
{
   dboSend(key, [data.nonce].concat(args));
}

function view(v, group, page)
{
   dboSound("UIMenuPrevNext");
   send("dbo:decorView", [v, group, page]);
}

function closePanel()
{
   dboSound("UIMenuCancel");
   dboSend("dbo:close", []);
   dboSend("close", []);
   dboClose();
}

function meterColor(m)
{
   if (m.used >= m.of)
   {
      return C_RED;
   }
   return m.of > 1 && m.of - m.used == 1 ? C_AMBER : C_SECOND;
}

// A clickable line of text: rests at `rest` alpha, full on focus, plays the vanilla sounds
function button(parent, name, depth, x, y, w, label, font, size, rest, onPick)
{
   var c = parent.createEmptyMovieClip(name, depth);
   c._x = x;
   c._y = y;
   dboBox(c, 0, 0, w, size + 10, 0x000000, 1);
   var t = dboText(c, "label", 1, 0, 2, w, size + 8, dboFmt(font, size, C_TEXT, 0.8), false);
   t.text = label;
   c.rest = rest;
   c._alpha = rest;
   c.onPick = onPick;
   c.onRollOver = function()
   {
      this._alpha = A_FOCUS;
      dboWash(this, true);
      dboSound("UIMenuFocus");
   };
   c.onRollOut = function()
   {
      this._alpha = this.rest;
      dboWash(this, false);
   };
   c.onRelease = function()
   {
      this.onPick();
   };
   return c;
}

function clear(name, depth)
{
   if (panel[name] != undefined)
   {
      panel[name].removeMovieClip();
   }
   return panel.createEmptyMovieClip(name, depth);
}

function setFocus(i)
{
   if (i == focus || i >= actions.length)
   {
      return;
   }
   if (focus >= 0 && focus < actions.length)
   {
      actions[focus]._alpha = actions[focus].rest;
      dboWash(actions[focus], false);
   }
   focus = i;
   if (focus >= 0)
   {
      actions[focus]._alpha = A_FOCUS;
      dboWash(actions[focus], true);
      dboSound("UIMenuFocus");
   }
}

function drawHeader()
{
   var h = clear("head", 20);
   dboTitle(h, "title", 1, PAD, 20, PANEL_W - PAD * 2, data.home);
   var x = PAD;
   for (var i = 0; i < data.budget.length; i++)
   {
      var m = data.budget[i];
      var t = dboText(h, "m" + i, 10 + i, x, 64, 200, 24, dboFmt(F_MEDIUM, 18, meterColor(m), 0.8), false);
      t.text = m.label + "  " + m.used + "/" + m.of;
      x += 200;
   }
   dboDivider(h, PAD, 98, PANEL_W - PAD * 2);
   var tx = PAD;
   for (var k = 0; k < TABS.length; k++)
   {
      if (TABS[k][0] == "people" && !data.owner)
      {
         continue;
      }
      var b = button(h, "tab" + k, 30 + k, tx, 112, 150, TABS[k][1], F_BOLD, 22, TABS[k][0] == data.view ? A_FOCUS : A_ROW_REST, function()
      {
         view(this.v, null, 0);
      });
      b.v = TABS[k][0];
      if (TABS[k][0] == data.view)
      {
         dboTabMark(b, TABS[k][1].length * 13);
      }
      tx += 160;
   }
   if (data.undo > 0)
   {
      button(h, "undo", 40, PANEL_W - PAD - 160, 112, 160, "Undo (" + data.undo + " s)", F_MEDIUM, 20, A_BUTTON_REST, function()
      {
         dboSound("UIMenuOK");
         send("dbo:decorUndo", []);
      });
   }
}

function costLine(cost)
{
   var parts = [];
   for (var i = 0; i < cost.length; i++)
   {
      parts.push(cost[i].name + " " + cost[i].have + "/" + cost[i].n);
   }
   return parts.join("    ");
}

function shortOf(cost)
{
   for (var i = 0; i < cost.length; i++)
   {
      if (cost[i].have < cost[i].n)
      {
         return true;
      }
   }
   return false;
}

function drawGroups(l)
{
   for (var i = 0; i < data.groups.length && i < 10; i++)
   {
      var g = data.groups[i];
      var b = button(l, "g" + i, 200 + i, PAD, LIST_TOP + i * 34, LIST_X - PAD - 16, String(g.label), F_MEDIUM, 20, g.id == data.group ? A_FOCUS : A_ROW_REST, function()
      {
         view("catalog", this.g, 0);
      });
      b.g = g.id;
   }
}

// One row: a title line and a second line in grey; `pick` makes the whole row an action
function row(l, i, title, sub, subColor, disabled, pick)
{
   var c = l.createEmptyMovieClip("r" + i, 10 + i);
   c._x = LIST_X;
   c._y = LIST_TOP + i * ROW_H;
   var w = PANEL_W - LIST_X - PAD;
   dboBox(c, 0, 0, w, ROW_H - 4, 0x000000, 1);
   var k = dboText(c, "num", 1, 0, 4, 22, 26, dboFmt(F_BOLD, 18, C_SECOND, 0), false);
   k.text = pick != null ? String(i + 1) : "";
   var t = dboText(c, "label", 2, 26, 0, w - 26, 28, dboFmt(F_MEDIUM, 22, disabled ? C_DISABLED : C_TEXT, 0.8), false);
   t.text = title;
   var s = dboText(c, "sub", 3, 26, 24, w - 26, 22, dboFmt(F_MEDIUM, 16, subColor, 0.8), false);
   s.text = sub;
   c.rest = disabled ? 50 : A_ROW_REST;
   c.washW = w;
   c.washH = ROW_H - 4;
   c._alpha = c.rest;
   if (pick != null)
   {
      c.onPick = pick;
      c.idx = actions.length;
      actions.push(c);
      c.onRollOver = function()
      {
         setFocus(this.idx);
      };
      c.onRelease = function()
      {
         this.onPick();
      };
   }
   return c;
}

function small(parent, name, x, label, pick)
{
   var b = button(parent, name, 20 + x, x, 4, 110, label, F_MEDIUM, 18, A_BUTTON_REST, pick);
   b.idx = actions.length;
   actions.push(b);
   return b;
}

function drawCatalog(l)
{
   drawGroups(l);
   for (var i = 0; i < data.rows.length && i < MAX_ROWS; i++)
   {
      var r = data.rows[i];
      var blocked = r.why != "";
      var sub = blocked ? String(r.why) : costLine(r.cost);
      var c = row(l, i, String(r.name), sub, blocked ? C_DISABLED : (shortOf(r.cost) ? C_RED : C_SECOND), blocked, blocked ? null : function()
      {
         dboSound("UIMenuOK");
         send("dbo:decorPlace", [this.key]);
      });
      c.key = r.key;
      c.rowIndex = i;
   }
   if (!data.rows.length)
   {
      row(l, 0, "Nothing in this group.", "", C_SECOND, true, null);
   }
}

function drawPlaced(l)
{
   for (var i = 0; i < data.rows.length && i < MAX_ROWS; i++)
   {
      var r = data.rows[i];
      var bits = [];
      if (r.state != "")
      {
         bits.push(String(r.state));
      }
      if (r.refund != "")
      {
         bits.push("taking it down gives back " + r.refund);
      }
      var c = row(l, i, String(r.name), bits.join(";  "), C_SECOND, false, null);
      c._alpha = A_FOCUS;
      var w = PANEL_W - LIST_X - PAD;
      var mv = small(c, "mv", w - 230, "Move", function()
      {
         dboSound("UIMenuOK");
         send("dbo:decorMove", [this._parent.key]);
      });
      var rm = small(c, "rm", w - 110, "Remove", function()
      {
         dboSound("UIMenuOK");
         send("dbo:decorRemove", [this._parent.key]);
      });
      c.key = r.key;
   }
   if (!data.rows.length)
   {
      row(l, 0, "Nothing placed here yet.", "Pick a piece in the Catalogue.", C_SECOND, true, null);
   }
}

// A carpenter's rank and the share their takedowns give back to the owner (decor.js people rows: tier, refund, online)
function skillText(r)
{
   return r.tier != undefined && r.tier != "" ? r.tier + " woodworker, " + r.refund + "% back" : "offline";
}

function drawPeople(l)
{
   var note = dboText(l, "note", 300, PAD, LIST_TOP, LIST_X - PAD - 16, 260, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8), true);
   note.text = "Carpenters may place, move and take down pieces here. What they take down comes back to you, at their woodworking skill." +
      (data.own != undefined ? "\n\nYour own: " + data.own.tier + ", " + data.own.refund + "% back." : "");
   var i = 0;
   var w = PANEL_W - LIST_X - PAD;
   for (var k = 0; k < data.rows.length && i < MAX_ROWS; k++, i++)
   {
      var c = row(l, i, String(data.rows[k].name), skillText(data.rows[k]), C_SECOND, false, null);
      c._alpha = A_FOCUS;
      c.key = data.rows[k].key;
      small(c, "rv", w - 110, "Dismiss", function()
      {
         dboSound("UIMenuOK");
         send("dbo:decorRevoke", [this._parent.key]);
      });
   }
   for (var n = 0; n < data.nearby.length && i < MAX_ROWS; n++, i++)
   {
      var c2 = row(l, i, String(data.nearby[n].name), "here now: " + skillText(data.nearby[n]), C_SECOND, false, null);
      c2._alpha = A_FOCUS;
      c2.key = data.nearby[n].key;
      small(c2, "gr", w - 110, "Hire", function()
      {
         dboSound("UIMenuOK");
         send("dbo:decorGrant", [this._parent.key]);
      });
   }
   if (!i)
   {
      row(l, 0, "No carpenters hired yet.", "Bring one inside to hire them.", C_SECOND, true, null);
   }
}

function drawFooter()
{
   var f = clear("foot", 60);
   var y = PANEL_H - 52;
   dboDivider(f, PAD, y - 8, PANEL_W - PAD * 2);
   button(f, "close", 1, PAD, y, 120, "Close", F_MEDIUM, 22, A_BUTTON_REST, function()
   {
      closePanel();
   });
   if (data.pages > 1)
   {
      var pt = dboText(f, "page", 2, PANEL_W / 2 - 80, y + 4, 160, 26, dboFmt(F_MEDIUM, 18, C_SECOND, 0.8, "center"), false);
      pt.text = "Page " + (data.page + 1) + " of " + data.pages;
      if (data.page > 0)
      {
         button(f, "prev", 3, PANEL_W / 2 - 130, y, 40, "<", F_BOLD, 22, A_BUTTON_REST, function()
         {
            view(data.view, null, data.page - 1);
         });
      }
      if (data.page < data.pages - 1)
      {
         button(f, "next", 4, PANEL_W / 2 + 100, y, 40, ">", F_BOLD, 22, A_BUTTON_REST, function()
         {
            view(data.view, null, data.page + 1);
         });
      }
   }
   // starts after the page arrows, so the hint never runs under them
   var hx = PANEL_W / 2 + 150;
   var hint = dboText(f, "hint", 5, hx, y + 6, PANEL_W - PAD - hx, 24, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8, "right"), false);
   hint.text = "1-8 choose  -  Arrows page  -  Q / R tab";
}

function draw()
{
   actions = [];
   focus = -1;
   drawHeader();
   var l = clear("list", 40);
   if (data.view == "placed")
   {
      drawPlaced(l);
   }
   else if (data.view == "people")
   {
      drawPeople(l);
   }
   else
   {
      drawCatalog(l);
   }
   drawFooter();
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   dboFit(panel, PANEL_W, PANEL_H);
   var bg = panel.createEmptyMovieClip("bg", 1);
   dboGround(bg, PANEL_W, PANEL_H);
   dboWatermark(panel, 5, PANEL_W - 50, 160, 280);
   dboFadeIn(panel);
}

// The whole payload on every change; rows are re-drawn from it
_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || p.nonce == undefined || !(p.rows instanceof Array))
   {
      dboLog("decor: unreadable payload");
      return;
   }
   if (!(p.groups instanceof Array))
   {
      p.groups = [];
   }
   if (!(p.budget instanceof Array))
   {
      p.budget = [];
   }
   if (!(p.nearby instanceof Array))
   {
      p.nearby = [];
   }
   data = p;
   draw();
};

function tabStep(d)
{
   var list = [];
   for (var k = 0; k < TABS.length; k++)
   {
      if (TABS[k][0] != "people" || data.owner)
      {
         list.push(TABS[k][0]);
      }
   }
   var at = 0;
   for (var i = 0; i < list.length; i++)
   {
      if (list[i] == data.view)
      {
         at = i;
      }
   }
   view(list[(at + d + list.length) % list.length], null, 0);
}

var keys = {};
keys.onKeyDown = function()
{
   var code = dboKey();
   dboLog("decor key " + code);
   if (code == 27)
   {
      closePanel();
      return;
   }
   if (data == null)
   {
      return;
   }
   if (code >= 49 && code <= 56 && data.view == "catalog")
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
   else if (code == 38 && actions.length)
   {
      setFocus(focus <= 0 ? actions.length - 1 : focus - 1);
   }
   else if (code == 40 && actions.length)
   {
      setFocus(focus < 0 || focus >= actions.length - 1 ? 0 : focus + 1);
   }
   else if (code == 13 && focus >= 0)
   {
      actions[focus].onPick();
   }
   else if (code == 37 && data.page > 0)
   {
      view(data.view, null, data.page - 1);
   }
   else if (code == 39 && data.page < data.pages - 1)
   {
      view(data.view, null, data.page + 1);
   }
   else if (code == 81)
   {
      tabStep(-1);
   }
   else if (code == 82)
   {
      tabStep(1);
   }
};
Key.addListener(keys);

_root.onEnterFrame = function()
{
   if (data == null && getTimer() - builtAt >= NO_DATA_CLOSE_MS)
   {
      dboLog("decor: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
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
