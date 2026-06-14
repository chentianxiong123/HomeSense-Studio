import re
import socket
import subprocess
import time


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", "", text or "").strip().lower()


def _first_match(pattern: str, text: str) -> str:
    match = re.search(pattern, text, re.MULTILINE)
    return match.group(1).strip() if match else ""


def _prop_value(props: dict[str, str], *keys: str) -> str:
    for key in keys:
        val = props.get(key, "").strip()
        if val:
            return val
    return ""


def _parse_getprop(output: str) -> dict[str, str]:
    props: dict[str, str] = {}
    for line in output.splitlines():
        match = re.match(r"\[(.*?)\]: \[(.*?)\]", line.strip())
        if match:
            props[match.group(1)] = match.group(2)
    return props


def _parse_meminfo(output: str) -> dict[str, int]:
    values: dict[str, int] = {}
    for line in output.splitlines():
        match = re.match(r"(MemTotal|MemAvailable|MemFree):\s+(\d+)", line)
        if match:
            values[match.group(1)] = int(match.group(2)) * 1024
    total = values.get("MemTotal", 0)
    available = values.get("MemAvailable") or values.get("MemFree", 0)
    return {"total": total, "used": max(total - available, 0), "available": available}


def _parse_storage(output: str) -> dict[str, int]:
    lines = [line.split() for line in output.splitlines() if line.strip()]
    for parts in lines:
        if len(parts) < 6 or parts[0].lower().startswith("filesystem"):
            continue
        mounted_on = parts[-1]
        if mounted_on != "/data":
            continue
        try:
            total = int(parts[1]) * 1024
            used = int(parts[2]) * 1024
            available = int(parts[3]) * 1024
            return {"total": total, "used": used, "available": available}
        except ValueError:
            return {"total": 0, "used": 0, "available": 0}
    return {"total": 0, "used": 0, "available": 0}


def _parse_battery(output: str) -> dict[str, int | str]:
    level = _first_match(r"level:\s*(\d+)", output)
    temperature = _first_match(r"temperature:\s*(\d+)", output)
    voltage = _first_match(r"voltage:\s*(\d+)", output)
    status = _first_match(r"status:\s*(\d+)", output)
    return {
        "level": int(level) if level.isdigit() else 0,
        "temperature_c": round(int(temperature) / 10, 1) if temperature.isdigit() else 0,
        "voltage_mv": int(voltage) if voltage.isdigit() else 0,
        "status": status,
    }


def _join_remote_path(base_path: str, name: str) -> str:
    if base_path == "/":
        return f"/{name}"
    return base_path.rstrip("/") + "/" + name


def _parse_ls_line(line: str, base_path: str) -> dict | None:
    line = line.strip()
    if not line or line.startswith("total "):
        return None
    match = re.match(
        r"^([bcdlps-][rwxstST-]{9})\s+\d+\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(.+)$",
        line,
    )
    if not match:
        return None
    mode, owner, group, size, date, time_part, name = match.groups()
    if name in (".", ".."):
        return None
    link_target = ""
    if " -> " in name:
        name, link_target = name.split(" -> ", 1)
    file_type = mode[0]
    return {
        "name": name,
        "path": _join_remote_path(base_path, name),
        "directory": file_type == "d",
        "symlink": file_type == "l",
        "link_target": link_target,
        "mode": mode,
        "owner": owner,
        "group": group,
        "size": int(size),
        "mtime": f"{date} {time_part}",
    }


def _is_binary(data: bytes) -> bool:
    if b"\x00" in data:
        return True
    if not data:
        return False
    textish = sum(1 for byte in data if byte in b"\t\r\n" or 32 <= byte <= 126 or byte >= 128)
    return (textish / len(data)) < 0.82


def _safe_int(value: str) -> int:
    try:
        return int(value.strip())
    except (TypeError, ValueError):
        return 0


def _normalize_ports(value: object) -> list[int]:
    if value is None or value == "":
        return [5555]
    if isinstance(value, int):
        values = [value]
    elif isinstance(value, str):
        values = [part.strip() for part in value.split(",")]
    elif isinstance(value, list):
        values = value
    else:
        values = [5555]

    ports: list[int] = []
    for raw in values:
        try:
            port = int(str(raw).strip())
        except (TypeError, ValueError):
            continue
        if 1 <= port <= 65535 and port not in ports:
            ports.append(port)
    return ports or [5555]


def _default_ipv4_subnet() -> str:
    subnets = _local_ipv4_subnets()
    return subnets[0] if subnets else "192.168.1.0/24"


def _local_ipv4_subnets() -> list[str]:
    candidates: list[str] = []
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.settimeout(0.2)
        probe.connect(("8.8.8.8", 80))
        candidates.append(probe.getsockname()[0])
        probe.close()
    except OSError:
        pass

    try:
        for addr in socket.gethostbyname_ex(socket.gethostname())[2]:
            candidates.append(addr)
    except OSError:
        pass

    candidates.extend(_platform_ipv4_addresses())

    subnets: list[str] = []
    for addr in candidates:
        if not _is_lan_ipv4(addr):
            continue
        subnet = f"{addr.rsplit('.', 1)[0]}.0/24"
        if subnet not in subnets:
            subnets.append(subnet)
    return subnets


def _platform_ipv4_addresses() -> list[str]:
    commands = []
    if socket.gethostname():
        commands.append(["ipconfig"])
        commands.append(["ifconfig"])
        commands.append(["ip", "-o", "-4", "addr", "show"])

    addresses: list[str] = []
    for command in commands:
        try:
            result = subprocess.run(command, capture_output=True, timeout=2)
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            continue
        text = (result.stdout or b"").decode("utf-8", errors="replace")
        text += (result.stderr or b"").decode("utf-8", errors="replace")
        for match in re.finditer(r"(?<![\d.])((?:\d{1,3}\.){3}\d{1,3})(?![\d.])", text):
            addr = match.group(1)
            if addr not in addresses:
                addresses.append(addr)
    return addresses


def _is_lan_ipv4(addr: str) -> bool:
    parts = addr.split(".")
    if len(parts) != 4:
        return False
    try:
        nums = [int(part) for part in parts]
    except ValueError:
        return False
    if any(num < 0 or num > 255 for num in nums):
        return False
    if nums[0] in (0, 127, 169):
        return False
    return (
        nums[0] == 10
        or (nums[0] == 172 and 16 <= nums[1] <= 31)
        or (nums[0] == 192 and nums[1] == 168)
    )


def _tcp_probe(host: str, port: int, timeout: float) -> dict | None:
    started = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return {
                "ip": host,
                "port": port,
                "address": f"{host}:{port}",
                "open": True,
                "latency_ms": round((time.perf_counter() - started) * 1000, 1),
            }
    except OSError:
        return None
