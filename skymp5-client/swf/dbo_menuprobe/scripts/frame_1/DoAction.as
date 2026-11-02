// The probe for the tick-safe menu (skyrim-platform DboMenuApi, opened with dboMenuOpen): it says "ready" through
// _global.dboNative once that exists (set after the movie loads, so not on frame 1), and answers _root.ping(arg) with
// "pong" and the arg. A line on screen shows each step, so a look at the main menu tells whether it came up at all.
var shown = _root.createTextField("line", 1, 60, 60, 900, 40);
var fmt = new TextFormat();
fmt.font = "$EverywhereMediumFont";
fmt.size = 24;
fmt.color = 0xFFFFFF;
shown.setNewTextFormat(fmt);
shown.text = "DboMenu probe: loaded, waiting for dboNative";
var told = false;
var frames = 0;

_root.ping = function(arg)
{
   shown.text = "DboMenu probe: ping " + arg;
   _global.dboNative("pong", String(arg));
};

_root.onEnterFrame = function()
{
   frames++;
   if (!told && _global.dboNative != undefined)
   {
      told = true;
      shown.text = "DboMenu probe: ready on frame " + frames;
      _global.dboNative("ready", String(frames));
   }
};
