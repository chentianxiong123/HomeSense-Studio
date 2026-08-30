import html
import re
import uuid
from typing import Any

import httpx


BASE_URL = "https://api.bilibili.com"
AUDIO_64K = 30216
AUDIO_128K = 30232
AUDIO_192K = 30280
AUDIO_FLAC = 30250
AUDIO_QUALITY_ALIASES = {
    64: AUDIO_64K,
    30216: AUDIO_64K,
    128: AUDIO_128K,
    132: AUDIO_128K,
    30232: AUDIO_128K,
    192: AUDIO_192K,
    320: AUDIO_192K,
    30280: AUDIO_192K,
    30250: AUDIO_FLAC,
}
LOW_BITRATE_PRIORITY = [AUDIO_64K, AUDIO_128K, AUDIO_192K, AUDIO_FLAC]

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
    prefer_single_track = bool(command.get("prefer_single_track") or command.get("preferSingleTrack"))
    min_duration_sec = int(command.get("min_duration_sec") or 90)
    ideal_duration_sec = int(command.get("ideal_duration_sec") or 240)
    max_duration_sec = int(command.get("max_duration_sec") or 540)
    request_page_size = 50 if prefer_single_track else page_size
    search_params = {
        "keyword": keyword,
        "search_type": "video",
        "page": page,
        "pagesize": request_page_size,
    }
    if prefer_single_track:
        search_params["duration"] = 1

    data = _get(
        "/x/web-interface/search/type",
        search_params,
    )

    raw_items = data.get("result") if isinstance(data.get("result"), list) else []
    items = []
    for raw in raw_items[:request_page_size]:
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

    if prefer_single_track:
        items.sort(key=lambda item: _single_track_rank(item, keyword, min_duration_sec, ideal_duration_sec, max_duration_sec))
        items = items[:page_size]

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


def _single_track_rank(item: dict[str, Any], keyword: str, min_duration_sec: int, ideal_duration_sec: int, max_duration_sec: int) -> tuple[int, int, int]:
    duration = int(item.get("duration_sec") or 0)
    title = str(item.get("title") or "")
    penalty = 0
    if duration <= 0:
        penalty += 5000
    elif duration < min_duration_sec:
        penalty += 1200 + (min_duration_sec - duration)
    elif duration > max_duration_sec:
        penalty += 1600 + min(duration - max_duration_sec, 7200)
    else:
        penalty += abs(duration - ideal_duration_sec)

    lowered = title.lower()
    if any(token in lowered for token in ["合集", "精选", "歌单", "排行榜", "100首", "50首", "无损音乐", "循环", "纯享合集"]):
        penalty += 900
    if any(token in lowered for token in ["完整版", "official", "mv", "歌词", "现场", "live"]):
        penalty -= 80
    if keyword and keyword.lower() in lowered:
        penalty -= 40

    return (penalty, abs(duration - ideal_duration_sec), -int(item.get("play_count") or 0))


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
    preferred_quality = _normalize_audio_quality(command.get("quality") or 64)

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
    dash = stream.get("dash") if isinstance(stream.get("dash"), dict) else {}
    audio_items = dash.get("audio") if isinstance(dash.get("audio"), list) else []
    if audio_items:
        by_quality = {
            int(item.get("id") or 0): item
            for item in audio_items
            if isinstance(item, dict)
        }
        selected = by_quality.get(preferred_quality)
        if not selected:
            for quality in [preferred_quality, *LOW_BITRATE_PRIORITY]:
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
            "mime_type": str(selected.get("mimeType") or selected.get("mime_type") or "audio/mp4"),
            "codecs": str(selected.get("codecs") or ""),
        }

    raise RuntimeError("No audio stream available")


def _normalize_audio_quality(value: Any) -> int:
    try:
        raw = int(value)
    except (TypeError, ValueError):
        return AUDIO_64K
    return AUDIO_QUALITY_ALIASES.get(raw, raw)
