import json
import sys

from mi_cli.api.auth import (
    handle_login_password,
    handle_login_qr,
    handle_login_qr_reset,
    handle_login_qr_status,
    handle_login_status,
    handle_login_logout,
    handle_prepare_login,
    handle_verify_ticket,
)
from mi_cli.api.device import handle_discover, handle_discover_ir, handle_get_prop, handle_set_prop, handle_run_action, handle_device_action, handle_device_prop, handle_device_info
from mi_cli.api.spec import handle_spec_parse
from mi_cli.api.speaker import handle_speaker_execute, handle_speaker_play, handle_speaker_status, handle_speaker_list
from mi_cli.api.ir import handle_ir_discover, handle_ir_get_keys, handle_ir_press_key
from mi_cli.api.scene import handle_scene_list, handle_scene_execute
from mi_cli.config import handle_config_get, handle_config_set

ACTION_MAP = {
    "login_password": handle_login_password,
    "verify_ticket": handle_verify_ticket,
    "login_qr": handle_login_qr,
    "login_qr_reset": handle_login_qr_reset,
    "login_qr_status": handle_login_qr_status,
    "prepare_login": handle_prepare_login,
    "login_status": handle_login_status,
    "login_logout": handle_login_logout,
    "discover": handle_discover,
    "discover_ir": handle_discover_ir,
    "get_prop": handle_get_prop,
    "set_prop": handle_set_prop,
    "run_action": handle_run_action,
    "spec_parse": handle_spec_parse,
    "scene_list": handle_scene_list,
    "scene_execute": handle_scene_execute,
    "speaker_list": handle_speaker_list,
    "speaker_execute": handle_speaker_execute,
    "speaker_play": handle_speaker_play,
    "speaker_status": handle_speaker_status,
    "ir_discover": handle_ir_discover,
    "ir_get_keys": handle_ir_get_keys,
    "ir_press_key": handle_ir_press_key,
    "device_action": handle_device_action,
    "device_prop": handle_device_prop,
    "device_info": handle_device_info,
    "config_get": handle_config_get,
    "config_set": handle_config_set,
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
