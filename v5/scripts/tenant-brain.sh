#!/usr/bin/env bash
# HomeSense v5 — 按租户创建独立云大脑 gateway 进程。
#
# 每个租户一个独立进程，彻底隔离：
#   - workspace   : <DATA_DIR>/<TENANT>/workspace   (记忆/会话/文件全在此目录)
#   - pico-history: <DATA_DIR>/<TENANT>/pico-history.db
#   - token       : 各自独立
#   - port        : 各自独立
#
# 用法:
#   tenant-brain.sh create <tenantId> <port> <token> [idleShutdownMinutes]
#   tenant-brain.sh start  <tenantId>
#   tenant-brain.sh stop   <tenantId>
#   tenant-brain.sh status <tenantId>
#   tenant-brain.sh list

set -euo pipefail

DATA_DIR="${HS_BRAIN_DATA:-/home/a1/HomeSense-Studio-v3/.hs-brain}"
BIN="${HS_BRAIN_BIN:-$DATA_DIR/picoclaw}"
GATEWAY_PORT="${HS_BRAIN_PROBE_PORT:-18790}"
IDLE_MINUTES="${HS_BRAIN_IDLE_MINUTES:-5}"

usage() { echo "usage: $0 {create|start|stop|status|list} ..."; exit 1; }

tenant_dir() { echo "$DATA_DIR/$1"; }
tenant_config() { echo "$DATA_DIR/$1/config.json"; }
tenant_log() { echo "$DATA_DIR/$1/gateway.log"; }
tenant_pid() { echo "$DATA_DIR/$1/gateway.pid"; }

need_bin() {
  if [ ! -x "$BIN" ]; then
    echo "errors: binary not found at $BIN (build go ./cmd/picoclaw first)" >&2
    exit 1
  fi
}

cmd_create() {
  local id="$1" port="$2" token="$3" idle="${4:-$IDLE_MINUTES}"
  [ -z "$id" ] || [ -z "$port" ] || [ -z "$token" ] && { echo "create requires tenantId port token"; exit 1; }
  local dir; dir="$(tenant_dir "$id")"
  mkdir -p "$dir/workspace"
  cat > "$(tenant_config "$id")" <<EOF
{
  "version": 3,
  "agents": {
    "defaults": {
      "workspace": "$dir/workspace",
      "restrict_to_workspace": true,
      "model_name": "auto",
      "max_tokens": 8192,
      "context_window": 131072,
      "temperature": 0.7,
      "max_tool_iterations": 20
    }
  },
  "model_list": [
    {
      "model_name": "auto",
      "model": "openai/auto",
      "api_keys": ["123456"],
      "api_base": "http://192.168.31.82:8317/v1"
    },
    {
      "model_name": "deepseek-v4-flash",
      "model": "openai/deepseek-v4-flash",
      "api_keys": ["123456"],
      "api_base": "http://192.168.31.82:8317/v1"
    },
    {
      "model_name": "glm-5.2",
      "model": "openai/glm-5.2",
      "api_keys": ["123456"],
      "api_base": "http://192.168.31.82:8317/v1"
    }
  ],
  "channel_list": {
    "pico": {
      "enabled": true,
      "type": "pico",
      "allow_from": [],
      "settings": {
        "token": "$token",
        "allow_token_query": true,
        "allow_origins": [],
        "ping_interval": 30,
        "read_timeout": 60,
        "max_connections": 100,
        "db_path": "$dir/pico-history.db",
        "idle_shutdown_minutes": $idle
      }
    }
  },
  "gateway": {
    "host": "127.0.0.1",
    "port": $port,
    "log_level": "info"
  }
}
EOF
  echo "created tenant brain: $id (port=$port token=$token idle=$idle dir=$dir)"
}

cmd_start() {
  local id="$1"
  local cfg; cfg="$(tenant_config "$id")"
  [ -f "$cfg" ] || { echo "no config for tenant $id (run create first)"; exit 1; }
  need_bin
  local log pidfile
  log="$(tenant_log "$id")"
  pidfile="$(tenant_pid "$id")"

  # 避免重复启动同一个租户
  if [ -f "$pidfile" ]; then
    local oldpid
    oldpid="$(cat "$pidfile" 2>/dev/null || true)"
    if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null; then
      echo "tenant $id already running (pid=$oldpid)"
      return 0
    fi
  fi

  # 每个租户独立 PICOCLAW_HOME，隔离 pidfile / skills 等全局资源
  export PICOCLAW_CONFIG="$cfg"
  export PICOCLAW_HOME="$(tenant_dir "$id")/.picoclaw-home"
  setsid "$BIN" gateway >> "$log" 2>&1 < /dev/null &
  local pid=$!
  unset PICOCLAW_CONFIG PICOCLAW_HOME
  echo "$pid" > "$pidfile"
  echo "started tenant $id (pid=$pid log=$log)"
}

cmd_stop() {
  local id="$1"
  local pidfile; pidfile="$(tenant_pid "$id")"
  if [ -f "$pidfile" ]; then
    local pid
    pid="$(cat "$pidfile" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      rm -f "$pidfile"
      echo "stopped tenant $id (pid=$pid)"
      return 0
    fi
    rm -f "$pidfile"
  fi
  echo "tenant $id not running"
}

cmd_status() {
  local id="$1"
  local pidfile; pidfile="$(tenant_pid "$id")"
  local port; port="$(grep -o '"port": *[0-9]*' "$(tenant_config "$id")" 2>/dev/null | head -1 | grep -o '[0-9]*' || true)"
  if [ -f "$pidfile" ]; then
    local pid
    pid="$(cat "$pidfile" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "running pid=$pid port=$port"
      return 0
    fi
    rm -f "$pidfile"
  fi
  echo "stopped port=$port"
}

cmd_list() {
  for d in "$DATA_DIR"/*/; do
    [ -d "$d" ] || continue
    local id; id="$(basename "$d")"
    [ "$id" = workspace ] && continue
    [ -f "$d/config.json" ] || continue
    local port token db
    port="$(grep -o '"port": *[0-9]*' "$d/config.json" | head -1 | grep -o '[0-9]*')"
    token="$(grep -o '"token": *"[^"]*"' "$d/config.json" | head -1 | grep -o '"[^"]*"' | tr -d '"')"
    db="$d/pico-history.db"
    echo "$id  port=$port  db=$([ -f "$db" ] && echo yes || echo no)  token=$token"
  done
}

cmd="${1:-}"
case "$cmd" in
  create) cmd_create "${2:-}" "${3:-}" "${4:-}" "${5:-}" ;;
  start) cmd_start "${2:-}" ;;
  stop) cmd_stop "${2:-}" ;;
  status) cmd_status "${2:-}" ;;
  list) cmd_list ;;
  *) usage ;;
esac