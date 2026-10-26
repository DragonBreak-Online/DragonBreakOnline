// The notice board as a native panel (client bountyBoardService's widget, the same object the browser board gets).
// Events go out as the widget's own keys (events.post/remove/close) and dbo:* hand-overs; the client router replays them as
// the browser would. Writing a notice is typed, so "Write a notice..." hands off to the browser composer (native:handoff).

var DBO_SWF_VERSION = "board-1";
var STAGE_W = 1280;
var PANEL_W = 920;
var PANEL_H = 600;
var PAD = 28;
var ROW_H = 46;
var LIST_TOP = 150;
var MAX_ROWS = 8;
var NO_DATA_CLOSE_MS = 8000;
var C_RED = 0xB23A3A;
var HANDOVERS = [["Letters", "dbo:pigeonOpen", "letters"], ["Citizenship", "dbo:citizenOpen", "citizenship"], ["Voting", "dbo:citizenOpen", "voting"]];
var FOOT = [["Send a pigeon", "dbo:pigeonOpen", "send"], ["Supply orders", "dbo:pigeonOpen", "supply"], ["Couriers", "dbo:pigeonOpen", "courier"]];

var panel;
var data = null;
var tabId = "";
var page = 0;
var reading = -1;
var focus = -1;
var actions = [];
var builtAt = getTimer();

function ev(k)
{
   return data.events != undefined && data.events[k] != undefined ? String(data.events[k]) : "bountyBoard:" + k;
}

function closeBoard()
{
   dboSound("UIMenuCancel");
   dboSend(ev("close"), []);
   dboSend("close", []);
   dboClose();
}

// A hand-over to another panel (pigeon coop, citizenship): its event, then this board closes as the browser board does
function handOver(key, arg)
{
   dboSound("UIMenuOK");
   dboSend(key, [arg]);
   dboSend(ev("close"), []);
   dboClose();
}

function currentTab()
{
   for (var i = 0; i < data.tabs.length; i++)
   {
      if (data.tabs[i].id == tabId)
      {
         return data.tabs[i];
      }
   }
   return data.tabs[0];
}

function notesOf(id)
{
   var out = [];
   for (var i = 0; i < data.notes.length; i++)
   {
      if (data.notes[i].tab == id)
      {
         out.push(data.notes[i]);
      }
   }
   return out;
}

function noteById(id)
{
   for (var i = 0; i < data.notes.length; i++)
   {
      if (data.notes[i].id == id)
      {
         return data.notes[i];
      }
   }
   return null;
}

function pinnedLabel(h)
{
   if (h < 24)
   {
      return "Pinned today";
   }
   if (h < 48)
   {
      return "Pinned yesterday";
   }
   return "Pinned " + Math.floor(h / 24) + " days ago";
}

function fadesLabel(h)
{
   var left = data.expiryDays - Math.floor(h / 24);
   return left <= 1 ? "Fades soon" : "Fades in " + left + " days";
}

// A note's first line, cut to fit a row
function headline(text)
{
   var t = String(text);
   var nl = t.indexOf("\n");
   if (nl >= 0)
   {
      t = t.substr(0, nl);
   }
   return t.length > 70 ? t.substr(0, 67) + "..." : t;
}

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
   c.idx = actions.length;
   actions.push(c);
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
      if (this.disabled != true)
      {
         this.onPick();
      }
   };
   return c;
}

function disable(c, why)
{
   c.disabled = true;
   c.rest = 50;
   c._alpha = 50;
   c.label.textColor = C_DISABLED;
   if (why != undefined)
   {
      c.label.text = why;
   }
}

function setFocus(i)
{
   if (i == focus || i < 0 || i >= actions.length)
   {
      return;
   }
   if (focus >= 0 && focus < actions.length)
   {
      actions[focus]._alpha = actions[focus].rest;
   }
   focus = i;
   actions[focus]._alpha = A_FOCUS;
   dboSound("UIMenuFocus");
}

function clear(name, depth)
{
   if (panel[name] != undefined)
   {
      panel[name].removeMovieClip();
   }
   return panel.createEmptyMovieClip(name, depth);
}

function drawTabs()
{
   var h = clear("head", 20);
   var title = dboText(h, "title", 1, PAD, 18, PANEL_W - PAD * 2, 40, dboFmt(F_PLAIN, 30, C_TEXT, 1.0), false);
   title.text = String(data.boardName) + " Notice Board";
   var x = PAD;
   for (var k = 0; k < data.tabs.length; k++)
   {
      var t = data.tabs[k];
      var b = button(h, "tab" + k, 30 + k, x, 70, 170, t.label + "  " + notesOf(t.id).length, F_BOLD, 20, t.id == tabId ? A_FOCUS : A_ROW_REST, function()
      {
         dboSound("UIMenuPrevNext");
         tabId = this.tabKey;
         page = 0;
         reading = -1;
         draw();
      });
      b.tabKey = t.id;
      x += 176;
   }
   for (var j = 0; j < HANDOVERS.length; j++)
   {
      var hb = button(h, "ho" + j, 50 + j, x, 70, 112, HANDOVERS[j][0], F_MEDIUM, 18, A_ROW_REST, function()
      {
         handOver(this.key, this.arg);
      });
      hb.key = HANDOVERS[j][1];
      hb.arg = HANDOVERS[j][2];
      x += 116;
   }
   dboRule(h, PAD, 112, PANEL_W - PAD * 2);
}

function drawList()
{
   var l = clear("list", 40);
   var list = notesOf(currentTab().id);
   var pages = Math.max(1, Math.ceil(list.length / MAX_ROWS));
   if (page >= pages)
   {
      page = pages - 1;
   }
   if (!list.length)
   {
      var e = dboText(l, "empty", 1, PAD, LIST_TOP + 20, PANEL_W - PAD * 2, 30, dboFmt(F_MEDIUM, 20, C_SECOND, 0.8, "center"), false);
      e.text = currentTab().id == "hold" ? "The " + data.boardName + " officials have posted nothing yet." : "Nothing is pinned here yet.";
   }
   for (var i = 0; i < MAX_ROWS && page * MAX_ROWS + i < list.length; i++)
   {
      var n = list[page * MAX_ROWS + i];
      var c = l.createEmptyMovieClip("r" + i, 10 + i);
      c._x = PAD;
      c._y = LIST_TOP + i * ROW_H;
      dboBox(c, 0, 0, PANEL_W - PAD * 2, ROW_H - 4, 0x000000, 1);
      var num = dboText(c, "num", 1, 0, 4, 22, 26, dboFmt(F_BOLD, 18, C_SECOND, 0), false);
      num.text = String(i + 1);
      var t = dboText(c, "label", 2, 26, 0, PANEL_W - PAD * 2 - 26, 28, dboFmt(F_MEDIUM, 22, C_TEXT, 0.8), false);
      t.text = headline(n.text);
      var s = dboText(c, "sub", 3, 26, 24, PANEL_W - PAD * 2 - 26, 22, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8), false);
      s.text = String(n.author) + "  -  " + pinnedLabel(n.ageHours);
      c.rest = A_ROW_REST;
      c._alpha = A_ROW_REST;
      c.noteId = n.id;
      c.rowIndex = i;
      c.idx = actions.length;
      actions.push(c);
      c.onPick = function()
      {
         dboSound("UIMenuOK");
         reading = this.noteId;
         draw();
      };
      c.onRollOver = function()
      {
         setFocus(this.idx);
      };
      c.onRelease = function()
      {
         this.onPick();
      };
   }
   return pages;
}

function drawRead()
{
   var n = noteById(reading);
   var l = clear("list", 40);
   if (n == null)
   {
      reading = -1;
      return drawList();
   }
   var txt = dboText(l, "text", 1, PAD + 20, LIST_TOP, PANEL_W - PAD * 2 - 40, 270, dboFmt(F_PLAIN, 22, C_TEXT, 1.0), true);
   txt.text = String(n.text);
   var by = dboText(l, "author", 2, PAD + 20, LIST_TOP + 280, PANEL_W - PAD * 2 - 40, 28, dboFmt(F_MEDIUM, 20, C_SECOND, 0.8), false);
   by.text = "- " + n.author;
   var age = dboText(l, "age", 3, PAD + 20, LIST_TOP + 308, PANEL_W - PAD * 2 - 40, 24, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8), false);
   age.text = pinnedLabel(n.ageHours) + "  -  " + fadesLabel(n.ageHours);
   var bx = PAD + 20;
   if (n.canRemove == true)
   {
      var rm = button(l, "remove", 20, bx, LIST_TOP + 345, 150, "Take down", F_MEDIUM, 20, A_BUTTON_REST, function()
      {
         dboSound("UIMenuOK");
         dboSend(ev("remove"), [this.noteId]);
         reading = -1;
         draw();
      });
      rm.noteId = n.id;
      rm.label.textColor = C_RED;
      bx += 160;
   }
   button(l, "back", 21, bx, LIST_TOP + 345, 120, "Back", F_MEDIUM, 20, A_BUTTON_REST, function()
   {
      dboSound("UIMenuCancel");
      reading = -1;
      draw();
   });
   return 1;
}

function drawFoot(pages)
{
   var f = clear("foot", 60);
   var y = PANEL_H - 90;
   dboRule(f, PAD, y - 8, PANEL_W - PAD * 2);
   var t = currentTab();
   var cost = Number(t.cost) || 0;
   var hint = dboText(f, "hint", 1, PAD, y, PANEL_W - PAD * 2, 24, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8), false);
   hint.text = t.id == "hold" ? "Hold Notices are posted by the Jarl, Steward and Lord Commander. Notices fade after " + data.expiryDays + " days."
      : "A notice costs " + cost + " gold and fades after " + data.expiryDays + " days. You carry " + data.gold + " gold.";
   if (pages > 1 && reading < 0)
   {
      var pt = dboText(f, "page", 2, PANEL_W - PAD - 160, y, 160, 24, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8, "right"), false);
      pt.text = "Page " + (page + 1) + " of " + pages + "  (Left / Right)";
   }
   var by = y + 32;
   var write = button(f, "write", 10, PAD, by, 200, "Write a notice...", F_MEDIUM, 20, A_BUTTON_REST, function()
   {
      // typed text: the browser composer for this tab, back to this board after posting (client router, native:handoff)
      dboSound("UIMenuOK");
      dboSend("native:handoff", ["bountyBoard", "compose:" + currentTab().id]);
   });
   var full = data.notes.length >= data.maxNotes;
   if (t.canPost == false)
   {
      disable(write, "Officials only");
   }
   else if (full)
   {
      disable(write, "The board is full");
   }
   else if (data.gold < cost)
   {
      disable(write, "Not enough gold");
   }
   var x = PAD + 210;
   for (var i = 0; i < FOOT.length; i++)
   {
      var b = button(f, "f" + i, 20 + i, x, by, 150, FOOT[i][0], F_MEDIUM, 20, A_BUTTON_REST, function()
      {
         handOver(this.key, this.arg);
      });
      b.key = FOOT[i][1];
      b.arg = FOOT[i][2];
      x += 156;
   }
   button(f, "close", 30, PANEL_W - PAD - 100, by, 100, "Close", F_MEDIUM, 20, A_BUTTON_REST, function()
   {
      closeBoard();
   });
}

function draw()
{
   actions = [];
   focus = -1;
   drawTabs();
   var pages = reading >= 0 ? drawRead() : drawList();
   drawFoot(pages);
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   panel._x = (STAGE_W - PANEL_W) / 2;
   panel._y = 60;
   var bg = panel.createEmptyMovieClip("bg", 1);
   dboBox(bg, 0, 0, PANEL_W, PANEL_H, 0x000000, 80);
   dboFadeIn(panel);
}

_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || !(p.notes instanceof Array))
   {
      dboLog("board: unreadable payload");
      return;
   }
   if (!(p.tabs instanceof Array) || !p.tabs.length)
   {
      p.tabs = [{id: "hold", label: "Hold Notices", cost: 0, canPost: false}, {id: "shop", label: "Shop Ads", cost: 30, canPost: true}, {id: "citizen", label: "Citizen Notices", cost: 30, canPost: true}];
   }
   var first = data == null;
   data = p;
   if (first || tabId == "")
   {
      tabId = data.tabs[0].id;
   }
   if (reading >= 0 && noteById(reading) == null)
   {
      reading = -1;
   }
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = Key.getCode();
   dboLog("board key " + code);
   if (code == 27 || code == 9)
   {
      if (reading >= 0)
      {
         dboSound("UIMenuCancel");
         reading = -1;
         draw();
         return;
      }
      closeBoard();
      return;
   }
   if (data == null)
   {
      return;
   }
   if (code >= 49 && code <= 56 && reading < 0)
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
   else if (code == 13 && focus >= 0 && actions[focus].disabled != true)
   {
      actions[focus].onPick();
   }
   else if (code == 37 && reading < 0 && page > 0)
   {
      dboSound("UIMenuPrevNext");
      page--;
      draw();
   }
   else if (code == 39 && reading < 0)
   {
      dboSound("UIMenuPrevNext");
      page++;
      draw();
   }
};
Key.addListener(keys);

_root.onEnterFrame = function()
{
   if (data == null && getTimer() - builtAt >= NO_DATA_CLOSE_MS)
   {
      dboLog("board: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
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
