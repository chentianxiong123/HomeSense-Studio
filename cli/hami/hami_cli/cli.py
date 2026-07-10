import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
HAMI_SCRIPT = ROOT / "agent" / "src" / "tools" / "hami" / "hami.py"
CONFIG_PATH = ROOT / "homesense-hami-cli-source" / "config.json"


def _load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _resolve_payload(parsed: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    payload = dict(parsed)
    if payload.get("action") == "tv_remote":
        aliases = config.get("device_aliases", {})
        devices = config.get("devices", {})
        requested = payload.get("device", "")
        mapped = aliases.get(requested, requested)
        if mapped in devices:
            payload["device"] = mapped
    return payload


def _build_env(config: dict[str, Any]) -> dict[str, str]:
    env = os.environ.copy()
    home_assistant = config.get("home_assistant", {})
    if home_assistant.get("url"):
        env["HAMi_URL"] = str(home_assistant["url"])
    if home_assistant.get("token"):
        env["HAMi_TOKEN"] = str(home_assistant["token"])
    return env


def cli_main(payload: str):
    if payload == "-":
        payload = sys.stdin.read().strip()

    parsed = json.loads(payload)
    action = parsed.get("action")
    if not action:
        print(json.dumps({"success": False, "error": "Missing action"}, ensure_ascii=False))
        return

    config = _load_config()
    resolved = _resolve_payload(parsed, config)

    args = [sys.executable, str(HAMI_SCRIPT), action]
    for key, value in resolved.items():
        if key == "action":
            continue
        args.append(f"{key}={value}")

    result = subprocess.run(
        args,
        capture_output=True,
        text=True,
        cwd=str(HAMI_SCRIPT.parent),
        env=_build_env(config),
    )

    if result.stdout:
        print(result.stdout.strip())
        return

    error = result.stderr.strip() if result.stderr else f"Process exited with code {result.returncode}"
    print(json.dumps({"success": False, "error": error}, ensure_ascii=False))
