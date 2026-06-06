import json
import sys

from adb_cli.adb import (
    handle_list_devices,
    handle_connect,
    handle_disconnect,
    handle_screenshot,
    handle_get_display_size,
    handle_get_ui_elements,
    handle_tap_element,
    handle_tap,
    handle_tap_ratio,
    handle_swipe,
    handle_input_text,
    handle_press_key,
    handle_launch_app,
    handle_get_current_app,
    handle_list_packages,
    handle_check_package,
    handle_find_element,
    handle_wait,
    handle_ensure_connected,
    handle_back,
    handle_home,
    handle_enter,
    handle_volume_up,
    handle_volume_down,
    handle_power,
)


def _make_capability(cap_id: str, name: str, kind: str, action: str) -> dict:
    return {
        "capability_id": cap_id,
        "name": name,
        "kind": kind,
        "source": "adb",
        "adb_action": action,
        "input_schema": {"type": "object", "required": [], "properties": {}},
    }


def _with_tap_schema(cap: dict) -> dict:
    cap = dict(cap)
    cap["input_schema"] = {
        "type": "object",
        "required": ["x", "y"],
        "properties": {
            "x": {"type": "integer"},
            "y": {"type": "integer"},
        },
    }
    return cap


def _with_text_schema(cap: dict) -> dict:
    cap = dict(cap)
    cap["input_schema"] = {
        "type": "object",
        "required": ["text"],
        "properties": {"text": {"type": "string"}},
    }
    return cap


def _with_package_schema(cap: dict) -> dict:
    cap = dict(cap)
    cap["input_schema"] = {
        "type": "object",
        "required": ["package"],
        "properties": {"package": {"type": "string"}},
    }
    return cap


def _with_swipe_schema(cap: dict) -> dict:
    cap = dict(cap)
    cap["input_schema"] = {
        "type": "object",
        "required": ["start_x", "start_y", "end_x", "end_y"],
        "properties": {
            "start_x": {"type": "integer"},
            "start_y": {"type": "integer"},
            "end_x": {"type": "integer"},
            "end_y": {"type": "integer"},
            "duration": {"type": "integer"},
        },
    }
    return cap


def _with_tap_element_schema(cap: dict) -> dict:
    cap = dict(cap)
    cap["input_schema"] = {
        "type": "object",
        "required": [],
        "properties": {
            "index": {"type": "integer"},
            "text": {"type": "string"},
        },
    }
    return cap


PHONE_BASE = [
    _make_capability("adb.back", "返回", "action", "back"),
    _make_capability("adb.home", "主页", "action", "home"),
    _make_capability("adb.enter", "确认", "action", "enter"),
    _make_capability("adb.volume_up", "音量+", "action", "volume_up"),
    _make_capability("adb.volume_down", "音量-", "action", "volume_down"),
    _make_capability("adb.power", "电源", "action", "power"),
    _make_capability("adb.wake", "唤醒", "action", "wake"),
    _with_tap_schema(_make_capability("adb.tap", "点击坐标", "action", "tap")),
    _with_text_schema(_make_capability("adb.input_text", "输入文本", "action", "input_text")),
    _with_package_schema(_make_capability("adb.launch_app", "启动应用", "action", "launch_app")),
    _make_capability("adb.screenshot", "截屏", "property", "screenshot"),
    _make_capability("adb.current_app", "当前应用", "property", "current_app"),
    _make_capability("adb.ui_tree", "界面元素", "property", "ui_tree"),
]


TV_BOX_EXTRA = [
    _with_tap_element_schema(_make_capability("adb.tap_element", "按索引点击", "action", "tap_element")),
    _with_swipe_schema(_make_capability("adb.swipe", "滑动", "action", "swipe")),
]


DEVICE_TYPE_TABLE = {
    "phone": PHONE_BASE,
    "tablet": PHONE_BASE,
    "television": PHONE_BASE + TV_BOX_EXTRA,
    "tv_box": PHONE_BASE + TV_BOX_EXTRA,
    "stb": PHONE_BASE + TV_BOX_EXTRA,
    "computer": PHONE_BASE,
    "other": PHONE_BASE,
}


def handle_capabilities_action(command: dict) -> dict:
    device_type = (command.get("device_type") or command.get("type") or "other").lower()
    caps = DEVICE_TYPE_TABLE.get(device_type, PHONE_BASE)
    return {
        "status": "success",
        "data": {
            "device_type": device_type,
            "capabilities": caps,
        },
    }


ACTION_MAP = {
    "list_devices": handle_list_devices,
    "devices": handle_list_devices,
    "connect": handle_connect,
    "disconnect": handle_disconnect,
    "screenshot": handle_screenshot,
    "get_screenshot": handle_screenshot,
    "get_display_size": handle_get_display_size,
    "get_ui_elements": handle_get_ui_elements,
    "ui_elements": handle_get_ui_elements,
    "get_ui_tree": handle_get_ui_elements,
    "ui_tree": handle_get_ui_elements,
    "tap_element": handle_tap_element,
    "tap": handle_tap,
    "tap_ratio": handle_tap_ratio,
    "swipe": handle_swipe,
    "input_text": handle_input_text,
    "type": handle_input_text,
    "press_key": handle_press_key,
    "key": handle_press_key,
    "back": handle_back,
    "home": handle_home,
    "enter": handle_enter,
    "launch_app": handle_launch_app,
    "launch": handle_launch_app,
    "get_current_app": handle_get_current_app,
    "current_app": handle_get_current_app,
    "list_packages": handle_list_packages,
    "list_apps": handle_list_packages,
    "check_package": handle_check_package,
    "find_element": handle_find_element,
    "find_text": handle_find_element,
    "wait": handle_wait,
    "ensure_connected": handle_ensure_connected,
    "capabilities": handle_capabilities_action,
    # Convenience aliases
    "wake": handle_press_key,
    "wakeup": handle_press_key,
    "volume_up": handle_volume_up,
    "volume_down": handle_volume_down,
    "power": handle_power,
    "ui_tree": handle_get_ui_elements,
}


def execute_action(command: dict) -> dict:
    action = command.get("action", "")
    if not action:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Missing 'action' field"}

    handler = ACTION_MAP.get(action)
    if not handler:
        available = sorted(set(ACTION_MAP.keys()))
        return {
            "status": "error",
            "error": "ACTION_NOT_FOUND",
            "message": f"Unknown action: '{action}'",
            "available_actions": available,
        }

    try:
        return handler(command)
    except Exception as e:
        return {"status": "error", "error": "CLI_ERROR", "message": str(e), "action": action}


def execute_commands(raw_json: str) -> str:
    try:
        parsed = json.loads(raw_json)
    except json.JSONDecodeError as e:
        return json.dumps({"status": "error", "error": "INVALID_PARAMS", "message": f"Invalid JSON: {e}"}, ensure_ascii=False)

    if isinstance(parsed, dict):
        result = execute_action(parsed)
        return json.dumps(result, ensure_ascii=False)

    if isinstance(parsed, list):
        results = []
        for i, cmd in enumerate(parsed):
            if not isinstance(cmd, dict):
                results.append({"status": "error", "error": "INVALID_PARAMS", "message": f"Command #{i} is not a JSON object"})
                break
            result = execute_action(cmd)
            results.append(result)
            if result.get("status") == "error":
                break
        return json.dumps(results, ensure_ascii=False)

    return json.dumps({"status": "error", "error": "INVALID_PARAMS", "message": "Input must be a JSON object or array"}, ensure_ascii=False)


def cli_main(args: list[str] | None = None):
    if args is None:
        args = sys.argv[1:]

    if not args:
        print(json.dumps({"status": "error", "error": "INVALID_PARAMS", "message": "No JSON command provided."}, ensure_ascii=False))
        sys.exit(1)

    raw_json = args[0]

    if raw_json == "-":
        raw_json = sys.stdin.read().strip()

    if not raw_json:
        print(json.dumps({"status": "error", "error": "INVALID_PARAMS", "message": "Empty command"}, ensure_ascii=False))
        sys.exit(1)

    output = execute_commands(raw_json)
    print(output)


def serve_main(input_stream=None, output_stream=None):
    if input_stream is None:
        input_stream = sys.stdin
    if output_stream is None:
        output_stream = sys.stdout

    for line in input_stream:
        raw_json = line.strip()
        if not raw_json:
            continue
        output = execute_commands(raw_json)
        output_stream.write(output + "\n")
        output_stream.flush()
