#!/usr/bin/env bash
# 独立编译 moonlight-embedded，不参与 Go 项目构建
# 用法: bash scripts/build-moonlight.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}/..")" && pwd)"
SRC="$ROOT/pkg/capabilities/moonlight/vendor/moonlight-embedded"
BUILD="$SRC/build"
OUT="$ROOT/pkg/capabilities/moonlight/vendor/bin"

[ -f "$SRC/CMakeLists.txt" ] || { echo "源码未就绪"; exit 1; }
command -v cmake >/dev/null || { echo "需要 cmake"; exit 1; }

mkdir -p "$BUILD" "$OUT"
cd "$BUILD"
cmake "$SRC" \
  -DENABLE_CEC=OFF -DENABLE_PULSE=OFF \
  -DENABLE_SDL=ON -DENABLE_X11=ON \
  -DCMAKE_BUILD_TYPE=Release
cmake --build . -j"$(nproc)"
cp "$BUILD/moonlight" "$OUT/"
find "$BUILD" -name '*.so*' -exec cp {} "$OUT/" \;

echo "✅ 完成: $OUT/moonlight ($(du -h "$OUT/moonlight" | cut -f1))"
for f in "$OUT"/*.so*; do [ -f "$f" ] && echo "  $(basename "$f")"; done
