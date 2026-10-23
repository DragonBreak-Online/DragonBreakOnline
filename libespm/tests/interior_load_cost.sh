#!/bin/sh
# Builds and runs interior_load_cost.cpp against a tree's libespm and its WorldState.cpp chunk-load loop.
# usage: interior_load_cost.sh <tree root> <deps prefix with fmt, spdlog and zlib> <work dir> [files] [budget ms]
# The deps prefix is any include/ + lib/ holding fmt, spdlog and zlib (vcpkg's x64-linux installed tree will do).
set -e
tree=$(cd "$1" && pwd); deps=$2; work=$3; files=${4:-143}; budget=${5:-30}
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$work/obj" "$work/plugins"
rm -f "$work/plugins/"*

# The loop: from "auto& br = espm->GetBrowser();" in GetNeighborsByPosition to the end of its chunk loops
awk '/WorldState::GetNeighborsByPosition\(/ { inFn = 1 }
     inFn && /auto& br = espm->GetBrowser\(\);/ { on = 1 }
     inFn && /^  auto& neighbours =/ { exit }
     on { buf[n++] = $0 }
     END { for (i = 0; i < n - 2; i++) print buf[i] }' \
  "$tree/skymp5-server/cpp/server_guest_lib/WorldState.cpp" > "$work/chunk-load-loop.inc"
[ -s "$work/chunk-load-loop.inc" ] || { echo "no chunk-load loop found in $tree"; exit 2; }

flags="-std=c++20 -O2 -DSPDLOG_COMPILED_LIB -DSPDLOG_FMT_EXTERNAL -I$tree/libespm/include -I$tree/libespm/include/libespm -I$tree/libespm/src -I$tree/viet/include -I$deps/include"
for f in "$tree"/libespm/src/*.cpp "$tree/viet/src/MappedBuffer.cpp" "$tree/viet/src/AllocatedBuffer.cpp"; do
  o="$work/obj/$(basename "$f" .cpp).o"
  [ "$o" -nt "$f" ] || g++ $flags -DNDEBUG -c "$f" -o "$o"
done
g++ $flags -I"$work" "$here/interior_load_cost.cpp" "$work"/obj/*.o -L"$deps/lib" -lspdlog -lfmt -lz -o "$work/interior_load_cost"
"$work/interior_load_cost" "$work/plugins" "$files" "$budget"
