import base64
import hashlib
import json
import time
from datetime import datetime
from urllib import parse

from mi_cli.api.auth_helpers import (
    API_BASE_URL,
    MI_SID,
    SERVICE_LOGIN_URL,
    _get_locale,
    _get_user_agent,
    _json_decode,
    _new_session,
)
from mi_cli.api.auth_store import _save_auth_data
from mi_cli.crypto import decrypt, encrypt_rc4, gen_nonce, get_signed_nonce


def _api_cookies(auth_data: dict) -> dict:
    loc = _get_locale()
    now = datetime.now().astimezone()
    tz_offset = now.strftime("%z")
    return {
        "userId": str(auth_data.get("userId", "")),
        "yetAnotherServiceToken": auth_data.get("serviceToken", ""),
        "serviceToken": auth_data.get("serviceToken", ""),
        "locale": loc,
        "timezone": f"GMT{tz_offset[:3]}:{tz_offset[3:]}",
        "is_daylight": str(time.daylight),
        "dst_offset": str(time.localtime().tm_isdst * 60 * 60 * 1000),
        "channel": "MI_APP_STORE",
    }


def _api_headers(auth_data: dict) -> dict:
    return {
        "X-XIAOMI-PROTOCAL-FLAG-CLI": "PROTOCAL-HTTP2",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": _get_user_agent(auth_data),
    }


def _get_location(auth_data: dict) -> dict:
    """用已有 token 尝试刷新 serviceToken — 同时更新 ssecurity"""
    return _get_service_token(auth_data, MI_SID, service_token_key="serviceToken")


def _get_service_token(auth_data: dict, sid: str, service_token_key: str = "serviceToken") -> dict:
    """Use passToken/userId to refresh a service-specific serviceToken."""
    if not auth_data.get("passToken") or not auth_data.get("userId"):
        return {"code": -1, "message": "缺少 passToken/userId"}

    session = _new_session()
    session.cookies.update({
        "sdkVersion": "3.8.6",
        "deviceId": auth_data.get("deviceId", ""),
        "pass_o": auth_data.get("pass_o", ""),
        "passToken": auth_data.get("passToken", ""),
        "userId": str(auth_data.get("userId", "")),
        "cUserId": auth_data.get("cUserId", ""),
        "uLocale": _get_locale(),
    })
    session.headers.update({"User-Agent": _get_user_agent(auth_data)})

    resp = session.get(
        SERVICE_LOGIN_URL,
        params={"sid": sid, "_json": "true"},
    )
    service_data = _json_decode(resp.text)
    # 更新 ssecurity — 即使 location 后续失败也要更新
    if service_data.get("code") == 0:
        if service_data.get("ssecurity"):
            auth_data["ssecurity"] = service_data["ssecurity"]
        if service_data.get("passToken"):
            auth_data["passToken"] = service_data["passToken"]
    location = service_data.get("location", "")
    if location and sid != "mijia" and "clientSign=" not in location:
        nonce = service_data.get("nonce")
        ssecurity = service_data.get("ssecurity") or auth_data.get("ssecurity", "")
        if nonce and ssecurity:
            sign = hashlib.sha1(f"nonce={nonce}&{ssecurity}".encode()).digest()
            client_sign = base64.b64encode(sign).decode()
            location += "&clientSign=" + parse.quote(client_sign)
    if service_data.get("code") == 0 and location:
        resp2 = session.get(location)
        cookies = resp2.cookies.get_dict()
        if resp2.status_code == 200 and cookies.get("serviceToken"):
            if service_token_key == "serviceToken":
                auth_data.update(cookies)
            elif cookies.get("serviceToken"):
                auth_data[service_token_key] = cookies["serviceToken"]
            _save_auth_data(auth_data)
            return {"code": 0, "message": "刷新Token成功"}
        _save_auth_data(auth_data)
        return {
            "code": -1,
            "message": "刷新Token失败",
            "sid": sid,
            "service_code": service_data.get("code"),
            "service_desc": service_data.get("desc") or service_data.get("description") or service_data.get("message"),
            "has_location": bool(location),
            "location_status": resp2.status_code,
            "location_text": (resp2.text or "")[:80],
            "cookie_keys": sorted(resp2.cookies.get_dict().keys()),
        }
    # 即使 location 失败，ssecurity 也已经更新了
    _save_auth_data(auth_data)
    return {
        "code": -1,
        "message": "刷新Token失败（但 ssecurity 已更新）",
        "sid": sid,
        "service_code": service_data.get("code"),
        "service_desc": service_data.get("desc") or service_data.get("description") or service_data.get("message"),
        "has_location": bool(location),
    }


def _check_available(auth_data: dict) -> bool:
    if not auth_data:
        return False
    required = ["ssecurity", "userId", "cUserId", "serviceToken"]
    if any(k not in auth_data for k in required):
        return False
    try:
        _probe_api(auth_data)
        return True
    except Exception:
        return False


def _check_available_debug(auth_data: dict) -> tuple[bool, str]:
    if not auth_data:
        return False, "auth.json empty"
    required = ["ssecurity", "userId", "cUserId", "serviceToken"]
    missing = [key for key in required if not auth_data.get(key)]
    if missing:
        return False, f"missing fields: {', '.join(missing)}"
    try:
        _probe_api(auth_data)
        return True, "ok"
    except Exception as e:
        return False, str(e)


def _check_local_auth_cache(auth_data: dict) -> tuple[bool, str]:
    if not auth_data:
        return False, "auth.json empty"
    required = ["ssecurity", "userId", "cUserId", "serviceToken"]
    missing = [key for key in required if not auth_data.get(key)]
    if missing:
        return False, f"missing fields: {', '.join(missing)}"
    expire_time = int(auth_data.get("expireTime") or 0)
    if expire_time <= 0:
        return True, "local_cache_legacy"
    if expire_time <= int(time.time() * 1000):
        return False, "expired"
    return True, "local_cache"


def _probe_api(auth_data: dict) -> None:
    """轻量探测 API 可用性，不做 token 刷新"""
    _request_api(
        auth_data,
        "/v2/homeroom/gethome_merged",
        {
            "fg": True,
            "fetch_share": True,
            "fetch_share_dev": True,
            "fetch_cariot": True,
            "limit": 50,
            "app_ver": 7,
            "plat_form": 0,
        },
        refresh_token=False,
    )


def _sha1_sign(method: str, url: str, params: dict, signed_nonce: str) -> str:
    """匹配 hass-xiaomi-miot 的 sha1_sign — 从完整 URL 解析 path，strip /app/"""
    path = parse.urlparse(url).path
    if path[:5] == "/app/":
        path = path[4:]
    arr = [method.upper(), path]
    for k, v in params.items():
        arr.append(f"{k}={v}")
    arr.append(signed_nonce)
    sig = hashlib.sha1("&".join(arr).encode("utf-8")).digest()
    return base64.b64encode(sig).decode()


def _request_api(auth_data: dict, uri: str, data: dict, refresh_token: bool = True) -> dict:
    """小米云 API 请求 — 完全对照 hass-xiaomi-miot 的 rc4_params + async_request_rc4_api"""
    if refresh_token:
        loc_result = _get_location(auth_data)
        if loc_result.get("code") == 0:
            _save_auth_data(auth_data)

    url = API_BASE_URL + uri
    params = {"data": json.dumps(data, separators=(",", ":"))}
    nonce = gen_nonce()
    signed_nonce = get_signed_nonce(auth_data["ssecurity"], nonce)

    # Step 1: rc4_hash__ = sha1_sign of the ORIGINAL (unencrypted) params
    params["rc4_hash__"] = _sha1_sign("POST", url, params, signed_nonce)

    # Step 2: RC4 encrypt ALL params
    for k in list(params.keys()):
        params[k] = encrypt_rc4(signed_nonce, str(params[k]))

    # Step 3: signature = sha1_sign of the ENCRYPTED params
    params["signature"] = _sha1_sign("POST", url, params, signed_nonce)
    params["ssecurity"] = auth_data["ssecurity"]
    params["_nonce"] = nonce

    session = _new_session()
    session.headers.update(_api_headers(auth_data))
    session.cookies.update(_api_cookies(auth_data))
    session.headers.update({
        "Accept-Encoding": "identity",
        "MIOT-ENCRYPT-ALGORITHM": "ENCRYPT-RC4",
    })

    resp = session.post(url, data=params, timeout=30)

    if resp.status_code == 401:
        raise Exception("AUTH_FAILED: HTTP 401")

    # 响应可能是 RC4 加密的，也可能是明文
    try:
        ret_data = json.loads(resp.text)
    except json.JSONDecodeError:
        try:
            dec_data = decrypt(auth_data["ssecurity"], nonce, resp.text)
            ret_data = json.loads(dec_data)
        except Exception:
            raise Exception(f"Invalid JSON response: {resp.text[:200]}")

    if ret_data.get("code", 0) not in (0, None) or "result" not in ret_data:
        raise Exception(f"API error: code={ret_data.get('code')}, message={ret_data.get('message', ret_data.get('desc', ''))}")
    return ret_data["result"]
