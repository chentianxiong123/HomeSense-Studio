import json
import os
import time
import io
from http.cookies import SimpleCookie
from pathlib import Path
from typing import Any

import httpx


PASSPORT_URL = "https://passport.bilibili.com"
API_URL = "https://api.bilibili.com"
REQUIRED_COOKIE_KEYS = {"SESSDATA"}
OPTIONAL_COOKIE_KEYS = {"bili_jct", "DedeUserID", "DedeUserID__ckMd5", "sid", "buvid3", "buvid4", "ac_time_value"}


def _data_dir() -> Path:
    configured = os.environ.get("HOMESENSE_DATA_DIR") or os.environ.get("DATA_DIR")
    if configured:
        root = Path(configured)
    else:
        root = Path.cwd().parents[1] / "data"
    return root / "bilibili"


def credential_path() -> Path:
    return _data_dir() / "credential.json"


def _headers(cookie: str = "") -> dict[str, str]:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Referer": "https://www.bilibili.com/",
        "Origin": "https://www.bilibili.com",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    if cookie:
        headers["Cookie"] = cookie
    return headers


def _cookie_string(cookies: dict[str, str]) -> str:
    return "; ".join(f"{key}={value}" for key, value in cookies.items() if value)


def _parse_cookie_text(text: str) -> dict[str, str]:
    raw = (text or "").strip()
    if not raw:
        return {}
    if raw.startswith("{"):
        parsed = json.loads(raw)
        return {str(k): str(v) for k, v in parsed.items() if v is not None}
    cookie = SimpleCookie()
    cookie.load(raw)
    if cookie:
        return {key: morsel.value for key, morsel in cookie.items()}
    result: dict[str, str] = {}
    for part in raw.split(";"):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        key = key.strip()
        if key:
            result[key] = value.strip()
    return result


def load_credential() -> dict[str, Any] | None:
    path = credential_path()
    if not path.exists():
        return None
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    cookies = parsed.get("cookies")
    if not isinstance(cookies, dict):
        return None
    return parsed


def save_credential(cookies: dict[str, str], source: str = "manual") -> dict[str, Any]:
    selected = {
        key: str(value)
        for key, value in cookies.items()
        if key in REQUIRED_COOKIE_KEYS or key in OPTIONAL_COOKIE_KEYS
    }
    missing = [key for key in REQUIRED_COOKIE_KEYS if not selected.get(key)]
    if missing:
        raise ValueError(f"Missing required Bilibili cookies: {', '.join(missing)}")
    payload = {
        "cookies": selected,
        "source": source,
        "saved_at": int(time.time()),
    }
    path = credential_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def clear_credential() -> None:
    path = credential_path()
    if path.exists():
        path.unlink()


def current_cookie_string() -> str:
    credential = load_credential()
    if not credential:
        return ""
    cookies = credential.get("cookies")
    return _cookie_string(cookies if isinstance(cookies, dict) else {})


def validate_cookie(cookie: str) -> dict[str, Any]:
    if not cookie:
        return {"authenticated": False}
    with httpx.Client(headers=_headers(cookie), timeout=20, follow_redirects=True) as client:
        response = client.get(f"{API_URL}/x/web-interface/nav")
        response.raise_for_status()
        payload = response.json()
    if payload.get("code") != 0:
        return {"authenticated": False, "message": payload.get("message") or "Bilibili auth failed"}
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    return {
        "authenticated": bool(data.get("isLogin")),
        "user": {
            "mid": data.get("mid"),
            "uname": data.get("uname"),
            "face": data.get("face"),
            "vip_type": data.get("vipType"),
        } if data.get("isLogin") else None,
    }


def bilibili_status(command: dict[str, Any]) -> dict[str, Any]:
    credential = load_credential()
    if not credential:
        return {"status": "success", "data": {"authenticated": False, "has_saved_login": False}}
    try:
        validation = validate_cookie(_cookie_string(credential.get("cookies", {})))
    except Exception as error:
        return {
            "status": "success",
            "data": {
                "authenticated": False,
                "has_saved_login": True,
                "source": credential.get("source", "saved"),
                "saved_at": credential.get("saved_at"),
                "message": str(error),
            },
        }
    return {
        "status": "success",
        "data": {
            **validation,
            "has_saved_login": True,
            "source": credential.get("source", "saved"),
            "saved_at": credential.get("saved_at"),
        },
    }


def bilibili_import_cookie(command: dict[str, Any]) -> dict[str, Any]:
    cookie_text = str(command.get("cookie") or command.get("cookies") or "").strip()
    cookies = _parse_cookie_text(cookie_text)
    saved = save_credential(cookies, "manual")
    validation = validate_cookie(_cookie_string(saved["cookies"]))
    return {"status": "success", "data": {**validation, "has_saved_login": True, "source": "manual"}}


def bilibili_logout(command: dict[str, Any]) -> dict[str, Any]:
    clear_credential()
    return {"status": "success", "data": {"authenticated": False}}


def bilibili_qr_start(command: dict[str, Any]) -> dict[str, Any]:
    with httpx.Client(headers=_headers(), timeout=20, follow_redirects=True) as client:
        response = client.get(f"{PASSPORT_URL}/x/passport-login/web/qrcode/generate")
        response.raise_for_status()
        payload = response.json()
    if payload.get("code") != 0:
        return {"status": "error", "error": "BILIBILI_QR_FAILED", "message": payload.get("message") or "QR start failed"}
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    url = str(data.get("url") or "")
    return {
        "status": "success",
        "data": {
            "url": url,
            "qr_svg": _qr_svg(url) if url else "",
            "qrcode_key": data.get("qrcode_key"),
        },
    }


def _qr_svg(value: str) -> str:
    import qrcode
    import qrcode.image.svg

    image = qrcode.make(value, image_factory=qrcode.image.svg.SvgPathImage)
    output = io.BytesIO()
    image.save(output)
    return output.getvalue().decode("utf-8")


def bilibili_qr_poll(command: dict[str, Any]) -> dict[str, Any]:
    qrcode_key = str(command.get("qrcode_key") or command.get("key") or "").strip()
    if not qrcode_key:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "qrcode_key is required"}
    with httpx.Client(headers=_headers(), timeout=20, follow_redirects=False) as client:
        response = client.get(
            f"{PASSPORT_URL}/x/passport-login/web/qrcode/poll",
            params={"qrcode_key": qrcode_key},
        )
        response.raise_for_status()
        payload = response.json()
        response_cookies = {key: value for key, value in response.cookies.items()}
    if payload.get("code") != 0:
        return {"status": "error", "error": "BILIBILI_QR_FAILED", "message": payload.get("message") or "QR poll failed"}
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    code = int(data.get("code") or 0)
    if code == 0:
        if response_cookies:
            saved = save_credential(response_cookies, "qr")
            validation = validate_cookie(_cookie_string(saved["cookies"]))
        else:
            validation = {"authenticated": True}
        return {"status": "success", "data": {**validation, "qr_status": "confirmed", "code": code}}
    status_map = {
        86101: "waiting_scan",
        86090: "waiting_confirm",
        86038: "expired",
    }
    return {
        "status": "success",
        "data": {
            "authenticated": False,
            "qr_status": status_map.get(code, "pending"),
            "code": code,
            "message": data.get("message"),
        },
    }


def bilibili_browser_import(command: dict[str, Any]) -> dict[str, Any]:
    try:
        import browser_cookie3 as bc3  # type: ignore
    except Exception as error:
        return {"status": "error", "error": "BROWSER_COOKIE_UNAVAILABLE", "message": str(error)}

    browsers = [
        ("chrome", getattr(bc3, "chrome", None)),
        ("edge", getattr(bc3, "edge", None)),
        ("firefox", getattr(bc3, "firefox", None)),
        ("brave", getattr(bc3, "brave", None)),
    ]
    errors: list[str] = []
    for name, loader in browsers:
        if loader is None:
            continue
        try:
            jar = loader(domain_name=".bilibili.com")
            cookies = {cookie.name: cookie.value for cookie in jar if "bilibili.com" in (cookie.domain or "")}
            if "SESSDATA" not in cookies:
                continue
            saved = save_credential(cookies, f"browser:{name}")
            validation = validate_cookie(_cookie_string(saved["cookies"]))
            return {"status": "success", "data": {**validation, "source": f"browser:{name}", "has_saved_login": True}}
        except Exception as error:
            errors.append(f"{name}: {error}")
    return {
        "status": "error",
        "error": "NO_BROWSER_COOKIE",
        "message": "; ".join(errors) or "No Bilibili browser cookie found",
    }
