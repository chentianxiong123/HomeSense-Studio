#!/usr/bin/env bash
# 一键启动 v7 三件套（不编译、不自启）：
#   one-api (:3200)  +  v7server 云脑 (:8081)  +  电脑端 executor (:51122)
# 依赖 ~/bin/v7server-new 和 ~/bin/hs-executor（先跑 v7/scripts/build.sh 编译）
# 用法: bash v7/scripts/start.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN="${HOME}/bin"
LOG_DIR="$ROOT/v7/logs"
mkdir -p "$LOG_DIR"

if [ ! -x "$BIN/v7server-new" ]; then
  echo "缺少 $BIN/v7server-new，请先运行: bash $ROOT/v7/scripts/build.sh"
  exit 1
fi

start_one() { :; }
port_up() { ss -ltn 2>/dev/null | grep -q ":$1 "; }

# one-api
if port_up 3200; then
  echo "[one-api] 3200 已在运行"
else
  echo "[one-api] 启动 :3200 ..."
  (cd "$ROOT/v7" && setsid nohup env PORT=3200 ./third_party/one-api/bin/one-api > "$LOG_DIR/one-api.log" 2>&1 < /dev/null & disown)
  sleep 2
fi

# v7server 云脑
if port_up 8081; then
  echo "[v7server] 8081 已在运行"
else
  echo "[v7server] 启动 :8081 ..."
  setsid nohup "$BIN/v7server-new" \
    -addr :8081 \
    -data "$ROOT/v7/data-v7" \
    -gateway-base http://localhost:3200/v1 \
    -gateway-key 3aaa5c4cecba45bfb1ad4c151b2f3cd6 \
    -web-dir "$ROOT/third_party/picoclaw/web/frontend/dist" \
    -parallel-turns 8 \
    > "$LOG_DIR/v7server.log" 2>&1 < /dev/null & disown
  sleep 3
fi

# 电脑端 executor（作为本机 MCP 工具源）
if [ -x "$BIN/hs-executor" ]; then
  if port_up 51122; then
    echo "[executor] 51122 已在运行"
  else
    echo "[executor] 启动 :51122 ..."
    setsid nohup "$BIN/hs-executor" -host 127.0.0.1 -port 51122 -token tenant-token-0001 > "$LOG_DIR/executor.log" 2>&1 < /dev/null & disown
    sleep 1
  fi
else
  echo "[executor] 跳过（未编译 hs-executor，本轮不需要）"
fi

echo ""
echo "======== 状态 ========"
for p in 3200 8081 51122; do
  if port_up "$p"; then echo "  :$p  UP"; else echo "  :$p  DOWN"; fi
done
echo "======================"
echo
echo "访问: http://$(hostname -I | awk '{print $1}'):8081   (test / 123456789)"
echo "日志: $LOG_DIR/"