from __future__ import annotations

import re
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from media_cli.resource_common import (
    _bool,
    _confidence,
    _dedupe_hits,
    _first_text,
    _get_path,
    _headers,
    _hit,
    _int,
    _merge_signals,
    _regex,
    _render_template,
    _title_from_url,
)
from media_cli.resource_media import (
    _candidate_from_content_type,
    _dedupe_media_candidates,
    _extract_inline_media_urls,
    _extract_schema_metadata,
    _is_html_response,
    _kind_from_media_candidates,
    _media_candidate,
    _media_from_url,
    _media_kind,
    _score_normalized,
)
from media_cli.resource_parsers import AnchorParser, PageMetadataParser


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
