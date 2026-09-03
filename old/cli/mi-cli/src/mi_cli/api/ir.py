from mi_cli.api.auth import (
    _load_auth_data,
    _check_available,
    _request_api,
)


def handle_ir_discover(command: dict) -> dict:
    auth_data = _load_auth_data()
    if not _check_available(auth_data):
        return {"status": "error", "error": "AUTH_FAILED", "message": "未登录"}

    parent_did = command.get("parent_did") or command.get("did")
    if not parent_did:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "缺少 parent_did 参数"}

    try:
        data = {"parent_id": parent_did}
        result = _request_api(auth_data, "/v2/irdevice/controllers", data)
        controllers = []
        for ctrl in result.get("controllers", result.get("result", [])):
            controllers.append({
                "controller_id": ctrl.get("controller_id", ctrl.get("id", "")),
                "name": ctrl.get("name", ""),
                "type": ctrl.get("type", ""),
            })
        return {"status": "success", "data": {"controllers": controllers}}
    except Exception as e:
        return {"status": "error", "error": "DEVICE_NOT_FOUND", "message": str(e)}


def handle_ir_get_keys(command: dict) -> dict:
    auth_data = _load_auth_data()
    if not _check_available(auth_data):
        return {"status": "error", "error": "AUTH_FAILED", "message": "未登录"}

    did = command.get("did")
    controller_id = command.get("controller_id")
    if not did and not controller_id:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "缺少 did 或 controller_id 参数"}

    try:
        data = {"controller_id": controller_id or did}
        result = _request_api(auth_data, "/v2/irdevice/controller/keys", data)
        keys = []
        for key in result.get("keys", result.get("result", [])):
            keys.append({
                "key_id": key.get("key_id", key.get("id", "")),
                "name": key.get("name", ""),
                "type": key.get("type", ""),
            })
        return {"status": "success", "data": {"keys": keys}}
    except Exception as e:
        return {"status": "error", "error": "DEVICE_NOT_FOUND", "message": str(e)}


def handle_ir_press_key(command: dict) -> dict:
    auth_data = _load_auth_data()
    if not _check_available(auth_data):
        return {"status": "error", "error": "AUTH_FAILED", "message": "未登录"}

    did = command.get("did")
    controller_id = command.get("controller_id")
    key_id = command.get("key_id")
    if not key_id:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "缺少 key_id 参数"}
    if not did and not controller_id:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "缺少 did 或 controller_id 参数"}

    try:
        data = {
            "controller_id": controller_id or did,
            "key_id": key_id,
        }
        result = _request_api(auth_data, "/v2/irdevice/controller/key/click", data)
        return {"status": "success", "data": result}
    except Exception as e:
        return {"status": "error", "error": "DEVICE_OFFLINE", "message": str(e)}
