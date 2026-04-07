"""
HAMI 工具 - Home Assistant 设备控制
通过 WebSocket 调用 Home Assistant 服务
"""
import os
import sys
import json

HA_URL = os.getenv("HAMi_URL", "ws://192.168.31.204:8123/api/websocket")
HA_TOKEN = os.getenv("HAMi_TOKEN", "")

ENTITIES = {
    "tvs_toshiba": "select.remote_ir_2038224602945437696",
    "stb": "select.remote_ir_2038476279661080578",
    "tv_letv": "select.remote_ir_2038581922699296768",
}


def ha_call(domain: str, service: str, entity_id: str, option_value: str):
    try:
        import websocket
    except ImportError:
        return {"success": False, "error": "websocket-client not installed, run: pip install websocket-client"}

    try:
        ws = websocket.create_connection(HA_URL, timeout=10)
        hello_raw = ws.recv()
        hello = json.loads(hello_raw)
        ws.send(json.dumps({"type": "auth", "access_token": HA_TOKEN}))
        auth_raw = ws.recv()
        result = json.loads(auth_raw)
        if result.get("type") != "auth_ok":
            ws.close()
            return {
                "success": False,
                "error": "auth_failed",
                "ha_url": HA_URL,
                "token_present": bool(HA_TOKEN),
                "hello": hello,
                "auth_response": result,
            }


        if service == "set_value":
            service_data = {"entity_id": entity_id, "value": option_value}
        else:
            service_data = {"entity_id": entity_id, "option": option_value}

        ws.send(json.dumps({
            "id": 1,
            "type": "call_service",
            "domain": domain,
            "service": service,
            "service_data": service_data
        }))
        svc_result = json.loads(ws.recv())
        ws.close()
        return {"success": svc_result.get("success", False), "result": svc_result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def xiaoai_speak(text: str):
    return ha_call("text", "set_value", "text.xiaomi_lx5a_5dfb_play_text", text)


def xiaoai_execute(command: str):
    return ha_call("text", "set_value", "text.xiaomi_lx5a_5dfb_execute_text_directive", command)


def tv_remote(device: str, command: str):
    entity_id = ENTITIES.get(device)
    if not entity_id:
        return {"success": False, "error": f"未知设备: {device}"}
    return ha_call("select", "select_option", entity_id, command)


TOOLS = {
    "xiaoai_speak": {
        "name": "xiaoai_speak",
        "description": "小爱同学说话",
        "params": {"text": "str"},
        "func": lambda p: xiaoai_speak(p["text"])
    },
    "xiaoai_execute": {
        "name": "xiaoai_execute",
        "description": "小爱同学执行指令",
        "params": {"command": "str"},
        "func": lambda p: xiaoai_execute(p["command"])
    },
    "tv_remote": {
        "name": "tv_remote",
        "description": "电视遥控",
        "params": {"device": "str", "command": "str"},
        "func": lambda p: tv_remote(p["device"], p["command"])
    },
}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Missing action"}))
        print("可用工具:", list(TOOLS.keys()))
        sys.exit(1)

    action = sys.argv[1]
    params = {}
    for arg in sys.argv[2:]:
        if "=" in arg:
            key, value = arg.split("=", 1)
            if value.isdigit():
                value = int(value)
            elif value.lower() in ["true", "false"]:
                value = value.lower() == "true"
            params[key] = value

    if action not in TOOLS:
        print(json.dumps({"success": False, "error": f"Unknown action: {action}"}))
        sys.exit(1)

    result = TOOLS[action]["func"](params)
    print(json.dumps(result, ensure_ascii=False))
