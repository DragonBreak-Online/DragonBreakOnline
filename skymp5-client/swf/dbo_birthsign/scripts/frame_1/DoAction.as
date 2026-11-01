// The birthsign picker as a native panel: a port of skymp5-front features/birthsignPicker, same messages and words.
// The server (birthsigns.js) decides; Escape closes and it asks again later. Choosing asks once more, as in the browser.

var DBO_SWF_VERSION = "birthsign-1";
var PANEL_W = 1000;
var PANEL_H = 640;
var PAD = 28;
var ROW_H = 34;
var MAX_ROWS = 9;
var LIST_W = 360;
var LIST_TOP = 150;
var DETAIL_X = 430;
var EMBLEM = 120;
var NO_DATA_CLOSE_MS = 8000;

var panel;
var data = null;
var nonce = "";
var rowTop = 0;
var selected = "";
var confirming = false;
var bar = null;
var builtAt = getTimer();

// ---- order (pure; tests/birthsign-native-harness.js runs this block in node) ----
// BIRTHSIGN-ORDER-BEGIN
// Each Guardian with its charges under it, in the order sent, then every sign under no Guardian present
function signOrder(signs)
{
   var out = [];
   var ids = {};
   for (var i = 0; i < signs.length; i++)
   {
      if (signs[i].guardian == "")
      {
         ids[signs[i].id] = true;
      }
   }
   for (var g = 0; g < signs.length; g++)
   {
      if (signs[g].guardian != "")
      {
         continue;
      }
      out.push(signs[g]);
      for (var c = 0; c < signs.length; c++)
      {
         if (signs[c].guardian == signs[g].id)
         {
            out.push(signs[c]);
         }
      }
   }
   for (var b = 0; b < signs.length; b++)
   {
      if (signs[b].guardian != "" && ids[signs[b].guardian] != true)
      {
         out.push(signs[b]);
      }
   }
   return out;
}

function kickerOf(s, signs)
{
   if (s.guardian == "")
   {
      return "Guardian";
   }
   if (s.guardian == "none")
   {
      return "Wanders";
   }
   for (var i = 0; i < signs.length; i++)
   {
      if (signs[i].id == s.guardian)
      {
         return "Charge of " + signs[i].name;
      }
   }
   return "";
}
// BIRTHSIGN-ORDER-END

// The browser's art for a payload without emblems: stars on a 40 x 40 grid, then the lines between them by index
var EMBLEMS = {
   warrior: [[[20, 5], [20, 35], [11, 13], [29, 13], [20, 13]], [[0, 4], [4, 1], [2, 4], [4, 3]]],
   lady: [[[20, 6], [13, 15], [27, 15], [15, 33], [25, 33], [20, 22]], [[0, 1], [0, 2], [1, 5], [2, 5], [5, 3], [5, 4]]],
   steed: [[[8, 26], [15, 18], [24, 16], [32, 10], [31, 22], [16, 31]], [[0, 1], [1, 2], [2, 3], [2, 4], [1, 5]]],
   lord: [[[20, 4], [12, 12], [28, 12], [20, 20], [13, 34], [27, 34]], [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [3, 5]]],
   mage: [[[20, 4], [14, 10], [26, 10], [20, 16], [20, 36]], [[0, 1], [1, 3], [3, 2], [2, 0], [3, 4]]],
   apprentice: [[[10, 30], [17, 22], [24, 16], [31, 8], [27, 27]], [[0, 1], [1, 2], [2, 3], [2, 4]]],
   atronach: [[[20, 5], [32, 14], [28, 31], [12, 31], [8, 14], [20, 20]], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [5, 0], [5, 2], [5, 3]]],
   ritual: [[[20, 6], [30, 14], [30, 28], [20, 34], [10, 28], [10, 14]], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [0, 3]]],
   thief: [[[10, 8], [18, 16], [22, 24], [30, 32], [30, 10], [10, 30]], [[0, 1], [1, 2], [2, 3], [4, 2], [2, 5]]],
   lover: [[[20, 34], [8, 18], [14, 8], [20, 14], [26, 8], [32, 18]], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]]],
   shadow: [[[14, 6], [26, 10], [30, 22], [22, 34], [12, 26]], [[0, 1], [1, 2], [2, 3], [3, 4]]],
   tower: [[[14, 36], [26, 36], [15, 18], [25, 18], [20, 5]], [[0, 2], [1, 3], [2, 3], [2, 4], [3, 4]]],
   serpent: [[[6, 30], [12, 22], [20, 26], [26, 16], [32, 20], [34, 8]], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]]
};

function signs()
{
   return signOrder(data.signs);
}

function byId(id)
{
   for (var i = 0; i < data.signs.length; i++)
   {
      if (data.signs[i].id == id)
      {
         return data.signs[i];
      }
   }
   return null;
}

function closePicker()
{
   dboSound("UIMenuCancel");
   dboSend("dbo:birthsignClose", [nonce]);
   dboClose();
}

function pick(s)
{
   dboSound("UIMenuOK");
   dboSend("dbo:birthsignPick", [nonce, s.id]);
}

function circle(c, cx, cy, r)
{
   var k = 0.4142;
   c.moveTo(cx + r, cy);
   c.curveTo(cx + r, cy + r * k, cx + r * 0.7071, cy + r * 0.7071);
   c.curveTo(cx + r * k, cy + r, cx, cy + r);
   c.curveTo(cx - r * k, cy + r, cx - r * 0.7071, cy + r * 0.7071);
   c.curveTo(cx - r, cy + r * k, cx - r, cy);
   c.curveTo(cx - r, cy - r * k, cx - r * 0.7071, cy - r * 0.7071);
   c.curveTo(cx - r * k, cy - r, cx, cy - r);
   c.curveTo(cx + r * k, cy - r, cx + r * 0.7071, cy - r * 0.7071);
   c.curveTo(cx + r, cy - r * k, cx + r, cy);
}

// The payload's emblem, or this panel's copy of the browser's art by id; none leaves the slot empty
function drawEmblem(c, s, size)
{
   var stars = null;
   var lines = [];
   if (s.emblem != undefined && s.emblem != null && s.emblem.stars instanceof Array)
   {
      stars = s.emblem.stars;
      lines = s.emblem.lines instanceof Array ? s.emblem.lines : [];
   }
   else if (s.emblem !== null && EMBLEMS[s.id] != undefined)
   {
      stars = EMBLEMS[s.id][0];
      lines = EMBLEMS[s.id][1];
   }
   if (stars == null || !stars.length)
   {
      return;
   }
   var k = size / 40;
   c.lineStyle(1, C_STONE_LIGHT, 70);
   circle(c, 20 * k, 20 * k, 19 * k);
   c.lineStyle(1, C_ACCENT, 80);
   for (var i = 0; i < lines.length; i++)
   {
      var p = stars[lines[i][0]];
      var q = stars[lines[i][1]];
      if (p != undefined && q != undefined)
      {
         c.moveTo(p[0] * k, p[1] * k);
         c.lineTo(q[0] * k, q[1] * k);
      }
   }
   c.lineStyle();
   for (var j = 0; j < stars.length; j++)
   {
      c.beginFill(C_SILVER, 100);
      circle(c, stars[j][0] * k, stars[j][1] * k, (j == 0 ? 1.9 : 1.5) * k);
      c.endFill();
   }
}

function drawHead()
{
   var h = clear("head", 30);
   dboTitle(h, "title", 1, PAD, 18, PANEL_W - PAD * 2, data.title != undefined ? String(data.title) : "Choose your birthsign");
   var sub = dboText(h, "sub", 2, PAD, 58, PANEL_W - PAD * 2, 26, dboFmt(F_MEDIUM, 18, C_SECOND, 0.8), false);
   sub.text = data.sub != undefined ? String(data.sub) : "The stars you were born under. Yours for life; only staff can change it later.";
   if (data.notice != undefined && String(data.notice) != "")
   {
      var n = dboText(h, "notice", 3, PAD, 86, PANEL_W - PAD * 2, 50, dboFmt(F_MEDIUM, 18, C_TEXT, 0.8), true);
      n.text = String(data.notice);
   }
   dboDivider(h, PAD, 138, PANEL_W - PAD * 2);
}

function drawList()
{
   var l = clear("list", 40);
   var list = signs();
   rowTop = scrollClamp(rowTop, list.length, MAX_ROWS);
   for (var i = 0; i < MAX_ROWS && rowTop + i < list.length; i++)
   {
      var s = list[rowTop + i];
      var on = s.id == selected;
      var c = l.createEmptyMovieClip("r" + i, 10 + i);
      c._x = PAD;
      c._y = LIST_TOP + i * ROW_H;
      dboBox(c, 0, 0, LIST_W, ROW_H - 4, 0x000000, 1);
      var nt = dboText(c, "label", 2, s.guardian == "" ? 4 : 20, 2, LIST_W - 24, ROW_H - 4, dboFmt(s.guardian == "" ? F_BOLD : F_MEDIUM, 20, C_TEXT, 0.8), false);
      nt.text = String(s.name);
      var kt = dboText(c, "kicker", 3, 4, 7, LIST_W - 8, ROW_H - 8, dboFmt(F_MEDIUM, 14, C_SECOND, 0.8, "right"), false);
      kt.text = s.guardian == "" ? "Guardian" : (s.guardian == "none" ? "Wanders" : "");
      if (on)
      {
         dboRule(c, 4, ROW_H - 5, LIST_W - 4);
      }
      c.rest = on ? A_FOCUS : A_ROW_REST;
      c._alpha = c.rest;
      c.signId = s.id;
      c.washW = LIST_W;
      c.washH = ROW_H - 4;
      c.idx = actions.length;
      actions.push(c);
      c.onPick = function()
      {
         dboSound("UIMenuFocus");
         selected = this.signId;
         confirming = false;
         draw();
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
   bar.set(list.length, MAX_ROWS, rowTop);
}

function drawDetail()
{
   var d = clear("detail", 50);
   var w = PANEL_W - DETAIL_X - PAD;
   var s = byId(selected);
   if (s == null)
   {
      var e = dboText(d, "empty", 1, DETAIL_X, LIST_TOP + 10, w, 60, dboFmt(F_MEDIUM, 20, C_SECOND, 0.8), true);
      e.text = "Choose a sign on the left to read its lore and its gift.";
      return;
   }
   var em = d.createEmptyMovieClip("emblem", 1);
   em._x = DETAIL_X;
   em._y = LIST_TOP;
   drawEmblem(em, s, EMBLEM);
   var tx = DETAIL_X + EMBLEM + 20;
   var nt = dboText(d, "name", 2, tx, LIST_TOP + 20, w - EMBLEM - 20, 40, dboFmt(F_PLAIN, 28, C_TEXT, 1.0), false);
   nt.text = String(s.name);
   var kt = dboText(d, "kicker", 3, tx, LIST_TOP + 60, w - EMBLEM - 20, 24, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8), false);
   kt.text = kickerOf(s, data.signs);
   var y = LIST_TOP + EMBLEM + 16;
   var lt = dboText(d, "lore", 4, DETAIL_X, y, w, 150, dboFmt(F_MEDIUM, 18, C_TEXT, 0.8), true);
   lt.text = String(s.lore);
   y += 160;
   dboDivider(d, DETAIL_X, y, w);
   var ft = dboText(d, "effect", 5, DETAIL_X, y + 12, w, 90, dboFmt(F_MEDIUM, 18, C_ACCENT, 0.8), true);
   ft.text = String(s.effect);
}

function drawFoot()
{
   var f = clear("foot", 60);
   var y = PANEL_H - 60;
   dboDivider(f, PAD, y - 12, PANEL_W - PAD * 2);
   var s = byId(selected);
   if (confirming && s != null)
   {
      var q = dboText(f, "ask", 1, PAD, y - 40, PANEL_W - PAD * 2, 26, dboFmt(F_MEDIUM, 18, C_TEXT, 0.8), false);
      q.text = "Be born under " + s.name + "? It is yours for life; only staff can change it.";
      button(f, "go", 10, PAD, y, 320, "Born under " + s.name, F_MEDIUM, 20, A_BUTTON_REST, function()
      {
         pick(byId(selected));
      });
      button(f, "back", 11, PAD + 330, y, 140, "Back", F_MEDIUM, 20, A_BUTTON_REST, function()
      {
         dboSound("UIMenuCancel");
         confirming = false;
         draw();
      });
      return;
   }
   var t = button(f, "take", 10, PAD, y, 320, s != null ? "Choose " + s.name : "Choose a sign", F_MEDIUM, 20, A_BUTTON_REST, function()
   {
      if (byId(selected) != null)
      {
         dboSound("UIMenuOK");
         confirming = true;
         draw();
      }
   });
   if (s == null)
   {
      disable(t);
   }
   button(f, "close", 12, PANEL_W - PAD - 140, y, 140, "Later", F_MEDIUM, 20, A_BUTTON_REST, function()
   {
      closePicker();
   });
}

function draw()
{
   actions = [];
   focus = -1;
   drawList();
   drawDetail();
   drawFoot();
   drawHead();
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   dboFit(panel, PANEL_W, PANEL_H);
   var bg = panel.createEmptyMovieClip("bg", 1);
   dboGround(bg, PANEL_W, PANEL_H);
   dboWatermark(panel, 5, PANEL_W - 40, 190, 360);
   // Made once, never with the list: a bar per redraw would add a wheel listener each time
   var hit = panel.createEmptyMovieClip("hit", 6);
   dboBox(hit, PAD, LIST_TOP, LIST_W + 16, MAX_ROWS * ROW_H, 0x000000, 0);
   bar = scrollbar(panel, "bar", 45, PAD + LIST_W + 8, LIST_TOP, MAX_ROWS * ROW_H - 4, hit);
   bar.onScroll = function(offset)
   {
      rowTop = offset;
      draw();
   };
   bar._visible = false;
   dboFadeIn(panel);
}

// A new payload (a new nonce) starts again from the list, as the browser's does
_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || !(p.signs instanceof Array))
   {
      dboLog("birthsign: unreadable payload");
      return;
   }
   var fresh = String(p.nonce) != nonce;
   data = p;
   nonce = p.nonce != undefined ? String(p.nonce) : "";
   if (fresh)
   {
      selected = "";
      confirming = false;
      rowTop = 0;
   }
   draw();
};

function scrollBy(d)
{
   if (data == null)
   {
      return;
   }
   var t = scrollClamp(rowTop + d, signs().length, MAX_ROWS);
   if (t != rowTop)
   {
      rowTop = t;
      draw();
   }
}

var keys = {};
keys.onKeyDown = function()
{
   var code = dboKey();
   if (code == 27)
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
   if ((code == 38 || code == 87) && actions.length)
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
   else if (code == 33)
   {
      scrollBy(-MAX_ROWS);
   }
   else if (code == 34)
   {
      scrollBy(MAX_ROWS);
   }
};
dboKeys(keys);

_root.onEnterFrame = function()
{
   if (data == null && getTimer() - builtAt >= NO_DATA_CLOSE_MS)
   {
      dboLog("birthsign: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
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
