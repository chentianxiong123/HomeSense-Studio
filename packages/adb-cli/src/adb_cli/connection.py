import concurrent.futures
import ipaddress
import time
from typing import Any

from .utils import _default_ipv4_subnet, _normalize_ports, _tcp_probe

AdbDeps = dict[str, Any]


def handle_list_devices(params: dict, deps: AdbDeps) -> dict:
    out, stderr, code = deps["run_cmd"](["devices", "-l"])
    if code != 0:
        return {"status": "error", "error": "EXEC_FAILED", "message": stderr or "failed to list devices"}

    devices = []
    for line in out.strip().split("\n"):
        line = line.strip()
        if line and not line.startswith("List"):
            parts = line.split()
            if len(parts) >= 2:
                devices.append({
                    "device_id": parts[0],
                    "status": parts[1],
                    "info": " ".join(parts[2:]) if len(parts) > 2 else "",
                })

    return {"status": "success", "data": {"devices": devices, "count": len(devices)}}


def handle_scan_network(params: dict, deps: AdbDeps) -> dict:
    subnet_text = str(params.get("subnet") or params.get("cidr") or "").strip() or _default_ipv4_subnet()
    ports = _normalize_ports(params.get("ports") or params.get("port"))
    timeout_ms = max(80, min(int(params.get("timeout_ms") or params.get("timeout") or 350), 3000))
    workers = max(8, min(int(params.get("workers") or 96), 256))
    limit = max(1, min(int(params.get("limit") or 512), 4096))

    try:
        network = ipaddress.ip_network(subnet_text, strict=False)
    except ValueError as exc:
        return {"status": "error", "error": "INVALID_SUBNET", "message": str(exc)}

    if network.version != 4:
        return {"status": "error", "error": "INVALID_SUBNET", "message": "Only IPv4 subnet scan is supported"}

    hosts = [str(host) for host in network.hosts()][:limit]
    timeout = timeout_ms / 1000
    candidates: list[dict] = []
    connected = {
        item.get("device_id"): item
        for item in handle_list_devices({}, deps).get("data", {}).get("devices", [])
    }

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [
            executor.submit(_tcp_probe, host, port, timeout)
            for host in hosts
            for port in ports
        ]
        for future in concurrent.futures.as_completed(futures):
            candidate = future.result()
            if not candidate:
                continue
            status = connected.get(candidate["address"], {}).get("status")
            if status:
                candidate["adb_status"] = status
            candidates.append(candidate)

    candidates.sort(key=lambda item: tuple(int(part) for part in item["ip"].split(".")) + (int(item["port"]),))
    return {
        "status": "success",
        "data": {
            "subnet": str(network),
            "ports": ports,
            "timeout_ms": timeout_ms,
            "scanned": len(hosts) * len(ports),
            "candidates": candidates,
            "count": len(candidates),
        },
    }


def get_device_status(address: str, deps: AdbDeps) -> str | None:
    out, _, _ = deps["run_cmd"](["devices", "-l"], timeout=5)
    for line in out.splitlines():
        parts = line.strip().split()
        if len(parts) >= 2 and parts[0] == address:
            return parts[1]
    return None


def handle_connect(params: dict, deps: AdbDeps) -> dict:
    address = params.get("address") or params.get("device") or params.get("dev") or deps["default_device"]
    if not address:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Missing device address (use 'device' or 'address' param)"}

    if ":" not in address:
        return {"status": "error", "error": "INVALID_PARAMS", "message": f"Missing port in device address: '{address}'. Use format ip:port (e.g. 192.168.1.100:5555)"}

    max_attempts = int(params.get("max_attempts", 5))
    backoff_seconds = int(params.get("backoff_seconds", 2))
    logs = []

    for attempt in range(max_attempts):
        out, err, code = deps["run_cmd"](["connect", address], timeout=15)
        combined = (out or err or "").strip()
        logs.append({"attempt": attempt + 1, "message": combined, "code": code})

        connect_ok = code == 0 and ("connected" in out.lower() or "already connected" in out.lower())
        if connect_ok:
            for _ in range(30):
                status = get_device_status(address, deps)
                if status == "device":
                    deps["connected_cache"].add(address)
                    return {
                        "status": "success",
                        "data": {"message": combined, "address": address, "attempts": attempt + 1, "logs": logs},
                    }
                if status is None:
                    break
                time.sleep(1)
            status = get_device_status(address, deps)
            if status != "device":
                return {
                    "status": "error", "error": "DEVICE_OFFLINE",
                    "message": f"Device {address} is {status or 'disconnected'} after connect",
                    "data": {"address": address, "attempts": attempt + 1, "logs": logs},
                }

        if attempt < max_attempts - 1:
            time.sleep(backoff_seconds * (2 ** attempt))

    return {
        "status": "error", "error": "CONNECT_FAILED",
        "message": logs[-1]["message"] if logs else "failed to connect",
        "data": {"address": address, "attempts": max_attempts, "logs": logs},
    }


def handle_disconnect(params: dict, deps: AdbDeps) -> dict:
    address = params.get("address") or params.get("device") or params.get("dev") or deps["default_device"]
    if not address:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "Missing device address"}

    if ":" not in address:
        return {"status": "error", "error": "INVALID_PARAMS", "message": f"Missing port in device address: '{address}'. Use format ip:port (e.g. 192.168.1.100:5555)"}

    out, _, code = deps["run_cmd"](["disconnect", address])
    deps["connected_cache"].discard(address)
    if code != 0:
        return {"status": "error", "error": "EXEC_FAILED", "message": out.strip()}
    return {"status": "success", "data": {"message": out.strip(), "address": address}}
