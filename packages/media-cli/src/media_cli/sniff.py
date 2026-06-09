from __future__ import annotations

import hashlib
import html
import re
from typing import Any
from urllib.parse import unquote, urljoin, urlparse

import httpx


MEDIA_EXTENSIONS: dict[str, tuple[str, str]] = {
    ".mp3": ("audio", "audio/mpeg"),
    ".m4a": ("audio", "audio/mp4"),
    ".aac": ("audio", "audio/aac"),
    ".flac": ("audio", "audio/flac"),
    ".wav": ("audio", "audio/wav"),
    ".ogg": ("audio", "audio/ogg"),
    ".mp4": ("video", "video/mp4"),
    ".m4v": ("video", "video/mp4"),
    ".webm": ("video", "video/webm"),
    ".mkv": ("video", "video/x-matroska"),
    ".mov": ("video", "video/quicktime"),
    ".avi": ("video", "video/x-msvideo"),
    ".flv": ("video", "video/x-flv"),
    ".ts": ("video", "video/mp2t"),
    ".m3u8": ("hls", "application/vnd.apple.mpegurl"),
    ".mpd": ("dash", "application/dash+xml"),
}

MEDIA_EXT_PATTERN = "|".join(re.escape(ext.lstrip(".")) for ext in sorted(MEDIA_EXTENSIONS, key=len, reverse=True))
ATTR_URL_RE = re.compile(r"""(?:src|href)\s*=\s*["']([^"']+)["']""", re.IGNORECASE)
ABS_MEDIA_URL_RE = re.compile(
    rf"""https?://[^\s"'<>]+?\.({MEDIA_EXT_PATTERN})(?:\?[^\s"'<>]*)?""",
    re.IGNORECASE,
)
TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)


def sniff_url(command: dict[str, Any]) -> dict[str, Any]:
    url = str(command.get("url") or command.get("page_url") or "").strip()
    if not url:
        return _error("INVALID_PARAMS", "url is required")
    if not _is_http_url(url):
        return _error("INVALID_PARAMS", "url must be an http(s) URL")

    max_candidates = _bounded_int(command.get("max_candidates"), 20, 1, 50)
    inspect_page = command.get("inspect_page", True) is not False
    candidates: list[dict[str, Any]] = []
    fetch_error = ""

    direct = _candidate_from_url(url, provider="direct-url", confidence=0.95)
    if direct:
        candidates.append(direct)

    if inspect_page and not direct:
        page_result = _extract_from_page(url, max_candidates)
        candidates.extend(page_result["candidates"])
        fetch_error = page_result["error"]

    candidates = _dedupe_candidates(candidates)[:max_candidates]
    return {
        "status": "success",
        "data": {
            "url": url,
            "count": len(candidates),
            "candidates": candidates,
            "strategy": "direct-or-static-page",
            **({"warning": fetch_error} if fetch_error and not candidates else {}),
        },
    }


def _extract_from_page(url: str, limit: int) -> dict[str, Any]:
    try:
        response = httpx.get(
            url,
            follow_redirects=True,
            timeout=12,
            headers={
                "User-Agent": "HomeSense Media Sniffer",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        )
        response.raise_for_status()
    except Exception as exc:
        return {"candidates": [], "error": f"page fetch failed: {exc}"}

    content_type = response.headers.get("content-type", "")
    if _media_kind_from_mime(content_type):
        candidate = _candidate_from_url(
            str(response.url),
            provider="content-type-probe",
            confidence=0.85,
            mime_type=content_type.split(";", 1)[0].strip(),
        )
        return {"candidates": [candidate] if candidate else [], "error": ""}

    if "html" not in content_type and "xml" not in content_type and response.text.find("<") < 0:
        return {"candidates": [], "error": ""}

    html_text = response.text[:1_000_000]
    title = _page_title(html_text)
    raw_urls = [match.group(1) for match in ATTR_URL_RE.finditer(html_text)]
    raw_urls.extend(match.group(0) for match in ABS_MEDIA_URL_RE.finditer(html_text))

    candidates: list[dict[str, Any]] = []
    for raw_url in raw_urls:
        if len(candidates) >= limit:
            break
        absolute_url = urljoin(str(response.url), html.unescape(raw_url).strip())
        candidate = _candidate_from_url(
            absolute_url,
            page_url=str(response.url),
            provider="html-static",
            title=title,
            confidence=0.68,
        )
        if candidate:
            candidates.append(candidate)
    return {"candidates": candidates, "error": ""}


def _candidate_from_url(
    url: str,
    *,
    provider: str,
    confidence: float,
    page_url: str | None = None,
    title: str | None = None,
    mime_type: str | None = None,
) -> dict[str, Any] | None:
    if not _is_http_url(url):
        return None

    parsed = urlparse(url)
    extension = _extension_from_path(parsed.path)
    stream_kind = ""
    resolved_mime = ""
    if extension in MEDIA_EXTENSIONS:
        stream_kind, resolved_mime = MEDIA_EXTENSIONS[extension]
    if mime_type:
        resolved_mime = mime_type
        stream_kind = _media_kind_from_mime(mime_type) or stream_kind
    if not stream_kind:
        return None

    candidate_title = title_from_url(url)
    if title and provider != "direct-url":
        candidate_title = f"{title} · {candidate_title}"

    result: dict[str, Any] = {
        "id": f"sniff:{hashlib.sha1(url.encode('utf-8')).hexdigest()[:16]}",
        "source": "url",
        "kind": "playlist" if stream_kind in {"hls", "dash"} else "stream",
        "stream_kind": stream_kind,
        "title": candidate_title,
        "url": url,
        "mime_type": resolved_mime,
        "provider": provider,
        "confidence": confidence,
    }
    if page_url:
        result["page_url"] = page_url
        result["headers"] = {"Referer": page_url}
    return result


def title_from_url(url: str) -> str:
    parsed = urlparse(url)
    last_part = parsed.path.rstrip("/").split("/")[-1]
    if not last_part:
        return parsed.netloc or url
    try:
        return unquote(last_part)
    except Exception:
        return last_part


def _extension_from_path(path: str) -> str:
    lowered = path.lower()
    for extension in MEDIA_EXTENSIONS:
        if lowered.endswith(extension):
            return extension
    return ""


def _media_kind_from_mime(mime_type: str) -> str:
    normalized = mime_type.split(";", 1)[0].strip().lower()
    if normalized.startswith("audio/"):
        return "audio"
    if normalized.startswith("video/"):
        return "video"
    if normalized in {"application/vnd.apple.mpegurl", "application/x-mpegurl"}:
        return "hls"
    if normalized == "application/dash+xml":
        return "dash"
    return ""


def _page_title(html_text: str) -> str:
    match = TITLE_RE.search(html_text)
    if not match:
        return ""
    return re.sub(r"\s+", " ", html.unescape(match.group(1))).strip()


def _dedupe_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for candidate in candidates:
        url = str(candidate.get("url") or "")
        if not url or url in seen:
            continue
        seen.add(url)
        deduped.append(candidate)
    return deduped


def _is_http_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _bounded_int(value: Any, fallback: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = fallback
    return min(maximum, max(minimum, parsed))


def _error(error: str, message: str) -> dict[str, Any]:
    return {"status": "error", "error": error, "message": message}
