// The deity picker as a native panel: a port of skymp5-front features/deityPicker, same messages and words.
// The server (prayer.js) decides whether a choice is allowed and answers every attempt with a fresh payload and a notice.
// 35 gods do not fit nine rows, so the browser's three groups are tabs (Left/Right), each paged by nine.
// Turning from a god starts the cooldown, so it asks once more; the first pick goes straight through, as in the browser.

var DBO_SWF_VERSION = "deity-1";
var STAGE_W = 1280;
var PANEL_W = 1000;
var PANEL_H = 640;
var PAD = 28;
var ROW_H = 34;
var MAX_ROWS = 9;
var LIST_W = 400;
var LIST_TOP = 186;
var DETAIL_X = 460;
var NO_DATA_CLOSE_MS = 8000;
var C_DAEDRIC = 0xC9A86A;
var C_RED = 0xB23A3A;
var C_HELD = 0x8FBF7F;
var GROUPS = [["divine", "The Divines"], ["daedra", "The Princes"], ["faith", "Other Faiths"]];

var panel;
var data = null;
var nonce = "";
var tab = 0;
var page = 0;
var selected = "";
var confirming = false;
var builtAt = getTimer();

function choicesOf(g)
{
   var out = [];
   var c = data.choices;
   for (var i = 0; i < c.length; i++)
   {
      var k = String(c[i].kind);
      var other = k != "divine" && k != "daedra";
      if (k == GROUPS[g][0] || (g == 2 && other))
      {
         out.push(c[i]);
      }
   }
   return out;
}

function byId(id)
{
   for (var i = 0; i < data.choices.length; i++)
   {
      if (data.choices[i].id == id)
      {
         return data.choices[i];
      }
   }
   return null;
}

function shownGod()
{
   return byId(selected != "" ? selected : data.current);
}

// The tab and page that hold a god, so the panel opens on the worshipper's own
function seek(id)
{
   for (var g = 0; g < GROUPS.length; g++)
   {
      var list = choicesOf(g);
      for (var i = 0; i < list.length; i++)
      {
         if (list[i].id == id)
         {
            tab = g;
            page = Math.floor(i / MAX_ROWS);
            return;
         }
      }
   }
}

function closePicker()
{
   dboSound("UIMenuCancel");
   dboSend("dbo:deityClose", [nonce]);
   dboClose();
}

function take(g)
{
   dboSound("UIMenuOK");
   confirming = false;
   dboSend("dbo:deityChoose", [nonce, g.id]);
   draw();
}

function plural(n, one, many)
{
   return n + " " + (n == 1 ? one : many);
}

function subText()
{
   if (data.first == true)
   {
      return "One god, and only their shrines will hear you. You may turn to another later, but not often.";
   }
   return data.daysLeft > 0 ? "You may turn to another god in " + plural(data.daysLeft, "day", "days") + "." : "You may turn to another god.";
}

function marksOf(g)
{
   var m = [];
   if (g.id == data.current)
   {
      m.push("yours");
   }
   if (g.reachable != true)
   {
      m.push("no shrine");
   }
   if (g.lawful == false)
   {
      m.push("unlawful");
   }
   return m.join("  -  ");
}

function selectRow(id)
{
   dboSound("UIMenuOK");
   selected = id;
   confirming = false;
   draw();
}

function drawHead()
{
   var h = clear("head", 20);
   var title = dboText(h, "title", 1, PAD, 18, PANEL_W - PAD * 2, 40, dboFmt(F_PLAIN, 30, C_TEXT, 1.0), false);
   title.text = data.first == true ? "Choose your god" : "Your faith";
   var sub = dboText(h, "sub", 2, PAD, 58, PANEL_W - PAD * 2, 26, dboFmt(F_MEDIUM, 18, C_SECOND, 0.8), false);
   sub.text = subText();
   if (data.notice != undefined && data.notice != "")
   {
      var n = dboText(h, "notice", 3, PAD, 84, PANEL_W - PAD * 2, 50, dboFmt(F_MEDIUM, 18, C_TEXT, 0.8), true);
      n.text = String(data.notice);
      n.textColor = data.noticeKind == "taken" ? C_HELD : data.noticeKind == "refused" ? C_RED : C_TEXT;
   }
   var x = PAD;
   for (var g = 0; g < GROUPS.length; g++)
   {
      var count = choicesOf(g).length;
      if (!count)
      {
         continue;
      }
      var b = button(h, "tab" + g, 30 + g, x, 138, 180, GROUPS[g][1] + "  " + count, F_BOLD, 20, g == tab ? A_FOCUS : A_ROW_REST, function()
      {
         dboSound("UIMenuPrevNext");
         tab = this.group;
         page = 0;
         draw();
      });
      b.group = g;
      x += 190;
   }
   dboRule(h, PAD, 174, PANEL_W - PAD * 2);
}

function drawList()
{
   var l = clear("list", 40);
   var list = choicesOf(tab);
   var pages = Math.max(1, Math.ceil(list.length / MAX_ROWS));
   if (page >= pages)
   {
      page = pages - 1;
   }
   if (page < 0)
   {
      page = 0;
   }
   var shown = shownGod();
   for (var i = 0; i < MAX_ROWS && page * MAX_ROWS + i < list.length; i++)
   {
      var g = list[page * MAX_ROWS + i];
      var on = shown != null && shown.id == g.id;
      var c = l.createEmptyMovieClip("r" + i, 10 + i);
      c._x = PAD;
      c._y = LIST_TOP + i * ROW_H;
      dboBox(c, 0, 0, LIST_W, ROW_H - 4, 0x000000, 1);
      var kt = dboText(c, "key", 1, 0, 3, 24, ROW_H - 6, dboFmt(F_BOLD, 20, C_SECOND, 0), false);
      kt.text = String(i + 1);
      var nt = dboText(c, "label", 2, 28, 2, LIST_W - 28, ROW_H - 4, dboFmt(F_MEDIUM, 22, C_TEXT, 0.8), false);
      nt.text = String(g.name);
      var mt = dboText(c, "marks", 3, 28, 6, LIST_W - 32, ROW_H - 8, dboFmt(F_MEDIUM, 14, C_SECOND, 0.8, "right"), false);
      mt.text = marksOf(g);
      if (on)
      {
         dboRule(c, 28, ROW_H - 5, LIST_W - 28);
      }
      c.rest = on ? A_FOCUS : A_ROW_REST;
      c._alpha = c.rest;
      c.godId = g.id;
      c.rowIndex = i;
      c.idx = actions.length;
      actions.push(c);
      c.onPick = function()
      {
         selectRow(this.godId);
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
   }
   if (pages > 1)
   {
      var py = LIST_TOP + MAX_ROWS * ROW_H + 6;
      var up = button(l, "up", 30, PAD, py, 130, "Up the list", F_MEDIUM, 16, A_BUTTON_REST, function()
      {
         turnPage(-1);
      });
      var dn = button(l, "down", 31, PAD + 140, py, 130, "Down the list", F_MEDIUM, 16, A_BUTTON_REST, function()
      {
         turnPage(1);
      });
      if (page == 0)
      {
         disable(up);
      }
      if (page >= pages - 1)
      {
         disable(dn);
      }
      var pt = dboText(l, "page", 32, PAD + 280, py + 2, LIST_W - 280, 24, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8, "right"), false);
      pt.text = "Page " + (page + 1) + " of " + pages;
   }
}

function turnPage(d)
{
   var pages = Math.max(1, Math.ceil(choicesOf(tab).length / MAX_ROWS));
   if (page + d < 0 || page + d >= pages)
   {
      return;
   }
   dboSound("UIMenuPrevNext");
   page += d;
   draw();
}

function fact(c, name, depth, y, label, text, color)
{
   var w = PANEL_W - PAD - DETAIL_X;
   var lt = dboText(c, name + "Label", depth, DETAIL_X, y, 110, 24, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8), false);
   lt.text = label;
   var vt = dboText(c, name, depth + 1, DETAIL_X + 116, y, w - 116, 60, dboFmt(F_MEDIUM, 18, color, 0.8), true);
   vt.text = text;
   return y + Math.max(26, Math.ceil(text.length / 44) * 24 + 4);
}

function drawDetail()
{
   var d = clear("detail", 50);
   var g = shownGod();
   var w = PANEL_W - PAD - DETAIL_X;
   if (g == null)
   {
      var e = dboText(d, "empty", 1, DETAIL_X, LIST_TOP + 10, w, 60, dboFmt(F_MEDIUM, 20, C_SECOND, 0.8), true);
      e.text = "Choose a name to hear what they ask and what they give.";
      return;
   }
   var daedric = g.kind == "daedra";
   var nt = dboText(d, "name", 1, DETAIL_X, LIST_TOP - 4, w, 40, dboFmt(F_PLAIN, 28, C_TEXT, 1.0), false);
   nt.text = String(g.name);
   nt.textColor = daedric ? C_DAEDRIC : C_TEXT;
   var y = LIST_TOP + 36;
   if (g.aspectOf != undefined && g.aspectOf != "")
   {
      var par = byId(g.aspectOf);
      var at = dboText(d, "aspect", 2, DETAIL_X, y, w, 48, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8), true);
      at.text = "An aspect of " + (par != null ? par.name : g.aspectOf) + ", not a separate god - either shrine will hear you.";
      y += 46;
   }
   var sp = dboText(d, "sphere", 3, DETAIL_X, y, w, 96, dboFmt(F_MEDIUM, 18, C_SECOND, 0.8), true);
   sp.text = g.sphere == undefined ? "" : String(g.sphere);
   y += Math.max(26, Math.ceil(sp.text.length / 48) * 24 + 8);
   dboRule(d, DETAIL_X, y, w);
   y += 10;
   y = fact(d, "boon", 10, y, "Boon", g.boon != undefined && g.boon != "" ? String(g.boon) : "None recorded.", C_TEXT);
   y = fact(d, "shrines", 12, y, "Shrines", g.reachable == true ? "There are shrines you can reach." : "No shrine you can reach yet. You could still take them, but there would be nowhere to pray.", C_TEXT);
   if (g.lawful == false)
   {
      fact(d, "law", 14, y, "The law", "Proscribed in the Empire. Bruma is Imperial, and nobody will stop you.", C_RED);
   }
}

function drawFoot()
{
   var f = clear("foot", 60);
   var y = PANEL_H - 60;
   dboRule(f, PAD, y - 12, PANEL_W - PAD * 2);
   var g = shownGod();
   var current = byId(data.current);
   var isCurrent = g != null && g.id == data.current;
   var canTake = data.canChoose == true && g != null && !isCurrent;
   if (confirming && canTake && current != null)
   {
      var q = dboText(f, "ask", 1, PAD, y - 40, PANEL_W - PAD * 2, 26, dboFmt(F_MEDIUM, 18, C_TEXT, 0.8), false);
      q.text = "Turn from " + current.name + " to " + g.name + "? You keep a new god at least " + plural(Number(data.cooldownDays) || 1, "day", "days") + ".";
      var go = button(f, "go", 10, PAD, y, 300, "Turn to " + g.name, F_MEDIUM, 20, A_BUTTON_REST, function()
      {
         take(shownGod());
      });
      go.label.textColor = C_RED;
      button(f, "back", 11, PAD + 310, y, 140, "Back", F_MEDIUM, 20, A_BUTTON_REST, function()
      {
         dboSound("UIMenuCancel");
         confirming = false;
         draw();
      });
      return;
   }
   var label = isCurrent ? "Already yours" : (current != null ? "Turn to " : "Take ") + (g != null ? g.name : "");
   var t = button(f, "take", 10, PAD, y, 300, label, F_MEDIUM, 20, A_BUTTON_REST, function()
   {
      var s = shownGod();
      if (byId(data.current) != null)
      {
         dboSound("UIMenuOK");
         confirming = true;
         draw();
         return;
      }
      take(s);
   });
   if (!canTake)
   {
      disable(t);
   }
   button(f, "close", 12, PANEL_W - PAD - 140, y, 140, data.first == true ? "Not yet" : "Close", F_MEDIUM, 20, A_BUTTON_REST, function()
   {
      closePicker();
   });
   var hint = dboText(f, "hint", 13, PAD + 310, y + 4, PANEL_W - PAD * 2 - 460, 24, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8, "center"), false);
   hint.text = "Left / Right: groups.  1-9: a god.";
}

function draw()
{
   actions = [];
   focus = -1;
   // the rows first, so Up/Down start on the gods; the tabs come last in the walk
   drawList();
   drawDetail();
   drawFoot();
   drawHead();
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   panel._x = (STAGE_W - PANEL_W) / 2;
   panel._y = 40;
   var bg = panel.createEmptyMovieClip("bg", 1);
   dboBox(bg, 0, 0, PANEL_W, PANEL_H, 0x000000, 80);
   dboFadeIn(panel);
}

// Every answer comes with a new nonce: the selection clears and follows what the server now says is current
_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || p.nonce == undefined || !(p.choices instanceof Array))
   {
      dboLog("deity: unreadable payload");
      return;
   }
   var first = data == null;
   var fresh = String(p.nonce) != nonce;
   data = p;
   nonce = String(p.nonce);
   if (fresh)
   {
      selected = "";
      confirming = false;
   }
   if (first)
   {
      tab = 0;
      page = 0;
      seek(String(p.current));
   }
   if (!choicesOf(tab).length)
   {
      for (var g = 0; g < GROUPS.length; g++)
      {
         if (choicesOf(g).length)
         {
            tab = g;
            break;
         }
      }
   }
   draw();
};

function switchTab(d)
{
   var g = tab;
   for (var k = 0; k < GROUPS.length; k++)
   {
      g = (g + d + GROUPS.length) % GROUPS.length;
      if (choicesOf(g).length)
      {
         break;
      }
   }
   if (g == tab)
   {
      return;
   }
   dboSound("UIMenuPrevNext");
   tab = g;
   page = 0;
   draw();
}

var keys = {};
keys.onKeyDown = function()
{
   var code = Key.getCode();
   dboLog("deity key " + code);
   if (code == 27 || code == 9)
   {
      if (confirming)
      {
         dboSound("UIMenuCancel");
         confirming = false;
         draw();
         return;
      }
      closePicker();
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
   else if (code == 37 || code == 65)
   {
      switchTab(-1);
   }
   else if (code == 39 || code == 68)
   {
      switchTab(1);
   }
   else if (code == 33)
   {
      turnPage(-1);
   }
   else if (code == 34)
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
      dboLog("deity: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
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
