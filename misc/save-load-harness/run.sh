#!/bin/bash
# Builds the save-load harness against an existing server build (its compile flags and libraries, read only) and runs
# it for the code that build came from (origin/main when it is the live build) and for this tree at each interval.
# Usage: run.sh <out dir> [seconds per run] [intervals...]   env BUILD_DIR, default /opt/alduinak/build
# Run it under a memory cap, e.g. systemd-run --scope -q -p MemoryMax=4G nice -n 19 run.sh ...
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=$(cd "$HERE/../.." && pwd)
BUILD=${BUILD_DIR:-/opt/alduinak/build}
ORIG_SRC=$(dirname "$BUILD")
OUT=$1
SECS=${2:-30}
shift $(( $# > 2 ? 2 : $# ))
INTERVALS=${*:-0 5000}
CXX=/usr/bin/clang++-15
mkdir -p "$OUT/obj/branch" "$OUT/obj/legacy" "$OUT/bin"

# The build's compile command for <template>, with its sources moved to <root> and without debug info
flags() {
  python3 -I - "$BUILD" "$ORIG_SRC" "$2" "$1" <<'EOF'
import json, shlex, sys
build, orig, root, tmpl = sys.argv[1:5]
for e in json.load(open(build + '/compile_commands.json')):
    if e['file'] == orig + '/' + tmpl:
        args = shlex.split(e.get('command') or ' '.join(e['arguments']))
        break
else:
    sys.exit('no compile command for ' + tmpl)
out, skip = [], False
for a in args[1:]:
    if skip:
        skip = False
        continue
    if a in ('-o', '-c'):
        skip = True
        continue
    a = '-g0' if a == '-g' else a
    out.append(a.replace(build + '/', '\0').replace(orig + '/', root + '/').replace('\0', build + '/'))
print(' '.join(map(shlex.quote, out)))
EOF
}

compile() { # <template> <source root> <source file> <object> [extra flags...]
  local tmpl=$1 root=$2 src=$3 obj=$4
  shift 4
  if [ ! -f "$obj" ] || [ "$src" -nt "$obj" ]; then
    eval "$CXX $(flags "$tmpl" "$root") $* -c $src -o $obj"
  fi
}

LIB_TEMPLATE=skymp5-server/cpp/server_guest_lib/WorldState.cpp
LIBS="skymp5-server/cpp/libmp_common.a skymp5-server/cpp/libserver_guest_lib.a skymp5-server/cpp/liblocalization-provider.a
  skymp5-server/cpp/libmp_common.a skymp5-server/cpp/libmessages.a libespm/libespm.a papyrus-vm/libpapyrus-vm-lib.a
  viet/libviet.a skymp5-server/cpp/libgeo.a serialization/libserialization.a skymp5-server/libserver_standard_scripts.a"
VCPKG_LIBS="spdlog fmt simdjson slikenet antigo mongocxx-static bsoncxx-static mongoc2 ssl crypto utf8proc bson2 sodium
  bsa binary_io mmio DirectXTex DirectX-Headers lz4 zippp_static zip z bz2 spdlog fmt"
link() { # <output> <objects...>
  local out=$1
  shift
  local libs=""
  for l in $LIBS; do libs="$libs $BUILD/$l"; done
  for l in $VCPKG_LIBS; do libs="$libs $BUILD/vcpkg_installed/x64-linux/lib/lib$l.a"; done
  $CXX "$@" -Wl,--start-group $libs -Wl,--end-group \
    -Wl,--wrap=open,--wrap=fdatasync,--wrap=fsync,--wrap=sync_file_range -Wl,--strip-debug \
    -lpthread -ldl -lresolv -lrt -lm -o "$out"
}

$CXX -O2 -std=gnu++20 -c "$HERE/sync_counter.cpp" -o "$OUT/obj/sync_counter.o"

# The changed library files, linked ahead of the build's library so they replace its copies
BRANCH_OBJS=""
for f in WorldState.cpp database_drivers/FileDatabase.cpp database_drivers/DatabaseFactory.cpp; do
  o="$OUT/obj/branch/$(basename "$f" .cpp).o"
  compile "skymp5-server/cpp/server_guest_lib/$f" "$SRC" "$SRC/skymp5-server/cpp/server_guest_lib/$f" "$o"
  BRANCH_OBJS="$BRANCH_OBJS $o"
done
compile $LIB_TEMPLATE "$SRC" "$HERE/save_load_harness.cpp" "$OUT/obj/branch/harness.o" "-I$HERE"
compile $LIB_TEMPLATE "$ORIG_SRC" "$HERE/save_load_harness.cpp" "$OUT/obj/legacy/harness.o" "-I$HERE" -DHARNESS_LEGACY

link "$OUT/bin/harness-branch" "$OUT/obj/branch/harness.o" $BRANCH_OBJS "$OUT/obj/sync_counter.o"
link "$OUT/bin/harness-legacy" "$OUT/obj/legacy/harness.o" "$OUT/obj/sync_counter.o"

"$OUT/bin/harness-legacy" "$OUT/data-legacy" "$SECS"
rm -rf "$OUT/data-legacy"
for ms in $INTERVALS; do
  "$OUT/bin/harness-branch" "$OUT/data-$ms" "$SECS" "$ms"
  rm -rf "$OUT/data-$ms"
done
