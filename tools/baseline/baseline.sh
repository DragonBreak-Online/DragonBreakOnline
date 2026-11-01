#!/usr/bin/env bash
# One honest baseline number for the gameplay suite.
#
# THE PROBLEM THIS SOLVES. Until now no tree could run tests/run-all.sh and produce a number anyone should
# believe:
#   - the live `server\` checkout has the live runtime state the harnesses need, but on this PC it is ~1,300
#     commits behind origin/server, so it does not contain the newest harnesses;
#   - a worktree at origin/server has every harness, but NOT the ~24 runtime state files that live outside
#     git (bank.json, contracts.json, economy.json, worldclock.json, server-settings.json and friends).
# Run the suite in a worktree and a pile of harnesses fail for want of those files. On 2026-10-31 that cost a
# report of "90 failures" that were nothing of the kind: `durability` and `birthsigns` give 11 and 1 FAIL lines
# in a worktree and ZERO in the live checkout.
#
# WHAT IT DOES. Worktree at the real origin/server tip, overlay a cached snapshot of just those runtime files,
# run the suite, and print where every input came from so the number can be reproduced or disbelieved on
# purpose rather than by accident.
#
#   bash tools/baseline/baseline.sh [--refresh] [--max-age-hours N] [--source HOST:DIR]
#                                   [--fork DIR] [--fork-server DIR] [--keep]
#
#   --refresh          pull a fresh snapshot from the live server (otherwise the cache is used)
#   --max-age-hours    warn above this age (default 24)
#   --source           where a refresh reads from (default dragonbreak-dev:/opt/alduinak/build/dist/server)
#   --fork/--fork-server  passed through to run-all.sh; default the fork beside this repo
#   --keep             leave the worktree in place afterwards
#
# THE SNAPSHOT IS LIVE PLAYER DATA - bank balances, housing, staff actions - and this repo's remote is PUBLIC.
# So it is kept outside the repo and this script refuses to write it anywhere inside one.
set -uo pipefail

REFRESH=0
MAX_AGE_HOURS=24
SOURCE="dragonbreak-dev:/opt/alduinak/build/dist/server"
FORK_ARG=""
FORK_SERVER_ARG=""
KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --refresh) REFRESH=1 ;;
    --max-age-hours) MAX_AGE_HOURS=${2:-24}; shift ;;
    --source) SOURCE=${2:-$SOURCE}; shift ;;
    --fork) FORK_ARG=${2:-}; shift ;;
    --fork-server) FORK_SERVER_ARG=${2:-}; shift ;;
    --keep) KEEP=1 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

REPO=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "run this from inside the server repo" >&2; exit 2; }
cd "$REPO" || exit 2

# Everything we create lives outside the repo: the snapshot is live player data and the remote is public.
WORK=${DBO_BASELINE_DIR:-${TMPDIR:-/tmp}/dbo-baseline}
CACHE="$WORK/snapshot"
TREE="$WORK/tree"
mkdir -p "$CACHE" "$WORK" || exit 2
case "$(cd "$WORK" && pwd -P)" in
  "$(cd "$REPO" && pwd -P)"*) echo "refusing: $WORK is inside the repo, and the snapshot is live player data" >&2; exit 2 ;;
esac

# The runtime state files that live outside git. Determined by diffing the live root against a worktree root
# rather than guessed; absent ones are fine, because the live server has not always written them all.
#
# server-settings.json is deliberately NOT here. It holds secrets, it is gitignored, and pulling it onto this
# PC to run tests is a copy of it nobody asked for. Checked before removing it: no harness reads the live one.
# Four mention it - ash-pile-gate in a test name, trial-gm and trial-gm-roles in a source regex and a comment,
# and trade-open-hook writes its OWN scratch `{}` because Settings reads the file from the working directory.
# So the suite's result is identical without it.
FILES="
bank.json contracts.json dungeon-cooldowns.json economy.json gearstrip-state.json guilds.json
housing-storage-locked.json item-snapshots.json name-table.json officials.json playtester-boost.json
playtime-slots.json server-stats.json staff-actions.json terrain-heights.json
update-log.json worldclock.json zone-spawns.json
"

say() { echo "$*"; }

# --- 1. the tree, at the tip the REMOTE reports -------------------------------------------------------------
# ls-remote, never a tracking ref: this fork's refspec is main-only and origin/<branch> refs here go stale,
# which has produced wrong conclusions twice.
TIP=$(git ls-remote origin server 2>/dev/null | cut -f1)
[ -n "$TIP" ] || { echo "could not reach origin to resolve the server tip" >&2; exit 1; }
git fetch -q origin server || { echo "fetch failed" >&2; exit 1; }
if [ -d "$TREE/.git" ] || [ -f "$TREE/.git" ]; then
  git -C "$TREE" checkout -q --detach "$TIP" || { echo "could not move the worktree to $TIP" >&2; exit 1; }
else
  rm -rf "$TREE"
  git worktree add -q --detach "$TREE" "$TIP" || { echo "could not create the worktree" >&2; exit 1; }
fi

# --- 2. the snapshot ----------------------------------------------------------------------------------------
STAMP="$CACHE/.taken"
if [ "$REFRESH" = "1" ] || [ ! -f "$STAMP" ]; then
  say "snapshot: refreshing from $SOURCE"
  host=${SOURCE%%:*}
  dir=${SOURCE#*:}
  # ONE ssh round trip, not one per file. The source is the live production box: eighteen scp calls meant
  # eighteen connections and eighteen sshd auths for ~100 KB of JSON, which is rude to a server that also has
  # players on it. tar picks the files that exist remotely (a missing one must not fail the archive) and the
  # whole set comes back down a single stream.
  # $FILES is written over several lines for legibility, so it begins with a newline. Interpolated raw, the
  # remote shell sees `for f in` followed by a line break - a syntax error, and the snapshot comes back empty.
  # Unquoted $(echo ...) word-splits it and rejoins it on one line, which is what the remote needs.
  oneline=$(echo $FILES)
  remote='cd '"$(printf '%q' "$dir")"' || exit 1; for f in '"$oneline"'; do [ -f "$f" ] && printf "%s\n" "$f"; done | tar -cf - -T - 2>/dev/null'
  if ! ssh -o BatchMode=yes "$host" "$remote" | tar -xf - -C "$CACHE" 2>/dev/null; then
    echo "snapshot: the transfer from $SOURCE failed - refusing to report a baseline" >&2
    exit 1
  fi
  got=0
  for f in $FILES; do [ -f "$CACHE/$f" ] && got=$((got + 1)); done
  [ "$got" -gt 0 ] || { echo "snapshot: copied nothing from $SOURCE - refusing to report a baseline" >&2; exit 1; }
  date -u +%s > "$STAMP"
  say "snapshot: $got file(s) from $host in one transfer"
fi

TAKEN=$(cat "$STAMP" 2>/dev/null || echo 0)
NOW=$(date -u +%s)
AGE_H=$(( (NOW - TAKEN) / 3600 ))
STALE=""
if [ "$AGE_H" -ge "$MAX_AGE_HOURS" ]; then
  STALE=" *** STALE: older than ${MAX_AGE_HOURS}h - rerun with --refresh before trusting this ***"
fi

# --- 3. overlay (copies, not links: the harnesses write to some of these) -----------------------------------
overlaid=0
missing=""
for f in $FILES; do
  if [ -f "$CACHE/$f" ]; then
    cp -f "$CACHE/$f" "$TREE/$f" && overlaid=$((overlaid + 1))
  else
    missing="$missing $f"
  fi
done

# The overlay puts LIVE PLAYER DATA inside a git worktree, and .gitignore does not cover all of it. Measured
# on 1 Nov: all 16 overlaid files are untracked, 14 are gitignored, and 2 - housing-storage-locked.json and
# name-table.json - are neither, so `git add -A --dry-run` in that worktree offers to stage exactly those two.
# The remote is PUBLIC and this script deliberately KEEPS the worktree afterwards for inspection, so the
# exposure outlasts the run. Undo the overlay on any exit. (The durable fix is to add those two names to the
# repo's .gitignore, which is a shared file and somebody else's call; this cleanup does not depend on it.)
cleanup_overlay() {
  for f in $FILES; do
    [ -f "$TREE/$f" ] || continue
    if git -C "$TREE" cat-file -e "HEAD:$f" 2>/dev/null; then
      git -C "$TREE" checkout -q -- "$f" 2>/dev/null
    else
      # ${VAR:?} so an unset or empty TREE/f makes the shell stop with an error rather than running
      # `rm -f /`. The trap can fire from an interrupt at any point, including before TREE is assigned.
      rm -f "${TREE:?}/${f:?}"
    fi
  done
}
trap cleanup_overlay EXIT INT TERM

# --- 4. provenance, before the number, so the number is never quoted without it ----------------------------
# The fork sits beside the MAIN checkout, not beside the worktree. `cd ..` from here would be the scratchpad,
# where there is no fork at all: run-all.sh then finds no esbuild, skips every harness that needs a bundle,
# and still prints a total - a number that looks like a result and is not one. --git-common-dir resolves to
# the main repo's .git however deep the worktree is, so the fork is its grandparent's `fork`.
COMMON=$(git rev-parse --git-common-dir 2>/dev/null)
case "$COMMON" in /*|[A-Za-z]:*) ;; *) COMMON="$REPO/$COMMON" ;; esac
MAIN_REPO=$(cd "$(dirname "$COMMON")" 2>/dev/null && pwd)
FORK_DEFAULT=$(cd "$MAIN_REPO/.." 2>/dev/null && pwd)/fork
FORK=${FORK_ARG:-$FORK_DEFAULT}
if [ ! -d "$FORK" ]; then
  echo "the fork is not at $FORK - pass --fork <dir>; without it run-all.sh skips every harness that needs a bundle and still prints a total" >&2
  exit 2
fi
FORK_SERVER=${FORK_SERVER_ARG:-$FORK}
say ""
say "=============== baseline inputs ==============="
say " tree        $TIP  (origin/server, per ls-remote)"
say " snapshot    $(date -u -d "@$TAKEN" '+%Y-%m-%d %H:%M:%SZ' 2>/dev/null || echo "@$TAKEN"), ${AGE_H}h old, from $SOURCE$STALE"
say " overlaid    $overlaid file(s)${missing:+; absent on the source:$missing}"
say " fork        $FORK"
# The fork's HEAD belongs in the record: on a shared box it is a moving target (dbo-dev's /opt/alduinak is
# rebuilt between profile runs), so a number without it cannot be reproduced. run-all prints this too, but
# with 2>/dev/null - an unreadable .git there silently becomes "()" and the record is lost. /opt is
# root-owned, so try plain git, then a non-interactive sudo, then say outright that it is unknown.
fork_head() {
  git -C "$1" log --oneline -1 2>/dev/null && return 0
  sudo -n git -C "$1" log --oneline -1 2>/dev/null && return 0
  echo "*** UNREADABLE - record it by hand before quoting this run ***"
}
say " fork HEAD   $(fork_head "$FORK" | cut -c1-96)"
say " fork-server $FORK_SERVER"
[ "$FORK_SERVER" = "$FORK" ] || say " fs HEAD     $(fork_head "$FORK_SERVER" | cut -c1-96)"
# esbuild is what actually decides whether the bundle-taking harnesses run at all. Without it they SKIP and
# the suite still prints a cheerful total, so it is stated here next to the number rather than left implied.
ESB="$FORK_SERVER/skymp5-server/node_modules/.bin/esbuild"
[ -x "$ESB" ] || ESB="$FORK/skymp5-server/node_modules/.bin/esbuild"
if [ -x "$ESB" ]; then
  say " esbuild     $ESB"
else
  say " esbuild     *** MISSING - every harness needing a bundle will SKIP; the total below is not a baseline ***"
fi
say " platform    $(uname -s)"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    say ""
    say " PLATFORM NOTES for Windows, so the failures below are read correctly:"
    say "  - front widget harnesses fail at the bundling step (Could not resolve \"react\"): run-all snapshots"
    say "    the fork and symlinks node_modules into it, which does not come good here. ~25 harnesses."
    say "  - a POSIX file-mode assertion cannot pass: Windows reports 0666 where 0600 is expected."
    say "  - 8 harnesses shell out to \`python3\`, which on this PC is the Microsoft Store alias stub: it prints"
    say "    \"Python was not found\" and EXITS 0, so they fail with empty output rather than an obvious error."
    say "    Real Python here is \`py\` (3.14.6), which is what CLAUDE.md uses for the generators. Affected:"
    say "    alchemy-records-apply, ayleid-loot, buildings-map, door-names, faction-gear-generator,"
    say "    faction-gear-rerun, salvage-coverage, spell-tome-schools."
    say "  - the C++ unit binary is unrelated to this script, but must be run from build/, not build/unit/."
    ;;
  Linux)
    say ""
    say " PLATFORM NOTE: Linux is the reference platform. A number from here is the one to quote."
    ;;
esac
say "==============================================="
say ""

# --- 5. the suite -------------------------------------------------------------------------------------------
( cd "$TREE" && FORK="$FORK" FORK_SERVER="$FORK_SERVER" bash tests/run-all.sh )
rc=$?

say ""
say "baseline tree $TIP, snapshot ${AGE_H}h old$STALE"
[ "$KEEP" = "1" ] || say "(worktree kept at $TREE for inspection; remove with: git worktree remove --force \"$TREE\")"
exit $rc
