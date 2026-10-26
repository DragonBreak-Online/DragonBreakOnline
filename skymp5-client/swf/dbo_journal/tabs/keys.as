// Keys (keyring.js ringView): an offer, your keys by property with Give, your own locks with Cut a key, Cut for... and every
// copy out with Take back. Give and Cut for... list the players beside you to pick from. Actions are dbo:keyRing* with the nonce
var keysPick = "";
var keysLast = null;

function keysPickList(near, ctx, send)
{
   if (!near.length)
   {
      flowHint("Nobody stands beside you.");
   }
   var row = [];
   for (var i = 0; i < near.length; i++)
   {
      row.push([near[i].name, function() { keysPick = ""; send(this.actor); }, undefined, ctx.busy]);
   }
   row.push(["Cancel", function() { dboSound("UIMenuCancel"); keysPick = ""; draw(); }]);
   var c = flowButtons(row);
   for (var j = 0; j < near.length; j++)
   {
      c["btn" + j].actor = near[j].actor;
   }
}

JT.keys = function(s, ctx)
{
   if (s != keysLast)
   {
      keysPick = "";
      keysLast = s;
   }
   var near = listOf(s.near);
   flowHeading("Key Ring");
   if (s.offer != null && s.offer != undefined)
   {
      flowEntry(s.offer.from + " offers you " + s.offer.key + ".", [["Accept", function() { ctx.act("dbo:keyRingAnswer", [true]); }, undefined, ctx.busy], ["Decline", function() { ctx.act("dbo:keyRingAnswer", [false]); }, undefined, ctx.busy]]);
   }
   flowText("Your keys", 20, C_TEXT);
   var keys = listOf(s.keys);
   if (!keys.length)
   {
      flowHint("No keys. The owner of a property can cut one for you.");
   }
   var places = [];
   var byPlace = {};
   for (var i = 0; i < keys.length; i++)
   {
      var place = keys[i].place != undefined && keys[i].place != "" ? keys[i].place : "Other keys";
      if (byPlace[place] == undefined)
      {
         byPlace[place] = [];
         places.push(place);
      }
      byPlace[place].push(keys[i]);
   }
   for (var p = 0; p < places.length; p++)
   {
      flowText(places[p], 17, C_SECOND, 8);
      var list = byPlace[places[p]];
      for (var k = 0; k < list.length; k++)
      {
         var key = list[k];
         var e = flowEntry("    " + key.name + "   " + (key.opens == true ? "Opens" : "Opens nothing"), [["Give", function()
         {
            var want = "give:" + this._parent.keyName;
            keysPick = keysPick == want ? "" : want;
            draw();
         }, undefined, ctx.busy]]);
         e.keyName = key.name;
         if (keysPick == "give:" + key.name)
         {
            var nm = key.name;
            keysPickList(near, ctx, function(actor) { ctx.act("dbo:keyRingGive", [nm, actor]); });
         }
      }
   }
   var owned = listOf(s.owned);
   if (owned.length)
   {
      flowGap(8);
      flowText("Your properties", 20, C_TEXT);
   }
   for (var o = 0; o < owned.length; o++)
   {
      var lock = owned[o];
      var row = flowEntry(lock.place, [["Cut a key", function() { ctx.act("dbo:keyRingCut", [this._parent.ref, 0]); }, undefined, ctx.busy], ["Cut for...", function()
      {
         var want = "cut:" + this._parent.ref;
         keysPick = keysPick == want ? "" : want;
         draw();
      }, undefined, ctx.busy]]);
      row.ref = lock.ref;
      if (keysPick == "cut:" + lock.ref)
      {
         var ref = lock.ref;
         keysPickList(near, ctx, function(actor) { ctx.act("dbo:keyRingCut", [ref, actor]); });
      }
      var copies = listOf(lock.copies);
      if (!copies.length)
      {
         flowHint("No keys are out.");
      }
      for (var c = 0; c < copies.length; c++)
      {
         var cp = flowEntry("    " + copies[c].name, [["Take back", function() { ctx.act("dbo:keyRingTake", [this._parent.ref, this._parent.keyName]); }, undefined, ctx.busy]], copies[c].holder != undefined && copies[c].holder != "" ? "Held by " + copies[c].holder : "Holder unknown");
         cp.ref = lock.ref;
         cp.keyName = copies[c].name;
      }
   }
   flowHint("A key opens its door even when it is locked. Taking a key back stops it opening at once, wherever it is.");
};
