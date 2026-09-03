# Media Workbench Notes From HomeCast

## Reference

Studied `D:\files\bilibili-music` as a reference only. Do not modify that project. It is a larger HomeCast app that combines several systems:

- Bilibili media source: search, video info, audio URL resolution and favorite-list reads.
- Browser player: a hidden `audio`/`video` element, global playback state, queue controls and progress persistence.
- Local playlist and cache: JSON playlist storage plus BVID-keyed MP3 cache backed by FFmpeg transcoding.
- Media proxy: short-lived token URLs that hide original upstream URLs and expose browser/DLNA/speaker-friendly streams.
- DLNA cast: SSDP discovery, AVTransport/RenderingControl SOAP control, status polling and URL sniffing.
- XiaoAi speaker push: Mi account login, device discovery, Bilibili audio resolution, proxy URL push and playback/volume controls.
- Android wrapper: Capacitor packaging around the same Vue UI.

The useful pattern is not the full app shell. It is the split between media source, media session, output device and proxy runtime.

## Old Project Shape

Backend is a thin FastAPI router layer over independent services:

- `app.service.music_service.MusicService`
  - wraps `app.bilibili.client`, `search`, `video` and `audio`
  - emits normalized `MusicItem`, `VideoInfoResult` and `AudioStreamResult`
- `app.service.playlist_service.PlaylistService`
  - owns `data/playlist.json`
  - stores BVID, title, artist, cover and duration
- `app.proxy.audio_proxy`
  - exposes `/api/v1/music/stream/{bvid}`
  - checks BVID cache first, otherwise resolves Bilibili audio and transcodes/streams
- `app.proxy.token_store`
  - creates one-hour opaque tokens for raw media URLs
  - used by speaker and DLNA paths so devices receive a LAN-accessible URL
- `app.service.cast_service.CastService`
  - owns DLNA discovery, controller cache and URL sniffing
  - maps `discover`, `play_url`, `start`, `control`, `status`
- `app.service.speaker_service.SpeakerService`
  - owns XiaoAi device list, push-to-speaker and volume/playback control
  - depends on both Mi auth and Bilibili audio resolution

Frontend has one global player core and several workbench pages:

- `src/core/player.ts`
  - hidden media element
  - queue, current item, progress, volume, play mode and persistence
- `src/stores/player.ts`
  - facade used by UI
  - also carries speaker push state and polling
- `src/components/player/PlayerBar.vue`
  - global bottom dock with compact controls and drawer
- `src/views/SearchView.vue`
  - media source browser, calls search and then player store
- `src/views/PlaylistView.vue`
  - queue management, backed by backend playlist API
- `src/views/CastView.vue`
  - video URL sniffing, DLNA device picker, local video preview and DLNA controls
- `src/components/player/SpeakerPush.vue`
  - XiaoAi login and target picker, called from `PlayerBar`

## HomeSense Shape

HomeSense should not embed the old project. It should extract the contracts and rebuild around the existing HomeSense adapter model.

Recommended frontend placement:

- `apps/web/src/views/MediaWorkbenchView.vue`
  - full media workbench: source search, playlist, output devices, cast/session status
- `apps/web/src/components/media/PlayerDock.vue`
  - global mini player mounted by `App.vue`, hidden on fullscreen routes
- `apps/web/src/components/media/MediaControlPanel.vue`
  - compact device-detail panel for TVs, boxes and speakers
- `apps/web/src/features/media/player.ts`
  - media session state: queue, current item, progress, volume, target output
- `apps/web/src/api/media.ts`
  - typed API client for media source, session and output operations

Recommended backend placement:

- Start with a built-in `media-cli` package, parallel to `mi-cli` and `adb-cli`.
- Add `media-cli` to `CLIBridge` registration instead of wiring a large FastAPI app into Nest.
- Later promote stable pieces into first-class Nest modules only when persistence, streaming or long-running session ownership requires it.

Current implementation:

- `packages/media-cli` exists with Bilibili search, media info and audio resolution actions.
- `apps/server/src/media` exposes a minimal Bilibili audio proxy at `/api/media/proxy/audio/bilibili/:bvid`.
- `apps/server/src/media` persists the browser playlist in SQLite via `/api/media/playlist`.
- `apps/web/src/views/MediaWorkbenchView.vue` can search Bilibili, play results through the HomeSense proxy and add Bilibili/direct URL items to the persisted queue.
- Queue item removal, clear and reorder operations are persisted back to SQLite.
- Browser playback now mirrors HomeCast's core play modes: order, loop, single and random, with the selected mode stored in localStorage.
- The output panel can discover XiaoAi speakers through the existing `mi-cli speaker_list` path and shows them beside browser/DLNA/ADB targets.
- XiaoAi push wiring exists through `POST /api/media/outputs/xiaoai/play-bilibili`: HomeSense generates a LAN absolute proxy URL and calls `mi-cli speaker_play_url`. Mina device mapping now uses a `micoapi` service token and GET `/admin/v2/device_list?master=0`; `speaker_list` and `speaker_status` resolve Mina `deviceID`/`hardware` for discovered speakers.
- XiaoAi output controls now route through `mi-cli speaker_control` for pause, resume, stop and volume. Mina non-zero responses are surfaced as errors; current test device returned `No available MQTT connection`, which means Mina can resolve the device but the live cloud control channel is unavailable.
- DLNA discovery is available through `media-cli dlna_discover` and `/media` maps discovered renderers into the same output panel.
- DLNA playback/control now uses the same output contract as XiaoAi: `media-cli dlna_play_url` sends `SetAVTransportURI` plus `Play`, `dlna_control` wraps `Play/Pause/Stop/SetVolume`, and `dlna_status` reads transport, position and volume where the renderer supports it. `POST /api/media/outputs/dlna/play-bilibili` generates a LAN absolute Bilibili proxy URL before calling the CLI, so renderers never need to reach Bilibili directly.
- HomeSense now also has a MiAir-style virtual DLNA layer for XiaoAi speakers. `apps/server/src/media/virtual-dlna.service.ts` publishes each discovered XiaoAi speaker as a local DLNA MediaRenderer over SSDP and exposes UPnP device description/SOAP endpoints under `/api/media/virtual-dlna`. Incoming `SetAVTransportURI`, `Play`, `Pause`, `Stop`, `GetTransportInfo`, `GetPositionInfo`, `GetVolume` and `SetVolume` are translated to existing Mina-backed `mi-cli speaker_*` actions.
- `apps/web/src/components/media/PlayerDock.vue` provides the global browser playback dock.
- Real DLNA control, XiaoAi direct push, and XiaoAi virtual DLNA all exist as provider paths. Local file ingestion, BVID cache, event subscription and richer cross-output session ownership are still provider work to add later.

Initial actions should mirror the old service boundaries:

- `search_bilibili`
- `get_media_info`
- `resolve_audio`
- `playlist_list`
- `playlist_add`
- `playlist_remove`
- `cache_list`
- `cache_create`
- `dlna_discover`
- `dlna_start`
- `dlna_control`
- `speaker_list`
- `speaker_push_bilibili`
- `speaker_control`

## Contract

Use one shared UI contract across Bilibili, local media, DLNA and speaker paths:

```ts
type MediaSourceKind = 'bilibili' | 'url' | 'local'
type MediaOutputKind = 'browser' | 'dlna' | 'xiaoai' | 'adb'

interface MediaItem {
  id: string
  source: MediaSourceKind
  title: string
  artist?: string
  cover?: string
  duration_sec?: number
  upstream_id?: string
  upstream_url?: string
  stream_url?: string
  mime_type?: string
}

interface MediaOutput {
  id: string
  kind: MediaOutputKind
  name: string
  device_id?: number
  endpoint?: string
  online?: boolean
}

interface MediaSession {
  id: string
  item: MediaItem | null
  output: MediaOutput
  state: 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'error'
  position_sec: number
  duration_sec: number
  volume?: number
}
```

The UI should only depend on this contract. Protocol-specific work stays behind providers.

## What To Reuse

Reuse these ideas directly:

- global player dock persists across navigation
- hidden browser media element for local/browser playback
- BVID-keyed cache, not raw URL keyed cache
- proxy token layer for DLNA/speaker-compatible URLs
- speaker/DLNA status polling at the UI edge
- device picker separated from play controls
- source search separated from output selection

Do not reuse these parts directly:

- Tailwind/Naive UI styling from HomeCast; HomeSense has its own visual system
- the full FastAPI app shell
- mock data toggles
- Capacitor Android shell
- direct global singleton services inside app code without HomeSense registration

## Implementation Order

1. Add the media contract and a frontend-only `PlayerDock` that can play a direct URL in the browser.
2. Add `MediaWorkbenchView` with search/queue/output sections, initially backed by empty/pending providers.
3. Create `packages/media-cli` by extracting only Bilibili search/info/audio resolution from old HomeCast.
4. Register `media-cli` in the server CLI bridge and expose it through `cliApi`.
5. Add BVID streaming/proxy support. This may need a Nest controller instead of CLI because browser playback requires a long-lived HTTP stream.
6. Persist the browser playlist in SQLite and hydrate the queue on `/media` mount.
7. Add DLNA discovery/control as a separate provider.
8. Reuse existing `mi-cli` speaker status/list work where possible; only add media-specific speaker push once proxy URLs exist.
9. Add device-detail `MediaControlPanel` for speaker/TV/ADB devices using the same session store.

## Rule

Keep media source, playback session and output device as separate layers. A player button should not know whether the stream came from Bilibili, a sniffed URL or a local file, and it should not know whether the output is browser audio, DLNA or XiaoAi.
