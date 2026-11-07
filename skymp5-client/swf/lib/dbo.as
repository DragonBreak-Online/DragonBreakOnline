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
var FADE_KEY_MS = 100;

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
var dboTyping = false;

// Escape also comes from the client (scaleformMenuService calls _root.dboEscape), since the game may keep it from the movie;
// a second copy of one press, from the other source within DBO_ESC_GAP_MS, is dropped
var DBO_ESC_GAP_MS = 250;
var dboKeyHandlers = [];
var dboForcedKey = 0;
var dboEscAt = -100000;
var dboEscBy = "";

// A panel's key listener: the game's keys, and the client's Escape
function dboKeys(listener)
{
   Key.addListener(listener);
   dboKeyHandlers.push(listener);
}

// Key.getCode() with the numpad digits read as the row digits 1-9
function dboKey()
{
   if (dboForcedKey > 0)
   {
      return dboForcedKey;
   }
   var code = Key.getCode();
   if (code == 27)
   {
      if (dboEscBy == "client" && getTimer() - dboEscAt < DBO_ESC_GAP_MS)
      {
         return 0;
      }
      dboEscBy = "key";
      dboEscAt = getTimer();
   }
   return code >= 97 && code <= 105 ? code - 48 : code;
}

_root.dboEscape = function()
{
   if (dboEscBy == "key" && getTimer() - dboEscAt < DBO_ESC_GAP_MS)
   {
      return;
   }
   dboEscBy = "client";
   dboEscAt = getTimer();
   dboForcedKey = 27;
   for (var i = 0; i < dboKeyHandlers.length; i++)
   {
      dboKeyHandlers[i].onKeyDown();
   }
   dboForcedKey = 0;
};

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
   dboInputEnd();
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

// The reader never indexes into the whole payload. On 1 Nov Nat's F3 tabs still took 3.2 s (court, 46 KB) and 4.8 s
// (faction, 60 KB) to parse after strings were read in runs, while deity (41 KB of long strings) took 1 s: the time
// follows the charAt calls made deep into one long string, about 80 us each. So the payload is cut once at every quote
// by native split, and charAt only ever reads the short pieces between strings (punctuation, numbers, true/false/null).
var dboJsonKind; // per token: one of { } [ ] : , or "s" (a string) or "v" (a number, true, false or null)
var dboJsonVal;
var dboJsonAt;

// A string's text with its escapes read; most strings have none and are returned as they are
function dboJsonUnescape(s)
{
   var bs = s.indexOf("\\");
   if (bs < 0)
   {
      return s;
   }
   var out = "";
   var at = 0;
   while (bs >= 0)
   {
      out += s.substring(at, bs);
      var esc = s.charAt(bs + 1);
      at = bs + 2;
      if (esc == "n")
      {
         out += "\n";
      }
      else if (esc == "t")
      {
         out += "\t";
      }
      else if (esc == "r")
      {
         out += "\r";
      }
      else if (esc == "b" || esc == "f")
      {
      }
      else if (esc == "u")
      {
         out += String.fromCharCode(parseInt(s.substr(at, 4), 16));
         at += 4;
      }
      else
      {
         out += esc;
      }
      bs = s.indexOf("\\", at);
   }
   return out + s.substring(at);
}

// Whether a piece cut at a quote ends inside an escape: an odd run of backslashes before that quote
function dboJsonEscapedEnd(s)
{
   var n = 0;
   var i = s.length - 1;
   while (i >= 0 && s.charAt(i) == "\\")
   {
      n++;
      i--;
   }
   return n % 2 == 1;
}

// One piece between strings: its punctuation and its bare values, as tokens
function dboJsonPunct(p)
{
   var lit = "";
   for (var i = 0; i <= p.length; i++)
   {
      var c = i < p.length ? p.charAt(i) : " ";
      if (c == "{" || c == "}" || c == "[" || c == "]" || c == ":" || c == "," || c == " " || c == "\t" || c == "\n" || c == "\r")
      {
         if (lit.length)
         {
            dboJsonKind.push("v");
            dboJsonVal.push(lit == "true" ? true : lit == "false" ? false : lit == "null" ? null : Number(lit));
            lit = "";
         }
         if (c != " " && c != "\t" && c != "\n" && c != "\r")
         {
            dboJsonKind.push(c);
            dboJsonVal.push(null);
         }
      }
      else
      {
         lit += c;
      }
   }
}

function dboJsonValue()
{
   var k = dboJsonKind[dboJsonAt];
   var v = dboJsonVal[dboJsonAt];
   dboJsonAt++;
   if (k == "{")
   {
      var o = {};
      if (dboJsonKind[dboJsonAt] == "}")
      {
         dboJsonAt++;
         return o;
      }
      while (dboJsonAt < dboJsonKind.length)
      {
         var key = dboJsonVal[dboJsonAt];
         dboJsonAt += 2;
         o[key] = dboJsonValue();
         if (dboJsonKind[dboJsonAt++] != ",")
         {
            return o;
         }
      }
      return o;
   }
   if (k == "[")
   {
      var a = [];
      if (dboJsonKind[dboJsonAt] == "]")
      {
         dboJsonAt++;
         return a;
      }
      while (dboJsonAt < dboJsonKind.length)
      {
         a.push(dboJsonValue());
         if (dboJsonKind[dboJsonAt++] != ",")
         {
            return a;
         }
      }
      return a;
   }
   return v;
}

// A payload over the client's one-call size comes as pieces "id|i|n" DBO_SEP slice (scaleformMenuService, chunkArgs); the
// last piece hands the whole JSON to the panel's own _root.dboData. A piece of an older set, out of range or seen twice
// is dropped. Each delivery this size or larger is timed and reported to the server as dbo:nativeTiming (the AS2 parse,
// and the panel's drawing after it), so one session measures what a big panel costs.
var DBO_TIMING_MIN = 20000;
var dboChunkId = -1;
var dboChunkN = 0;
var dboChunkGot = 0;
var dboChunkParts = [];
var dboChunkActive = false;
var dboParseMs = -1;

function dboTimingReport(chars, chunks, parseMs, drawMs)
{
   var ver = _root.dboVersion != undefined ? String(_root.dboVersion) : "?";
   dboSend("dbo:nativeTiming", [ver, chars, chunks, parseMs, drawMs]);
}

_root.dboChunk = function(piece)
{
   var str = String(piece);
   var sep = str.indexOf(DBO_SEP);
   if (sep < 0)
   {
      return;
   }
   var h = str.substring(0, sep).split("|");
   var id = Number(h[0]);
   var i = Number(h[1]);
   var n = Number(h[2]);
   if (isNaN(id) || isNaN(i) || isNaN(n) || n < 1 || i < 0 || i >= n || i != Math.floor(i))
   {
      return;
   }
   if (id != dboChunkId)
   {
      // a newer set replaces an unfinished one; an older set's late piece is dropped
      if (id < dboChunkId)
      {
         return;
      }
      dboChunkId = id;
      dboChunkN = n;
      dboChunkGot = 0;
      dboChunkParts = [];
   }
   if (n != dboChunkN || dboChunkParts[i] != undefined)
   {
      return;
   }
   dboChunkParts[i] = str.substring(sep + 1);
   dboChunkGot++;
   if (dboChunkGot < dboChunkN)
   {
      return;
   }
   var full = dboChunkParts.join("");
   dboChunkParts = [];
   dboChunkGot = 0;
   dboChunkActive = true;
   dboParseMs = -1;
   var t0 = getTimer();
   if (_root.dboData != undefined)
   {
      _root.dboData(full);
   }
   var total = getTimer() - t0;
   dboChunkActive = false;
   dboTimingReport(full.length, dboChunkN, dboParseMs, dboParseMs >= 0 ? total - dboParseMs : total);
};

function dboParse(s)
{
   var t0 = getTimer();
   var v = dboParseRaw(s);
   dboParseMs = getTimer() - t0;
   var chars = String(s).length;
   // a payload sent whole: its parse is reported here (no drawing time), one sent in pieces by dboChunk with its drawing
   if (!dboChunkActive && chars >= DBO_TIMING_MIN)
   {
      dboTimingReport(chars, 1, dboParseMs, -1);
   }
   return v;
}

function dboParseRaw(s)
{
   var parts = String(s).split("\"");
   dboJsonKind = [];
   dboJsonVal = [];
   dboJsonAt = 0;
   var i = 0;
   while (i < parts.length)
   {
      dboJsonPunct(parts[i]);
      i++;
      if (i >= parts.length)
      {
         break;
      }
      // a string: the pieces up to the quote that is not escaped
      var str = parts[i];
      while (dboJsonEscapedEnd(str) && i + 1 < parts.length)
      {
         i++;
         str += "\"" + parts[i];
      }
      dboJsonKind.push("s");
      dboJsonVal.push(dboJsonUnescape(str));
      i++;
   }
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
// The screen's width / height as the client read it from the game's settings (ScaleformMenuService, _root.dboScreen);
// 0 until it says. A second opinion: on Nat's screen (31 Oct) the admin panel overflowed top and bottom, so the
// visibleRect it was fitted by did not describe what he saw
var dboScreenAspect = 0;
var dboFits = [];

function dboVisible()
{
   var v = {left: 0, top: 0, width: 1280, height: 720};
   var r = Stage.visibleRect;
   if (r != undefined && r.right > r.left && r.bottom > r.top)
   {
      v = {left: r.left, top: r.top, width: r.right - r.left, height: r.bottom - r.top};
   }
   // what no-border scaling of 1280 x 720 shows of a screen this shape; the smaller of the two wins
   if (dboScreenAspect > 0)
   {
      var cw = dboScreenAspect >= 16 / 9 ? 1280 : 720 * dboScreenAspect;
      var ch = dboScreenAspect >= 16 / 9 ? 1280 / dboScreenAspect : 720;
      if (ch < v.height - 0.5 || cw < v.width - 0.5)
      {
         v = {left: (1280 - cw) / 2, top: (720 - ch) / 2, width: cw, height: ch};
      }
   }
   return v;
}

function dboVisibleKey()
{
   var r = Stage.visibleRect;
   return (r != undefined ? r.left + "," + r.top + "," + r.right + "," + r.bottom : "none") + "|" + dboScreenAspect;
}

// Fits a panel w x h into the visible area with a margin: never larger than designed, smaller where the screen crops it.
// Done again whenever the stage changes size, the client names the screen, or visibleRect reads differently: a reading
// taken while the menu is still being built need not be the one it is shown with
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
   dboFits.push(place);
   var l = {};
   l.onResize = place;
   Stage.addListener(l);
   var seen = dboVisibleKey();
   dboLog("fit: visibleRect " + seen + ", stage " + Stage.width + " x " + Stage.height + ", scale " + Math.round(clip._xscale));
   var watch = _root.createEmptyMovieClip("dboFitWatch", 9989);
   watch.onEnterFrame = function()
   {
      var k = dboVisibleKey();
      if (k != seen)
      {
         seen = k;
         place();
         dboLog("fit: now " + k + ", scale " + Math.round(clip._xscale));
      }
   };
}

// The client's reading of the screen, "<width>x<height>" (ScaleformMenuService, before the first dboData)
_root.dboScreen = function(s)
{
   var p = String(s).split("x");
   var sw = Number(p[0]);
   var sh = Number(p[1]);
   if (p.length == 2 && sw > 0 && sh > 0 && !isNaN(sw) && !isNaN(sh))
   {
      dboScreenAspect = sw / sh;
      for (var i = 0; i < dboFits.length; i++)
      {
         dboFits[i]();
      }
   }
};

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
   // Typed text must carry the box's own format. On 1 Nov Nat's typing came out as black boxes: the characters took the
   // field's default format (black, a font the game's library does not have), not the one setNewTextFormat gave it.
   // Callers set onChanged for their own use, so a keeper clip puts the format back on the frame the text changes.
   tf.setTextFormat(format);
   var keep = parent.createEmptyMovieClip(name + "_fmt", depth + 16000);
   keep.box = tf;
   keep.fmt = format;
   keep.seen = String(tf.text);
   keep.onEnterFrame = function()
   {
      // the box went with a redraw: nothing left to keep
      if (this.box == undefined || this.box.text == undefined)
      {
         delete this.onEnterFrame;
         return;
      }
      var now = String(this.box.text);
      if (now != this.seen)
      {
         this.seen = now;
         this.box.setTextFormat(this.fmt);
         this.box.setNewTextFormat(this.fmt);
      }
   };
   Selection.setFocus(tf);
   // SKSE counts AllowTextInput (GameInput.cpp: true ++, false --), so a redraw must never take a second count
   if (!dboTyping && dboCanType())
   {
      _global.skse.AllowTextInput(true);
      dboTyping = true;
      // A second box (rent after deposit, the journal's text after its title) used to make a new guard at the same depth.
      // That replaced the old guard, whose onUnload then ran dboInputEnd straight after the AllowTextInput(true) above, so
      // the game read the keys again and only the first box of a panel ever took typing (#bugs, 4-7 Nov). The old guard is
      // disarmed and removed first.
      var old = _root.dboTypeGuard;
      if (old != undefined)
      {
         delete old.onUnload;
         old.removeMovieClip();
      }
      // best effort for a close the panel never sees (the engine's, Souls RE's): the clip's unload gives the count back
      var g = _root.createEmptyMovieClip("dboTypeGuard", 9997);
      g.onUnload = function()
      {
         dboInputEnd();
      };
   }
   return tf;
}

function dboInputEnd()
{
   if (dboTyping && dboCanType())
   {
      dboTyping = false;
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
   // a solid black backing: through the teal alone (90-94%) the HUD's notices read behind the panel (Nat, 31 Oct)
   dboBox(clip, 0, 0, w, h, 0x000000, 100);
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
// ms: a shorter fade for a panel a key press opens (default FADE_MS)
function dboFadeIn(clip, ms)
{
   clip._alpha = 0;
   clip.fadeFrom = getTimer();
   clip.fadeMs = ms > 0 ? ms : FADE_MS;
   clip.onEnterFrame = function()
   {
      var k = (getTimer() - this.fadeFrom) / this.fadeMs;
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
