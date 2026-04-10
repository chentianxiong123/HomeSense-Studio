"""
ADB CLI - Android Debug Bridge Command Line Interface
通用底层命令，不包含特定应用逻辑

Usage:
    python adb.py run '{"action":"list_devices"}'
    python adb.py run '{"action":"screenshot"}'
    python adb.py run '{"action":"tap","x":500,"y":800}'
    python adb.py run '[{"action":"tap","x":100,"y":200},{"action":"wait","seconds":1}]'
"""
import subprocess
import os
import json
import sys
import time
import re
import tempfile
from io import BytesIO
from typing import Optional

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

import yaml

TV_IP = os.getenv("TV_IP", "192.168.31.124")
TV_PORT = os.getenv("TV_PORT", "5555")
ADB_PATH = os.getenv("ADB_PATH", "adb")
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")

TV_TEMP_DIR = "/data/local/tmp"

_ui_elements_cache: dict = {"elements": [], "timestamp": 0}

PERCEPTION_CONFIG = {"ui_tree": {"enabled": True}, "ocr": {"enabled": False}, "multimodal": {"enabled": False}}

MOCK_MODE = TV_IP in ("127.0.0.1", "localhost", "0.0.0.0") or TV_IP.startswith("192.168.31.1")


def is_mock_mode() -> bool:
    return MOCK_MODE


def get_mock_ui_elements(screen: str = "dangbei_market_home") -> dict:
    mock_screens = {
        "dangbei_market_home": [
            {"index": 0, "text": "搜索", "bounds": [880, 50, 980, 90], "center": [930, 70], "clickable": True, "resource_id": "", "class_name": "android.widget.TextView"},
            {"index": 1, "text": "热门推荐", "bounds": [0, 100, 960, 500], "center": [480, 300], "clickable": False, "resource_id": "", "class_name": "android.widget.LinearLayout"},
            {"index": 2, "text": "分类", "bounds": [0, 500, 240, 540], "center": [120, 520], "clickable": True, "resource_id": "", "class_name": "android.widget.TextView"},
            {"index": 3, "text": "排行", "bounds": [240, 500, 480, 540], "center": [360, 520], "clickable": True, "resource_id": "", "class_name": "android.widget.TextView"},
            {"index": 4, "text": "管理", "bounds": [480, 500, 720, 540], "center": [600, 520], "clickable": True, "resource_id": "", "class_name": "android.widget.TextView"},
            {"index": 5, "text": "我的", "bounds": [720, 500, 960, 540], "center": [840, 520], "clickable": True, "resource_id": "", "class_name": "android.widget.TextView"},
        ],
        "search_input": [
            {"index": 0, "text": "", "bounds": [100, 50, 800, 100], "center": [450, 75], "clickable": True, "resource_id": "com.dangbeimarket:id/search_input", "class_name": "android.widget.EditText"},
            {"index": 1, "text": "搜索", "bounds": [820, 50, 920, 100], "center": [870, 75], "clickable": True, "resource_id": "", "class_name": "android.widget.TextView"},
            {"index": 2, "text": "取消", "bounds": [920, 50, 960, 100], "center": [940, 75], "clickable": True, "resource_id": "", "class_name": "android.widget.TextView"},
        ],
        "search_results": [
            {"index": 0, "text": "哔哩哔哩", "bounds": [0, 100, 960, 200], "center": [480, 150], "clickable": True, "resource_id": "", "class_name": "android.widget.LinearLayout"},
            {"index": 1, "text": "B站", "bounds": [0, 200, 960, 300], "center": [480, 250], "clickable": True, "resource_id": "", "class_name": "android.widget.LinearLayout"},
            {"index": 2, "text": "哔哩", "bounds": [0, 300, 960, 400], "center": [480, 350], "clickable": True, "resource_id": "", "class_name": "android.widget.LinearLayout"},
            {"index": 3, "text": "bilibili", "bounds": [0, 400, 960, 500], "center": [480, 450], "clickable": True, "resource_id": "", "class_name": "android.widget.LinearLayout"},
        ],
        "app_detail": [
            {"index": 0, "text": "云视听小电视", "bounds": [0, 50, 960, 150], "center": [480, 100], "clickable": False, "resource_id": "", "class_name": "android.widget.TextView"},
            {"index": 1, "text": "安装", "bounds": [380, 400, 580, 460], "center": [480, 430], "clickable": True, "resource_id": "", "class_name": "android.widget.Button"},
            {"index": 2, "text": "打开", "bounds": [600, 400, 800, 460], "center": [700, 430], "clickable": True, "resource_id": "", "class_name": "android.widget.Button"},
        ],
        "installing": [
            {"index": 0, "text": "正在安装...", "bounds": [380, 400, 580, 460], "center": [480, 430], "clickable": False, "resource_id": "", "class_name": "android.widget.TextView"},
        ],
        "install_complete": [
            {"index": 0, "text": "安装完成", "bounds": [380, 400, 580, 460], "center": [480, 430], "clickable": False, "resource_id": "", "class_name": "android.widget.TextView"},
            {"index": 1, "text": "打开", "bounds": [380, 460, 580, 520], "center": [480, 490], "clickable": True, "resource_id": "", "class_name": "android.widget.Button"},
        ],
    }
    elements = mock_screens.get(screen, mock_screens["dangbei_market_home"])
    return {
        "status": "success",
        "elements": elements,
        "count": len(elements),
        "formatted": "\n".join([f"[{e['index']}] {e['text']} @ {e['center']}" for e in elements if e["text"]]),
        "hint": "Use tap_element with index or text to click an element",
        "note": f"mock_ui_tree - {screen}",
    }


def load_perception_config() -> dict:
    global PERCEPTION_CONFIG
    config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.yaml")
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)
            if config and "perception" in config:
                PERCEPTION_CONFIG = config["perception"]
    except Exception:
        pass
    return PERCEPTION_CONFIG


load_perception_config()


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


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", "", text or "").strip().lower()


# ---------------------------------------------------------------------------
# Action Handlers
# ---------------------------------------------------------------------------

def _handle_list_devices(params: dict) -> dict:
    out, _, code = run_global_cmd(["devices", "-l"])
    if code != 0:
        return {"status": "error", "error": "failed to list devices"}

    devices = []
    for line in out.strip().split("\n"):
        line = line.strip()
        if line and not line.startswith("List"):
            parts = line.split()
            if len(parts) >= 2:
                devices.append({
                    "device_id": parts[0],
                    "status": parts[1],
                    "info": " ".join(parts[2:]) if len(parts) > 2 else ""
                })

    return {"status": "success", "devices": devices, "count": len(devices)}


def _handle_connect(params: dict) -> dict:
    ip = params.get("ip", TV_IP)
    port = params.get("port", int(TV_PORT))
    out, _, code = run_global_cmd(["connect", f"{ip}:{port}"])
    success = code == 0 and "connected" in out.lower()
    return {"status": "success" if success else "error", "message": out.strip(), "address": f"{ip}:{port}"}


def _handle_disconnect(params: dict) -> dict:
    ip = params.get("ip", TV_IP)
    port = params.get("port", int(TV_PORT))
    out, _, code = run_global_cmd(["disconnect", f"{ip}:{port}"])
    return {"status": "success" if code == 0 else "error", "message": out.strip()}


def _handle_screenshot(params: dict) -> dict:
    try:
        from PIL import Image
    except ImportError:
        return {"status": "error", "error": "PIL not installed, run: pip install Pillow"}

    os.makedirs(CACHE_DIR, exist_ok=True)
    save_path = params.get("path")
    if not save_path:
        save_path = os.path.join(CACHE_DIR, "screenshot.jpg")

    tv_path = f"{TV_TEMP_DIR}/screen.png"

    try:
        _, err1, code1 = run_cmd(["shell", "screencap", "-p", tv_path])
        if code1 != 0:
            return {"status": "error", "error": f"screencap failed: {err1}"}
        _, err2, code2 = run_cmd(["pull", tv_path, save_path])
        if code2 != 0:
            return {"status": "error", "error": f"pull failed: {err2}"}
        if not os.path.exists(save_path):
            return {"status": "error", "error": "screenshot file not found"}

        img = Image.open(save_path)
        if img.mode == "RGBA":
            rgb_img = Image.new("RGB", img.size, (255, 255, 255))
            rgb_img.paste(img, mask=img.split()[3])
            img = rgb_img
        elif img.mode != "RGB":
            img = img.convert("RGB")

        output = BytesIO()
        img.save(output, format="JPEG", quality=40, optimize=True)
        img_bytes = output.getvalue()

        with open(save_path, "wb") as f:
            f.write(img_bytes)

        return {
            "status": "success",
            "path": save_path,
            "width": img.size[0],
            "height": img.size[1],
            "size_bytes": len(img_bytes),
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


def _handle_get_display_size(params: dict) -> dict:
    out, stderr, code = run_cmd(["shell", "wm", "size"])
    if code != 0:
        return {"status": "error", "error": stderr or "failed_to_get_display_size"}

    match = re.search(r"(\d+)\s*x\s*(\d+)", out)
    if not match:
        return {"status": "error", "error": f"unexpected_wm_size_output: {out.strip()}"}

    return {
        "status": "success",
        "width": int(match.group(1)),
        "height": int(match.group(2)),
    }


def _handle_get_ui_elements(params: dict) -> dict:
    global _ui_elements_cache

    import xml.etree.ElementTree as ET
    os.makedirs(CACHE_DIR, exist_ok=True)
    tv_xml_path = f"{TV_TEMP_DIR}/ui.xml"
    local_xml_path = os.path.join(CACHE_DIR, "ui_tree.json")

    try:
        _, err1, code1 = run_cmd(["shell", "uiautomator", "dump", tv_xml_path], timeout=15)
        if code1 != 0:
            return {"status": "error", "error": f"uiautomator failed: {err1}"}
        out2, _, code2 = run_cmd(["shell", "cat", tv_xml_path])
        if code2 != 0:
            return {"status": "error", "error": "read ui.xml failed"}

        root = ET.fromstring(out2)
        elements = []
        for idx, node in enumerate(root.iter("node")):
            text = node.get("text", "") or node.get("content-desc", "")
            bounds_str = node.get("bounds", "[0,0][0,0]")
            parts = bounds_str.replace("][", ",").strip("[]").split(",")
            if len(parts) == 4:
                box = [int(p) for p in parts]
                elem = {
                    "index": idx,
                    "text": text,
                    "bounds": box,
                    "center": [(box[0] + box[2]) // 2, (box[1] + box[3]) // 2],
                    "clickable": node.get("clickable", "false") == "true",
                    "resource_id": node.get("resource-id", ""),
                    "class_name": node.get("class", ""),
                }
                elements.append(elem)

        _ui_elements_cache = {"elements": elements, "timestamp": time.time()}
        
        with open(local_xml_path, "w", encoding="utf-8") as f:
            json.dump({"elements": elements}, f, ensure_ascii=False, indent=2)

        formatted = "\n".join([
            f"[{e['index']}] {e['text']} @ {e['center']}"
            for e in elements if e["text"]
        ])

        return {
            "status": "success",
            "elements": elements,
            "count": len(elements),
            "formatted": formatted,
            "hint": "Use tap_element with index or text to click an element",
            "cache_path": local_xml_path,
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


def _handle_tap_element(params: dict) -> dict:
    global _ui_elements_cache

    index = params.get("index")
    text = params.get("text")
    device_id = params.get("device_id")
    refresh = params.get("refresh", False)

    if index is None and text is None:
        return {"status": "error", "error": "Must provide at least one of: index or text"}

    cache_age = time.time() - _ui_elements_cache.get("timestamp", 0)
    elements = _ui_elements_cache.get("elements", [])

    if refresh or cache_age > 30 or not elements:
        ui_result = _handle_get_ui_elements({})
        if ui_result.get("status") != "success":
            return ui_result
        elements = ui_result.get("elements", [])

    element = None
    search_method = ""

    if index is not None:
        for e in elements:
            if e.get("index") == index:
                element = e
                search_method = f"index={index}"
                break
    elif text is not None:
        normalized_text = normalize_text(text)
        for e in elements:
            elem_text = normalize_text(e.get("text", ""))
            if normalized_text and elem_text and (normalized_text in elem_text or elem_text in normalized_text):
                element = e
                search_method = f"text='{text}'"
                break

    if element is None and not refresh:
        ui_result = _handle_get_ui_elements({})
        if ui_result.get("status") == "success":
            elements = ui_result.get("elements", [])
            if index is not None:
                for e in elements:
                    if e.get("index") == index:
                        element = e
                        break
            elif text is not None:
                normalized_text = normalize_text(text)
                for e in elements:
                    elem_text = normalize_text(e.get("text", ""))
                    if normalized_text and elem_text and (normalized_text in elem_text or elem_text in normalized_text):
                        element = e
                        break

    if element is None:
        return {
            "status": "error",
            "error": f"Element not found with {search_method}. Try get_ui_elements first.",
            "available_count": len(elements),
        }

    center = element.get("center")
    if not center or len(center) != 2:
        return {"status": "error", "error": "Element center missing"}

    tap_result = _handle_tap({"x": center[0], "y": center[1]})
    _ui_elements_cache = {"elements": [], "timestamp": 0}

    return {
        "status": "success",
        "action": "tap_element",
        "element": {
            "index": element.get("index"),
            "text": element.get("text"),
            "center": center,
        },
        "search_method": search_method,
        "tap_result": tap_result,
    }


def _handle_tap(params: dict) -> dict:
    x = params.get("x")
    y = params.get("y")
    if x is None or y is None:
        return {"status": "error", "error": "Missing required parameters: x, y"}

    _, stderr, code = run_cmd(["shell", "input", "tap", str(x), str(y)])
    if code != 0:
        return {"status": "error", "error": stderr or "tap failed"}
    return {"status": "success", "action": "tap", "x": x, "y": y}


def _handle_tap_ratio(params: dict) -> dict:
    x_ratio = params.get("x_ratio")
    y_ratio = params.get("y_ratio")
    if x_ratio is None or y_ratio is None:
        return {"status": "error", "error": "Missing required parameters: x_ratio, y_ratio"}

    size_result = _handle_get_display_size({})
    if size_result.get("status") != "success":
        width, height = 1920, 1080
    else:
        width = size_result["width"]
        height = size_result["height"]

    x = int(width * x_ratio)
    y = int(height * y_ratio)
    return _handle_tap({"x": x, "y": y})


def _handle_swipe(params: dict) -> dict:
    start_x = params.get("start_x")
    start_y = params.get("start_y")
    end_x = params.get("end_x")
    end_y = params.get("end_y")
    duration = params.get("duration", 300)

    if any(v is None for v in [start_x, start_y, end_x, end_y]):
        return {"status": "error", "error": "Missing required parameters: start_x, start_y, end_x, end_y"}

    _, stderr, code = run_cmd(["shell", "input", "swipe", str(start_x), str(start_y), str(end_x), str(end_y), str(duration)])
    if code != 0:
        return {"status": "error", "error": stderr or "swipe failed"}
    return {
        "status": "success",
        "action": "swipe",
        "start": {"x": start_x, "y": start_y},
        "end": {"x": end_x, "y": end_y},
        "duration": duration,
    }


def _handle_input_text(params: dict) -> dict:
    text = params.get("text", "")
    if not text:
        return {"status": "error", "error": "Missing required parameter: text"}

    escaped = text.replace(" ", "%s")
    _, stderr, code = run_cmd(["shell", "input", "text", escaped])
    if code != 0:
        return {"status": "error", "error": stderr or "input_text failed"}
    return {"status": "success", "action": "input_text", "text": text}


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


def _handle_press_key(params: dict) -> dict:
    key = params.get("key", "")
    if not key:
        return {"status": "error", "error": "Missing required parameter: key"}

    key_lower = key.lower().strip()
    keycode = KEY_MAP.get(key_lower, key)
    if not str(keycode).isdigit():
        keycode = f"KEYCODE_{keycode.upper()}"

    _, stderr, code = run_cmd(["shell", "input", "keyevent", str(keycode)])
    if code != 0:
        return {"status": "error", "error": stderr or "press_key failed"}
    return {"status": "success", "action": "press_key", "key": key}


def _handle_launch_app(params: dict) -> dict:
    package = params.get("package") or params.get("package_name")
    if not package:
        return {"status": "error", "error": "Missing required parameter: package"}

    run_cmd(["shell", "cmd", "statusbar", "collapse"], timeout=5)

    out, stderr, code = run_cmd(
        ["shell", "cmd", "package", "resolve-activity", "--brief", package],
        timeout=20,
    )

    component = None
    lines = [line.strip() for line in out.splitlines() if line.strip()]
    for line in reversed(lines):
        if "/" in line:
            component = line
            break

    if component:
        out, stderr, code = run_cmd(["shell", "am", "start", "-n", component], timeout=20)
    else:
        out, stderr, code = run_cmd(
            ["shell", "monkey", "-p", package, "-c", "android.intent.category.LAUNCHER", "1"],
            timeout=20,
        )

    success = code == 0 and "Error" not in out and "Exception" not in stderr
    return {
        "status": "success" if success else "error",
        "action": "launch_app",
        "package": package,
        "component": component,
        "stdout": out.strip(),
        "stderr": stderr.strip(),
    }


def _handle_get_current_app(params: dict) -> dict:
    out, _, code = run_cmd(["shell", "dumpsys", "window"], timeout=20)
    if code != 0:
        return {"status": "error", "error": "failed to get current app"}

    for line in out.split("\n"):
        if "mCurrentFocus" in line or "mFocusedApp" in line:
            return {"status": "success", "current_app": line.strip()}

    return {"status": "success", "current_app": "unknown"}


def _handle_list_packages(params: dict) -> dict:
    keyword = params.get("keyword", "")
    if keyword:
        out, stderr, code = run_cmd(["shell", "pm", "list", "packages", keyword], timeout=20)
    else:
        out, stderr, code = run_cmd(["shell", "pm", "list", "packages"], timeout=20)

    if code != 0:
        return {"status": "error", "error": stderr or "failed to list packages"}

    packages = [line.replace("package:", "").strip() for line in out.splitlines() if line.startswith("package:")]
    return {"status": "success", "packages": packages, "count": len(packages)}


def _handle_check_package(params: dict) -> dict:
    package = params.get("package")
    if not package:
        return {"status": "error", "error": "Missing required parameter: package"}

    result = _handle_list_packages({"keyword": package})
    if result.get("status") != "success":
        return result

    packages = result.get("packages", [])
    installed = package in packages
    return {
        "status": "success",
        "package": package,
        "installed": installed,
        "matched_packages": [p for p in packages if package in p],
    }


def _handle_wait(params: dict) -> dict:
    seconds = params.get("seconds", 1.0)
    time.sleep(seconds)
    return {"status": "success", "action": "wait", "seconds": seconds}


def _handle_ensure_connected(params: dict) -> dict:
    listed = _handle_list_devices({})
    if listed.get("status") == "success":
        target_id = f"{TV_IP}:{TV_PORT}"
        for device in listed.get("devices", []):
            if device.get("device_id") == target_id and device.get("status") == "device":
                return {"status": "success", "message": "already_connected", "device": target_id}

    connected = _handle_connect({})
    if connected.get("status") == "success":
        return {"status": "success", "message": connected.get("message", "connected"), "device": f"{TV_IP}:{TV_PORT}"}

    return {"status": "error", "error": connected.get("message", "failed_to_connect"), "device": f"{TV_IP}:{TV_PORT}"}


def _handle_find_element(params: dict) -> dict:
    text = params.get("text", "")
    if not text:
        return {"status": "error", "error": "Missing required parameter: text"}

    ui_result = _handle_get_ui_elements({})
    if ui_result.get("status") != "success":
        return ui_result

    target = normalize_text(text)
    elements = ui_result.get("elements", [])

    for e in elements:
        elem_text = normalize_text(e.get("text", ""))
        if target and elem_text and (target == elem_text or target in elem_text or elem_text in target):
            return {
                "status": "success",
                "element": e,
                "matched_text": e.get("text"),
                "query": text,
            }

    return {"status": "error", "error": f"Element not found: {text}", "available_count": len(elements)}


def _handle_ocr_recognize(params: dict) -> dict:
    config = load_perception_config()
    ocr_config = config.get("ocr", {})

    if not ocr_config.get("enabled", False):
        return {
            "status": "error",
            "error": "OCR is not enabled. Set perception.ocr.enabled: true in config.yaml",
            "provider": ocr_config.get("provider", "none"),
            "configured": False,
        }

    provider = ocr_config.get("provider", "local")

    if provider == "local":
        return _ocr_recognize_local(params)
    elif provider == "api":
        return _ocr_recognize_api(params)
    else:
        return {
            "status": "error",
            "error": f"OCR provider '{provider}' not implemented",
            "available_providers": ["local", "api"],
        }


def _ocr_recognize_local(params: dict) -> dict:
    try:
        from PIL import Image
    except ImportError:
        return {
            "status": "error",
            "error": "PIL not installed. Run: pip install Pillow",
            "provider": "local",
        }

    try:
        from paddleocr import PaddleOCR
    except ImportError:
        return {
            "status": "error",
            "error": "PaddleOCR not installed. Run: pip install paddleocr paddlepaddle",
            "provider": "local",
        }

    screenshot_result = _handle_screenshot({})
    if screenshot_result.get("status") != "success":
        return {"status": "error", "error": "Failed to capture screenshot for OCR", "details": screenshot_result}

    image_path = screenshot_result.get("path")
    if not image_path or not os.path.exists(image_path):
        return {"status": "error", "error": "Screenshot file not found"}

    try:
        ocr = PaddleOCR(lang="ch", use_doc_orientation=False, use_doc_textline_orientation=False)
        result = ocr.predict(image_path)

        texts = []
        boxes = []
        if hasattr(result, 'data') and result.data:
            for line in result.data:
                if hasattr(line, 'text') and line.text:
                    texts.append(line.text)
                    boxes.append({"text": line.text, "box": line.box if hasattr(line, 'box') else None})

        return {
            "status": "success",
            "provider": "paddleocr",
            "texts": texts,
            "boxes": boxes,
            "count": len(texts),
        }
    except Exception as e:
        return {"status": "error", "error": f"OCR failed: {str(e)}", "provider": "local"}


def _handle_vision_understand(params: dict) -> dict:
    config = load_perception_config()
    vision_config = config.get("multimodal", {})

    if not vision_config.get("enabled", False):
        return {
            "status": "error",
            "error": "Vision is not enabled. Set perception.multimodal.enabled: true in config.yaml",
            "provider": vision_config.get("provider", "none"),
            "configured": False,
        }

    provider = vision_config.get("provider", "none")

    if provider == "openai":
        return _vision_understand_openai(params)
    elif provider == "anthropic":
        return _vision_understand_anthropic(params)
    else:
        return {
            "status": "error",
            "error": f"Vision provider '{provider}' not configured",
            "available_providers": ["openai", "anthropic"],
        }


def _vision_understand_openai(params: dict) -> dict:
    question = params.get("question", "描述这张图片")

    screenshot_result = _handle_screenshot({})
    if screenshot_result.get("status") != "success":
        return {"status": "error", "error": "Failed to capture screenshot"}

    image_path = screenshot_result.get("path")
    if not image_path or not os.path.exists(image_path):
        return {"status": "error", "error": "Screenshot file not found"}

    try:
        import base64
        with open(image_path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode("utf-8")

        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            return {"status": "error", "error": "OPENAI_API_KEY not set"}

        config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.yaml")
        with open(config_path, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)
            model = config.get("perception", {}).get("multimodal", {}).get("model", "gpt-4o")

        import requests
        response = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": question},
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/jpeg;base64,{image_data}"},
                            },
                        ],
                    }
                ],
                "max_tokens": 1000,
            },
            timeout=60,
        )

        if response.status_code != 200:
            return {"status": "error", "error": f"OpenAI API error: {response.text}"}

        result = response.json()
        return {
            "status": "success",
            "provider": "openai",
            "model": model,
            "answer": result["choices"][0]["message"]["content"],
        }
    except ImportError:
        return {"status": "error", "error": "requests library not installed. Run: pip install requests"}
    except Exception as e:
        return {"status": "error", "error": f"Vision failed: {str(e)}"}


def _vision_understand_anthropic(params: dict) -> dict:
    return {
        "status": "error",
        "error": "Anthropic provider not implemented yet",
        "provider": "anthropic",
    }


# ---------------------------------------------------------------------------
# Action Router
# ---------------------------------------------------------------------------

ACTION_MAP = {
    "list_devices": _handle_list_devices,
    "devices": _handle_list_devices,
    "connect": _handle_connect,
    "disconnect": _handle_disconnect,
    "screenshot": _handle_screenshot,
    "get_screenshot": _handle_screenshot,
    "get_display_size": _handle_get_display_size,
    "get_ui_elements": _handle_get_ui_elements,
    "ui_elements": _handle_get_ui_elements,
    "get_ui_tree": _handle_get_ui_elements,
    "tap_element": _handle_tap_element,
    "tap": _handle_tap,
    "tap_ratio": _handle_tap_ratio,
    "swipe": _handle_swipe,
    "input_text": _handle_input_text,
    "type": _handle_input_text,
    "press_key": _handle_press_key,
    "key": _handle_press_key,
    "back": lambda p: _handle_press_key({"key": "back"}),
    "home": lambda p: _handle_press_key({"key": "home"}),
    "enter": lambda p: _handle_press_key({"key": "enter"}),
    "launch_app": _handle_launch_app,
    "launch": _handle_launch_app,
    "get_current_app": _handle_get_current_app,
    "current_app": _handle_get_current_app,
    "list_packages": _handle_list_packages,
    "list_apps": _handle_list_packages,
    "check_package": _handle_check_package,
    "find_element": _handle_find_element,
    "find_text": _handle_find_element,
    "wait": _handle_wait,
    "ensure_connected": _handle_ensure_connected,
    "ocr_recognize": _handle_ocr_recognize,
    "ocr": _handle_ocr_recognize,
    "vision_understand": _handle_vision_understand,
    "vision": _handle_vision_understand,
}


def execute_action(command: dict) -> dict:
    action = command.get("action", "")
    if not action:
        return {"status": "error", "error": "Missing 'action' field"}

    handler = ACTION_MAP.get(action)
    if not handler:
        available = sorted(set(ACTION_MAP.keys()))
        return {
            "status": "error",
            "error": f"Unknown action: '{action}'",
            "available_actions": available,
        }

    try:
        return handler(command)
    except Exception as e:
        return {"status": "error", "error": str(e), "action": action}


def execute_commands(raw_json: str) -> str:
    try:
        parsed = json.loads(raw_json)
    except json.JSONDecodeError as e:
        return json.dumps({"status": "error", "error": f"Invalid JSON: {e}"}, ensure_ascii=False)

    if isinstance(parsed, dict):
        result = execute_action(parsed)
        return json.dumps(result, ensure_ascii=False)

    if isinstance(parsed, list):
        results = []
        for i, cmd in enumerate(parsed):
            if not isinstance(cmd, dict):
                results.append({"status": "error", "error": f"Command #{i} is not a JSON object"})
                break
            result = execute_action(cmd)
            results.append(result)
            if result.get("status") == "error":
                break
        return json.dumps(results, ensure_ascii=False)

    return json.dumps({"status": "error", "error": "Input must be a JSON object or array"}, ensure_ascii=False)


def cli_main(args: list[str] | None = None):
    if args is None:
        args = sys.argv[1:]

    if not args:
        print(json.dumps({
            "status": "error",
            "error": "No JSON command provided. Usage: python adb.py run '{\"action\":\"list_devices\"}'"
        }, ensure_ascii=False))
        sys.exit(1)

    if args[0] != "run":
        print(json.dumps({
            "status": "error",
            "error": f"Unknown command: {args[0]}. Usage: python adb.py run '{{\"action\":\"list_devices\"}}'"
        }, ensure_ascii=False))
        sys.exit(1)

    if len(args) < 2:
        print(json.dumps({
            "status": "error",
            "error": "No JSON command provided. Usage: python adb.py run '{\"action\":\"list_devices\"}'"
        }, ensure_ascii=False))
        sys.exit(1)

    raw_json = args[1]

    if raw_json == "-":
        raw_json = sys.stdin.read().strip()

    if not raw_json:
        print(json.dumps({"status": "error", "error": "Empty command"}, ensure_ascii=False))
        sys.exit(1)

    output = execute_commands(raw_json)
    print(output)


if __name__ == "__main__":
    cli_main()
