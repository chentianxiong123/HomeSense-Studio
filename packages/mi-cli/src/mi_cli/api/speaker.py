import json

from mi_cli.api.auth import (
    _load_auth_data,
    _check_available,
    _get_service_token,
)
from mi_cli.api.device import handle_run_action, _get_homes_list, _get_devices_list, _parse_device
from mi_cli.api.speaker_mina import (
    NEED_USE_PLAY_MUSIC_API,
    _coerce_mina_list,
    _coerce_mina_payload,
    _find_mina_device,
    _list_mina_speakers,
    _request_mina_api,
    _require_mina_auth,
    _speaker_play_music_url,
    _speaker_play_operation,
    _speaker_play_url,
    _speaker_set_volume,
)
from mi_cli.api.speaker_spec import (
    _find_execute_directive_action,
    _find_message_router_action,
    _find_play_text_action,
    _get_silent_value,
    _get_speaker_spec,
)


def handle_speaker_play_url(command: dict) -> dict:
    auth_data = _load_auth_data()
    auth_error = _require_mina_auth(auth_data)
    if auth_error:
        return auth_error

    url = str(command.get("url") or "").strip()
    if not url:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "缺少 url 参数"}

    did = command.get("did")
    if not did:
        speakers = _find_speakers(auth_data)
        if not speakers:
            return {"status": "error", "error": "DEVICE_NOT_FOUND", "message": "未找到小爱音箱设备"}
        did = speakers[0]

    device_result = _find_mina_device(auth_data, str(did))
    if device_result.get("status") != "success":
        return device_result
    device = device_result["data"]
    device_id = device.get("deviceID", "")
    hardware = str(device.get("hardware") or "")
    title = str(command.get("title") or "HomeSense Media")
    audio_id = str(command.get("audio_id") or command.get("bvid") or "")

    if hardware in NEED_USE_PLAY_MUSIC_API or audio_id:
        result = _speaker_play_music_url(auth_data, device_id, url, title, audio_id)
        method = "play_music_url"
    else:
        result = _speaker_play_url(auth_data, device_id, url)
        method = "play_url"

    if isinstance(result, dict) and result.get("code") not in (0, None):
        return {
            "status": "error",
            "error": "MINA_PLAY_FAILED",
            "message": result.get("message") or "Mina play failed",
            "data": {
                "did": str(did),
                "device_id": device_id,
                "hardware": hardware,
                "method": method,
                "url": url,
                "result": result,
            },
        }

    return {
        "status": "success",
        "data": {
            "did": str(did),
            "device_id": device_id,
            "hardware": hardware,
            "method": method,
            "url": url,
            "result": result,
        },
    }


def handle_speaker_control(command: dict) -> dict:
    auth_data = _load_auth_data()
    auth_error = _require_mina_auth(auth_data)
    if auth_error:
        return auth_error

    did = command.get("did")
    if not did:
        speakers = _find_speakers(auth_data)
        if not speakers:
            return {"status": "error", "error": "DEVICE_NOT_FOUND", "message": "未找到小爱音箱设备"}
        did = speakers[0]

    action = str(command.get("control") or command.get("command") or command.get("action_name") or "").strip().lower()
    if action not in {"pause", "play", "resume", "stop", "volume"}:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "control must be pause, play, resume, stop or volume"}

    device_result = _find_mina_device(auth_data, str(did))
    if device_result.get("status") != "success":
        return device_result
    device_id = device_result["data"].get("deviceID", "")

    if action == "volume":
        volume = int(command.get("volume") or 0)
        result = _speaker_set_volume(auth_data, device_id, max(0, min(100, volume)))
    else:
        operation = "play" if action == "resume" else action
        result = _speaker_play_operation(auth_data, device_id, operation)

    if isinstance(result, dict) and result.get("code") not in (0, None):
        return {
            "status": "error",
            "error": "MINA_CONTROL_FAILED",
            "message": result.get("message") or "Mina control failed",
            "data": {
                "did": str(did),
                "device_id": device_id,
                "control": action,
                "result": result,
            },
        }

    return {
        "status": "success",
        "data": {
            "did": str(did),
            "device_id": device_id,
            "control": action,
            "result": result,
        },
    }


def handle_speaker_mina_debug(command: dict) -> dict:
    auth_data = _load_auth_data()
    auth_error = _require_mina_auth(auth_data)
    if auth_error:
        return auth_error

    token_result = {"code": 0, "message": "cached"} if auth_data.get("mina_service_token") else _get_service_token(auth_data, "micoapi", service_token_key="mina_service_token")
    has_token = bool(auth_data.get("mina_service_token"))
    raw = _request_mina_api(auth_data, "/admin/v2/device_list?master=0", None) if has_token else {}
    data = raw.get("data") if isinstance(raw, dict) else None
    devices = _coerce_mina_list(data)
    return {
        "status": "success",
        "data": {
            "token_result": token_result,
            "has_mina_service_token": has_token,
            "raw_code": raw.get("code") if isinstance(raw, dict) else None,
            "raw_message": raw.get("message") or raw.get("msg") if isinstance(raw, dict) else None,
            "data_type": type(data).__name__,
            "data_preview": data[:120] if isinstance(data, str) else None,
            "device_count": len(devices),
            "keys": list(raw.keys()) if isinstance(raw, dict) else [],
        },
    }


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
    auth_error = _require_mina_auth(auth_data)
    if auth_error:
        return auth_error

    did = command.get("did")
    if not did:
        speakers = _find_speakers(auth_data)
        if not speakers:
            return {"status": "error", "error": "DEVICE_NOT_FOUND", "message": "未找到小爱音箱设备"}
        did = speakers[0]

    try:
        device_result = _find_mina_device(auth_data, str(did))
        if device_result.get("status") != "success":
            return device_result
        device_id = device_result["data"].get("deviceID", "")
        play_data = {
            "deviceId": device_id,
            "method": "player_get_play_status",
            "path": "mediaplayer",
            "message": json.dumps({"media": "app_ios"}, ensure_ascii=False),
        }
        play_result = _request_mina_api(auth_data, "/remote/ubus", play_data)

        play_data_payload = _coerce_mina_payload(play_result.get("data", {}))
        info = _coerce_mina_payload(play_data_payload.get("info", {}))
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
    auth_error = _require_mina_auth(auth_data)
    if auth_error:
        return auth_error

    try:
        speakers = _list_mina_speakers(auth_data) or (_list_speakers(auth_data) if _check_available(auth_data) else [])
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
