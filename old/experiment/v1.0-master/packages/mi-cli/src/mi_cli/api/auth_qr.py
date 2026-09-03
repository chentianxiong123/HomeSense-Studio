"""小米账号二维码登录模块 — 逐行对齐 bilibili-music 参考实现

核心设计：
- mi-cli 是子进程调用模式（每次 action = 新进程），全局变量无法跨进程存活
- generate_qr_code() 将 lp_url/headers/device_id 写入 QR_STATE_FILE
- check_login_status() 每次从文件恢复状态，自己做 LP 轮询请求
- 认证结果写 auth.json
"""

import base64
import json
import os
import random
import time
from datetime import datetime, timedelta
from io import BytesIO
from urllib import parse

import qrcode
import requests


AUTH_DIR = os.environ.get("MI_CLI_CONFIG_DIR", os.path.expanduser("~/.cache/mi-cli"))
AUTH_FILE = os.path.join(AUTH_DIR, "auth.json")
QR_STATE_FILE = os.path.join(AUTH_DIR, "qr_state.json")


def _json_decode(text: str) -> dict:
    return json.loads(text.replace("&&&START&&&", ""))


def _ensure_dir():
    os.makedirs(AUTH_DIR, exist_ok=True)


def _load_auth_data() -> dict:
    _ensure_dir()
    if os.path.exists(AUTH_FILE):
        try:
            with open(AUTH_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_auth_data(data: dict):
    _ensure_dir()
    data["saveTime"] = int(time.time() * 1000)
    with open(AUTH_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _load_qr_state() -> dict:
    if os.path.exists(QR_STATE_FILE):
        try:
            with open(QR_STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_qr_state(data: dict):
    _ensure_dir()
    with open(QR_STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _clear_qr_state():
    if os.path.exists(QR_STATE_FILE):
        os.remove(QR_STATE_FILE)


def _generate_device_id() -> str:
    chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-"
    return "".join(random.choices(chars, k=16))


def _generate_user_agent() -> str:
    ua_id1 = "".join(random.choices("0123456789ABCDEF", k=40))
    ua_id2 = "".join(random.choices("0123456789ABCDEF", k=32))
    ua_id3 = "".join(random.choices("0123456789ABCDEF", k=32))
    ua_id4 = "".join(random.choices("0123456789ABCDEF", k=40))
    return (
        f"Android-15-11.0.701-Xiaomi-23046RP50C-OS2.0.212.0.VMYCNXM-"
        f"{ua_id1}-CN-"
        f"{ua_id3}-{ua_id2}-SmartHome-MI_APP_STORE-{ua_id1}|{ua_id4}|test-64"
    )


def generate_qr_code() -> dict:
    """生成二维码 — 逐行对齐 bilibili-music qrcode_login.py

    Returns:
        dict: { success, message, qr_url, qr_image, status_url }
    """
    auth_data = _load_auth_data()

    session = requests.Session()
    session.trust_env = False

    # Step 1: 获取登录链接参数
    service_login_url = (
        f"https://account.xiaomi.com/pass/serviceLogin?_json=true"
        f"&sid=mijia&_locale=zh_CN"
    )

    headers = {
        "User-Agent": _generate_user_agent(),
        "Connection": "keep-alive",
        "Accept-Encoding": "gzip",
        "Content-Type": "application/x-www-form-urlencoded",
    }

    device_id = auth_data.get("deviceId", _generate_device_id())

    if auth_data.get("passToken"):
        headers["Cookie"] = (
            f"deviceId={device_id}; "
            f"passToken={auth_data['passToken']}; "
            f"userId={auth_data.get('userId', '')}"
        )

    resp = session.get(service_login_url, headers=headers, timeout=30)
    service_data = _json_decode(resp.text)

    # 如果 Token 有效，直接返回成功
    if service_data.get("code") == 0:
        location = service_data.get("location", "")
        if location:
            resp2 = session.get(location, headers=headers, timeout=30)
            if resp2.status_code == 200 and resp2.text == "ok":
                cookies = resp2.cookies.get_dict()
                auth_data.update(cookies)
                auth_data["ssecurity"] = service_data.get("ssecurity", "")
                auth_data["deviceId"] = device_id
                _save_auth_data(auth_data)
                _clear_qr_state()
                return {
                    "success": True,
                    "message": "Token 有效，无需重新登录",
                    "qr_url": "",
                    "qr_image": "",
                    "status_url": "",
                }

    # 需要生成二维码
    location_data = {}
    service_location = service_data.get("location", "")
    if service_location:
        parsed_qs = parse.parse_qs(parse.urlparse(service_location).query)
        location_data = {k: v[0] for k, v in parsed_qs.items()}

    # Step 2: 获取二维码
    location_data.update({
        "theme": "",
        "bizDeviceType": "",
        "_hasLogo": "false",
        "_qrsize": "240",
        "_dc": str(int(time.time() * 1000)),
    })

    login_url = "https://account.xiaomi.com/longPolling/loginUrl?" + parse.urlencode(location_data)

    resp = session.get(login_url, headers=headers, timeout=30)
    login_data = _json_decode(resp.text)

    qr_url = login_data.get("loginUrl", "")
    lp_url = login_data.get("lp", "")

    # 生成二维码图片 — 与 bilibili-music 一致
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_L,
        box_size=10,
        border=4,
    )
    qr.add_data(qr_url)
    qr.make(fit=True)

    img = qr.make_image(fill_color="black", back_color="white")
    buffered = BytesIO()
    img.save(buffered, format="PNG")
    img_base64 = base64.b64encode(buffered.getvalue()).decode()

    # 持久化轮询状态（跨进程）
    _save_qr_state({
        "lp_url": lp_url,
        "headers": headers,
        "device_id": device_id,
        "login_status": "pending",
        "login_message": "等待扫码",
        "created_at": int(time.time()),
    })

    return {
        "success": True,
        "message": "请使用米家 APP 扫描二维码",
        "qr_url": qr_url,
        "qr_image": f"data:image/png;base64,{img_base64}",
        "status_url": lp_url,
    }


def check_login_status() -> dict:
    """检查登录状态 — 从文件恢复状态，非阻塞轮询 LP URL

    Returns:
        dict: { status, message, user_id }
    """
    # 先检查是否已经登录成功
    auth_data = _load_auth_data()
    if auth_data.get("userId") and auth_data.get("serviceToken") and auth_data.get("ssecurity"):
        _clear_qr_state()
        return {"status": "success", "message": "登录成功", "user_id": auth_data.get("userId", "")}

    # 读取 QR 轮询状态
    qr_state = _load_qr_state()
    if not qr_state or not qr_state.get("lp_url"):
        return {"status": "idle", "message": "未生成二维码", "user_id": ""}

    lp_url = qr_state["lp_url"]
    headers = qr_state.get("headers", {})

    # LP 是长轮询接口，有可能长时间挂住等待确认
    session = requests.Session()
    session.trust_env = False
    try:
        resp = session.get(lp_url, headers=headers, timeout=30)
        lp_data = _json_decode(resp.text)

        if lp_data.get("code") == 0:
            # 登录成功 — 先保存 JSON body 中的字段
            for key in ["psecurity", "nonce", "ssecurity", "passToken", "userId", "cUserId", "serviceToken"]:
                if key in lp_data:
                    auth_data[key] = lp_data[key]

            # 再 follow location 获取 cookies（serviceToken 在 cookie 里）
            location = lp_data.get("location", "")
            if location:
                try:
                    loc_resp = session.get(location, headers=headers, timeout=10)
                    for k, v in loc_resp.cookies.items():
                        if k in ("serviceToken", "userId", "cUserId", "passToken"):
                            auth_data[k] = v
                except Exception:
                    pass

            auth_data["deviceId"] = qr_state.get("device_id", "")
            auth_data["expireTime"] = int((datetime.now() + timedelta(days=30)).timestamp() * 1000)
            _save_auth_data(auth_data)
            _clear_qr_state()

            return {"status": "success", "message": "登录成功", "user_id": auth_data.get("userId", "")}

        # 还在等待
        return {"status": "pending", "message": "等待扫码...", "user_id": ""}

    except requests.exceptions.Timeout:
        # LP 长轮询超时=还在等，正常
        return {"status": "pending", "message": "等待扫码...", "user_id": ""}
    except Exception as e:
        return {"status": "failed", "message": str(e), "user_id": ""}


def reset_qr_state() -> dict:
    """重置 QR 登录状态"""
    _clear_qr_state()
    return {"status": "idle", "message": "已重置", "user_id": ""}
