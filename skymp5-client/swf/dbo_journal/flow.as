// The native journal's page layout: a tab draws blocks top to bottom, and a block that does not fit starts the next page.
// Every page is drawn; only the shown one is visible and only its controls take the focus (flowEnd).
// JT[tabId] = function(section, ctx) draws one tab with these; ctx is the shell's (act, openTab, browser, busy, readOnly).

var JT = {};
var BODY_W = 1124;
var BODY_H = 410;
var LINE_GAP = 6;
var flow = null;

function flowStart(parent, depth, x, y)
{
   if (parent.flowClip != undefined)
   {
      parent.flowClip.removeMovieClip();
   }
   var root = parent.createEmptyMovieClip("flowClip", depth);
   root._x = x;
   root._y = y;
   flow = {root: root, pages: [], y: 0, n: 0, d: 0};
   flowPage();
}

function flowPage()
{
   var p = flow.root.createEmptyMovieClip("p" + flow.pages.length, 10 + flow.pages.length);
   p.pageNo = flow.pages.length;
   flow.pages.push(p);
   flow.y = 0;
}

// The clip and y for a block of height h on the current page, or on a new one when it would run off this one
function flowNeed(h)
{
   if (flow.y > 0 && flow.y + h > BODY_H)
   {
      flowPage();
   }
   var at = {clip: flow.pages[flow.pages.length - 1], y: flow.y, name: "b" + flow.n};
   flow.n++;
   flow.y += h;
   return at;
}

function flowGap(h)
{
   flow.y += h;
}

// Wrapped text's height, measured where the player can measure it, else estimated from the characters per line
function textHeight(t, text, size, w)
{
   if (t != undefined && t.textHeight > 0)
   {
      return t.textHeight + 6;
   }
   var per = Math.max(10, Math.floor(w / (size * 0.52)));
   var parts = String(text).split("\n");
   var lines = 0;
   for (var i = 0; i < parts.length; i++)
   {
      lines += Math.max(1, Math.ceil(parts[i].length / per));
   }
   return lines * (size + LINE_GAP) + 4;
}

function flowHeading(text)
{
   var at = flowNeed(40);
   var t = dboText(at.clip, at.name, fd(), 0, at.y + 8, BODY_W, 30, dboFmt(F_BOLD, 22, C_TEXT, 1.0), false);
   t.text = String(text);
   dboRule(at.clip, 0, at.y + 36, BODY_W);
   return t;
}

function flowText(text, size, color, indent)
{
   var x = indent != undefined ? indent : 0;
   var s = size != undefined ? size : 18;
   var h = textHeight(null, text, s, BODY_W - x);
   var at = flowNeed(h);
   var t = dboText(at.clip, at.name, fd(), x, at.y, BODY_W - x, h, dboFmt(F_MEDIUM, s, color != undefined ? color : C_TEXT, 0.5), true);
   t.text = String(text);
   return t;
}

function flowHint(text)
{
   return flowText(text, 15, C_SECOND);
}

// A label and its value in two columns, the hint after the value in grey
function flowRow(label, value, hint)
{
   var v = String(value) + (hint != undefined && hint != "" ? "   " + hint : "");
   var h = Math.max(26, textHeight(null, v, 18, BODY_W - 380));
   var at = flowNeed(h);
   var l = dboText(at.clip, at.name + "l", fd(), 0, at.y, 360, 26, dboFmt(F_MEDIUM, 18, C_SECOND, 0.5), false);
   l.text = String(label);
   var r = dboText(at.clip, at.name + "v", fd(), 380, at.y, BODY_W - 380, h, dboFmt(F_MEDIUM, 18, C_TEXT, 0.5), true);
   r.text = v;
   return r;
}

// A line of text with buttons at its right: buttons is [[label, onPick, color?, disabled?], ...]
function flowEntry(text, buttons, sub)
{
   var bw = 0;
   for (var i = 0; buttons != undefined && i < buttons.length; i++)
   {
      bw += 132;
   }
   var w = BODY_W - bw;
   var h = Math.max(32, textHeight(null, text, 18, w) + (sub != undefined && sub != "" ? 22 : 0));
   var at = flowNeed(h + 4);
   var c = at.clip.createEmptyMovieClip(at.name, fd());
   c._y = at.y;
   var t = dboText(c, "label", 1, 0, 2, w, h, dboFmt(F_MEDIUM, 18, C_TEXT, 0.5), true);
   t.text = String(text);
   if (sub != undefined && sub != "")
   {
      var s = dboText(c, "sub", 2, 0, h - 22, w, 22, dboFmt(F_MEDIUM, 15, C_SECOND, 0.5), false);
      s.text = String(sub);
   }
   var x = w;
   for (var j = 0; buttons != undefined && j < buttons.length; j++)
   {
      var b = button(c, "btn" + j, 10 + j, x + 4, 0, 124, buttons[j][0], F_MEDIUM, 17, A_BUTTON_REST, buttons[j][1]);
      if (buttons[j][2] != undefined)
      {
         b.label.textColor = buttons[j][2];
      }
      if (buttons[j][3] == true)
      {
         disable(b);
      }
      x += 132;
   }
   return c;
}

// A row of buttons on their own line: [[label, onPick, color?, disabled?, on?], ...]; on true or false makes it a chip, bright when chosen
function flowButtons(buttons)
{
   var xs = [];
   var ys = [];
   var ws = [];
   var x = 0;
   var y = 0;
   for (var k = 0; k < buttons.length; k++)
   {
      var bw = Math.max(110, String(buttons[k][0]).length * 10 + 24);
      if (x > 0 && x + bw > BODY_W)
      {
         x = 0;
         y += 34;
      }
      xs.push(x);
      ys.push(y);
      ws.push(bw);
      x += bw + 8;
   }
   var at = flowNeed(y + 38);
   var c = at.clip.createEmptyMovieClip(at.name, fd());
   c._y = at.y + 4;
   for (var i = 0; i < buttons.length; i++)
   {
      var b = button(c, "btn" + i, 10 + i, xs[i], ys[i], ws[i], buttons[i][0], F_MEDIUM, 17, buttons[i][4] == true ? A_FOCUS : buttons[i][4] == false ? A_ROW_REST + 20 : A_BUTTON_REST, buttons[i][1]);
      if (buttons[i][2] != undefined)
      {
         b.label.textColor = buttons[i][2];
      }
      if (buttons[i][3] == true)
      {
         disable(b);
      }
   }
   return c;
}

function pageOf(clip)
{
   var c = clip;
   while (c != undefined && c.pageNo == undefined)
   {
      c = c._parent;
   }
   return c == undefined ? 0 : c.pageNo;
}

// Shows page n (clamped) and keeps only its controls (and those outside the flow) in the focus order; returns the page count
function flowShow(n)
{
   var count = flow.pages.length;
   var shown = Math.max(0, Math.min(count - 1, n));
   for (var i = 0; i < count; i++)
   {
      flow.pages[i]._visible = i == shown;
   }
   var keep = [];
   for (var j = 0; j < actions.length; j++)
   {
      var a = actions[j];
      if (!inFlow(a) || pageOf(a) == shown)
      {
         a.idx = keep.length;
         keep.push(a);
      }
   }
   actions = keep;
   focus = -1;
   flow.shown = shown;
   return count;
}

function inFlow(clip)
{
   var c = clip;
   while (c != undefined)
   {
      if (c == flow.root)
      {
         return true;
      }
      c = c._parent;
   }
   return false;
}

// A depth no other child of the flow has taken
function fd()
{
   flow.d++;
   return flow.d;
}

var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// A time in ms as the browser journal writes it: "Mon 26 Oct, 14:05"
function whenText(ms)
{
   if (ms == undefined || ms == null || Number(ms) <= 0)
   {
      return "";
   }
   var d = new Date(Number(ms));
   var mm = d.getMinutes();
   return DAYS[d.getDay()] + " " + d.getDate() + " " + MONTHS[d.getMonth()] + ", " + d.getHours() + ":" + (mm < 10 ? "0" : "") + mm;
}

function listOf(v)
{
   return v instanceof Array ? v : [];
}

// Split tabs (a list beside a page) take the whole page and draw their own columns with these
function flowWhole()
{
   var at = flowNeed(BODY_H);
   var c = at.clip.createEmptyMovieClip(at.name, fd());
   c._y = at.y;
   return c;
}

// Wrapped text at x, y in a column w wide; returns the y below it
function colText(c, x, y, w, text, size, color, font)
{
   var s = size != undefined ? size : 18;
   var h = textHeight(null, text, s, w);
   var t = dboText(c, "t" + fd(), fd(), x, y, w, h, dboFmt(font != undefined ? font : F_MEDIUM, s, color != undefined ? color : C_TEXT, 0.5), true);
   t.text = String(text);
   return y + h;
}

// A list row button in a column: bright when on
function colRow(c, x, y, w, label, on, onPick, mark)
{
   var b = button(c, "r" + fd(), fd(), x, y, w, label + (mark != undefined && mark != "" ? "   " + mark : ""), F_MEDIUM, 18, on ? A_FOCUS : A_ROW_REST, onPick);
   return b;
}

function plural(n, one, many)
{
   return n + " " + (n == 1 ? one : many);
}
