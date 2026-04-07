"""
ADB 工具 - Android Debug Bridge
通过 adb 命令控制安卓设备
"""
import subprocess
import os
import json
import sys
from io import BytesIO

TV_IP = os.getenv("TV_IP", "192.168.31.124")
TV_PORT = os.getenv("TV_PORT", "5555")
ADB_PATH = os.getenv("ADB_PATH", "adb")
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")

TV_TEMP_DIR = "/data/local/tmp"


def get_adb_prefix() -> list[str]:
    return [ADB_PATH, "-s", f"{TV_IP}:{TV_PORT}"]


def run_cmd(args: list[str], timeout: int = 10) -> tuple[str, str, int]:
    cmd = get_adb_prefix() + args
    result = subprocess.run(cmd, capture_output=True, timeout=timeout)
    stdout = result.stdout.decode("utf-8", errors="replace") if result.stdout else ""
    stderr = result.stderr.decode("utf-8", errors="replace") if result.stderr else ""
    return stdout, stderr, result.returncode


def run_global_cmd(args: list[str], timeout: int = 10) -> tuple[str, str, int]:
    result = subprocess.run([ADB_PATH] + args, capture_output=True, timeout=timeout)
    stdout = result.stdout.decode("utf-8", errors="replace") if result.stdout else ""
    stderr = result.stderr.decode("utf-8", errors="replace") if result.stderr else ""
    return stdout, stderr, result.returncode


def list_devices() -> dict:
    out, _, code = run_global_cmd(["devices", "-l"])
    if code != 0:
        return {"success": False, "error": "failed to list devices"}

    devices = []
    for line in out.strip().split("\n"):
        line = line.strip()
        if line and not line.startswith("List"):
            parts = line.split()
            if len(parts) >= 2:
                devices.append({
                    "id": parts[0],
                    "status": parts[1],
                    "info": " ".join(parts[2:]) if len(parts) > 2 else ""
                })

    return {"success": True, "devices": devices, "count": len(devices)}


def connect_device(ip: str, port: int = 5555) -> dict:
    out, _, code = run_global_cmd(["connect", f"{ip}:{port}"])
    return {"success": code == 0, "message": out.strip()}


def disconnect_device(ip: str, port: int = 5555) -> dict:
    out, _, code = run_global_cmd(["disconnect", f"{ip}:{port}"])
    return {"success": code == 0, "message": out.strip()}


KEY_MAP = {
    "enter": "66", "tab": "61", "delete": "67", "backspace": "67",
    "space": "62", "escape": "111", "esc": "111", "dpad_up": "19",
    "dpad_down": "20", "dpad_left": "21", "dpad_right": "22",
    "dpad_center": "23", "page_up": "92", "page_down": "93",
    "power": "26", "camera": "27", "menu": "82", "search": "84",
    "back": "4", "home": "3", "volume_up": "24", "volume_down": "25",
    "volume_mute": "164", "mute": "91", "media_play_pause": "85",
    "media_stop": "86", "media_next": "87", "media_previous": "88",
    "media_rewind": "89", "media_fast_forward": "90",
}


def tap(x: int, y: int) -> dict:
    _, stderr, code = run_cmd(["shell", "input", "tap", str(x), str(y)])
    return {"success": code == 0, "message": f"tapped ({x}, {y})" if code == 0 else stderr}


def swipe(x1: int, y1: int, x2: int, y2: int, duration: int = 300) -> dict:
    _, stderr, code = run_cmd(["shell", "input", "swipe", str(x1), str(y1), str(x2), str(y2), str(duration)])
    return {"success": code == 0, "message": f"swiped ({x1},{y1})->({x2},{y2})" if code == 0 else stderr}


def input_text(text: str) -> dict:
    escaped = text.replace(" ", "%s")
    _, stderr, code = run_cmd(["shell", "input", "text", escaped])
    return {"success": code == 0, "message": f"input: {text}" if code == 0 else stderr}


def key_event(keycode: int) -> dict:
    _, stderr, code = run_cmd(["shell", "input", "keyevent", str(keycode)])
    return {"success": code == 0, "message": f"key: {keycode}" if code == 0 else stderr}


def press_key(key: str) -> dict:
    key_lower = key.lower().strip()
    keycode = KEY_MAP.get(key_lower, key)
    if not str(keycode).isdigit():
        keycode = f"KEYCODE_{keycode.upper()}"
    _, stderr, code = run_cmd(["shell", "input", "keyevent", str(keycode)])
    return {"success": code == 0, "message": f"key: {key}" if code == 0 else stderr}


def open_app(package: str) -> dict:
    _, stderr, code = run_cmd(["shell", "am", "start", "-n", package])
    return {"success": code == 0, "message": f"opened: {package}" if code == 0 else stderr}


def get_current_app() -> dict:
    out, _, code = run_cmd(["shell", "dumpsys", "window"])
    if code != 0:
        return {"success": False, "error": "failed to get current app"}
    for line in out.split("\n"):
        if "mCurrentFocus" in line:
            return {"success": True, "current_app": line.strip()}
    return {"success": True, "current_app": "unknown"}


def list_apps(keyword: str = "") -> dict:
    if keyword:
        out, _, code = run_cmd(["shell", "pm", "list", "packages", keyword])
    else:
        out, _, code = run_cmd(["shell", "pm", "list", "packages"])
    if code != 0:
        return {"success": False, "error": "failed to list apps"}
    packages = [line.replace("package:", "") for line in out.strip().split("\n") if line.startswith("package:")]
    return {"success": True, "count": len(packages), "packages": packages}


def screenshot() -> dict:
    try:
        from PIL import Image
    except ImportError:
        return {"success": False, "error": "PIL not installed, run: pip install Pillow"}

    os.makedirs(CACHE_DIR, exist_ok=True)
    local_path = os.path.join(CACHE_DIR, "screen.png")
    tv_path = f"{TV_TEMP_DIR}/screen.png"

    try:
        _, err1, code1 = run_cmd(["shell", "screencap", "-p", tv_path])
        if code1 != 0:
            return {"success": False, "error": f"screencap failed: {err1}"}
        _, err2, code2 = run_cmd(["pull", tv_path, local_path])
        if code2 != 0:
            return {"success": False, "error": f"pull failed: {err2}"}
        if not os.path.exists(local_path):
            return {"success": False, "error": "screenshot file not found"}

        img = Image.open(local_path)
        width, height = img.size
        file_size = os.path.getsize(local_path)
        return {"success": True, "file": "screen.png", "path": local_path, "width": width, "height": height, "size_kb": round(file_size / 1024, 2)}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_ui_tree() -> dict:
    import xml.etree.ElementTree as ET
    os.makedirs(CACHE_DIR, exist_ok=True)
    local_path = os.path.join(CACHE_DIR, "ui.json")
    tv_xml_path = f"{TV_TEMP_DIR}/ui.xml"
    try:
        _, err1, code1 = run_cmd(["shell", "uiautomator", "dump", tv_xml_path], timeout=15)
        if code1 != 0:
            return {"success": False, "error": f"uiautomator failed: {err1}"}
        out2, _, code2 = run_cmd(["shell", "cat", tv_xml_path])
        if code2 != 0:
            return {"success": False, "error": "read ui.xml failed"}

        root = ET.fromstring(out2)
        elements = []
        for node in root.iter("node"):
            text = node.get("text", "") or node.get("content-desc", "")
            bounds_str = node.get("bounds", "[0,0][0,0]")
            parts = bounds_str.replace("][", ",").strip("[]").split(",")
            if len(parts) == 4:
                box = [int(p) for p in parts]
                elements.append({
                    "text": text,
                    "box": box,
                    "center": [(box[0] + box[2]) // 2, (box[1] + box[3]) // 2],
                })

        with open(local_path, "w", encoding="utf-8") as f:
            json.dump({"elements": elements}, f, ensure_ascii=False, indent=2)
        return {"success": True, "file": "ui.json", "path": local_path, "elements": elements}
    except Exception as e:
        return {"success": False, "error": str(e)}


def find_text(text: str) -> dict:
    ui_result = get_ui_tree()
    if not ui_result.get("success"):
        return ui_result

    target = text.strip().lower()
    elements = ui_result.get("elements", [])
    exact = next((item for item in elements if str(item.get("text", "")).strip().lower() == target), None)
    if exact:
        return {"success": True, "match": exact, "strategy": "ui_tree_exact"}

    partial = next((item for item in elements if target and target in str(item.get("text", "")).strip().lower()), None)
    if partial:
        return {"success": True, "match": partial, "strategy": "ui_tree_partial"}

    return {"success": False, "error": f"text_not_found: {text}", "strategy": "ui_tree"}


def click_element(text: str = "", x: int | None = None, y: int | None = None) -> dict:
    if x is not None and y is not None:
        return tap(x, y)
    if not text:
        return {"success": False, "error": "missing text or coordinates"}

    match_result = find_text(text)
    if not match_result.get("success"):
        return match_result

    center = match_result["match"].get("center")
    if not center or len(center) != 2:
        return {"success": False, "error": "match_center_missing"}
    tap_result = tap(center[0], center[1])
    tap_result["matched_text"] = text
    tap_result["strategy"] = match_result.get("strategy")
    tap_result["center"] = center
    return tap_result


def ocr_local(text: str = "") -> dict:
    return {
        "success": False,
        "error": "ocr_local_not_configured",
        "provider": "local",
        "message": "Local OCR provider placeholder. Configure a local OCR service to enable this capability.",
        "query": text,
    }


def ocr_api(text: str = "") -> dict:
    return {
        "success": False,
        "error": "ocr_api_not_configured",
        "provider": "api",
        "message": "OCR API provider placeholder. Configure API credentials to enable this capability.",
        "query": text,
    }


def multimodal_understand(text: str = "") -> dict:
    return {
        "success": False,
        "error": "multimodal_not_configured",
        "provider": "multimodal",
        "message": "Multimodal placeholder. Configure a multimodal model endpoint to enable screenshot understanding.",
        "query": text,
    }


TOOLS = {
    "tap": {"func": lambda p: tap(p["x"], p["y"])},
    "swipe": {"func": lambda p: swipe(p["x1"], p["y1"], p["x2"], p["y2"], p.get("duration", 300))},
    "input_text": {"func": lambda p: input_text(p["text"])},
    "press_key": {"func": lambda p: press_key(p["key"])},
    "key_event": {"func": lambda p: key_event(p["keycode"])},
    "open_app": {"func": lambda p: open_app(p["package"])},
    "back": {"func": lambda p: press_key("back")},
    "home": {"func": lambda p: press_key("home")},
    "enter": {"func": lambda p: press_key("enter")},
    "screenshot": {"func": lambda p: screenshot()},
    "get_ui_tree": {"func": lambda p: get_ui_tree()},
    "get_current_app": {"func": lambda p: get_current_app()},
    "find_text": {"func": lambda p: find_text(p.get("text", ""))},
    "click_element": {"func": lambda p: click_element(p.get("text", ""), p.get("x"), p.get("y"))},
    "ocr_local": {"func": lambda p: ocr_local(p.get("text", ""))},
    "ocr_api": {"func": lambda p: ocr_api(p.get("text", ""))},
    "multimodal_understand": {"func": lambda p: multimodal_understand(p.get("text", ""))},
    "list_apps": {"func": lambda p: list_apps(p.get("keyword", ""))},
    "list_devices": {"func": lambda p: list_devices()},
    "connect": {"func": lambda p: connect_device(p.get("ip", ""), p.get("port", 5555))},
    "disconnect": {"func": lambda p: disconnect_device(p.get("ip", ""), p.get("port", 5555))},
}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Missing action"}))
        sys.exit(1)

    action = sys.argv[1]
    params = {}
    for arg in sys.argv[2:]:
        if "=" in arg:
            key, value = arg.split("=", 1)
            if value.isdigit():
                value = int(value)
            params[key] = value

    if action not in TOOLS:
        print(json.dumps({"success": False, "error": f"Unknown action: {action}"}))
        sys.exit(1)

    result = TOOLS[action]["func"](params)
    print(json.dumps(result, ensure_ascii=False))
