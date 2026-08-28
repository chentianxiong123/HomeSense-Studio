from mi_cli.api.auth import _load_auth_data, _check_available, _request_api
from mi_cli.api.device import _get_homes_list, _get_home_owner


def handle_scene_list(command: dict) -> dict:
    auth_data = _load_auth_data()
    if not _check_available(auth_data):
        return {"status": "error", "error": "AUTH_FAILED", "message": "未登录"}

    home_id = command.get("home_id")
    try:
        homes = [{"id": home_id, "name": ""}] if home_id else _get_homes_list(auth_data)
        scenes = []
        for home in homes:
            hid = home.get("id", home.get("home_id"))
            if not hid:
                continue
            for scene in _get_scenes_for_home(auth_data, str(hid)):
                scenes.append(_normalize_scene(scene, str(hid), home.get("name", "")))
        return {"status": "success", "data": {"scenes": scenes, "homes": homes, "count": len(scenes)}}
    except Exception as e:
        return {"status": "error", "error": "NETWORK_TIMEOUT", "message": f"获取场景列表失败: {e}"}


def handle_scene_execute(command: dict) -> dict:
    auth_data = _load_auth_data()
    if not _check_available(auth_data):
        return {"status": "error", "error": "AUTH_FAILED", "message": "未登录"}

    scene_id = str(command.get("scene_id", "")).strip()
    scene_name = str(command.get("scene_name", "")).strip()
    home_id = str(command.get("home_id", "")).strip()

    if not scene_id and not scene_name:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "缺少 scene_id 或 scene_name 参数"}

    try:
        scene = None
        if scene_id:
            scene = _resolve_scene_by_id(auth_data, scene_id, home_id or None)
        else:
            resolved = _resolve_scene_by_name(auth_data, scene_name, home_id or None)
            if resolved.get("status") == "error":
                return resolved
            scene = resolved["scene"]

        if not scene:
            return {"status": "error", "error": "SCENE_NOT_FOUND", "message": "未找到场景"}

        resolved_scene_id = str(scene.get("scene_id", scene.get("id", "")))
        resolved_home_id = str(scene.get("home_id", home_id or ""))
        if not resolved_scene_id or not resolved_home_id:
            return {"status": "error", "error": "INVALID_PARAMS", "message": "场景缺少 scene_id 或 home_id"}

        result = _run_scene(auth_data, resolved_scene_id, resolved_home_id)
        return {
            "status": "success",
            "data": {
                "scene": scene,
                "executed": True,
                "result": result,
            },
        }
    except Exception as e:
        return {"status": "error", "error": "API_ERROR", "message": f"执行场景失败: {e}"}


def _get_scenes_for_home(auth_data: dict, home_id: str) -> list:
    data = {
        "app_version": 12,
        "get_type": 2,
        "home_id": str(home_id),
        "owner_uid": _get_home_owner(auth_data, int(home_id)),
    }
    result = _request_api(auth_data, "/appgateway/miot/appsceneservice/AppSceneService/GetSimpleSceneList", data)
    return result.get("manual_scene_info_list", result.get("scene_info_list", []))


def _run_scene(auth_data: dict, scene_id: str, home_id: str) -> dict:
    data = {
        "scene_id": str(scene_id),
        "scene_type": 2,
        "phone_id": "null",
        "home_id": str(home_id),
        "owner_uid": _get_home_owner(auth_data, int(home_id)),
    }
    return _request_api(auth_data, "/appgateway/miot/appsceneservice/AppSceneService/NewRunScene", data)


def _list_all_scenes(auth_data: dict, home_id: str | None = None) -> list:
    homes = [{"id": home_id, "name": ""}] if home_id else _get_homes_list(auth_data)
    scenes = []
    for home in homes:
        hid = home.get("id", home.get("home_id"))
        if not hid:
            continue
        for scene in _get_scenes_for_home(auth_data, str(hid)):
            scenes.append(_normalize_scene(scene, str(hid), home.get("name", "")))
    return scenes


def _resolve_scene_by_id(auth_data: dict, scene_id: str, home_id: str | None = None) -> dict | None:
    if home_id:
        return {"scene_id": scene_id, "home_id": home_id}

    for scene in _list_all_scenes(auth_data):
        if str(scene.get("scene_id", scene.get("id", ""))) == scene_id:
            return scene
    return None


def _resolve_scene_by_name(auth_data: dict, scene_name: str, home_id: str | None = None) -> dict:
    scenes = _list_all_scenes(auth_data, home_id)
    matches = [scene for scene in scenes if str(scene.get("name", "")).strip() == scene_name]

    if not matches:
        return {"status": "error", "error": "SCENE_NOT_FOUND", "message": f"未找到场景: {scene_name}"}

    if len(matches) > 1 and not home_id:
        return {
            "status": "error",
            "error": "SCENE_AMBIGUOUS",
            "message": f"场景名称重复，请指定 home_id: {scene_name}",
            "data": {"matches": matches},
        }

    return {"status": "success", "scene": matches[0]}


def _normalize_scene(scene: dict, home_id: str, home_name: str = "") -> dict:
    return {
        "scene_id": str(scene.get("scene_id", scene.get("id", ""))),
        "id": str(scene.get("scene_id", scene.get("id", ""))),
        "name": scene.get("name", ""),
        "home_id": str(scene.get("home_id", home_id)),
        "home_name": scene.get("home_name", home_name),
        "scene_type": scene.get("scene_type", scene.get("type", 2)),
        "enable": scene.get("enable", scene.get("enabled", True)),
        "raw": scene,
    }
