# HomeSense ADB CLI Source

ADB automation source project for HomeSense.

This project mirrors the structure of a standalone CLI source repository:

- `main.py`: unified CLI entry
- `adb_cli/cli.py`: JSON CLI wrapper
- `config.json`: local OCR / OCR API / vision API config placeholders
- `adb_devices.json`: ADB device IP and port table
- `build.py`: build script placeholder for generating a Windows executable
- `SKILL.md`: source-side workflow notes

## Quick Start

```powershell
cd D:\files\HomeSense\homesense-adb-cli-source
python -m pip install -r requirements.txt
python main.py run "{\"action\":\"list_devices\"}"
python main.py run "{\"action\":\"ocr_local\"}"
```

## Device Import

Fill [adb_devices.json](/D:/files/HomeSense/homesense-adb-cli-source/adb_devices.json) with the device IP and port you want the wrapper to use by default.

Examples:

```powershell
python main.py run "{\"action\":\"ensure_connected\"}"
python main.py run "{\"action\":\"ensure_connected\",\"device_name\":\"tv\"}"
python main.py run "{\"action\":\"screenshot\",\"device_ip\":\"192.168.31.124\",\"device_port\":5555}"
```

## How To Find The Device IP

### 1. Find the TV or box IP address

On the Android TV or set-top box, usually go to:

1. `Settings`
2. `Network` or `Wi-Fi`
3. Find the current local IP address

Typical example:

```text
192.168.31.124
```

### 2. Confirm the ADB port

ADB over network usually uses:

```text
5555
```

If your device uses another port, put that value into `adb_devices.json`.

### 3. Verify with CLI

After filling the config, you can test with:

```powershell
python main.py run "{\"action\":\"ensure_connected\"}"
python main.py run "{\"action\":\"list_devices\"}"
```

If you prefer not to save it in the config file yet, you can also pass it inline:

```powershell
python main.py run "{\"action\":\"ensure_connected\",\"device_ip\":\"192.168.31.124\",\"device_port\":5555}"
```

## OCR And Vision Hooks

The CLI wrapper adds three source-project-only actions without touching the main project:

- `ocr_local`: take a screenshot, then run local OCR if installed
- `ocr_api`: send the screenshot to an OCR HTTP API
- `vision_api`: send the screenshot to a vision/image-understanding HTTP API

## Project Goal

This source repo wraps the existing implementation in `D:\files\HomeSense\agent\src\tools\adb\adb.py`
and presents it as an independent project that can later produce a release package such as
`homesense-adb-cli-skill-windows-amd64`.
