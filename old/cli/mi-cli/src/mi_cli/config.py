import json
import os
import pathlib

CONFIG_DIR = os.environ.get("MI_CLI_CONFIG_DIR", os.path.expanduser("~/.cache/mi-cli"))
CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")


def _ensure_config_dir():
    pathlib.Path(CONFIG_DIR).mkdir(parents=True, exist_ok=True)


def load_config() -> dict:
    _ensure_config_dir()
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_config(config: dict):
    _ensure_config_dir()
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)


def handle_config_get(command: dict) -> dict:
    config = load_config()
    key = command.get("key")
    if key:
        return {"status": "success", "data": {key: config.get(key)}}
    return {"status": "success", "data": config}


def handle_config_set(command: dict) -> dict:
    key = command.get("key")
    value = command.get("value")
    if not key:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Missing 'key' field"}
    config = load_config()
    config[key] = value
    save_config(config)
    return {"status": "success", "data": {key: value}}
