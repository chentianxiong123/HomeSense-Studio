import json
import os
import time

import httpx

from mi_cli.api.auth import (
    _load_auth_data,
    _check_available,
    _request_api,
    AUTH_DIR,
    API_BASE_URL,
)
from mi_cli.api.spec import handle_spec_parse as _spec_parse_internal
from mi_cli.capability.engine import (
    extract_device_type,
    build_device_capability_profile,
    build_device_capabilities_list,
    generate_entities,
    lookup_capability_for_action,
    lookup_capability_for_property,
    build_discover_summary,
)

DEVICE_CACHE_FILE = os.path.join(AUTH_DIR, "devices.json")
DEVICE_CACHE_TTL = 86400  # 24h


def _find_device_in_cache(did: str) -> dict | None:
    """Linear scan across cached devices by DID."""
    cache = _load_device_cache()
    for dev in cache.get("devices", []):
        if dev.get("did") == did:
            return dev
    return None


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


def _get_home_owner(auth_data: dict, home_id: int) -> int:
    return int(auth_data.get("userId", 0))


def handle_discover(command: dict) -> dict:
    auth_data = _load_auth_data()

    if not _check_available(auth_data):
        return {"status": "error", "error": "AUTH_FAILED", "message": "未登录，请先执行 login_qr"}

    renew = command.get("renew", False)
    summary_only = command.get("summary_only", False)

    # 对照 hass-xiaomi-miot: 先读缓存
    cached_devices, cached_homes = _get_cached_devices(renew=renew)
    if cached_devices is not None:
        summary = build_discover_summary(cached_devices)
        if summary_only:
            return {"status": "success", "data": {"summary": summary, "count": len(summary)}}
        return {"status": "success", "data": {"devices": cached_devices, "homes": cached_homes, "summary": summary}}

    # 缓存过期或强制刷新 → 调 API
    try:
        homes = _get_homes_list(auth_data)
    except Exception as e:
        # 对照 hass-xiaomi-miot: 连不上但有过期缓存也能用
        dat = _load_device_cache()
        if dat.get("devices"):
            stale_devices = dat.get("devices", [])
            summary = build_discover_summary(stale_devices)
            if summary_only:
                return {"status": "success", "data": {"summary": summary, "count": len(summary), "stale": True}}
            return {"status": "success", "data": {"devices": stale_devices, "homes": dat.get("homes", []), "summary": summary, "stale": True}}
        return {"status": "error", "error": "NETWORK_TIMEOUT", "message": f"获取家庭列表失败: {e}"}

    all_devices = []
    for home in homes:
        home_id = home.get("id", home.get("home_id"))
        if not home_id:
            continue
        try:
            devices = _get_devices_list(auth_data, home_id)
            for dev in devices:
                device_info = _parse_device(dev, home)
                device_info = _enrich_device_with_spec(device_info)
                all_devices.append(device_info)
        except Exception:
            continue

    # 存缓存 — 对照 hass-xiaomi-miot 的 store.async_save
    _save_device_cache({
        "update_time": time.time(),
        "devices": all_devices,
        "homes": homes,
    })

    summary = build_discover_summary(all_devices)
    if summary_only:
        return {"status": "success", "data": {"summary": summary, "count": len(summary)}}
    return {"status": "success", "data": {"devices": all_devices, "homes": homes, "summary": summary}}


def _enrich_device_with_spec(device_info: dict) -> dict:
    model = device_info.get("model", "")
    if not model:
        return device_info

    spec_result = _spec_parse_internal({"model": model})
    if spec_result.get("status") != "success":
        return device_info

    spec_data = spec_result.get("data", {})
    device_type = extract_device_type(spec_data.get("type", ""))
    device_info["spec_type"] = spec_data.get("type", "")
    device_info["device_type"] = device_type

    features = []
    properties = []
    actions = []
    for svc in spec_data.get("services", []):
        siid = svc.get("iid", 0)
        for prop in svc.get("properties", []):
            piid = prop.get("iid", 0)
            feature = {
                "siid": siid,
                "piid": piid,
                "type": "property",
                "name": prop.get("name", ""),
                "service_name": svc.get("name", ""),
                "rw": "read" if "read" in prop.get("access", []) and "write" not in prop.get("access", []) else "write" if "write" in prop.get("access", []) and "read" not in prop.get("access", []) else "read_write",
                "format": prop.get("type", prop.get("format", "")),
                "unit": prop.get("unit", ""),
            }
            if "value_range" in prop:
                feature["value_range"] = prop["value_range"]
            if "value_list" in prop:
                feature["value_list"] = prop["value_list"]
            features.append(feature)
            properties.append({**prop, "siid": siid})

        for act in svc.get("actions", []):
            aiid = act.get("iid", 0)
            feature = {
                "siid": siid,
                "aiid": aiid,
                "type": "action",
                "name": act.get("name", ""),
                "service_name": svc.get("name", ""),
            }
            features.append(feature)
            actions.append({**act, "siid": siid})

    device_info["features"] = features

    cap_profile = build_device_capability_profile(device_type, properties, actions)
    device_info["capability_profile"] = cap_profile
    entities = generate_entities(device_info, cap_profile)
    device_info["entities"] = entities

    return device_info


def handle_discover_ir(command: dict) -> dict:
    auth_data = _load_auth_data()

    if not _check_available(auth_data):
        return {"status": "error", "error": "AUTH_FAILED", "message": "未登录，请先执行 login_qr"}

    parent_did = command.get("parent_did") or command.get("did")
    if not parent_did:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "缺少 parent_did 参数"}

    try:
        controllers = _get_ir_controllers(auth_data, parent_did)
    except Exception as e:
        return {"status": "error", "error": "NETWORK_TIMEOUT", "message": f"获取红外设备失败: {e}"}

    return {"status": "success", "data": {"controllers": controllers}}


ERROR_CODE_MAP = {
    "-10000": "UNKNOWN_ERROR",
    "-10007": "DEVICE_OFFLINE",
    "-10030": "TOKEN_EXPIRED",
    "-10020": "DEVICE_NOT_FOUND",
    "-10010": "INVALID_PARAMS",
    "-10008": "RATE_LIMIT",
    "-10006": "NETWORK_TIMEOUT",
    "-10001": "AUTH_FAILED",
    "-10014": "SPEC_NOT_FOUND",
    "-10015": "ACTION_NOT_FOUND",
}


def _map_error_code(code) -> str:
    return ERROR_CODE_MAP.get(str(code), "CLI_ERROR")


def handle_get_prop(command: dict) -> dict:
    auth_data = _load_auth_data()
    if not _check_available(auth_data):
        return {"status": "error", "error": "AUTH_FAILED", "message": "未登录"}

    props = command.get("props")
    if props and isinstance(props, list):
        try:
            result = _request_api(auth_data, "/miotspec/prop/get", {"params": props, "datasource": 1})
            if isinstance(result, list):
                for item in result:
                    item["error"] = _map_error_code(item.get("code", 0)) if item.get("code", 0) not in (0, 1) else None
                return {"status": "success", "data": result}
            return {"status": "success", "data": result}
        except Exception as e:
            return {"status": "error", "error": "DEVICE_OFFLINE", "message": str(e)}

    did = command.get("did")
    siid = command.get("siid")
    piid = command.get("piid")
    if not all([did, siid is not None, piid is not None]):
        return {"status": "error", "error": "INVALID_PARAMS", "message": "缺少 did/siid/piid 参数"}

    try:
        data = [{"did": did, "siid": siid, "piid": piid}]
        result = _request_api(auth_data, "/miotspec/prop/get", {"params": data, "datasource": 1})
        if isinstance(result, list) and len(result) > 0:
            item = result[0]
            if item.get("code", 0) not in (0, 1):
                return {"status": "error", "error": _map_error_code(item.get("code")), "message": item.get("message", "读取失败")}
            return {"status": "success", "data": item}
        return {"status": "success", "data": result}
    except Exception as e:
        return {"status": "error", "error": "DEVICE_OFFLINE", "message": str(e)}


def handle_set_prop(command: dict) -> dict:
    auth_data = _load_auth_data()
    if not _check_available(auth_data):
        return {"status": "error", "error": "AUTH_FAILED", "message": "未登录"}

    props = command.get("props")
    if props and isinstance(props, list):
        try:
            result = _request_api(auth_data, "/miotspec/prop/set", {"params": props})
            if isinstance(result, list):
                for item in result:
                    if item.get("code", 0) not in (0, 1):
                        item["error"] = _map_error_code(item.get("code"))
                    else:
                        item["message"] = "成功"
                return {"status": "success", "data": result}
            return {"status": "success", "data": result}
        except Exception as e:
            return {"status": "error", "error": "DEVICE_OFFLINE", "message": str(e)}

    did = command.get("did")
    siid = command.get("siid")
    piid = command.get("piid")
    value = command.get("value")
    if not all([did, siid is not None, piid is not None]):
        return {"status": "error", "error": "INVALID_PARAMS", "message": "缺少 did/siid/piid 参数"}

    try:
        data = [{"did": did, "siid": siid, "piid": piid, "value": value}]
        result = _request_api(auth_data, "/miotspec/prop/set", {"params": data})
        if isinstance(result, list) and len(result) > 0:
            item = result[0]
            if item.get("code", 0) not in (0, 1):
                return {"status": "error", "error": _map_error_code(item.get("code")), "message": item.get("message", "控制失败")}
            return {"status": "success", "data": {"did": did, "siid": siid, "piid": piid, "value": value, "code": item.get("code", 0)}}
        return {"status": "success", "data": result}
    except Exception as e:
        return {"status": "error", "error": "DEVICE_OFFLINE", "message": str(e)}


def handle_run_action(command: dict) -> dict:
    auth_data = _load_auth_data()
    if not _check_available(auth_data):
        return {"status": "error", "error": "AUTH_FAILED", "message": "未登录"}

    did = command.get("did")
    siid = command.get("siid")
    aiid = command.get("aiid")
    if not all([did, siid is not None, aiid is not None]):
        return {"status": "error", "error": "INVALID_PARAMS", "message": "缺少 did/siid/aiid 参数"}

    try:
        data = {"params": {"did": did, "siid": siid, "aiid": aiid, "in": command.get("params", [])}}
        result = _request_api(auth_data, "/miotspec/action", data)
        if isinstance(result, dict):
            if result.get("code", 0) not in (0, 1):
                return {"status": "error", "error": _map_error_code(result.get("code")), "message": result.get("message", "执行失败")}
        return {"status": "success", "data": result}
    except Exception as e:
        return {"status": "error", "error": "DEVICE_OFFLINE", "message": str(e)}


def handle_device_action(command: dict) -> dict:
    """AI-friendly: resolve capability name → siid/aiid → execute action."""
    auth_data = _load_auth_data()
    if not _check_available(auth_data):
        return {"status": "error", "error": "AUTH_FAILED", "message": "未登录"}

    did = command.get("did")
    capability = command.get("capability")
    if not did or not capability:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "缺少 did/capability 参数"}

    device_info = _find_device_in_cache(did)
    if not device_info:
        return {"status": "error", "error": "DEVICE_NOT_FOUND", "message": f"设备 {did} 未找到，请先 discover"}

    resolved = lookup_capability_for_action(device_info, capability)
    if not resolved:
        return {"status": "error", "error": "CAPABILITY_NOT_FOUND", "message": f"能力 '{capability}' 在设备 {did} 上不存在", "available": list(device_info.get("capability_profile", {}).get("controls", {}).keys())}

    params = command.get("params", [])
    try:
        data = {"params": {"did": did, "siid": resolved["siid"], "aiid": resolved["aiid"], "in": params}}
        result = _request_api(auth_data, "/miotspec/action", data)
        if isinstance(result, dict):
            if result.get("code", 0) not in (0, 1):
                return {"status": "error", "error": _map_error_code(result.get("code")), "message": result.get("message", "执行失败")}
        return {"status": "success", "data": result, "capability": capability}
    except Exception as e:
        return {"status": "error", "error": "DEVICE_OFFLINE", "message": str(e)}


def handle_device_prop(command: dict) -> dict:
    """AI-friendly: resolve capability name → siid/piid → read or write property."""
    auth_data = _load_auth_data()
    if not _check_available(auth_data):
        return {"status": "error", "error": "AUTH_FAILED", "message": "未登录"}

    did = command.get("did")
    capability = command.get("capability")
    value = command.get("value")
    if not did or not capability:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "缺少 did/capability 参数"}

    device_info = _find_device_in_cache(did)
    if not device_info:
        return {"status": "error", "error": "DEVICE_NOT_FOUND", "message": f"设备 {did} 未找到，请先 discover"}

    resolved = lookup_capability_for_property(device_info, capability)
    if not resolved:
        return {"status": "error", "error": "CAPABILITY_NOT_FOUND", "message": f"能力 '{capability}' 在设备 {did} 上不存在", "available": list(device_info.get("capability_profile", {}).get("controls", {}).keys())}

    piid = resolved["piid"]
    params = [{"did": did, "siid": resolved["siid"], "piid": piid}]
    if value is not None:
        params[0]["value"] = value
        try:
            result = _request_api(auth_data, "/miotspec/prop/set", {"params": params})
            if isinstance(result, list) and len(result) > 0:
                item = result[0]
                if item.get("code", 0) not in (0, 1):
                    return {"status": "error", "error": _map_error_code(item.get("code")), "message": item.get("message", "写入失败")}
                return {"status": "success", "data": item, "capability": capability}
            return {"status": "success", "data": result, "capability": capability}
        except Exception as e:
            return {"status": "error", "error": "DEVICE_OFFLINE", "message": str(e)}
    else:
        try:
            result = _request_api(auth_data, "/miotspec/prop/get", {"params": params, "datasource": 1})
            if isinstance(result, list) and len(result) > 0:
                item = result[0]
                if item.get("code", 0) not in (0, 1):
                    return {"status": "error", "error": _map_error_code(item.get("code")), "message": item.get("message", "读取失败")}
                return {"status": "success", "data": item, "capability": capability}
            return {"status": "success", "data": result, "capability": capability}
        except Exception as e:
            return {"status": "error", "error": "DEVICE_OFFLINE", "message": str(e)}


def handle_device_info(command: dict) -> dict:
    """AI-friendly: query single device by did or fuzzy name match. Returns full device info with capabilities."""
    auth_data = _load_auth_data()
    if not _check_available(auth_data):
        return {"status": "error", "error": "AUTH_FAILED", "message": "未登录"}

    did = command.get("did")
    name = command.get("name")
    if not did and not name:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "缺少 did 或 name 参数"}

    renew = command.get("renew", False)
    cached_devices, _ = _get_cached_devices(renew=renew)
    if cached_devices is None:
        dat = _load_device_cache()
        cached_devices = dat.get("devices", [])

    candidates = []
    if did:
        candidates = [d for d in cached_devices if d.get("did") == did]
    else:
        name_lower = name.lower()
        for d in cached_devices:
            dname = d.get("name", "").lower()
            if name_lower in dname or dname in name_lower:
                candidates.append(d)

    if not candidates:
        return {"status": "error", "error": "DEVICE_NOT_FOUND", "message": f"未找到设备: {did or name}"}

    if len(candidates) > 1:
        summaries = [
            {"did": d.get("did"), "name": d.get("name"), "model": d.get("model")}
            for d in candidates
        ]
        return {"status": "error", "error": "AMBIGUOUS", "message": f"多个设备匹配 '{did or name}'", "candidates": summaries}

    device = candidates[0]
    cap = device.get("capability_profile", {})
    return {
        "status": "success",
        "data": {
            "did": device.get("did"),
            "name": device.get("name"),
            "model": device.get("model"),
            "manufacturer": device.get("manufacturer"),
            "connection_type": device.get("connection_type"),
            "room": device.get("room_name"),
            "home": device.get("home_name"),
            "device_type": device.get("device_type"),
            "spec_type": device.get("spec_type"),
            "capabilities": {
                "actions": list(cap.get("controls", {}).keys()),
                "properties": list(set(p.split(".")[0] for p in cap.get("controls", {}).keys() if "." in p)),
            },
            "capability_detail": cap.get("controls", {}),
        },
    }


def handle_device_capabilities(command: dict) -> dict:
    """返回设备的中文能力列表，无 siid/piid/aiid，适合给 LLM 使用."""
    auth_data = _load_auth_data()
    if not _check_available(auth_data):
        return {"status": "error", "error": "AUTH_FAILED", "message": "未登录"}

    did = command.get("did")
    name = command.get("name")
    if not did and not name:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "缺少 did 或 name 参数"}

    cached_devices, _ = _get_cached_devices(renew=False)
    if cached_devices is None:
        dat = _load_device_cache()
        cached_devices = dat.get("devices", [])

    candidates = []
    if did:
        candidates = [d for d in cached_devices if d.get("did") == did]
    else:
        name_lower = name.lower()
        for d in cached_devices:
            dname = d.get("name", "").lower()
            if name_lower in dname or dname in name_lower:
                candidates.append(d)

    if not candidates:
        return {"status": "error", "error": "DEVICE_NOT_FOUND", "message": f"未找到设备: {did or name}"}

    if len(candidates) > 1:
        summaries = [
            {"did": d.get("did"), "name": d.get("name")} for d in candidates
        ]
        return {"status": "error", "error": "AMBIGUOUS", "message": f"多个设备匹配 '{did or name}'", "candidates": summaries}

    device = candidates[0]
    caps = build_device_capabilities_list(device)
    return {
        "status": "success",
        "data": {
            "did": device.get("did"),
            "name": device.get("name"),
            "device_type": device.get("device_type"),
            "room": device.get("room_name"),
            "capabilities": caps,
        },
    }


def handle_device_ir_keys(command: dict) -> dict:
    """Resolve IR device DID → parent → match controller → fetch keys (only matched)."""
    auth_data = _load_auth_data()
    if not _check_available(auth_data):
        return {"status": "error", "error": "AUTH_FAILED", "message": "未登录"}

    did = command.get("did")
    if not did:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "缺少 did 参数"}

    device_info = _find_device_in_cache(did)
    if not device_info:
        return {"status": "error", "error": "DEVICE_NOT_FOUND", "message": f"设备 {did} 未找到"}

    parent_id = device_info.get("parent_id")
    if not parent_id:
        return {"status": "error", "error": "NO_PARENT", "message": "设备没有父设备（红外网关）"}

    device_name = device_info.get("name", "").lower()
    try:
        controllers = _get_ir_controller_list(auth_data, parent_id)
    except Exception as e:
        return {"status": "error", "error": "NETWORK_TIMEOUT", "message": f"获取红外设备失败: {e}"}

    # Match controller by name
    matched = None
    for ctrl in controllers:
        if ctrl.get("name", "").lower() == device_name:
            matched = ctrl
            break

    if not matched:
        return {
            "status": "error", "error": "CONTROLLER_NOT_FOUND",
            "message": f"未找到匹配的红外控制器: {device_info.get('name')}",
            "controllers": [c["name"] for c in controllers],
        }

    # Fetch keys only for the matched controller
    try:
        keys_data = {"did": matched["controller_id"]}
        keys_result = _request_api(auth_data, "/v2/irdevice/controller/keys", keys_data)
        keys = []
        for key in keys_result.get("keys", keys_result.get("result", [])):
            keys.append({
                "key_id": key.get("key_id", key.get("id", "")),
                "name": key.get("name", ""),
                "type": key.get("type", ""),
            })
    except Exception as e:
        return {"status": "error", "error": "KEYS_FETCH_FAILED", "message": str(e)}

    return {
        "status": "success",
        "data": {
            "controller_id": matched["controller_id"],
            "name": matched["name"],
            "keys": keys,
        },
    }


def handle_device_ir_press(command: dict) -> dict:
    """Resolve IR device DID → controller_id → press key (lightweight, no keys fetch)."""
    auth_data = _load_auth_data()
    if not _check_available(auth_data):
        return {"status": "error", "error": "AUTH_FAILED", "message": "未登录"}

    did = command.get("did")
    key_id = command.get("key_id")
    if not did or not key_id:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "缺少 did/key_id 参数"}

    device_info = _find_device_in_cache(did)
    if not device_info:
        return {"status": "error", "error": "DEVICE_NOT_FOUND", "message": f"设备 {did} 未找到"}

    parent_id = device_info.get("parent_id")
    if not parent_id:
        return {"status": "error", "error": "NO_PARENT", "message": "设备没有父设备（红外网关）"}

    device_name = device_info.get("name", "").lower()
    try:
        controllers = _get_ir_controller_list(auth_data, parent_id)
    except Exception as e:
        return {"status": "error", "error": "NETWORK_TIMEOUT", "message": f"获取红外设备失败: {e}"}

    matched = None
    for ctrl in controllers:
        if ctrl.get("name", "").lower() == device_name:
            matched = ctrl
            break

    if not matched:
        return {
            "status": "error", "error": "CONTROLLER_NOT_FOUND",
            "message": f"未找到匹配的红外控制器: {device_info.get('name')}",
        }

    controller_id = matched["controller_id"]
    try:
        data = {"did": controller_id, "key_id": key_id}
        result = _request_api(auth_data, "/v2/irdevice/controller/key/click", data)
        return {"status": "success", "data": result}
    except Exception as e:
        return {"status": "error", "error": "DEVICE_OFFLINE", "message": str(e)}

def _get_homes_list(auth_data: dict) -> list:
    result = _request_api(auth_data, "/v2/homeroom/gethome_merged", {
        "fg": True,
        "fetch_share": True,
        "fetch_share_dev": True,
        "fetch_cariot": True,
        "limit": 50,
        "app_ver": 7,
        "plat_form": 0,
    })
    homes = []
    for home in result.get("homelist", result.get("home_list", [])):
        homes.append({
            "id": home.get("id", home.get("home_id")),
            "name": home.get("name", ""),
            "city_id": home.get("city_id", 0),
        })
    return homes


def _get_devices_list(auth_data: dict, home_id: int) -> list:
    all_devices = []
    start_did = ""

    while True:
        data = {
            "home_owner": _get_home_owner(auth_data, home_id),
            "home_id": int(home_id),
            "limit": 200,
            "start_did": start_did,
            "get_split_device": True,
            "support_smart_home": True,
            "get_cariot_device": True,
            "get_third_device": True,
        }
        result = _request_api(auth_data, "/home/home_device_list", data)
        device_list = result.get("device_info", result.get("devices", []))
        all_devices.extend(device_list)

        if len(device_list) < 200:
            break
        start_did = device_list[-1].get("did", "")

    return all_devices


def _parse_device(dev: dict, home: dict) -> dict:
    model = dev.get("model", "")
    spec_type = dev.get("spec_type", dev.get("urn", ""))

    connection_type = "wifi"
    if dev.get("pid") == "8":
        connection_type = "gateway"
    elif "bluetooth" in model.lower() or dev.get("pid") == "6":
        connection_type = "bt"
    elif dev.get("ir_device_type"):
        connection_type = "ir"

    device_info = {
        "did": dev.get("did", ""),
        "model": model,
        "name": dev.get("name", ""),
        "manufacturer": dev.get("brand", dev.get("manufacturer", "")),
        "connection_type": connection_type,
        "parent_id": dev.get("parent_id", dev.get("parent_device_id", None)),
        "spec_type": spec_type,
        "home_id": home.get("id"),
        "home_name": home.get("name", ""),
        "room_name": dev.get("room_name", ""),
        "features": [],
        "entities": [],
        "capability_profile": {
            "device_type": "",
            "domains": [],
            "controls": {},
            "supported_operations": [],
        },
    }

    return device_info


def _get_ir_controller_list(auth_data: dict, parent_did: str) -> list:
    """Lightweight: fetch controllers list only (no keys)."""
    data = {"parent_id": parent_did}
    result = _request_api(auth_data, "/v2/irdevice/controllers", data)
    controllers = []
    for ctrl in result.get("controllers", result.get("result", [])):
        controllers.append({
            "controller_id": ctrl.get("controller_id", ctrl.get("did", "")),
            "name": ctrl.get("name", ""),
            "type": ctrl.get("type", ""),
        })
    return controllers


def _get_ir_controllers(auth_data: dict, parent_did: str) -> list:
    controllers = []
    try:
        data = {"parent_id": parent_did}
        result = _request_api(auth_data, "/v2/irdevice/controllers", data)
        for ctrl in result.get("controllers", result.get("result", [])):
            controller = {
                "controller_id": ctrl.get("controller_id", ctrl.get("did", "")),
                "name": ctrl.get("name", ""),
                "type": ctrl.get("type", ""),
                "keys": [],
            }
            try:
                keys_data = {"did": controller["controller_id"]}
                keys_result = _request_api(auth_data, "/v2/irdevice/controller/keys", keys_data)
                for key in keys_result.get("keys", keys_result.get("result", [])):
                    controller["keys"].append({
                        "key_id": key.get("key_id", key.get("id", "")),
                        "name": key.get("name", ""),
                        "type": key.get("type", ""),
                    })
            except Exception:
                pass
            controllers.append(controller)
    except Exception as e:
        raise e

    return controllers
