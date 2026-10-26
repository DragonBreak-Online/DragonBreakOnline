// The admin panel's kit: the wire to adminMenuService, and the controls every tab is drawn from. A control joins the focus
// walk (dbo-controls.as actions); a list row carries rowIndex for the number keys.

var PAD = 24;
var ROW_H = 34;
var MAX_ROWS = 9;
var CONFIRM_MS = 5000;
var LIVE_MS = 300;
var C_RED = 0xB23A3A;
var C_GREEN = 0x8FBF7F;
var C_GOLD = 0xC9A86A;

var data = null;
// when the last payload arrived (getTimer), so a server clock it carries can be moved on between pushes
var dataAt = 0;
// Each tab (tabs/*.as): draw(c, x, y, w, h); open() when opened (the data it asks for); leave() when left; acting() when the
// one acted on changes; tick() each frame
var TABS = {};
// What the panel shows, sent to adminMenuService as admin::ui and answered with that page (adminNativeView.ts)
var ui = {tab: "debug", page: 0};
// What is being typed: {name, text, onCommit, live, at}; while set every key but Enter and Escape is typing
var editing = null;
// A destructive button pressed once: its key and when, the second press within CONFIRM_MS does it
var armedKey = "";
var armedAt = 0;
// The Left/Right and Page keys turn this list's page; a tab sets it while drawing
var pageTurn = null;

// ---- the wire ----

function ev(k)
{
   return data != null && data.events != undefined && data.events[k] != undefined ? String(data.events[k]) : "admin::" + k.toLowerCase();
}

// admin::action <action> <JSON of its fields>: the server checks rank and target
function act(action, fields)
{
   dboSound("UIMenuOK");
   dboSend(ev("action"), [action, dboJson(fields == undefined ? {} : fields)]);
}

// admin::request <type> <JSON>: the data requests adminMenuService allows
function req(type, fields)
{
   dboSend(ev("request"), [type, dboJson(fields == undefined ? {} : fields)]);
}

// The rows each list has room for, by tab or tab:view; the service pages by it (adminNativeView rowsOf)
var ROWS_FOR = {"players": 6, "players:roster": 6, "items": 6, "teleport": 8, "enchant": 5, "thievery:ledger": 5};

function rowsFor(tab, sub)
{
   if (ROWS_FOR[tab + ":" + sub] != undefined)
   {
      return ROWS_FOR[tab + ":" + sub];
   }
   return ROWS_FOR[tab] != undefined ? ROWS_FOR[tab] : MAX_ROWS;
}

function sendUi()
{
   ui.rows = rowsFor(str(ui.tab), str(ui.sub));
   dboSend("admin::ui", [dboJson(ui)]);
}

// One field of the panel's state changed: the page starts over and the service is told
function setUi(key, value, keepPage)
{
   ui[key] = value;
   if (keepPage != true)
   {
      ui.page = 0;
   }
   sendUi();
}

function targetFields(extra)
{
   var o = {};
   if (ui.acting != undefined && ui.acting != "")
   {
      o.target = ui.acting;
   }
   if (extra != undefined)
   {
      for (var k in extra)
      {
         o[k] = extra[k];
      }
   }
   return o;
}

// ---- small helpers (ActionScript 2 arrays have no indexOf, map or filter) ----

function has(list, v)
{
   if (!(list instanceof Array))
   {
      return false;
   }
   for (var i = 0; i < list.length; i++)
   {
      if (list[i] == v)
      {
         return true;
      }
   }
   return false;
}

function str(v)
{
   return v == undefined || v == null ? "" : String(v);
}

function cut(s, n)
{
   var t = str(s);
   return t.length > n ? t.substr(0, n - 1) + "..." : t;
}

function plural(n, one, many)
{
   return n + " " + (n == 1 ? one : (many == undefined ? one + "s" : many));
}

function pad2(n)
{
   return (n < 10 ? "0" : "") + n;
}

// "m:ss", or "h:mm:ss" past an hour
function countdown(total)
{
   var h = Math.floor(total / 3600);
   var m = Math.floor((total % 3600) / 60);
   var s = Math.floor(total % 60);
   return h ? h + ":" + pad2(m) + ":" + pad2(s) : m + ":" + pad2(s);
}

// "just now", "12 min ago", "2 h 5 min ago"
function ago(ms)
{
   var m = Math.max(0, Math.round(ms / 60000));
   if (m < 1)
   {
      return "just now";
   }
   if (m < 60)
   {
      return m + " min ago";
   }
   return Math.floor(m / 60) + " h " + (m % 60) + " min ago";
}

// "in 3 h 5 min" or "12 min ago", as the browser's thievery span
function span(ms)
{
   var m = Math.max(0, Math.round(Math.abs(ms) / 60000));
   var t = m < 60 ? m + " min" : m < 2880 ? Math.floor(m / 60) + " h " + (m % 60) + " min" : Math.round(m / 1440) + " days";
   return ms >= 0 ? "in " + t : t + " ago";
}

function trimText(s)
{
   var t = str(s);
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

function isNum(s)
{
   var t = trimText(s);
   return t != "" && !isNaN(Number(t)) && isFinite(Number(t));
}

function isWhole(s)
{
   return isNum(s) && Math.floor(Number(s)) == Number(s);
}

// ---- text ----

function label(parent, name, depth, x, y, w, text, size, color, multi, h)
{
   var tf = dboText(parent, name, depth, x, y, w, h != undefined ? h : size + 10, dboFmt(size >= 22 ? F_BOLD : F_MEDIUM, size, color, size >= 22 ? 0 : 0.6), multi == true);
   tf.text = str(text);
   return tf;
}

function hint(parent, name, depth, x, y, w, text, h)
{
   return label(parent, name, depth, x, y, w, text, 16, C_SECOND, h != undefined, h);
}

function section(parent, name, depth, x, y, w, text)
{
   return label(parent, name, depth, x, y, w, text, 18, C_SILVER);
}

// ---- controls ----

function textW(s, size)
{
   return Math.round(str(s).length * size * 0.5) + 28;
}

// A button sized to its label unless w is given; disabled with an optional reason
function btn(parent, name, depth, x, y, w, text, onPick, disabled)
{
   var b = button(parent, name, depth, x, y, w > 0 ? w : textW(text, 18), text, F_MEDIUM, 18, A_BUTTON_REST, onPick);
   if (disabled == true)
   {
      disable(b);
   }
   return b;
}

// A chip: a choice among several, the chosen one bright and marked
function chip(parent, name, depth, x, y, text, on, onPick)
{
   var w = textW(text, 16);
   var c = button(parent, name, depth, x, y, w, text, F_MEDIUM, 16, on ? A_FOCUS : A_ROW_REST, onPick);
   if (on)
   {
      dboTabMark(c, w - 28);
   }
   return c;
}

// A row of chips from x, wrapping at right; returns the y under the last line
function chips(parent, prefix, depth, x, y, right, list, onKey, onPick)
{
   var cx = x;
   var cy = y;
   for (var i = 0; i < list.length; i++)
   {
      var w = textW(list[i][1], 16);
      if (cx + w > right && cx > x)
      {
         cx = x;
         cy += 30;
      }
      var c = chip(parent, prefix + i, depth + i, cx, cy, list[i][1], list[i][0] == onKey, onPick);
      c.key = list[i][0];
      cx += w + 6;
   }
   return cy + 30;
}

// Anything that cannot be undone asks once, as the browser's Confirm: the second press within five seconds does it
function confirmBtn(parent, name, depth, x, y, w, text, key, onConfirm, disabled)
{
   var armed = armedKey == key && getTimer() - armedAt < CONFIRM_MS;
   var shown = armed ? "Sure? " + text : text;
   var b = btn(parent, name, depth, x, y, w > 0 ? w : textW("Sure? " + text, 18), shown, function()
   {
      if (armedKey == this.armKey && getTimer() - armedAt < CONFIRM_MS)
      {
         armedKey = "";
         this.doIt();
         return;
      }
      dboSound("UIMenuFocus");
      armedKey = this.armKey;
      armedAt = getTimer();
      draw();
   }, disabled);
   b.armKey = key;
   b.doIt = onConfirm;
   if (armed)
   {
      b.label.textColor = C_RED;
   }
   return b;
}

// A field: its value in a box, typed into in the panel. Pressing it (or Enter on it) starts typing; Enter keeps the text,
// Escape puts it back. live: every change is passed on after a short pause (searches)
function field(parent, name, depth, x, y, w, value, placeholder, max, onCommit, live)
{
   if (editing != null && editing.name == name)
   {
      // the lib takes one AllowTextInput count per typing session however often this is redrawn (dboTyping)
      var box = dboInput(parent, name, depth, x, y, w, 28, dboFmt(F_MEDIUM, 18, C_TEXT, 0.4), max, false);
      box.borderColor = C_ACCENT;
      box.text = editing.text;
      if (Selection.setSelection != undefined)
      {
         Selection.setSelection(editing.text.length, editing.text.length);
      }
      box.onChanged = function()
      {
         editing.text = this.text;
         editing.changedAt = getTimer();
      };
      return box;
   }
   var shown = str(value);
   var b = button(parent, name, depth, x, y, w, shown != "" ? shown : placeholder, F_MEDIUM, 18, A_BUTTON_REST, function()
   {
      startEdit(this.fieldName, this.fieldValue, this.commit, this.live);
   });
   dboBox(b, 0, 26, w, 1, C_STONE, 90);
   if (shown == "")
   {
      b.label.textColor = C_SECOND;
   }
   b.fieldName = name;
   b.fieldValue = shown;
   b.commit = onCommit;
   b.live = live == true;
   return b;
}

function startEdit(name, value, onCommit, live)
{
   if (!dboCanType())
   {
      dboSound("UIMenuCancel");
      return;
   }
   dboSound("UIMenuOK");
   editing = {name: name, text: str(value), onCommit: onCommit, live: live == true, changedAt: 0, sentText: str(value)};
   // the service holds F7 while the game takes keys as text
   setUi("typing", true, true);
   draw();
}

function finishEdit(keep)
{
   var e = editing;
   editing = null;
   if (e != null)
   {
      dboInputEnd();
   }
   ui.typing = false;
   if (keep && e != null)
   {
      e.onCommit(e.text, true);
   }
   else if (e != null && e.live && e.sentText != e.text)
   {
      // a live search typed and then cancelled goes back to what it was
      e.onCommit(e.sentText == undefined ? "" : e.sentText, false);
   }
   // the service learns typing is over even when nothing was kept
   sendUi();
   draw();
}

// Called each frame: a live field's pause has passed, so its text goes out
function liveTick()
{
   if (editing != null && editing.live && editing.changedAt && getTimer() - editing.changedAt >= LIVE_MS)
   {
      editing.changedAt = 0;
      editing.sentText = editing.text;
      editing.onCommit(editing.text, false);
   }
}

// A list: up to nine rows from the given row objects; cells(row) gives [[text, x, w, color?], ...] inside the row.
// onPick(row) when a row is chosen; isOn(row) marks the selected one
function rowList(parent, prefix, depth, x, y, w, rows, cells, onPick, isOn)
{
   for (var i = 0; i < rows.length && i < MAX_ROWS; i++)
   {
      var r = rows[i];
      var c = parent.createEmptyMovieClip(prefix + i, depth + i);
      c._x = x;
      c._y = y + i * ROW_H;
      dboBox(c, 0, 0, w, ROW_H - 4, 0x000000, 1);
      var on = isOn != undefined && isOn(r);
      if (on)
      {
         dboBox(c, 0, ROW_H - 6, w, 2, C_ACCENT, 70);
      }
      var key = dboText(c, "key", 1, 0, 4, 22, 24, dboFmt(F_BOLD, 16, C_SECOND, 0), false);
      key.text = String(i + 1);
      var list = cells(r);
      for (var k = 0; k < list.length; k++)
      {
         var cell = list[k];
         var tf = dboText(c, "c" + k, 2 + k, 24 + cell[1], 3, cell[2], 26, dboFmt(F_MEDIUM, 18, cell[3] != undefined ? cell[3] : C_TEXT, 0.4), false);
         tf.text = str(cell[0]);
      }
      c.row = r;
      c.rest = on ? A_FOCUS : A_ROW_REST;
      c._alpha = c.rest;
      c.rowIndex = i;
      c.washW = w;
      c.washH = ROW_H - 4;
      c.idx = actions.length;
      actions.push(c);
      c.onPick = function()
      {
         dboSound("UIMenuOK");
         this.pick(this.row);
      };
      c.pick = onPick;
      c.onRollOver = function()
      {
         setFocus(this.idx);
      };
      c.onRollOut = function()
      {
         this._alpha = this.rest;
         if (focus == this.idx)
         {
            focus = -1;
         }
      };
      c.onRelease = function()
      {
         this.onPick();
      };
   }
   return y + Math.min(rows.length, MAX_ROWS) * ROW_H;
}

// Previous / Next under a list, with where it is; turning also answers Left/Right and the Page keys
function pager(parent, prefix, depth, x, y, page, pages, total, noun)
{
   pageTurn = function(d)
   {
      var p = Math.max(0, Math.min(pages - 1, page + d));
      if (p != page)
      {
         dboSound("UIMenuPrevNext");
         setUi("page", p, true);
      }
   };
   var t = hint(parent, prefix + "where", depth, x, y + 4, 300, pages > 1 ? "Page " + (page + 1) + " of " + pages + (total != undefined ? ", " + plural(total, noun == undefined ? "row" : noun) : "") : (total != undefined ? plural(total, noun == undefined ? "row" : noun) : ""));
   if (pages <= 1)
   {
      return;
   }
   var prev = btn(parent, prefix + "prev", depth + 1, x + 310, y, 110, "Previous", function()
   {
      pageTurn(-1);
   }, page <= 0);
   btn(parent, prefix + "next", depth + 2, x + 426, y, 80, "Next", function()
   {
      pageTurn(1);
   }, page >= pages - 1);
}

function empty(parent, name, depth, x, y, w, text)
{
   var t = dboText(parent, name, depth, x, y, w, 30, dboFmt(F_MEDIUM, 18, C_SECOND, 0.6), false);
   t.text = text;
   return t;
}
