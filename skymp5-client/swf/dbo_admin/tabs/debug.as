// Debug (every player): the twelve read-outs of the browser tab, three rows of four, and the active effects. The clocks
// tick here between the service's 5 s pushes.
var DEBUG_MONTHS = ["Morning Star", "Sun's Dawn", "First Seed", "Rain's Hand", "Second Seed", "Midyear", "Sun's Height", "Last Seed", "Hearthfire", "Frostfall", "Sun's Dusk", "Evening Star"];
var DEBUG_WEEKDAYS = ["Sundas", "Morndas", "Tirdas", "Middas", "Turdas", "Fredas", "Loredas"];
var debugTickAt = 0;
var debugPage = 0;

function hexId(id)
{
   return str(id) != "" ? "0x" + str(id).toUpperCase() : "-";
}

function ordinal(n)
{
   var tens = n % 100;
   if (tens >= 11 && tens <= 13)
   {
      return n + "th";
   }
   var ones = n % 10;
   return n + (ones == 1 ? "st" : ones == 2 ? "nd" : ones == 3 ? "rd" : "th");
}

// MM/DD/YY HH:MM in a zone given by its offset in minutes, as the browser's formatClock
function formatClock(ms, tzOffsetMin)
{
   var d = new Date(ms - tzOffsetMin * 60000);
   return pad2(d.getUTCMonth() + 1) + "/" + pad2(d.getUTCDate()) + "/" + pad2(d.getUTCFullYear() % 100) + " " + pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes());
}

function gameClock(gt)
{
   if (gt == undefined || gt == null)
   {
      return "unknown";
   }
   var h = Math.floor(gt.hour);
   return pad2(h) + ":" + pad2(Math.floor((gt.hour - h) * 60));
}

function gameDate(gt)
{
   if (gt == undefined || gt == null)
   {
      return "";
   }
   var month = DEBUG_MONTHS[Math.round(gt.month)] != undefined ? DEBUG_MONTHS[Math.round(gt.month)] : "?";
   var weekday = DEBUG_WEEKDAYS[Math.round(gt.weekday)] != undefined ? DEBUG_WEEKDAYS[Math.round(gt.weekday)] : "?";
   return weekday + ", " + ordinal(Math.round(gt.day)) + " of " + month + ", 4E " + Math.round(gt.year);
}

function pair(v)
{
   return v instanceof Array && v.length ? Math.round(v[0]) + "/" + Math.round(v[1] || 0) : "-";
}

// [label, value, sub, hint] in the browser's order
function debugCells(d, now)
{
   var server = d.server;
   var cell = d.cell;
   var place = "";
   if (cell != undefined && cell != null)
   {
      place = str(cell.name != "" ? cell.name : cell.location);
      if (cell.interior != true && str(cell.world) != "")
      {
         place = trimText(place + " (" + cell.world + ")");
      }
   }
   var av = d.av != undefined ? d.av : {health: [], magicka: [], stamina: []};
   var pos = d.pos instanceof Array ? Math.round(d.pos[0]) + " " + Math.round(d.pos[1]) + " " + Math.round(d.pos[2]) : "-";
   return [
      ["Account Name", str(d.account) != "" ? d.account : "-"],
      ["Character Name", str(d.character) != "" ? d.character : "-"],
      ["FormID", hexId(str(d.formId) != "" ? d.formId : d.actorId)],
      ["Server Name", server != undefined && server != null ? (str(server.name) != "" ? server.name : "-") : "unknown"],
      ["Character POS (X Y Z)", pos],
      ["LocationID (Cell ID)", cell != undefined && cell != null ? hexId(cell.id) : "unknown", place],
      ["Direction Facing", d.heading != undefined ? d.heading.compass + " " + Math.round(d.heading.deg) + " deg" : "-"],
      ["Target Distance", d.target != undefined && d.target != null ? (str(d.target.name) != "" ? d.target.name : hexId(d.target.id)) + " " + Math.round(d.target.dist) + " u" : "no target", "", "Activatable references only"],
      ["Magicka / Health / Stamina", pair(av.magicka) + " | " + pair(av.health) + " | " + pair(av.stamina)],
      ["Game Time/Date", gameClock(d.gameTime), gameDate(d.gameTime)],
      ["Local Time/Date", formatClock(now, new Date(now).getTimezoneOffset())],
      ["Server Time/Date", server != undefined && server != null ? formatClock(now + Number(server.offsetMs), Number(server.tzOffsetMin)) : "unknown"]
   ];
}

TABS.debug = {
   draw: function(c, x, y, w, h)
   {
      var d = data.debug;
      if (d == undefined || d == null)
      {
         empty(c, "waiting", 1, x, y + 10, w, "Waiting for game data");
         return;
      }
      var now = new Date().getTime();
      var cells = debugCells(d, now);
      var cw = Math.floor(w / 4);
      for (var i = 0; i < cells.length; i++)
      {
         var cx = x + (i % 4) * cw;
         var cy = y + Math.floor(i / 4) * 78;
         hint(c, "l" + i, 10 + i * 4, cx, cy, cw - 12, cells[i][0]);
         label(c, "v" + i, 11 + i * 4, cx, cy + 20, cw - 12, cut(cells[i][1], 34), 20, C_TEXT);
         if (cells[i][2] != undefined && cells[i][2] != "")
         {
            label(c, "s" + i, 12 + i * 4, cx, cy + 44, cw - 12, cut(cells[i][2], 40), 16, C_TEXT);
         }
         if (cells[i][3] != undefined)
         {
            hint(c, "h" + i, 13 + i * 4, cx, cy + 44, cw - 12, cells[i][3]);
         }
      }
      var ty = y + 3 * 78 + 6;
      dboDivider(c, x, ty, w);
      section(c, "fxHead", 80, x, ty + 10, 500, "Active effects");
      hint(c, "fxForm", 81, x + 520, ty + 12, 200, "Form ID");
      hint(c, "fxElapsed", 82, x + 740, ty + 12, 200, "Elapsed");
      var fx = d.effects instanceof Array ? d.effects : [];
      if (!fx.length)
      {
         empty(c, "fxNone", 83, x, ty + 44, w, "No active effects");
         return;
      }
      // the client gathered the block a moment ago: that time is added to each effect's
      var drift = Math.max(0, Math.round((now - Number(d.updatedAt)) / 1000));
      var per = 6;
      var pages = Math.max(1, Math.ceil(fx.length / per));
      debugPage = Math.max(0, Math.min(pages - 1, debugPage));
      var rows = fx.slice(debugPage * per, debugPage * per + per);
      for (var k = 0; k < rows.length; k++)
      {
         var ry = ty + 44 + k * 28;
         label(c, "fxn" + k, 90 + k * 3, x, ry, 500, cut(str(rows[k].name) != "" ? rows[k].name : "-", 50), 18, C_TEXT);
         label(c, "fxi" + k, 91 + k * 3, x + 520, ry, 200, hexId(rows[k].id), 18, C_SECOND);
         label(c, "fxe" + k, 92 + k * 3, x + 740, ry, 200, countdown(Number(rows[k].elapsedSec) + drift), 18, C_TEXT);
      }
      pageTurn = function(dd)
      {
         var p = Math.max(0, Math.min(pages - 1, debugPage + dd));
         if (p != debugPage)
         {
            dboSound("UIMenuPrevNext");
            debugPage = p;
            draw();
         }
      };
      if (pages > 1)
      {
         hint(c, "fxPage", 130, x, ty + 44 + per * 28 + 4, 400, "Effects page " + (debugPage + 1) + " of " + pages + "  (Left / Right)");
      }
   },
   // the clocks and the effects' times move once a second
   tick: function()
   {
      var now = getTimer();
      if (editing == null && !picking && now - debugTickAt >= 1000)
      {
         debugTickAt = now;
         draw();
      }
   }
};
