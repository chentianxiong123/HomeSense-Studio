"""
adb-cli — Android Debug Bridge Command Line Interface
Multi-device support via `device` param (ip:port) on each action.

Usage:
    python -m adb_cli run '{"action":"list_devices"}'
    python -m adb_cli run '{"action":"connect","device":"192.168.31.124:5555"}'
    python -m adb_cli run '{"action":"press_key","key":"home","device":"192.168.31.124:5555"}'
"""
import json
import os
import base64
import subprocess
import sys
import time

from . import connection as adb_connection
from . import controls as adb_controls
from . import files as adb_files
from .scrcpy import scrcpy_command_spec, scrcpy_version
from .utils import (
    _first_match,
    _parse_battery,
    _parse_getprop,
    _parse_meminfo,
    _parse_storage,
    _prop_value,
)

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

ADB_PATH = os.getenv("ADB_PATH", "adb")
DEFAULT_DEVICE = os.getenv("ADB_DEFAULT_DEVICE", "")

# In-memory connected device cache: { "ip:port": True }
# Avoids redundant adb connect calls between successive actions.
_connected_cache: set[str] = set()

# ─── helpers ───────────────────────────────────────────────────────────────

def _get_device_flag(params: dict) -> list[str]:
    """Return ['-s', 'device'] prefix if a device address is specified."""
    device = params.get("device") or params.get("dev") or DEFAULT_DEVICE
    if device:
        return ["-s", device]
    return []


def _run_cmd(args: list[str], timeout: int = 10) -> tuple[str, str, int]:
    try:
        result = subprocess.run(
            [ADB_PATH] + args,
            capture_output=True, timeout=timeout,
        )
        stdout = result.stdout.decode("utf-8", errors="replace") if result.stdout else ""
        stderr = result.stderr.decode("utf-8", errors="replace") if result.stderr else ""
        return stdout, stderr, result.returncode
    except subprocess.TimeoutExpired:
        return "", "TIMEOUT", -1
    except FileNotFoundError:
        return "", f"adb not found at: {ADB_PATH}", -1


def _run_device_cmd(params: dict, args: list[str], timeout: int = 10) -> tuple[str, str, int]:
    """Run adb -s <device> <args>; invalidate connection cache on offline errors."""
    device_flag = _get_device_flag(params)
    stdout, stderr, code = _run_cmd(device_flag + args, timeout)
    # If command failed and device is offline/unauthorized, clear cache so
    # the next ensure_connected actually reconnects instead of skipping.
    if code != 0:
        combined = (stdout + stderr).lower()
        if any(sig in combined for sig in ("device offline", "device unauthorized", "error: device ", "not found")):
            for flag in device_flag:
                if ":" in flag or "." in flag:  # looks like an address
                    _connected_cache.discard(flag)
    return stdout, stderr, code


def _run_cmd_bytes(args: list[str], timeout: int = 10) -> tuple[bytes, str, int]:
    try:
        result = subprocess.run(
            [ADB_PATH] + args,
            capture_output=True, timeout=timeout,
        )
        stderr = result.stderr.decode("utf-8", errors="replace") if result.stderr else ""
        return result.stdout or b"", stderr, result.returncode
    except subprocess.TimeoutExpired:
        return b"", "TIMEOUT", -1
    except FileNotFoundError:
        return b"", f"adb not found at: {ADB_PATH}", -1


def _run_device_cmd_bytes(params: dict, args: list[str], timeout: int = 10) -> tuple[bytes, str, int]:
    stdout, stderr, code = _run_cmd_bytes(_get_device_flag(params) + args, timeout)
    if code != 0:
        combined = stderr.lower()
        if any(sig in combined for sig in ("device offline", "device unauthorized", "error: device ", "not found")):
            for flag in _get_device_flag(params):
                if ":" in flag or "." in flag:
                    _connected_cache.discard(flag)
    return stdout, stderr, code


def _extract_device(params: dict) -> str:
    return params.get("device") or params.get("dev") or DEFAULT_DEVICE or ""


def _shell_value(params: dict, command: str, timeout: int = 10) -> str:
    out, _, code = _run_device_cmd(params, ["shell", command], timeout=timeout)
    if code != 0:
        return ""
    return out.strip()


def _ensure_adb_target_ready(params: dict) -> dict:
    device = _extract_device(params)
    if not device:
        devices_result = handle_list_devices({})
        if devices_result.get("status") != "success":
            return devices_result
        online = [
            item for item in devices_result.get("data", {}).get("devices", [])
            if item.get("status") == "device"
        ]
        if len(online) == 1:
            selected = online[0].get("device_id", "")
            return {
                "status": "success",
                "data": {"message": "single_device_selected", "device": selected, "adb_status": "device"},
            }
        return {
            "status": "error",
            "error": "DEVICE_REQUIRED",
            "message": "Pass a device serial/address when zero or multiple ADB devices are online",
            "data": {"online_devices": online},
        }

    if ":" in device:
        return handle_ensure_connected(params)

    status = _get_device_status(device)
    if status == "device":
        return {"status": "success", "data": {"message": "online", "device": device, "adb_status": status}}
    return {
        "status": "error",
        "error": "DEVICE_NOT_READY",
        "message": f"ADB target '{device}' is not online",
        "data": {"device": device, "adb_status": status},
    }


# ─── action handlers ───────────────────────────────────────────────────────

def _connection_deps() -> adb_connection.AdbDeps:
    return {
        "run_cmd": _run_cmd,
        "default_device": DEFAULT_DEVICE,
        "connected_cache": _connected_cache,
    }


def handle_list_devices(params: dict) -> dict:
    return adb_connection.handle_list_devices(params, _connection_deps())


def handle_scan_network(params: dict) -> dict:
    return adb_connection.handle_scan_network(params, _connection_deps())


def _get_device_status(address: str) -> str | None:
    return adb_connection.get_device_status(address, _connection_deps())


def handle_connect(params: dict) -> dict:
    return adb_connection.handle_connect(params, _connection_deps())


def handle_disconnect(params: dict) -> dict:
    return adb_connection.handle_disconnect(params, _connection_deps())


def handle_overview(params: dict) -> dict:
    ensure = handle_ensure_connected(params)
    if ensure.get("status") != "success":
        return ensure

    props = _parse_getprop(_shell_value(params, "getprop", timeout=15))
    wm_size = _shell_value(params, "wm size", timeout=10)
    wm_density = _shell_value(params, "wm density", timeout=10)
    meminfo = _parse_meminfo(_shell_value(params, "cat /proc/meminfo", timeout=10))
    storage = _parse_storage(_shell_value(params, "df -k /data", timeout=10))
    battery = _parse_battery(_shell_value(params, "dumpsys battery", timeout=10))
    wlan0 = _shell_value(params, "ip addr show wlan0", timeout=10)

    current_app = handle_get_current_app(params)
    screen = _first_match(r"(?:Physical|Override) size:\s*([0-9]+x[0-9]+)", wm_size)
    density = _first_match(r"(?:Physical|Override) density:\s*(\d+)", wm_density)
    ip_address = _first_match(r"inet\s+(\d+\.\d+\.\d+\.\d+)", wlan0)
    mac_address = _first_match(r"link/ether\s+(([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2})", wlan0)

    manufacturer = _prop_value(props, "ro.product.manufacturer", "ro.product.vendor.manufacturer")
    model = _prop_value(props, "ro.product.model", "ro.product.vendor.model")
    market_name = _prop_value(
        props,
        "ro.product.marketname",
        "ro.config.marketing_name",
        "ro.vendor.oplus.market.enname",
        "ro.vivo.market.name",
        "ro.oppo.market.name",
    )

    return {
        "status": "success",
        "data": {
            "device": _extract_device(params),
            "name": market_name or " ".join(part for part in [manufacturer, model] if part).strip(),
            "manufacturer": manufacturer,
            "brand": _prop_value(props, "ro.product.brand", "ro.product.vendor.brand"),
            "model": model,
            "android_version": _prop_value(props, "ro.build.version.release"),
            "sdk_version": _prop_value(props, "ro.build.version.sdk"),
            "serialno": _prop_value(props, "ro.serialno", "ro.boot.serialno"),
            "abi": _prop_value(props, "ro.product.cpu.abi", "ro.product.cpu.abilist"),
            "screen": {"resolution": screen, "density": density},
            "memory": meminfo,
            "storage": storage,
            "battery": battery,
            "network": {"ip": ip_address, "mac": mac_address},
            "current_app": current_app.get("data") if current_app.get("status") == "success" else None,
        },
    }


def _file_deps() -> adb_files.AdbDeps:
    return {
        "ensure_connected": handle_ensure_connected,
        "run_device_cmd": _run_device_cmd,
        "run_device_cmd_bytes": _run_device_cmd_bytes,
        "shell_value": _shell_value,
        "extract_device": _extract_device,
    }


def handle_list_files(params: dict) -> dict:
    return adb_files.handle_list_files(params, _file_deps())


def handle_read_file(params: dict) -> dict:
    return adb_files.handle_read_file(params, _file_deps())


def handle_remove_files(params: dict) -> dict:
    return adb_files.handle_remove_files(params, _file_deps())


def handle_copy_files(params: dict) -> dict:
    return adb_files.handle_copy_files(params, _file_deps())


def handle_pull_file(params: dict) -> dict:
    return adb_files.handle_pull_file(params, _file_deps())


def handle_push_file(params: dict) -> dict:
    return adb_files.handle_push_file(params, _file_deps())


def handle_mkdir_path(params: dict) -> dict:
    return adb_files.handle_mkdir_path(params, _file_deps())


def handle_screenshot(params: dict) -> dict:
    try:
        from PIL import Image
    except ImportError:
        return {"status": "error", "error": "DEP_MISSING", "message": "Pillow not installed, run: pip install Pillow"}

    from io import BytesIO

    save_path = params.get("path")
    if not save_path:
        cache_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")
        os.makedirs(cache_dir, exist_ok=True)
        save_path = os.path.join(cache_dir, "screenshot.jpg")

    tv_path = "/data/local/tmp/screen.png"

    try:
        _, err1, code1 = _run_device_cmd(params, ["shell", "screencap", "-p", tv_path])
        if code1 != 0:
            return {"status": "error", "error": "EXEC_FAILED", "message": f"screencap failed: {err1}"}

        _, err2, code2 = _run_device_cmd(params, ["pull", tv_path, save_path])
        if code2 != 0:
            return {"status": "error", "error": "EXEC_FAILED", "message": f"pull failed: {err2}"}

        if not os.path.exists(save_path):
            return {"status": "error", "error": "FILE_NOT_FOUND", "message": "screenshot file not found after pull"}

        img = Image.open(save_path)
        if img.mode == "RGBA":
            rgb_img = Image.new("RGB", img.size, (255, 255, 255))
            rgb_img.paste(img, mask=img.split()[3])
            img = rgb_img
        elif img.mode != "RGB":
            img = img.convert("RGB")

        output = BytesIO()
        img.save(output, format="JPEG", quality=40, optimize=True)
        image_bytes = output.getvalue()
        with open(save_path, "wb") as f:
            f.write(image_bytes)

        data = {
            "path": save_path, "width": img.size[0], "height": img.size[1],
            "size_bytes": len(image_bytes),
        }
        if params.get("include_base64") or params.get("inline"):
            data["mime"] = "image/jpeg"
            data["base64"] = base64.b64encode(image_bytes).decode("ascii")

        return {
            "status": "success",
            "data": data,
        }
    except Exception as e:
        return {"status": "error", "error": "CLI_ERROR", "message": str(e)}


def handle_scrcpy_status(params: dict) -> dict:
    timeout = int(params.get("timeout") or 5)
    info = scrcpy_version(timeout=timeout)
    return {
        "status": "success" if info.get("available") else "error",
        "error": None if info.get("available") else info.get("error", "SCRCPY_UNAVAILABLE"),
        "data": {
            **info,
            "env": {
                "SCRCPY_PATH": os.getenv("SCRCPY_PATH", ""),
                "ADB_PATH": ADB_PATH,
            },
        },
    }


def handle_scrcpy_build_command(params: dict) -> dict:
    return {"status": "success", "data": scrcpy_command_spec(params, _extract_device(params))}


def handle_scrcpy_probe(params: dict) -> dict:
    ensure = _ensure_adb_target_ready(params)
    if ensure.get("status") != "success":
        return ensure

    probe_params = dict(params)
    selected_device = ensure.get("data", {}).get("device")
    if selected_device and not _extract_device(probe_params):
        probe_params["device"] = selected_device

    status = scrcpy_version(timeout=int(params.get("timeout") or 5))
    display = handle_get_display_size(probe_params)
    overview = handle_overview(probe_params) if params.get("include_overview") else {"status": "skipped"}
    command = scrcpy_command_spec({
        **probe_params,
        "profile": params.get("profile") or "browser_bridge",
        "audio": params.get("audio", False),
        "window": params.get("window", False),
        "playback": params.get("playback", False),
    }, _extract_device(probe_params))

    ready = bool(status.get("available")) and display.get("status") == "success"
    blockers = []
    if not status.get("available"):
        blockers.append(status.get("error") or "SCRCPY_UNAVAILABLE")
    if display.get("status") != "success":
        blockers.append(display.get("error") or "DISPLAY_PROBE_FAILED")

    return {
        "status": "success" if ready else "error",
        "error": None if ready else "SCRCPY_PROBE_FAILED",
        "data": {
            "ready": ready,
            "device": _extract_device(probe_params),
            "scrcpy": status,
            "display": display.get("data") if display.get("status") == "success" else None,
            "overview": overview.get("data") if overview.get("status") == "success" else None,
            "command": command,
            "blockers": blockers,
        },
    }


def _control_deps() -> adb_controls.AdbDeps:
    return {
        "run_device_cmd": _run_device_cmd,
        "extract_device": _extract_device,
    }


def handle_get_display_size(params: dict) -> dict:
    return adb_controls.handle_get_display_size(params, _control_deps())


def handle_get_ui_elements(params: dict) -> dict:
    return adb_controls.handle_get_ui_elements(params, _control_deps())


def handle_tap(params: dict) -> dict:
    return adb_controls.handle_tap(params, _control_deps())


def handle_tap_ratio(params: dict) -> dict:
    return adb_controls.handle_tap_ratio(params, _control_deps())


def handle_tap_element(params: dict) -> dict:
    return adb_controls.handle_tap_element(params, _control_deps())


def handle_swipe(params: dict) -> dict:
    return adb_controls.handle_swipe(params, _control_deps())


def handle_input_text(params: dict) -> dict:
    return adb_controls.handle_input_text(params, _control_deps())


def handle_press_key(params: dict) -> dict:
    return adb_controls.handle_press_key(params, _control_deps())


def handle_back(params: dict) -> dict:
    return adb_controls.handle_back(params, _control_deps())


def handle_home(params: dict) -> dict:
    return adb_controls.handle_home(params, _control_deps())


def handle_enter(params: dict) -> dict:
    return adb_controls.handle_enter(params, _control_deps())


def handle_volume_up(params: dict) -> dict:
    return adb_controls.handle_volume_up(params, _control_deps())


def handle_volume_down(params: dict) -> dict:
    return adb_controls.handle_volume_down(params, _control_deps())


def handle_power(params: dict) -> dict:
    return adb_controls.handle_power(params, _control_deps())


def handle_launch_app(params: dict) -> dict:
    return adb_controls.handle_launch_app(params, _control_deps())


def handle_get_current_app(params: dict) -> dict:
    return adb_controls.handle_get_current_app(params, _control_deps())


def handle_list_packages(params: dict) -> dict:
    return adb_controls.handle_list_packages(params, _control_deps())


def handle_check_package(params: dict) -> dict:
    return adb_controls.handle_check_package(params, _control_deps())


def handle_find_element(params: dict) -> dict:
    return adb_controls.handle_find_element(params, _control_deps())


def handle_wait(params: dict) -> dict:
    seconds = float(params.get("seconds", 1.0))
    time.sleep(seconds)
    return {"status": "success", "data": {"action": "wait", "seconds": seconds}}


def handle_ensure_connected(params: dict) -> dict:
    device = _extract_device(params)
    if not device:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Missing device address"}

    if ":" not in device:
        return {"status": "error", "error": "INVALID_PARAMS", "message": f"Missing port in device address: '{device}'. Use format ip:port (e.g. 192.168.1.100:5555)"}

    # Skip if already connected in this session
    if device in _connected_cache:
        return {
            "status": "success",
            "data": {"message": "cached", "device": device, "attempts": 0, "logs": []},
        }

    initial_wait = int(params.get("initial_wait_seconds", 0))
    max_attempts = int(params.get("max_attempts", 5))
    backoff = int(params.get("backoff_seconds", 2))
    logs = []

    if initial_wait > 0:
        time.sleep(initial_wait)

    for attempt in range(max_attempts):
        # Check current status without connect overhead
        st = _get_device_status(device)
        if st == "device":
            _connected_cache.add(device)
            return {
                "status": "success",
                "data": {
                    "message": "already_connected" if attempt == 0 else "reconnected",
                    "device": device, "attempts": attempt + 1, "logs": logs,
                },
            }

        # Connect via handle_connect
        connected = handle_connect({"device": device, "max_attempts": 3, "backoff_seconds": backoff})
        logs.append({"attempt": attempt + 1, "message": connected.get("data", {}).get("message", ""), "status": connected.get("status", "error")})

        if connected.get("status") == "success":
            # Verify the device is truly online
            st = _get_device_status(device)
            if st == "device":
                _connected_cache.add(device)
                return {
                    "status": "success",
                    "data": {"message": "connected", "device": device, "attempts": attempt + 1, "logs": logs},
                }

        if attempt < max_attempts - 1:
            time.sleep(backoff * (2 ** attempt))

    _connected_cache.discard(device)
    return {
        "status": "error", "error": "CONNECT_FAILED",
        "data": {"device": device, "attempts": max_attempts, "logs": logs},
    }
