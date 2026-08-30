import hashlib
import html
import re
from typing import Any
from urllib.parse import quote_plus, urlparse


def _hit(source_id: str, source_name: str, title: str, url: str, snippet: str, cover: str, confidence: float) -> dict[str, Any]:
    stable = hashlib.sha1(f"{source_id}:{url}".encode("utf-8")).hexdigest()[:16]
    return {
        "id": f"resource:{source_id}:{stable}",
        "source_id": source_id,
        "source_name": source_name,
        "title": title[:240],
        "url": url,
        "snippet": snippet[:400] if snippet else "",
        "cover": cover,
        "kind": _kind_from_url(url),
        "confidence": round(confidence, 3),
    }


def _render_template(template: str, query: str) -> str:
    if not template:
        return ""
    encoded = quote_plus(query)
    return template.replace("{{query}}", encoded).replace("{query}", encoded)


def _headers(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {
            "User-Agent": "HomeSenseResourceSearch/0.1",
            "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
        }
    return {str(k): str(v) for k, v in value.items() if str(k).strip() and str(v).strip()}


def _regex(value: Any) -> re.Pattern[str] | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    return re.compile(raw, re.I)


def _get_path(value: Any, path: str) -> Any:
    current = value
    for part in path.split("."):
        part = part.strip()
        if not part:
            continue
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, list) and part.isdigit():
            current = current[int(part)]
        else:
            return None
    return current


def _confidence(title: str, url: str, terms: list[str]) -> float:
    if not terms:
        return 0.5
    haystack = f"{title} {url}".lower()
    matched = sum(1 for term in terms if term in haystack)
    return matched / len(terms)


def _dedupe_hits(hits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for hit in sorted(hits, key=lambda item: float(item.get("confidence") or 0), reverse=True):
        url = str(hit.get("url") or "")
        key = url.split("#", 1)[0]
        if key in seen:
            continue
        seen.add(key)
        deduped.append(hit)
    return deduped


def _title_from_url(url: str) -> str:
    try:
        parsed = urlparse(url)
        last = [part for part in parsed.path.split("/") if part][-1]
        return html.unescape(last.replace("-", " ").replace("_", " "))
    except Exception:
        return url


def _merge_signals(existing: Any, signals: list[str]) -> list[str]:
    result: list[str] = []
    if isinstance(existing, list):
        result.extend(str(item) for item in existing if str(item).strip())
    result.extend(signals)
    return list(dict.fromkeys(result))


def _first_text(*values: Any) -> str:
    for value in values:
        if isinstance(value, list):
            nested = _first_text(*value)
            if nested:
                return nested
        elif isinstance(value, dict):
            nested = _first_text(value.get("url"), value.get("@id"), value.get("name"))
            if nested:
                return nested
        elif value is not None:
            text = html.unescape(str(value)).strip()
            if text:
                return text
    return ""


def _kind_from_url(url: str) -> str:
    path = urlparse(url).path.lower()
    if path.endswith((".mp3", ".m4a", ".aac", ".flac", ".wav", ".ogg")):
        return "audio"
    if path.endswith((".mp4", ".webm", ".mkv", ".mov", ".avi", ".flv", ".ts", ".m3u8", ".mpd")):
        return "video"
    if path.endswith((".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif")):
        return "image"
    if path.endswith((".pdf", ".epub", ".mobi", ".azw3", ".txt")):
        return "book"
    return "page"


def _int(value: Any, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    return default
