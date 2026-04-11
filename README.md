# HomeSense ADB CLI Source

ADB automation source project for HomeSense.

This project mirrors the structure of a standalone CLI source repository:

- `main.py`: unified CLI entry
- `adb_cli/cli.py`: JSON CLI wrapper
- `config.json`: local OCR / OCR API / vision API config placeholders
- `build.py`: build script placeholder for generating a Windows executable
- `SKILL.md`: source-side workflow notes

## Quick Start

```powershell
cd D:\files\HomeSense\homesense-adb-cli-source
python -m pip install -r requirements.txt
python main.py run "{\"action\":\"list_devices\"}"
python main.py run "{\"action\":\"ocr_local\"}"
```

## OCR And Vision Hooks

The CLI wrapper adds three source-project-only actions without touching the main project:

- `ocr_local`: take a screenshot, then run local OCR if installed
- `ocr_api`: send the screenshot to an OCR HTTP API
- `vision_api`: send the screenshot to a vision/image-understanding HTTP API

Example payloads:

```powershell
python main.py run "{\"action\":\"ocr_local\"}"
python main.py run "{\"action\":\"ocr_api\",\"url\":\"https://example.com/ocr\"}"
python main.py run "{\"action\":\"vision_api\",\"url\":\"https://example.com/vision\",\"prompt\":\"Describe the screen\"}"
```

If you want to reuse the same endpoint each time, fill in [config.json](/D:/files/HomeSense/homesense-adb-cli-source/config.json).

## Project Goal

This source repo wraps the existing implementation in `D:\files\HomeSense\agent\src\tools\adb\adb.py`
and presents it as an independent project that can later produce a release package such as
`homesense-adb-cli-skill-windows-amd64`.
