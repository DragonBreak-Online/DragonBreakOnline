// Deity (prayer.js deityView): the faiths, each opening onto its patrons (or, from a server without faiths, the gods by kind),
// beside the chosen god's page. "Take" or "Turn to" asks once more, then sends journalDeity [nonce, deityId, faithId?]
var DEITY_GROUPS = [["divine", "The Divines"], ["daedra", "The Daedric Princes"], ["faith", "Other faiths"]];
var DEITY_ASPECT_NOTE = {akatosh: "the Aldmeri Akatosh"};
var DEITY_RULES = {greenpact: "A wood elf sworn to the Pact may not cut wood or pick plants, and partakes of the enemies they slay (E on the body). A player's body only with their consent."};
var DEITY_LIST_W = 400;
var DEITY_ROWS = 11;
var deityOf = "";
var deityFaith = "";
var deityPicked = "";
var deityConfirm = false;
var deityPage = 0;
var deityLast = null;

function deityById(s, id)
{
   var c = listOf(s.choices);
   for (var i = 0; i < c.length; i++)
   {
      if (c[i].id == id)
      {
         return c[i];
      }
   }
   return null;
}

function deityFaithById(s, id)
{
   var f = listOf(s.faiths);
   for (var i = 0; i < f.length; i++)
   {
      if (f[i].id == id)
      {
         return f[i];
      }
   }
   return null;
}

function hasId(list, id)
{
   for (var i = 0; i < list.length; i++)
   {
      if (list[i] == id)
      {
         return true;
      }
   }
   return false;
}

function shrinesLine(c)
{
   if (c.prayAnywhere == true)
   {
      return "No shrine is needed: kneel anywhere and pray.";
   }
   if (c.inBruma > 0)
   {
      return plural(c.inBruma, "shrine", "shrines") + " in Bruma.";
   }
   return "No shrine within reach while the land is closed beyond Bruma.";
}

function deityMarks(s, c, inOpenFaith)
{
   var m = [];
   if (c.id == s.current && inOpenFaith)
   {
      m.push("your god");
   }
   if (c.lawful != true)
   {
      m.push("Unlawful");
   }
   if (c.reachable != true)
   {
      m.push("no shrine within reach");
   }
   return m.join("  -  ");
}

// The left column as rows: [label, kind ("faith" or "god"), id, mark, indent]
function deityRows(s)
{
   var rows = [];
   var faiths = listOf(s.faiths);
   var choices = listOf(s.choices);
   if (faiths.length)
   {
      var sorted = faiths.slice();
      sorted.sort(function(x, y) { return (y.suggested == true ? 1 : 0) - (x.suggested == true ? 1 : 0); });
      for (var i = 0; i < sorted.length; i++)
      {
         var f = sorted[i];
         var fm = [];
         if (f.id == s.faith)
         {
            fm.push("your faith");
         }
         if (f.suggested == true)
         {
            fm.push("of your people");
         }
         rows.push([f.name, "faith", f.id, fm.join("  -  "), 0]);
         if (f.id == deityFaith)
         {
            var pats = listOf(f.patrons);
            for (var p = 0; p < pats.length; p++)
            {
               var c = deityById(s, pats[p]);
               if (c != null)
               {
                  var par = c.aspectOf != undefined && c.aspectOf != "" ? deityById(s, c.aspectOf) : null;
                  rows.push([c.name + (par != null ? " (an aspect of " + par.name + ")" : ""), "god", c.id, deityMarks(s, c, deityFaith == s.faith), 1]);
               }
            }
         }
      }
      return rows;
   }
   for (var g = 0; g < DEITY_GROUPS.length; g++)
   {
      var head = false;
      for (var k = 0; k < choices.length; k++)
      {
         var d = choices[k];
         if (d.kind != DEITY_GROUPS[g][0] || (d.aspectOf != undefined && d.aspectOf != ""))
         {
            continue;
         }
         if (!head)
         {
            rows.push([DEITY_GROUPS[g][1], "head", "", "", 0]);
            head = true;
         }
         rows.push([d.name, "god", d.id, deityMarks(s, d, true), 0]);
         for (var a = 0; a < choices.length; a++)
         {
            if (choices[a].aspectOf == d.id)
            {
               var note = DEITY_ASPECT_NOTE[d.id] != undefined ? DEITY_ASPECT_NOTE[d.id] : "an aspect of " + d.name;
               rows.push([choices[a].name + " (" + note + ")", "god", choices[a].id, deityMarks(s, choices[a], true), 1]);
            }
         }
      }
   }
   return rows;
}

JT.deity = function(s, ctx)
{
   var choices = listOf(s.choices);
   var faiths = listOf(s.faiths);
   if (deityOf != cacheOf)
   {
      deityOf = cacheOf;
      var sug = null;
      for (var i = 0; i < faiths.length; i++)
      {
         if (faiths[i].suggested == true && sug == null)
         {
            sug = faiths[i];
         }
      }
      deityFaith = s.faith != undefined && s.faith != "" ? s.faith : sug != null ? sug.id : faiths.length ? faiths[0].id : "";
      deityPicked = s.current != undefined && s.current != "" ? s.current : choices.length ? choices[0].id : "";
      deityPage = 0;
   }
   if (s != deityLast)
   {
      deityLast = s;
      deityConfirm = false;
   }
   var c = flowWhole();
   var rows = deityRows(s);
   var pages = Math.max(1, Math.ceil(rows.length / DEITY_ROWS));
   deityPage = Math.min(deityPage, pages - 1);
   var y = 0;
   colText(c, 0, y, DEITY_LIST_W, faiths.length ? "The faiths" : "The gods", 20, C_TEXT, F_BOLD);
   y = 34;
   var shown = deityById(s, deityPicked);
   if (shown == null && choices.length)
   {
      shown = choices[0];
   }
   for (var r = deityPage * DEITY_ROWS; r < rows.length && r < (deityPage + 1) * DEITY_ROWS; r++)
   {
      var row = rows[r];
      if (row[1] == "head")
      {
         colText(c, 0, y + 4, DEITY_LIST_W, row[0], 16, C_SECOND, F_BOLD);
      }
      else
      {
         var on = row[1] == "faith" ? row[2] == deityFaith : shown != null && row[2] == shown.id;
         var b = colRow(c, row[4] * 20, y, DEITY_LIST_W - row[4] * 20, row[0], on, function()
         {
            dboSound("UIMenuFocus");
            deityConfirm = false;
            if (this.kind == "faith")
            {
               deityFaith = this.rowId;
               var f = deityFaithById(s, this.rowId);
               var pats = f != null ? listOf(f.patrons) : [];
               if (!hasId(pats, deityPicked))
               {
                  deityPicked = hasId(pats, s.current) ? s.current : pats.length ? pats[0] : deityPicked;
               }
            }
            else
            {
               deityPicked = this.rowId;
            }
            draw();
         }, row[3]);
         b.kind = row[1];
         b.rowId = row[2];
      }
      y += 32;
   }
   if (pages > 1)
   {
      var up = button(c, "dup", fd(), 0, DEITY_ROWS * 32 + 40, 120, "Up the list", F_MEDIUM, 15, A_BUTTON_REST, function() { deityPage--; draw(); });
      var dn = button(c, "ddn", fd(), 130, DEITY_ROWS * 32 + 40, 120, "Down the list", F_MEDIUM, 15, A_BUTTON_REST, function() { deityPage++; draw(); });
      if (deityPage == 0)
      {
         disable(up);
      }
      if (deityPage >= pages - 1)
      {
         disable(dn);
      }
   }
   if (shown == null)
   {
      return;
   }
   var x = DEITY_LIST_W + 40;
   var w = BODY_W - x;
   var faith = deityFaithById(s, deityFaith);
   var inFaith = faith != null && hasId(listOf(faith.patrons), shown.id);
   var mine = deityById(s, s.current);
   var myFaith = deityFaithById(s, s.faith);
   var sameFaith = faith != null && faith.id == s.faith;
   var yours = shown.id == s.current && (!faiths.length || sameFaith);
   var wait = mine == null ? 0 : faiths.length && sameFaith ? Number(s.patronDaysLeft) || 0 : Number(s.daysLeft) || 0;
   var keep = faiths.length && sameFaith ? Number(s.patronChangeDays) || 1 : s.cooldownDays;
   var py = 0;
   if (faith != null && inFaith)
   {
      py = colText(c, x, py, w, faith.name, 16, C_SECOND);
   }
   py = colText(c, x, py, w, shown.name, 28, C_TEXT, F_PLAIN);
   var par = shown.aspectOf != undefined && shown.aspectOf != "" ? deityById(s, shown.aspectOf) : null;
   if (par != null)
   {
      py = colText(c, x, py, w, "An aspect of " + par.name, 16, C_SECOND);
   }
   if (shown.sphere != undefined && shown.sphere != "")
   {
      py = colText(c, x, py, w, shown.sphere, 17, C_SECOND);
   }
   var aka = listOf(shown.alsoKnownAs);
   if (aka.length)
   {
      py = colText(c, x, py, w, "Also known as " + aka.join(", "), 16, C_SECOND);
   }
   py += 8;
   var facts = [["Boon", shown.boon != undefined && shown.boon != "" ? shown.boon : "None recorded."],
      ["Shrines", shrinesLine(shown) + (faith != null && inFaith ? " Any shrine of " + faith.name + " hears you; your own god's answers most often." : "")],
      ["Under the law", shown.lawful == true ? "Lawful throughout the Empire." : shown.unlawfulWhere != undefined && shown.unlawfulWhere != "" ? shown.unlawfulWhere : "Proscribed in the Empire."]];
   if (faith != null && inFaith && DEITY_RULES[faith.id] != undefined)
   {
      facts.push(["The faith asks", DEITY_RULES[faith.id]]);
   }
   for (var k = 0; k < facts.length; k++)
   {
      colText(c, x, py, 150, facts[k][0], 16, C_SECOND);
      py = colText(c, x + 160, py, w - 160, facts[k][1], 16, k == 2 && shown.lawful != true ? C_RED : C_TEXT) + 4;
   }
   dboRule(c, x, py + 4, w);
   py += 12;
   var state;
   if (mine == null)
   {
      state = s.first == true ? "You follow no god yet. Your first choice is free and needs no shrine." : "You follow no god.";
   }
   else
   {
      state = "You follow " + mine.name + (myFaith != null ? ", in " + myFaith.name : "") + "." + (s.daysLeft > 0 ? " Another faith in " + plural(s.daysLeft, "day", "days") + "." : "")
         + (faiths.length && (Number(s.patronDaysLeft) || 0) > 0 ? " Another god of your faith in " + plural(Number(s.patronDaysLeft), "day", "days") + "." : "");
   }
   py = colText(c, x, py, w, state, 17, C_TEXT) + 6;
   var verb = mine != null ? "Turn to" : "Take";
   var canTurn = !yours && wait == 0 && !ctx.busy && !ctx.readOnly && (!faiths.length || inFaith);
   if (yours)
   {
      colText(c, x, py, w, shown.name + " is your god.", 16, C_SECOND);
      return;
   }
   if (deityConfirm)
   {
      var q;
      if (mine == null)
      {
         q = "Take " + shown.name + " as your god" + (faith != null ? ", in " + faith.name : "") + "?";
      }
      else if (faiths.length && sameFaith)
      {
         q = "Turn from " + mine.name + " to " + shown.name + " within " + (faith != null ? faith.name : "your faith") + "? You keep a new god at least " + plural(keep, "day", "days") + ".";
      }
      else
      {
         q = "Leave " + (myFaith != null ? myFaith.name : mine.name) + " for " + (faith != null ? faith.name : shown.name) + "? You keep a new faith at least " + plural(keep, "day", "days") + ".";
      }
      py = colText(c, x, py, w, q, 17, C_TEXT) + 4;
      button(c, "dno", fd(), x, py, 120, "Not yet", F_MEDIUM, 17, A_BUTTON_REST, function() { dboSound("UIMenuCancel"); deityConfirm = false; draw(); });
      var go = button(c, "dgo", fd(), x + 130, py, 260, verb + " " + shown.name, F_MEDIUM, 17, A_BUTTON_REST, function()
      {
         ctx.act("journalDeity", faith != null ? [shown.id, faith.id] : [shown.id]);
      });
      if (!canTurn)
      {
         disable(go);
      }
      return;
   }
   var t = button(c, "dturn", fd(), x, py, 260, verb + " " + shown.name, F_MEDIUM, 17, A_BUTTON_REST, function() { dboSound("UIMenuOK"); deityConfirm = true; draw(); });
   if (!canTurn)
   {
      disable(t);
      if (wait > 0)
      {
         colText(c, x + 270, py + 4, w - 270, "You may turn again in " + plural(wait, "day", "days"), 15, C_SECOND);
      }
   }
};
