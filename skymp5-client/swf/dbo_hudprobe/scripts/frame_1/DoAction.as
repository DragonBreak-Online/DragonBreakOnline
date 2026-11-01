// The HUD probe's T2 (client hudProbe.ts, /testmenu hud): loaded with loadMovie into a clip the client made in the HUD
// Menu, so it runs inside a menu we did not author. It says it is alive, counts its own frames, keys, mouse moves and
// clicks, answers a call (dboPing) and sends a mod event back, and draws an amber bar under the probe's aqua one. The client
// reads every answer from these variables with Ui.getString / Ui.getFloat. No lib: dbo.as works on _root, which here is
// the HUD's own until _lockroot.

this._lockroot = true;
var me = this;
me.dboVersion = "hudprobe-1";
me.dboFrames = 0;
me.dboKeys = 0;
me.dboLastKey = -1;
me.dboMouse = 0;
me.dboClicks = 0;
me.dboPinged = "";
me.dboSkse = _global.skse != undefined ? "yes" : "no";
me.dboStageW = Stage.width;
me.dboStageH = Stage.height;

// An amber bar, 200 x 40, under the aqua one
me.beginFill(0xD0A050, 70);
me.moveTo(40, 360);
me.lineTo(240, 360);
me.lineTo(240, 400);
me.lineTo(40, 400);
me.lineTo(40, 360);
me.endFill();

me.onEnterFrame = function()
{
   me.dboFrames++;
   // skse on a later frame than the first is a result of its own
   if (me.dboSkse == "no" && _global.skse != undefined)
   {
      me.dboSkse = "from frame " + me.dboFrames;
   }
};

var dboKeyWatch = {};
dboKeyWatch.onKeyDown = function()
{
   me.dboKeys++;
   me.dboLastKey = Key.getCode();
};
Key.addListener(dboKeyWatch);

var dboMouseWatch = {};
dboMouseWatch.onMouseMove = function()
{
   me.dboMouse++;
};
dboMouseWatch.onMouseDown = function()
{
   me.dboClicks++;
};
Mouse.addListener(dboMouseWatch);

me.dboPing = function(s)
{
   me.dboPinged = String(s);
   if (_global.skse != undefined)
   {
      _global.skse.SendModEvent("dboHudProbe", "pong", me.dboFrames);
   }
};

// last, so the client never reads alive before the rest is set
me.dboAlive = "yes";
