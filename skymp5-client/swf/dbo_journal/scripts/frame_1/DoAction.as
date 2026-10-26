// The Character Journal (F3, widget 50) as a native panel, drawn from the hub payload journal.js sends. The server routes
// here only the tabs this swf draws (the client's native:journalTab:<id> caps); Profile, Settings and the rest are the
// browser journal's, so a click on one of them asks the server, which moves the journal there.
// A tab's typed input (a form, a note) goes to the browser journal for that tab: journalTab [nonce, tab, focus, "browser"].

var DBO_SWF_VERSION = "journal-1";
var STAGE_W = 1280;
var PANEL_W = 1180;
var PANEL_H = 664;
var PAD = 28;
var BODY_TOP = 152;
var NO_DATA_CLOSE_MS = 8000;
var BUSY_MS = 8000;
var C_RED = 0xB23A3A;
var SHELL_KEYS = {type: 1, id: 1, nonce: 1, hub: 1, tabs: 1, tab: 1, clock: 1, head: 1, result: 1, resultKind: 1, readOnly: 1, subject: 1, opened: 1, browser: 1};

var panel;
var data = null;
var tab = "";
var cache = {};
var cacheOf = "";
var busy = false;
var busyAt = 0;
var pages = {};
var asking = null;
var builtAt = getTimer();

function send(key, args)
{
   dboSend(key, args);
}

// A tab's action: dbo:<event> with the journal nonce first; the answer redraws the journal with its result in the footer
function act(key, args)
{
   if (busy || data.readOnly == 1)
   {
      return;
   }
   busy = true;
   busyAt = getTimer();
   dboSound("UIMenuOK");
   send(key.indexOf("dbo:") == 0 ? key : "dbo:" + key, [data.nonce].concat(args == undefined ? [] : args));
   showResult();
}

function showResult()
{
   var r = panel.foot.result;
   r.text = busy ? "..." : data.result != undefined ? String(data.result) : "";
   r.textColor = !busy && data.resultKind == "refused" ? C_RED : C_TEXT;
}

function openTab(id, focusArg)
{
   if (id != tab)
   {
      dboSound("UIMenuPrevNext");
   }
   tab = id;
   asking = null;
   send("dbo:journalTab", focusArg == undefined ? [data.nonce, id] : [data.nonce, id, focusArg]);
   draw();
}

// The browser journal for this tab's typed input; the server brings the journal back here once the action is answered
function toBrowser(focusArg)
{
   dboSound("UIMenuOK");
   send("dbo:journalTab", [data.nonce, tab, focusArg == undefined ? null : focusArg, "browser"]);
}

// A question with Yes and No in place of the tab, as the browser's Ask does
function ask(question, yesLabel, onYes, danger)
{
   dboSound("UIMenuOK");
   asking = {q: question, yes: yesLabel, fn: onYes, danger: danger == true};
   draw();
}

function closeJournal()
{
   dboSound("UIMenuCancel");
   send("dbo:journalClose", [data != null ? data.nonce : ""]);
   send("close", []);
   dboClose();
}

var ctx = {act: act, openTab: openTab, browser: toBrowser, ask: ask};

function drawHead()
{
   var h = clear("head", 20);
   var hd = data.head != undefined && data.head != null ? data.head : {name: "", title: "", race: ""};
   var n = dboText(h, "name", 1, PAD, 14, 700, 40, dboFmt(F_PLAIN, 30, C_TEXT, 1.0), false);
   n.text = String(hd.name);
   var s = dboText(h, "subtitle", 2, PAD, 50, 700, 24, dboFmt(F_MEDIUM, 17, C_SECOND, 0.8), false);
   s.text = String(hd.title) + (hd.race != undefined && hd.race != "" ? "  -  " + hd.race : "");
   var c = data.clock;
   var ck = dboText(h, "clock", 3, PANEL_W - PAD - 420, 18, 420, 60, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8, "right"), true);
   ck.text = c != undefined && c != null ? String(c.date) + "\n" + String(c.time) + (c.moons != undefined && c.moons != "" ? "  -  " + c.moons : "") : "";
}

function tabWidth(t)
{
   return String(t.label).length * 10 + (t.badge != undefined && t.badge != "" ? 34 : 0) + 30;
}

function drawTabs()
{
   var s = clear("tabs", 30);
   var list = data.tabs instanceof Array ? data.tabs : [];
   var x = PAD;
   var y = 88;
   var right = PANEL_W - PAD;
   for (var p = list.length - 1; p >= 0; p--)
   {
      if (list[p].pinned == true)
      {
         right -= tabWidth(list[p]) + 6;
      }
   }
   var px = right;
   for (var i = 0; i < list.length; i++)
   {
      var t = list[i];
      var w = tabWidth(t);
      var at;
      if (t.pinned == true)
      {
         at = px + 6;
         px += w + 6;
      }
      else
      {
         if (x + w > right && x > PAD)
         {
            x = PAD;
            y += 30;
         }
         at = x;
         x += w + 6;
      }
      var label = String(t.label) + (t.badge != undefined && t.badge != "" ? "  (" + t.badge + ")" : "");
      var b = button(s, "t" + i, 10 + i, at, y, w, label, F_BOLD, 17, t.id == tab ? A_FOCUS : A_ROW_REST, function()
      {
         openTab(this.tabId);
      });
      b.tabId = String(t.id);
   }
   dboRule(s, PAD, y + 34, PANEL_W - PAD * 2);
}

function sectionOf(id)
{
   return cache[id];
}

function drawBody()
{
   var b = clear("body", 40);
   flowStart(b, 1, PAD, BODY_TOP);
   if (asking != null)
   {
      flowGap(60);
      flowText(asking.q, 22, C_TEXT);
      flowGap(12);
      flowButtons([[asking.yes, function()
      {
         var f = asking.fn;
         asking = null;
         f();
         draw();
      }, asking.danger ? C_RED : undefined], ["No", function()
      {
         dboSound("UIMenuCancel");
         asking = null;
         draw();
      }]]);
   }
   else
   {
      var s = sectionOf(tab);
      if (JT[tab] == undefined || s === undefined)
      {
         flowGap(120);
         flowText(JT[tab] == undefined ? "Turning to the page..." : "Turning the page...", 20, C_SECOND);
      }
      else if (s == null)
      {
         flowGap(120);
         flowText("This page cannot be shown just now.", 20, C_SECOND);
      }
      else
      {
         ctx.busy = busy;
         ctx.readOnly = data.readOnly == 1;
         ctx.sections = cache;
         ctx.nonce = data.nonce;
         JT[tab](s, ctx);
      }
   }
   var n = flowShow(pages[tab] != undefined ? pages[tab] : 0);
   pages[tab] = flow.shown;
   return n;
}

function drawFoot(total)
{
   var f = clear("foot", 60);
   var y = PANEL_H - 52;
   dboRule(f, PAD, y - 10, PANEL_W - PAD * 2);
   dboText(f, "result", 1, PAD, y, 640, 26, dboFmt(F_MEDIUM, 17, C_TEXT, 0.5), false);
   showResult();
   var h = dboText(f, "hint", 2, PAD, y + 24, 640, 22, dboFmt(F_MEDIUM, 14, C_SECOND, 0.5), false);
   h.text = data.readOnly == 1 ? "You are reading " + (data.head != undefined && data.head != null ? data.head.name : "") + "'s journal. Nothing can be changed here." : "F3 opens your journal. Escape closes it.";
   if (total > 1)
   {
      var shown = flow.shown;
      var pt = dboText(f, "page", 3, 680, y + 6, 130, 24, dboFmt(F_MEDIUM, 15, C_SECOND, 0.5, "center"), false);
      pt.text = "Page " + (shown + 1) + " of " + total;
      var pv = button(f, "prev", 10, 660 - 110, y + 2, 110, "Previous", F_MEDIUM, 17, A_BUTTON_REST, function()
      {
         turn(-1);
      });
      var nx = button(f, "next", 11, 820, y + 2, 110, "Next page", F_MEDIUM, 17, A_BUTTON_REST, function()
      {
         turn(1);
      });
      if (shown == 0)
      {
         disable(pv);
      }
      if (shown >= total - 1)
      {
         disable(nx);
      }
   }
   button(f, "close", 20, PANEL_W - PAD - 100, y + 2, 100, "Close", F_MEDIUM, 18, A_BUTTON_REST, function()
   {
      closeJournal();
   });
}

function turn(d)
{
   var next = (pages[tab] != undefined ? pages[tab] : 0) + d;
   if (flow == null || next < 0 || next >= flow.pages.length)
   {
      return;
   }
   dboSound("UIMenuPrevNext");
   pages[tab] = next;
   draw();
}

function draw()
{
   actions = [];
   focus = -1;
   drawHead();
   drawTabs();
   var head = actions;
   actions = [];
   var n = drawBody();
   actions = head.concat(actions);
   for (var i = 0; i < actions.length; i++)
   {
      actions[i].idx = i;
   }
   drawFoot(n);
}

function tabStep(d)
{
   var list = data.tabs instanceof Array ? data.tabs : [];
   for (var i = 0; i < list.length; i++)
   {
      if (list[i].id == tab)
      {
         var j = (i + d + list.length) % list.length;
         openTab(String(list[j].id));
         return;
      }
   }
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   panel._x = (STAGE_W - PANEL_W) / 2;
   panel._y = 28;
   var bg = panel.createEmptyMovieClip("bg", 1);
   dboBox(bg, 0, 0, PANEL_W, PANEL_H, 0x000000, 80);
   dboFadeIn(panel);
}

_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || p.hub != 1 || !(p.tabs instanceof Array) || p.nonce == undefined)
   {
      dboLog("journal: unreadable payload");
      return;
   }
   var opening = String(p.opened) + "|" + (p.subject != undefined ? p.subject : "");
   if (opening != cacheOf)
   {
      cacheOf = opening;
      cache = {};
      pages = {};
   }
   for (var k in p)
   {
      if (SHELL_KEYS[k] == undefined && p[k] !== undefined)
      {
         cache[k] = p[k];
      }
   }
   if (data == null || p.nonce != data.nonce)
   {
      busy = false;
   }
   if (data == null || p.tab != tab)
   {
      asking = null;
   }
   data = p;
   tab = String(p.tab);
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = dboKey();
   dboLog("journal key " + code);
   if (code == 27)
   {
      if (asking != null)
      {
         dboSound("UIMenuCancel");
         asking = null;
         draw();
         return;
      }
      closeJournal();
      return;
   }
   if (data == null)
   {
      return;
   }
   if (code == 81)
   {
      tabStep(-1);
   }
   else if (code == 82)
   {
      tabStep(1);
   }
   else if (code == 37 || code == 33)
   {
      turn(-1);
   }
   else if (code == 39 || code == 34)
   {
      turn(1);
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
};
Key.addListener(keys);

var wheel = {};
wheel.onMouseWheel = function(delta)
{
   if (data != null)
   {
      turn(delta > 0 ? -1 : 1);
   }
};
Mouse.addListener(wheel);

_root.onEnterFrame = function()
{
   if (data == null && getTimer() - builtAt >= NO_DATA_CLOSE_MS)
   {
      dboLog("journal: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
      delete _root.onEnterFrame;
      dboClose();
   }
   if (busy && getTimer() - busyAt >= BUSY_MS)
   {
      busy = false;
      showResult();
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
