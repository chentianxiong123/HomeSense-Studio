import json
import locale
import random
import string

import requests


ACCOUNT_BASE = "https://account.xiaomi.com"
SERVICE_LOGIN_URL = f"{ACCOUNT_BASE}/pass/serviceLogin"
SIGN_URL = f"{ACCOUNT_BASE}/pass/serviceLoginAuth2"
API_BASE_URL = "https://api.io.mi.com/app"
MI_SID = "xiaomiio"

UA = "Android-7.1.1-1.0.0-ONEPLUS A3010-136-%s APP/xiaomi.smarthome APPV/62830"


def _new_session() -> requests.Session:
    session = requests.Session()
    session.trust_env = False
    return session


def _get_locale() -> str:
    loc = locale.getlocale()[0]
    if not loc or "_" not in loc:
        return "zh_CN"
    return loc


def _gen_device_id(auth_data: dict) -> str:
    if "deviceId" in auth_data:
        return auth_data["deviceId"]
    return "".join(random.choices("0123456789ABCDEF", k=16))


def _get_user_agent(auth_data: dict) -> str:
    if "ua" in auth_data:
        return auth_data["ua"]
    return UA % auth_data.get("deviceId", _gen_device_id(auth_data))


def _json_decode(text: str) -> dict:
    return json.loads(text.replace("&&&START&&&", ""))


def _get_random_string(length: int) -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=length))


def _build_qr_user_agent() -> str:
    ua_id1 = "".join(random.choices("0123456789ABCDEF", k=40))
    ua_id2 = "".join(random.choices("0123456789ABCDEF", k=32))
    ua_id3 = "".join(random.choices("0123456789ABCDEF", k=32))
    ua_id4 = "".join(random.choices("0123456789ABCDEF", k=40))
    return (
        f"Android-15-11.0.701-Xiaomi-23046RP50C-OS2.0.212.0.VMYCNXM-"
        f"{ua_id1}-CN-{ua_id3}-{ua_id2}-SmartHome-MI_APP_STORE-{ua_id1}|{ua_id4}|test-64"
    )
