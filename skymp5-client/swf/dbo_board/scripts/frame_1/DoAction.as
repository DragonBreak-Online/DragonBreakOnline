// The notice board as a native panel (client bountyBoardService's widget, the same object the browser board gets).
// Events go out as the widget's own keys (events.post/remove/close) and dbo:* hand-overs; the client router replays them as
// the browser would. "Write a notice..." types in the panel (dboInput); "Type in the browser instead" hands the composer
// to the browser (native:handoff), and is all there is on a game that cannot take typed input.

var DBO_SWF_VERSION = "board-2";
var STAGE_W = 1280;
var PANEL_W = 920;
var PANEL_H = 640;
var PAD = 28;
var ROW_H = 46;
var LIST_TOP = 162;
var MAX_ROWS = 8;
var FOOT_Y = PANEL_H - 90;
var NO_DATA_CLOSE_MS = 8000;
var POST_WAIT_MS = 6000;
var C_RED = 0xB23A3A;
var HANDOVERS = [["Letters", "dbo:pigeonOpen", "letters"], ["Citizenship", "dbo:citizenOpen", "citizenship"], ["Voting", "dbo:citizenOpen", "voting"]];
var FOOT = [["Send a pigeon", "dbo:pigeonOpen", "send"], ["Supply orders", "dbo:pigeonOpen", "supply"], ["Couriers", "dbo:pigeonOpen", "courier"]];

var panel;
var data = null;
var tabId = "";
var page = 0;
var reading = -1;
// composing: the tab a notice is being written for ("" when not); postedAt: when the post went, until the board shows it
var composing = "";
var draft = "";
var postedAt = 0;
var builtAt = getTimer();

function ev(k)
{
   return data.events != undefined && data.events[k] != undefined ? String(data.events[k]) : "bountyBoard:" + k;
}

function closeBoard()
{
   dboInputEnd();
   dboSound("UIMenuCancel");
   dboSend(ev("close"), []);
   dboClose();
}

// A hand-over to another panel (pigeon coop, citizenship): its event, then this board closes as the browser board does
function handOver(key, arg)
{
   dboInputEnd();
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

function drawTabs()
{
   var h = clear("head", 20);
   var title = dboText(h, "title", 1, PAD, 18, PANEL_W - PAD * 2, 40, dboFmt(F_PLAIN, 30, C_TEXT, 1.0), false);
   title.text = String(data.boardName) + " Notice Board";
   // The board's tabs, each as wide as its label, and under them the other panels it opens, in the same weight
   var x = PAD;
   for (var k = 0; k < data.tabs.length; k++)
   {
      var t = data.tabs[k];
      var label = t.label + "  " + notesOf(t.id).length;
      var b = button(h, "tab" + k, 30 + k, x, 62, tabWidth(label), label, F_BOLD, 20, t.id == tabId ? A_FOCUS : A_ROW_REST, function()
      {
         dboSound("UIMenuPrevNext");
         tabId = this.tabKey;
         page = 0;
         reading = -1;
         endCompose();
         draw();
      });
      b.tabKey = t.id;
      x += tabWidth(label) + 8;
   }
   x = PAD;
   for (var j = 0; j < HANDOVERS.length; j++)
   {
      var hb = button(h, "ho" + j, 50 + j, x, 98, tabWidth(HANDOVERS[j][0]), HANDOVERS[j][0], F_BOLD, 20, A_ROW_REST, function()
      {
         handOver(this.key, this.arg);
      });
      hb.key = HANDOVERS[j][1];
      hb.arg = HANDOVERS[j][2];
      x += tabWidth(HANDOVERS[j][0]) + 8;
   }
   dboRule(h, PAD, 138, PANEL_W - PAD * 2);
}

function tabWidth(label)
{
   return String(label).length * 11 + 28;
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
   // The note as tall as its text (the engine measures it; an estimate stands in where it cannot), the signature and the
   // actions right under it, all above the footer's rule
   var w = PANEL_W - PAD * 2 - 40;
   var maxH = FOOT_Y - 8 - 110 - LIST_TOP;
   var txt = dboText(l, "text", 1, PAD + 20, LIST_TOP, w, maxH, dboFmt(F_PLAIN, 22, C_TEXT, 1.0), true);
   txt.text = String(n.text);
   var th = Math.min(maxH, txt.textHeight > 0 ? txt.textHeight + 8 : estimateHeight(String(n.text), 22, w));
   txt._height = th;
   var y = LIST_TOP + th + 10;
   var by = dboText(l, "author", 2, PAD + 20, y, w, 28, dboFmt(F_MEDIUM, 20, C_SECOND, 0.8), false);
   by.text = "- " + n.author;
   var age = dboText(l, "age", 3, PAD + 20, y + 28, w, 24, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8), false);
   age.text = pinnedLabel(n.ageHours) + "  -  " + fadesLabel(n.ageHours);
   var ay = y + 64;
   var bx = PAD + 20;
   if (n.canRemove == true)
   {
      var rm = button(l, "remove", 20, bx, ay, 150, "Take down", F_MEDIUM, 20, A_BUTTON_REST, function()
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
   button(l, "back", 21, bx, ay, 120, "Back", F_MEDIUM, 20, A_BUTTON_REST, function()
   {
      dboSound("UIMenuCancel");
      reading = -1;
      draw();
   });
   return 1;
}

// Wrapped text's height from its length, where the engine cannot measure (characters per line at this size)
function estimateHeight(text, size, w)
{
   var per = Math.max(10, Math.floor(w / (size * 0.52)));
   var parts = text.split("\n");
   var lines = 0;
   for (var i = 0; i < parts.length; i++)
   {
      lines += Math.max(1, Math.ceil(parts[i].length / per));
   }
   return lines * (size + 6) + 8;
}

// The composer, in the panel: a box to type in, its count and price, Post and Cancel, and the browser as the fallback
function drawCompose()
{
   var l = clear("list", 40);
   var t = currentTab();
   var cost = Number(t.cost) || 0;
   var w = PANEL_W - PAD * 2;
   var head = dboText(l, "head", 1, PAD, LIST_TOP, w, 30, dboFmt(F_BOLD, 22, C_TEXT, 0.8), false);
   head.text = "Pin a notice  -  " + t.label;
   var max = Number(data.maxTextLen) || 500;
   var box = dboInput(l, "box", 2, PAD, LIST_TOP + 38, w, 230, dboFmt(F_PLAIN, 22, C_TEXT, 0.5), max, true);
   box.text = draft;
   var count = dboText(l, "count", 3, PAD, LIST_TOP + 274, w, 24, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8), false);
   var showCount = function()
   {
      count.text = box.text.length + " / " + max + (cost ? "  -  " + cost + " gold" : "  -  free") + (postedAt ? "  -  posting..." : "");
   };
   box.onChanged = function()
   {
      draft = box.text;
      showCount();
   };
   showCount();
   var post = button(l, "post", 10, PAD, LIST_TOP + 306, 200, cost ? "Post for " + cost + " gold" : "Post", F_MEDIUM, 20, A_BUTTON_REST, function()
   {
      var text = trimText(draft);
      if (text == "" || postedAt)
      {
         dboSound("UIMenuCancel");
         return;
      }
      dboSound("UIMenuOK");
      postedAt = getTimer();
      dboSend(ev("post"), [composing, text]);
      showCount();
   });
   button(l, "cancel", 11, PAD + 210, LIST_TOP + 306, 120, "Cancel", F_MEDIUM, 20, A_BUTTON_REST, function()
   {
      dboSound("UIMenuCancel");
      endCompose();
      draft = "";
      draw();
   });
   button(l, "browser", 12, PANEL_W - PAD - 290, LIST_TOP + 306, 290, "Type in the browser instead", F_MEDIUM, 18, A_ROW_REST, function()
   {
      toBrowser();
   });
   return 1;
}

function trimText(s)
{
   var t = String(s);
   var a = 0;
   var b = t.length;
   while (a < b && " \r\n\t".indexOf(t.charAt(a)) >= 0)
   {
      a++;
   }
   while (b > a && " \r\n\t".indexOf(t.charAt(b - 1)) >= 0)
   {
      b--;
   }
   return t.substring(a, b);
}

function startCompose()
{
   dboSound("UIMenuOK");
   if (!dboCanType())
   {
      composing = currentTab().id;
      toBrowser();
      return;
   }
   composing = currentTab().id;
   reading = -1;
   postedAt = 0;
   draw();
}

function endCompose()
{
   if (composing != "")
   {
      dboInputEnd();
   }
   composing = "";
   postedAt = 0;
}

// The browser composer for this tab, back to the native board after posting (client router, native:handoff)
function toBrowser()
{
   var tab = composing != "" ? composing : currentTab().id;
   endCompose();
   dboSend("native:handoff", ["bountyBoard", "compose:" + tab]);
}

function drawFoot(pages)
{
   var f = clear("foot", 60);
   var y = FOOT_Y;
   dboRule(f, PAD, y - 8, PANEL_W - PAD * 2);
   var t = currentTab();
   var cost = Number(t.cost) || 0;
   var hint = dboText(f, "hint", 1, PAD, y, PANEL_W - PAD * 2, 24, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8), false);
   // the tab's footnote only over its list: the reader and the composer have the room to themselves
   hint.text = reading >= 0 || composing != "" ? "" : t.id == "hold" ? "Hold Notices are posted by the Jarl, Steward and Lord Commander. Notices fade after " + data.expiryDays + " days."
      : "A notice costs " + cost + " gold and fades after " + data.expiryDays + " days. You carry " + data.gold + " gold.";
   if (pages > 1 && reading < 0)
   {
      var pt = dboText(f, "page", 2, PANEL_W - PAD - 160, y, 160, 24, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8, "right"), false);
      pt.text = "Page " + (page + 1) + " of " + pages + "  (Left / Right)";
   }
   var by = y + 32;
   var write = button(f, "write", 10, PAD, by, 200, "Write a notice...", F_MEDIUM, 20, A_BUTTON_REST, function()
   {
      startCompose();
   });
   var full = data.notes.length >= data.maxNotes;
   if (composing != "")
   {
      disable(write);
   }
   else if (t.canPost == false)
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
   var pages = composing != "" ? drawCompose() : reading >= 0 ? drawRead() : drawList();
   drawFoot(pages);
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   dboFit(panel, PANEL_W, PANEL_H);
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
   // our post is on the board: the composer has done its work
   if (composing != "" && postedAt && posted())
   {
      endCompose();
      draft = "";
   }
   draw();
};

function posted()
{
   var text = trimText(draft);
   var list = notesOf(composing);
   for (var i = 0; i < list.length; i++)
   {
      if (trimText(list[i].text) == text)
      {
         return true;
      }
   }
   return false;
}

var keys = {};
keys.onKeyDown = function()
{
   var code = dboKey();
   dboLog("board key " + code);
   if (code == 27 && composing != "")
   {
      dboSound("UIMenuCancel");
      endCompose();
      draw();
      return;
   }
   // every other key is typing while the composer is open
   if (composing != "")
   {
      return;
   }
   if (code == 27)
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
   // a post the server refused never shows on the board: after a while the composer may post again
   if (postedAt && getTimer() - postedAt >= POST_WAIT_MS)
   {
      postedAt = 0;
      if (composing != "")
      {
         draw();
      }
   }
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
