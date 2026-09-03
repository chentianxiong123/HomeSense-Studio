# DLNA Cast CLI

DLNA Cast CLI exposes media discovery and DLNA renderer control as a HomeSense Studio CLI capability.

## Role

Use this skill when a workflow needs to find DLNA renderer devices, resolve playable media, start casting, control playback, or inspect DLNA cast status.

This executor does not synthesize devices or media. The current adapter calls the real `D:\files\bilibili-music` service. If that service is not running, actions return `CAST_SERVICE_UNAVAILABLE`.

Default adapter endpoint:

```text
http://127.0.0.1:28974
```

Override with `HOMESENSE_BILIBILI_MUSIC_BASE_URL`, `BILIBILI_MUSIC_BASE_URL`, `HOMESENSE_CAST_BASE_URL`, `CAST_SERVICE_BASE_URL`, or per-call `base_url`.

## Actions

- `health`: check adapter readiness and source service reachability.
- `search_bilibili`: search Bilibili media entries.
- `resolve_audio`: resolve audio stream metadata by `bvid`.
- `discover_devices`: discover DLNA renderers.
- `sniff_media`: extract playable episodes from a media page.
- `resolve_play_url`: convert a media URL into a DLNA playable URL.
- `start_cast`: start casting to a DLNA renderer.
- `control_cast`: play, pause, stop, seek, or set volume on a DLNA renderer.
- `cast_status`: read DLNA transport status.

## Workflow Pattern

1. `dlna-cast-cli.health`
2. `dlna-cast-cli.discover_devices`
3. `dlna-cast-cli.sniff_media` or `dlna-cast-cli.resolve_audio`
4. `dlna-cast-cli.start_cast`
5. `dlna-cast-cli.cast_status`

In Workflow Studio, call this through the shared executor node:

```json
{
  "executor_name": "cli.invoke",
  "params": {
    "cli_name": "dlna-cast-cli",
    "action": "discover_devices",
    "params": {}
  }
}
```
