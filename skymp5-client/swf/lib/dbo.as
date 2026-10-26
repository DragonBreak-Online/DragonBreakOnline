// Shared AS2 for DBO panels, prepended to each menu's frame script by build-swf.js. Style values follow swf/STYLE.md.

var DBO_UI_EVENT = "dboUi";
var DBO_MENU = "CustomMenu";
var DBO_SEP = String.fromCharCode(1);

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

// One mod event per message: the client splits key and JSON args and calls sendMessage(key, ...args)
function dboSend(msgKey, args)
{
   var s = msgKey + DBO_SEP + dboJson(args);
   if (!dboBooted)
   {
      dboQueue.push(["send", s]);
      return true;
   }
   if (_global.skse.SendModEvent == undefined)
   {
      return false;
   }
   _global.skse.SendModEvent(DBO_UI_EVENT, s, 0);
   return true;
}

function dboClose()
{
   if (!dboBooted)
   {
      dboCloseWanted = true;
   }
   else if (_global.skse.CloseMenu != undefined)
   {
      _global.skse.CloseMenu(DBO_MENU);
   }
}

// Polls each frame for _global.skse, then runs onReady(frame it appeared on) and flushes what was queued before it
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
         else if (_global.skse.SendModEvent != undefined)
         {
            _global.skse.SendModEvent(DBO_UI_EVENT, q[i][1], 0);
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
