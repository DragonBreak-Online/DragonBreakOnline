#!/usr/bin/env bash
# Prove the remote snapshot command PARSES and BEHAVES before it is sent to the production box again.
# The first version failed on the server because $FILES is written over several lines, so the remote shell
# saw `for f in` followed by a newline. A visual preview of the command looked fine to me, which is exactly
# why this script runs `sh -n` on it and then executes it against a fake directory.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
dir="/opt/alduinak/build/dist/server"

# Same list and same construction as baseline.sh.
FILES="
bank.json contracts.json dungeon-cooldowns.json economy.json gearstrip-state.json guilds.json
housing-storage-locked.json item-snapshots.json name-table.json officials.json playtester-boost.json
playtime-slots.json server-stats.json staff-actions.json terrain-heights.json
update-log.json worldclock.json zone-spawns.json
"
oneline=$(echo $FILES)
mk() { echo 'cd '"$(printf '%q' "$1")"' || exit 1; for f in '"$oneline"'; do [ -f "$f" ] && printf "%s\n" "$f"; done | tar -cf - -T - 2>/dev/null'; }

echo "=== 1. does the command as sent to the server PARSE? ==="
if printf '%s' "$(mk "$dir")" | sh -n; then echo "  parses ok"; else echo "  SYNTAX ERROR - do not send it"; exit 1; fi

echo
echo "=== 2. does it behave? three files present, fifteen absent ==="
T="$HERE/_remotecmd-test"
rm -rf "$T"; mkdir -p "$T/src" "$T/dest"
: > "$T/src/bank.json"
echo '{"a":1}' > "$T/src/worldclock.json"
: > "$T/src/officials.json"

sh -c "$(mk "$T/src")" | tar -xf - -C "$T/dest" 2>/dev/null
got=$(ls -1 "$T/dest" 2>/dev/null | wc -l)
echo "  extracted: $(ls -1 "$T/dest" 2>/dev/null | tr '\n' ' ')"
echo "  count: $got (want 3 - the fifteen absent ones must not fail the archive)"
[ "$got" -eq 3 ] || { echo "  WRONG"; rm -rf "$T"; exit 1; }

echo
echo "=== 3. a directory with none of them: the archive is empty, and the script must refuse ==="
rm -rf "$T/empty" "$T/dest2"; mkdir -p "$T/empty" "$T/dest2"
sh -c "$(mk "$T/empty")" | tar -xf - -C "$T/dest2" 2>/dev/null
echo "  extracted: $(ls -1 "$T/dest2" 2>/dev/null | wc -l) (want 0, so the 'copied nothing' guard fires)"

rm -rf "$T"
echo
echo "both checks pass - safe to send"
