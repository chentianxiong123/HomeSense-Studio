# Moonlight/Sunshine Workbench Notes

Reference studied: `D:\files\References\home\moonlight-web-stream`.

## Reference Project Shape

`moonlight-web-stream` is not just a web video player. It is a browser-facing Moonlight client:

- A web server stores Sunshine host records and pairing material.
- The browser lists hosts and applications.
- A dedicated stream route opens a full interactive viewer.
- The backend launches a streamer process, talks to Sunshine with Moonlight protocol, and forwards media/input through WebRTC or WebSocket.
- The frontend receives video/audio and sends keyboard, mouse, touch and gamepad input back to the stream.

Important reference files:

- `README.md`: describes the model as a web server forwarding Sunshine traffic to the browser through WebRTC.
- `src/api/host.rs`: host add/list/delete/pair/wake endpoints.
- `src/app/host.rs`: host info, pair, app list, app image, wake and cancel logic.
- `src/api/stream.rs`: WebSocket stream gateway; validates host/app, spawns streamer process, bridges IPC to browser WebSocket.
- `streamer/src/main.rs`: standalone Moonlight streaming process.
- `web/stream/index.ts`: browser stream controller, transport negotiation, video/audio setup.
- `web/stream/input.ts`: keyboard, mouse, touch and gamepad capture.
- `web/component/host/*`: saved host list and pair/open behavior.
- `web/component/game/*`: host application list and launch/resume/cancel behavior.

## What To Reuse

Reuse the architecture, not the UI code directly.

The useful idea is the layering:

1. Saved Sunshine host target
2. Pairing state and certificates
3. Application list per host
4. Stream session per launched app
5. Fullscreen viewer with input capture

The frontend stream pipeline is useful as a reference for later, but it is too large to paste into the current Vue app as-is. It depends on generated TypeScript bindings, custom component classes, worker pipelines, codec fallback logic, WebRTC signaling and Moonlight-specific transport channels.

## HomeSense Integration Direction

Moonlight/Sunshine should become its own workbench family, parallel to terminal, media and ADB.

Do not merge it into the music/video player. A normal media player plays files/URLs with media controls. Moonlight is an interactive remote display session with bidirectional input, pointer lock, keyboard lock, gamepad state and lifecycle control.

Recommended layers:

1. Authorization Center
   - Owns Sunshine host discovery/manual add.
   - Owns saved host records.
   - Owns pair/test/wake/delete.
   - Stores pair material on the server side only.
   - Same policy as SSH/ADB/DLNA: scan/save/test live in one place.

2. Game Stream Workbench
   - Lists saved Sunshine hosts.
   - Shows online/offline/paired/busy state.
   - Shows applications for a selected host.
   - Starts, resumes or stops sessions.
   - Does not own host pairing or persistent credentials.

3. Stream Viewer
   - Fullscreen route or fullscreen-capable component.
   - Owns live video/audio rendering.
   - Owns keyboard/mouse/touch/gamepad capture.
   - Owns stream stats, reconnect and stop controls.
   - Should be isolated from the regular dashboard layout.

## Frontend Component Presentation

Use independent components first. Avoid building a generic component registry before real use proves the shape.

Suggested files when implementation starts:

- `apps/web/src/views/GameStreamWorkbenchView.vue`
  - Main Moonlight/Sunshine workbench page.
  - Select saved host, show app grid, launch session.

- `apps/web/src/components/stream/SunshineHostList.vue`
  - Saved hosts, status, selected host.

- `apps/web/src/components/stream/SunshineAppGrid.vue`
  - Apps from selected host, app artwork, active-session state.

- `apps/web/src/components/stream/MoonlightStreamViewer.vue`
  - The full live viewer surface.
  - Later can wrap imported/adapted stream pipeline code.

- `apps/web/src/components/stream/StreamSessionControls.vue`
  - Stop/resume/fullscreen/stats/transport indicators.

- `apps/web/src/api/streaming.ts`
  - Frontend API facade for host/app/session endpoints.

Authorization Center additions:

- Add a Sunshine/Moonlight provider section next to SSH/ADB/DLNA.
- Fields: name, address, HTTP port, optional MAC, notes.
- Actions: scan, save, test, pair, wake, delete.
- Pair flow should display the PIN and wait for Sunshine confirmation, like the reference project.

## Backend Shape

The backend should be responsible for Moonlight protocol state.

Recommended service split:

- `streaming-host.service.ts`
  - CRUD for Sunshine host targets in existing device/target storage.
  - Normalizes address/ports.
  - Stores pair state and server/client certificates securely.

- `sunshine-client.service.ts`
  - Server info, pair, app list, app image, wake, cancel.
  - Can initially wrap a CLI/helper process if using Rust or native Moonlight libraries is easier.

- `moonlight-session.gateway.ts`
  - WebSocket gateway for stream session signaling and event relay.
  - Similar responsibility to the reference `src/api/stream.rs`.

- `moonlight-streamer` helper
  - Later phase.
  - Keeps Moonlight protocol and codec/WebRTC work out of the Nest main process.

For the first HomeSense milestone, implement target management and app listing before attempting real stream playback.

## Unified Frontend Rule

Unification should happen at the product rule level, not by forcing all tools into one mega component.

Current rule:

- Authorization Center is where connection targets are discovered, saved, paired and tested.
- Workbenches are where saved targets are used.
- Runtime panels are independent reusable surfaces:
  - `TerminalPanel` for shell sessions.
  - `RemoteFileBrowserPanel` for files.
  - `PlayerDock` and media panels for normal media playback.
  - `MoonlightStreamViewer` for interactive game/desktop stream sessions.

This keeps SSH, ADB, DLNA, media and Moonlight in one system without making them share an unnatural UI.

## Implementation Order

1. Add documentation and UI placeholder route for Game Stream Workbench.
2. Add Sunshine target model in Authorization Center using saved device props or a dedicated target table.
3. Add manual save/test for Sunshine host.
4. Add pair flow and server-side secure pair material storage.
5. Add saved host list and app list in `GameStreamWorkbenchView`.
6. Add stream session gateway and helper process.
7. Add `MoonlightStreamViewer` with video/audio/input pipeline.

Do not start with video decoding. The hard part is protocol/session ownership. The visible stream viewer becomes much easier once host save, pair, app list and launch lifecycle are stable.

## Current HomeSense Status

Implemented in this pass:

- `apps/server/src/streaming/streaming-gateway.*`
  - Adds `/api/streaming-gateway/hosts`.
  - Saves Sunshine hosts into existing `devices.props` with `device_type: 'sunshine_host'`.
  - Supports list, register, delete, HTTP probe, Wake-on-LAN and runtime status.

- `apps/web/src/views/AuthorizationsView.vue`
  - Adds Streaming under local providers.
  - Sunshine host save/probe/wake/delete now lives in the unified Authorization Center.

- `apps/web/src/views/GameStreamWorkbenchView.vue`
  - Adds a first-class `/streaming` workbench for using saved Sunshine/Moonlight targets.
  - It currently shows saved hosts and runtime planning; app list and live stream viewer are next.

- `apps/web/src/components/remote-workspace/StreamingGatewayPanel.vue`
  - Reused as a standalone control panel with its own scoped styling.

Next concrete step:

1. Add Sunshine pair flow and server-side certificate storage.
2. Add app list/image read for a saved Sunshine host.
3. Add a fullscreen `MoonlightStreamViewer` route after pairing and app listing work.
