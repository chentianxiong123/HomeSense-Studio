#!/usr/bin/env bash
# 编译 v7 云脑 + 手机执行端两个二进制，输出到 ~/bin（持久目录，不随重启丢失）。
# 用法: bash v7/scripts/build.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${HOME}/bin"
mkdir -p "$OUT"

echo "[] 编译 v7server (v7 云脑) ..."
(cd "$ROOT/v7/cmd/v7server" && go build -o "$OUT/v7server-new" .)

echo "[] 编译 hs-executor (手机执行端) ..."
# v5 的 vendor 与 go.mod 不一致，必须 -mod=mod 走模块缓存
(cd "$ROOT/old/v5/backend" && go build -mod=mod -o "$OUT/hs-executor" ./cmd/executor)

echo ""
echo "编译完成，输出:"
ls -la "$OUT/v7server-new" "$OUT/hs-executor"