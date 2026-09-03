import json
import re
from typing import Any
from urllib.parse import urljoin, urlparse

from media_cli.resource_common import _first_text


MEDIA_EXTENSIONS = {
    ".m3u8": ("hls", "application/vnd.apple.mpegurl"),
    ".mpd": ("dash", "application/dash+xml"),
    ".mp4": ("video", "video/mp4"),
    ".webm": ("video", "video/webm"),
    ".mkv": ("video", "video/x-matroska"),
    ".mov": ("video", "video/quicktime"),
    ".avi": ("video", "video/x-msvideo"),
    ".flv": ("video", "video/x-flv"),
    ".ts": ("video", "video/mp2t"),
    ".mp3": ("audio", "audio/mpeg"),
    ".m4a": ("audio", "audio/mp4"),
    ".aac": ("audio", "audio/aac"),
    ".flac": ("audio", "audio/flac"),
    ".wav": ("audio", "audio/wav"),
    ".ogg": ("audio", "audio/ogg"),
}


def _extract_schema_metadata(blocks: list[str], base_url: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    media_candidates: list[dict[str, str]] = []
    for block in blocks[:4]:
        try:
            payload = json.loads(block)
        except Exception:
            continue
        for item in _schema_items(payload):
            if not isinstance(item, dict):
                continue
            result.setdefault("title", _first_text(item.get("name"), item.get("headline")))
            result.setdefault("description", _first_text(item.get("description")))
            image = _first_text(item.get("thumbnailUrl"), item.get("thumbnail"), item.get("image"))
            if image:
                result.setdefault("cover", urljoin(base_url, image))
            for key in ["contentUrl", "embedUrl", "url"]:
                raw = _first_text(item.get(key))
                if raw and (_media_from_url(raw) or key in {"contentUrl", "embedUrl"}):
                    absolute = urljoin(base_url, raw)
                    media = _media_from_url(absolute)
                    media_candidates.append(_media_candidate(
                        absolute,
                        media["kind"] if media else "embed",
                        media["mime_type"] if media else "",
                        f"schema:{key}",
                    ))
    if media_candidates:
        result["media_candidates"] = media_candidates
    return result


def _schema_items(value: Any) -> list[Any]:
    if isinstance(value, list):
        items: list[Any] = []
        for item in value:
            items.extend(_schema_items(item))
        return items
    if not isinstance(value, dict):
        return []
    graph = value.get("@graph")
    if isinstance(graph, list):
        return [value, *graph]
    return [value]


def _extract_inline_media_urls(body: str, base_url: str) -> list[str]:
    pattern = re.compile(r"""(?P<url>https?:[^"'<>\\\s]+?\.(?:m3u8|mpd|mp4|webm|mkv|mov|avi|flv|ts|mp3|m4a|aac|flac|wav|ogg)(?:\?[^"'<>\\\s]*)?)""", re.I)
    relative_pattern = re.compile(r"""(?P<url>/[^"'<>\\\s]+?\.(?:m3u8|mpd|mp4|webm|mkv|mov|avi|flv|ts|mp3|m4a|aac|flac|wav|ogg)(?:\?[^"'<>\\\s]*)?)""", re.I)
    urls = [match.group("url") for match in pattern.finditer(body[:1_000_000])]
    urls.extend(urljoin(base_url, match.group("url")) for match in relative_pattern.finditer(body[:1_000_000]))
    return urls[:24]


def _dedupe_media_candidates(items: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: set[str] = set()
    result: list[dict[str, str]] = []
    for item in items:
        url = str(item.get("url") or "").strip()
        if not url:
            continue
        key = url.split("#", 1)[0]
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
        if len(result) >= 12:
            break
    return result


def _media_candidate(url: str, kind: str, mime_type: str = "", source: str = "") -> dict[str, str]:
    media = _media_from_url(url)
    resolved_kind = media["kind"] if media and kind in {"inline", ""} else kind
    resolved_mime = mime_type or (media["mime_type"] if media else "")
    return {
        "url": url,
        "kind": resolved_kind or "embed",
        **({"mime_type": resolved_mime} if resolved_mime else {}),
        **({"source": source} if source else {}),
    }


def _media_from_url(url: str) -> dict[str, str] | None:
    path = urlparse(url).path.lower()
    for suffix, (kind, mime_type) in MEDIA_EXTENSIONS.items():
        if path.endswith(suffix):
            return {"kind": kind, "mime_type": mime_type}
    return None


def _candidate_from_content_type(url: str, content_type: str) -> dict[str, str] | None:
    if "mpegurl" in content_type or "m3u8" in content_type:
        return {"kind": "hls", "mime_type": "application/vnd.apple.mpegurl"}
    if "dash+xml" in content_type:
        return {"kind": "dash", "mime_type": "application/dash+xml"}
    if content_type.startswith("video/"):
        return {"kind": "video", "mime_type": content_type.split(";", 1)[0]}
    if content_type.startswith("audio/"):
        return {"kind": "audio", "mime_type": content_type.split(";", 1)[0]}
    return _media_from_url(url)


def _is_html_response(content_type: str, url: str) -> bool:
    if "text/html" in content_type or "application/xhtml" in content_type:
        return True
    if content_type and not any(token in content_type for token in ["text/", "json", "xml"]):
        return False
    return _media_from_url(url) is None


def _media_kind(url: str, tag: str) -> str:
    media = _media_from_url(url)
    if media:
        return media["kind"]
    if tag == "audio":
        return "audio"
    if tag in {"video", "source"}:
        return "video"
    return "embed"


def _kind_from_media_candidates(candidates: list[dict[str, str]]) -> str:
    kinds = {str(candidate.get("kind") or "") for candidate in candidates}
    if kinds & {"hls", "dash", "video"}:
        return "video"
    if "audio" in kinds:
        return "audio"
    return "page"


def _score_normalized(hit: dict[str, Any], query: str) -> float:
    terms = [term.lower() for term in re.split(r"\s+", query) if term.strip()]
    base = max(0.0, min(float(hit.get("confidence") or 0), 1.0)) * 0.35
    score = base
    title = str(hit.get("title") or "")
    url = str(hit.get("url") or "")
    snippet = str(hit.get("snippet") or "")
    if title:
        score += 0.12
    if hit.get("cover"):
        score += 0.12
    if snippet:
        score += 0.08
    if hit.get("site_name"):
        score += 0.05
    candidates = hit.get("media_candidates")
    if isinstance(candidates, list) and candidates:
        score += 0.25
    if terms:
        haystack = f"{title} {snippet} {url}".lower()
        matched = sum(1 for term in terms if term in haystack)
        score += 0.25 * (matched / len(terms))
    return round(min(score, 1.0), 3)
