# Bilibili CLI

Real Bilibili CLI bridge for HomeSense Studio.

## Role

This skill wraps the upstream `jackwener/bilibili-cli` checkout as a structured executor.
It is for read/query actions first: status, profile, search, video details, rankings, feed, collections, and interaction calls.

## How it runs

- The local bridge lives at `packages/bilibili-cli/src/index.mjs`
- It calls the reference checkout with `uv run bili ... --json`
- The bridge converts the upstream `ok/schema_version/data/error` envelope into the HomeSense `{ status, data, error }` shape

## Use

Prefer narrow queries:

- `health`
- `status`
- `whoami`
- `video`
- `user`
- `user_videos`
- `search`
- `hot`
- `rank`
- `favorites`
- `following`
- `watch_later`
- `history`
- `feed`
- `my_dynamics`
- `dynamic_post`
- `dynamic_delete`
- `like`
- `coin`
- `triple`
- `unfollow`

## Notes

- `health` does not touch the network.
- `video` can include subtitles, comments, AI summary, and related videos.
- Write actions still require the upstream CLI's real authentication.
- If you need a different reference checkout, set `HOMESENSE_BILIBILI_CLI_DIR`.
