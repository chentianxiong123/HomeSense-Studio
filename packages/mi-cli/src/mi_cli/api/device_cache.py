import json
import os
import time

from mi_cli.api.auth_store import AUTH_DIR


DEVICE_CACHE_FILE = os.path.join(AUTH_DIR, "devices.json")
DEVICE_CACHE_TTL = 86400  # 24h


def _load_device_cache() -> dict:
    if os.path.exists(DEVICE_CACHE_FILE):
        try:
            with open(DEVICE_CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_device_cache(data: dict):
    os.makedirs(AUTH_DIR, exist_ok=True)
    with open(DEVICE_CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _get_cached_devices(renew: bool = False) -> tuple:
    """对照 hass-xiaomi-miot async_get_devices: 读缓存→过期判断→API→存缓存"""
    dat = _load_device_cache()
    now = time.time()
    cached = dat.get("devices") or []
    homes = dat.get("homes") or []
    if not renew and dat.get("update_time", 0) > (now - DEVICE_CACHE_TTL) and cached:
        return cached, homes
    return None, None


def _find_device_in_cache(did: str) -> dict | None:
    """Linear scan across cached devices by DID."""
    cache = _load_device_cache()
    for dev in cache.get("devices", []):
        if dev.get("did") == did:
            return dev
    return None
