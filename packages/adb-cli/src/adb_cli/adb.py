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
import concurrent.futures
import ipaddress
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

from . import files as adb_files
from .scrcpy import scrcpy_command_spec, scrcpy_version
from .utils import (
    _default_ipv4_subnet,
    _first_match,
    _normalize_ports,
    _normalize_text,
    _parse_battery,
    _parse_getprop,
    _parse_meminfo,
    _parse_storage,
    _prop_value,
    _tcp_probe,
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

KEY_MAP = {
    "enter": "66", "tab": "61", "delete": "67", "backspace": "67",
    "space": "62", "escape": "111", "esc": "111",
    "dpad_up": "19", "dpad_down": "20", "dpad_left": "21", "dpad_right": "22",
    "dpad_center": "23", "page_up": "92", "page_down": "93",
    "power": "26", "camera": "27", "menu": "82", "search": "84",
    "back": "4", "home": "3", "volume_up": "24", "volume_down": "25",
    "wake": "224", "wakeup": "224",
    "media_play_pause": "85", "media_stop": "86", "media_next": "87",
    "media_previous": "88", "media_rewind": "89", "media_fast_forward": "90",
}


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

def handle_list_devices(params: dict) -> dict:
    out, stderr, code = _run_cmd(["devices", "-l"])
    if code != 0:
        return {"status": "error", "error": "EXEC_FAILED", "message": stderr or "failed to list devices"}

    devices = []
    for line in out.strip().split("\n"):
        line = line.strip()
        if line and not line.startswith("List"):
            parts = line.split()
            if len(parts) >= 2:
                devices.append({
                    "device_id": parts[0],
                    "status": parts[1],
                    "info": " ".join(parts[2:]) if len(parts) > 2 else "",
                })

    return {"status": "success", "data": {"devices": devices, "count": len(devices)}}


def handle_scan_network(params: dict) -> dict:
    subnet_text = str(params.get("subnet") or params.get("cidr") or "").strip() or _default_ipv4_subnet()
    ports = _normalize_ports(params.get("ports") or params.get("port"))
    timeout_ms = max(80, min(int(params.get("timeout_ms") or params.get("timeout") or 350), 3000))
    workers = max(8, min(int(params.get("workers") or 96), 256))
    limit = max(1, min(int(params.get("limit") or 512), 4096))

    try:
        network = ipaddress.ip_network(subnet_text, strict=False)
    except ValueError as exc:
        return {"status": "error", "error": "INVALID_SUBNET", "message": str(exc)}

    if network.version != 4:
        return {"status": "error", "error": "INVALID_SUBNET", "message": "Only IPv4 subnet scan is supported"}

    hosts = [str(host) for host in network.hosts()][:limit]
    timeout = timeout_ms / 1000
    candidates: list[dict] = []
    connected = {item.get("device_id"): item for item in handle_list_devices({}).get("data", {}).get("devices", [])}

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [
            executor.submit(_tcp_probe, host, port, timeout)
            for host in hosts
            for port in ports
        ]
        for future in concurrent.futures.as_completed(futures):
            candidate = future.result()
            if not candidate:
                continue
            status = connected.get(candidate["address"], {}).get("status")
            if status:
                candidate["adb_status"] = status
            candidates.append(candidate)

    candidates.sort(key=lambda item: tuple(int(part) for part in item["ip"].split(".")) + (int(item["port"]),))
    return {
        "status": "success",
        "data": {
            "subnet": str(network),
            "ports": ports,
            "timeout_ms": timeout_ms,
            "scanned": len(hosts) * len(ports),
            "candidates": candidates,
            "count": len(candidates),
        },
    }


def _get_device_status(address: str) -> str | None:
    """Poll adb devices for the given address and return its status (device/offline/None)."""
    out, _, _ = _run_cmd(["devices", "-l"], timeout=5)
    for line in out.splitlines():
        parts = line.strip().split()
        if len(parts) >= 2 and parts[0] == address:
            return parts[1]
    return None


def handle_connect(params: dict) -> dict:
    address = params.get("address") or params.get("device") or params.get("dev") or DEFAULT_DEVICE
    if not address:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Missing device address (use 'device' or 'address' param)"}

    if ":" not in address:
        return {"status": "error", "error": "INVALID_PARAMS", "message": f"Missing port in device address: '{address}'. Use format ip:port (e.g. 192.168.1.100:5555)"}

    max_attempts = int(params.get("max_attempts", 5))
    backoff_seconds = int(params.get("backoff_seconds", 2))
    logs = []

    for attempt in range(max_attempts):
        out, err, code = _run_cmd(["connect", address], timeout=15)
        combined = (out or err or "").strip()
        logs.append({"attempt": attempt + 1, "message": combined, "code": code})

        connect_ok = code == 0 and ("connected" in out.lower() or "already connected" in out.lower())
        if connect_ok:
            # Poll until device transitions offline -> device (up to 30s)
            for poll in range(30):
                st = _get_device_status(address)
                if st == "device":
                    _connected_cache.add(address)
                    return {
                        "status": "success",
                        "data": {"message": combined, "address": address, "attempts": attempt + 1, "logs": logs},
                    }
                if st is None:
                    break  # device vanished
                time.sleep(1)
            # After polling, if device is offline/unauthenticated, return error
            st = _get_device_status(address)
            if st != "device":
                return {
                    "status": "error", "error": "DEVICE_OFFLINE",
                    "message": f"Device {address} is {st or 'disconnected'} after connect",
                    "data": {"address": address, "attempts": attempt + 1, "logs": logs},
                }

        if attempt < max_attempts - 1:
            time.sleep(backoff_seconds * (2 ** attempt))

    return {
        "status": "error", "error": "CONNECT_FAILED",
        "message": logs[-1]["message"] if logs else "failed to connect",
        "data": {"address": address, "attempts": max_attempts, "logs": logs},
    }


def handle_disconnect(params: dict) -> dict:
    address = params.get("address") or params.get("device") or params.get("dev") or DEFAULT_DEVICE
    if not address:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Missing device address"}

    if ":" not in address:
        return {"status": "error", "error": "INVALID_PARAMS", "message": f"Missing port in device address: '{address}'. Use format ip:port (e.g. 192.168.1.100:5555)"}

    out, _, code = _run_cmd(["disconnect", address])
    _connected_cache.discard(address)
    if code != 0:
        return {"status": "error", "error": "EXEC_FAILED", "message": out.strip()}
    return {"status": "success", "data": {"message": out.strip(), "address": address}}


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


def handle_get_display_size(params: dict) -> dict:
    out, stderr, code = _run_device_cmd(params, ["shell", "wm", "size"])
    if code != 0:
        return {"status": "error", "error": "EXEC_FAILED", "message": stderr or "failed to get display size"}

    match = re.search(r"(\d+)\s*x\s*(\d+)", out)
    if not match:
        return {"status": "error", "error": "PARSE_ERROR", "message": f"unexpected output: {out.strip()}"}

    return {
        "status": "success",
        "data": {"width": int(match.group(1)), "height": int(match.group(2))},
    }


def handle_get_ui_elements(params: dict) -> dict:
    tv_xml_path = "/data/local/tmp/ui.xml"
    timeout = int(params.get("timeout", 15))

    try:
        _, err1, code1 = _run_device_cmd(params, ["shell", "uiautomator", "dump", tv_xml_path], timeout=timeout)
        if code1 != 0:
            return {"status": "error", "error": "EXEC_FAILED", "message": f"uiautomator failed: {err1}"}

        out2, _, code2 = _run_device_cmd(params, ["shell", "cat", tv_xml_path])
        if code2 != 0:
            return {"status": "error", "error": "EXEC_FAILED", "message": "read ui.xml failed"}

        root = ET.fromstring(out2)
        elements = []
        for idx, node in enumerate(root.iter("node")):
            text = node.get("text", "") or node.get("content-desc", "")
            bounds_str = node.get("bounds", "[0,0][0,0]")
            parts = bounds_str.replace("][", ",").strip("[]").split(",")
            if len(parts) == 4:
                box = [int(p) for p in parts]
                elements.append({
                    "index": idx,
                    "text": text,
                    "bounds": box,
                    "center": [(box[0] + box[2]) // 2, (box[1] + box[3]) // 2],
                    "clickable": node.get("clickable", "false") == "true",
                    "resource_id": node.get("resource-id", ""),
                    "class_name": node.get("class", ""),
                })

        formatted = "\n".join([
            f"[{e['index']}] {e['text']} @ {e['center']}"
            for e in elements if e["text"]
        ])

        return {
            "status": "success",
            "data": {
                "elements": elements, "count": len(elements), "formatted": formatted,
            },
        }
    except ET.ParseError as e:
        return {"status": "error", "error": "PARSE_ERROR", "message": f"XML parse failed: {e}"}
    except Exception as e:
        return {"status": "error", "error": "CLI_ERROR", "message": str(e)}


def handle_tap(params: dict) -> dict:
    x = params.get("x")
    y = params.get("y")
    if x is None or y is None:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Missing x or y"}

    _, stderr, code = _run_device_cmd(params, ["shell", "input", "tap", str(x), str(y)])
    if code != 0:
        return {"status": "error", "error": "EXEC_FAILED", "message": stderr or "tap failed"}
    return {"status": "success", "data": {"action": "tap", "x": x, "y": y}}


def handle_tap_ratio(params: dict) -> dict:
    x_ratio = params.get("x_ratio")
    y_ratio = params.get("y_ratio")
    if x_ratio is None or y_ratio is None:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Missing x_ratio or y_ratio"}

    size_result = handle_get_display_size(params)
    if size_result.get("status") == "success":
        d = size_result["data"]
        width, height = d["width"], d["height"]
    else:
        width, height = 1920, 1080

    x = int(width * x_ratio)
    y = int(height * y_ratio)
    return handle_tap({"x": x, "y": y, **({} if not _extract_device(params) else {"device": _extract_device(params)})})


def handle_tap_element(params: dict) -> dict:
    index = params.get("index")
    text = params.get("text")

    if index is None and text is None:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Must provide index or text"}

    ui_result = handle_get_ui_elements(params)
    if ui_result.get("status") != "success":
        return ui_result
    elements = ui_result["data"]["elements"]

    element = None
    if index is not None:
        for e in elements:
            if e.get("index") == index:
                element = e
                break

    if text is not None and element is None:
        target = _normalize_text(text)
        for e in elements:
            elem_text = _normalize_text(e.get("text", ""))
            if target and elem_text and (target in elem_text or elem_text in target):
                element = e
                break

    if element is None:
        return {"status": "error", "error": "ELEMENT_NOT_FOUND", "data": {"available_count": len(elements)}}

    center = element.get("center")
    if not center or len(center) != 2:
        return {"status": "error", "error": "ELEMENT_INVALID", "message": "Element missing center"}

    tap_result = handle_tap({"x": center[0], "y": center[1], **({} if not _extract_device(params) else {"device": _extract_device(params)})})
    return {
        "status": "success",
        "data": {
            "action": "tap_element",
            "element": {"index": element.get("index"), "text": element.get("text"), "center": center},
            "tap_result": tap_result.get("data"),
        },
    }


def handle_swipe(params: dict) -> dict:
    start_x = params.get("start_x")
    start_y = params.get("start_y")
    end_x = params.get("end_x")
    end_y = params.get("end_y")
    duration = params.get("duration", 300)

    if any(v is None for v in [start_x, start_y, end_x, end_y]):
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Missing start_x, start_y, end_x, or end_y"}

    _, stderr, code = _run_device_cmd(
        params, ["shell", "input", "swipe", str(start_x), str(start_y), str(end_x), str(end_y), str(duration)],
    )
    if code != 0:
        return {"status": "error", "error": "EXEC_FAILED", "message": stderr or "swipe failed"}
    return {
        "status": "success",
        "data": {
            "action": "swipe",
            "start": {"x": start_x, "y": start_y},
            "end": {"x": end_x, "y": end_y},
            "duration": duration,
        },
    }


def handle_input_text(params: dict) -> dict:
    text = params.get("text", "")
    if not text:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Missing text"}

    escaped = text.replace(" ", "%s")
    _, stderr, code = _run_device_cmd(params, ["shell", "input", "text", escaped])
    if code != 0:
        return {"status": "error", "error": "EXEC_FAILED", "message": stderr or "input_text failed"}
    return {"status": "success", "data": {"action": "input_text", "text": text}}


def handle_press_key(params: dict) -> dict:
    key = params.get("key", "")
    if not key:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Missing key"}

    key_lower = key.lower().strip()
    keycode = KEY_MAP.get(key_lower, key)
    if not str(keycode).isdigit():
        keycode = f"KEYCODE_{keycode.upper()}"

    _, stderr, code = _run_device_cmd(params, ["shell", "input", "keyevent", str(keycode)])
    if code != 0:
        return {"status": "error", "error": "EXEC_FAILED", "message": stderr or "press_key failed"}
    return {"status": "success", "data": {"action": "press_key", "key": key}}


def handle_back(params: dict) -> dict:
    return handle_press_key({**params, "key": "back"})


def handle_home(params: dict) -> dict:
    return handle_press_key({**params, "key": "home"})


def handle_enter(params: dict) -> dict:
    return handle_press_key({**params, "key": "enter"})


def handle_volume_up(params: dict) -> dict:
    return handle_press_key({**params, "key": "volume_up"})


def handle_volume_down(params: dict) -> dict:
    return handle_press_key({**params, "key": "volume_down"})


def handle_power(params: dict) -> dict:
    return handle_press_key({**params, "key": "power"})


def handle_launch_app(params: dict) -> dict:
    package = params.get("package") or params.get("package_name")
    if not package:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Missing package"}

    _run_device_cmd(params, ["shell", "cmd", "statusbar", "collapse"], timeout=5)

    out, stderr, code = _run_device_cmd(
        params, ["shell", "cmd", "package", "resolve-activity", "--brief", package],
        timeout=20,
    )

    component = None
    lines = [line.strip() for line in out.splitlines() if line.strip()]
    for line in reversed(lines):
        if "/" in line and package in line and not line.startswith("/system/"):
            component = line
            break

    if component:
        _, stderr, code = _run_device_cmd(params, ["shell", "am", "start", "-n", component], timeout=20)
    else:
        _, stderr, code = _run_device_cmd(
            params, ["shell", "monkey", "-p", package, "-c", "android.intent.category.LAUNCHER", "1"],
            timeout=20,
        )

    success = code == 0 and "Error" not in stderr
    return {
        "status": "success" if success else "error",
        "data": {
            "action": "launch_app", "package": package, "component": component,
        },
        "error": stderr.strip() if not success else None,
    }


def handle_get_current_app(params: dict) -> dict:
    out, _, code = _run_device_cmd(params, ["shell", "dumpsys", "window"], timeout=20)
    if code != 0:
        return {"status": "error", "error": "EXEC_FAILED", "message": "failed to get current app"}

    current_app = "unknown"
    activity = ""
    for line in out.split("\n"):
        if "mCurrentFocus" in line:
            # e.g. Window{abc123 def/com.example.MainActivity}
            import re as _re
            m = _re.search(r"([\w.]+/[\w./]+)", line)
            if m:
                activity = m.group(1)
                if "/" in activity:
                    current_app = activity.split("/")[0]
            break

    return {
        "status": "success",
        "data": {
            "current_app": current_app,
            "activity": activity,
            "raw_line": next((l.strip() for l in out.split("\n") if "mCurrentFocus" in l), ""),
        },
    }


def handle_list_packages(params: dict) -> dict:
    keyword = params.get("keyword", "")
    if keyword:
        out, stderr, code = _run_device_cmd(params, ["shell", "pm", "list", "packages", keyword], timeout=20)
    else:
        out, stderr, code = _run_device_cmd(params, ["shell", "pm", "list", "packages"], timeout=20)

    if code != 0:
        return {"status": "error", "error": "EXEC_FAILED", "message": stderr or "failed to list packages"}

    packages = [line.replace("package:", "").strip() for line in out.splitlines() if line.startswith("package:")]
    return {"status": "success", "data": {"packages": packages, "count": len(packages)}}


def handle_check_package(params: dict) -> dict:
    package = params.get("package")
    if not package:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Missing package"}

    result = handle_list_packages(params)
    if result.get("status") != "success":
        return result

    packages = result["data"]["packages"]
    installed = package in packages
    return {
        "status": "success",
        "data": {
            "package": package, "installed": installed,
            "matched": [p for p in packages if package in p],
        },
    }


def handle_find_element(params: dict) -> dict:
    text = params.get("text", "")
    if not text:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Missing text"}

    ui_result = handle_get_ui_elements(params)
    if ui_result.get("status") != "success":
        return ui_result

    target = _normalize_text(text)
    for e in ui_result["data"]["elements"]:
        elem_text = _normalize_text(e.get("text", ""))
        if target and elem_text and (target == elem_text or target in elem_text or elem_text in target):
            return {
                "status": "success",
                "data": {"element": e, "matched_text": e.get("text"), "query": text},
            }

    return {
        "status": "error", "error": "ELEMENT_NOT_FOUND",
        "data": {"available_count": ui_result["data"]["count"]},
    }


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
