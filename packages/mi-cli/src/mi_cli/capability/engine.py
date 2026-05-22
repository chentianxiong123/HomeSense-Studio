CAPABILITY_REGISTRY = {
    "power": {
        "kind": "property",
        "name_cn": "电源开关",
        "aliases": ["on", "switch-status", "power", "status"],
        "value_type": "boolean",
        "domains": ["switch"],
    },
    "toggle": {
        "kind": "action",
        "name_cn": "翻转",
        "aliases": ["toggle"],
        "value_type": "none",
        "domains": ["switch"],
    },
    "brightness": {
        "kind": "property",
        "name_cn": "亮度",
        "aliases": ["brightness"],
        "value_type": "integer",
        "domains": ["light"],
    },
    "color_temperature": {
        "kind": "property",
        "name_cn": "色温",
        "aliases": ["color-temperature", "color_temperature", "colortemperature"],
        "value_type": "integer",
        "domains": ["light"],
    },
    "target_temperature": {
        "kind": "property",
        "name_cn": "目标温度",
        "aliases": ["target-temperature", "target_temperature", "target-temp", "ac-target-temperature"],
        "value_type": "integer",
        "domains": ["climate"],
    },
    "mode": {
        "kind": "property",
        "name_cn": "模式",
        "aliases": ["mode", "air-conditioner-mode", "ac-mode", "fan-mode"],
        "value_type": "string",
        "value_resolution": ["enum", "string"],
        "domains": ["climate"],
    },
    "fan_speed": {
        "kind": "property",
        "name_cn": "风速",
        "aliases": ["fan-level", "fan_level", "speed-level", "wind-speed", "fan_speed"],
        "value_type": "integer",
        "domains": ["fan"],
    },
    "cover_position": {
        "kind": "property",
        "name_cn": "窗帘位置",
        "aliases": ["motor-control", "target-position", "target_position", "position"],
        "value_type": "integer",
        "domains": ["cover"],
    },
    "pm2_5": {
        "kind": "property",
        "name_cn": "PM2.5",
        "aliases": ["pm2.5", "pm25", "pm-2-5", "pm2_5_density"],
        "value_type": "integer",
        "domains": ["sensor"],
    },
    "temperature": {
        "kind": "property",
        "name_cn": "温度",
        "aliases": ["temperature", "indoor-temperature", "current-temperature"],
        "value_type": "float",
        "domains": ["sensor"],
    },
    "humidity": {
        "kind": "property",
        "name_cn": "湿度",
        "aliases": ["humidity", "relative-humidity", "indoor-humidity"],
        "value_type": "float",
        "domains": ["sensor"],
    },
    "ir_keys": {
        "kind": "property",
        "name_cn": "红外按键",
        "aliases": ["ir-keys", "ir_key"],
        "value_type": "string",
        "domains": ["remote"],
    },
    "play_music": {
        "kind": "action",
        "name_cn": "播放音乐",
        "aliases": ["play-music"],
        "value_type": "string",
        "domains": ["media_player"],
    },
    "execute_text": {
        "kind": "action",
        "name_cn": "执行文本命令",
        "aliases": ["execute-text-directive", "execute_directive", "execute-text"],
        "value_type": "string",
        "domains": ["xiaoai"],
    },
    "play_text": {
        "kind": "action",
        "name_cn": "播放文本",
        "aliases": ["play-text", "speak"],
        "value_type": "string",
        "domains": ["media_player"],
    },
    # 红外电视/投影仪/机顶盒通用动作 — 只归 remote domain，避免重复
    "turn_on": {
        "kind": "action",
        "name_cn": "开机",
        "aliases": ["turn-on", "turn_on", "power-on", "power_on"],
        "value_type": "none",
        "domains": ["remote"],
    },
    "turn_off": {
        "kind": "action",
        "name_cn": "关机",
        "aliases": ["turn-off", "turn_off", "power-off", "power_off"],
        "value_type": "none",
        "domains": ["remote"],
    },
    "volume_up": {
        "kind": "action",
        "name_cn": "音量增加",
        "aliases": ["volume-up", "volume_up", "音量加"],
        "value_type": "none",
        "domains": ["media_player", "remote"],
    },
    "volume_down": {
        "kind": "action",
        "name_cn": "音量减小",
        "aliases": ["volume-down", "volume_down", "音量减"],
        "value_type": "none",
        "domains": ["media_player", "remote"],
    },
    "shutdown": {
        "kind": "action",
        "name_cn": "关机",
        "aliases": ["shutdown", "power-off-speaker"],
        "value_type": "none",
        "domains": ["media_player"],
    },
    "pause": {
        "kind": "action",
        "name_cn": "暂停播放",
        "aliases": ["pause", "pause-playback"],
        "value_type": "none",
        "domains": ["media_player"],
    },
    "channel_up": {
        "kind": "action",
        "name_cn": "频道加",
        "aliases": ["channel-up", "channel_up"],
        "value_type": "none",
        "domains": ["remote"],
    },
    "channel_down": {
        "kind": "action",
        "name_cn": "频道减",
        "aliases": ["channel-down", "channel_down"],
        "value_type": "none",
        "domains": ["remote"],
    },
    "mute_on": {
        "kind": "action",
        "name_cn": "静音开启",
        "aliases": ["mute-on", "mute_on"],
        "value_type": "none",
        "domains": ["remote"],
    },
    "mute_off": {
        "kind": "action",
        "name_cn": "静音关闭",
        "aliases": ["mute-off", "mute_off"],
        "value_type": "none",
        "domains": ["remote"],
    },
    "input_source": {
        "kind": "action",
        "name_cn": "切换输入源",
        "aliases": ["input-source-switch", "input_source_switch", "input-source", "input_source"],
        "value_type": "string",
        "domains": ["remote"],
    },
    # 路由器传感器
    "download_speed": {
        "kind": "property",
        "name_cn": "下载速度",
        "aliases": ["download-speed", "download_speed"],
        "value_type": "float",
        "domains": ["sensor"],
    },
    "upload_speed": {
        "kind": "property",
        "name_cn": "上传速度",
        "aliases": ["upload-speed", "upload_speed"],
        "value_type": "float",
        "domains": ["sensor"],
    },
    "connected_devices": {
        "kind": "property",
        "name_cn": "已连接设备数",
        "aliases": ["connected-device-number", "connected_device_number"],
        "value_type": "integer",
        "domains": ["sensor"],
    },
}


def extract_device_type(spec_type: str) -> str:
    if not spec_type:
        return ""
    parts = spec_type.split(":")
    for i, part in enumerate(parts):
        if part == "device" and i + 1 < len(parts):
            return parts[i + 1]
    return ""


def find_supported_property(properties: list, aliases: list, writable_only: bool = False) -> dict | None:
    for prop in properties:
        name = prop.get("name", "").lower().replace(" ", "-")
        if writable_only and "write" not in prop.get("access", []):
            continue
        for alias in aliases:
            if name == alias.lower() or name.replace("_", "-") == alias.lower():
                return prop
    return None


def find_supported_action(actions: list, aliases: list) -> dict | None:
    for act in actions:
        name = act.get("name", "").lower().replace(" ", "-")
        for alias in aliases:
            if name == alias.lower() or name.replace("_", "-") == alias.lower():
                return act
    return None


def build_device_capability_profile(device_type: str, properties: list, actions: list) -> dict:
    profile = {
        "device_type": device_type,
        "controls": {},
        "supported_operations": [],
        "domains": set(),
    }

    for cap_name, cap_def in CAPABILITY_REGISTRY.items():
        if cap_def["kind"] == "property":
            prop = find_supported_property(
                properties,
                cap_def["aliases"],
                writable_only=cap_def.get("value_type") not in ("none",),
            )
            if prop:
                profile["controls"][cap_name] = {
                    "siid": prop.get("siid", prop.get("iid", 0)),
                    "piid": prop.get("piid", prop.get("iid", 0)),
                    "type": cap_def["value_type"],
                }
                for domain in cap_def.get("domains", []):
                    profile["domains"].add(domain)
                profile["supported_operations"].append({
                    "capability": cap_name,
                    "kind": "property",
                    "name": prop.get("name", ""),
                })
        elif cap_def["kind"] == "action":
            act = find_supported_action(actions, cap_def["aliases"])
            if act:
                profile["controls"][cap_name] = {
                    "siid": act.get("siid", act.get("iid", 0)),
                    "aiid": act.get("aiid", act.get("iid", 0)),
                    "type": cap_def["value_type"],
                }
                for domain in cap_def.get("domains", []):
                    profile["domains"].add(domain)
                profile["supported_operations"].append({
                    "capability": cap_name,
                    "kind": "action",
                    "name": act.get("name", ""),
                })

    profile["domains"] = list(profile["domains"])
    return profile


def _find_capability_in_profile(device_info: dict, capability_name: str, kind: str) -> dict | None:
    """Search capability_profile for a matching entry; fall back to re-parsing spec if not found."""
    controls = device_info.get("capability_profile", {}).get("controls", {})
    entry = controls.get(capability_name)
    if entry:
        key = "aiid" if kind == "action" else "piid"
        if key in entry:
            result = {"siid": entry["siid"], key: entry[key], "type": entry.get("type", "none")}
            if kind == "property":
                result["piid"] = entry["piid"]
            return result

    # Fallback: re-parse spec — handles devices not in cache yet
    model = device_info.get("model")
    if not model:
        return None

    from mi_cli.api.spec import handle_spec_parse as _spec_parse
    spec_result = _spec_parse({"model": model})
    if spec_result.get("status") != "success":
        return None

    spec_data = spec_result.get("data", {})
    device_type = extract_device_type(spec_data.get("type", ""))
    properties, actions = [], []
    for svc in spec_data.get("services", []):
        siid = svc.get("iid", 0)
        for prop in svc.get("properties", []):
            properties.append({**prop, "siid": siid})
        for act in svc.get("actions", []):
            actions.append({**act, "siid": siid})

    cap_profile = build_device_capability_profile(device_type, properties, actions)
    entry = cap_profile.get("controls", {}).get(capability_name)
    if not entry:
        return None

    key = "aiid" if kind == "action" else "piid"
    if key not in entry:
        return None
    result = {"siid": entry["siid"], key: entry[key], "type": entry.get("type", "none")}
    if kind == "property":
        result["piid"] = entry["piid"]
    return result


def lookup_capability_for_action(device_info: dict, capability_name: str) -> dict | None:
    """Resolve a capability name (e.g. 'turn_on') → {siid, aiid, type} or None."""
    return _find_capability_in_profile(device_info, capability_name, "action")


def lookup_capability_for_property(device_info: dict, capability_name: str) -> dict | None:
    """Resolve a capability name (e.g. 'power') → {siid, piid, type} or None."""
    return _find_capability_in_profile(device_info, capability_name, "property")


def build_discover_summary(devices: list) -> list:
    """Compact AI-friendly device list grouped by capability kind."""
    summary = []
    for dev in devices:
        controls = dev.get("capability_profile", {}).get("controls", {})
        actions, properties = [], []
        for name, info in controls.items():
            (actions if "aiid" in info else properties).append(name)
        summary.append({
            "did": dev.get("did", ""),
            "name": dev.get("name", ""),
            "model": dev.get("model", ""),
            "room": dev.get("room_name", ""),
            "device_type": dev.get("device_type", ""),
            "connection_type": dev.get("connection_type", ""),
            "capabilities": {
                "actions": sorted(actions),
                "properties": sorted(properties),
            },
        })
    return summary


def build_device_capabilities_list(device_info: dict) -> list:
    """Build a pure Chinese structured capability list for a single device.

    Returns a list of capabilities with Chinese names and kinds only —
    no siid/piid/aiid exposed. Suitable for LLM-facing consumption.
    """
    cap_profile = device_info.get("capability_profile", {})
    device_type = cap_profile.get("device_type", "")

    # IR 设备（机顶盒/电视）：用统一"遥控按键"能力替代 MIoT 动作映射。
    # 每个设备的真实按键码表不同，不能靠 MIoT spec 通用映射覆盖全部键。
    if device_type in ("stb", "television"):
        return [{"name": "遥控按键", "kind": "action", "type": "string"}]

    controls = cap_profile.get("controls", {})
    domains = cap_profile.get("domains", [])
    capabilities = []
    for cap_key in controls:
        entry = CAPABILITY_REGISTRY.get(cap_key, {})
        cap_info = controls[cap_key]
        item = {
            "name": entry.get("name_cn", cap_key),
            "kind": cap_info.get("kind", entry.get("kind", "property")),
        }
        vtype = cap_info.get("type", entry.get("value_type"))
        if vtype and vtype != "none":
            item["type"] = vtype
        if entry.get("value_resolution"):
            item["value_resolution"] = entry["value_resolution"]
        capabilities.append(item)

    # Inject volume_up/volume_down/shutdown/pause for speaker-type devices only.
    # Don't use `domains` here — it's polluted by multi-domain registry entries
    # (e.g., volume_up belongs to both media_player and remote, so a remote-only
    # STB ends up with media_player in its domain set).
    device_type = cap_profile.get("device_type", "")
    if device_type == "speaker":
        injected_keys = {"volume_up", "volume_down", "shutdown", "pause"}
        existing = {c["name"] for c in capabilities}
        for key in injected_keys:
            if CAPABILITY_REGISTRY[key].get("name_cn") not in existing:
                entry = CAPABILITY_REGISTRY[key]
                item = {
                    "name": entry.get("name_cn", key),
                    "kind": entry.get("kind", "action"),
                }
                vtype = entry.get("value_type")
                if vtype and vtype != "none":
                    item["type"] = vtype
                capabilities.append(item)

    return capabilities


def generate_entities(device: dict, capability_profile: dict) -> list:
    entities = []
    did = device.get("did", "")
    device_name = device.get("name", "")
    domains = capability_profile.get("domains", [])

    if not domains:
        domains = ["switch"]

    for domain in domains:
        for cap_name, cap_info in capability_profile.get("controls", {}).items():
            entity_id = f"{domain}.{did}_{cap_name}"
            entity = {
                "entity_id": entity_id,
                "device_did": did,
                "domain": domain,
                "capability": cap_name,
                "name": f"{device_name} {cap_name}",
                "icon": "",
                "enabled": True,
            }
            if "siid" in cap_info:
                entity["siid"] = cap_info["siid"]
            if "piid" in cap_info:
                entity["piid"] = cap_info["piid"]
            if "aiid" in cap_info:
                entity["aiid"] = cap_info["aiid"]
            entities.append(entity)

    return entities