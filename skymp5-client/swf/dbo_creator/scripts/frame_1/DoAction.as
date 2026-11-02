// The character creator as a native panel (charCreatorService, widget type charCreator). It holds no rules: the client's
// creatorModel.ts sends the page to draw (_root.dboData: step, steps, sections of rows, back, next, finish) and this sends
// every choice back as cc:act [key, value], to be answered with the next page. Docked at the right so the character
// stays in view; the Story step widens, since its fields are typed in boxes (lib/dbo-form.as rows).
// Rows: text {text, tone}, chips {key, options [{v, label, on, off}]}, carousel {key, label, value}, stepper {key, label,
// value, hint, steps, dec, inc}, swatches {key, label, none, colors [{rgb, on}]}, field {key, label, value, max, lines, hint}.

var DBO_SWF_VERSION = "creator-1";
var NARROW_W = 540;
var WIDE_W = 1000;
var PANEL_H = 680;
var PAD = 26;
var BODY_TOP = 112;
var FOOT_H = 64;
var NO_DATA_CLOSE_MS = 8000;
var BUSY_MS = 6000;
var C_RED = 0xB23A3A;

var panel;
var panelW = NARROW_W;
var data = null;
var page = 0;
var busy = false;
var busyAt = 0;
var builtAt = getTimer();
// the Story step's typed values, kept as dbo-form's vals so its boxes work; sent to the client as each is done
var typed = {};

function act(key, value)
{
   if (data == null || (busy && key != "back"))
   {
      return;
   }
   busy = true;
   busyAt = getTimer();
   dboSend("cc:act", value === undefined ? [key] : [key, value]);
}

formHost.busy = function() { return data != null && data.finish != null && data.finish.waiting == true; };
formHost.redraw = function() { sendTyped(); draw(); };
formHost.fallback = null;
formHost.fallbackText = "the browser creator";

// A box that was just done: its text goes to the model, which says whether the name will do
function sendTyped()
{
   if (data == null || data.step != 5)
   {
      return;
   }
   for (var k in typed)
   {
      if (typed[k] != fieldValue(k))
      {
         act(k, typed[k]);
      }
   }
}

function fieldValue(key)
{
   var rows = allRows();
   for (var i = 0; i < rows.length; i++)
   {
      if (rows[i].kind == "field" && rows[i].key == key)
      {
         return String(rows[i].value);
      }
   }
   return "";
}

function allRows()
{
   var out = [];
   var secs = listOf(data.sections);
   for (var i = 0; i < secs.length; i++)
   {
      out = out.concat(listOf(secs[i].rows));
   }
   return out;
}

// dboFit's placing, at the right edge instead of the centre; done again on every resize and whenever the width changes
function place()
{
   var v = dboVisible();
   var m = 16;
   var s = Math.min(1, Math.min((v.width - m * 2) / panelW, (v.height - m * 2) / PANEL_H));
   panel._xscale = s * 100;
   panel._yscale = s * 100;
   panel._x = panelW == WIDE_W ? v.left + (v.width - panelW * s) / 2 : v.left + v.width - panelW * s - m;
   panel._y = v.top + (v.height - PANEL_H * s) / 2;
}

function drawGround()
{
   var bg = clear("bg", 1);
   dboGround(bg, panelW, PANEL_H);
}

function drawHead()
{
   var h = clear("head", 20);
   var steps = listOf(data.steps);
   dboTitle(h, "title", 1, PAD, 16, panelW - PAD * 2, "Create your character");
   var s = dboText(h, "steps", 2, PAD, 56, panelW - PAD * 2, 24, dboFmt(F_MEDIUM, 16, C_SECOND, 0.6), false);
   s.text = "Step " + data.step + " of " + steps.length + ":  " + String(steps[data.step - 1]);
   dboDivider(h, PAD, 92, panelW - PAD * 2);
}

function rowChips(r)
{
   var opts = listOf(r.options);
   var bs = [];
   for (var i = 0; i < opts.length; i++)
   {
      bs.push([String(opts[i].label), pick(r.key, opts[i].v), undefined, opts[i].off == true || formHost.busy(), opts[i].on == true]);
   }
   flowButtons(bs);
}

function pick(key, value)
{
   return function() { dboSound("UIMenuOK"); act(key, value); };
}

function rowCarousel(r)
{
   flowEntry(String(r.label) + ":  " + String(r.value), [["<", pick(r.key, -1)], [">", pick(r.key, 1)]]);
}

function rowStepper(r)
{
   var st = listOf(r.steps);
   var bs = [];
   for (var i = 0; i < st.length; i++)
   {
      var n = Number(st[i]);
      bs.push([(n > 0 ? "+" : "") + n, pick(r.key, n), undefined, n < 0 ? r.dec != true : r.inc != true]);
   }
   flowEntry(String(r.label) + ":  " + String(r.value), [], r.hint != undefined ? String(r.hint) : "");
   flowStepButtons(bs);
}

// A stepper's buttons, small, on their own line under its label
function flowStepButtons(bs)
{
   var at = flowNeed(36);
   var c = at.clip.createEmptyMovieClip(at.name, fd());
   c._y = at.y;
   for (var i = 0; i < bs.length; i++)
   {
      var b = button(c, "s" + i, 10 + i, i * 70, 0, 62, bs[i][0], F_MEDIUM, 16, A_BUTTON_REST, bs[i][1]);
      if (bs[i][3] == true)
      {
         disable(b);
      }
   }
}

function rowSwatches(r)
{
   flowText(String(r.label), 16, C_SECOND);
   var cols = listOf(r.colors);
   var per = Math.floor(BODY_W / 40);
   var n = cols.length + (r.none != null ? 1 : 0);
   var at = flowNeed(Math.ceil(Math.max(1, n) / per) * 40 + 4);
   var c = at.clip.createEmptyMovieClip(at.name, fd());
   c._y = at.y;
   var k = 0;
   if (r.none != null)
   {
      button(c, "none", 10, 0, 0, 34, "-", F_MEDIUM, 18, r.none.on == true ? A_FOCUS : A_ROW_REST, pick(r.key, -1));
      k++;
   }
   for (var i = 0; i < cols.length; i++)
   {
      var x = (k % per) * 40;
      var y = Math.floor(k / per) * 40;
      var b = button(c, "c" + i, 20 + i, x, y, 34, "", F_MEDIUM, 18, cols[i].on == true ? A_FOCUS : A_BUTTON_REST, pick(r.key, i));
      dboBox(b, 3, 3, 28, 22, Number(cols[i].rgb), 100);
      if (cols[i].on == true)
      {
         dboBox(b, 0, 30, 34, 3, C_ACCENT, 100);
      }
      k++;
   }
}

function rowField(r)
{
   if (typed[r.key] == undefined || fbox != r.key)
   {
      typed[r.key] = String(r.value);
   }
   formField({key: r.key, label: r.label, kind: "text", max: r.max, lines: r.lines, hint: r.hint}, typed);
}

function rowText(r)
{
   var tone = String(r.tone);
   if (tone == "heading")
   {
      flowText(String(r.text), 20, C_SILVER);
   }
   else if (tone == "label")
   {
      flowText(String(r.text), 16, C_SECOND);
   }
   else if (tone == "error")
   {
      flowText(String(r.text), 17, C_RED);
   }
   else if (tone == "note")
   {
      flowHint(String(r.text));
   }
   else
   {
      flowText(String(r.text), 17, C_TEXT);
   }
}

function drawBody()
{
   BODY_W = panelW - PAD * 2;
   BODY_H = PANEL_H - BODY_TOP - FOOT_H - 8;
   formBegin();
   // the typed boxes are dbo-form rows: they need a form open to keep what is typed
   forming = data.step == 5 ? {build: null, vals: typed} : null;
   flowStart(panel, 40, PAD, BODY_TOP);
   var secs = listOf(data.sections);
   for (var i = 0; i < secs.length; i++)
   {
      flowHeading(String(secs[i].heading));
      var rows = listOf(secs[i].rows);
      for (var j = 0; j < rows.length; j++)
      {
         var r = rows[j];
         var kind = String(r.kind);
         if (kind == "chips") rowChips(r);
         else if (kind == "carousel") rowCarousel(r);
         else if (kind == "stepper") rowStepper(r);
         else if (kind == "swatches") rowSwatches(r);
         else if (kind == "field") rowField(r);
         else rowText(r);
      }
      flowGap(8);
   }
   if (data.step == 5 && !dboCanType())
   {
      flowEntry("This game cannot take typed input in a panel.", [["Browser", pick("browser", 1)]]);
   }
   formEnd();
   var n = flowShow(page);
   page = flow.shown;
   return n;
}

function drawFoot(total)
{
   var f = clear("foot", 60);
   var y = PANEL_H - FOOT_H + 14;
   dboDivider(f, PAD, y - 12, panelW - PAD * 2);
   var b = button(f, "back", 10, PAD, y, 100, "Back", F_MEDIUM, 18, A_BUTTON_REST, function() { dboSound("UIMenuCancel"); act("back"); });
   if (data.back != true)
   {
      disable(b);
   }
   if (total > 1)
   {
      var pt = dboText(f, "page", 3, PAD + 110, y + 4, 130, 24, dboFmt(F_MEDIUM, 15, C_SECOND, 0.5, "center"), false);
      pt.text = "Page " + (page + 1) + " / " + total;
      var pv = button(f, "prev", 11, PAD + 110, y - 26, 60, "<", F_MEDIUM, 16, A_BUTTON_REST, function() { turn(-1); });
      var nx = button(f, "nextp", 12, PAD + 180, y - 26, 60, ">", F_MEDIUM, 16, A_BUTTON_REST, function() { turn(1); });
      if (page == 0) disable(pv);
      if (page >= total - 1) disable(nx);
   }
   var right = panelW - PAD - 140;
   if (data.finish != null)
   {
      var fin = button(f, "finish", 20, right, y, 140, data.finish.waiting == true ? "Forging..." : "Finish", F_MEDIUM, 18, A_BUTTON_REST, function()
      {
         if (fbox != "")
         {
            takeFormTyped();
         }
         dboSound("UIMenuOK");
         act("finish");
      });
      if (data.finish.on != true)
      {
         disable(fin);
      }
   }
   else
   {
      var nb = button(f, "next", 20, right, y, 140, "Next", F_MEDIUM, 18, A_BUTTON_REST, function() { dboSound("UIMenuOK"); act("next"); });
      if (data.next != true)
      {
         disable(nb);
      }
   }
}

function turn(d)
{
   if (flow == null || page + d < 0 || page + d >= flow.pages.length)
   {
      return;
   }
   dboSound("UIMenuPrevNext");
   page += d;
   draw();
}

function draw()
{
   if (data == null)
   {
      return;
   }
   var w = data.step == 5 ? WIDE_W : NARROW_W;
   if (w != panelW)
   {
      panelW = w;
      place();
   }
   actions = [];
   focus = -1;
   drawGround();
   drawHead();
   var n = drawBody();
   drawFoot(n);
   for (var i = 0; i < actions.length; i++)
   {
      actions[i].idx = i;
   }
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   place();
   dboFits.push(place);
   var l = {};
   l.onResize = place;
   Stage.addListener(l);
   dboFadeIn(panel);
}

var shownStep = 0;
_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || p.type != "charCreator" || !(p.sections instanceof Array))
   {
      dboLog("creator: unreadable payload");
      return;
   }
   if (p.step != shownStep)
   {
      shownStep = p.step;
      page = 0;
      typed = {};
      endFormTyping();
   }
   busy = false;
   data = p;
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = dboKey();
   if (fbox != "" && formKey(code))
   {
      return;
   }
   if (code == 27)
   {
      if (data == null)
      {
         dboSound("UIMenuCancel");
         dboSend("close", []);
         dboClose();
      }
      else if (data.back == true)
      {
         dboSound("UIMenuCancel");
         act("back");
      }
      return;
   }
   if (data == null)
   {
      return;
   }
   if (code == 37 || code == 33)
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
dboKeys(keys);

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
      dboLog("creator: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
      delete _root.onEnterFrame;
      dboSend("close", []);
      dboClose();
   }
   if (busy && getTimer() - busyAt >= BUSY_MS)
   {
      busy = false;
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
