// GM Calls (server gmcall.js): the open calls, two to a page with their last four lines, with Take or Take over, Go to, Release, a note and Close
// (which asks first); the banners switch; the lately closed. As the browser's tab: the list comes as a staffData widget,
// watched while the tab is open, and every button is dbo:staffGmCalls <what> <n> <note>.
var gmLocal = {notes: {}, tickAt: 0};

function gmNow()
{
   return Number(data.gmcalls.serverNow) + (getTimer() - dataAt);
}

function gmOp(what, n, note)
{
   dboSound("UIMenuOK");
   dboSend("dbo:staffGmCalls", [what, n, note == undefined ? "" : note]);
}

TABS.gmcalls = {
   open: function()
   {
      dboSend("dbo:staffGmCalls", ["watch"]);
   },
   leave: function()
   {
      dboSend("dbo:staffGmCalls", ["unwatch"]);
   },
   // the ages move on every 15 s, as the browser's
   tick: function()
   {
      if (editing == null && !picking && getTimer() - gmLocal.tickAt >= 15000)
      {
         gmLocal.tickAt = getTimer();
         draw();
      }
   },
   draw: function(c, x, y, w, h)
   {
      var G = data.gmcalls;
      if (G == undefined || G.loading == true)
      {
         empty(c, "loading", 1, x, y + 10, w, "Loading GM calls");
         return;
      }
      var now = gmNow();
      var sub = str(ui.sub) == "closed" ? "closed" : "open";
      chips(c, "sub", 1, x, y, x + 300, [["open", "Open " + G.openCount], ["closed", "Lately closed"]], sub, function()
      {
         dboSound("UIMenuPrevNext");
         setUi("sub", this.key, true);
         draw();
      });
      label(c, "count", 5, x + 300, y + 2, 260, G.openCount ? G.openCount + " open, " + G.waiting + " waiting" : "No open GM calls", 18, C_TEXT);
      var q = chip(c, "quiet", 6, x + 560, y, G.quiet == true ? "Banners off" : "Banners on", G.quiet == true, function()
      {
         dboSound("UIMenuOK");
         dboSend("dbo:staffGmCalls", ["quiet", data.gmcalls.quiet == true ? "off" : "on"]);
      });
      var top = y + 40;
      if (sub == "closed")
      {
         var closed = G.closed instanceof Array ? G.closed : [];
         if (!closed.length)
         {
            empty(c, "noneClosed", 10, x, top, w, "Nothing closed lately");
         }
         for (var k = 0; k < closed.length; k++)
         {
            var cl = closed[k];
            label(c, "cn" + k, 20 + k * 3, x, top + k * 34, 260, cut("#" + cl.n + " " + cl.name, 26), 18, C_TEXT);
            hint(c, "ch" + k, 21 + k * 3, x + 270, top + k * 34 + 2, 300, cl.how + (str(cl.by) != "" ? " by " + cl.by : "") + ", " + ago(now - cl.at));
            hint(c, "cnote" + k, 22 + k * 3, x + 580, top + k * 34 + 2, w - 580, cut(cl.note, 50));
         }
         return;
      }
      var open = G.open instanceof Array ? G.open : [];
      if (!open.length)
      {
         empty(c, "none", 10, x, top, w, "Nobody is waiting for a GM");
      }
      var cy = top;
      for (var i = 0; i < open.length; i++)
      {
         var call = open[i];
         var d = 40 + i * 30;
         label(c, "name" + i, d, x, cy, 300, cut("#" + call.n + " " + call.name + (call.online == true ? "" : " (offline)"), 30), 18, C_TEXT);
         hint(c, "place" + i, d + 1, x + 310, cy + 2, 300, cut(call.place, 36));
         hint(c, "ago" + i, d + 2, x + 620, cy + 2, 150, ago(now - call.at));
         var st = label(c, "state" + i, d + 3, x + 780, cy, w - 780, call.takenBy != "" ? (call.mine == true ? "Yours" : cut("Taken by " + call.takenBy, 22)) : "Waiting", 18, call.takenBy != "" ? C_SECOND : C_GOLD);
         var ly = cy + 26;
         var lines = call.lines instanceof Array ? call.lines : [];
         for (var l = 0; l < lines.length && l < 4; l++)
         {
            var lt = label(c, "line" + i + "_" + l, d + 4 + l, x + 12, ly, w - 12, cut((l ? "+" + ago(lines[l].at - call.at).split(" ago").join("").split("just now").join("0 min") + "  " : "") + lines[l].text, 110), 16, C_TEXT);
            ly += 22;
         }
         if (str(call.ticket) != "")
         {
            hint(c, "ticket" + i, d + 8, x + 12, ly, 300, "Discord ticket #" + call.ticket);
            ly += 22;
         }
         var bx = x;
         if (call.mine != true)
         {
            var tk = btn(c, "take" + i, d + 10, bx, ly, 0, call.takenBy != "" ? "Take over" : "Take", function()
            {
               gmOp("take", this.n);
            });
            tk.n = call.n;
            bx += textW(call.takenBy != "" ? "Take over" : "Take", 18) + 6;
         }
         if (G.canGoto == true)
         {
            var gl = call.online == true ? "Go to" : "Go to (where they called)";
            var go = btn(c, "goto" + i, d + 11, bx, ly, 0, gl, function()
            {
               gmOp("goto", this.n);
            });
            go.n = call.n;
            bx += textW(gl, 18) + 6;
         }
         if (call.takenBy != "")
         {
            var rl = btn(c, "release" + i, d + 12, bx, ly, 0, "Release", function()
            {
               gmOp("release", this.n);
            });
            rl.n = call.n;
            bx += textW("Release", 18) + 6;
         }
         field(c, "note" + call.n, d + 13, bx, ly + 2, Math.max(160, w - (bx - x) - 150), gmLocal.notes[call.n], "Note for staff (optional)", 300, makeNoteCommit(call.n));
         var cb = confirmBtn(c, "close" + i, d + 14, x + w - 140, ly, 140, "Close", "gmclose:" + call.n, function()
         {
            gmOp("close", this.n, gmLocal.notes[this.n]);
            gmLocal.notes[this.n] = "";
         });
         cb.n = call.n;
         cy = ly + 40;
         dboRule(c, x, cy - 4, w);
      }
      pager(c, "pg", 160, x, CB - 30, Number(G.page), Number(G.pages), Number(G.openCount), "call");
   }
};

function makeNoteCommit(n)
{
   return function(text)
   {
      gmLocal.notes[n] = text;
   };
}
