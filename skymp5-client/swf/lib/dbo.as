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
var C_SECOND = 0x999999;
var C_DISABLED = 0x606060;
var A_ROW_REST = 30;
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

function dboRule(clip, x, y, w)
{
   dboBox(clip, x, y, w, 1, 0xFFFFFF, 25);
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
