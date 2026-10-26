// Shared AS2 for DBO panels, prepended to each menu's frame script by build-swf.js. Style values follow swf/STYLE.md.

var DBO_UI_EVENT = "dboUi";
var DBO_MENU = "CustomMenu";
var DBO_SEP = String.fromCharCode(1);
var DBO_US = String.fromCharCode(0x1f);
var DBO_RS = String.fromCharCode(0x1e);

// The client also polls _root.dboOut with Ui.getString (SendModEvent was never seen to arrive): seq US key US json RS,
// appended only, the separator last; the sequence lets the client take a message once when both channels deliver it
_root.dboOut = "";
var dboSeq = 0;

var F_PLAIN = "$EverywhereFont";
var F_MEDIUM = "$EverywhereMediumFont";
var F_BOLD = "$EverywhereBoldFont";
var C_TEXT = 0xFFFFFF;
// The branded look (Nat chose B, 26 Oct; STYLE.md section 11): the web front's dbo-theme, in our own vector art
var C_SECOND = 0x8C9A9C;
var C_SILVER = 0xE6ECEC;
var C_ACCENT = 0x8FD3D0;
var C_STONE = 0x5D6B6E;
var C_STONE_LIGHT = 0x8C9A9C;
var C_GROUND = 0x08191C;
var C_GROUND_2 = 0x0F2A2E;
// our hourglass, shipped as a loose DDS (launcher extras) and loaded by relative path, the way the map probe proved
var DBO_HOURGLASS = "../textures/interface/dbo/dbo-hourglass.dds";
var C_DISABLED = 0x606060;
// rows and tabs at rest; brighter than vanilla's 30 so they read on the teal ground
var A_ROW_REST = 50;
var A_BUTTON_REST = 80;
var A_FOCUS = 100;
var FADE_MS = 300;

// _global.skse does not exist on frame 1 (Worker 4, measured 26 Oct): nothing touches it until dboBoot sees it
var dboBooted = false;
var dboQueue = [];
var dboCloseWanted = false;

function dboHaveSkse()
{
   return _global.skse != undefined;
}

function dboLog(msg)
{
   if (!dboBooted)
   {
      dboQueue.push(["log", msg]);
   }
   else if (_global.skse.Log != undefined)
   {
      _global.skse.Log("[dbo] " + msg);
   }
}

// SKSE's CustomMenu registers "PlaySound"; GameDelegate's wire shape is (name, uid, args...). Dropped before boot
function dboSound(name)
{
   if (dboBooted)
   {
      flash.external.ExternalInterface.call("PlaySound", 0, name);
   }
}

function dboDispatch(msgKey, json, n)
{
   dboSeq++;
   _root.dboOut += dboSeq + DBO_US + msgKey + DBO_US + json + DBO_RS;
   if (_global.skse.SendModEvent != undefined)
   {
      _global.skse.SendModEvent(DBO_UI_EVENT, msgKey + DBO_SEP + json, n);
   }
}

// One message: the client splits key and JSON args and calls sendMessage(key, ...args); num is numArg
function dboSend(msgKey, args, num)
{
   // the panel is gone for the player once dboClose ran: a key pressed in the frames before the menu closes sends nothing
   if (dboClosing)
   {
      return false;
   }
   var json = dboJson(args);
   var n = num == undefined ? 0 : num;
   if (!dboBooted)
   {
      dboQueue.push(["send", msgKey, json, n]);
      return true;
   }
   dboDispatch(msgKey, json, n);
   return true;
}

// The panel hides at once and the menu closes DBO_CLOSE_FRAMES later: the client reads the outbox on its update, so a
// message sent just before (a cancel, a verdict) must still be there to be read when the movie goes
var DBO_CLOSE_FRAMES = 6;
var dboClosing = false;

// Key.getCode() with the numpad digits read as the row digits 1-9
function dboKey()
{
   var code = Key.getCode();
   return code >= 97 && code <= 105 ? code - 48 : code;
}

function dboClose()
{
   if (!dboBooted)
   {
      dboCloseWanted = true;
      return;
   }
   if (_root.dboCloser != undefined)
   {
      return;
   }
   _root._visible = false;
   dboClosing = true;
   var c = _root.createEmptyMovieClip("dboCloser", 9998);
   c.frames = 0;
   c.onEnterFrame = function()
   {
      this.frames++;
      if (this.frames < DBO_CLOSE_FRAMES)
      {
         return;
      }
      delete this.onEnterFrame;
      if (_global.skse.CloseMenu != undefined)
      {
         _global.skse.CloseMenu(DBO_MENU);
      }
   };
}

// Polls each frame for _global.skse, then runs onReady(frame it appeared on) and flushes what was queued before it.
// The client reads the ready frame from numArg (scaleformMenu.ts parseUiEvent)
function dboBoot(onReady)
{
   var c = _root.createEmptyMovieClip("dboBootClip", 9999);
   c.frames = 0;
   c.onEnterFrame = function()
   {
      this.frames++;
      if (!dboHaveSkse())
      {
         return;
      }
      delete this.onEnterFrame;
      dboBooted = true;
      onReady(this.frames);
      var q = dboQueue;
      dboQueue = [];
      for (var i = 0; i < q.length; i++)
      {
         if (q[i][0] == "log")
         {
            dboLog(q[i][1]);
         }
         else
         {
            dboDispatch(q[i][1], q[i][2], q[i][3]);
         }
      }
      if (dboCloseWanted)
      {
         dboClose();
      }
   };
}

// ---- JSON ----

function dboJsonStr(s)
{
   var out = "\"";
   for (var i = 0; i < s.length; i++)
   {
      var c = s.charAt(i);
      var n = s.charCodeAt(i);
      if (c == "\"" || c == "\\")
      {
         out += "\\" + c;
      }
      else if (n < 32)
      {
         var h = n.toString(16);
         out += "\\u" + (h.length < 2 ? "000" : "00") + h;
      }
      else
      {
         out += c;
      }
   }
   return out + "\"";
}

function dboJson(v)
{
   if (v == null || v == undefined)
   {
      return "null";
   }
   var t = typeof v;
   if (t == "number")
   {
      return isFinite(v) ? String(v) : "null";
   }
   if (t == "boolean")
   {
      return v ? "true" : "false";
   }
   if (t == "string")
   {
      return dboJsonStr(v);
   }
   var parts = [];
   if (v instanceof Array)
   {
      for (var i = 0; i < v.length; i++)
      {
         parts.push(dboJson(v[i]));
      }
      return "[" + parts.join(",") + "]";
   }
   for (var k in v)
   {
      parts.push(dboJsonStr(k) + ":" + dboJson(v[k]));
   }
   return "{" + parts.join(",") + "}";
}

var dboJsonSrc;
var dboJsonAt;

function dboJsonWs()
{
   while (dboJsonAt < dboJsonSrc.length)
   {
      var c = dboJsonSrc.charAt(dboJsonAt);
      if (c != " " && c != "\t" && c != "\n" && c != "\r")
      {
         return;
      }
      dboJsonAt++;
   }
}

function dboJsonValue()
{
   dboJsonWs();
   var c = dboJsonSrc.charAt(dboJsonAt);
   if (c == "{")
   {
      var o = {};
      dboJsonAt++;
      dboJsonWs();
      if (dboJsonSrc.charAt(dboJsonAt) == "}")
      {
         dboJsonAt++;
         return o;
      }
      while (dboJsonAt < dboJsonSrc.length)
      {
         dboJsonWs();
         var key = dboJsonValue();
         dboJsonWs();
         dboJsonAt++;
         o[key] = dboJsonValue();
         dboJsonWs();
         var e = dboJsonSrc.charAt(dboJsonAt++);
         if (e != ",")
         {
            return o;
         }
      }
      return o;
   }
   if (c == "[")
   {
      var a = [];
      dboJsonAt++;
      dboJsonWs();
      if (dboJsonSrc.charAt(dboJsonAt) == "]")
      {
         dboJsonAt++;
         return a;
      }
      while (dboJsonAt < dboJsonSrc.length)
      {
         a.push(dboJsonValue());
         dboJsonWs();
         var e2 = dboJsonSrc.charAt(dboJsonAt++);
         if (e2 != ",")
         {
            return a;
         }
      }
      return a;
   }
   if (c == "\"")
   {
      var s = "";
      dboJsonAt++;
      while (dboJsonAt < dboJsonSrc.length)
      {
         var ch = dboJsonSrc.charAt(dboJsonAt++);
         if (ch == "\"")
         {
            return s;
         }
         if (ch == "\\")
         {
            var esc = dboJsonSrc.charAt(dboJsonAt++);
            if (esc == "n")
            {
               s += "\n";
            }
            else if (esc == "t")
            {
               s += "\t";
            }
            else if (esc == "r")
            {
               s += "\r";
            }
            else if (esc == "b" || esc == "f")
            {
            }
            else if (esc == "u")
            {
               s += String.fromCharCode(parseInt(dboJsonSrc.substr(dboJsonAt, 4), 16));
               dboJsonAt += 4;
            }
            else
            {
               s += esc;
            }
         }
         else
         {
            s += ch;
         }
      }
      return s;
   }
   if (dboJsonSrc.substr(dboJsonAt, 4) == "true")
   {
      dboJsonAt += 4;
      return true;
   }
   if (dboJsonSrc.substr(dboJsonAt, 5) == "false")
   {
      dboJsonAt += 5;
      return false;
   }
   if (dboJsonSrc.substr(dboJsonAt, 4) == "null")
   {
      dboJsonAt += 4;
      return null;
   }
   var start = dboJsonAt;
   while (dboJsonAt < dboJsonSrc.length && "+-0123456789.eE".indexOf(dboJsonSrc.charAt(dboJsonAt)) >= 0)
   {
      dboJsonAt++;
   }
   return Number(dboJsonSrc.substring(start, dboJsonAt));
}

function dboParse(s)
{
   dboJsonSrc = String(s);
   dboJsonAt = 0;
   return dboJsonValue();
}

// ---- drawing ----

function dboFmt(font, size, color, spacing, align)
{
   var f = new TextFormat();
   f.font = font;
   f.size = size;
   f.color = color;
   f.letterSpacing = spacing;
   f.align = align == undefined ? "left" : align;
   return f;
}

function dboText(parent, name, depth, x, y, w, h, format, multi)
{
   parent.createTextField(name, depth, x, y, w, h);
   var tf = parent[name];
   tf.selectable = false;
   tf.multiline = multi == true;
   tf.wordWrap = multi == true;
   tf.setNewTextFormat(format);
   return tf;
}

// The stage area the player actually sees (Scaleform's Stage.visibleRect, as SkyUI's map lays out by): at 21:9 or 16:10 a
// 1280 x 720 stage is cropped top and bottom or left and right, so a panel is scaled into this and centred in it
function dboVisible()
{
   var r = Stage.visibleRect;
   if (r != undefined && r.right > r.left && r.bottom > r.top)
   {
      return {left: r.left, top: r.top, width: r.right - r.left, height: r.bottom - r.top};
   }
   return {left: 0, top: 0, width: 1280, height: 720};
}

// Fits a panel w x h into the visible area with a margin: never larger than designed, smaller where the screen crops it.
// Done again whenever the stage changes size
function dboFit(clip, w, h)
{
   var place = function()
   {
      var v = dboVisible();
      var m = 16;
      var s = Math.min(1, Math.min((v.width - m * 2) / w, (v.height - m * 2) / h));
      clip._xscale = s * 100;
      clip._yscale = s * 100;
      clip._x = v.left + (v.width - w * s) / 2;
      clip._y = v.top + (v.height - h * s) / 2;
   };
   place();
   var l = {};
   l.onResize = place;
   Stage.addListener(l);
}

// Typed input in a native panel, as SkyUI's own search box takes it (skyui SearchWidget): an input field, the focus, and
// skse.AllowTextInput(true) so the game stops reading the keys. dboInputEnd gives the keys back; call it before leaving.
// Unproven in a CustomMenu until Nat types in one, so every panel that uses it keeps its browser hand-off as a fallback.
function dboInput(parent, name, depth, x, y, w, h, format, maxChars, multi)
{
   var tf = dboText(parent, name, depth, x, y, w, h, format, multi);
   tf.type = "input";
   tf.selectable = true;
   tf.maxChars = maxChars;
   tf.background = true;
   tf.backgroundColor = 0x101010;
   tf.border = true;
   tf.borderColor = 0x5A5A5A;
   Selection.setFocus(tf);
   if (_global.skse != undefined && _global.skse.AllowTextInput != undefined)
   {
      _global.skse.AllowTextInput(true);
   }
   return tf;
}

function dboInputEnd()
{
   if (_global.skse != undefined && _global.skse.AllowTextInput != undefined)
   {
      _global.skse.AllowTextInput(false);
   }
}

// Whether this game can take typed input in a panel at all (SKSE's scaleform AllowTextInput)
function dboCanType()
{
   return _global.skse != undefined && _global.skse.AllowTextInput != undefined;
}

function dboBox(clip, x, y, w, h, color, alpha)
{
   clip.beginFill(color, alpha);
   clip.moveTo(x, y);
   clip.lineTo(x + w, y);
   clip.lineTo(x + w, y + h);
   clip.lineTo(x, y + h);
   clip.lineTo(x, y);
   clip.endFill();
}

// A rule: one pixel of stone that fades out at both ends
function dboRule(clip, x, y, w)
{
   dboGradientBox(clip, x, y, w, 1, [C_STONE_LIGHT, C_STONE_LIGHT, C_STONE_LIGHT, C_STONE_LIGHT], [0, 70, 70, 0], [0, 30, 225, 255], 0);
}

// A fill from colour to colour across a box: rotation 0 runs left to right, Math.PI / 2 top to bottom
function dboGradientBox(clip, x, y, w, h, colors, alphas, ratios, rotation)
{
   clip.beginGradientFill("linear", colors, alphas, ratios, {matrixType: "box", x: x, y: y, w: w, h: h, r: rotation});
   clip.moveTo(x, y);
   clip.lineTo(x + w, y);
   clip.lineTo(x + w, y + h);
   clip.lineTo(x, y + h);
   clip.lineTo(x, y);
   clip.endFill();
}

// A diamond of half-size r centred on cx, cy: aqua with a ground-coloured heart, as the corners and dividers carry
function dboDiamond(clip, cx, cy, r)
{
   dboPoly(clip, [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]], C_ACCENT, 90);
   dboPoly(clip, [[cx, cy - r + 1.5], [cx + r - 1.5, cy], [cx, cy + r - 1.5], [cx - r + 1.5, cy]], C_GROUND, 100);
}

function dboPoly(clip, pts, color, alpha)
{
   clip.beginFill(color, alpha);
   clip.moveTo(pts[0][0], pts[0][1]);
   for (var i = 1; i < pts.length; i++)
   {
      clip.lineTo(pts[i][0], pts[i][1]);
   }
   clip.lineTo(pts[0][0], pts[0][1]);
   clip.endFill();
}

// A divider between a panel's parts: the fading rule with a diamond at its middle
function dboDivider(clip, x, y, w)
{
   dboRule(clip, x, y, w);
   dboDiamond(clip, x + w / 2, y, 5);
}

// One corner piece at (x, y), turned by sx and sy (1 or -1): a stone L, an aqua L inside it and a diamond on the point
function dboCorner(clip, x, y, sx, sy)
{
   var box = function(bx, by, bw, bh, color, alpha)
   {
      var l = sx > 0 ? x + bx : x - bx - bw;
      var t = sy > 0 ? y + by : y - by - bh;
      dboBox(clip, l, t, bw, bh, color, alpha);
   };
   box(-3, -3, 27, 2.5, C_STONE_LIGHT, 100);
   box(-3, -3, 2.5, 27, C_STONE_LIGHT, 100);
   box(3, 3, 17, 1, C_ACCENT, 70);
   box(3, 3, 1, 17, C_ACCENT, 70);
   dboDiamond(clip, x - sx * 2, y - sy * 2, 5);
}

// The panel's ground and frame (Nat's B): teal deepening to black at the edges, a stone border, a faint aqua line
// inside it, and the four corner pieces. Replaces the plain black box every panel had
function dboGround(clip, w, h)
{
   dboGradientBox(clip, 0, 0, w, h, [C_GROUND, C_GROUND_2, C_GROUND], [93, 90, 94], [0, 150, 255], Math.PI / 2);
   var line = function(x, y, lw, lh, color, alpha)
   {
      dboBox(clip, x, y, lw, lh, color, alpha);
   };
   line(0, 0, w, 1.5, C_STONE, 90);
   line(0, h - 1.5, w, 1.5, C_STONE, 90);
   line(0, 0, 1.5, h, C_STONE, 90);
   line(w - 1.5, 0, 1.5, h, C_STONE, 90);
   line(6, 6, w - 12, 1, C_ACCENT, 22);
   line(6, h - 7, w - 12, 1, C_ACCENT, 22);
   line(6, 6, 1, h - 12, C_ACCENT, 22);
   line(w - 7, 6, 1, h - 12, C_ACCENT, 22);
   dboCorner(clip, 0, 0, 1, 1);
   dboCorner(clip, w, 0, -1, 1);
   dboCorner(clip, 0, h, 1, -1);
   dboCorner(clip, w, h, -1, -1);
}

// A panel's title: capitals in silver, spaced out
function dboTitle(parent, name, depth, x, y, w, text)
{
   var t = dboText(parent, name, depth, x, y, w, 40, dboFmt(F_PLAIN, 28, C_SILVER, 4.0), false);
   t.text = String(text).toUpperCase();
   return t;
}

// The hourglass, faint, behind a panel's content: h high, its right edge at right, its top at top. Loaded from our
// own DDS; where it cannot load the panel simply has none
function dboWatermark(parent, depth, right, top, h)
{
   var c = parent.createEmptyMovieClip("dboMark", depth);
   c._alpha = 5;
   if (MovieClipLoader == undefined)
   {
      return c;
   }
   var pic = c.createEmptyMovieClip("pic", 1);
   var l = {};
   l.onLoadInit = function(t)
   {
      if (t._height > 0)
      {
         var ow = t._width;
         var s = h / t._height;
         t._xscale = s * 100;
         t._yscale = s * 100;
         t._x = right - ow * s;
         t._y = top;
      }
   };
   var mcl = new MovieClipLoader();
   mcl.addListener(l);
   mcl.loadClip(DBO_HOURGLASS, pic);
   return c;
}

// The open tab's mark: an aqua line under its label, as wide as the label's words (w), on the button clip itself
function dboTabMark(b, w)
{
   dboBox(b, 0, b.label._y + b.label._height + 1, w, 2, C_ACCENT, 85);
}

// The focused control's aqua wash (Nat's B): a band that fades to the right, under its label. washX and washW place it
// where the control set them (rows), else it spans the engine's measure of the clip
function dboWash(c, on)
{
   if (on != true || c.disabled == true)
   {
      if (c.wash != undefined)
      {
         c.wash.removeMovieClip();
         delete c.wash;
      }
      return;
   }
   if (c.wash != undefined)
   {
      return;
   }
   var w = c.washW != undefined ? c.washW : c._width > 0 ? c._width : 200;
   var h = c.washH != undefined ? c.washH : c._height > 0 ? c._height : 30;
   var g = c.createEmptyMovieClip("wash", 0);
   var x = c.washX != undefined ? c.washX : 0;
   dboGradientBox(g, x - 10, -2, w + 10, h + 4, [C_ACCENT, C_ACCENT], [16, 0], [0, 255], 0);
   c.wash = g;
}

// Linear alpha fade over FADE_MS; input is never blocked while it runs
function dboFadeIn(clip)
{
   clip._alpha = 0;
   clip.fadeFrom = getTimer();
   clip.onEnterFrame = function()
   {
      var k = (getTimer() - this.fadeFrom) / FADE_MS;
      if (k >= 1)
      {
         this._alpha = 100;
         delete this.onEnterFrame;
      }
      else
      {
         this._alpha = 100 * k;
      }
   };
}

var DBO_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

function dboCountWord(n)
{
   var k = Math.max(0, Math.floor(n));
   return k < DBO_WORDS.length ? DBO_WORDS[k] : String(k);
}

function dboCapitalise(s)
{
   return s.length ? s.charAt(0).toUpperCase() + s.substr(1) : s;
}
