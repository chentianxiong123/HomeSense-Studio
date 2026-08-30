# Bilibili CLI

Local dry-run executor for Bilibili-oriented media workflow demos.

## Role

This skill proves that HomeSense Studio can treat a third-party media automation CLI as a first-class executor. It is intentionally dry-run first: no upload or network request is made unless a future implementation adds credentials and explicitly disables `dry_run`.

## Actions

- `health`: inspect runtime readiness and supported actions.
- `prepare_upload`: create a local upload draft with metadata and preflight checks.
- `set_metadata`: update a local draft.
- `list_drafts`: inspect staged drafts.
- `submit_upload`: validate and mark a draft as staged/submitted. Defaults to dry-run.

## State

Drafts are stored at `data/bilibili-cli-state.json` by default. Override with `HOMESENSE_BILIBILI_STATE` when testing in isolation.
