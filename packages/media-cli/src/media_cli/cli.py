import json
import sys

from media_cli.bilibili import get_media_info, resolve_audio, search_bilibili
from media_cli.dlna import control as control_dlna
from media_cli.dlna import discover_dlna
from media_cli.dlna import play_url as play_dlna_url
from media_cli.dlna import status as status_dlna


def handle_health(command: dict) -> dict:
    return {
        "status": "success",
        "data": {
            "name": "media-cli",
            "providers": ["bilibili", "dlna"],
            "actions": sorted(ACTION_MAP.keys()),
        },
    }


ACTION_MAP = {
    "health": handle_health,
    "search": search_bilibili,
    "search_bilibili": search_bilibili,
    "bilibili_search": search_bilibili,
    "get_media_info": get_media_info,
    "bilibili_info": get_media_info,
    "resolve_audio": resolve_audio,
    "resolve_bilibili_audio": resolve_audio,
    "dlna_discover": discover_dlna,
    "discover_dlna": discover_dlna,
    "dlna_play_url": play_dlna_url,
    "play_dlna_url": play_dlna_url,
    "dlna_control": control_dlna,
    "control_dlna": control_dlna,
    "dlna_status": status_dlna,
    "status_dlna": status_dlna,
}


def execute_action(command: dict) -> dict:
    action = command.get("action", "")
    if not action:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Missing 'action' field"}

    handler = ACTION_MAP.get(action)
    if not handler:
        return {
            "status": "error",
            "error": "ACTION_NOT_FOUND",
            "message": f"Unknown action: '{action}'",
            "available_actions": sorted(ACTION_MAP.keys()),
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
        return json.dumps(execute_action(parsed), ensure_ascii=False)

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

    print(execute_commands(raw_json))


def serve_main(input_stream=None, output_stream=None):
    if input_stream is None:
        input_stream = sys.stdin
    if output_stream is None:
        output_stream = sys.stdout

    for line in input_stream:
        raw_json = line.strip()
        if not raw_json:
            continue
        output_stream.write(execute_commands(raw_json) + "\n")
        output_stream.flush()
