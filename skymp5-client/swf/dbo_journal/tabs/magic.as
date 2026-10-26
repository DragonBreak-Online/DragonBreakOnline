// Magic (schools.js __dboMagicView): two views, Schools (a school's page: level, what its rank allows, the spell to choose,
// the next tomes) and Spell book (prepared and known, by rank). Actions are journalMagic [nonce, op, ...]: firstSpell
// <school> <spell>, prepare and unprepare <spell> where canPrepare, apprenticeLeave, apprenticeRelease <id>
var MAGIC_RANKS = ["Novice", "Apprentice", "Adept", "Expert", "Master"];
var magicOf = "";
var magicView = "schools";
var magicPicked = "";
var magicRank = -1;
var magicAsking = "";
var magicLast = null;

function magicSchoolLabel(s)
{
   var f = s.firstSpell;
   var waits = f != undefined && f.state == "open" ? (f.stage != undefined && f.stage != "first" ? String(f.stage).toLowerCase() + " spell waits" : "a first spell waits") : "";
   return s.name + (s.role != "closed" ? " " + s.level : "") + (waits != "" ? " (" + waits + ")" : "");
}

function magicSchools(sec, ctx)
{
   var schools = listOf(sec.schools);
   var row = [];
   var shown = null;
   for (var i = 0; i < schools.length; i++)
   {
      if (schools[i].name == magicPicked)
      {
         shown = schools[i];
      }
   }
   if (shown == null && schools.length)
   {
      shown = schools[0];
   }
   for (var j = 0; j < schools.length; j++)
   {
      row.push([magicSchoolLabel(schools[j]), function() { dboSound("UIMenuFocus"); magicPicked = this.school; magicAsking = ""; draw(); }, undefined, false, shown != null && schools[j].name == shown.name]);
   }
   var bar = flowButtons(row);
   for (var k = 0; k < schools.length; k++)
   {
      bar["btn" + k].school = schools[k].name;
   }
   if (shown == null)
   {
      return;
   }
   var s = shown;
   var f = s.firstSpell != undefined ? s.firstSpell : {state: "closed"};
   flowHeading(s.name);
   if (s.epithet != undefined && s.epithet != "")
   {
      flowHint(s.epithet);
   }
   if (s.blurb != undefined && s.blurb != "")
   {
      flowText(s.blurb, 17, C_TEXT);
   }
   flowText(s.level + " / 100   " + (s.rank != undefined && s.rank != "" ? s.rank : s.roleLabel) + (s.nextRank != undefined && s.nextRank != "" && s.role != "closed" ? "   -   " + s.nextRank + " at " + s.nextAt : ""), 18, C_TEXT);
   flowText("What your rank allows", 18, C_SECOND);
   flowText(s.allows != undefined ? s.allows.line : "", 17, C_TEXT, 16);
   var at = f.at != undefined ? f.at : sec.firstSpellAt != undefined ? sec.firstSpellAt : 25;
   if (f.state == "open")
   {
      var choices = listOf(f.choices);
      var line = false;
      for (var c = 0; c < choices.length; c++)
      {
         if (choices[c].line != undefined && choices[c].line != "")
         {
            line = true;
         }
      }
      flowHeading("Choose your " + (f.stage != undefined && f.stage != "first" ? f.stage + " spell" : "first spell"));
      flowText("Your study of " + s.name + " has reached " + at + ". Choose one spell to know; the others stay to be learned from tomes." + (line ? " The first follow a spell you know; you keep that one." : "") + (f.held == true ? " Your study of " + s.name + " goes no further until you choose." : ""), 17, C_TEXT);
      for (var d = 0; d < choices.length; d++)
      {
         var ch = choices[d];
         var btns = magicAsking == ch.id ? [["Not yet", function() { dboSound("UIMenuCancel"); magicAsking = ""; draw(); }], ["Learn", function() { ctx.act("journalMagic", ["firstSpell", this._parent.school, this._parent.spell]); }, undefined, ctx.busy || ctx.readOnly]]
            : [["Choose", function() { dboSound("UIMenuOK"); magicAsking = this._parent.spell; draw(); }, undefined, ctx.busy || ctx.readOnly]];
         var e = flowEntry(ch.name, btns, ch.blurb);
         e.school = s.name;
         e.spell = ch.id;
      }
   }
   else if (f.state == "made" && f.spell != undefined && f.spell != "")
   {
      flowText("Your first spell of " + s.name + ": " + f.spell + ".", 17, C_SECOND);
   }
   else if (f.state == "later")
   {
      flowText("At " + at + " you choose your first spell" + (f.spells != undefined && f.spells != "" ? ": " + f.spells : "") + ".", 17, C_SECOND);
   }
   var rs = listOf(s.rankSpells);
   for (var r = 0; r < rs.length; r++)
   {
      if (rs[r].spell != undefined && rs[r].spell != "")
      {
         flowText("Your " + rs[r].rank + " spell of " + s.name + ": " + rs[r].spell + ".", 17, C_SECOND);
      }
   }
   if (s.nextPick != undefined && s.nextPick != null && f.state != "open")
   {
      flowText("At " + s.nextPick.at + " you choose your " + s.nextPick.rank + " spell; your study of " + s.name + " waits there until you do.", 17, C_SECOND);
   }
   var tomes = listOf(s.recommendations);
   if (tomes.length)
   {
      flowHeading("Next tomes for you");
      for (var t = 0; t < tomes.length; t++)
      {
         flowRow(tomes[t].spell + "   " + tomes[t].rankName, tomes[t].where);
      }
   }
   var sw = sec.swap;
   if (sw != undefined && sw != null && sw.enabled == true && s.swapStartsAt > 0 && s.role != "priest")
   {
      flowText("Changing your primary school to " + s.name + " would start it at " + s.swapStartsAt + ". " + sw.where + "." + (sw.can == true ? "" : " " + sw.why), 16, C_SECOND);
   }
   if (sec.note != undefined && sec.note != "")
   {
      flowHint(sec.note);
   }
   magicApprentices(sec, ctx);
}

function magicApprentices(sec, ctx)
{
   var ap = sec.apprenticeship;
   if (ap == undefined || ap == null)
   {
      return;
   }
   var a = ap.apprentice;
   if (a != undefined && a != null)
   {
      flowHeading("Apprenticeship");
      var text = "Apprentice of " + a.teacher + " in " + a.spell + " (" + a.rank + " " + a.school + "): " + a.xp + " of " + a.need + " studied, " + a.today + " of " + a.dailyXp + " today. " + (a.near == true ? "You are near your teacher: cast it to study." : "Go to your teacher to cast and study it.");
      flowEntry(text, a.canLeave == true ? [["Leave", function() { ctx.ask("Leave your apprenticeship?", "Leave it", function() { ctx.act("journalMagic", ["apprenticeLeave"]); }, true); }, undefined, ctx.busy || ctx.readOnly]] : []);
   }
   var list = listOf(ap.apprentices);
   if (list.length)
   {
      flowText("Your apprentices" + (ap.max > 1 ? " (" + list.length + " of " + ap.max + ")" : "") + ":", 17, C_TEXT);
   }
   for (var i = 0; i < list.length; i++)
   {
      var x = list[i];
      var e = flowEntry("    " + x.name + " (" + x.spell + ")", x.id != undefined && x.id != "" ? [["Release", function()
      {
         var row = this._parent;
         ctx.ask("Release " + row.who + "?", "Release " + row.who, function() { ctx.act("journalMagic", ["apprenticeRelease", row.apprenticeId]); }, true);
      }, undefined, ctx.busy || ctx.readOnly]] : []);
      e.who = x.name;
      e.apprenticeId = x.id;
   }
}

function magicSpell(sp, can, ctx)
{
   var btns = [];
   var mark = "";
   if (sp.outside == true)
   {
      mark = "known without study";
   }
   else if (can)
   {
      btns = [[sp.prepared == true ? "Put away" : "Prepare", function() { ctx.act("journalMagic", [this._parent.prepared ? "unprepare" : "prepare", this._parent.spellId]); }, undefined, ctx.busy || ctx.readOnly]];
   }
   else if (sp.prepared == true)
   {
      mark = "prepared";
   }
   var e = flowEntry(sp.name + "   " + sp.school + "   " + sp.rankName + (mark != "" ? "   (" + mark + ")" : ""), btns);
   e.spellId = sp.id;
   e.prepared = sp.prepared == true;
}

function magicBook(sec, ctx)
{
   var book = sec.book != undefined && sec.book != null ? sec.book : {max: 3, canPrepare: false, hint: "", prepared: [], known: [], outside: []};
   var prep = listOf(book.prepared);
   flowHeading("Prepared (" + prep.length + " / " + book.max + ")");
   if (!prep.length)
   {
      flowHint("No spell is prepared.");
   }
   for (var i = 0; i < prep.length; i++)
   {
      prep[i].prepared = true;
      magicSpell(prep[i], book.canPrepare == true, ctx);
   }
   flowHint(book.canPrepare == true ? "You may prepare and put away spells here." : book.hint != undefined && book.hint != "" ? book.hint : "Change your prepared spells at a Scholars' Ledger.");
   flowHeading("Known spells");
   var ranks = sec.ranks instanceof Array ? sec.ranks : MAGIC_RANKS;
   var chips = [["All", function() { magicRank = -1; draw(); }, undefined, false, magicRank < 0]];
   for (var r = 0; r < ranks.length; r++)
   {
      chips.push([ranks[r], function() { magicRank = this.rank; draw(); }, undefined, false, magicRank == r]);
   }
   var bar = flowButtons(chips);
   for (var b = 0; b < ranks.length; b++)
   {
      bar["btn" + (b + 1)].rank = b;
   }
   var known = listOf(book.known).slice();
   var out = listOf(book.outside);
   for (var o = 0; o < out.length; o++)
   {
      out[o].outside = true;
      known.push(out[o]);
   }
   var n = 0;
   for (var k = 0; k < known.length; k++)
   {
      if (magicRank < 0 || known[k].rank == magicRank)
      {
         magicSpell(known[k], book.canPrepare == true && known[k].outside != true, ctx);
         n++;
      }
   }
   if (!n)
   {
      flowHint(magicRank < 0 ? "No spell is known yet." : "No " + (MAGIC_RANKS[magicRank] != undefined ? MAGIC_RANKS[magicRank] : "") + " spell is known.");
   }
}

JT.magic = function(sec, ctx)
{
   if (sec.open != true)
   {
      flowText(sec.note != undefined && sec.note != "" ? sec.note : "Magic opens with Arcane Arts or Priest on your Wheel of Skills.", 18, C_SECOND);
      return;
   }
   if (magicOf != cacheOf)
   {
      magicOf = cacheOf;
      magicView = "schools";
      magicRank = -1;
      var schools = listOf(sec.schools);
      var open = null;
      for (var i = 0; i < schools.length; i++)
      {
         if (open == null && schools[i].firstSpell != undefined && schools[i].firstSpell.state == "open")
         {
            open = schools[i].name;
         }
      }
      magicPicked = sec.primary != undefined && sec.primary != "" ? sec.primary : open != null ? open : schools.length ? schools[0].name : "";
   }
   if (sec != magicLast)
   {
      magicLast = sec;
      magicAsking = "";
   }
   flowButtons([["Schools", function() { dboSound("UIMenuPrevNext"); magicView = "schools"; pages[tab] = 0; draw(); }, undefined, false, magicView == "schools"],
      ["Spell book", function() { dboSound("UIMenuPrevNext"); magicView = "book"; pages[tab] = 0; draw(); }, undefined, false, magicView == "book"]]);
   if (magicView == "book")
   {
      magicBook(sec, ctx);
   }
   else
   {
      magicSchools(sec, ctx);
   }
};
