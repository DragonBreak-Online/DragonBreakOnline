// A list the server shows beside a game menu (the alchemy lab's "You can brew" list, alchemy.js, an inspect contextMenu
// sent without focus), drawn inside that menu (route M; NativeMenuListService loads this into a clip of the Crafting Menu, as
// MapRealmService loads dbo_maplegend into the map). Display only: the game menu keeps the keyboard and the mouse.
// The client calls _root.dboData(json) with { title, lines: [string] }, or { hide: true } when the server closes the list; it
// says it is alive in _root.dboAlive.

var DBO_SWF_VERSION = "menulist-1";
var PANEL_W = 380;
var BODY_MAX = 440;

var panel;

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
   panel = _root.createEmptyMovieClip("list", 10);
   panel._x = a.right - PANEL_W - (a.right - a.left) * 0.02;
   panel._y = a.top + (a.bottom - a.top) * 0.12;
   panel._visible = false;
}

// A line's height: about 46 characters a line at 14 px across the panel
function lineHeight(s)
{
   return Math.max(1, Math.ceil(s.length / 46)) * 18 + 4;
}

function draw(p)
{
   var lines = p.lines instanceof Array ? p.lines : [];
   panel._visible = true;
   var body = panel.createEmptyMovieClip("body", 1);
   var title = dboText(body, "title", 2, 18, 14, PANEL_W - 36, 44, dboFmt(F_MEDIUM, 17, C_TEXT, 0.4), true);
   title.text = String(p.title);
   var y = 62;
   var shown = 0;
   for (var i = 0; i < lines.length; i++)
   {
      var t = String(lines[i]);
      var lh = lineHeight(t);
      if (y + lh > BODY_MAX + 62)
      {
         break;
      }
      var tf = dboText(body, "l" + i, 10 + i, 18, y, PANEL_W - 36, lh, dboFmt(F_PLAIN, 14, C_SECOND, 0.2), true);
      tf.text = t;
      y += lh;
      shown++;
   }
   body.shown = shown;
   dboBox(body, 0, 0, PANEL_W, y + 14, C_GROUND, 82);
   dboBox(body, 0, 0, PANEL_W, 2, C_ACCENT, 90);
}

_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p != null && p.hide == true)
   {
      panel._visible = false;
      return;
   }
   if (p == null || p.title == undefined)
   {
      dboLog("menulist: unreadable payload");
      return;
   }
   draw(p);
};

build();
_root.dboVersion = DBO_SWF_VERSION;
// last, so the client never reads alive before the list can take its data
_root.dboAlive = "yes";
