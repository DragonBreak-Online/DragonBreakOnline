#!/usr/bin/env bash
# The front and client harnesses, measured on Windows from a CLIENT LINE.
#
# WHY THIS EXISTS. 40 harnesses in tests/run-all.sh take a bundle of fork front or client code. Neither box
# can measure them through run-all:
#   - on Windows run-all's own ts/src snapshot copy does not come good, and the bundles fail with
#     'Could not resolve <snapshot>/skymp5-front/src/features/<x>/index.tsx' - the entry missing from the
#     snapshot, though it is present in the fork. (The older note blaming 'Could not resolve "react"' was
#     wrong: a full run produced zero react errors.)
#   - on dbo-dev there is no skymp5-client/node_modules or skymp5-front/node_modules at all; that box builds
#     only the server natively, so react-dom/server cannot resolve and the bundles fail there too.
# Measured 1 Nov 2026: 12 of them fail on BOTH platforms for this reason alone, so they were unmeasured
# rather than failing. Bundling the same entry straight from the real tree works, so this does that.
#
# AND IT MUST BE A CLIENT LINE, not fork main. run-all's own usage says so
# (FORK=<client line> FORK_SERVER=<fork main>) and it is easy to miss: bundled from main,
# admin-panel-front reports "skipped: this front predates the admin panel revamp" and measures nothing;
# bundled from client-rc-1031 it runs and reports real results. A front number taken against main is void,
# so --client-line is required rather than defaulted.
#
#   bash tools/baseline/front-runner.sh --client-line <dir> [--fork <dir>] [--only a,b,c]
#
# The harness->entry map is READ FROM tests/run-all.sh, never copied here. A second copy of that map would
# drift the first time somebody adds a widget, and this branch exists largely because of assertions that
# rotted the same way.
set -uo pipefail

CLIENT_LINE=""
FORK_ARG=""
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --client-line) CLIENT_LINE=${2:-}; shift ;;
    --fork) FORK_ARG=${2:-}; shift ;;
    --only) ONLY=${2:-}; shift ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

REPO=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "run this from inside the server repo" >&2; exit 2; }
cd "$REPO" || exit 2
RUNALL=tests/run-all.sh
[ -f "$RUNALL" ] || { echo "no $RUNALL to read the harness->entry map from" >&2; exit 2; }

[ -n "$CLIENT_LINE" ] || { echo "--client-line is required: a front number taken against fork main measures nothing (see the header)" >&2; exit 2; }
[ -d "$CLIENT_LINE" ] || { echo "no client line at $CLIENT_LINE" >&2; exit 2; }

# esbuild and the front's node_modules come from a real clone; a worktree's node_modules is a symlink to it.
COMMON=$(git rev-parse --git-common-dir 2>/dev/null)
case "$COMMON" in /*|[A-Za-z]:*) ;; *) COMMON="$REPO/$COMMON" ;; esac
MAIN_REPO=$(cd "$(dirname "$COMMON")" 2>/dev/null && pwd)
FORK=${FORK_ARG:-$(cd "$MAIN_REPO/.." 2>/dev/null && pwd)/fork}

ESBUILD="$FORK/skymp5-server/node_modules/.bin/esbuild"
MODS="$FORK/skymp5-front/node_modules"
[ -x "$ESBUILD" ] || { echo "no esbuild at $ESBUILD - pass --fork" >&2; exit 2; }
# Refuse rather than report: without these every bundle fails and a total would be meaningless.
[ -d "$MODS/react" ] || { echo "no react under $MODS - this is the exact condition that makes these harnesses unmeasurable; refusing" >&2; exit 2; }
[ -f "$MODS/react-dom/server.js" ] || { echo "no react-dom/server under $MODS; refusing" >&2; exit 2; }

OUT=${TMPDIR:-/tmp}/dbo-front-runner
mkdir -p "$OUT" || exit 2
case "$(cd "$OUT" && pwd -P)" in
  "$(cd "$REPO" && pwd -P)"*) echo "refusing: $OUT is inside the repo" >&2; exit 2 ;;
esac

head_of() { git -C "$1" log --oneline -1 2>/dev/null || echo "(not a git tree)"; }
echo "=========== front/client inputs ==========="
echo " client line  $CLIENT_LINE"
echo " its HEAD     $(head_of "$CLIENT_LINE" | cut -c1-88)"
echo " fork         $FORK"
echo " fork HEAD    $(head_of "$FORK" | cut -c1-88)"
echo " node_modules $MODS"
echo " esbuild      $ESBUILD"
echo " map from     $RUNALL"
echo "==========================================="
echo

# Read the map out of run-all.sh. Only the declare -A NEEDS=( ... ) block, and only front:/client: rows.
END=$(awk '/^declare -A NEEDS=\(/{f=NR} f && NR>f && /^\)/{print NR; exit}' "$RUNALL")
START=$(awk '/^declare -A NEEDS=\(/{print NR; exit}' "$RUNALL")
[ -n "$START" ] && [ -n "$END" ] || { echo "could not find the NEEDS block in $RUNALL" >&2; exit 1; }

# Some of these harnesses do not only consume the bundle - they ALSO read fork sources directly, through
# $FORK / $FORK_SERVER, which is why run-all exports both. Unset, they fall back to `$(cd .. && pwd)/fork`,
# which from a scratchpad worktree does not exist, and the harness fails while quoting a path under
# <scratchpad>/fork/... That is the same default-fork trap that made baseline.sh skip half the suite and still
# print a total, and it cost two bogus failures here - supernatural-tab and shrine-panel-widget - which only
# gave themselves away because the paths were in the output. Client code comes from the client line, server
# code from the fork. Exported AFTER the provenance block above, which reports $FORK as the real fork.
FORK_MAIN="$FORK"
export FORK="$CLIENT_LINE"
export FORK_SERVER="$FORK_MAIN"

pass=0; fail=0; skip=0; unbuilt=0
FAILED=""
while IFS= read -r line; do
  case "$line" in *']='front:*|*']='client:*) ;; *) continue ;; esac
  name=${line#*[}; name=${name%%]*}
  val=${line#*]=}; val=${val%% *}
  side=${val%%:*}; entry=${val#*:}

  if [ -n "$ONLY" ]; then case ",$ONLY," in *",$name,"*) ;; *) continue ;; esac; fi

  harness="tests/$name-harness.js"
  [ -f "$harness" ] || { echo "SKIP $name -- no $harness"; skip=$((skip + 1)); continue; }

  src="$CLIENT_LINE/$entry"
  if [ ! -f "$src" ]; then
    # A line that does not carry this widget yet. run-all calls this "lacks" and does not fail it.
    echo "SKIP $name -- the client line has no $entry"
    skip=$((skip + 1)); continue
  fi

  if [ "$side" = front ]; then
    base=$(basename "$(dirname "$entry")")
    wrap="$OUT/front-$base-entry.tsx"
    bundle="$OUT/front-$base.js"
    # Named exports too, so a harness can render a part only a click would reach (as run-all does).
    printf "export * from '%s';\nexport { default as Widget } from '%s';\nexport { renderToStaticMarkup } from 'react-dom/server';\nexport { createElement } from 'react';\n" "$src" "$src" > "$wrap"
    if ! NODE_PATH="$MODS" "$ESBUILD" "$wrap" --bundle --platform=node --format=cjs \
        --loader:.js=jsx --loader:.scss=empty --loader:.png=empty --loader:.jpg=empty \
        --loader:.gif=empty --loader:.svg=empty --outfile="$bundle" --log-level=error 2>"$OUT/$name.err"; then
      echo "UNBUILT $name -- bundle failed: $(head -n 2 "$OUT/$name.err" | tr '\n' ' ' | cut -c1-110)"
      unbuilt=$((unbuilt + 1)); continue
    fi
  else
    bundle="$OUT/client-$(basename "${entry%.ts}").js"
    if ! ( cd "$CLIENT_LINE" && "$ESBUILD" "$entry" --bundle --platform=node --format=cjs \
        --outfile="$bundle" --log-level=error ) 2>"$OUT/$name.err"; then
      echo "UNBUILT $name -- bundle failed: $(head -n 2 "$OUT/$name.err" | tr '\n' ' ' | cut -c1-110)"
      unbuilt=$((unbuilt + 1)); continue
    fi
  fi

  out=$(timeout 180 node "$harness" "$bundle" 2>&1)
  if [ $? -eq 0 ]; then
    # A harness that ran but decided it had nothing to test says so; that is a skip, not a pass.
    if printf '%s' "$out" | grep -qiE '^ok +skipped:|skipped:'; then
      echo "SKIP $name -- $(printf '%s' "$out" | grep -ioE 'skipped:[^"]*' | head -n 1 | cut -c1-80)"
      skip=$((skip + 1))
    else
      pass=$((pass + 1))
    fi
  else
    fail=$((fail + 1)); FAILED="$FAILED $name"
    echo "FAIL $name"
    printf '%s' "$out" | grep -E '^ *FAIL' | head -n 4 | sed 's/^/     /'
  fi
done < <(sed -n "$((START + 1)),$((END - 1))p" "$RUNALL")

echo
echo "RESULT pass=$pass fail=$fail skip=$skip unbuilt=$unbuilt"
[ -n "$FAILED" ] && echo "FAILING:$FAILED"
[ "$unbuilt" -gt 0 ] && echo "NOTE: an unbuilt bundle is not a code failure - it is this runner or the tree, and must be fixed before the number is quoted."
exit 0
