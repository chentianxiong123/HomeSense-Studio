import html
import re
import uuid
from typing import Any

import httpx


BASE_URL = "https://api.bilibili.com"
AUDIO_64K = 64
AUDIO_128K = 128
AUDIO_192K = 192
AUDIO_320K = 30280
AUDIO_FLAC = 30250
QUALITY_PRIORITY = [AUDIO_FLAC, AUDIO_320K, AUDIO_192K, AUDIO_128K, AUDIO_64K]

_HTML_TAG_RE = re.compile(r"<[^>]+>")


def _headers() -> dict[str, str]:
    return {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Referer": "https://search.bilibili.com/",
        "Origin": "https://search.bilibili.com",
        "Cookie": f"buvid3={uuid.uuid4()}",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }


def _get(path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    with httpx.Client(base_url=BASE_URL, headers=_headers(), timeout=30, follow_redirects=True) as client:
        response = client.get(path, params=params)
        response.raise_for_status()
        payload = response.json()
    if payload.get("code") != 0:
        raise RuntimeError(payload.get("message") or f"Bilibili API error: {payload.get('code')}")
    data = payload.get("data")
    return data if isinstance(data, dict) else {}


def _clean_text(value: Any) -> str:
    text = html.unescape(str(value or ""))
    return _HTML_TAG_RE.sub("", text).strip()


def _duration_to_seconds(value: Any) -> int:
    if isinstance(value, int):
        return value
    text = str(value or "").strip()
    if not text:
        return 0
    parts = [part for part in text.split(":") if part != ""]
    try:
        nums = [int(part) for part in parts]
    except ValueError:
        return 0
    if len(nums) == 3:
        return nums[0] * 3600 + nums[1] * 60 + nums[2]
    if len(nums) == 2:
        return nums[0] * 60 + nums[1]
    if len(nums) == 1:
        return nums[0]
    return 0


def _cover_url(value: Any) -> str:
    url = str(value or "")
    if url.startswith("//"):
        return f"https:{url}"
    return url


def search_bilibili(command: dict[str, Any]) -> dict[str, Any]:
    keyword = str(command.get("keyword") or command.get("q") or "").strip()
    if not keyword:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "keyword is required"}
    page = int(command.get("page") or 1)
    page_size = min(50, max(1, int(command.get("page_size") or command.get("pageSize") or 20)))

    data = _get(
        "/x/web-interface/search/type",
        {
            "keyword": keyword,
            "search_type": "video",
            "page": page,
            "pagesize": page_size,
        },
    )

    raw_items = data.get("result") if isinstance(data.get("result"), list) else []
    items = []
    for raw in raw_items[:page_size]:
        if not isinstance(raw, dict):
            continue
        bvid = str(raw.get("bvid") or "")
        if not bvid:
            continue
        items.append({
            "id": f"bilibili:{bvid}",
            "source": "bilibili",
            "title": _clean_text(raw.get("title")),
            "artist": _clean_text(raw.get("author")),
            "cover": _cover_url(raw.get("pic")),
            "duration_sec": _duration_to_seconds(raw.get("duration")),
            "upstream_id": bvid,
            "upstream_url": f"https://www.bilibili.com/video/{bvid}",
            "play_count": int(raw.get("play") or 0),
        })

    return {
        "status": "success",
        "data": {
            "keyword": keyword,
            "page": page,
            "page_size": page_size,
            "total": int(data.get("numResults") or data.get("num_results") or 0),
            "items": items,
        },
    }


def get_media_info(command: dict[str, Any]) -> dict[str, Any]:
    bvid = str(command.get("bvid") or command.get("upstream_id") or "").strip()
    if not bvid:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "bvid is required"}

    info = _get("/x/web-interface/view", {"bvid": bvid})
    owner = info.get("owner") if isinstance(info.get("owner"), dict) else {}
    stat = info.get("stat") if isinstance(info.get("stat"), dict) else {}
    return {
        "status": "success",
        "data": {
            "item": {
                "id": f"bilibili:{bvid}",
                "source": "bilibili",
                "title": _clean_text(info.get("title")),
                "artist": _clean_text(owner.get("name")),
                "cover": _cover_url(info.get("pic")),
                "duration_sec": int(info.get("duration") or 0),
                "upstream_id": bvid,
                "upstream_url": f"https://www.bilibili.com/video/{bvid}",
                "play_count": int(stat.get("view") or 0),
            },
            "aid": int(info.get("aid") or 0),
            "cid": int(info.get("cid") or 0),
            "description": str(info.get("desc") or ""),
        },
    }


def resolve_audio(command: dict[str, Any]) -> dict[str, Any]:
    bvid = str(command.get("bvid") or command.get("upstream_id") or "").strip()
    if not bvid:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "bvid is required"}
    preferred_quality = int(command.get("quality") or AUDIO_64K)

    info = _get("/x/web-interface/view", {"bvid": bvid})
    cid = int(info.get("cid") or 0)
    if not cid:
        return {"status": "error", "error": "MEDIA_INFO_MISSING", "message": "cid missing"}

    stream = _get(
        "/x/player/playurl",
        {
            "bvid": bvid,
            "cid": cid,
            "qn": preferred_quality,
            "fnval": 16,
            "fourk": 1,
            "platform": "html5",
            "mobisel": 1,
            "highbit": 1,
        },
    )

    audio = _select_audio(stream, preferred_quality)
    return {
        "status": "success",
        "data": {
            "bvid": bvid,
            "cid": cid,
            "stream_url": audio["url"],
            "quality": audio["quality"],
            "size": audio.get("size", 0),
            "mime_type": audio.get("mime_type", ""),
            "codecs": audio.get("codecs", ""),
            "item": {
                "id": f"bilibili:{bvid}",
                "source": "bilibili",
                "title": _clean_text(info.get("title")),
                "artist": _clean_text((info.get("owner") or {}).get("name") if isinstance(info.get("owner"), dict) else ""),
                "cover": _cover_url(info.get("pic")),
                "duration_sec": int(info.get("duration") or 0),
                "upstream_id": bvid,
                "upstream_url": f"https://www.bilibili.com/video/{bvid}",
                "stream_url": audio["url"],
                "mime_type": audio.get("mime_type", ""),
            },
        },
    }


def _select_audio(stream: dict[str, Any], preferred_quality: int) -> dict[str, Any]:
    durl = stream.get("durl")
    if isinstance(durl, list) and durl:
        first = durl[0] if isinstance(durl[0], dict) else {}
        url = str(first.get("url") or "")
        if url:
            return {"url": url, "quality": preferred_quality, "size": int(first.get("size") or 0)}

    dash = stream.get("dash") if isinstance(stream.get("dash"), dict) else {}
    audio_items = dash.get("audio") if isinstance(dash.get("audio"), list) else []
    if not audio_items:
        raise RuntimeError("No audio stream available")

    by_quality = {
        int(item.get("id") or 0): item
        for item in audio_items
        if isinstance(item, dict)
    }
    selected = by_quality.get(preferred_quality)
    if not selected:
        for quality in QUALITY_PRIORITY:
            selected = by_quality.get(quality)
            if selected:
                break
    if not selected:
        selected = audio_items[0]

    url = str(selected.get("baseUrl") or selected.get("base_url") or "")
    if not url:
        backup = selected.get("backupUrl") or selected.get("backup_url") or []
        if isinstance(backup, list) and backup:
            url = str(backup[0])
    if not url:
        raise RuntimeError("Audio stream URL missing")

    return {
        "url": url,
        "quality": int(selected.get("id") or 0),
        "size": int(selected.get("size") or 0),
        "mime_type": str(selected.get("mimeType") or selected.get("mime_type") or ""),
        "codecs": str(selected.get("codecs") or ""),
    }
