import socket
import time
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from html import escape
from urllib.parse import urljoin, urlparse
from typing import Any


SSDP_ADDR = "239.255.255.250"
SSDP_PORT = 1900
SEARCH_TYPES = [
    "urn:schemas-upnp-org:device:MediaRenderer:1",
    "urn:schemas-upnp-org:service:AVTransport:1",
    "upnp:rootdevice",
]


def discover_dlna(command: dict[str, Any]) -> dict[str, Any]:
    timeout = float(command.get("timeout") or 3)
    timeout = min(10.0, max(1.0, timeout))
    target_ip = str(command.get("target_ip") or "").strip()

    responses = _search_ssdp(timeout, target_ip or None)
    devices = [_hydrate_device(item) for item in responses.values()]
    devices.sort(key=lambda item: (item.get("name") or "", item.get("ip") or ""))
    return {
        "status": "success",
        "data": {
            "devices": devices,
            "count": len(devices),
            "timeout": timeout,
        },
    }


def play_url(command: dict[str, Any]) -> dict[str, Any]:
    location = str(command.get("location") or "").strip()
    url = str(command.get("url") or "").strip()
    title = str(command.get("title") or "HomeSense Media").strip() or "HomeSense Media"
    content_type = str(command.get("content_type") or "audio/mpeg").strip() or "audio/mpeg"
    if not location:
        return _error("INVALID_PARAMS", "location is required")
    if not url:
        return _error("INVALID_PARAMS", "url is required")

    controller_result = _create_controller(location)
    if isinstance(controller_result, dict):
        return controller_result
    controller = controller_result
    if not controller.av_transport_url:
        return _error("DLNA_SERVICE_MISSING", "AVTransport service is not available on this device")

    metadata = _build_didl_lite(url, title, content_type)
    set_result = controller.call(
        "AVTransport",
        "SetAVTransportURI",
        {
            "InstanceID": 0,
            "CurrentURI": url,
            "CurrentURIMetaData": metadata,
        },
    )
    if set_result.get("status") != "success":
        return set_result

    play_result = controller.call("AVTransport", "Play", {"InstanceID": 0, "Speed": "1"})
    if play_result.get("status") != "success":
        return play_result

    return {
        "status": "success",
        "data": {
            "location": location,
            "url": url,
            "title": title,
            "content_type": content_type,
        },
    }


def control(command: dict[str, Any]) -> dict[str, Any]:
    location = str(command.get("location") or "").strip()
    action = str(command.get("control") or command.get("command") or command.get("action_name") or "").strip().lower()
    if not location:
        return _error("INVALID_PARAMS", "location is required")
    if not action:
        return _error("INVALID_PARAMS", "control is required")

    controller_result = _create_controller(location)
    if isinstance(controller_result, dict):
        return controller_result
    controller = controller_result
    if action in {"play", "resume"}:
        return controller.call("AVTransport", "Play", {"InstanceID": 0, "Speed": "1"})
    if action == "pause":
        return controller.call("AVTransport", "Pause", {"InstanceID": 0})
    if action == "stop":
        return controller.call("AVTransport", "Stop", {"InstanceID": 0})
    if action == "volume":
        volume_raw = command.get("volume")
        try:
            volume = min(100, max(0, int(volume_raw)))
        except (TypeError, ValueError):
            return _error("INVALID_PARAMS", "volume must be an integer between 0 and 100")
        return controller.call(
            "RenderingControl",
            "SetVolume",
            {"InstanceID": 0, "Channel": "Master", "DesiredVolume": volume},
        )
    return _error("INVALID_CONTROL", f"Unsupported DLNA control: {action}")


def status(command: dict[str, Any]) -> dict[str, Any]:
    location = str(command.get("location") or "").strip()
    if not location:
        return _error("INVALID_PARAMS", "location is required")

    controller_result = _create_controller(location)
    if isinstance(controller_result, dict):
        return controller_result
    controller = controller_result
    transport = controller.call("AVTransport", "GetTransportInfo", {"InstanceID": 0})
    position = controller.call("AVTransport", "GetPositionInfo", {"InstanceID": 0})
    volume = controller.call("RenderingControl", "GetVolume", {"InstanceID": 0, "Channel": "Master"})

    data: dict[str, Any] = {}
    if transport.get("status") == "success":
        data["state"] = _first_xml_text(str(transport.get("response") or ""), "CurrentTransportState")
        data["transport_status"] = _first_xml_text(str(transport.get("response") or ""), "CurrentTransportStatus")
    else:
        data["transport_error"] = transport.get("message") or transport.get("error")
    if position.get("status") == "success":
        data["duration"] = _first_xml_text(str(position.get("response") or ""), "TrackDuration")
        data["position"] = _first_xml_text(str(position.get("response") or ""), "RelTime")
        data["title"] = _first_xml_text(str(position.get("response") or ""), "TrackMetaData")
    else:
        data["position_error"] = position.get("message") or position.get("error")
    if volume.get("status") == "success":
        raw_volume = _first_xml_text(str(volume.get("response") or ""), "CurrentVolume")
        try:
            data["volume"] = int(raw_volume) if raw_volume is not None else None
        except ValueError:
            data["volume"] = raw_volume
    else:
        data["volume_error"] = volume.get("message") or volume.get("error")

    if not data:
        return _error("DLNA_STATUS_FAILED", "Failed to read DLNA status")
    return {"status": "success", "data": data}


def _search_ssdp(timeout: float, target_ip: str | None) -> dict[str, dict[str, Any]]:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.settimeout(0.25)

    try:
        sock.bind(("", 0))
    except OSError:
        pass

    targets = [(SSDP_ADDR, SSDP_PORT)]
    if target_ip:
        targets.append((target_ip, SSDP_PORT))

    for st in SEARCH_TYPES:
        message = (
            "M-SEARCH * HTTP/1.1\r\n"
            f"HOST: {SSDP_ADDR}:{SSDP_PORT}\r\n"
            'MAN: "ssdp:discover"\r\n'
            "MX: 2\r\n"
            f"ST: {st}\r\n"
            "\r\n"
        ).encode("utf-8")
        for target in targets:
            try:
                sock.sendto(message, target)
            except OSError:
                continue

    found: dict[str, dict[str, Any]] = {}
    started = time.monotonic()
    while time.monotonic() - started < timeout:
        try:
            data, addr = sock.recvfrom(4096)
        except socket.timeout:
            continue
        except OSError:
            break
        parsed = _parse_response(data, addr)
        if not parsed:
            continue
        found[parsed["udn"]] = {**found.get(parsed["udn"], {}), **parsed}

    sock.close()
    return found


def _parse_response(data: bytes, addr: tuple[str, int]) -> dict[str, Any] | None:
    text = data.decode("utf-8", errors="ignore")
    headers = _parse_headers(text)
    location = headers.get("LOCATION", "")
    usn = headers.get("USN", "")
    if not location or not usn:
        return None

    parsed_location = urlparse(location)
    udn = usn.split("::", 1)[0]
    return {
        "id": f"dlna:{udn}",
        "udn": udn,
        "name": headers.get("SERVER", "DLNA Renderer").split("/", 1)[0] or "DLNA Renderer",
        "location": location,
        "ip": parsed_location.hostname or addr[0],
        "port": parsed_location.port or 80,
        "device_type": headers.get("ST") or headers.get("NT") or "",
        "server": headers.get("SERVER", ""),
        "services": [],
    }


def _parse_headers(text: str) -> dict[str, str]:
    headers: dict[str, str] = {}
    for line in text.replace("\r\n", "\n").split("\n")[1:]:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        headers[key.upper().strip()] = value.strip()
    return headers


def _hydrate_device(device: dict[str, Any]) -> dict[str, Any]:
    location = str(device.get("location") or "")
    if not location:
        return device
    try:
        request = urllib.request.Request(location, headers={"User-Agent": "HomeSense DLNA"})
        with urllib.request.urlopen(request, timeout=2) as response:
            xml_data = response.read()
        root = ET.fromstring(xml_data)
        friendly_name = _find_text(root, "friendlyName")
        model_name = _find_text(root, "modelName")
        manufacturer = _find_text(root, "manufacturer")
        services = [
            service
            for service in (_service_to_dict(node) for node in root.iter())
            if service
        ]
        if friendly_name:
            device["name"] = friendly_name
        if model_name:
            device["model"] = model_name
        if manufacturer:
            device["manufacturer"] = manufacturer
        if services:
            device["services"] = services
    except Exception:
        pass
    return device


class _DlnaController:
    def __init__(self, location: str):
        self.location = location
        self.av_transport_url = ""
        self.rendering_control_url = ""
        self._load_services()

    def _load_services(self) -> None:
        request = urllib.request.Request(self.location, headers={"User-Agent": "HomeSense DLNA Controller"})
        with urllib.request.urlopen(request, timeout=5) as response:
            xml_data = response.read()
        root = ET.fromstring(xml_data)
        for service in (_service_to_dict(node) for node in root.iter()):
            if not service:
                continue
            service_type = service.get("serviceType", "")
            control_url = service.get("controlURL", "")
            if not control_url:
                continue
            full_url = urljoin(self.location, control_url)
            if "AVTransport" in service_type:
                self.av_transport_url = full_url
            elif "RenderingControl" in service_type:
                self.rendering_control_url = full_url

    def call(self, service: str, action: str, params: dict[str, Any]) -> dict[str, Any]:
        target_url = self.av_transport_url if service == "AVTransport" else self.rendering_control_url
        if not target_url:
            return _error("DLNA_SERVICE_MISSING", f"{service} service is not available on this device")

        body = _build_soap_body(service, action, params)
        headers = {
            "Content-Type": "text/xml; charset=utf-8",
            "SOAPACTION": f'"urn:schemas-upnp-org:service:{service}:1#{action}"',
            "User-Agent": "HomeSense DLNA Controller",
        }
        request = urllib.request.Request(
            target_url,
            data=body.encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                response_text = response.read().decode("utf-8", errors="ignore")
            return {
                "status": "success",
                "data": {"service": service, "action": action},
                "response": response_text,
            }
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="ignore")[:500]
            return _error("DLNA_HTTP_ERROR", f"{action} failed with HTTP {e.code}", {"detail": detail})
        except Exception as e:
            return _error("DLNA_REQUEST_FAILED", f"{action} failed: {e}")


def _create_controller(location: str) -> "_DlnaController | dict[str, Any]":
    try:
        return _DlnaController(location)
    except Exception as e:
        return _error("DLNA_DESCRIPTION_FAILED", f"Failed to load DLNA device description: {e}")


def _build_didl_lite(uri: str, title: str, content_type: str) -> str:
    upnp_class = "object.item.audioItem" if content_type.startswith("audio") else "object.item.videoItem"
    protocol_info = (
        f"http-get:*:{content_type}:"
        "DLNA.ORG_PN=;DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000"
    )
    return (
        '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" '
        'xmlns:dlna="urn:schemas-dlna-org:metadata-1-0/" '
        'xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" '
        'xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">'
        '<item id="0" parentID="-1" restricted="1">'
        f"<upnp:class>{escape(upnp_class)}</upnp:class>"
        f"<dc:title>{escape(title)}</dc:title>"
        f'<res protocolInfo="{escape(protocol_info, quote=True)}">{escape(uri)}</res>'
        "</item></DIDL-Lite>"
    )


def _build_soap_body(service: str, action: str, params: dict[str, Any]) -> str:
    namespace = f"urn:schemas-upnp-org:service:{service}:1"
    param_xml = "\n".join(f"<{key}>{escape(str(value))}</{key}>" for key, value in params.items())
    return f"""<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:{action} xmlns:u="{namespace}">
      {param_xml}
    </u:{action}>
  </s:Body>
</s:Envelope>"""


def _first_xml_text(xml_text: str, local_name: str) -> str | None:
    if not xml_text:
        return None
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return None
    for node in root.iter():
        if _local_tag(node.tag) == local_name:
            return node.text.strip() if node.text else ""
    return None


def _error(error: str, message: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"status": "error", "error": error, "message": message}
    if data:
        result["data"] = data
    return result


def _find_text(root: ET.Element, local_name: str) -> str:
    for node in root.iter():
        if _local_tag(node.tag) == local_name and node.text:
            return node.text.strip()
    return ""


def _service_to_dict(node: ET.Element) -> dict[str, str] | None:
    if _local_tag(node.tag) != "service":
        return None
    service: dict[str, str] = {}
    for child in list(node):
        name = _local_tag(child.tag)
        if name in {"serviceType", "serviceId", "controlURL", "eventSubURL", "SCPDURL"} and child.text:
            service[name] = child.text.strip()
    return service if service.get("serviceType") else None


def _local_tag(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag
