import json
import random
import string

import httpx

from mi_cli.api.auth import (
    _load_auth_data,
    _check_available,
    _request_api,
    _get_service_token,
)
from mi_cli.api.device import handle_run_action, _get_homes_list, _get_devices_list, _parse_device, _load_device_cache
from mi_cli.api.spec import handle_spec_parse as _spec_parse_internal

MINA_API_BASE = "https://api2.mina.mi.com"
NEED_USE_PLAY_MUSIC_API = {"X08C", "X08E", "X8F", "X4B", "LX05", "OH2", "OH2P", "X6A"}


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


def _request_mina_api(auth_data: dict, uri: str, data: dict) -> dict:
    service_token = auth_data.get("mina_service_token", "")
    user_id = auth_data.get("user_id", auth_data.get("userId", ""))

    if not service_token:
        token_result = _get_service_token(auth_data, "micoapi", service_token_key="mina_service_token")
        if token_result.get("code") == 0:
            service_token = auth_data.get("mina_service_token", "")
        if not service_token:
            return {
                "code": -1,
                "message": "Mina serviceToken unavailable",
                "token_result": token_result,
            }

    url = MINA_API_BASE + uri
    headers = {
        "User-Agent": "MiHome/6.0.103 (com.xiaomi.mihome; build:6.0.103.1; iOS 14.4.0) Alamofire/6.0.103 MICO/iOSApp/appStore/6.0.103",
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": f"serviceToken={service_token};userId={user_id}",
    }
    if data is None:
        separator = "&" if "?" in url else "?"
        url = f"{url}{separator}requestId={_mina_request_id()}"
        resp = httpx.get(url, headers=headers, timeout=10)
        return resp.json()

    data = {**data, "requestId": data.get("requestId") or _mina_request_id()}
    form_data = {k: json.dumps(v) if isinstance(v, (dict, list)) else str(v) for k, v in data.items()}

    resp = httpx.post(url, data=form_data, headers=headers, timeout=10)
    return resp.json()


def _require_mina_auth(auth_data: dict) -> dict | None:
    missing = [key for key in ["userId", "passToken"] if not auth_data.get(key)]
    if missing:
        return {"status": "error", "error": "AUTH_FAILED", "message": f"缺少 {', '.join(missing)}"}
    return None


def _find_mina_device(auth_data: dict, did: str) -> dict:
    mina_devices = _get_mina_devices(auth_data)
    target_did = str(did)
    for device in mina_devices:
      if not isinstance(device, dict):
          continue
      candidates = [
          device.get("miotDID"),
          device.get("miotDid"),
          device.get("miot_did"),
          device.get("did"),
      ]
      if any(str(value) == target_did for value in candidates if value is not None):
          return {"status": "success", "data": device}

    sample = [
        {
            "name": device.get("alias") or device.get("name"),
            "deviceID": device.get("deviceID"),
            "miotDID": device.get("miotDID") or device.get("miotDid") or device.get("miot_did") or device.get("did"),
            "hardware": device.get("hardware"),
        }
        for device in mina_devices[:5]
        if isinstance(device, dict)
    ]
    return {
        "status": "error",
        "error": "DEVICE_NOT_FOUND",
        "message": "未在 Mina 设备列表中找到对应小爱音箱",
        "data": {"target_did": target_did, "mina_device_count": len(mina_devices), "sample": sample},
    }


def _get_mina_devices(auth_data: dict) -> list:
    result = _request_mina_api(auth_data, "/admin/v2/device_list?master=0", None)
    return _coerce_mina_list(result.get("data", []))


def _list_mina_speakers(auth_data: dict) -> list:
    speakers = []
    for device in _get_mina_devices(auth_data):
        if not isinstance(device, dict):
            continue
        did = device.get("miotDID") or device.get("miotDid") or device.get("miot_did") or device.get("did")
        device_id = device.get("deviceID")
        hardware = device.get("hardware", "")
        name = device.get("alias") or device.get("name") or ""
        if not did or not device_id:
            continue
        speakers.append({
            "did": str(did),
            "model": hardware,
            "name": name or str(did),
            "home_id": device.get("homeID") or device.get("home_id"),
            "home_name": "",
            "room_name": "",
            "connection_type": "wifi",
            "control_path": "mina_ubus",
            "device_id": device_id,
            "hardware": hardware,
        })
    return speakers


def _speaker_play_url(auth_data: dict, device_id: str, url: str) -> dict:
    return _request_mina_api(auth_data, "/remote/ubus", {
        "deviceId": device_id,
        "method": "player_play_url",
        "path": "mediaplayer",
        "message": json.dumps({"url": url, "type": 1, "media": "app_ios"}, ensure_ascii=False),
    })


def _speaker_play_music_url(auth_data: dict, device_id: str, url: str, title: str, audio_id: str) -> dict:
    payload = {
        "url": url,
        "type": 2,
        "media": "app_ios",
        "title": title,
    }
    if audio_id:
        payload["audio_id"] = audio_id
    return _request_mina_api(auth_data, "/remote/ubus", {
        "deviceId": device_id,
        "method": "player_play_music",
        "path": "mediaplayer",
        "message": json.dumps(payload, ensure_ascii=False),
    })


def _speaker_play_operation(auth_data: dict, device_id: str, action: str) -> dict:
    return _request_mina_api(auth_data, "/remote/ubus", {
        "deviceId": device_id,
        "method": "player_play_operation",
        "path": "mediaplayer",
        "message": json.dumps({"action": action, "media": "app_ios"}, ensure_ascii=False),
    })


def _speaker_set_volume(auth_data: dict, device_id: str, volume: int) -> dict:
    return _request_mina_api(auth_data, "/remote/ubus", {
        "deviceId": device_id,
        "method": "player_set_volume",
        "path": "mediaplayer",
        "message": json.dumps({"volume": volume, "media": "app_ios"}, ensure_ascii=False),
    })


def _mina_request_id() -> str:
    suffix = "".join(random.choices(string.ascii_letters + string.digits, k=30))
    return f"app_ios_{suffix}"


def _coerce_mina_payload(value) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def _coerce_mina_list(value) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except Exception:
            return []
    return []


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
