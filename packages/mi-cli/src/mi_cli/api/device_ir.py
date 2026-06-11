from mi_cli.api.auth import _check_available, _load_auth_data, _request_api
from mi_cli.api.device_cache import _find_device_in_cache


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
