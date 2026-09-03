# Media Sniff And Cast Component Map

This note keeps HomeSense as the owner of the media workflow. DLNA, XiaoAi,
browser playback, URL sniffing and proxying are separate components with stable
contracts instead of one large cast service.

## Component Layers

| Layer | Responsibility | Current HomeSense Status |
|---|---|---|
| Media source | Search, manual URL input, playlist items, local/storage items | Partial: Bilibili search and playlist exist |
| Resource sniffer | Turn a web page or raw URL into playable candidates | Missing in HomeSense |
| Stream resolver | Turn a logical item into an upstream stream URL | Partial: Bilibili audio resolver exists |
| Media proxy | Expose LAN-reachable URLs with headers/range/transcode policy | Partial: Bilibili audio proxy exists |
| Browser player | Local playback and queue state | Exists: `PlayerDock` and media player state |
| Output discovery | Find output targets | Partial: XiaoAi and DLNA discovery exist |
| Output controller | Push URL and send playback controls | Partial: XiaoAi and DLNA controls exist |
| Cast session | Track active output, state, errors and progress | Basic UI-edge polling only |

## Existing HomeSense Pieces

| Piece | Location | Role |
|---|---|---|
| Bilibili provider | `packages/media-cli/src/media_cli/bilibili.py` | Search, info and audio URL resolution |
| DLNA provider | `packages/media-cli/src/media_cli/dlna.py` | SSDP discovery, `SetAVTransportURI`, play/pause/stop/volume/status |
| Media API | `apps/server/src/media/media.controller.ts` | Playlist API, Bilibili audio proxy, XiaoAi/DLNA Bilibili push |
| Media state | `apps/web/src/features/media/player.ts` | Browser queue and playback state |
| Player dock | `apps/web/src/components/media/PlayerDock.vue` | Global browser playback UI |
| Output panel | `apps/web/src/components/media/MediaOutputPanel.vue` | Browser/XiaoAi/DLNA output picker and controls |
| Virtual XiaoAi DLNA | `apps/server/src/media/virtual-dlna.service.ts` | Publishes XiaoAi speakers as HomeSense DLNA renderers |

## Reference Pieces Not Yet Integrated

| Reference | Useful Part | HomeSense Shape |
|---|---|---|
| `D:\files\bilibili-music\backend\app\sniffer\extractor.py` | `yt-dlp` + Playwright page/network sniffing | `media-cli sniff_url` provider |
| `D:\files\bilibili-music\backend\app\service\cast_service.py` | Workflow from sniff result to `play_url` to DLNA push | Split into sniffer, proxy and output controller |
| `D:\files\bilibili-music\backend\app\proxy\audio_proxy.py` | Token URL, headers, range and video proxy policy | Nest media proxy service/controller |
| `D:\files\References\dlan嗅探\cat-catch` | Browser extension `webRequest` capture and request headers | Future browser companion/provider, not server core |
| `D:\files\References\dlan嗅探\m3u8-extractor` | `yt-dlp` first, Selenium/network fallback | Optional advanced server-side sniffer provider |
| `D:\files\References\dlan嗅探\playon` | Range-aware media server and ffmpeg remux ideas | Future proxy/transcode runtime, not UI shell |

## Missing For Resource Sniff + Video Cast

| Capability | Needed Contract | Notes |
|---|---|---|
| URL sniffing | `sniff_url(input) -> MediaCandidate[]` | Should return candidates, not start playback |
| Generic play URL | `prepare_stream(candidate) -> proxied URL` | Handles MIME, headers, range and token policy |
| Video proxy | `/api/media/proxy/video/:token` | Separate from Bilibili audio proxy |
| DLNA generic push | `play_url(location, url, title, content_type)` | The CLI can already do most of this |
| Sniff workbench UI | URL input, candidates list, preview, output picker | Should live in media workbench, not device details |
| Session store | Active output, item, proxy URL, status and errors | Needed before richer multi-output behavior |

## Proposed Contracts

```ts
type MediaSourceKind = 'bilibili' | 'url' | 'local' | 'storage'
type MediaCandidateKind = 'page' | 'playlist' | 'stream'
type MediaStreamKind = 'audio' | 'video' | 'hls' | 'dash'
type MediaOutputKind = 'browser' | 'dlna' | 'xiaoai' | 'adb'

interface MediaCandidate {
  id: string
  source: MediaSourceKind
  kind: MediaCandidateKind
  stream_kind?: MediaStreamKind
  title: string
  url: string
  page_url?: string
  mime_type?: string
  duration_sec?: number
  thumbnail?: string
  headers?: Record<string, string>
  confidence?: number
  provider: string
}

interface PreparedMediaStream {
  id: string
  candidate_id: string
  url: string
  upstream_url?: string
  mime_type: string
  proxied: boolean
  expires_at?: string
  seekable?: boolean
}
```

## Minimal Next Slice

1. Add `media-cli sniff_url` with a small result schema.
2. Add `POST /api/media/sniff` in Nest, calling `media-cli`.
3. Add generic `POST /api/media/outputs/dlna/play-url`.
4. Add a video proxy token service only for direct `mp4/webm/m3u8` candidates.
5. Add a compact URL sniff section in `MediaWorkbenchView`, reusing `MediaOutputPanel`.

## Boundaries

- Sniffer does not control DLNA.
- DLNA controller does not parse websites.
- Proxy does not decide playlist UI.
- Browser player does not know whether the source came from Bilibili, sniffing or local storage.
- Device detail pages remain for device-native capabilities; media sniffing and casting live in the system media workbench.
