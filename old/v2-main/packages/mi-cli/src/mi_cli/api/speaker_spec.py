from mi_cli.api.device import _load_device_cache
from mi_cli.api.spec import handle_spec_parse as _spec_parse_internal


def _get_speaker_spec(auth_data: dict, did: str) -> dict | None:
    try:
        model = None
        cache = _load_device_cache()
        for dev in cache.get("devices", []):
            if dev.get("did") == did:
                model = dev.get("model")
                break
        if not model:
            return None
        r = _spec_parse_internal({"model": model})
        if r.get("status") != "success":
            return None
        return r.get("data")
    except Exception:
        return None


def _find_play_text_action(spec: dict) -> tuple:
    services = spec.get("services", []) if isinstance(spec, dict) else []
    for svc in services:
        sname = _canonical_name(svc.get("name", ""))
        siid = svc.get("iid", svc.get("siid", 0))
        for action in svc.get("actions", []):
            aname = _canonical_name(action.get("name", ""))
            if "play_text" in aname or "playtext" in aname:
                aiid = action.get("iid", action.get("aiid", 0))
                return siid, aiid
        if "intelligent_speaker" in sname:
            continue
    return None, None


def _find_execute_directive_action(spec: dict) -> tuple:
    services = spec.get("services", []) if isinstance(spec, dict) else []
    for svc in services:
        sname = _canonical_name(svc.get("name", ""))
        siid = svc.get("iid", svc.get("siid", 0))
        for action in svc.get("actions", []):
            aname = _canonical_name(action.get("name", ""))
            if "execute_text_directive" in aname or "execute_directive" in aname:
                aiid = action.get("iid", action.get("aiid", 0))
                return siid, aiid
        if "intelligent_speaker" in sname:
            continue
    return None, None


def _find_message_router_action(spec: dict) -> tuple:
    services = spec.get("services", []) if isinstance(spec, dict) else []
    for svc in services:
        sname = _canonical_name(svc.get("name", ""))
        siid = svc.get("iid", svc.get("siid", 0))
        if "message_router" in sname:
            for action in svc.get("actions", []):
                aname = _canonical_name(action.get("name", ""))
                if "post" in aname:
                    aiid = action.get("iid", action.get("aiid", 0))
                    return siid, aiid
    return None, None


def _get_silent_value(spec: dict, siid: int, silent: bool) -> str:
    services = spec.get("services", []) if isinstance(spec, dict) else []
    for svc in services:
        if svc.get("iid", svc.get("siid", 0)) == siid:
            for prop in svc.get("properties", []):
                pname = prop.get("name", "").lower()
                if "silent" in pname:
                    if prop.get("format") == "str" or "value-list" in str(prop.get("format", "")):
                        return "On" if silent else "Off"
                    else:
                        return 1 if silent else 0
    return 1 if silent else 0


def _canonical_name(value: str) -> str:
    return str(value).lower().replace("-", "_").replace(" ", "_")
