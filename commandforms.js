// DragonBreak Online: a chat command's usage, read from its help text, as a form the player panel (U, widget 52) can draw.
// Loaded by gamemode.js on every hot reload; import-free so tests/command-forms-harness.js can drive it.
//
// A help text starts with its usage and then says what the command does, as /help prints it:
//   '<player|#TAG> <zone> <rank> [override] make someone an official'   '[werewolf|vampirelord|revert] take or leave ...'
//   'invite|accept|decline|leave|kick: group up for dungeons'            'post <gold> <work> | take | done: work held ...'
// formOf(help) returns { usage, desc, variants } or null when the text has no usage. Each variant is what one of the
// usage's " | " alternatives asks for: word (the literal first word, or null) and args. An arg is
//   { label, kind: 'player' | 'number' | 'enum' | 'text', options (enum), optional, rest (takes the rest of the line) }.
// The panel sends "/<command> <word> <args...>" through the chat handler, so a form that reads a usage wrongly can only
// produce a command the player could have typed.
'use strict';

const PLAYER = /^(player|name|#tag|profile id|someone|me|target)$/i;
const NUMBER = /^(n|gold|amount|minutes|seconds|hours?|game hours|page|count|days|\d+-\d+|level|rank number|price)$/i;
const LITERAL = /^[a-z][a-z0-9-]*$/;

// Split on a separator outside <...> and [...]
const splitTop = (s, sep) => {
  const out = []; let depth = 0, cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '<' || ch === '[') depth++;
    else if ((ch === '>' || ch === ']') && depth > 0) depth--;
    if (depth === 0 && s.startsWith(sep, i)) { out.push(cur); cur = ''; i += sep.length - 1; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter((x) => x.length);
};

// Tokens: <...> and [...] whole (nested brackets kept), bare words otherwise
const tokens = (s) => {
  const out = []; let i = 0;
  while (i < s.length) {
    if (s[i] === ' ') { i++; continue; }
    if (s[i] === '<' || s[i] === '[') {
      let depth = 0, j = i;
      for (; j < s.length; j++) { if (s[j] === '<' || s[j] === '[') depth++; else if (s[j] === '>' || s[j] === ']') { depth--; if (depth === 0) break; } }
      out.push(s.slice(i, j + 1)); i = j + 1; continue;
    }
    let j = i; while (j < s.length && s[j] !== ' ') j++;
    out.push(s.slice(i, j)); i = j;
  }
  return out;
};

const isSyntaxToken = (t) => /^[<[]/.test(t) || /^[a-z0-9-]+(\|[a-z0-9-]+)+$/i.test(t);

// Where the usage ends and the description begins: an explicit ": " after a usage-looking start, or the first word that
// is neither a bracket, an "a|b" choice, a "|" nor a literal followed by syntax
const splitHelp = (help) => {
  const h = String(help || '').trim();
  const colon = h.indexOf(': ');
  if (colon > 0) {
    const head = h.slice(0, colon);
    if (/[<[|]/.test(head) && !/[.;]/.test(head)) return [head.trim(), h.slice(colon + 2).trim()];
    if (/^[a-z0-9-]+(\|[a-z0-9-]+)*$/i.test(head)) return [head.trim(), h.slice(colon + 2).trim()];
  }
  const ts = tokens(h);
  let n = 0;
  for (; n < ts.length; n++) {
    const t = ts[n];
    if (isSyntaxToken(t) || t === '|') continue;
    // a literal word belongs to the usage only when syntax follows it ("post <gold>", "list <court|faction>")
    if (LITERAL.test(t) && n + 1 < ts.length && (isSyntaxToken(ts[n + 1]) || ts[n + 1] === '|')) continue;
    break;
  }
  if (n === 0) return ['', h];
  // the usage's tokens, re-joined; the rest is what it does
  let at = 0;
  for (let k = 0; k < n; k++) at = h.indexOf(ts[k], at) + ts[k].length;
  return [h.slice(0, at).trim(), h.slice(at).replace(/^[\s:,-]+/, '').trim()];
};

const argOf = (tok, optional) => {
  const inner = tok.replace(/^[<[]|[>\]]$/g, '').trim();
  const opts = inner.split('|').map((x) => x.trim()).filter(Boolean);
  // the label a box shows: a name for a name, "choose one" for a list of words, the placeholder's own words otherwise
  if (opts.some((o) => PLAYER.test(o))) return { label: opts.some((o) => /^(player|someone|target)$/i.test(o)) ? 'player' : opts[0], kind: 'player', optional };
  if (opts.length > 1 && opts.every((o) => LITERAL.test(o))) return { label: 'choose one', kind: 'enum', options: opts, optional };
  if (opts.length === 1 && NUMBER.test(opts[0])) return { label: inner, kind: 'number', optional };
  return { label: inner, kind: 'text', optional };
};

const variantOf = (alt) => {
  const ts = tokens(alt);
  if (!ts.length) return null;
  let word = null; let rest = ts;
  if (LITERAL.test(ts[0])) { word = ts[0]; rest = ts.slice(1); }
  const args = [];
  for (const t of rest) {
    if (t === '|' || t === '...') continue;
    if (t.startsWith('<')) args.push(argOf(t, false));
    else if (t.startsWith('[')) {
      // an optional group of several parts ("[clear <player>]") is offered as one optional box
      const inner = t.slice(1, -1).trim();
      args.push(/[<>[\]]/.test(inner) ? { label: inner, kind: 'text', optional: true } : argOf(t, true));
    } else if (/\|/.test(t)) args.push({ label: 'choose one', kind: 'enum', options: t.split('|'), optional: false });
    else if (LITERAL.test(t)) args.push({ label: t, kind: 'enum', options: [t], optional: false });
  }
  // the last free-text box takes the rest of the line (a message, a reason)
  const last = args[args.length - 1];
  if (last && last.kind === 'text') last.rest = true;
  return { word, args };
};

const formOf = (help) => {
  const [usage, desc] = splitHelp(help);
  if (!usage) return null;
  let body = usage, optionalAll = false;
  // a whole usage in brackets with alternatives inside ("[on|off|clear <player>]", "[all | clear | clear all]"): the
  // alternatives are the choices, and running it bare is one of them when the brackets are square
  const whole = tokens(usage);
  if (whole.length === 1 && /^[[<]/.test(whole[0]) && /\|/.test(whole[0]) && /[ <[]/.test(whole[0].slice(1, -1))) {
    optionalAll = whole[0].startsWith('[');
    body = whole[0].slice(1, -1).trim();
  }
  let alts = splitTop(body, ' | ');
  if (alts.length === 1 && optionalAll) alts = splitTop(body, '|');
  // "teach|forget <name> <family>, list [name], test": commas between alternatives that each start with a word
  if (alts.length === 1 && /, /.test(alts[0])) {
    const parts = splitTop(alts[0], ', ');
    if (parts.length > 1 && parts.every((x) => /^[a-z][a-z0-9-]*(\|[a-z0-9-]+)*( |$)/i.test(x))) alts = parts;
  }
  // "teach|forget <name> <family>": a choice of first words that share the same arguments
  alts = alts.flatMap((alt) => {
    const m = alt.match(/^([a-z][a-z0-9-]*(?:\|[a-z][a-z0-9-]*)+)( .*)?$/i);
    return m && m[2] ? m[1].split('|').map((w) => w + m[2]) : [alt];
  });
  // "invite|accept|decline" as the whole usage: one choice per word
  if (alts.length === 1 && /^[a-z0-9-]+(\|[a-z0-9-]+)+$/i.test(alts[0])) alts = alts[0].split('|');
  // a usage that is one enum in brackets ("[werewolf|vampirelord|revert]") is a choice of words too, with "none" allowed
  const single = alts.length === 1 ? tokens(alts[0]) : null;
  if (single && single.length === 1 && /^[[<][a-z0-9-]+(\|[a-z0-9-]+)+[\]>]$/i.test(single[0])) {
    const optional = single[0].startsWith('[');
    const words = single[0].slice(1, -1).split('|');
    const variants = words.map((w) => ({ word: w, args: [] }));
    if (optional) variants.unshift({ word: null, args: [] });
    return { usage, desc, variants };
  }
  const variants = alts.map(variantOf).filter(Boolean);
  if (optionalAll && !variants.some((v) => !v.word && !v.args.length)) variants.unshift({ word: null, args: [] });
  if (!variants.length || variants.every((v) => !v.word && !v.args.length)) return null;
  return { usage, desc, variants };
};

module.exports = { formOf, splitHelp, tokens };
