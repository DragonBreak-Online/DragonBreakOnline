// The player menu as a native panel (server gamemode.js, widget 52: the same object skymp5-front features/playerMenu gets),
// opened with U, /help or a lone "/": tabs by topic (party, trade, faith...), a search across them, and a form per command
// built from its usage (server commandforms.js). A button sends dbo:menuRun [nonce, command, words]; the server runs the
// line through the chat handler, so a panel button passes exactly the checks typing it would, and closes the menu.
// Typed values (the search, a name, a number, free words) go in a box on their own row (dboInput), one box at a time; a
// name also offers the people you know as buttons, and a list of words is a row of choices.

var DBO_SWF_VERSION = "menu-1";
var PANEL_W = 1160;
var PANEL_H = 640;
var PAD = 28;
BODY_W = PANEL_W - PAD * 2;
var NO_DATA_CLOSE_MS = 8000;
var BUSY_TIMEOUT_MS = 8000;
var MAX_FIELD = 300;
var MAX_SEARCH = 60;
var MAX_RESULTS = 40;
var MAX_PEOPLE = 8;
var LABEL_W = 220;
var INDENT = 40;
var C_RED = 0xB23A3A;

var panel;
var data = null;
var tab = "";
var page = 0;
var query = "";
var busyAt = 0;
// openName: the command whose form is open; vi its variant; vals what was typed or chosen for each of its fields
var openName = "";
var vi = 0;
var vals = [];
var extra = "";
// box: the field whose typing box is open ("search", "arg:<i>", "ask:<i>", "extra"); boxField its text field
var box = "";
var boxField = null;
var builtAt = getTimer();

function busy()
{
   return busyAt > 0 && getTimer() - busyAt < BUSY_TIMEOUT_MS;
}

function tabs()
{
   return listOf(data.tabs);
}

function people()
{
   return listOf(data.people);
}

function current()
{
   var list = tabs();
   for (var i = 0; i < list.length; i++)
   {
      if (list[i].key == tab)
      {
         return list[i];
      }
   }
   return list.length ? list[0] : null;
}

function run(entry, text)
{
   if (busy())
   {
      return;
   }
   busyAt = getTimer();
   endTyping();
   // the server closes the menu after a run; the form goes with it
   openName = "";
   dboSound("UIMenuOK");
   dboSend("dbo:menuRun", [String(data.nonce), String(entry.name), trim(text)]);
   draw();
}

function closeMenu()
{
   endTyping();
   dboSound("UIMenuCancel");
   dboSend("dbo:menuClose", []);
   dboClose();
}

function trim(s)
{
   var t = String(s).split("\r").join(" ").split("\n").join(" ");
   while (t.charAt(0) == " ")
   {
      t = t.substr(1);
   }
   while (t.charAt(t.length - 1) == " ")
   {
      t = t.substr(0, t.length - 1);
   }
   return t;
}

function words()
{
   var out = [];
   var parts = trim(query).toLowerCase().split(" ");
   for (var i = 0; i < parts.length; i++)
   {
      if (parts[i] != "")
      {
         out.push(parts[i]);
      }
   }
   return out;
}

// Every word of the query must appear in the command, its usage or what it does
function matches(e, ws)
{
   var hay = (e.name + " " + e.label + " " + (e.usage != undefined ? e.usage : "") + " " + e.desc).toLowerCase();
   for (var i = 0; i < ws.length; i++)
   {
      if (hay.indexOf(ws[i]) < 0)
      {
         return false;
      }
   }
   return true;
}

// The search results across every tab and the commands a key or a place reaches, a name starting with the query first
function results()
{
   var ws = words();
   var seen = {};
   var first = [];
   var rest = [];
   var lists = [];
   var ts = tabs();
   for (var i = 0; i < ts.length; i++)
   {
      lists.push([ts[i].title, listOf(ts[i].entries)]);
   }
   lists.push(["By key or place", listOf(data.searchOnly)]);
   for (var j = 0; j < lists.length; j++)
   {
      var es = lists[j][1];
      for (var k = 0; k < es.length; k++)
      {
         var e = es[k];
         if (seen[e.name] == true || !matches(e, ws))
         {
            continue;
         }
         seen[e.name] = true;
         if (String(e.name).indexOf(ws[0]) == 0)
         {
            first.push({entry: e, title: lists[j][0]});
         }
         else
         {
            rest.push({entry: e, title: lists[j][0]});
         }
      }
   }
   return first.concat(rest).slice(0, MAX_RESULTS);
}

// ---- forms ----

function formOf(e)
{
   return e.form != undefined && e.form != null && listOf(e.form.variants).length ? e.form : null;
}

function plainForm(e)
{
   var f = formOf(e);
   return f != null && f.variants.length == 1 && !listOf(f.variants[0].args).length;
}

function variant(e)
{
   var f = formOf(e);
   return f == null ? null : (f.variants[vi] != undefined ? f.variants[vi] : f.variants[0]);
}

function val(i)
{
   return vals[i] != undefined ? String(vals[i]) : "";
}

// The words a form sends after the command: the variant's word, then each argument that has a value
function lineOf(v)
{
   if (v == null)
   {
      return "";
   }
   var parts = [];
   if (v.word != undefined && v.word != null && v.word != "")
   {
      parts.push(String(v.word));
   }
   var args = listOf(v.args);
   for (var i = 0; i < args.length; i++)
   {
      var s = trim(val(i));
      if (s != "")
      {
         parts.push(s);
      }
   }
   return parts.join(" ");
}

function formReady(v)
{
   var args = listOf(v.args);
   for (var i = 0; i < args.length; i++)
   {
      if (args[i].optional != true && trim(val(i)) == "")
      {
         return false;
      }
   }
   return true;
}

function askReady(e)
{
   var fields = listOf(e.ask);
   for (var i = 0; i < fields.length; i++)
   {
      if (trim(val(i)) == "")
      {
         return false;
      }
   }
   return true;
}

function toggle(e)
{
   endTyping();
   openName = openName == e.name ? "" : String(e.name);
   vi = 0;
   vals = [];
   extra = "";
   dboSound("UIMenuOK");
   draw();
}

// ---- typing ----

function openBox(key)
{
   endTyping();
   box = key;
   dboSound("UIMenuOK");
   draw();
}

function takeTyped()
{
   var text = boxField != null ? String(boxField.text) : "";
   if (box == "search")
   {
      query = trim(text);
      page = 0;
   }
   else if (box == "extra")
   {
      extra = text;
   }
   else
   {
      vals[Number(box.split(":")[1])] = text;
   }
   endTyping();
   dboSound("UIMenuOK");
   draw();
}

function endTyping()
{
   if (box != "")
   {
      dboInputEnd();
   }
   box = "";
   boxField = null;
}

// A typed value's row: its label, the value or a box to type it in
function fieldRow(key, label, value, hint, max, restrict)
{
   var at = flowNeed(42);
   var c = at.clip.createEmptyMovieClip(at.name, fd());
   c._y = at.y;
   var l = dboText(c, "label", 1, INDENT, 8, 260, 26, dboFmt(F_MEDIUM, 16, C_SECOND, 0.5), false);
   l.text = label;
   if (box == key)
   {
      boxField = dboInput(c, "box", 2, INDENT + 270, 4, BODY_W - INDENT - 270 - 108, 32, dboFmt(F_PLAIN, 18, C_TEXT, 0.5), max, false);
      if (restrict != undefined)
      {
         boxField.restrict = restrict;
      }
      boxField.text = value;
      button(c, "done", 10, BODY_W - 100, 6, 92, "Done", F_MEDIUM, 17, A_BUTTON_REST, function() { takeTyped(); });
      return c;
   }
   var v = dboText(c, "value", 2, INDENT + 270, 8, BODY_W - INDENT - 270 - 108, 26, dboFmt(F_MEDIUM, 17, value != "" ? C_TEXT : C_SECOND, 0.5), false);
   v.text = value != "" ? value : hint;
   if (dboCanType())
   {
      var t = button(c, "type", 10, BODY_W - 100, 6, 92, "Type...", F_MEDIUM, 17, A_ROW_REST, function() { openBox(this.key); });
      t.key = key;
   }
   return c;
}

// One argument of a form: a row of choices for a list of words, a box otherwise, and the people you know for a name
function argRow(a, i)
{
   var label = a.label + (a.optional == true ? " (optional)" : "");
   var opts = listOf(a.options);
   if (a.kind == "enum" && opts.length)
   {
      flowText(label, 16, C_SECOND, INDENT);
      var chips = [];
      for (var k = 0; k < opts.length; k++)
      {
         chips.push([String(opts[k]), function() { vals[this.i] = val(this.i) == this.o && this.opt ? "" : this.o; dboSound("UIMenuFocus"); draw(); }, undefined, false, val(i) == String(opts[k])]);
      }
      var row = flowButtons(chips);
      row._x = INDENT;
      for (var q = 0; q < opts.length; q++)
      {
         row["btn" + q].i = i;
         row["btn" + q].o = String(opts[q]);
         row["btn" + q].opt = a.optional == true;
      }
      return;
   }
   fieldRow("arg:" + i, label, val(i), a.kind == "player" ? "a name or #TAG" : "", MAX_FIELD, a.kind == "number" ? "0-9\\-" : undefined);
   if (a.kind != "player")
   {
      return;
   }
   var q2 = trim(val(i)).toLowerCase();
   var ps = people();
   var found = [];
   var picked = false;
   for (var p = 0; p < ps.length; p++)
   {
      if (ps[p].value == val(i))
      {
         picked = true;
      }
      if (q2 == "" || String(ps[p].label).toLowerCase().indexOf(q2) >= 0 || String(ps[p].value).toLowerCase().indexOf(q2) >= 0)
      {
         found.push(ps[p]);
      }
   }
   found = found.slice(0, MAX_PEOPLE);
   if (picked || !found.length)
   {
      return;
   }
   var b = [];
   for (var m = 0; m < found.length; m++)
   {
      b.push([String(found[m].label), function() { vals[this.i] = this.v; dboSound("UIMenuFocus"); draw(); }]);
   }
   var pr = flowButtons(b);
   pr._x = INDENT;
   for (var n = 0; n < found.length; n++)
   {
      pr["btn" + n].i = i;
      pr["btn" + n].v = String(found[n].value);
   }
}

function drawForm(e)
{
   var f = formOf(e);
   if (f.variants.length > 1)
   {
      var chips = [];
      for (var i = 0; i < f.variants.length; i++)
      {
         var v = f.variants[i];
         var args = listOf(v.args);
         var names = [];
         for (var k = 0; k < args.length; k++)
         {
            names.push(args[k].label);
         }
         chips.push([v.word != undefined && v.word != null && v.word != "" ? String(v.word) : args.length ? names.join(" ") : "just " + e.label,
            function() { endTyping(); vi = this.vi; vals = []; dboSound("UIMenuFocus"); draw(); }, undefined, false, i == vi]);
      }
      var row = flowButtons(chips);
      row._x = INDENT;
      for (var q = 0; q < f.variants.length; q++)
      {
         row["btn" + q].vi = q;
      }
   }
   var cur = variant(e);
   var as = listOf(cur.args);
   for (var j = 0; j < as.length; j++)
   {
      argRow(as[j], j);
   }
   var line = lineOf(cur);
   runRow(e.label + (line != "" ? " " + line : ""), function() { run(this.entry, lineOf(variant(this.entry))); }, busy() || !formReady(cur), e);
}

function runRow(preview, onPick, off, e, label)
{
   var r = flowEntry(preview, [[label != undefined ? label : "Run", onPick, undefined, off]]);
   r.label.textColor = C_SECOND;
   r.btn0.entry = e;
}

function drawAsk(e)
{
   var fields = listOf(e.ask);
   for (var i = 0; i < fields.length; i++)
   {
      fieldRow("ask:" + i, String(fields[i].label), val(i), fields[i].placeholder != undefined ? String(fields[i].placeholder) : "", MAX_FIELD);
   }
   var ws = [];
   for (var j = 0; j < fields.length; j++)
   {
      ws.push(trim(val(j)));
   }
   runRow(e.label + " " + ws.join(" "), function() { var w = []; var fs = listOf(this.entry.ask); for (var k = 0; k < fs.length; k++) { w.push(trim(val(k))); } run(this.entry, w.join(" ")); },
      busy() || !askReady(e), e, "Send");
}

function drawExtra(e)
{
   fieldRow("extra", "Words after " + e.label, extra, "", MAX_FIELD);
   runRow(e.label + (trim(extra) != "" ? " " + trim(extra) : ""), function() { run(this.entry, extra); }, busy(), e);
}

// One command: its button and what it does; a command that asks for words opens its form under it
function entryRow(e, tag)
{
   var desc = (tag != undefined ? "[" + tag + "]  " : "") + e.desc;
   var bare = formOf(e) == null && !listOf(e.ask).length;
   var plain = plainForm(e);
   var dx = LABEL_W + 12 + (bare ? 48 : 0);
   var h = Math.max(36, textHeight(null, desc, 15, BODY_W - dx) + 4);
   var at = flowNeed(h);
   var c = at.clip.createEmptyMovieClip(at.name, fd());
   c._y = at.y;
   var b = button(c, "run", 10, 0, 2, LABEL_W, String(e.label), F_MEDIUM, 17, A_BUTTON_REST, function()
   {
      var en = this.entry;
      if (plainForm(en))
      {
         run(en, lineOf(formOf(en).variants[0]));
      }
      else if (formOf(en) == null && !listOf(en.ask).length)
      {
         run(en, "");
      }
      else
      {
         toggle(en);
      }
   });
   b.entry = e;
   if (busy())
   {
      disable(b);
   }
   if (bare && !plain)
   {
      var more = button(c, "more", 11, LABEL_W + 8, 2, 40, openName == e.name ? "-" : "+", F_MEDIUM, 17, A_ROW_REST, function() { toggle(this.entry); });
      more.entry = e;
   }
   var d = dboText(c, "desc", 1, dx, 6, BODY_W - dx, h, dboFmt(F_MEDIUM, 15, C_SECOND, 0.5), true);
   d.text = desc;
   if (openName != e.name || plain)
   {
      return;
   }
   if (formOf(e) != null)
   {
      drawForm(e);
   }
   else if (listOf(e.ask).length)
   {
      drawAsk(e);
   }
   else
   {
      drawExtra(e);
   }
}

// ---- the head, tools, tabs and foot ----

function drawHead()
{
   var h = clear("head", 20);
   dboTitle(h, "title", 1, PAD, 16, PANEL_W - PAD * 2, "What you can do");
   var s = dboText(h, "sub", 2, PAD, 56, PANEL_W - PAD * 2, 24, dboFmt(F_MEDIUM, 15, C_SECOND, 0.8), false);
   s.text = "Everything here can also be typed in chat. A lone / opens this page.";
   dboDivider(h, PAD, 84, PANEL_W - PAD * 2);
}

function drawSearch()
{
   var a = clear("tools", 30);
   if (box == "search")
   {
      boxField = dboInput(a, "box", 2, PAD, 92, 520, 32, dboFmt(F_PLAIN, 18, C_TEXT, 0.5), MAX_SEARCH, false);
      boxField.text = query;
      button(a, "done", 10, PAD + 528, 94, 100, "Search", F_MEDIUM, 17, A_BUTTON_REST, function() { takeTyped(); });
      return;
   }
   var x = PAD;
   if (dboCanType())
   {
      button(a, "search", 10, x, 94, 200, "Search...", F_MEDIUM, 17, A_ROW_REST, function() { openBox("search"); });
      x += 208;
   }
   if (query != "")
   {
      var f = dboText(a, "filter", 1, x, 96, 400, 28, dboFmt(F_MEDIUM, 17, C_SECOND, 0.8), false);
      f.text = "\"" + query + "\"";
      button(a, "clear", 11, x + 408, 94, 90, "Clear", F_MEDIUM, 17, A_ROW_REST, function() { query = ""; page = 0; dboSound("UIMenuCancel"); draw(); });
   }
}

// The tab row, wrapped onto a second line when it is long; the y below it comes back
function drawTabs()
{
   var t = clear("tabs", 40);
   var y = 134;
   if (words().length)
   {
      return y;
   }
   var list = tabs();
   var now = current();
   var x = PAD;
   for (var j = 0; j < list.length; j++)
   {
      var w = Math.max(100, String(list[j].title).length * 10 + 26);
      if (x > PAD && x + w > PANEL_W - PAD)
      {
         x = PAD;
         y += 36;
      }
      var b = button(t, "t" + j, 10 + j, x, y, w, String(list[j].title), F_MEDIUM, 17, now != null && list[j].key == now.key ? A_FOCUS : A_ROW_REST, function()
      {
         endTyping();
         tab = this.v;
         page = 0;
         openName = "";
         dboSound("UIMenuPrevNext");
         draw();
      });
      b.v = String(list[j].key);
      if (now != null && list[j].key == now.key)
      {
         dboTabMark(b, w - 30);
      }
      x += w + 6;
   }
   return y + 40;
}

function drawFoot(pages)
{
   var f = clear("foot", 60);
   dboDivider(f, PAD, PANEL_H - 62, PANEL_W - PAD * 2);
   var p = dboText(f, "pages", 1, PAD + 220, PANEL_H - 46, 400, 24, dboFmt(F_MEDIUM, 15, C_SECOND, 0.5), false);
   p.text = pages > 1 ? "Page " + (page + 1) + " of " + pages + " (Left / Right)" : "";
   button(f, "switch", 10, PAD, PANEL_H - 48, 200, "Switch character", F_MEDIUM, 17, A_ROW_REST, function()
   {
      endTyping();
      dboSound("UIMenuOK");
      dboSend("dbo:menuClose", []);
      dboSend("dbo:menuSwitchChar", []);
      dboClose();
   });
   button(f, "close", 11, PANEL_W - PAD - 100, PANEL_H - 48, 100, "Close", F_MEDIUM, 20, A_BUTTON_REST, function() { closeMenu(); });
}

// Where a control sits, so the focus can find it again after a redraw
function placeOf(c)
{
   return c._parent._name + "/" + c._name;
}

function draw()
{
   var was = focus >= 0 && focus < actions.length ? placeOf(actions[focus]) : "";
   var typed = box != "" && boxField != null ? String(boxField.text) : null;
   boxField = null;
   actions = [];
   focus = -1;
   drawHead();
   drawSearch();
   var top = drawTabs();
   BODY_H = PANEL_H - 72 - top;
   flowStart(panel, 50, PAD, top);
   if (words().length)
   {
      var rs = results();
      for (var i = 0; i < rs.length; i++)
      {
         entryRow(rs[i].entry, rs[i].title);
      }
      if (!rs.length)
      {
         flowHint("No command matches \"" + query + "\".");
      }
   }
   else
   {
      var c = current();
      if (c != null)
      {
         var es = listOf(c.entries);
         var last = "";
         for (var j = 0; j < es.length; j++)
         {
            if (es[j].section != undefined && es[j].section != "" && es[j].section != last)
            {
               flowHeading(String(es[j].section));
            }
            last = es[j].section != undefined ? String(es[j].section) : "";
            entryRow(es[j]);
         }
         var hints = listOf(c.hints);
         if (hints.length)
         {
            flowGap(6);
         }
         for (var k = 0; k < hints.length; k++)
         {
            flowHint(String(hints[k]));
         }
         if (!es.length && !hints.length)
         {
            flowHint("Nothing here yet.");
         }
      }
   }
   if (typed != null && boxField != null)
   {
      boxField.text = typed;
   }
   // a box whose row is gone (its form closed, the tab changed) gives the keys back
   if (box != "" && boxField == null)
   {
      endTyping();
   }
   var pages = flowShow(page);
   if (page >= pages)
   {
      page = pages - 1;
      flowShow(page);
   }
   drawFoot(pages);
   for (var n = 0; was != "" && n < actions.length; n++)
   {
      if (placeOf(actions[n]) == was)
      {
         setFocus(n);
         break;
      }
   }
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   dboFit(panel, PANEL_W, PANEL_H);
   var bg = panel.createEmptyMovieClip("bg", 1);
   dboGround(bg, PANEL_W, PANEL_H);
   dboWatermark(panel, 5, PANEL_W - 50, 150, 280);
   dboFadeIn(panel);
}

_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || p.nonce == undefined || p.tabs == undefined)
   {
      dboLog("menu: unreadable payload");
      return;
   }
   var first = data == null;
   data = p;
   busyAt = 0;
   // a re-sent panel (a topic asked for by name) picks up its tab and its search; a search for a command by name opens its form
   if (p.tab != undefined && p.tab != "")
   {
      tab = String(p.tab);
   }
   else if (first && tabs().length)
   {
      tab = String(tabs()[0].key);
   }
   if (p.search != undefined && p.search != "")
   {
      query = trim(p.search);
      page = 0;
      var want = query.toLowerCase();
      var rs = results();
      for (var i = 0; i < rs.length; i++)
      {
         if (String(rs[i].entry.name) == want && !plainForm(rs[i].entry) && openName != want)
         {
            openName = want;
            vi = 0;
            vals = [];
         }
      }
   }
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = dboKey();
   if (box != "")
   {
      if (code == 27)
      {
         dboSound("UIMenuCancel");
         endTyping();
         draw();
      }
      else if (code == 13)
      {
         takeTyped();
      }
      return;
   }
   if (code == 27)
   {
      if (openName != "")
      {
         openName = "";
         dboSound("UIMenuCancel");
         draw();
         return;
      }
      closeMenu();
      return;
   }
   if (data == null)
   {
      return;
   }
   if (code == 38 && actions.length)
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
   else if ((code == 37 || code == 33) && page > 0)
   {
      dboSound("UIMenuPrevNext");
      page--;
      draw();
   }
   else if ((code == 39 || code == 34) && flow != null && page + 1 < flow.pages.length)
   {
      dboSound("UIMenuPrevNext");
      page++;
      draw();
   }
};
dboKeys(keys);

_root.onEnterFrame = function()
{
   if (data == null && getTimer() - builtAt >= NO_DATA_CLOSE_MS)
   {
      dboLog("menu: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
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
