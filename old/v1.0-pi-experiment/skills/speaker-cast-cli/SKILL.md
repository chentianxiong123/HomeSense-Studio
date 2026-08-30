# Speaker Cast CLI

Speaker Cast CLI exposes speaker discovery, Bilibili music push, playback control, and volume control as a HomeSense Studio CLI capability.

## Role

Use this skill when a workflow needs to list speakers, check speaker service status, push Bilibili music to a speaker, control playback, or adjust volume.

This executor does not synthesize speakers or media. The current adapter calls the real `D:\files\bilibili-music` service. If that service is not running, actions return `CAST_SERVICE_UNAVAILABLE`.

Default adapter endpoint:

```text
http://127.0.0.1:28974
```

Override with `HOMESENSE_BILIBILI_MUSIC_BASE_URL`, `BILIBILI_MUSIC_BASE_URL`, `HOMESENSE_CAST_BASE_URL`, `CAST_SERVICE_BASE_URL`, or per-call `base_url`.

## Actions

- `health`: check adapter readiness and source service reachability.
- `service_status`: read speaker service status.
- `list_speakers`: list available speaker devices.
- `search_bilibili`: search Bilibili media entries.
- `resolve_audio`: resolve audio stream metadata by `bvid`.
- `play_bilibili`: push Bilibili music to a speaker.
- `control_playback`: control speaker playback.
- `get_volume`: get speaker volume.
- `set_volume`: set speaker volume.

## Workflow Pattern

1. `speaker-cast-cli.health`
2. `speaker-cast-cli.service_status`
3. `speaker-cast-cli.list_speakers`
4. `speaker-cast-cli.search_bilibili` or `speaker-cast-cli.resolve_audio`
5. `speaker-cast-cli.play_bilibili`

In Workflow Studio, call this through the shared executor node:

```json
{
  "executor_name": "cli.invoke",
  "params": {
    "cli_name": "speaker-cast-cli",
    "action": "list_speakers",
    "params": {}
  }
}
```
