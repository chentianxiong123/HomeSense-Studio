import json

import httpx

from mi_cli.api.auth import (
    _load_auth_data,
    _check_available,
    _request_api,
)
from mi_cli.api.device import handle_run_action, _get_homes_list, _get_devices_list, _parse_device, _load_device_cache
from mi_cli.api.spec import handle_spec_parse as _spec_parse_internal

MINA_API_BASE = "https://api2.mina.mi.com"


def handle_speaker_play(command: dict) -> dict:
    auth_data = _load_auth_data()
    if not _check_available(auth_data):
        return {"status": "error", "error": "AUTH_FAILED", "message": "未登录"}

    text = command.get("text", "")
    if not text:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "缺少 text 参数"}

    did = command.get("did")
    if not did:
        speakers = _find_speakers(auth_data)
        if not speakers:
            return {"status": "error", "error": "DEVICE_NOT_FOUND", "message": "未找到小爱音箱设备"}
        did = speakers[0]

    spec_result = _get_speaker_spec(auth_data, did)
    if not spec_result:
        return {"status": "error", "error": "SPEC_NOT_FOUND", "message": f"无法获取设备 {did} 的规格"}

    siid, aiid = _find_play_text_action(spec_result)
    if siid is None:
        siid, aiid = _find_message_router_action(spec_result)
        if siid is None:
            return {"status": "error", "error": "ACTION_NOT_FOUND", "message": "设备不支持语音播报"}
        text = f"跟我说 {text}"

    action_cmd = {
        "action": "run_action",
        "did": did,
        "siid": siid,
        "aiid": aiid,
        "params": [text],
    }
    return handle_run_action(action_cmd)


def handle_speaker_execute(command: dict) -> dict:
    auth_data = _load_auth_data()
    if not _check_available(auth_data):
        return {"status": "error", "error": "AUTH_FAILED", "message": "未登录"}

    text = command.get("text", "")
    if not text:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "缺少 text 参数"}

    silent = command.get("silent", False)
    did = command.get("did")
    if not did:
        speakers = _find_speakers(auth_data)
        if not speakers:
            return {"status": "error", "error": "DEVICE_NOT_FOUND", "message": "未找到小爱音箱设备"}
        did = speakers[0]

    spec_result = _get_speaker_spec(auth_data, did)
    if not spec_result:
        return {"status": "error", "error": "SPEC_NOT_FOUND", "message": f"无法获取设备 {did} 的规格"}

    siid, aiid = _find_execute_directive_action(spec_result)
    if siid is None:
        siid, aiid = _find_message_router_action(spec_result)
        if siid is None:
            return {"status": "error", "error": "ACTION_NOT_FOUND", "message": "设备不支持语音指令执行"}
        prefix = "" if silent else "跟我说 "
        text = f"{prefix}{text}"
        action_cmd = {
            "action": "run_action",
            "did": did,
            "siid": siid,
            "aiid": aiid,
            "params": [text],
        }
        return handle_run_action(action_cmd)

    silent_value = _get_silent_value(spec_result, siid, silent)

    action_cmd = {
        "action": "run_action",
        "did": did,
        "siid": siid,
        "aiid": aiid,
        "params": [text, silent_value],
    }
    return handle_run_action(action_cmd)


def handle_speaker_status(command: dict) -> dict:
    auth_data = _load_auth_data()
    if not _check_available(auth_data):
        return {"status": "error", "error": "AUTH_FAILED", "message": "未登录"}

    did = command.get("did")
    if not did:
        speakers = _find_speakers(auth_data)
        if not speakers:
            return {"status": "error", "error": "DEVICE_NOT_FOUND", "message": "未找到小爱音箱设备"}
        did = speakers[0]

    try:
        device_list_data = {"master": 0, "requestId": "app_ios_1"}
        result = _request_mina_api(auth_data, "/admin/v2/device_list", device_list_data)

        xiaoai_device = None
        for device in result.get("data", []):
            if device.get("miotDID") == did or device.get("miotDID") == str(did):
                xiaoai_device = device
                break

        if not xiaoai_device:
            return {"status": "error", "error": "DEVICE_NOT_FOUND", "message": "未找到小爱音箱设备"}

        device_id = xiaoai_device.get("deviceID", "")
        play_data = {
            "deviceId": device_id,
            "method": "mediaplayer.player_get_play_status",
            "message": '{"play_type":1}',
            "requestId": "app_ios_1",
        }
        play_result = _request_mina_api(auth_data, "/remote/ubus", play_data)

        info = play_result.get("data", {}).get("info", {})
        status_map = {0: "idle", 1: "playing", 2: "paused"}
        media_type_map = {3: "music", 13: "video"}
        loop_map = {0: "one", 1: "all", 3: "off"}

        return {
            "status": "success",
            "data": {
                "state": status_map.get(info.get("status", 0), "idle"),
                "media_type": media_type_map.get(info.get("media_type", 0)),
                "media_title": info.get("title", ""),
                "media_artist": info.get("artist", ""),
                "media_album": info.get("album", ""),
                "media_image_url": info.get("img", ""),
                "media_duration": info.get("duration", 0),
                "media_position": info.get("position", 0),
                "volume": round(info.get("volume", 0) * 100),
                "repeat_mode": loop_map.get(info.get("loop_type", 3), "off"),
            },
        }
    except Exception as e:
        return {"status": "error", "error": "API_ERROR", "message": str(e)}


def handle_speaker_list(command: dict) -> dict:
    auth_data = _load_auth_data()
    if not _check_available(auth_data):
        return {"status": "error", "error": "AUTH_FAILED", "message": "未登录"}

    try:
        speakers = _list_speakers(auth_data)
        return {
            "status": "success",
            "data": {
                "speakers": speakers,
                "count": len(speakers),
                "experimental_status_api": "speaker_status uses Mina and is not required by V1 control path",
            },
        }
    except Exception as e:
        return {"status": "error", "error": "NETWORK_TIMEOUT", "message": f"获取小爱音箱列表失败: {e}"}


def _request_mina_api(auth_data: dict, uri: str, data: dict) -> dict:
    service_token = auth_data.get("mina_service_token", "")
    user_id = auth_data.get("user_id", auth_data.get("userId", ""))

    if not service_token:
        service_token = _get_mina_service_token(auth_data)
        if service_token:
            auth_data["mina_service_token"] = service_token

    url = MINA_API_BASE + uri
    headers = {
        "User-Agent": "MiHome/6.0",
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": f"serviceToken={service_token};userId={user_id}",
    }
    form_data = {k: json.dumps(v) if isinstance(v, (dict, list)) else str(v) for k, v in data.items()}

    resp = httpx.post(url, data=form_data, headers=headers, timeout=10)
    return resp.json()


def _get_mina_service_token(auth_data: dict) -> str:
    try:
        import hashlib
        sign = hashlib.md5(f"micoapi{auth_data.get('userId', '')}".encode()).hexdigest()
        return auth_data.get("serviceToken", auth_data.get("token", ""))
    except Exception:
        return ""


def _find_speakers(auth_data: dict) -> list:
    return [speaker["did"] for speaker in _list_speakers(auth_data) if speaker.get("did")]


def _list_speakers(auth_data: dict) -> list:
    try:
        speakers = []
        homes = _get_homes_list(auth_data)
        for home in homes:
            home_id = home.get("id", home.get("home_id"))
            if not home_id:
                continue
            for raw_device in _get_devices_list(auth_data, home_id):
                device = _parse_device(raw_device, home)
                if _is_xiaoai_device(device):
                    speakers.append({
                        "did": device.get("did", ""),
                        "model": device.get("model", ""),
                        "name": device.get("name", ""),
                        "home_id": device.get("home_id"),
                        "home_name": device.get("home_name", ""),
                        "room_name": device.get("room_name", ""),
                        "connection_type": device.get("connection_type", "wifi"),
                        "control_path": "miot_action",
                    })
        return speakers
    except Exception:
        return []


def _is_xiaoai_device(device: dict) -> bool:
    name = str(device.get("name", "")).lower()
    model = str(device.get("model", "")).lower()
    speaker_markers = [
        "小爱",
        "xiaoai",
        "wifispeaker",
        "intelligent-speaker",
        "speaker",
        "l09",
        "l06",
        "s12",
        "lx04",
        "lx05a",
        "lx06",
    ]
    return any(marker in name or marker in model for marker in speaker_markers)


def _get_speaker_spec(auth_data: dict, did: str) -> dict | None:
    try:
        model = None
        cache = _load_device_cache()
        for dev in cache.get("devices", []):
            if dev.get("did") == did:
                model = dev.get("model")
                break
        if not model:
            return None
        r = _spec_parse_internal({"model": model})
        if r.get("status") != "success":
            return None
        return r.get("data")
    except Exception:
        return None


def _find_play_text_action(spec: dict) -> tuple:
    services = spec.get("services", []) if isinstance(spec, dict) else []
    for svc in services:
        sname = _canonical_name(svc.get("name", ""))
        siid = svc.get("iid", svc.get("siid", 0))
        for action in svc.get("actions", []):
            aname = _canonical_name(action.get("name", ""))
            if "play_text" in aname or "playtext" in aname:
                aiid = action.get("iid", action.get("aiid", 0))
                return siid, aiid
        if "intelligent_speaker" in sname:
            continue
    return None, None


def _find_execute_directive_action(spec: dict) -> tuple:
    services = spec.get("services", []) if isinstance(spec, dict) else []
    for svc in services:
        sname = _canonical_name(svc.get("name", ""))
        siid = svc.get("iid", svc.get("siid", 0))
        for action in svc.get("actions", []):
            aname = _canonical_name(action.get("name", ""))
            if "execute_text_directive" in aname or "execute_directive" in aname:
                aiid = action.get("iid", action.get("aiid", 0))
                return siid, aiid
        if "intelligent_speaker" in sname:
            continue
    return None, None


def _find_message_router_action(spec: dict) -> tuple:
    services = spec.get("services", []) if isinstance(spec, dict) else []
    for svc in services:
        sname = _canonical_name(svc.get("name", ""))
        siid = svc.get("iid", svc.get("siid", 0))
        if "message_router" in sname:
            for action in svc.get("actions", []):
                aname = _canonical_name(action.get("name", ""))
                if "post" in aname:
                    aiid = action.get("iid", action.get("aiid", 0))
                    return siid, aiid
    return None, None


def _get_silent_value(spec: dict, siid: int, silent: bool) -> str:
    services = spec.get("services", []) if isinstance(spec, dict) else []
    for svc in services:
        if svc.get("iid", svc.get("siid", 0)) == siid:
            for prop in svc.get("properties", []):
                pname = prop.get("name", "").lower()
                if "silent" in pname:
                    if prop.get("format") == "str" or "value-list" in str(prop.get("format", "")):
                        return "On" if silent else "Off"
                    else:
                        return 1 if silent else 0
    return 1 if silent else 0


def _canonical_name(value: str) -> str:
    return str(value).lower().replace("-", "_").replace(" ", "_")
