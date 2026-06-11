import re
import xml.etree.ElementTree as ET
from typing import Any, Callable

from .utils import _normalize_text

AdbDeps = dict[str, Callable[..., Any]]

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


def handle_get_display_size(params: dict, deps: AdbDeps) -> dict:
    out, stderr, code = deps["run_device_cmd"](params, ["shell", "wm", "size"])
    if code != 0:
        return {"status": "error", "error": "EXEC_FAILED", "message": stderr or "failed to get display size"}

    match = re.search(r"(\d+)\s*x\s*(\d+)", out)
    if not match:
        return {"status": "error", "error": "PARSE_ERROR", "message": f"unexpected output: {out.strip()}"}

    return {
        "status": "success",
        "data": {"width": int(match.group(1)), "height": int(match.group(2))},
    }


def handle_get_ui_elements(params: dict, deps: AdbDeps) -> dict:
    tv_xml_path = "/data/local/tmp/ui.xml"
    timeout = int(params.get("timeout", 15))

    try:
        _, err1, code1 = deps["run_device_cmd"](params, ["shell", "uiautomator", "dump", tv_xml_path], timeout=timeout)
        if code1 != 0:
            return {"status": "error", "error": "EXEC_FAILED", "message": f"uiautomator failed: {err1}"}

        out2, _, code2 = deps["run_device_cmd"](params, ["shell", "cat", tv_xml_path])
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
    except ET.ParseError as exc:
        return {"status": "error", "error": "PARSE_ERROR", "message": f"XML parse failed: {exc}"}
    except Exception as exc:
        return {"status": "error", "error": "CLI_ERROR", "message": str(exc)}


def handle_tap(params: dict, deps: AdbDeps) -> dict:
    x = params.get("x")
    y = params.get("y")
    if x is None or y is None:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Missing x or y"}

    _, stderr, code = deps["run_device_cmd"](params, ["shell", "input", "tap", str(x), str(y)])
    if code != 0:
        return {"status": "error", "error": "EXEC_FAILED", "message": stderr or "tap failed"}
    return {"status": "success", "data": {"action": "tap", "x": x, "y": y}}


def handle_tap_ratio(params: dict, deps: AdbDeps) -> dict:
    x_ratio = params.get("x_ratio")
    y_ratio = params.get("y_ratio")
    if x_ratio is None or y_ratio is None:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Missing x_ratio or y_ratio"}

    size_result = handle_get_display_size(params, deps)
    if size_result.get("status") == "success":
        display = size_result["data"]
        width, height = display["width"], display["height"]
    else:
        width, height = 1920, 1080

    x = int(width * x_ratio)
    y = int(height * y_ratio)
    device = deps["extract_device"](params)
    return handle_tap({"x": x, "y": y, **({} if not device else {"device": device})}, deps)


def handle_tap_element(params: dict, deps: AdbDeps) -> dict:
    index = params.get("index")
    text = params.get("text")

    if index is None and text is None:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Must provide index or text"}

    ui_result = handle_get_ui_elements(params, deps)
    if ui_result.get("status") != "success":
        return ui_result
    elements = ui_result["data"]["elements"]

    element = None
    if index is not None:
        for item in elements:
            if item.get("index") == index:
                element = item
                break

    if text is not None and element is None:
        target = _normalize_text(text)
        for item in elements:
            elem_text = _normalize_text(item.get("text", ""))
            if target and elem_text and (target in elem_text or elem_text in target):
                element = item
                break

    if element is None:
        return {"status": "error", "error": "ELEMENT_NOT_FOUND", "data": {"available_count": len(elements)}}

    center = element.get("center")
    if not center or len(center) != 2:
        return {"status": "error", "error": "ELEMENT_INVALID", "message": "Element missing center"}

    device = deps["extract_device"](params)
    tap_result = handle_tap({"x": center[0], "y": center[1], **({} if not device else {"device": device})}, deps)
    return {
        "status": "success",
        "data": {
            "action": "tap_element",
            "element": {"index": element.get("index"), "text": element.get("text"), "center": center},
            "tap_result": tap_result.get("data"),
        },
    }


def handle_swipe(params: dict, deps: AdbDeps) -> dict:
    start_x = params.get("start_x")
    start_y = params.get("start_y")
    end_x = params.get("end_x")
    end_y = params.get("end_y")
    duration = params.get("duration", 300)

    if any(value is None for value in [start_x, start_y, end_x, end_y]):
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Missing start_x, start_y, end_x, or end_y"}

    _, stderr, code = deps["run_device_cmd"](
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


def handle_input_text(params: dict, deps: AdbDeps) -> dict:
    text = params.get("text", "")
    if not text:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Missing text"}

    escaped = text.replace(" ", "%s")
    _, stderr, code = deps["run_device_cmd"](params, ["shell", "input", "text", escaped])
    if code != 0:
        return {"status": "error", "error": "EXEC_FAILED", "message": stderr or "input_text failed"}
    return {"status": "success", "data": {"action": "input_text", "text": text}}


def handle_press_key(params: dict, deps: AdbDeps) -> dict:
    key = params.get("key", "")
    if not key:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Missing key"}

    key_lower = key.lower().strip()
    keycode = KEY_MAP.get(key_lower, key)
    if not str(keycode).isdigit():
        keycode = f"KEYCODE_{keycode.upper()}"

    _, stderr, code = deps["run_device_cmd"](params, ["shell", "input", "keyevent", str(keycode)])
    if code != 0:
        return {"status": "error", "error": "EXEC_FAILED", "message": stderr or "press_key failed"}
    return {"status": "success", "data": {"action": "press_key", "key": key}}


def handle_back(params: dict, deps: AdbDeps) -> dict:
    return handle_press_key({**params, "key": "back"}, deps)


def handle_home(params: dict, deps: AdbDeps) -> dict:
    return handle_press_key({**params, "key": "home"}, deps)


def handle_enter(params: dict, deps: AdbDeps) -> dict:
    return handle_press_key({**params, "key": "enter"}, deps)


def handle_volume_up(params: dict, deps: AdbDeps) -> dict:
    return handle_press_key({**params, "key": "volume_up"}, deps)


def handle_volume_down(params: dict, deps: AdbDeps) -> dict:
    return handle_press_key({**params, "key": "volume_down"}, deps)


def handle_power(params: dict, deps: AdbDeps) -> dict:
    return handle_press_key({**params, "key": "power"}, deps)


def handle_launch_app(params: dict, deps: AdbDeps) -> dict:
    package = params.get("package") or params.get("package_name")
    if not package:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Missing package"}

    deps["run_device_cmd"](params, ["shell", "cmd", "statusbar", "collapse"], timeout=5)

    out, stderr, code = deps["run_device_cmd"](
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
        _, stderr, code = deps["run_device_cmd"](params, ["shell", "am", "start", "-n", component], timeout=20)
    else:
        _, stderr, code = deps["run_device_cmd"](
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


def handle_get_current_app(params: dict, deps: AdbDeps) -> dict:
    out, _, code = deps["run_device_cmd"](params, ["shell", "dumpsys", "window"], timeout=20)
    if code != 0:
        return {"status": "error", "error": "EXEC_FAILED", "message": "failed to get current app"}

    current_app = "unknown"
    activity = ""
    for line in out.split("\n"):
        if "mCurrentFocus" in line:
            match = re.search(r"([\w.]+/[\w./]+)", line)
            if match:
                activity = match.group(1)
                if "/" in activity:
                    current_app = activity.split("/")[0]
            break

    return {
        "status": "success",
        "data": {
            "current_app": current_app,
            "activity": activity,
            "raw_line": next((line.strip() for line in out.split("\n") if "mCurrentFocus" in line), ""),
        },
    }


def handle_list_packages(params: dict, deps: AdbDeps) -> dict:
    keyword = params.get("keyword", "")
    if keyword:
        out, stderr, code = deps["run_device_cmd"](params, ["shell", "pm", "list", "packages", keyword], timeout=20)
    else:
        out, stderr, code = deps["run_device_cmd"](params, ["shell", "pm", "list", "packages"], timeout=20)

    if code != 0:
        return {"status": "error", "error": "EXEC_FAILED", "message": stderr or "failed to list packages"}

    packages = [line.replace("package:", "").strip() for line in out.splitlines() if line.startswith("package:")]
    return {"status": "success", "data": {"packages": packages, "count": len(packages)}}


def handle_check_package(params: dict, deps: AdbDeps) -> dict:
    package = params.get("package")
    if not package:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Missing package"}

    result = handle_list_packages(params, deps)
    if result.get("status") != "success":
        return result

    packages = result["data"]["packages"]
    installed = package in packages
    return {
        "status": "success",
        "data": {
            "package": package, "installed": installed,
            "matched": [item for item in packages if package in item],
        },
    }


def handle_find_element(params: dict, deps: AdbDeps) -> dict:
    text = params.get("text", "")
    if not text:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Missing text"}

    ui_result = handle_get_ui_elements(params, deps)
    if ui_result.get("status") != "success":
        return ui_result

    target = _normalize_text(text)
    for item in ui_result["data"]["elements"]:
        elem_text = _normalize_text(item.get("text", ""))
        if target and elem_text and (target == elem_text or target in elem_text or elem_text in target):
            return {
                "status": "success",
                "data": {"element": item, "matched_text": item.get("text"), "query": text},
            }

    return {
        "status": "error", "error": "ELEMENT_NOT_FOUND",
        "data": {"available_count": ui_result["data"]["count"]},
    }
