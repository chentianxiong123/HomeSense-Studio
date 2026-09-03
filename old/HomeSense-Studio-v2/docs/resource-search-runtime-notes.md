# HomeSense Resource Search Runtime Notes

## Positioning

Resource search is a HomeSense-owned runtime for turning user-configured internet sources into a unified media workflow. It is not a built-in piracy rule library, not a crawler farm, and not a replacement for the media workbench.

The runtime has one narrow job:

```text
configured source -> search hits -> normalized resource cards -> sniff/play/cast/bookmark
```

HomeSense remains the system of record. External sites only provide candidate URLs.

## Current Scope

- Store user-configured resource sources in SQLite.
- Search enabled sources through `media-cli`.
- Normalize the first set of hits into a shared `ResourceSearchHit` shape.
- Extract common public metadata:
  - page title
  - Open Graph / Twitter Card fields
  - schema.org JSON-LD fields
  - cover image
  - description
  - obvious media candidates from `video`, `audio`, `source`, `iframe`, direct media URLs, and inline m3u8/mp4/mp3-style links
- Render every source through one `ResourceSearchPanel` card layout.
- Send selected results into the existing URL/sniff/play/bookmark flow.

## Explicit Boundaries

- Do not hardcode a bundled list of gray resource sites.
- Do not add one frontend component per source.
- Do not make this a heavy media library with scraping, metadata matching, seasons, actors, or posters as first-class entities.
- Do not bypass site protections or implement anti-filter tricks.
- Do not recursively crawl the web. The v1 normalizer only reads the search result page itself.

## Contracts

### Resource Source

```ts
interface ResourceSourceDefinition {
  search_url_template: string
  result_url_include?: string
  result_url_exclude?: string
  title_include?: string
  items_path?: string
  title_path?: string
  url_path?: string
  snippet_path?: string
  cover_path?: string
  base_url?: string
  headers?: Record<string, string>
  timeout_sec?: number
}
```

Sources are configuration, not product code. They can be exported, imported, enabled, disabled, tested, and replaced without changing the HomeSense UI.

### Normalized Hit

```ts
interface ResourceSearchHit {
  id: string
  source_id: string
  source_name: string
  title: string
  url: string
  snippet?: string
  cover?: string
  kind: 'page' | 'video' | 'audio' | 'image' | 'book' | 'file'
  confidence: number
  site_name?: string
  media_candidates?: Array<{
    url: string
    kind: 'video' | 'audio' | 'hls' | 'dash' | 'embed'
    mime_type?: string
    source?: string
  }>
  signals?: string[]
  normalize_status?: 'success' | 'error'
  normalize_error?: string
}
```

This is the stable internal view. Future sources should adapt into this shape instead of adding new UI branches.

## Agent Control Points

Future Agent work should call the same actions humans use:

- list resource sources
- search resources
- normalize a URL or hit
- sniff a selected page
- prepare a media stream
- play in browser
- cast through DLNA
- save to media bookmarks

The Agent should orchestrate HomeSense capabilities, not own separate search or playback logic.

## Next Step

The next small, understandable step is source import/export:

- `GET /api/resources/sources/export`
- `POST /api/resources/sources/import`
- matching buttons in `ResourceSearchPanel`

This keeps the feature useful without turning resource search into another large subsystem.
