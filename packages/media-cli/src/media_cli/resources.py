from __future__ import annotations

import hashlib
import html
import json
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any
from urllib.parse import quote_plus, urljoin, urlparse

import httpx

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


@dataclass
class LinkCandidate:
    title: str
    url: str
    snippet: str = ""
    cover: str = ""


class AnchorParser(HTMLParser):
    def __init__(self, base_url: str):
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.links: list[LinkCandidate] = []
        self._active_href: str | None = None
        self._active_text: list[str] = []
        self._active_img = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]):
        attrs_map = {name.lower(): value or "" for name, value in attrs}
        if tag.lower() == "a":
            href = attrs_map.get("href", "").strip()
            if href and not href.startswith(("javascript:", "mailto:", "#")):
                self._active_href = urljoin(self.base_url, href)
                self._active_text = []
                self._active_img = ""
        elif tag.lower() == "img" and self._active_href:
            src = attrs_map.get("src") or attrs_map.get("data-src") or attrs_map.get("data-original") or ""
            if src and not self._active_img:
                self._active_img = urljoin(self.base_url, src)

    def handle_data(self, data: str):
        if self._active_href:
            text = data.strip()
            if text:
                self._active_text.append(text)

    def handle_endtag(self, tag: str):
        if tag.lower() != "a" or not self._active_href:
            return
        title = " ".join(self._active_text).strip()
        self.links.append(LinkCandidate(title=html.unescape(title), url=self._active_href, cover=self._active_img))
        self._active_href = None
        self._active_text = []
        self._active_img = ""


class PageMetadataParser(HTMLParser):
    def __init__(self, base_url: str):
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.title = ""
        self.meta: dict[str, str] = {}
        self.media_urls: list[dict[str, str]] = []
        self.json_ld_blocks: list[str] = []
        self._in_title = False
        self._title_parts: list[str] = []
        self._script_type = ""
        self._script_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]):
        tag_name = tag.lower()
        attrs_map = {name.lower(): value or "" for name, value in attrs}
        if tag_name == "title":
            self._in_title = True
            self._title_parts = []
            return
        if tag_name == "script":
            self._script_type = attrs_map.get("type", "").lower()
            self._script_parts = []
            return
        if tag_name == "meta":
            key = attrs_map.get("property") or attrs_map.get("name")
            content = attrs_map.get("content", "").strip()
            if key and content:
                self.meta[key.lower()] = html.unescape(content)
            return
        if tag_name == "link":
            rel = attrs_map.get("rel", "").lower()
            href = attrs_map.get("href", "").strip()
            if href and ("image_src" in rel or "apple-touch-icon" in rel or "icon" in rel):
                self.meta.setdefault("link:image", urljoin(self.base_url, href))
            return
        if tag_name in {"video", "audio", "source", "iframe", "embed"}:
            src = attrs_map.get("src", "").strip()
            if src:
                self.media_urls.append({
                    "url": urljoin(self.base_url, src),
                    "tag": tag_name,
                    "mime_type": attrs_map.get("type", "").strip(),
                })
            poster = attrs_map.get("poster", "").strip()
            if poster:
                self.meta.setdefault("poster", urljoin(self.base_url, poster))

    def handle_data(self, data: str):
        if self._in_title:
            text = data.strip()
            if text:
                self._title_parts.append(text)
        if self._script_type == "application/ld+json":
            self._script_parts.append(data)

    def handle_endtag(self, tag: str):
        tag_name = tag.lower()
        if tag_name == "title":
            self.title = html.unescape(" ".join(self._title_parts).strip())
            self._in_title = False
            self._title_parts = []
        elif tag_name == "script":
            if self._script_type == "application/ld+json":
                block = "".join(self._script_parts).strip()
                if block:
                    self.json_ld_blocks.append(block)
            self._script_type = ""
            self._script_parts = []


def resource_search(command: dict[str, Any]) -> dict[str, Any]:
    query = str(command.get("query") or "").strip()
    sources = command.get("sources")
    limit = _int(command.get("limit"), 20)
    if not query:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "query is required"}
    if not isinstance(sources, list) or not sources:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "sources is required"}

    hits: list[dict[str, Any]] = []
    source_results: list[dict[str, Any]] = []
    for source in sources:
        if not isinstance(source, dict):
            continue
        source_id = str(source.get("id") or "").strip()
        name = str(source.get("name") or source_id or "source").strip()
        kind = str(source.get("kind") or "html").strip()
        definition = source.get("definition")
        if not isinstance(definition, dict):
            definition = {}
        try:
            next_hits = _search_source(source_id, name, kind, definition, query, limit)
            hits.extend(next_hits)
            source_results.append({"source_id": source_id, "status": "success", "count": len(next_hits)})
        except Exception as exc:
            source_results.append({"source_id": source_id, "status": "error", "message": str(exc)})

    deduped = _dedupe_hits(hits)[: max(1, min(limit, 100))]
    if _bool(command.get("normalize"), False):
        deduped = _normalize_hits(deduped, query, _int(command.get("normalize_limit"), 8))
    return {
        "status": "success",
        "data": {
            "query": query,
            "count": len(deduped),
            "hits": deduped,
            "sources": source_results,
        },
    }


def resource_normalize(command: dict[str, Any]) -> dict[str, Any]:
    query = str(command.get("query") or "").strip()
    hit = command.get("hit")
    if not isinstance(hit, dict):
        url = str(command.get("url") or "").strip()
        if not url:
            return {"status": "error", "error": "INVALID_PARAMS", "message": "url or hit is required"}
        hit = _hit(
            str(command.get("source_id") or "manual"),
            str(command.get("source_name") or "Manual"),
            str(command.get("title") or _title_from_url(url)),
            url,
            str(command.get("snippet") or ""),
            str(command.get("cover") or ""),
            0.2,
        )
    try:
        normalized = _normalize_hit(hit, query)
    except Exception as exc:
        normalized = dict(hit)
        normalized["normalize_status"] = "error"
        normalized["normalize_error"] = str(exc)
    return {"status": "success", "data": {"hit": normalized}}


def _search_source(source_id: str, name: str, kind: str, definition: dict[str, Any], query: str, limit: int) -> list[dict[str, Any]]:
    url = _render_template(str(definition.get("search_url_template") or ""), query)
    if not url:
        raise ValueError("search_url_template is required")
    headers = _headers(definition.get("headers"))
    timeout = min(max(_int(definition.get("timeout_sec"), 12), 3), 30)
    with httpx.Client(follow_redirects=True, timeout=timeout, headers=headers) as client:
        response = client.get(url)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "").lower()
        if kind == "json" or "application/json" in content_type:
            return _parse_json_source(source_id, name, definition, query, response.json(), limit)
        return _parse_html_source(source_id, name, definition, query, str(response.text), str(response.url), limit)


def _parse_html_source(
    source_id: str,
    name: str,
    definition: dict[str, Any],
    query: str,
    body: str,
    base_url: str,
    limit: int,
) -> list[dict[str, Any]]:
    parser = AnchorParser(base_url)
    parser.feed(body)
    include = _regex(definition.get("result_url_include"))
    exclude = _regex(definition.get("result_url_exclude"))
    title_include = _regex(definition.get("title_include"))
    query_terms = [term.lower() for term in re.split(r"\s+", query) if term.strip()]
    hits: list[dict[str, Any]] = []
    for candidate in parser.links:
        if not candidate.title:
            candidate.title = _title_from_url(candidate.url)
        if include and not include.search(candidate.url):
            continue
        if exclude and exclude.search(candidate.url):
            continue
        if title_include and not title_include.search(candidate.title):
            continue
        confidence = _confidence(candidate.title, candidate.url, query_terms)
        if confidence <= 0 and not include:
            continue
        hits.append(_hit(source_id, name, candidate.title, candidate.url, candidate.snippet, candidate.cover, confidence))
        if len(hits) >= limit:
            break
    return hits


def _parse_json_source(
    source_id: str,
    name: str,
    definition: dict[str, Any],
    query: str,
    payload: Any,
    limit: int,
) -> list[dict[str, Any]]:
    items = _get_path(payload, str(definition.get("items_path") or "items"))
    if not isinstance(items, list):
        items = _get_path(payload, "results")
    if not isinstance(items, list):
        items = payload if isinstance(payload, list) else []

    title_path = str(definition.get("title_path") or "title")
    url_path = str(definition.get("url_path") or "url")
    snippet_path = str(definition.get("snippet_path") or "description")
    cover_path = str(definition.get("cover_path") or "cover")
    query_terms = [term.lower() for term in re.split(r"\s+", query) if term.strip()]
    hits: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        raw_url = _get_path(item, url_path)
        if not isinstance(raw_url, str) or not raw_url.strip():
            continue
        title = _get_path(item, title_path)
        snippet = _get_path(item, snippet_path)
        cover = _get_path(item, cover_path)
        url = urljoin(str(definition.get("base_url") or raw_url), raw_url)
        hit_title = str(title or _title_from_url(url)).strip()
        hits.append(_hit(
            source_id,
            name,
            hit_title,
            url,
            str(snippet or ""),
            str(cover or ""),
            _confidence(hit_title, url, query_terms),
        ))
        if len(hits) >= limit:
            break
    return hits


def _normalize_hits(hits: list[dict[str, Any]], query: str, limit: int) -> list[dict[str, Any]]:
    max_items = max(0, min(limit, len(hits), 20))
    normalized: list[dict[str, Any]] = []
    for index, hit in enumerate(hits):
        if index >= max_items:
            normalized.append(hit)
            continue
        try:
            normalized.append(_normalize_hit(hit, query))
        except Exception as exc:
            fallback = dict(hit)
            fallback["normalize_status"] = "error"
            fallback["normalize_error"] = str(exc)
            normalized.append(fallback)
    return _dedupe_hits(normalized)


def _normalize_hit(hit: dict[str, Any], query: str) -> dict[str, Any]:
    url = str(hit.get("url") or "").strip()
    if not url:
        return hit
    normalized = dict(hit)
    direct = _media_from_url(url)
    if direct:
        normalized["kind"] = "audio" if direct["kind"] == "audio" else "video"
        normalized["media_candidates"] = [_media_candidate(url, direct["kind"], direct["mime_type"], "direct")]
        normalized["signals"] = _merge_signals(normalized.get("signals"), ["direct_media"])
        normalized["confidence"] = _score_normalized(normalized, query)
        normalized["normalize_status"] = "success"
        return normalized

    headers = _headers(None)
    with httpx.Client(follow_redirects=True, timeout=8, headers=headers) as client:
        response = client.get(url)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "").lower()
        final_url = str(response.url)
        normalized["url"] = final_url
        if not _is_html_response(content_type, final_url):
            candidate = _candidate_from_content_type(final_url, content_type)
            if candidate:
                normalized["kind"] = "audio" if candidate["kind"] == "audio" else "video"
                normalized["media_candidates"] = [_media_candidate(final_url, candidate["kind"], candidate["mime_type"], "content-type")]
                normalized["signals"] = _merge_signals(normalized.get("signals"), ["direct_media"])
            normalized["confidence"] = _score_normalized(normalized, query)
            normalized["normalize_status"] = "success"
            return normalized

        parser = PageMetadataParser(final_url)
        body = response.text
        parser.feed(body)

    schema = _extract_schema_metadata(parser.json_ld_blocks, final_url)
    title = _first_text(
        schema.get("title"),
        parser.meta.get("og:title"),
        parser.meta.get("twitter:title"),
        parser.title,
        normalized.get("title"),
    )
    snippet = _first_text(
        schema.get("description"),
        parser.meta.get("og:description"),
        parser.meta.get("twitter:description"),
        parser.meta.get("description"),
        normalized.get("snippet"),
    )
    cover = _first_text(
        schema.get("cover"),
        parser.meta.get("og:image"),
        parser.meta.get("twitter:image"),
        parser.meta.get("poster"),
        parser.meta.get("link:image"),
        normalized.get("cover"),
    )
    site_name = _first_text(parser.meta.get("og:site_name"), urlparse(final_url).hostname or "")
    media_candidates = _dedupe_media_candidates([
        *schema.get("media_candidates", []),
        *[_media_candidate(item["url"], _media_kind(item["url"], item.get("tag", "")), item.get("mime_type", ""), item.get("tag", "")) for item in parser.media_urls],
        *[_media_candidate(item, _media_kind(item, "inline"), "", "inline") for item in _extract_inline_media_urls(body, final_url)],
    ])

    if title:
        normalized["title"] = title[:240]
    if snippet:
        normalized["snippet"] = snippet[:400]
    if cover:
        normalized["cover"] = urljoin(final_url, cover)
    if site_name:
        normalized["site_name"] = site_name
    if media_candidates:
        normalized["media_candidates"] = media_candidates
        normalized["kind"] = _kind_from_media_candidates(media_candidates)

    signals: list[str] = []
    if any(key.startswith(("og:", "twitter:")) for key in parser.meta):
        signals.append("open_graph")
    if parser.json_ld_blocks:
        signals.append("schema_org")
    if media_candidates:
        signals.append("media_candidate")
    normalized["signals"] = _merge_signals(normalized.get("signals"), signals)
    normalized["confidence"] = _score_normalized(normalized, query)
    normalized["normalize_status"] = "success"
    return normalized


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
