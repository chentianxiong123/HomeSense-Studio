import base64
import hashlib
import os
import random
import time
from datetime import datetime, timedelta
from urllib import parse

import requests
from mi_cli.api.auth_api import (
    _check_available,
    _check_available_debug,
    _check_local_auth_cache,
    _get_location,
    _get_service_token,
    _request_api,
)
from mi_cli.api.auth_helpers import (
    ACCOUNT_BASE,
    API_BASE_URL,
    MI_SID,
    SERVICE_LOGIN_URL,
    SIGN_URL,
    _gen_device_id,
    _get_locale,
    _get_user_agent,
    _json_decode,
    _new_session,
)
from mi_cli.api.auth_qr import generate_qr_code, check_login_status, reset_qr_state as qr_reset
from mi_cli.api.auth_store import (
    AUTH_DIR,
    AUTH_FILE,
    QR_STATE_FILE,
    _clear_qr_state,
    _ensure_dir,
    _load_auth_data,
    _load_qr_state,
    _save_auth_data,
    _save_qr_state,
)


def _auth_fields_present(auth_data: dict) -> dict:
    fields = ["ssecurity", "userId", "cUserId", "serviceToken"]
    return {field: bool(auth_data.get(field)) for field in fields}


def _login_state(
    *,
    auth_data: dict | None = None,
    logged_in: bool,
    token_valid: bool,
    message: str = "",
    extra: dict | None = None,
) -> dict:
    state = {
        "logged_in": logged_in,
        "token_valid": token_valid,
        "has_saved_login": bool(auth_data),
        "user_id": (auth_data or {}).get("userId", ""),
        "auth_fields_present": _auth_fields_present(auth_data or {}),
        "message": message,
    }
    if extra:
        state.update(extra)
    return state


def _account_request(
    session: requests.Session,
    url: str,
    *,
    method: str = "GET",
    params: dict | None = None,
    data: dict | None = None,
    cookies: dict | None = None,
):
    if not url.startswith("http"):
        url = f"{ACCOUNT_BASE}{url}"
    merged_cookies = cookies or {}
    if method.upper() == "POST":
        return session.post(url, params=params, data=data, cookies=merged_cookies, timeout=30)
    return session.get(url, params=params, cookies=merged_cookies, timeout=30)


def _check_identity_list(session: requests.Session, verify_url: str) -> tuple[list[int], str]:
    path = "fe/service/identity/authStart"
    if path not in verify_url:
        return [], ""
    resp = _account_request(session, verify_url.replace(path, "identity/list"))
    identity_session = resp.cookies.get("identity_session", "")
    if not identity_session:
        return [], ""
    data = _json_decode(resp.text)
    flag = data.get("flag", 4)
    options = data.get("options", [flag])
    return options, identity_session


def _verify_identity_ticket(
    session: requests.Session,
    *,
    ticket: str,
    verify_url: str,
) -> dict:
    options, identity_session = _check_identity_list(session, verify_url)
    if not options or not identity_session:
        return {}
    for flag in options:
        api = {
            4: "/identity/auth/verifyPhone",
            8: "/identity/auth/verifyEmail",
        }.get(flag)
        if not api:
            continue
        resp = _account_request(
            session,
            api,
            method="POST",
            params={"_dc": int(time.time() * 1000)},
            data={
                "_flag": flag,
                "ticket": ticket,
                "trust": "true",
                "_json": "true",
            },
            cookies={"identity_session": identity_session},
        )
        data = _json_decode(resp.text)
        if data.get("code") == 0:
            return data
    return {}


def _hash_password(password: str) -> str:
    return hashlib.md5(password.encode()).hexdigest().upper()


def handle_login_password(command: dict) -> dict:
    """账号密码登录 — 完全照搬 hass-xiaomi-miot 的三步登录流程"""
    username = command.get("username", "")
    password = command.get("password", "")
    if not username or not password:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "需要 username 和 password"}

    auth_data = _load_auth_data()
    if _check_available(auth_data):
        return {"status": "success", "data": _login_state(
            auth_data=auth_data, logged_in=True, token_valid=True, message="已登录，无需重复登录",
        )}

    if "deviceId" not in auth_data:
        auth_data["deviceId"] = _gen_device_id(auth_data)
    if "ua" not in auth_data:
        auth_data["ua"] = _get_user_agent(auth_data)
    if "pass_o" not in auth_data:
        auth_data["pass_o"] = "".join(random.choices("0123456789abcdef", k=16))

    device_id = auth_data["deviceId"]
    user_agent = auth_data["ua"]

    session = _new_session()
    session.cookies.update({
        "sdkVersion": "3.8.6",
        "deviceId": device_id,
    })
    session.headers.update({"User-Agent": user_agent})

    try:
        resp = session.get(
            SERVICE_LOGIN_URL,
            params={"sid": MI_SID, "_json": "true"},
        )
        auth_info = _json_decode(resp.text)
    except Exception as e:
        return {"status": "error", "error": "NETWORK_ERROR", "message": f"获取登录参数失败: {e}"}

    if auth_info.get("code") == 0 and auth_info.get("location"):
        auth_data["userId"] = auth_info.get("userId", "")
        auth_data["cUserId"] = auth_info.get("cUserId", "")
        auth_data["ssecurity"] = auth_info.get("ssecurity") or auth_data.get("ssecurity", "")
        auth_data["passToken"] = auth_info.get("passToken") or auth_data.get("passToken", "")
        resp2 = session.get(auth_info["location"])
        cookies = resp2.cookies.get_dict()
        if "serviceToken" in cookies:
            auth_data.update(cookies)
            auth_data["expireTime"] = int((datetime.now() + timedelta(days=30)).timestamp() * 1000)
            _save_auth_data(auth_data)
            return {"status": "success", "data": _login_state(
                auth_data=auth_data, logged_in=True, token_valid=True, message="登录成功(已有有效token)",
            )}

    sign = auth_info.get("_sign", "")
    qs = parse.parse_qs(parse.urlparse(auth_info.get("qs", "")).query)
    if not sign and qs:
        sign = qs.get("_sign", [""])[0]

    callback = auth_info.get("callback", "")
    qs_raw = auth_info.get("qs", "")

    if not sign:
        return {"status": "error", "error": "LOGIN_FAILED", "message": "获取 _sign 失败"}

    try:
        resp = session.post(
            SIGN_URL,
            data={
                "sid": MI_SID,
                "hash": _hash_password(password),
                "callback": callback,
                "qs": qs_raw,
                "user": username,
                "_sign": sign,
                "_json": "true",
            },
        )
        sign_result = _json_decode(resp.text)
    except Exception as e:
        return {"status": "error", "error": "NETWORK_ERROR", "message": f"提交登录失败: {e}"}

    if sign_result.get("code") == 20029:
        return {"status": "error", "error": "PASSWORD_ERROR", "message": "密码错误"}

    if sign_result.get("code") != 0:
        return {"status": "error", "error": "LOGIN_FAILED", "message": f"登录失败: code={sign_result.get('code')}, desc={sign_result.get('desc', '')}"}

    result_url = sign_result.get("location", "")
    if not result_url and sign_result.get("_sign"):
        callback = sign_result.get("callback")
        result_url = f"{callback}?clientSign={parse.quote(sign_result.get('_sign'))}"
    elif result_url and MI_SID != "mijia":
        nonce = sign_result.get("nonce")
        ssecurity = sign_result.get("ssecurity") or auth_data.get("ssecurity", "")
        if nonce and ssecurity and "clientSign=" not in result_url:
            sign = f"nonce={nonce}&{ssecurity}"
            sign = hashlib.sha1(sign.encode()).digest()
            client_sign = base64.b64encode(sign).decode()
            result_url += "&clientSign=" + parse.quote(client_sign)

    if result_url:
        try:
            resp = session.get(result_url)
            cookies = resp.cookies.get_dict()
            if "serviceToken" in cookies:
                auth_data["userId"] = sign_result.get("userId", cookies.get("userId", ""))
                auth_data["cUserId"] = sign_result.get("cUserId", cookies.get("cUserId", ""))
                auth_data["ssecurity"] = sign_result.get("ssecurity") or auth_data.get("ssecurity", "")
                auth_data["passToken"] = sign_result.get("passToken") or auth_data.get("passToken", "")
                auth_data.update(cookies)
                auth_data["expireTime"] = int((datetime.now() + timedelta(days=30)).timestamp() * 1000)
                _save_auth_data(auth_data)
                return {"status": "success", "data": _login_state(
                    auth_data=auth_data, logged_in=True, token_valid=True, message="登录成功",
                )}
        except Exception as e:
            return {"status": "error", "error": "LOGIN_FAILED", "message": f"获取 serviceToken 失败: {e}"}

    if sign_result.get("notificationUrl"):
        auth_data["verify_url"] = sign_result.get("notificationUrl")
        auth_data["userId"] = sign_result.get("userId", auth_data.get("userId", ""))
        auth_data["cUserId"] = sign_result.get("cUserId", auth_data.get("cUserId", ""))
        auth_data["ssecurity"] = sign_result.get("ssecurity") or auth_data.get("ssecurity", "")
        auth_data["passToken"] = sign_result.get("passToken") or auth_data.get("passToken", "")
        _save_auth_data(auth_data)
        return {
            "status": "success",
            "data": _login_state(
                auth_data=auth_data,
                logged_in=False,
                token_valid=False,
                message="需要身份验证",
                extra={"verify_url": sign_result.get("notificationUrl"), "need_verify": True},
            ),
        }

    return {"status": "error", "error": "LOGIN_FAILED", "message": "登录失败，未知原因"}


def handle_verify_ticket(command: dict) -> dict:
    """提交验证码"""
    ticket = command.get("ticket", "")
    if not ticket:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "需要 ticket"}

    auth_data = _load_auth_data()
    verify_url = auth_data.get("verify_url", "")
    if not verify_url:
        return {"status": "error", "error": "NO_VERIFY_NEEDED", "message": "不需要验证"}

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

    try:
        verify_result = _verify_identity_ticket(
            session,
            ticket=ticket,
            verify_url=verify_url,
        )
    except Exception as e:
        return {"status": "error", "error": "VERIFY_FAILED", "message": f"验证请求失败: {e}"}

    if verify_result.get("code") == 20029:
        return {"status": "error", "error": "TICKET_INVALID", "message": "验证码错误"}

    if not verify_result:
        return {"status": "error", "error": "VERIFY_FAILED", "message": "验证码验证未通过或未获取 identity_session"}

    if verify_result.get("code") != 0:
        return {"status": "error", "error": "VERIFY_FAILED", "message": f"验证失败: code={verify_result.get('code')}"}

    location = verify_result.get("location", "")
    if not location:
        return {"status": "error", "error": "VERIFY_FAILED", "message": "验证成功但没有跳转地址"}

    try:
        resp2 = session.get(location)
        cookies = resp2.cookies.get_dict()
        if "serviceToken" in cookies:
            auth_data["serviceToken"] = cookies["serviceToken"]
            auth_data["userId"] = cookies.get("userId", auth_data["userId"])
            auth_data["cUserId"] = cookies.get("cUserId", auth_data["cUserId"])
        else:
            auth_data["serviceToken"] = resp2.text if len(resp2.text or "") > 10 else ""
    except Exception as e:
        pass

    if not auth_data.get("serviceToken"):
        try:
            resp_sl = session.get(
                SERVICE_LOGIN_URL,
                params={"sid": MI_SID, "_json": "true"},
            )
            sl_data = _json_decode(resp_sl.text)
            if sl_data.get("code") == 0 and sl_data.get("location"):
                auth_data["ssecurity"] = sl_data.get("ssecurity") or auth_data.get("ssecurity", "")
                resp_loc = session.get(sl_data["location"])
                new_cookies = resp_loc.cookies.get_dict()
                if "serviceToken" in new_cookies:
                    auth_data.update(new_cookies)
        except Exception:
            pass

    if not auth_data.get("serviceToken"):
        return {"status": "error", "error": "VERIFY_FAILED", "message": "验证通过后未能获取 serviceToken"}

    auth_data.pop("verify_url", None)
    auth_data["expireTime"] = int((datetime.now() + timedelta(days=30)).timestamp() * 1000)
    _save_auth_data(auth_data)
    return {
        "status": "success",
        "data": _login_state(
            auth_data=auth_data,
            logged_in=True,
            token_valid=True,
            message="身份验证完成并登录成功",
        ),
    }


def handle_login_qr(command: dict) -> dict:
    try:
        result = generate_qr_code()
        return {
            "status": "success",
            "data": {
                "qr_url": result.get("qr_url", ""),
                "qr_image": result.get("qr_image", ""),
                "status_url": result.get("status_url", ""),
                "polling": True,
                "message": result.get("message", "请使用米家 APP 扫描二维码"),
            },
        }
    except Exception as e:
        return {"status": "error", "error": "QR_INIT_FAILED", "message": str(e)}


def handle_login_qr_status(command: dict) -> dict:
    try:
        result = check_login_status()
        if result.get("status") == "success":
            # QR 登录拿到的是 sid=mijia 的 serviceToken
            # 用 passToken 去换 xiaomiio 的 serviceToken
            auth_data = _load_auth_data()
            _get_location(auth_data)
            return {
                "status": "success",
                "data": {
                    "status": "success",
                    "message": result.get("message", "登录成功"),
                    "user_id": result.get("user_id", ""),
                    "logged_in": True,
                    "token_valid": True,
                },
            }
        return {
            "status": "success",
            "data": {
                "status": result.get("status", "pending"),
                "message": result.get("message", "等待扫码..."),
                "user_id": result.get("user_id", ""),
                "logged_in": False,
                "token_valid": False,
            },
        }
    except Exception as e:
        return {"status": "error", "error": "QR_POLL_FAILED", "message": str(e)}


def handle_login_qr_reset(command: dict) -> dict:
    qr_reset()
    return {
        "status": "success",
        "data": {
            "message": "已重置扫码状态",
        },
    }


def handle_prepare_login(command: dict) -> dict:
    return handle_login_password(command)


def handle_login_status(command: dict) -> dict:
    auth_data = _load_auth_data()
    force_refresh = bool(command.get("refresh") or command.get("probe"))
    local_available, local_reason = _check_local_auth_cache(auth_data)
    if local_available and not force_refresh:
        return {"status": "success", "data": _login_state(
            auth_data=auth_data,
            logged_in=True,
            token_valid=True,
            message="已登录",
            extra={"source": local_reason, "expire_time": auth_data.get("expireTime")},
        )}

    # 本地缓存失效或显式刷新时，才用 passToken 刷新 xiaomiio 的 serviceToken。
    if auth_data.get("passToken") and auth_data.get("userId"):
        _get_location(auth_data)
        auth_data = _load_auth_data()  # 重新读（_get_location 可能写了新 token）

    available, reason = _check_available_debug(auth_data)
    if available:
        return {"status": "success", "data": _login_state(
            auth_data=auth_data, logged_in=True, token_valid=True, message="已登录",
        )}
    has_partial = bool(auth_data) and bool(auth_data.get("userId"))
    return {"status": "success", "data": _login_state(
        auth_data=auth_data,
        logged_in=False,
        token_valid=False,
        message=f"Token已过期: {reason}" if has_partial else "未登录",
    )}


def handle_login_logout(command: dict) -> dict:
    if os.path.exists(AUTH_FILE):
        os.remove(AUTH_FILE)
    return {"status": "success", "data": _login_state(
        auth_data={}, logged_in=False, token_valid=False, message="已退出登录",
    )}
