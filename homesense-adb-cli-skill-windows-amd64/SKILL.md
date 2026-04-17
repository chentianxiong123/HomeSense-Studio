---
name: homesense-adb-cli
description: "ADB automation via CLI. Use when the user needs TV, Android, or set-top box control through HomeSense ADB actions."
---

# HomeSense ADB CLI Skill

Control the connected Android TV or box through a single local launcher.

## Binary Path

The launcher is in the same directory as this skill file.

- Windows dev package: `adb-cli.cmd`
- Future release package: `adb-cli.exe`

## Step 0

Always verify connectivity first:

```powershell
<BIN> run "{\"action\":\"list_devices\"}"
<BIN> run "{\"action\":\"ensure_connected\"}"
```

## Common Commands

```powershell
<BIN> run "{\"action\":\"get_ui_elements\"}"
<BIN> run "{\"action\":\"launch_app\",\"package\":\"com.xiaodianshi.tv.yst\"}"
<BIN> run "{\"action\":\"back\"}"
<BIN> run "{\"action\":\"ocr_local\"}"
```

## Workflow

1. Observe with `get_ui_elements`
2. Act with `launch_app`, `tap_element`, `back`, or other actions
3. Re-observe after the screen changes

## OCR And Vision

You can also call these source-wrapper actions:

```powershell
<BIN> run "{\"action\":\"ocr_local\"}"
<BIN> run "{\"action\":\"ocr_api\",\"url\":\"https://example.com/ocr\"}"
<BIN> run "{\"action\":\"vision_api\",\"url\":\"https://example.com/vision\",\"prompt\":\"Describe the current screen\"}"
```
