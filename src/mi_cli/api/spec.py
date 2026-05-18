import json
import os
import pathlib
import random
import time

import httpx

SPEC_CACHE_DIR = os.path.join(
    os.environ.get("MI_CLI_CONFIG_DIR", os.path.expanduser("~/.cache/mi-cli")),
    "specs",
)
SPEC_HOSTS = [
    "https://miot-spec.org",
    "https://spec.miot-spec.com",
]
SPEC_CACHE_TTL_DAYS = int(os.environ.get("SPEC_CACHE_TTL_DAYS", "30"))
INSTANCES_CACHE_TTL_DAYS = 7


def _ensure_dir():
    pathlib.Path(SPEC_CACHE_DIR).mkdir(parents=True, exist_ok=True)


def _safe_filename(name: str) -> str:
    return name.replace(":", "_").replace("/", "_").replace("\\", "_")


def _load_cache(filename: str, ttl_days: int) -> dict | None:
    path = os.path.join(SPEC_CACHE_DIR, filename)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        saved_at = data.get("_saved_at", 0)
        if time.time() - saved_at > ttl_days * 86400:
            return None
        return data
    except Exception:
        return None


def _save_cache(filename: str, data: dict):
    _ensure_dir()
    data["_saved_at"] = time.time()
    path = os.path.join(SPEC_CACHE_DIR, filename)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _download_spec(path: str, tries: int = 3, timeout: int = 30) -> dict:
    for host in SPEC_HOSTS:
        for attempt in range(tries):
            try:
                url = host + path
                resp = httpx.get(url, timeout=timeout, follow_redirects=True)
                if resp.status_code == 200:
                    data = resp.json()
                    if data:
                        return data
            except Exception:
                continue
    raise Exception(f"Failed to download spec from {path}")


def _get_model_type(model: str) -> str | None:
    cache = _load_cache("instances.json", INSTANCES_CACHE_TTL_DAYS)
    if cache is None:
        try:
            data = _download_spec("/miot-spec-v2/instances?status=all")
            instances = {}
            for inst in data.get("instances", [] if isinstance(data, dict) else data):
                if isinstance(inst, dict):
                    m = inst.get("model", "")
                    t = inst.get("type", "")
                    status = inst.get("status", "released")
                    version = int(inst.get("version", "1"))
                    if m:
                        if m not in instances:
                            instances[m] = []
                        instances[m].append({"type": t, "status": status, "version": version})
            cache_data = {"instances": instances, "_saved_at": time.time()}
            _save_cache("instances.json", cache_data)
            cache = cache_data
        except Exception:
            return None

    instances = cache.get("instances", {})
    model_entries = instances.get(model, [])
    if not model_entries:
        return None

    released = [e for e in model_entries if e.get("status") == "released"]
    if released:
        best = max(released, key=lambda e: e.get("version", 0))
        return best.get("type")

    return max(model_entries, key=lambda e: e.get("version", 0)).get("type")


def _get_spec_by_type(spec_type: str) -> dict | None:
    safe_name = _safe_filename(spec_type)
    cache = _load_cache(f"{safe_name}.json", SPEC_CACHE_TTL_DAYS + random.randint(0, 20))
    if cache is not None:
        return cache.get("spec")

    try:
        data = _download_spec(f"/miot-spec-v2/instance?type={spec_type}")
        _save_cache(f"{safe_name}.json", {"spec": data, "type": spec_type})
        return data
    except Exception:
        expired = os.path.join(SPEC_CACHE_DIR, f"{safe_name}.json")
        if os.path.exists(expired):
            try:
                with open(expired, "r", encoding="utf-8") as f:
                    return json.load(f).get("spec")
            except Exception:
                pass
        return None


def _get_langs(spec_type: str) -> dict:
    safe_name = _safe_filename(spec_type)
    cache = _load_cache(f"langs/{safe_name}.json", SPEC_CACHE_TTL_DAYS)
    if cache is not None:
        return cache.get("langs", {})

    try:
        data = _download_spec(f"/instance/v2/multiLanguage?urn={spec_type}")
        _ensure_dir()
        lang_dir = os.path.join(SPEC_CACHE_DIR, "langs")
        pathlib.Path(lang_dir).mkdir(parents=True, exist_ok=True)
        with open(os.path.join(lang_dir, f"{safe_name}.json"), "w", encoding="utf-8") as f:
            json.dump({"langs": data, "_saved_at": time.time()}, f, ensure_ascii=False, indent=2)
        return data
    except Exception:
        return {}


def _parse_spec(spec_data: dict, langs: dict) -> dict:
    result = {
        "type": spec_data.get("type", ""),
        "name": spec_data.get("name", ""),
        "description": spec_data.get("description", ""),
        "services": [],
    }

    for svc in spec_data.get("services", []):
        svc_name = svc.get("name", "") or svc.get("description", "")
        service = {
            "iid": svc.get("iid", 0),
            "name": svc_name,
            "description": _translate(langs, svc.get("description", ""), "service", svc.get("iid")),
            "properties": [],
            "actions": [],
        }

        for prop in svc.get("properties", []):
            prop_name = prop.get("name", "") or prop.get("description", "")
            p = {
                "iid": prop.get("iid", 0),
                "name": prop_name,
                "description": _translate(langs, prop.get("description", ""), "property", prop.get("iid")),
                "type": prop.get("format", ""),
                "access": prop.get("access", []),
                "unit": prop.get("unit", ""),
            }
            if "value-range" in prop:
                p["value_range"] = prop["value-range"]
            if "value-list" in prop:
                p["value_list"] = [
                    {"value": v.get("value"), "description": v.get("description", "")}
                    for v in prop["value-list"]
                ]
            service["properties"].append(p)

        for act in svc.get("actions", []):
            act_name = act.get("name", "") or act.get("description", "")
            a = {
                "iid": act.get("iid", 0),
                "name": act_name,
                "description": _translate(langs, act.get("description", ""), "action", act.get("iid")),
                "in": act.get("in", []),
                "out": act.get("out", []),
            }
            service["actions"].append(a)

        result["services"].append(service)

    return result


def _translate(langs: dict, default: str, category: str, iid: int) -> str:
    if not langs:
        return default
    for key, translations in langs.items():
        if isinstance(translations, dict):
            value = translations.get(str(iid)) or translations.get(default)
            if isinstance(value, str):
                return value
            if isinstance(value, dict):
                result = value.get("zh_cn", value.get("zh_CN", default))
                if result != default:
                    return result
    return default


def handle_spec_parse(command: dict) -> dict:
    model = command.get("model")
    if not model:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "缺少 model 参数"}

    spec_type = _get_model_type(model)
    if not spec_type:
        return {"status": "error", "error": "SPEC_NOT_FOUND", "message": f"Model '{model}' not found in spec index"}

    spec_data = _get_spec_by_type(spec_type)
    if not spec_data:
        return {"status": "error", "error": "NETWORK_TIMEOUT", "message": f"Failed to fetch spec for type '{spec_type}'"}

    langs = _get_langs(spec_type)
    parsed = _parse_spec(spec_data, langs)

    return {"status": "success", "data": parsed}
