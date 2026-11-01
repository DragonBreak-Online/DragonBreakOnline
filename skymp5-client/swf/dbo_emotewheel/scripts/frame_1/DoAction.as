// The native emote wheel (client EmoteService with nativeEmoteWheel.ts), drawn in the HUD Menu with no menu opened and no
// cursor: the browser wheel's rings (skymp5-front features/emoteWheel), the hub, the groups round it and the shown group's
// emotes outside, in the wheel's own units (a 640 square, the hub at its centre, angle 0 at the top, clockwise). The client
// points it (the mouse's movement or the right stick) and decides everything; it calls _root.dboShow("1" / "0") and
// _root.dboData(json) with:
//   { groups: [label], group: n, emotes: [label], hover: { ring: "hub" | "group" | "emote", index }, last: n,
//     pointer: [x, y], title }
// It says it is alive in _root.dboAlive, which the client reads with Ui.getString.

var DBO_SWF_VERSION = "emotewheel-1";
var HUB_R = 78;
var GROUP_INNER = 86;
var GROUP_OUTER = 158;
var EMOTE_INNER = 166;
var EMOTE_OUTER = 300;
var GAP_DEG = 0.8;
var ARC_STEPS = 24;
// The share of the visible height the wheel takes, as the browser wheel's 78vh
var WHEEL_SHARE = 0.78;
var C_SEG = 0x0C2226;
var C_SEG_HOT = 0x16383D;
var C_ACTIVE = 0x2F7C80;
var C_EMOTE_HOT = 0x5FB3B3;
var C_GOLD = 0xE0BA62;

var wheel;
var structure = "";
var data = null;

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

function px(r, deg)
{
   return r * Math.sin(deg * Math.PI / 180);
}

function py(r, deg)
{
   return - r * Math.cos(deg * Math.PI / 180);
}

// A ring segment from angle a0 to a1 (degrees), between radii r0 and r1
function arc(clip, r0, r1, a0, a1, color, alpha)
{
   clip.beginFill(color, alpha);
   clip.moveTo(px(r1, a0), py(r1, a0));
   var i;
   for (i = 1; i <= ARC_STEPS; i++)
   {
      var a = a0 + (a1 - a0) * i / ARC_STEPS;
      clip.lineTo(px(r1, a), py(r1, a));
   }
   for (i = ARC_STEPS; i >= 0; i--)
   {
      var b = a0 + (a1 - a0) * i / ARC_STEPS;
      clip.lineTo(px(r0, b), py(r0, b));
   }
   clip.lineTo(px(r1, a0), py(r1, a0));
   clip.endFill();
}

function disc(clip, x, y, r, color, alpha)
{
   clip.beginFill(color, alpha);
   clip.moveTo(x, y - r);
   for (var i = 1; i <= 32; i++)
   {
      var a = i * 360 / 32;
      clip.lineTo(x + px(r, a), y + py(r, a));
   }
   clip.endFill();
}

// Segment i of n, centred on i * 360 / n as nativeEmoteWheel.ts's indexAt counts them
function segment(clip, r0, r1, i, n, color, alpha)
{
   var step = 360 / n;
   arc(clip, r0, r1, i * step - step / 2 + GAP_DEG / 2, i * step + step / 2 - GAP_DEG / 2, color, alpha);
}

function label(parent, name, depth, r, deg, w, size, color)
{
   var t = dboText(parent, name, depth, px(r, deg) - w / 2, py(r, deg) - size * 0.75, w, size * 1.6, dboFmt(F_MEDIUM, size, color, 0.4, "center"), false);
   return t;
}

function build()
{
   var a = area();
   wheel = _root.createEmptyMovieClip("wheel", 10);
   wheel._x = (a.left + a.right) / 2;
   wheel._y = (a.top + a.bottom) / 2;
   wheel._xscale = wheel._yscale = 100 * WHEEL_SHARE * (a.bottom - a.top) / 640;
   wheel.shade = wheel.createEmptyMovieClip("shade", 1);
   disc(wheel.shade, 0, 0, EMOTE_OUTER + 60, 0x000000, 35);
   wheel.rings = wheel.createEmptyMovieClip("rings", 2);
   wheel.labels = wheel.createEmptyMovieClip("labels", 3);
   wheel.hub = wheel.createEmptyMovieClip("hub", 4);
   disc(wheel.hub, 0, 0, HUB_R, C_GROUND, 94);
   wheel.hubGroup = dboText(wheel, "hubGroup", 5, -HUB_R, -26, HUB_R * 2, 18, dboFmt(F_MEDIUM, 11, C_SECOND, 2, "center"), false);
   wheel.hubTitle = dboText(wheel, "hubTitle", 6, -HUB_R, -6, HUB_R * 2, 26, dboFmt(F_MEDIUM, 17, C_SILVER, 0.4, "center"), false);
   wheel.pointer = wheel.createEmptyMovieClip("pointer", 7);
   disc(wheel.pointer, 0, 0, 5, C_ACCENT, 95);
   wheel._visible = false;
}

// The labels are made again only when the groups or the shown group change
function buildLabels()
{
   var key = data.groups.join("|") + "#" + data.group + "#" + data.emotes.join("|");
   if (key == structure)
   {
      return;
   }
   structure = key;
   wheel.labels.removeMovieClip();
   wheel.labels = wheel.createEmptyMovieClip("labels", 3);
   var L = wheel.labels;
   var i;
   var ng = data.groups.length;
   for (i = 0; i < ng; i++)
   {
      L["g" + i] = label(L, "g" + i, 10 + i, (GROUP_INNER + GROUP_OUTER) / 2, i * 360 / ng, 96, 11, C_SECOND);
      L["g" + i].text = String(data.groups[i]).toUpperCase();
   }
   var ne = data.emotes.length;
   for (i = 0; i < ne; i++)
   {
      var deg = i * 360 / ne;
      L["e" + i] = label(L, "e" + i, 100 + i, (EMOTE_INNER + EMOTE_OUTER) / 2 + 8, deg, 130, 15, C_SILVER);
      L["e" + i].text = String(data.emotes[i]);
      if (i < 9)
      {
         L["k" + i] = label(L, "k" + i, 200 + i, EMOTE_INNER + 20, deg, 24, 11, C_STONE_LIGHT);
         L["k" + i].text = String(i + 1);
      }
   }
}

function draw()
{
   buildLabels();
   var R = wheel.rings;
   R.clear();
   var hover = data.hover;
   var ng = data.groups.length;
   var i;
   for (i = 0; i < ng; i++)
   {
      var gHot = hover.ring == "group" && hover.index == i;
      var color = i == data.group ? C_ACTIVE : (gHot ? C_SEG_HOT : C_SEG);
      segment(R, GROUP_INNER, GROUP_OUTER, i, ng, color, i == data.group ? 62 : (gHot ? 90 : 82));
      wheel.labels["g" + i].textColor = i == data.group || gHot ? C_SILVER : C_SECOND;
   }
   var ne = data.emotes.length;
   for (i = 0; i < ne; i++)
   {
      var eHot = hover.ring == "emote" && hover.index == i;
      segment(R, EMOTE_INNER, EMOTE_OUTER, i, ne, eHot ? C_EMOTE_HOT : C_SEG, eHot ? 50 : 82);
      // The last emote played is edged in gold, as the browser wheel's is-last
      if (i == data.last)
      {
         segment(R, EMOTE_OUTER - 3, EMOTE_OUTER, i, ne, C_GOLD, 95);
      }
      wheel.labels["e" + i].textColor = eHot ? 0xFFFFFF : C_SILVER;
      if (i < 9)
      {
         wheel.labels["k" + i].textColor = eHot ? C_GOLD : C_STONE_LIGHT;
      }
   }
   wheel.hubGroup.text = ng > 0 && data.group < ng ? String(data.groups[data.group]).toUpperCase() : "";
   wheel.hubTitle.text = String(data.title);
   wheel.pointer._x = Number(data.pointer[0]);
   wheel.pointer._y = Number(data.pointer[1]);
}

_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || p.groups == undefined || p.emotes == undefined || p.hover == undefined || p.pointer == undefined)
   {
      dboLog("emotewheel: unreadable payload");
      return;
   }
   data = p;
   draw();
};

_root.dboShow = function(s)
{
   wheel._visible = String(s) == "1" && data != null;
};

build();
_root.dboVersion = DBO_SWF_VERSION;
// last, so the client never reads alive before the wheel can take its data
_root.dboAlive = "yes";
