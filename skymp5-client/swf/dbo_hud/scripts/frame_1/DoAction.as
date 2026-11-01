// The native HUD (client NativeHudService, nativeHud.ts), drawn in the HUD Menu with no menu opened, as the browser HUD
// (skymp5-front features/hud) draws its bars and corner: bottom left the three vitals bars, each a little further right;
// bottom right the racial power's countdown, gold, hunger with its meter, and the voice range with "On air" while V is held.
// The client decides everything (the F3 Interface choice, the fade rules) and calls _root.dboData(json) with:
//   { bars: { on, shown, quiet, h, m, s }, corner: { shown }, power: { name, left } | null, gold: n | null,
//     hunger: { label, stage, fed } | null, voice: { mode, talking },
//     party: { title, rows: [{ name, leader, self, dead, far, pct, tag, clock }] } | null, watermark: bool }
// The hourglass watermark top right as the browser HUD draws it (the browser leaves its own out while this one is up).
// prompt: { kicker, title, text, yes, no, left, frac, answered, idle } | null: downed, feeding, robbery, a trade request
// or a consent, answered with Y and N (the client hears the keys; nativePrompt.ts), drawn centre screen, a little low.
// interact: { verb, label } | null: the activate wording beside the game's key glyph (49.5% across, 62% down), as the
// browser's interactPrompt. mail: { markers: [{ x, y, scale }], unread } | null: a sealed letter over each notice board
// holding mail, at its screen fraction, as the browser's mailMarkers.
// The party list sits at the left, where the browser's party panel opens; it is passive (no cursor in the HUD Menu).
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
var PARTY_W = 240;
var PARTY_ROW = 30;
var PROMPT_W = 480;

var data = null;
var bars;
var corner;
var barsWant = 0;
var cornerWant = 0;
var party;
var mark;
var prompt;
var interact;
var mail;

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
   party = _root.createEmptyMovieClip("party", 30);
   party._x = a.left + (a.right - a.left) * 0.023;
   party._y = a.top + (a.bottom - a.top) * 0.417;
   party._visible = false;
   // the browser's box: 7% of the width (72 to 140 px on a 1280 stage), the art 420 x 520, 2.4% down and 1.8% in
   var markW = Math.max(72, Math.min(140, (a.right - a.left) * 0.07));
   mark = dboWatermark(_root, 40, a.right - (a.right - a.left) * 0.018, a.top + (a.bottom - a.top) * 0.024, markW * 520 / 420);
   mark._alpha = 62;
   mark._visible = false;
   prompt = _root.createEmptyMovieClip("prompt", 50);
   prompt._x = a.left + ((a.right - a.left) - PROMPT_W) / 2;
   prompt._y = a.top + (a.bottom - a.top) * 0.56;
   prompt._visible = false;
   interact = _root.createEmptyMovieClip("interact", 45);
   interact._x = a.left + (a.right - a.left) * 0.495;
   interact._y = a.top + (a.bottom - a.top) * 0.62;
   interact.verb = dboText(interact, "verb", 1, 0, -24, 400, 26, dboFmt(F_MEDIUM, 21, C_TEXT, 2.0), false);
   interact.label = dboText(interact, "label", 2, 0, 0, 400, 24, dboFmt(F_MEDIUM, 18, C_ACCENT, 0.9), false);
   interact._visible = false;
   mail = _root.createEmptyMovieClip("mail", 15);
   mail._visible = false;
}

// A filled circle from eight arcs
function disc(c, cx, cy, r, color, alpha)
{
   c.beginFill(color, alpha);
   c.moveTo(cx + r, cy);
   for (var i = 1; i <= 8; i++)
   {
      var a1 = i * Math.PI / 4;
      var am = a1 - Math.PI / 8;
      var k = r / Math.cos(Math.PI / 8);
      c.curveTo(cx + Math.cos(am) * k, cy + Math.sin(am) * k, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
   }
   c.endFill();
}

// The activate wording: the verb, then the label in the accent; a load door has no verb, so its label moves up
function drawInteract(p)
{
   interact._visible = p != null && p != undefined && p.label != undefined && String(p.label) != "";
   if (!interact._visible)
   {
      return;
   }
   var verb = String(p.verb == undefined ? "" : p.verb);
   interact.verb.text = verb.toUpperCase();
   interact.label.text = String(p.label);
   interact.label._y = verb != "" ? 0 : -12;
}

// A sealed letter on a dark disc over each board with mail, bottom-centred on its point, sized by nearness
function drawMail(m, a)
{
   mail._visible = m != null && m != undefined && m.markers instanceof Array && m.markers.length > 0;
   if (!mail._visible)
   {
      return;
   }
   var all = mail.createEmptyMovieClip("all", 1);
   for (var i = 0; i < m.markers.length; i++)
   {
      var k = m.markers[i];
      var c = all.createEmptyMovieClip("m" + i, 1 + i);
      c._x = a.left + (a.right - a.left) * Number(k.x);
      c._y = a.top + (a.bottom - a.top) * Number(k.y);
      c._xscale = Number(k.scale) * 100;
      c._yscale = Number(k.scale) * 100;
      disc(c, 0, -14, 14, C_ACCENT, 85);
      disc(c, 0, -14, 12.5, C_GROUND, 95);
      dboBox(c, -7, -19, 14, 10, 0xE9D9AE, 100);
      dboBox(c, -1, -15, 3, 3, 0xB23A3A, 100);
      if (Number(m.unread) > 1)
      {
         disc(c, 10, -24, 6, 0xB23A3A, 100);
         var n = dboText(c, "count", 20, 4, -32, 12, 16, dboFmt(F_MEDIUM, 11, 0xFFFFFF, 0, "center"), false);
         n.text = String(m.unread);
      }
   }
}

// The prompt card: kicker, title, the text, the clock, then the two keys and what no answer means
function drawPrompt(p)
{
   prompt._visible = p != null && p != undefined && p.title != undefined;
   if (!prompt._visible)
   {
      return;
   }
   var c = prompt.createEmptyMovieClip("card", 1);
   dboBox(c, 0, 0, PROMPT_W, 214, C_GROUND, 88);
   dboBox(c, 0, 0, PROMPT_W, 2, C_ACCENT, 90);
   var kick = dboText(c, "kicker", 2, 18, 12, PROMPT_W - 36, 20, dboFmt(F_MEDIUM, 13, C_SECOND, 1.4), false);
   kick.text = String(p.kicker).toUpperCase();
   var title = dboText(c, "title", 3, 18, 32, PROMPT_W - 36, 28, dboFmt(F_MEDIUM, 21, C_TEXT, 0.3), false);
   title.text = String(p.title);
   var body = dboText(c, "body", 4, 18, 64, PROMPT_W - 36, 84, dboFmt(F_PLAIN, 15, C_SECOND, 0.2), true);
   body.text = String(p.text);
   dboBox(c, 18, 152, PROMPT_W - 36, 3, 0x000000, 55);
   dboBox(c, 18, 152, Math.round((PROMPT_W - 36) * Math.max(0, Math.min(1, Number(p.frac)))), 3, C_ACCENT, 85);
   var yes = dboText(c, "yes", 5, 18, 164, (PROMPT_W - 36) / 2, 24, dboFmt(F_MEDIUM, 17, p.answered == true ? C_SECOND : C_ACCENT, 0.4), false);
   yes.text = String(p.yes);
   var no = dboText(c, "no", 6, PROMPT_W / 2, 164, (PROMPT_W - 36) / 2, 24, dboFmt(F_MEDIUM, 17, p.answered == true ? C_SECOND : C_TEXT, 0.4, "right"), false);
   no.text = String(p.no);
   var idle = dboText(c, "idle", 7, 18, 188, PROMPT_W - 36, 20, dboFmt(F_PLAIN, 13, C_SECOND, 0.2), false);
   idle.text = String(p.idle);
}

// The party list, drawn afresh each time it changes: a title with the count, then a name and a bar a row
function drawParty(p)
{
   party._visible = p != null && p != undefined && p.rows instanceof Array && p.rows.length > 0;
   if (!party._visible)
   {
      return;
   }
   var list = party.createEmptyMovieClip("list", 1);
   var h = 26 + p.rows.length * PARTY_ROW + 6;
   dboBox(list, 0, 0, PARTY_W, h, C_GROUND, 70);
   dboBox(list, 0, 0, PARTY_W, 2, C_ACCENT, 70);
   var title = dboText(list, "title", 2, 10, 4, PARTY_W - 60, 20, dboFmt(F_MEDIUM, 14, C_SECOND, 1.2), false);
   title.text = String(p.title).toUpperCase();
   var count = dboText(list, "count", 3, PARTY_W - 50, 4, 40, 20, dboFmt(F_MEDIUM, 14, C_SECOND, 0.4, "right"), false);
   count.text = String(p.rows.length);
   for (var i = 0; i < p.rows.length; i++)
   {
      var r = p.rows[i];
      var row = list.createEmptyMovieClip("r" + i, 10 + i);
      row._y = 26 + i * PARTY_ROW;
      row._alpha = r.dead == true ? 45 : 100;
      // the leader's mark is drawn, not a character: the game's font has no star glyph
      if (r.leader == true)
      {
         dboDiamond(row, 15, 10, 4);
      }
      var name = dboText(row, "name", 1, r.leader == true ? 24 : 10, 0, PARTY_W - 80, 20, dboFmt(F_MEDIUM, 15, r.self == true ? C_ACCENT : C_TEXT, 0.3), false);
      name.text = String(r.name) + (r.tag != "" ? "  " + String(r.tag) : "");
      var right = dboText(row, "right", 2, PARTY_W - 70, 0, 60, 20, dboFmt(F_MEDIUM, 13, C_SECOND, 0.3, "right"), false);
      right.text = r.far == true ? "far" : String(r.clock);
      if (r.far != true)
      {
         dboBox(row, 10, 21, PARTY_W - 20, 4, 0x000000, 50);
         dboBox(row, 10, 21, Math.round((PARTY_W - 20) * Number(r.pct) / 100), 4, BAR_COLORS.classic[0], 90);
      }
   }
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
   drawParty(data.party);
   mark._visible = data.watermark == true;
   drawPrompt(data.prompt);
   drawInteract(data.interact);
   drawMail(data.mail, area());
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
