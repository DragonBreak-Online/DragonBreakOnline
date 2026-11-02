// Who owns what, drawn over Skyrim's M map (route M; MapRealmService loads this into a clip of the map, as it does the
// legend): each territory as a faint tint in its owner's colour, with a hairline where two owners meet. The shapes come in
// world units divided by the client's DRAW_SCALE (mapOwners.ts); the client lines them up with the map's own markers each
// frame by setting "layer"'s _x, _y, scales and _rotation and its "shapes" child's _rotation (mapOwners.ts clipTransform),
// so nothing is drawn again while the map pans, zooms or turns.
// The clip moves itself under the map's markers, so the colours lie on the land and every marker stays on top.
// The client calls _root.dboData(json) with { fills: [{ rgb, alpha, pts: [x, y, ...] }], lines: [same] }; it says it is
// alive in _root.dboAlive, which the client reads with Ui.getString. Display only: the map keeps its keys and mouse.

var DBO_SWF_VERSION = "mapowners-1";

var layer;
var shapes;
var host = this;

// The first free depth under the map's marker clips, so the markers draw over the colours; none found leaves it where it is
function sink()
{
   var map = host._parent;
   if (map == undefined || map.MarkerClips == undefined)
   {
      dboLog("mapowners: no MarkerClips; left at its own depth");
      return;
   }
   var d = map.MarkerClips.getDepth();
   for (var k = d - 1; k > -16384; k--)
   {
      if (map.getInstanceAtDepth(k) == undefined)
      {
         host.swapDepths(k);
         return;
      }
   }
}

function shape(pts)
{
   shapes.moveTo(Number(pts[0]), Number(pts[1]));
   for (var i = 2; i + 1 < pts.length; i += 2)
   {
      shapes.lineTo(Number(pts[i]), Number(pts[i + 1]));
   }
}

function draw(p)
{
   shapes.clear();
   var i;
   for (i = 0; i < p.fills.length; i++)
   {
      var f = p.fills[i];
      if (!(f.pts instanceof Array) || f.pts.length < 6)
      {
         continue;
      }
      shapes.lineStyle();
      shapes.beginFill(Number(f.rgb), Number(f.alpha));
      shape(f.pts);
      shapes.lineTo(Number(f.pts[0]), Number(f.pts[1]));
      shapes.endFill();
   }
   for (i = 0; i < p.lines.length; i++)
   {
      var l = p.lines[i];
      if (!(l.pts instanceof Array) || l.pts.length < 4)
      {
         continue;
      }
      // thickness 0 is a hairline at any scale, which the layer's scaling needs
      shapes.lineStyle(0, Number(l.rgb), Number(l.alpha));
      shape(l.pts);
   }
}

_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || !(p.fills instanceof Array) || !(p.lines instanceof Array))
   {
      dboLog("mapowners: unreadable payload");
      return;
   }
   draw(p);
};

layer = _root.createEmptyMovieClip("layer", 1);
// layer scales and turns, shapes turns again inside it: the two together take any turn and zoom the map has
shapes = layer.createEmptyMovieClip("shapes", 1);
layer._visible = false;
sink();
_root.dboVersion = DBO_SWF_VERSION;
// last, so the client never reads alive before the overlay can take its data
_root.dboAlive = "yes";
