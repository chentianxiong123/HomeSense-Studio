def _parse_device(dev: dict, home: dict) -> dict:
    model = dev.get("model", "")
    spec_type = dev.get("spec_type", dev.get("urn", ""))

    connection_type = "wifi"
    if dev.get("pid") == "8":
        connection_type = "gateway"
    elif "bluetooth" in model.lower() or dev.get("pid") == "6":
        connection_type = "bt"
    elif dev.get("ir_device_type"):
        connection_type = "ir"

    return {
        "did": dev.get("did", ""),
        "model": model,
        "name": dev.get("name", ""),
        "manufacturer": dev.get("brand", dev.get("manufacturer", "")),
        "connection_type": connection_type,
        "parent_id": dev.get("parent_id", dev.get("parent_device_id", None)),
        "spec_type": spec_type,
        "home_id": home.get("id"),
        "home_name": home.get("name", ""),
        "room_name": dev.get("room_name", ""),
        "features": [],
        "entities": [],
        "capability_profile": {
            "device_type": "",
            "domains": [],
            "controls": {},
            "supported_operations": [],
        },
    }
