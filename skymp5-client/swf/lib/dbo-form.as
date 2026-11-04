// Typed input for a native panel: a form drawn in the panel's flow (lib/dbo-flow.as) in place of what it shows, its fields
// typed in boxes on their own rows (dboInput), one box at a time. The journal, the pigeon coop and the writing box use it.
// A panel sets formHost's hooks, calls form(build, vals) to open one, formBegin() before it redraws its flow, drawForm()
// inside the flow while forming != null, formEnd() after, and formKey(code) first in its key handler.
//
// build(vals) returns {title, hint, fields, buttons}, where a field is {key, label, kind: "text" | "number" | "choice" |
// "multi" | "note" | "buttons", max, hint, lines, count, restrict, options: [[value, label], ...], empty, text, items} and a
// button [label, onSubmit(vals), ready, danger]; vals are what the player typed and chose, by key. A text field with lines
// is a page of that many lines (Enter is a new line, Done takes it); count shows "n / max" in its label as it is typed.
// A "multi" field keeps an array of the values picked (at most max); a "buttons" field's items [label, fn(vals), disabled,
// danger] change vals in place and redraw (a draft's Up, Remove, Add) without closing the form. A button that is ready
// closes the form and runs; Cancel and Escape close it. A game that cannot type is offered the host's fallback instead.

// The panel's hooks: busy() and readOnly() grey the buttons, redraw() draws the panel again, fallback() hands the typing to
// the browser (null when there is none, fallbackText says what it is), onOpen() runs as a form opens
var formHost = {busy: function() { return false; }, readOnly: function() { return false; }, redraw: function() {}, fallback: null, fallbackText: "the browser", onOpen: function() {}};
// forming: the form open, {build, vals}; fbox the field whose box is open, fboxField its text field, fboxLines a page
var forming = null;
var fbox = "";
var fboxField = null;
var fboxLines = false;
var formTyped = null;

function form(build, vals)
{
   endFormTyping();
   dboSound("UIMenuOK");
   forming = {build: build, vals: vals != undefined ? vals : {}};
   formHost.onOpen();
   formHost.redraw();
}

function closeForm()
{
   endFormTyping();
   forming = null;
}

function endFormTyping()
{
   if (fbox != "")
   {
      dboInputEnd();
   }
   fbox = "";
   fboxField = null;
   fboxLines = false;
}

function takeFormTyped()
{
   var raw = fboxField != null ? String(fboxField.text) : "";
   // a page keeps its lines (the field's own breaks are \r); a one-line box has none
   var text = fboxLines ? raw.split("\r\n").join("\n").split("\r").join("\n") : raw.split("\r").join(" ").split("\n").join(" ");
   while (text.charAt(0) == " ")
   {
      text = text.substr(1);
   }
   while (text.charAt(text.length - 1) == " ")
   {
      text = text.substr(0, text.length - 1);
   }
   forming.vals[fbox] = text;
   endFormTyping();
   dboSound("UIMenuOK");
   formHost.redraw();
}

// Before a redraw: what is being typed carries over into the box the redraw makes
function formBegin()
{
   formTyped = fbox != "" && fboxField != null ? String(fboxField.text) : null;
   fboxField = null;
}

// After it: the typed text back in its box, and a box whose field is gone gives the keys back
function formEnd()
{
   if (formTyped != null && fboxField != null)
   {
      fboxField.text = formTyped;
      if (fboxField.onChanged != undefined)
      {
         fboxField.onChanged();
      }
   }
   formTyped = null;
   if (fbox != "" && fboxField == null)
   {
      endFormTyping();
   }
}

// First in the panel's key handler: true when the form took the key (typing, or Escape leaving the box or the form)
function formKey(code)
{
   if (fbox != "")
   {
      if (code == 27)
      {
         dboSound("UIMenuCancel");
         endFormTyping();
         formHost.redraw();
      }
      else if (code == 13 && !fboxLines)
      {
         takeFormTyped();
      }
      // every other key is typing while the box is open (Enter too, in a page of several lines)
      return true;
   }
   if (code == 27 && forming != null)
   {
      dboSound("UIMenuCancel");
      closeForm();
      formHost.redraw();
      return true;
   }
   return false;
}

function formLabel(f, value)
{
   return String(f.label) + (f.count == true && f.max != undefined ? "  (" + value.length + " / " + f.max + ")" : "");
}

// A page of several lines scrolls with the shared bar, in the field's own lines (scroll, bottomScroll, maxscroll)
function formScroll(c, field, x, y, h)
{
   if (typeof(scrollbar) != "function")
   {
      return;
   }
   var bar = scrollbar(c, "bar", 11, x, y, h, c);
   bar._visible = false;
   bar.field = field;
   bar.onScroll = function(o) { this.field.scroll = o + 1; };
   field.bar = bar;
   if (field.onChanged == undefined)
   {
      field.onChanged = function() { formScrollSync(this); };
   }
   field.onScroller = function() { formScrollSync(this); };
   formScrollSync(field);
}

function formScrollSync(field)
{
   if (field.bar == undefined || field.maxscroll == undefined)
   {
      return;
   }
   var shown = field.bottomScroll - field.scroll + 1;
   field.bar.set(field.maxscroll + shown - 1, shown, field.scroll - 1);
}

// A typed field's row: its label, the value or a box to type it in
function formField(f, vals)
{
   var lines = f.lines != undefined && f.lines > 1 ? f.lines : 1;
   var tall = lines > 1 ? lines * 24 + 12 : 32;
   var at = flowNeed(tall + 10);
   var c = at.clip.createEmptyMovieClip(at.name, fd());
   c._y = at.y;
   var value = vals[f.key] != undefined ? String(vals[f.key]) : "";
   var l = dboText(c, "label", 1, 0, 8, 300, 26, dboFmt(F_MEDIUM, 16, C_SECOND, 0.5), false);
   l.text = formLabel(f, value);
   var boxW = BODY_W - 310 - 108 - (lines > 1 ? SCROLL_W + 8 : 0);
   if (fbox == f.key)
   {
      fboxField = dboInput(c, "box", 2, 310, 4, boxW, tall, dboFmt(F_PLAIN, 18, C_TEXT, 0.5), f.max != undefined ? f.max : 40, lines > 1);
      fboxLines = lines > 1;
      if (f.kind == "number")
      {
         fboxField.restrict = "0-9";
      }
      else if (f.restrict != undefined)
      {
         fboxField.restrict = f.restrict;
      }
      fboxField.text = value;
      if (f.count == true)
      {
         fboxField.countLabel = l;
         fboxField.countField = f;
         fboxField.onChanged = function()
         {
            this.countLabel.text = formLabel(this.countField, String(this.text));
            formScrollSync(this);
         };
      }
      if (lines > 1)
      {
         formScroll(c, fboxField, 310 + boxW + 6, 4, tall);
      }
      button(c, "done", 10, BODY_W - 100, 6, 92, "Done", F_MEDIUM, 17, A_BUTTON_REST, function() { takeFormTyped(); });
      return;
   }
   var v = dboText(c, "value", 2, 310, 8, boxW, lines > 1 ? tall : 26, dboFmt(F_MEDIUM, 17, value != "" ? C_TEXT : C_SECOND, 0.5), lines > 1);
   v.text = value != "" ? value : f.hint != undefined ? String(f.hint) : "";
   if (lines > 1)
   {
      formScroll(c, v, 310 + boxW + 6, 8, tall);
   }
   if (dboCanType())
   {
      var t = button(c, "type", 10, BODY_W - 100, 6, 92, "Type...", F_MEDIUM, 17, A_ROW_REST, function()
      {
         endFormTyping();
         fbox = this.key;
         dboSound("UIMenuOK");
         formHost.redraw();
      });
      t.key = String(f.key);
   }
}

function drawForm()
{
   var vals = forming.vals;
   var spec = forming.build(vals);
   flowHeading(String(spec.title));
   if (spec.hint != undefined && spec.hint != "")
   {
      flowHint(String(spec.hint));
   }
   var fields = listOf(spec.fields);
   var typed = false;
   for (var i = 0; i < fields.length; i++)
   {
      var f = fields[i];
      if (f.kind == "note")
      {
         flowHint(String(f.text));
      }
      else if (f.kind == "buttons")
      {
         var items = listOf(f.items);
         var ib = [];
         for (var m = 0; m < items.length; m++)
         {
            ib.push([String(items[m][0]), function() { this.fn(forming.vals); dboSound("UIMenuFocus"); formHost.redraw(); }, items[m][3] == true ? C_RED : undefined, items[m][2] == true]);
         }
         if (ib.length)
         {
            var ir = flowButtons(ib);
            for (var w = 0; w < items.length; w++)
            {
               ir["btn" + w].fn = items[w][1];
            }
         }
      }
      else if (f.kind == "multi")
      {
         flowText(String(f.label), 16, C_SECOND);
         var mo = listOf(f.options);
         if (!mo.length)
         {
            flowHint(f.empty != undefined ? String(f.empty) : "Nothing to choose from.");
            continue;
         }
         var picked = listOf(vals[f.key]);
         var mc = [];
         for (var x = 0; x < mo.length; x++)
         {
            var on = formHas(picked, mo[x][0]);
            mc.push([String(mo[x][1]), function()
            {
               var cur = listOf(forming.vals[this.key]).slice();
               var at = -1;
               for (var y = 0; y < cur.length; y++)
               {
                  if (String(cur[y]) == String(this.v))
                  {
                     at = y;
                  }
               }
               if (at >= 0)
               {
                  cur.splice(at, 1);
               }
               else
               {
                  cur.push(this.v);
               }
               forming.vals[this.key] = cur;
               dboSound("UIMenuFocus");
               formHost.redraw();
            }, undefined, !on && f.max != undefined && picked.length >= f.max, on]);
         }
         var mr = flowButtons(mc);
         for (var z = 0; z < mo.length; z++)
         {
            mr["btn" + z].key = String(f.key);
            mr["btn" + z].v = mo[z][0];
         }
      }
      else if (f.kind == "choice")
      {
         flowText(String(f.label), 16, C_SECOND);
         var opts = listOf(f.options);
         if (!opts.length)
         {
            flowHint(f.empty != undefined ? String(f.empty) : "Nothing to choose from.");
            continue;
         }
         var chips = [];
         for (var k = 0; k < opts.length; k++)
         {
            chips.push([String(opts[k][1]), function() { forming.vals[this.key] = this.v; dboSound("UIMenuFocus"); formHost.redraw(); }, undefined, false, String(vals[f.key]) == String(opts[k][0])]);
         }
         var row = flowButtons(chips);
         for (var q = 0; q < opts.length; q++)
         {
            row["btn" + q].key = String(f.key);
            row["btn" + q].v = opts[q][0];
         }
      }
      else
      {
         typed = true;
         formField(f, vals);
      }
   }
   var noTyping = typed && !dboCanType();
   if (noTyping)
   {
      flowHint(formHost.fallback != null ? "This game cannot take typed input in a panel: " + formHost.fallbackText + " has this form." : "This game cannot take typed input in a panel.");
   }
   flowGap(6);
   var bs = [];
   var list = listOf(spec.buttons);
   for (var j = 0; j < list.length; j++)
   {
      bs.push([String(list[j][0]), function()
      {
         var go = this.go;
         var v = forming.vals;
         closeForm();
         go(v);
         formHost.redraw();
      }, list[j][3] == true ? C_RED : undefined, formHost.busy() || formHost.readOnly() || list[j][2] != true]);
   }
   if (noTyping && formHost.fallback != null)
   {
      bs.push(["In the browser...", function() { closeForm(); formHost.fallback(); formHost.redraw(); }]);
   }
   bs.push(["Cancel", function() { dboSound("UIMenuCancel"); closeForm(); formHost.redraw(); }]);
   var bar = flowButtons(bs);
   for (var n = 0; n < list.length; n++)
   {
      bar["btn" + n].go = list[n][1];
   }
}

function formHas(list, v)
{
   for (var i = 0; i < list.length; i++)
   {
      if (String(list[i]) == String(v))
      {
         return true;
      }
   }
   return false;
}

// A whole number typed in a form, or -1 when it is not one
function formNumber(vals, key)
{
   var t = vals[key] != undefined ? String(vals[key]) : "";
   return t != "" && !isNaN(Number(t)) ? Math.floor(Number(t)) : -1;
}
