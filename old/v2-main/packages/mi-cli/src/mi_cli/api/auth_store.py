import json
import os
import pathlib
import time


AUTH_DIR = os.environ.get("MI_CLI_CONFIG_DIR", os.path.expanduser("~/.cache/mi-cli"))
AUTH_FILE = os.path.join(AUTH_DIR, "auth.json")
QR_STATE_FILE = os.path.join(AUTH_DIR, "qr_state.json")


def _ensure_dir():
    pathlib.Path(AUTH_DIR).mkdir(parents=True, exist_ok=True)


def _load_auth_data() -> dict:
    _ensure_dir()
    if os.path.exists(AUTH_FILE):
        with open(AUTH_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def _save_auth_data(data: dict):
    _ensure_dir()
    data["saveTime"] = int(time.time() * 1000)
    with open(AUTH_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _load_qr_state() -> dict:
    _ensure_dir()
    if os.path.exists(QR_STATE_FILE):
        with open(QR_STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def _save_qr_state(data: dict):
    _ensure_dir()
    with open(QR_STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _clear_qr_state():
    if os.path.exists(QR_STATE_FILE):
        os.remove(QR_STATE_FILE)
