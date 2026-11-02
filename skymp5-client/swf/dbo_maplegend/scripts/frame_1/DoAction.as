// The realm's legend on Skyrim's M map, drawn inside the MapMenu (route M; MapRealmService loads this into a clip of the
// map, as NativeHudService loads dbo_hud into the HUD Menu): the panel at the top right with a row a kind of place, its key,
// how many the map shows and whether it is hidden, and the "R Realm" bar at the bottom, as the browser's mapRealm draws
// them. Display only: the map keeps the keyboard and the mouse, and the client hears the digits and R.
// The client calls _root.dboData(json) with { shown, rows: [{ id, label, key, count, shown }] }; it says it is alive in
// _root.dboAlive, which the client reads with Ui.getString. Each kind's glyph is the panel's diamond, not the browser's
// line drawings.

// Since 2 Nov this is our own CustomMenu over the map (nothing can be made inside SkyUI's map), and it also carries who owns
// what: "owners" holds the territories' tint and hairlines under the panel, drawn once by _root.dboOwners(json) in world
// units over the client's DRAW_SCALE (mapOwners.ts) and lined up each frame by the client setting "owners.layer"'s _x, _y,
// scales and _rotation and its "shapes" child's _rotation. The visible area goes to _root.dboStageL/T/W/H, which the
// client needs to carry the map's marker positions over to this movie's stage.
var DBO_SWF_VERSION = "maplegend-4";
var VH = 7.2;
var PANEL_W = 300;
var ROW_H = 25;

var panel;
var oshapes;
var bar;

function area()
{
   var r = Stage.visibleRect;
   if (r != undefined && r.right > r.left)
   {
      return {left: r.left, top: r.top, right: r.right, bottom: r.bottom};
   }
   return {left: 0, top: 0, right: Stage.width, bottom: Stage.height};
}

// One shape from a flat list of points
function oshape(pts)
{
   oshapes.moveTo(Number(pts[0]), Number(pts[1]));
   for (var i = 2; i + 1 < pts.length; i += 2)
   {
      oshapes.lineTo(Number(pts[i]), Number(pts[i + 1]));
   }
}

// The owners' tint and hairlines: fills of one polygon (pts) or of many cells (rects, all in one fill), lines as hairlines
function drawOwners(p)
{
   oshapes.clear();
   var i;
   for (i = 0; i < p.fills.length; i++)
   {
      var f = p.fills[i];
      oshapes.lineStyle();
      if (f.rects instanceof Array && f.rects.length >= 4)
      {
         oshapes.beginFill(Number(f.rgb), Number(f.alpha));
         for (var r = 0; r + 3 < f.rects.length; r += 4)
         {
            var x0 = Number(f.rects[r]);
            var y0 = Number(f.rects[r + 1]);
            var x1 = Number(f.rects[r + 2]);
            var y1 = Number(f.rects[r + 3]);
            oshapes.moveTo(x0, y0);
            oshapes.lineTo(x1, y0);
            oshapes.lineTo(x1, y1);
            oshapes.lineTo(x0, y1);
            oshapes.lineTo(x0, y0);
         }
         oshapes.endFill();
         continue;
      }
      // quads: the client's cells projected through the map's perspective (x0, y0 .. x3, y3 each), all in one fill
      if (f.quads instanceof Array && f.quads.length >= 8)
      {
         oshapes.beginFill(Number(f.rgb), Number(f.alpha));
         for (var q = 0; q + 7 < f.quads.length; q += 8)
         {
            oshapes.moveTo(Number(f.quads[q]), Number(f.quads[q + 1]));
            oshapes.lineTo(Number(f.quads[q + 2]), Number(f.quads[q + 3]));
            oshapes.lineTo(Number(f.quads[q + 4]), Number(f.quads[q + 5]));
            oshapes.lineTo(Number(f.quads[q + 6]), Number(f.quads[q + 7]));
            oshapes.lineTo(Number(f.quads[q]), Number(f.quads[q + 1]));
         }
         oshapes.endFill();
         continue;
      }
      if (!(f.pts instanceof Array) || f.pts.length < 6)
      {
         continue;
      }
      oshapes.beginFill(Number(f.rgb), Number(f.alpha));
      oshape(f.pts);
      oshapes.lineTo(Number(f.pts[0]), Number(f.pts[1]));
      oshapes.endFill();
   }
   for (i = 0; i < p.lines.length; i++)
   {
      var l = p.lines[i];
      if (!(l.pts instanceof Array) || l.pts.length < 4)
      {
         continue;
      }
      // thickness 0 is a hairline at any scale, which the layer's scaling needs
      oshapes.lineStyle(0, Number(l.rgb), Number(l.alpha));
      oshape(l.pts);
   }
}

function build()
{
   // the owners layer first, so the legend panel and bar draw over it
   var owners = _root.createEmptyMovieClip("owners", 5);
   var olayer = owners.createEmptyMovieClip("layer", 1);
   oshapes = olayer.createEmptyMovieClip("shapes", 1);
   olayer._visible = false;
   var va = area();
   _root.dboStageL = va.left;
   _root.dboStageT = va.top;
   _root.dboStageW = va.right - va.left;
   _root.dboStageH = va.bottom - va.top;
   var a = area();
   panel = _root.createEmptyMovieClip("legend", 10);
   panel._x = a.right - PANEL_W;
   panel._y = a.top + 6.7 * VH;
   panel._visible = false;
   bar = _root.createEmptyMovieClip("bar", 20);
   bar._x = a.left + (a.right - a.left) * 0.52;
   bar._y = a.bottom - 1.4 * VH - 22;
   var key = dboText(bar, "key", 2, 0, 0, 22, 22, dboFmt(F_MEDIUM, 14, C_TEXT, 0, "center"), false);
   key.text = "R";
   key.border = true;
   key.borderColor = 0x8A8A8A;
   var label = dboText(bar, "label", 3, 28, 0, 120, 22, dboFmt(F_PLAIN, 16, C_TEXT, 0.8), false);
   label.text = "Realm";
   bar._visible = false;
}

function row(body, i, r, y)
{
   var c = body.createEmptyMovieClip("r" + i, 10 + i);
   c._y = y;
   c._alpha = r.shown == true ? 100 : 40;
   var k = dboText(c, "key", 1, 0, 2, 18, 20, dboFmt(F_MEDIUM, 13, C_TEXT, 0, "center"), false);
   k.text = String(r.key);
   k.border = true;
   k.borderColor = 0x8A8A8A;
   dboDiamond(c, 32, 12, 5);
   var t = dboText(c, "label", 2, 46, 1, PANEL_W - 110, 22, dboFmt(F_PLAIN, 16, C_TEXT, 0.3), false);
   t.text = String(r.label);
   var n = dboText(c, "count", 3, PANEL_W - 70, 2, 40, 20, dboFmt(F_PLAIN, 14, C_SECOND, 0.2, "right"), false);
   n.text = String(r.count);
   return c;
}

function draw(p)
{
   bar._visible = true;
   panel._visible = p.shown == true;
   if (!panel._visible)
   {
      return;
   }
   var body = panel.createEmptyMovieClip("body", 1);
   var rows = p.rows instanceof Array ? p.rows : [];
   var other = null;
   var realm = [];
   for (var i = 0; i < rows.length; i++)
   {
      if (rows[i].id == "other")
      {
         other = rows[i];
      }
      else
      {
         realm.push(rows[i]);
      }
   }
   var h = 2.4 * VH + 26 + 10 + realm.length * ROW_H + (other != null ? 14 + ROW_H : 0) + 70;
   dboGradientBox(body, 0, 0, PANEL_W, h, [0x000000, 0x000000, 0x000000], [0, 62, 74], [0, 70, 255], 0);
   var title = dboText(body, "title", 2, 27, 2.4 * VH, PANEL_W - 60, 24, dboFmt(F_MEDIUM, 17, C_SILVER, 3.0), false);
   title.text = "THE REALM";
   var y = 2.4 * VH + 26;
   dboRule(body, 27, y, PANEL_W - 60);
   y += 10;
   for (var j = 0; j < realm.length; j++)
   {
      row(body, j, realm[j], y);
      y += ROW_H;
   }
   if (other != null)
   {
      dboRule(body, 27, y + 6, PANEL_W - 60);
      y += 14;
      row(body, realm.length, other, y);
      y += ROW_H;
   }
   var hint = dboText(body, "hint", 40, 27, y + 8, PANEL_W - 60, 60, dboFmt(F_PLAIN, 12, C_SECOND, 0.2), true);
   hint.text = "A number shows or hides its places, T the territory colours. The realm's places are the map's own markers, so they zoom, turn and fast-travel as every other does.";
   for (var q = 0; q < realm.length; q++)
   {
      body["r" + q]._x = 27;
   }
   if (other != null)
   {
      body["r" + realm.length]._x = 27;
   }
}

_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || !(p.rows instanceof Array))
   {
      dboLog("maplegend: unreadable payload");
      return;
   }
   draw(p);
};

_root.dboOwners = function(json)
{
   var p = dboParse(json);
   if (p == null || !(p.fills instanceof Array) || !(p.lines instanceof Array))
   {
      dboLog("maplegend: unreadable owners payload");
      return;
   }
   drawOwners(p);
};

build();
_root.dboVersion = DBO_SWF_VERSION;
// last, so the client never reads alive before the legend can take its data
_root.dboAlive = "yes";
