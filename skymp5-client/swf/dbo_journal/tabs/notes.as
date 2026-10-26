// Notes, the Personal Journal (journalnotes.js): two views, the list (by folder, received, carried) and the open page with
// its actions (tear out, write out on paper, keep a copy, remove). Opening a page is a tab switch with a focus; writing an
// entry, editing one and naming folders are typed, so they open this tab in the browser journal.
// Actions are dbo:journalNotes [nonce, op, ...]
var notesFilter = "all";
var notesFolder = "";
var notesList = true;
var notesOpenId = "";
var notesSigned = true;
var notesOf = "";

function notesDate(ms)
{
   if (ms == undefined || !ms)
   {
      return "";
   }
   var d = new Date(Number(ms));
   return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
}

function notesFolderName(folders, id)
{
   for (var i = 0; i < folders.length; i++)
   {
      if (folders[i].id == id)
      {
         return folders[i].name;
      }
   }
   return "";
}

function notesShow(ctx, focusArg)
{
   notesList = false;
   ctx.openTab("notes", focusArg);
}

function notesListView(s, ctx)
{
   var L = s.limits;
   var off = ctx.busy || ctx.readOnly;
   var folders = listOf(s.folders);
   var entries = listOf(s.entries);
   var received = listOf(s.received);
   var carried = listOf(s.carried);
   var chips = [["All entries (" + entries.length + ")", function() { notesFilter = "all"; draw(); }, undefined, false, notesFilter == "all"]];
   for (var f = 0; f < folders.length; f++)
   {
      chips.push([folders[f].name + " (" + folders[f].count + ")", function() { notesFilter = "folder"; notesFolder = this.folder; draw(); }, undefined, false, notesFilter == "folder" && notesFolder == folders[f].id]);
   }
   chips.push(["Received (" + received.length + ")", function() { notesFilter = "received"; draw(); }, undefined, false, notesFilter == "received"]);
   if (carried.length)
   {
      chips.push(["Writings you carry (" + carried.length + ")", function() { notesFilter = "carried"; draw(); }, undefined, false, notesFilter == "carried"]);
   }
   var bar = flowButtons(chips);
   for (var b = 0; b < folders.length; b++)
   {
      bar["btn" + (b + 1)].folder = folders[b].id;
   }
   if (notesFilter == "all" || notesFilter == "folder")
   {
      flowButtons([["New entry...", function() { ctx.browser(); }, undefined, off || entries.length >= L.entriesMax], ["Folders...", function() { ctx.browser(); }, undefined, off]]);
      var n = 0;
      for (var i = 0; i < entries.length; i++)
      {
         var e = entries[i];
         if (notesFilter == "folder" && e.folder != notesFolder)
         {
            continue;
         }
         n++;
         var row = flowEntry(e.title, [["Open", function() { notesShow(ctx, {entry: this._parent.entryId}); }]], (notesFilter == "all" && e.folder != undefined && e.folder != "" ? notesFolderName(folders, e.folder) + "  -  " : "") + notesDate(e.edited ? e.edited : e.at));
         row.entryId = e.id;
      }
      if (!n)
      {
         flowHint(notesFilter == "folder" ? "Nothing in this folder yet." : "Your journal is empty. Write what you want to remember: it stays yours alone.");
      }
      flowHint(entries.length + " of " + L.entriesMax + " entries.");
      if (notesFilter == "folder")
      {
         var fname = notesFolderName(folders, notesFolder);
         flowButtons([["Remove the folder " + fname, function()
         {
            ctx.ask("Remove the folder " + fname + "?", "Remove it", function() { ctx.act("dbo:journalNotes", ["folderDelete", notesFolder]); notesFilter = "all"; }, true);
         }, C_RED, off]]);
      }
   }
   else if (notesFilter == "received")
   {
      if (!received.length)
      {
         flowHint("Writings others give you can be copied in here: read one from your pack, or open it under Writings you carry.");
      }
      for (var r = 0; r < received.length; r++)
      {
         var rr = flowEntry(received[r].title, [["Open", function() { notesShow(ctx, {received: this._parent.rid}); }]], received[r].itemKind + "  -  " + received[r].author);
         rr.rid = received[r].id;
      }
   }
   else
   {
      for (var c = 0; c < carried.length; c++)
      {
         var w = carried[c];
         var cr = flowEntry(w.title, [["Open", function() { notesShow(ctx, {work: this._parent.wid}); }]], w.itemKind + "  -  " + w.author + (w.kept == true ? "  -  kept" : ""));
         cr.wid = w.id;
      }
   }
}

function notesPage(s, o, ctx)
{
   var L = s.limits;
   var off = ctx.busy || ctx.readOnly;
   var folders = listOf(s.folders);
   flowButtons([["Back to the list", function() { dboSound("UIMenuCancel"); notesList = true; pages[tab] = 0; draw(); }]]);
   flowHeading(o.title);
   flowHint(o.kind == "entry" ? (o.folder != undefined && o.folder != "" ? notesFolderName(folders, o.folder) + "  -  " : "") + "Written " + notesDate(o.at) + (o.edited ? ", changed " + notesDate(o.edited) : "") : o.itemKind + "  -  " + o.author);
   flowText(o.text, 18, C_TEXT);
   if (o.kind == "entry")
   {
      flowButtons([["Edit...", function() { ctx.browser({entry: o.id}); }, undefined, off], ["Tear out", function()
      {
         ctx.ask("Tear out " + o.title + "?", "Tear it out", function() { ctx.act("dbo:journalNotes", ["delete", o.id]); notesList = true; }, true);
      }, C_RED, off]]);
      var w = s.write;
      if (w != undefined && w != null && w.on == true)
      {
         flowText("Write it out", 19, C_TEXT);
         flowHint(w.atDesk == true ? "A copy on paper to give or trade; its holder can read it and keep it in their journal. You carry " + w.paper + " paper."
            : "Sit at a writing desk or stand at a Scholars' Ledger, then open your journal to write this out on paper.");
         var kinds = listOf(w.kinds);
         var row = [[notesSigned ? "Signed with your name" : "Unsigned", function() { notesSigned = !notesSigned; draw(); }, undefined, false, notesSigned]];
         for (var k = 0; k < kinds.length; k++)
         {
            row.push([kinds[k].label + " (" + kinds[k].paper + " paper)", function() { ctx.act("dbo:journalNotes", ["write", o.id, this.kind, notesSigned ? "1" : ""]); }, undefined, off || w.atDesk != true || !kinds[k].free || w.paper < kinds[k].paper]);
         }
         var bar = flowButtons(row);
         for (var j = 0; j < kinds.length; j++)
         {
            bar["btn" + (j + 1)].kind = kinds[j].id;
         }
      }
   }
   else if (o.kind == "work")
   {
      if (o.kept == true)
      {
         flowHint("A copy is in your journal, under Received.");
      }
      else
      {
         flowButtons([["Keep a copy in my journal", function() { ctx.act("dbo:journalNotes", ["keep", o.id]); }, undefined, off || listOf(s.received).length >= L.receivedMax]]);
      }
   }
   else if (o.kind == "received")
   {
      flowButtons([["Remove from my journal", function()
      {
         ctx.ask("Remove " + o.title + " from your journal?", "Remove it", function() { ctx.act("dbo:journalNotes", ["forget", o.id]); notesList = true; }, true);
      }, C_RED, off]]);
   }
}

JT.notes = function(s, ctx)
{
   if (s.ready != true)
   {
      flowText("Turning the page...", 20, C_SECOND);
      return;
   }
   if (notesOf != cacheOf)
   {
      notesOf = cacheOf;
      notesFilter = "all";
      notesList = true;
      notesOpenId = "";
   }
   var o = s.open != undefined && s.open != null ? s.open : null;
   var key = o != null ? o.kind + ":" + o.id : "";
   if (key != notesOpenId)
   {
      notesOpenId = key;
      notesList = o == null;
   }
   if (o != null && !notesList)
   {
      notesPage(s, o, ctx);
   }
   else
   {
      notesListView(s, ctx);
   }
};
