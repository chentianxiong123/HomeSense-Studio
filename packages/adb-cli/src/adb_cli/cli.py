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
