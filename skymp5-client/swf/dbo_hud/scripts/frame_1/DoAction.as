// The native HUD (client NativeHudService, nativeHud.ts), drawn in the HUD Menu with no menu opened, as the browser HUD
// (skymp5-front features/hud) draws its bars and corner: bottom left the three vitals bars, each a little further right;
// bottom right the racial power's countdown, gold, hunger with its meter, and the voice range with "On air" while V is held.
// The client decides everything (the F3 Interface choice, the fade rules) and calls _root.dboData(json) with:
//   { bars: { on, shown, quiet, h, m, s }, corner: { shown }, power: { name, left } | null, gold: n | null,
//     hunger: { label, stage, fed } | null, voice: { mode, talking } }
// It says it is alive in _root.dboAlive, which the client reads with Ui.getString.

var DBO_SWF_VERSION = "hud-1";
var BAR_W = 220;
var STAGGER = 14;
var CARD_W = 230;
var ROW_H = 28;
var VOICE_MODES = [["whisper", "Whisper"], ["talk", "Normal"], ["shout", "Yell"]];
var BAR_COLORS = {classic: [0xB8433B, 0x4A74B8, 0x6E9A4F], quiet: [0x8E3B36, 0x3C5A8A, 0x5B7A45]};
var STAGE_COLORS = {sated: 0x7FB8AE, peckish: 0x8FCFC0, hungry: 0xD9A860, starving: 0xD8503C};
var STAGE_TEXT = {hungry: 0xE8D6A0, starving: 0xE8907F};
var FADE_PER_FRAME = 8;

var data = null;
var bars;
var corner;
var barsWant = 0;
var cornerWant = 0;

// The stage the player sees (visibleRect where the HUD has one)
function area()
{
   var r = Stage.visibleRect;
   if (r != undefined && r.right > r.left)
   {
      return {left: r.left, top: r.top, right: r.right, bottom: r.bottom};
   }
   return {left: 0, top: 0, right: Stage.width, bottom: Stage.height};
}

function barRow(i, label)
{
   var r = bars.createEmptyMovieClip("row" + i, 10 + i);
   r._x = i * STAGGER;
   r._y = i * 18;
   r.bg = r.createEmptyMovieClip("bg", 1);
   r.fill = r.createEmptyMovieClip("fill", 2);
   r.label = label;
   return r;
}

function drawBar(r, i, pct, quiet)
{
   var h = quiet ? 6 : 10;
   var colors = quiet ? BAR_COLORS.quiet : BAR_COLORS.classic;
   r.bg.clear();
   dboBox(r.bg, 0, 0, BAR_W, h, 0x000000, quiet ? 35 : 55);
   r.fill.clear();
   dboBox(r.fill, 0, 0, Math.round(BAR_W * pct / 100), h, colors[i], quiet ? 80 : 95);
   r.pct = pct;
}

function cardRow(name, depth)
{
   var c = corner.createEmptyMovieClip(name, depth);
   c.bg = c.createEmptyMovieClip("bg", 1);
   dboBox(c.bg, 0, 0, CARD_W, ROW_H, C_GROUND, 70);
   c.label = dboText(c, "label", 2, 10, 4, CARD_W - 90, 22, dboFmt(F_MEDIUM, 15, C_TEXT, 0.4), false);
   c.value = dboText(c, "value", 3, CARD_W - 80, 4, 70, 22, dboFmt(F_MEDIUM, 15, C_SECOND, 0.4, "right"), false);
   return c;
}

function build()
{
   var a = area();
   bars = _root.createEmptyMovieClip("bars", 10);
   bars._x = a.left + (a.right - a.left) * 0.018;
   bars._y = a.bottom - (a.bottom - a.top) * 0.036 - 3 * 18;
   barRow(0, "Health");
   barRow(1, "Magicka");
   barRow(2, "Stamina");
   bars._alpha = 0;
   corner = _root.createEmptyMovieClip("corner", 20);
   corner._x = a.right - (a.right - a.left) * 0.016 - CARD_W;
   corner._y = a.bottom - (a.bottom - a.top) * 0.034;
   cardRow("power", 1);
   cardRow("gold", 2);
   var hu = cardRow("hunger", 3);
   hu.meter = hu.createEmptyMovieClip("meter", 4);
   var v = corner.createEmptyMovieClip("voice", 5);
   v.bg = v.createEmptyMovieClip("bg", 1);
   for (var i = 0; i < VOICE_MODES.length; i++)
   {
      v["m" + i] = dboText(v, "m" + i, 10 + i, 10 + i * 56, 5, 56, 22, dboFmt(F_MEDIUM, 14, C_SECOND, 0.3), false);
      v["m" + i].text = VOICE_MODES[i][1];
   }
   v.hint = dboText(v, "hint", 20, CARD_W - 64, 5, 56, 22, dboFmt(F_MEDIUM, 13, C_SECOND, 0.3, "right"), false);
   corner._alpha = 0;
}

// The corner's cards stack upward from its bottom edge, the voice box lowest, as the browser's column does
function layoutCorner()
{
   var y = 0;
   var order = ["voice", "hunger", "gold", "power"];
   for (var i = 0; i < order.length; i++)
   {
      var c = corner[order[i]];
      if (!c._visible)
      {
         continue;
      }
      y -= ROW_H + (c == corner.hunger ? 6 : 0) + 6;
      c._y = y;
   }
}

function drawVoice(voice)
{
   var v = corner.voice;
   v.bg.clear();
   dboBox(v.bg, 0, 0, CARD_W, ROW_H, voice.talking ? C_GROUND_2 : C_GROUND, voice.talking ? 90 : 70);
   if (voice.talking)
   {
      dboBox(v.bg, 0, 0, CARD_W, 2, C_ACCENT, 90);
   }
   for (var i = 0; i < VOICE_MODES.length; i++)
   {
      v["m" + i].textColor = VOICE_MODES[i][0] == voice.mode ? C_ACCENT : C_SECOND;
   }
   v.hint.text = voice.talking ? "On air" : "L-Alt";
   v.hint.textColor = voice.talking ? C_ACCENT : C_SECOND;
}

function draw()
{
   var b = data.bars;
   bars._visible = b.on == true;
   drawBar(bars.row0, 0, Number(b.h), b.quiet == true);
   drawBar(bars.row1, 1, Number(b.m), b.quiet == true);
   drawBar(bars.row2, 2, Number(b.s), b.quiet == true);
   barsWant = b.on == true && b.shown == true ? 100 : 0;

   var p = corner.power;
   p._visible = data.power != null && data.power != undefined;
   if (p._visible)
   {
      p.label.text = String(data.power.name);
      p.value.text = data.power.left + "s";
   }
   var g = corner.gold;
   g._visible = data.gold != null && data.gold != undefined;
   if (g._visible)
   {
      g.label.text = "Gold";
      g.value.text = String(data.gold);
   }
   var hu = corner.hunger;
   hu._visible = data.hunger != null && data.hunger != undefined;
   if (hu._visible)
   {
      var st = String(data.hunger.stage);
      hu.label.text = String(data.hunger.label);
      hu.label.textColor = STAGE_TEXT[st] != undefined ? STAGE_TEXT[st] : C_TEXT;
      hu.value.text = Math.round(Number(data.hunger.fed)) + "%";
      hu.meter.clear();
      dboBox(hu.meter, 10, ROW_H - 4, CARD_W - 20, 3, 0x000000, 50);
      dboBox(hu.meter, 10, ROW_H - 4, Math.round((CARD_W - 20) * Number(data.hunger.fed) / 100), 3, STAGE_COLORS[st] != undefined ? STAGE_COLORS[st] : STAGE_COLORS.sated, 90);
      hu.fed = Number(data.hunger.fed);
   }
   drawVoice(data.voice);
   layoutCorner();
   cornerWant = data.corner.shown == true ? 100 : 0;
}

_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || p.bars == undefined || p.corner == undefined || p.voice == undefined)
   {
      dboLog("hud: unreadable payload");
      return;
   }
   data = p;
   draw();
};

// The fades: toward what the client last decided, a little each frame
_root.onEnterFrame = function()
{
   if (bars._alpha != barsWant)
   {
      bars._alpha = barsWant > bars._alpha ? Math.min(barsWant, bars._alpha + FADE_PER_FRAME) : Math.max(barsWant, bars._alpha - FADE_PER_FRAME);
   }
   if (corner._alpha != cornerWant)
   {
      corner._alpha = cornerWant > corner._alpha ? Math.min(cornerWant, corner._alpha + FADE_PER_FRAME) : Math.max(cornerWant, corner._alpha - FADE_PER_FRAME);
   }
};

build();
_root.dboVersion = DBO_SWF_VERSION;
// last, so the client never reads alive before the HUD can take its data
_root.dboAlive = "yes";
