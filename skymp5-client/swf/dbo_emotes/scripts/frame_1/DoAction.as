// The emote wheel as a native panel (client emoteService's widget 24, the same object the browser wheel gets): the groups
// down the left, the chosen group's emotes as rows, Cancel Emote and Close. The browser's previews are another mod's art,
// so the native panel names the emote instead. Every choice sends the widget's own key (events.play, stop, close); the
// service closes the wheel behind each, and so does this panel. The panel is loaded afresh each time, so the emote
// played last (and its group, opened first) comes from the service as widget.last.

var DBO_SWF_VERSION = "emotes-1";
var STAGE_W = 1280;
var PANEL_W = 860;
var PANEL_H = 520;
var PAD = 28;
var GROUP_W = 240;
var ROW_X = 300;
var ROW_W = 532;
var TOP = 112;
var ROW_H = 38;
var MAX_ROWS = 9;
var NO_DATA_CLOSE_MS = 8000;

var panel;
var data = null;
var groups = [];
var group = 0;
var preview = "";
var last = "";
var builtAt = getTimer();

function ev(k)
{
   return data.events != undefined && data.events[k] != undefined ? String(data.events[k]) : "emote:" + k;
}

// The browser wheel shortens a long label the same way to fit its ring
function shortLabel(label)
{
   var s = String(label);
   if (s.length <= 15)
   {
      return s;
   }
   return s.split(" Hands ").join(" H. ").split("Attention").join("Attn").split("Crossed").join("Cross").split("Sitting").join("Sit");
}

function emotesOf(g)
{
   return groups[g] != undefined && groups[g].emotes instanceof Array ? groups[g].emotes : [];
}

function sendAndClose(key, args)
{
   dboSend(key, args);
   dboClose();
}

function playEmote(i)
{
   var list = emotesOf(group);
   if (i < 0 || i >= list.length || i >= MAX_ROWS)
   {
      return;
   }
   dboSound("UIMenuOK");
   sendAndClose(ev("play"), [String(list[i].anim)]);
}

function stopEmote()
{
   dboSound("UIMenuOK");
   sendAndClose(ev("stop"), []);
}

function closeMenu()
{
   dboSound("UIMenuCancel");
   sendAndClose(ev("close"), []);
}

function chooseGroup(g)
{
   if (g < 0 || g >= groups.length || g == group || !emotesOf(g).length)
   {
      return;
   }
   dboSound("UIMenuPrevNext");
   group = g;
   preview = String(emotesOf(g)[0].anim);
   draw();
}

function previewFocused()
{
   if (focus >= 0 && actions[focus].anim != undefined && actions[focus].anim != preview)
   {
      preview = actions[focus].anim;
      drawCentre();
   }
}

function previewed()
{
   var list = emotesOf(group);
   for (var i = 0; i < list.length; i++)
   {
      if (String(list[i].anim) == preview)
      {
         return list[i];
      }
   }
   return list.length ? list[0] : null;
}

function drawCentre()
{
   var c = clear("centre", 30);
   var e = previewed();
   var cat = dboText(c, "category", 1, ROW_X, TOP - 50, ROW_W, 24, dboFmt(F_PLAIN, 16, C_SECOND, 6.5), false);
   cat.text = groups[group] != undefined ? String(groups[group].label).toUpperCase() : "";
   var name = dboText(c, "emote", 2, ROW_X, TOP - 28, ROW_W, 32, dboFmt(F_BOLD, 22, C_TEXT, 0), false);
   name.text = e != null ? String(e.label) : "";
}

function draw()
{
   actions = [];
   focus = -1;
   var l = clear("groups", 20);
   for (var g = 0; g < groups.length; g++)
   {
      var gb = button(l, "g" + g, 10 + g, PAD, TOP + g * ROW_H, GROUP_W, String(groups[g].label), F_PLAIN, 22, g == group ? A_FOCUS : A_ROW_REST, function()
      {
         chooseGroup(this.g);
      });
      gb.g = g;
      if (g == group)
      {
         dboRule(gb, 0, ROW_H - 6, GROUP_W);
      }
   }
   var r = clear("rows", 40);
   var list = emotesOf(group);
   for (var i = 0; i < list.length && i < MAX_ROWS; i++)
   {
      var row = button(r, "e" + i, 10 + i, ROW_X + 34, TOP + i * ROW_H, ROW_W - 34, shortLabel(list[i].label), F_MEDIUM, 22, A_ROW_REST, function()
      {
         playEmote(this.i);
      });
      row.i = i;
      row.anim = String(list[i].anim);
      if (row.anim == last)
      {
         row.rest = A_FOCUS;
         row._alpha = A_FOCUS;
         dboRule(row, 0, ROW_H - 6, ROW_W - 34);
      }
      // Hover previews, as on the browser wheel: the name above the rows follows it
      row.onRollOver = function()
      {
         setFocus(this.idx);
         if (preview != this.anim)
         {
            preview = this.anim;
            drawCentre();
         }
      };
      var k = dboText(r, "k" + i, 30 + i, ROW_X, TOP + i * ROW_H + 3, 26, 28, dboFmt(F_BOLD, 22, C_SECOND, 0), false);
      k.text = String(i + 1);
   }
   drawCentre();
   var f = clear("foot", 60);
   dboRule(f, PAD, PANEL_H - 72, PANEL_W - PAD * 2);
   button(f, "stop", 1, ROW_X, PANEL_H - 58, 200, "Cancel Emote", F_MEDIUM, 22, A_BUTTON_REST, function()
   {
      stopEmote();
   });
   button(f, "close", 2, PANEL_W - PAD - 120, PANEL_H - 58, 120, "Close", F_MEDIUM, 22, A_BUTTON_REST, function()
   {
      closeMenu();
   });
   var h = dboText(f, "hint", 3, PAD, PANEL_H - 52, ROW_X - PAD - 10, 24, dboFmt(F_MEDIUM, 16, C_SECOND, 0.8), false);
   var dot = "  " + String.fromCharCode(8226) + "  ";
   h.text = "Hover to preview" + dot + "Click to play" + dot + "Esc or right-click to close";
   h.wordWrap = true;
   h.multiline = true;
   h._height = 48;
   h._y = PANEL_H - 62;
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   panel._x = (STAGE_W - PANEL_W) / 2;
   panel._y = 100;
   var bg = panel.createEmptyMovieClip("bg", 1);
   dboBox(bg, 0, 0, PANEL_W, PANEL_H, 0x000000, 80);
   var title = dboText(panel, "title", 2, PAD, 18, GROUP_W, 40, dboFmt(F_PLAIN, 30, C_TEXT, 1.0), false);
   title.text = "Emotes";
   dboRule(bg, PAD, 96, PANEL_W - PAD * 2);
   dboFadeIn(panel);
}

_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || !(p.groups instanceof Array) || !p.groups.length || p.events == undefined)
   {
      dboLog("emotes: unreadable payload");
      return;
   }
   var first = data == null;
   data = p;
   groups = [];
   for (var i = 0; i < p.groups.length; i++)
   {
      if (p.groups[i] != null && p.groups[i].emotes instanceof Array && p.groups[i].emotes.length)
      {
         groups.push(p.groups[i]);
      }
   }
   last = p.last != undefined && p.last != null ? String(p.last) : "";
   if (first || group >= groups.length)
   {
      group = 0;
      preview = groups.length ? String(groups[0].emotes[0].anim) : "";
      for (var g = 0; g < groups.length && last != ""; g++)
      {
         var es = groups[g].emotes;
         for (var e = 0; e < es.length; e++)
         {
            if (String(es[e].anim) == last)
            {
               group = g;
               preview = last;
            }
         }
      }
   }
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = dboKey();
   if (code == 27)
   {
      if (data != null)
      {
         closeMenu();
      }
      else
      {
         dboClose();
      }
      return;
   }
   if (data == null)
   {
      return;
   }
   if (code >= 49 && code <= 57)
   {
      playEmote(code - 49);
   }
   else if (code == 37 || code == 65)
   {
      chooseGroup(group <= 0 ? groups.length - 1 : group - 1);
   }
   else if (code == 39 || code == 68)
   {
      chooseGroup(group >= groups.length - 1 ? 0 : group + 1);
   }
   else if ((code == 38 || code == 87) && actions.length)
   {
      setFocus(focus <= 0 ? actions.length - 1 : focus - 1);
      previewFocused();
   }
   else if ((code == 40 || code == 83) && actions.length)
   {
      setFocus(focus < 0 || focus >= actions.length - 1 ? 0 : focus + 1);
      previewFocused();
   }
   else if ((code == 13 || code == 69) && focus >= 0 && actions[focus].disabled != true)
   {
      actions[focus].onPick();
   }
};
Key.addListener(keys);

// Right-click closes, as on the browser wheel. Scaleform passes the button to onMouseDown (1 left, 2 right); unproven in
// game, so anything but 2 does nothing
var mouse = {};
mouse.onMouseDown = function(button)
{
   if (button == 2 && data != null)
   {
      closeMenu();
   }
};
Mouse.addListener(mouse);

_root.onEnterFrame = function()
{
   if (data == null && getTimer() - builtAt >= NO_DATA_CLOSE_MS)
   {
      dboLog("emotes: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
      delete _root.onEnterFrame;
      dboClose();
   }
};

_root.dboReady = false;
_root.dboVersion = DBO_SWF_VERSION;
build();
_root.dboReady = true;
dboBoot(function(frame)
{
   dboLog("panel built, version " + DBO_SWF_VERSION + ", skse appeared on frame " + frame);
   dboSend("ready", [frame], frame);
});
