import json
import random
import string

import httpx

from mi_cli.api.auth import _get_service_token


MINA_API_BASE = "https://api2.mina.mi.com"
NEED_USE_PLAY_MUSIC_API = {"X08C", "X08E", "X8F", "X4B", "LX05", "OH2", "OH2P", "X6A"}


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
