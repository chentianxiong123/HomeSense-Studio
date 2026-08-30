import concurrent.futures
import ipaddress
import re
import time
from typing import Any

from .utils import _default_ipv4_subnet, _local_ipv4_subnets, _normalize_ports, _tcp_probe

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
    subnet_text = str(params.get("subnet") or params.get("cidr") or "").strip()
    ports = _normalize_ports(params.get("ports") or params.get("port"))
    timeout_ms = max(80, min(int(params.get("timeout_ms") or params.get("timeout") or 350), 3000))
    workers = max(8, min(int(params.get("workers") or 96), 256))
    limit = max(1, min(int(params.get("limit") or 512), 4096))
    verify = bool(params.get("verify_adb", True))
    verify_limit = max(1, min(int(params.get("verify_limit") or 64), 256))
    include_offline = bool(params.get("include_offline", False))

    subnet_values = [subnet_text] if subnet_text else _local_ipv4_subnets() or [_default_ipv4_subnet()]
    networks = []
    for value in subnet_values:
        try:
            network = ipaddress.ip_network(value, strict=False)
        except ValueError as exc:
            return {"status": "error", "error": "INVALID_SUBNET", "message": str(exc)}
        if network.version != 4:
            return {"status": "error", "error": "INVALID_SUBNET", "message": "Only IPv4 subnet scan is supported"}
        networks.append(network)

    hosts: list[str] = []
    seen_hosts: set[str] = set()
    for network in networks:
        for host in network.hosts():
            text = str(host)
            if text in seen_hosts:
                continue
            seen_hosts.add(text)
            hosts.append(text)
            if len(hosts) >= limit:
                break
        if len(hosts) >= limit:
            break

    timeout = timeout_ms / 1000
    candidates_by_address: dict[str, dict] = {}
    devices = handle_list_devices({}, deps).get("data", {}).get("devices", [])
    connected = {item.get("device_id"): item for item in devices}

    for item in devices:
        device_id = str(item.get("device_id") or "")
        if ":" not in device_id:
            continue
        host, port = _split_address(device_id)
        if not host or not port:
            continue
        candidates_by_address[device_id] = {
            "ip": host,
            "port": port,
            "address": device_id,
            "open": item.get("status") == "device",
            "adb_status": item.get("status"),
            "source": "adb_devices",
        }

    for item in _discover_mdns_services(deps):
        candidates_by_address[item["address"]] = {
            **candidates_by_address.get(item["address"], {}),
            **item,
            "source": "adb_mdns",
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
            candidate["source"] = candidate.get("source") or "tcp_probe"
            candidates_by_address[candidate["address"]] = {
                **candidates_by_address.get(candidate["address"], {}),
                **candidate,
            }

    if verify:
        verified: dict[str, dict] = {}
        pending = [
            item for item in candidates_by_address.values()
            if item.get("source") == "tcp_probe" and not item.get("adb_status")
        ][:verify_limit]
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(workers, 32)) as executor:
            futures = [executor.submit(_verify_adb_address, item["address"], deps) for item in pending]
            for future in concurrent.futures.as_completed(futures):
                item = future.result()
                if item:
                    verified[item["address"]] = item

        for address, item in list(candidates_by_address.items()):
            if item.get("source") != "tcp_probe":
                continue
            if item.get("adb_status"):
                continue
            if address in verified:
                candidates_by_address[address] = { **item, **verified[address] }
            else:
                del candidates_by_address[address]

    candidates = [
        item for item in candidates_by_address.values()
        if include_offline
        or item.get("adb_status") in ("device", "unauthorized")
        or item.get("source") in ("adb_devices", "adb_mdns")
    ]
    candidates.sort(key=lambda item: tuple(int(part) for part in item["ip"].split(".")) + (int(item["port"]),))
    return {
        "status": "success",
        "data": {
            "subnet": ", ".join(str(network) for network in networks),
            "subnets": [str(network) for network in networks],
            "ports": ports,
            "timeout_ms": timeout_ms,
            "verify_adb": verify,
            "include_offline": include_offline,
            "scanned": len(hosts) * len(ports),
            "candidates": candidates,
            "count": len(candidates),
        },
    }


def _verify_adb_address(address: str, deps: AdbDeps) -> dict | None:
    out, err, code = deps["run_cmd"](["connect", address], timeout=4)
    message = (out or err or "").strip()
    lowered = message.lower()
    if code != 0:
        return None
    if "connected" not in lowered and "already connected" not in lowered:
        return None
    status = get_device_status(address, deps)
    if status not in ("device", "unauthorized", "offline"):
        return None
    host, port = _split_address(address)
    if not host or not port:
        return None
    return {
        "ip": host,
        "port": port,
        "address": address,
        "open": True,
        "adb_status": status,
        "source": "adb_connect",
        "message": message,
    }


def _split_address(address: str) -> tuple[str, int | None]:
    host, _, port_text = address.rpartition(":")
    if not host or not port_text:
        return "", None
    try:
        port = int(port_text)
    except ValueError:
        return "", None
    return host, port


def _discover_mdns_services(deps: AdbDeps) -> list[dict]:
    out, _, code = deps["run_cmd"](["mdns", "services"], timeout=5)
    if code != 0 or not out:
        return []
    candidates = []
    for line in out.splitlines():
        if "_adb-tls-connect" not in line and "_adb._tcp" not in line:
            continue
        address = _extract_address(line)
        if not address:
            continue
        host, port = _split_address(address)
        if not host or not port:
            continue
        candidates.append({
            "ip": host,
            "port": port,
            "address": address,
            "open": True,
            "adb_status": "mdns",
            "service": line.strip(),
        })
    return candidates


def _extract_address(text: str) -> str:
    match = re.search(r"((?:\d{1,3}\.){3}\d{1,3}):(\d{1,5})", text)
    if match:
        return f"{match.group(1)}:{match.group(2)}"
    return ""


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
