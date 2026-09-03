import time

import httpx

from mi_cli.api.auth import (
    _load_auth_data,
    _check_available,
    _request_api,
    API_BASE_URL,
)
from mi_cli.api.device_cache import (
    _find_device_in_cache,
    _get_cached_devices,
    _load_device_cache,
    _save_device_cache,
)
from mi_cli.api.device_errors import _map_error_code
from mi_cli.api.device_ir import handle_device_ir_keys, handle_device_ir_press, handle_discover_ir
from mi_cli.api.device_model import _parse_device
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


def _get_home_owner(auth_data: dict, home_id: int) -> int:
    return int(auth_data.get("userId", 0))


def handle_discover(command: dict) -> dict:
    auth_data = _load_auth_data()
    renew = command.get("renew", False)
    summary_only = command.get("summary_only", False)

    # Device discovery remains usable from cache only for non-forced reads.
    # HomeSense can pass renew=true when it needs the real CLI/cloud path.
    cached_devices, cached_homes = _get_cached_devices(renew=renew)
    if cached_devices is not None:
        summary = build_discover_summary(cached_devices)
        if summary_only:
            return {"status": "success", "data": {"summary": summary, "count": len(summary)}}
        return {"status": "success", "data": {"devices": cached_devices, "homes": cached_homes, "summary": summary}}

    if not _check_available(auth_data):
        if not renew:
            dat = _load_device_cache()
            stale_devices = dat.get("devices", [])
        else:
            stale_devices = []
        if stale_devices:
            summary = build_discover_summary(stale_devices)
            data = {
                "summary": summary,
                "count": len(summary),
                "stale": True,
                "warning": "米家云端探测失败，已返回本地设备缓存",
            }
            if not summary_only:
                data.update({"devices": stale_devices, "homes": dat.get("homes", [])})
            return {"status": "success", "data": data}
        return {"status": "error", "error": "AUTH_FAILED", "message": "登录凭据不可用，请重新登录"}

    # 缓存过期或强制刷新 → 调 API
    try:
        homes = _get_homes_list(auth_data)
    except Exception as e:
        # 对照 hass-xiaomi-miot: 连不上但有过期缓存也能用
        dat = _load_device_cache() if not renew else {}
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

    did = command.get("did")
    name = command.get("name")
    if not did and not name:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "缺少 did 或 name 参数"}

    renew = command.get("renew", False)
    cached_devices, _ = _get_cached_devices(renew=renew)
    if cached_devices is None:
        dat = _load_device_cache()
        cached_devices = dat.get("devices", [])
    if not cached_devices and not _check_available(auth_data):
        return {"status": "error", "error": "AUTH_FAILED", "message": "未登录"}

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

    did = command.get("did")
    name = command.get("name")
    renew = command.get("renew", False)
    if not did and not name:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "缺少 did 或 name 参数"}

    cached_devices, _ = _get_cached_devices(renew=renew)
    if cached_devices is None:
        discover_result = handle_discover({"action": "discover", "renew": renew})
        if discover_result.get("status") == "success":
            data = discover_result.get("data", {})
            cached_devices = data.get("devices", []) if isinstance(data, dict) else []
        elif not renew:
            dat = _load_device_cache()
            cached_devices = dat.get("devices", [])
        else:
            return discover_result
    if not cached_devices and not _check_available(auth_data):
        return {"status": "error", "error": "AUTH_FAILED", "message": "未登录"}

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
