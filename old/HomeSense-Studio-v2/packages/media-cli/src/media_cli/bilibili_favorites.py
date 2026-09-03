from typing import Any

import httpx

from media_cli.bilibili import _clean_text, _cover_url
from media_cli.bilibili_auth import API_URL, _headers, current_cookie_string, validate_cookie


def _duration(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _require_cookie() -> str:
    cookie = current_cookie_string()
    if not cookie:
        return ""
    return cookie


def _get(path: str, params: dict[str, Any], cookie: str) -> dict[str, Any]:
    with httpx.Client(headers=_headers(cookie), timeout=30, follow_redirects=True) as client:
        response = client.get(f"{API_URL}{path}", params=params)
        response.raise_for_status()
        payload = response.json()
    if payload.get("code") != 0:
        raise RuntimeError(payload.get("message") or f"Bilibili API error: {payload.get('code')}")
    data = payload.get("data")
    return data if isinstance(data, dict) else {}


def list_favorite_folders(command: dict[str, Any]) -> dict[str, Any]:
    cookie = _require_cookie()
    if not cookie:
        return {"status": "error", "error": "NOT_AUTHENTICATED", "message": "Bilibili login is required"}
    validation = validate_cookie(cookie)
    user = validation.get("user") if isinstance(validation.get("user"), dict) else {}
    mid = int(user.get("mid") or command.get("mid") or 0)
    if not mid:
        return {"status": "error", "error": "NOT_AUTHENTICATED", "message": "Bilibili user mid missing"}
    data = _get("/x/v3/fav/folder/created/list-all", {"up_mid": mid}, cookie)
    folders = []
    for raw in data.get("list") if isinstance(data.get("list"), list) else []:
        if not isinstance(raw, dict):
            continue
        folders.append({
            "id": int(raw.get("id") or raw.get("media_id") or 0),
            "title": _clean_text(raw.get("title")),
            "media_count": int(raw.get("media_count") or 0),
            "fav_state": raw.get("fav_state"),
        })
    return {"status": "success", "data": {"folders": folders, "user": user}}


def list_favorite_medias(command: dict[str, Any]) -> dict[str, Any]:
    cookie = _require_cookie()
    if not cookie:
        return {"status": "error", "error": "NOT_AUTHENTICATED", "message": "Bilibili login is required"}
    media_id = int(command.get("media_id") or command.get("folder_id") or command.get("id") or 0)
    if not media_id:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "media_id is required"}
    page = max(1, int(command.get("page") or 1))
    page_size = min(40, max(1, int(command.get("page_size") or command.get("ps") or 20)))
    data = _get(
        "/x/v3/fav/resource/list",
        {"media_id": media_id, "pn": page, "ps": page_size, "keyword": "", "order": "mtime", "type": 0, "tid": 0},
        cookie,
    )
    items = []
    for raw in data.get("medias") if isinstance(data.get("medias"), list) else []:
        if not isinstance(raw, dict):
            continue
        bvid = str(raw.get("bvid") or "")
        if not bvid:
            continue
        upper = raw.get("upper") if isinstance(raw.get("upper"), dict) else {}
        items.append({
            "id": f"bilibili:{bvid}",
            "source": "bilibili",
            "title": _clean_text(raw.get("title")),
            "artist": _clean_text(upper.get("name")),
            "cover": _cover_url(raw.get("cover")),
            "duration_sec": _duration(raw.get("duration")),
            "upstream_id": bvid,
            "upstream_url": f"https://www.bilibili.com/video/{bvid}",
            "stream_kind": "audio",
            "mime_type": "audio/mp4",
        })
    return {
        "status": "success",
        "data": {
            "media_id": media_id,
            "page": page,
            "page_size": page_size,
            "has_more": bool(data.get("has_more")),
            "total": int(data.get("info", {}).get("media_count") or data.get("total") or 0) if isinstance(data.get("info"), dict) else int(data.get("total") or 0),
            "items": items,
        },
    }
