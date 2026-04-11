---
name: homesense-adb-cli-source
description: "Source project for HomeSense ADB CLI. Use when working on the ADB CLI wrapper itself, packaging it, or exposing ADB actions through JSON CLI."
---

# HomeSense ADB CLI Source

This directory is the source project, not the installed skill package.

## Typical Tasks

- run the JSON CLI wrapper
- test local OCR or external image APIs
- adjust packaging scripts
- extend the exposed CLI actions

## Commands

```powershell
python main.py run "{\"action\":\"list_devices\"}"
python main.py run "{\"action\":\"launch_app\",\"package\":\"com.xiaodianshi.tv.yst\"}"
python main.py run "{\"action\":\"ocr_local\"}"
python main.py run "{\"action\":\"ocr_api\",\"url\":\"https://example.com/ocr\"}"
python main.py run "{\"action\":\"vision_api\",\"url\":\"https://example.com/vision\",\"prompt\":\"Describe this TV screen\"}"
python build.py
```
