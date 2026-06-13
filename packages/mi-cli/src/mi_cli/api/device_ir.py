from mi_cli.api.auth import _check_available, _load_auth_data, _request_api
from mi_cli.api.device_cache import _find_device_in_cache

REMOTE_KEY_SPECS = [
    {"normalized": "power", "display": "电源", "zone": "basic", "position": "power", "labels": ["电源", "开关", "power"]},
    {"normalized": "home", "display": "主页", "zone": "basic", "position": "home", "labels": ["主页", "首页", "主页键", "首页键", "home", "homekey"]},
    {"normalized": "menu", "display": "菜单", "zone": "basic", "position": "menu", "labels": ["菜单", "menu"]},
    {"normalized": "back", "display": "返回", "zone": "basic", "position": "back", "labels": ["返回", "退出", "back"]},
    {"normalized": "up", "display": "上", "zone": "navigation", "position": "up", "labels": ["上", "上键", "向上", "方向上", "方向键上", "up", "upkey"]},
    {"normalized": "down", "display": "下", "zone": "navigation", "position": "down", "labels": ["下", "下键", "向下", "方向下", "方向键下", "down", "downkey"]},
    {"normalized": "left", "display": "左", "zone": "navigation", "position": "left", "labels": ["左", "左键", "向左", "方向左", "方向键左", "left", "leftkey"]},
    {"normalized": "right", "display": "右", "zone": "navigation", "position": "right", "labels": ["右", "右键", "向右", "方向右", "方向键右", "right", "rightkey"]},
    {"normalized": "ok", "display": "确认", "zone": "navigation", "position": "ok", "labels": ["确定", "确认", "ok", "enter"]},
    {"normalized": "volume_up", "display": "音量+", "zone": "volume", "position": "volume_up", "labels": ["音量+", "音量加", "音量＋", "vol+", "volume+"]},
    {"normalized": "volume_down", "display": "音量-", "zone": "volume", "position": "volume_down", "labels": ["音量-", "音量减", "音量－", "vol-", "volume-"]},
    {"normalized": "mute", "display": "静音", "zone": "volume", "position": "mute", "labels": ["静音", "mute"]},
    {"normalized": "channel_up", "display": "频道+", "zone": "channel", "position": "channel_up", "labels": ["频道+", "频道加", "节目+", "节目加", "ch+", "channel+"]},
    {"normalized": "channel_down", "display": "频道-", "zone": "channel", "position": "channel_down", "labels": ["频道-", "频道减", "节目-", "节目减", "ch-", "channel-"]},
    *[
        {"normalized": f"digit_{n}", "display": str(n), "zone": "number", "position": str(n), "labels": [str(n), f"数字{n}", f"num{n}"]}
        for n in range(10)
    ],
]


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

    profile = _build_remote_profile(matched, device_info, keys)
    return {
        "status": "success",
        "data": profile,
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


def _build_remote_profile(controller: dict, device_info: dict, raw_keys: list) -> dict:
    keys = _normalize_remote_keys(raw_keys)
    return {
        "controller_id": controller.get("controller_id", ""),
        "name": controller.get("name", ""),
        "type": device_info.get("device_type") or controller.get("type", ""),
        "source": "mi",
        "keys": keys,
        "layout": _build_remote_layout(keys),
    }


def _normalize_remote_keys(raw_keys: list) -> list:
    normalized_keys = []
    seen = set()
    for raw in raw_keys:
        raw_name = str(raw.get("name", "")).strip()
        raw_type = str(raw.get("type", "")).strip()
        spec = _match_remote_key(raw_name, raw_type)
        if not spec or spec["normalized"] in seen:
            continue
        key_id = raw.get("key_id", raw.get("id", ""))
        if key_id in (None, ""):
            continue
        seen.add(spec["normalized"])
        normalized_keys.append({
            "key_id": str(key_id),
            "name": spec["display"],
            "raw_name": raw_name,
            "type": raw_type,
            "normalized": spec["normalized"],
            "zone": spec["zone"],
            "position": spec["position"],
        })
    order = {spec["normalized"]: index for index, spec in enumerate(REMOTE_KEY_SPECS)}
    return sorted(normalized_keys, key=lambda item: order.get(item["normalized"], 999))


def _match_remote_key(name: str, key_type: str) -> dict | None:
    normalized_name = _compact_key_name(name)
    normalized_type = _compact_key_name(key_type)
    for spec in REMOTE_KEY_SPECS:
        for label in spec["labels"]:
            compact_label = _compact_key_name(label)
            if normalized_name == compact_label or normalized_type == compact_label:
                return spec
    for spec in REMOTE_KEY_SPECS:
        for label in spec["labels"]:
            compact_label = _compact_key_name(label)
            if len(compact_label) >= 2 and (compact_label in normalized_name or compact_label in normalized_type):
                return spec
    return None


def _compact_key_name(value: str) -> str:
    return (
        value.lower()
        .replace(" ", "")
        .replace("_", "")
        .replace("-", "")
        .replace("＋", "+")
        .replace("－", "-")
    )


def _build_remote_layout(keys: list) -> dict:
    layout = {}
    for key in keys:
        zone = key.get("zone") or "basic"
        layout.setdefault(zone, []).append(key.get("normalized"))
    return layout


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
