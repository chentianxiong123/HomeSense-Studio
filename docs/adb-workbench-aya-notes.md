# ADB Workbench Notes From AYA

## Reference

Studied `D:\files\References\adb\AYA`, an Electron + React ADB desktop app. Its useful pattern for HomeSense is not a single command list, but a device-scoped workbench with persistent panels:

- Overview: device identity, Android version, screen, memory, storage, Wi-Fi, root, port mapping.
- File: remote file browser with path navigation, preview, upload/download, transfer progress.
- Application: package list plus start/stop/install/uninstall/clear/enable/disable.
- Process and performance: process table, CPU, memory, battery and FPS sampling.
- Shell: multiple terminal tabs backed by ADB shell sessions.
- Layout, screenshot, Logcat and WebView: inspection and stream-oriented debugging panels.

## HomeSense Shape

HomeSense should present ADB as a device detail workbench, not as scattered buttons. The first implementation is `apps/web/src/components/AdbWorkbench.vue`, mounted from `DeviceDetailView.vue` whenever a device has `props.adb_ip`.

The workbench is intentionally split into panels:

- Control: existing `adb-cli` actions such as connect, home, back, enter, volume, power, text input and coordinate tap.
- Apps: existing `adb-cli list_packages` and `launch_app` flow.
- Inspect: existing `current_app`, `ui_tree` and `tap_element` flow.
- Shell: existing WebSocket terminal stack through `TerminalPanel`.
- Files, Logcat, Metrics: visible placeholders for the AYA-equivalent capabilities that still need backend services.

## Backend Gaps

AYA implements most advanced features in Electron main process via `@devicefarmer/adbkit`. For HomeSense, these should become Nest services instead of renderer logic:

- `AdbDeviceService`: list/track devices, connect/disconnect/pair, overview collection.
- `AdbFileService`: readdir/stat/pull/push/delete/move plus progress events.
- `AdbLogcatGateway`: WebSocket stream with pause/resume/filter/save support.
- `AdbMetricsService`: periodic CPU/memory/battery/FPS samples.
- `AdbPackageService`: richer package operations beyond launch/list.
- Optional `scrcpy` service should be evaluated separately because browser delivery needs a streaming strategy, not direct Electron windows.

## scrcpy Integration

Studied `D:\files\References\adb\scrcpy`. Its desktop client pushes `scrcpy-server`
to the Android device, starts it through `app_process`, then uses an ADB tunnel
for video, audio and control sockets. Reverse tunnel is preferred by default;
`--force-adb-forward` is the explicit fallback path.

`packages/adb-cli` now exposes the first integration layer:

- `scrcpy_status`: detects the `scrcpy` binary from `SCRCPY_PATH` or PATH and reads `scrcpy --version`.
- `scrcpy_probe`: verifies the ADB target, reads display size and returns a browser-bridge-oriented launch spec.
- `scrcpy_command`: builds an argv-safe launch spec for a backend session manager.

The Nest backend now owns the scrcpy session lifecycle under
`/api/streaming-gateway/adb-scrcpy/sessions`:

- `GET /sessions`: list managed scrcpy sessions.
- `POST /sessions`: create a session from an ADB device and scrcpy options.
- `GET /sessions/:id`: inspect command, state, pid and output tails.
- `POST /sessions/:id/stop`: stop a running process.
- `DELETE /sessions/:id`: remove the session record and stop it if needed.

For browser bridge sessions, the backend now follows scrcpy's standalone raw
stream route:

- locate `scrcpy-server` from `SCRCPY_SERVER_PATH` or beside the scrcpy binary;
- `adb push` it to `/data/local/tmp/homesense-scrcpy-server.jar`;
- allocate a local TCP port and run `adb forward tcp:<port> localabstract:scrcpy_<scid>`;
- start the device server with `app_process ... tunnel_forward=true audio=false control=false cleanup=false raw_stream=true`;
- expose binary H.264 over `/api/streaming-gateway/adb-scrcpy/sessions/:id/stream.ws`.

The ADB workbench can create this bridge and connect a raw-stream probe that
counts received binary bytes. It also includes an experimental WebCodecs canvas
player for the H.264 elementary stream. The player parses Annex B start codes,
derives the H.264 codec string from SPS, and feeds access units into
`VideoDecoder`; real-device testing is still required to tune frame boundary
handling across vendors.

## Implementation Rule

Do not fake advanced ADB data in the UI. Keep disabled/pending panels visible so the product shape is clear, then enable each panel only when the matching backend API is real.
