// The realm's legend on Skyrim's M map, drawn inside the MapMenu (route M; MapRealmService loads this into a clip of the
// map, as NativeHudService loads dbo_hud into the HUD Menu): the panel at the top right with a row a kind of place, its key,
// how many the map shows and whether it is hidden, and the "R Realm" bar at the bottom, as the browser's mapRealm draws
// them. Display only: the map keeps the keyboard and the mouse, and the client hears the digits and R.
// The client calls _root.dboData(json) with { shown, rows: [{ id, label, key, count, shown }] }; it says it is alive in
// _root.dboAlive, which the client reads with Ui.getString. Each kind's glyph is the panel's diamond, not the browser's
// line drawings.

var DBO_SWF_VERSION = "maplegend-1";
var VH = 7.2;
var PANEL_W = 300;
var ROW_H = 25;

var panel;
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

function build()
{
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
   hint.text = "A number shows or hides its places. The realm's places are the map's own markers, so they zoom, turn and fast-travel as every other does.";
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

build();
_root.dboVersion = DBO_SWF_VERSION;
// last, so the client never reads alive before the legend can take its data
_root.dboAlive = "yes";
