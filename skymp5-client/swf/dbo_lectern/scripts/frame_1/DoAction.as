// The Class Lectern as a native panel (server schools.js makeLectern, classLectern widget: the same object skymp5-front
// features/classLectern gets), opened by using the lectern; the temple's sermon lectern sends the same widget with its own
// words (payload.words: lead, teacher, lesson, students, none, teacherAway, begin, join, leave, end, cancel, cancelTitle,
// cancelText, cancelYes, cancelNo), which the browser panel does not read. Two modes, the server's:
//   idle     a teacher picks one spell they know (it sets the school and rank; nobody learns it) and begins; anyone else
//            is told who may teach
//   running  teacher, lesson, the countdown, who signed up; a visitor signs up, a student leaves, the teacher ends it
//            after the time or cancels it (after a question)
// Keys are the widget's own events: start [nonce, spell desc], join, leave, end and cancel [nonce], close (no arguments).

var DBO_SWF_VERSION = "lectern-1";
var PANEL_W = 1000;
var PANEL_H = 640;
var PAD = 28;
BODY_W = PANEL_W - PAD * 2;
var NO_DATA_CLOSE_MS = 8000;
var BUSY_TIMEOUT_MS = 8000;
var SCHOOL_ORDER = ["Destruction", "Illusion", "Conjuration", "Alteration"];
var WORDS = {lead: "Choose the spell your class is set by. It decides the school and the rank; your students do not learn it. The class runs {minutes} minutes.",
   teacher: "Teacher", lesson: "Lesson", students: "Students", none: "None yet",
   teacherAway: "The teacher has left the classroom. The class is cancelled in {clock} unless they return.",
   begin: "Begin the class", join: "Sign up", leave: "Leave the class", end: "End Class", cancel: "Cancel the class",
   cancelTitle: "Cancel the class?", cancelText: "Nobody is paid for a cancelled class.", cancelYes: "Cancel it", cancelNo: "Keep teaching"};
var C_RED = 0xB23A3A;
var C_GREEN = 0x7FBF7F;

var panel;
var data = null;
var page = 0;
var busy = false;
var busyAt = 0;
var picked = "";
var cancelling = false;
var nonce = "";
var endsAt = 0;
var shownLeft = -1;
var builtAt = getTimer();

function ev(name)
{
   var fallback = {start: "dbo:lecternStart", join: "dbo:lecternJoin", leave: "dbo:lecternLeave", end: "dbo:lecternEnd", cancel: "dbo:lecternCancel", close: "dbo:lecternClose"};
   return data != null && data.events != undefined && data.events[name] != undefined ? String(data.events[name]) : fallback[name];
}

// The panel's words: the payload's own (the sermon), else the class's
function word(key)
{
   return data != null && data.words != undefined && data.words != null && data.words[key] != undefined ? String(data.words[key]) : WORDS[key];
}

function isBusy()
{
   return busy && getTimer() - busyAt < BUSY_TIMEOUT_MS;
}

function act(name, args)
{
   if (isBusy())
   {
      return;
   }
   busy = true;
   busyAt = getTimer();
   dboSound("UIMenuOK");
   dboSend(ev(name), [String(data.nonce)].concat(args));
   draw();
}

function closeMenu()
{
   dboSound("UIMenuCancel");
   dboSend(ev("close"), []);
   dboClose();
}

function clock(ms)
{
   var s = Math.max(0, Math.ceil(ms / 1000));
   var m = s % 60;
   return Math.floor(s / 60) + ":" + (m < 10 ? "0" : "") + m;
}

// The countdown runs on screen; the server holds the real end and refreshes the panel as it goes
function leftNow()
{
   return Math.max(0, endsAt - getTimer());
}

function schoolOrder(s)
{
   for (var i = 0; i < SCHOOL_ORDER.length; i++)
   {
      if (SCHOOL_ORDER[i] == s)
      {
         return i;
      }
   }
   return -1;
}

function bySchoolRankName(a, b)
{
   var d = schoolOrder(a.school) - schoolOrder(b.school);
   if (d != 0)
   {
      return d;
   }
   if (Number(a.rank) != Number(b.rank))
   {
      return Number(a.rank) - Number(b.rank);
   }
   var x = String(a.name).toLowerCase();
   var y = String(b.name).toLowerCase();
   return x < y ? -1 : x > y ? 1 : 0;
}

// ---- drawing ----

function drawIdle()
{
   if (data.canTeach != true)
   {
      flowText(data.whyNot != undefined ? String(data.whyNot) : "", 18, C_SECOND);
      return;
   }
   flowText(word("lead").split("{minutes}").join(String(Number(data.minutes) || 30)), 18, C_SECOND);
   var spells = listOf(data.spells).slice();
   spells.sort(bySchoolRankName);
   for (var i = 0; i < spells.length; i++)
   {
      var s = spells[i];
      var on = picked == String(s.id);
      var e = flowEntry((on ? "> " : "") + String(s.name), [[on ? "Chosen" : "Choose", function() { dboSound("UIMenuOK"); picked = String(this._parent.spell.id); draw(); }, undefined, on]], s.school + "  ·  " + s.rankName);
      e.spell = s;
   }
}

function drawRunning()
{
   flowRow(word("teacher"), String(data.teacher));
   flowRow(word("lesson"), data.spell + " (" + data.school + ", " + data.rankName + ")");
   var st = listOf(data.students);
   var names = [];
   for (var i = 0; i < st.length; i++)
   {
      names.push(st[i].name + (st[i].away == true ? " (away)" : ""));
   }
   flowRow(word("students"), names.length ? names.join(", ") : word("none"));
   if (Number(data.teacherAway) > 0)
   {
      flowText(word("teacherAway").split("{clock}").join(clock(Number(data.teacherAway))), 17, C_RED);
   }
   if (data.gain != undefined && data.gain != "")
   {
      flowText(String(data.gain), 17, C_TEXT);
   }
   if (data.whyNot != undefined && data.whyNot != "")
   {
      flowText(String(data.whyNot), 17, C_SECOND);
   }
}

function drawCancel()
{
   flowHeading(word("cancelTitle"));
   flowText(word("cancelText"), 18, C_TEXT);
   flowButtons([[word("cancelYes"), function() { act("cancel", []); }, C_RED, isBusy()], [word("cancelNo"), function() { dboSound("UIMenuCancel"); cancelling = false; draw(); }]]);
}

// The footer's buttons right to left from Close, each greyed while a change is in flight
function footButton(f, name, depth, x, w, label, onPick, off)
{
   var b = button(f, name, depth, x - w, PANEL_H - 48, w, label, F_MEDIUM, 20, A_BUTTON_REST, onPick);
   if (off)
   {
      disable(b);
   }
   return x - w - 10;
}

function drawFoot(pages)
{
   var f = clear("foot", 60);
   var r = dboText(f, "result", 1, PAD, PANEL_H - 112, PANEL_W - PAD * 2, 44, dboFmt(F_MEDIUM, 17, data.resultKind == "refused" ? C_RED : data.resultKind == "ok" ? C_GREEN : C_SECOND, 0.5), true);
   r.text = data.result != undefined ? String(data.result) : "";
   dboDivider(f, PAD, PANEL_H - 62, PANEL_W - PAD * 2);
   var h = dboText(f, "hint", 2, PAD, PANEL_H - 46, 260, 24, dboFmt(F_MEDIUM, 15, C_SECOND, 0.5), false);
   h.text = pages > 1 ? "Page " + (page + 1) + " of " + pages : "";
   var x = footButton(f, "close", 10, PANEL_W - PAD, 100, "Close", function() { closeMenu(); }, false);
   if (cancelling)
   {
      return;
   }
   if (data.mode == "idle" && data.canTeach == true)
   {
      footButton(f, "begin", 11, x, 220, word("begin"), function() { act("start", [picked]); }, isBusy() || picked == "");
   }
   else if (data.mode == "running" && data.role == "visitor" && data.canJoin == true)
   {
      footButton(f, "join", 11, x, 160, word("join"), function() { act("join", []); }, isBusy());
   }
   else if (data.mode == "running" && data.role == "student")
   {
      footButton(f, "leave", 11, x, 220, word("leave"), function() { act("leave", []); }, isBusy());
   }
   else if (data.mode == "running" && data.role == "teacher")
   {
      x = footButton(f, "cancel", 12, x, 220, word("cancel"), function() { dboSound("UIMenuOK"); cancelling = true; draw(); }, isBusy());
      footButton(f, "end", 11, x, 160, word("end"), function() { act("end", []); }, isBusy() || data.canEnd != true);
   }
}

function draw()
{
   actions = [];
   focus = -1;
   var h = clear("head", 20);
   dboTitle(h, "title", 1, PAD, 16, PANEL_W - PAD * 2 - 200, data.title != undefined && data.title != "" ? String(data.title) : "Class Lectern");
   var st = dboText(h, "status", 2, PANEL_W - PAD - 420, 22, 420, 30, dboFmt(F_MEDIUM, 18, data.mode == "running" ? C_ACCENT : C_SECOND, 0.5, "right"), false);
   st.text = String(data.status) + (data.mode == "running" ? "   " + clock(leftNow()) : "");
   dboDivider(h, PAD, 70, PANEL_W - PAD * 2);
   BODY_H = PANEL_H - 118 - 84;
   flowStart(panel, 50, PAD, 84);
   if (cancelling)
   {
      drawCancel();
   }
   else if (data.mode == "idle")
   {
      drawIdle();
   }
   else
   {
      drawRunning();
   }
   var pages = flowShow(page);
   if (page >= pages)
   {
      page = pages - 1;
      flowShow(page);
   }
   drawFoot(pages);
   shownLeft = Math.ceil(leftNow() / 1000);
}

function build()
{
   panel = _root.createEmptyMovieClip("dboPanel", 10);
   dboFit(panel, PANEL_W, PANEL_H);
   var bg = panel.createEmptyMovieClip("bg", 1);
   dboGround(bg, PANEL_W, PANEL_H);
   dboWatermark(panel, 5, PANEL_W - 50, 150, 280);
   dboFadeIn(panel);
}

_root.dboData = function(json)
{
   var p = dboParse(json);
   if (p == null || p.nonce == undefined || p.mode == undefined)
   {
      dboLog("lectern: unreadable payload");
      return;
   }
   // The server redraws in place (the class tick, a sign-up) under the same nonce: that ends a change in flight but keeps
   // the question and the spell picked. A new nonce is a fresh open or the answer to a click.
   if (String(p.nonce) != nonce)
   {
      cancelling = false;
      page = 0;
   }
   nonce = String(p.nonce);
   data = p;
   busy = false;
   // a spell no longer offered is not picked
   var still = false;
   var spells = listOf(p.spells);
   for (var i = 0; i < spells.length; i++)
   {
      still = still || String(spells[i].id) == picked;
   }
   if (!still)
   {
      picked = "";
   }
   endsAt = getTimer() + (Number(p.endsInMs) || 0);
   draw();
};

var keys = {};
keys.onKeyDown = function()
{
   var code = dboKey();
   if (code == 27)
   {
      if (cancelling)
      {
         dboSound("UIMenuCancel");
         cancelling = false;
         draw();
         return;
      }
      closeMenu();
      return;
   }
   if (data == null)
   {
      return;
   }
   if (code == 38 && actions.length)
   {
      setFocus(focus <= 0 ? actions.length - 1 : focus - 1);
   }
   else if (code == 40 && actions.length)
   {
      setFocus(focus < 0 || focus >= actions.length - 1 ? 0 : focus + 1);
   }
   else if (code == 13 && focus >= 0 && actions[focus].disabled != true)
   {
      actions[focus].onPick();
   }
   else if ((code == 37 || code == 33) && page > 0)
   {
      dboSound("UIMenuPrevNext");
      page--;
      draw();
   }
   else if ((code == 39 || code == 34) && flow != null && page + 1 < flow.pages.length)
   {
      dboSound("UIMenuPrevNext");
      page++;
      draw();
   }
};
dboKeys(keys);

_root.onEnterFrame = function()
{
   if (data == null)
   {
      if (getTimer() - builtAt >= NO_DATA_CLOSE_MS)
      {
         dboLog("lectern: no payload in " + NO_DATA_CLOSE_MS + " ms, closing");
         delete _root.onEnterFrame;
         dboClose();
      }
      return;
   }
   // a change that never came back frees the buttons; the countdown is redrawn each second it turns
   if ((busy && !isBusy()) || (data.mode == "running" && Math.ceil(leftNow() / 1000) != shownLeft))
   {
      busy = isBusy();
      draw();
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
