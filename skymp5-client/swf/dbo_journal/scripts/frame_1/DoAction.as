// The Character Journal (F3, widget 50) as a native panel, drawn from the hub payload journal.js sends. The server routes
// here only the tabs this swf draws (the client's native:journalTab:<id> caps); Profile, Settings and the rest are the
// browser journal's, so a click on one of them asks the server, which moves the journal there.
// A tab's typed input is a form drawn in place of the tab (ctx.form), typed in boxes on their own rows (dboInput); a tab
// whose typing is not native yet, or a game that cannot type, still hands it to the browser journal for that tab:
// journalTab [nonce, tab, focus, "browser"].

var DBO_SWF_VERSION = "journal-1";
var STAGE_W = 1280;
var PANEL_W = 1180;
var PANEL_H = 664;
var PAD = 28;
var BODY_TOP = 152;
var bodyTop = BODY_TOP;
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
// forming: the form drawn in place of the tab, {build, vals}; build(vals) gives {title, hint, fields, buttons} each draw
var forming = null;
// fbox: the form field whose typing box is open; fboxField its text field
var fbox = "";
var fboxField = null;
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
   closeForm();
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
   endFormTyping();
   dboSound("UIMenuCancel");
   send("dbo:journalClose", [data != null ? data.nonce : ""]);
   send("close", []);
   dboClose();
}

// A form in place of the tab, for typed input. build(vals) returns {title, hint, fields, buttons}, where a field is
// {key, label, kind: "text" | "number" | "choice" | "note", max, hint, options: [[value, label], ...], empty, text} and a
// button [label, onSubmit(vals), ready, danger]; vals are what the player typed and chose, by key. A button that is ready
// closes the form and runs; Cancel and Escape close it.
function form(build, vals)
{
   endFormTyping();
   dboSound("UIMenuOK");
   asking = null;
   forming = {build: build, vals: vals != undefined ? vals : {}};
   pages[tab] = 0;
   draw();
}

function closeForm()
{
   endFormTyping();
   forming = null;
}

function endFormTyping()
{
   if (fbox != "")
   {
      dboInputEnd();
   }
   fbox = "";
   fboxField = null;
}

function takeFormTyped()
{
   var text = fboxField != null ? String(fboxField.text).split("\r").join(" ").split("\n").join(" ") : "";
   while (text.charAt(0) == " ")
   {
      text = text.substr(1);
   }
   while (text.charAt(text.length - 1) == " ")
   {
      text = text.substr(0, text.length - 1);
   }
   forming.vals[fbox] = text;
   endFormTyping();
   dboSound("UIMenuOK");
   draw();
}

// A typed field's row: its label, the value or a box to type it in
function formField(f, vals)
{
   var at = flowNeed(42);
   var c = at.clip.createEmptyMovieClip(at.name, fd());
   c._y = at.y;
   var l = dboText(c, "label", 1, 0, 8, 300, 26, dboFmt(F_MEDIUM, 16, C_SECOND, 0.5), false);
   l.text = String(f.label);
   var value = vals[f.key] != undefined ? String(vals[f.key]) : "";
   if (fbox == f.key)
   {
      fboxField = dboInput(c, "box", 2, 310, 4, BODY_W - 310 - 108, 32, dboFmt(F_PLAIN, 18, C_TEXT, 0.5), f.max != undefined ? f.max : 40, false);
      if (f.kind == "number")
      {
         fboxField.restrict = "0-9";
      }
      fboxField.text = value;
      button(c, "done", 10, BODY_W - 100, 6, 92, "Done", F_MEDIUM, 17, A_BUTTON_REST, function() { takeFormTyped(); });
      return;
   }
   var v = dboText(c, "value", 2, 310, 8, BODY_W - 310 - 108, 26, dboFmt(F_MEDIUM, 17, value != "" ? C_TEXT : C_SECOND, 0.5), false);
   v.text = value != "" ? value : f.hint != undefined ? String(f.hint) : "";
   if (dboCanType())
   {
      var t = button(c, "type", 10, BODY_W - 100, 6, 92, "Type...", F_MEDIUM, 17, A_ROW_REST, function()
      {
         endFormTyping();
         fbox = this.key;
         dboSound("UIMenuOK");
         draw();
      });
      t.key = String(f.key);
   }
}

function drawForm()
{
   var vals = forming.vals;
   var spec = forming.build(vals);
   flowHeading(String(spec.title));
   if (spec.hint != undefined && spec.hint != "")
   {
      flowHint(String(spec.hint));
   }
   var fields = listOf(spec.fields);
   var typed = false;
   for (var i = 0; i < fields.length; i++)
   {
      var f = fields[i];
      if (f.kind == "note")
      {
         flowHint(String(f.text));
      }
      else if (f.kind == "choice")
      {
         flowText(String(f.label), 16, C_SECOND);
         var opts = listOf(f.options);
         if (!opts.length)
         {
            flowHint(f.empty != undefined ? String(f.empty) : "Nothing to choose from.");
            continue;
         }
         var chips = [];
         for (var k = 0; k < opts.length; k++)
         {
            chips.push([String(opts[k][1]), function() { forming.vals[this.key] = this.v; dboSound("UIMenuFocus"); draw(); }, undefined, false, String(vals[f.key]) == String(opts[k][0])]);
         }
         var row = flowButtons(chips);
         for (var q = 0; q < opts.length; q++)
         {
            row["btn" + q].key = String(f.key);
            row["btn" + q].v = opts[q][0];
         }
      }
      else
      {
         typed = true;
         formField(f, vals);
      }
   }
   if (typed && !dboCanType())
   {
      flowHint("This game cannot take typed input in a panel: the browser journal has this form.");
   }
   flowGap(6);
   var bs = [];
   var list = listOf(spec.buttons);
   for (var j = 0; j < list.length; j++)
   {
      bs.push([String(list[j][0]), function()
      {
         var go = this.go;
         var v = forming.vals;
         closeForm();
         go(v);
         draw();
      }, list[j][3] == true ? C_RED : undefined, busy || data.readOnly == 1 || list[j][2] != true]);
   }
   if (typed && !dboCanType())
   {
      bs.push(["In the browser...", function() { closeForm(); toBrowser(); draw(); }]);
   }
   bs.push(["Cancel", function() { dboSound("UIMenuCancel"); closeForm(); draw(); }]);
   var bar = flowButtons(bs);
   for (var n = 0; n < list.length; n++)
   {
      bar["btn" + n].go = list[n][1];
   }
}

// A whole number typed in a form, or -1 when it is not one
function formNumber(vals, key)
{
   var t = vals[key] != undefined ? String(vals[key]) : "";
   return t != "" && !isNaN(Number(t)) ? Math.floor(Number(t)) : -1;
}

var ctx = {act: act, openTab: openTab, browser: toBrowser, ask: ask, form: form, number: formNumber};

function drawHead()
{
   var h = clear("head", 20);
   var hd = data.head != undefined && data.head != null ? data.head : {name: "", title: "", race: ""};
   dboTitle(h, "name", 1, PAD, 14, 700, hd.name);
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
      if (t.id == tab)
      {
         dboTabMark(b, w - 30);
      }
   }
   dboDivider(s, PAD, y + 36, PANEL_W - PAD * 2);
   // a second row of tabs moves the page down under it
   bodyTop = Math.max(BODY_TOP, y + 48);
}

function sectionOf(id)
{
   return cache[id];
}

function drawBody()
{
   var b = clear("body", 40);
   flowStart(b, 1, PAD, bodyTop);
   var typedText = fbox != "" && fboxField != null ? String(fboxField.text) : null;
   fboxField = null;
   if (forming != null)
   {
      ctx.busy = busy;
      ctx.readOnly = data.readOnly == 1;
      drawForm();
      if (typedText != null && fboxField != null)
      {
         fboxField.text = typedText;
      }
   }
   else if (asking != null)
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
   // a box whose field is gone (the form closed, or rebuilt without it) gives the keys back
   if (fbox != "" && fboxField == null)
   {
      endFormTyping();
   }
   var n = flowShow(pages[tab] != undefined ? pages[tab] : 0);
   pages[tab] = flow.shown;
   return n;
}

function drawFoot(total)
{
   var f = clear("foot", 60);
   var y = PANEL_H - 52;
   dboDivider(f, PAD, y - 10, PANEL_W - PAD * 2);
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
   dboFit(panel, PANEL_W, PANEL_H);
   var bg = panel.createEmptyMovieClip("bg", 1);
   dboGround(bg, PANEL_W, PANEL_H);
   dboWatermark(panel, 5, PANEL_W - 50, 170, 300);
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
      closeForm();
   }
   data = p;
   tab = String(p.tab);
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = dboKey();
   if (fbox != "")
   {
      if (code == 27)
      {
         dboSound("UIMenuCancel");
         endFormTyping();
         draw();
      }
      else if (code == 13)
      {
         takeFormTyped();
      }
      // every other key is typing while the box is open
      return;
   }
   if (code == 27)
   {
      if (forming != null)
      {
         dboSound("UIMenuCancel");
         closeForm();
         draw();
         return;
      }
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
