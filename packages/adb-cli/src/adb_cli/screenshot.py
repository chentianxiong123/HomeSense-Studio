import base64
import os
import struct
from typing import Any, Callable

AdbDeps = dict[str, Callable[..., Any]]


def handle_screenshot(params: dict, deps: AdbDeps) -> dict:
    save_path = params.get("path")
    if not save_path:
        cache_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")
        os.makedirs(cache_dir, exist_ok=True)
        save_path = os.path.join(cache_dir, "screenshot.png")

    tv_path = "/data/local/tmp/screen.png"

    try:
        _, err1, code1 = deps["run_device_cmd"](params, ["shell", "screencap", "-p", tv_path])
        if code1 != 0:
            return {"status": "error", "error": "EXEC_FAILED", "message": f"screencap failed: {err1}"}

        _, err2, code2 = deps["run_device_cmd"](params, ["pull", tv_path, save_path])
        if code2 != 0:
            return {"status": "error", "error": "EXEC_FAILED", "message": f"pull failed: {err2}"}

        if not os.path.exists(save_path):
            return {"status": "error", "error": "FILE_NOT_FOUND", "message": "screenshot file not found after pull"}

        with open(save_path, "rb") as file:
            image_bytes = file.read()
        width, height = _png_size(image_bytes)

        data = {
            "path": save_path,
            "width": width,
            "height": height,
            "size_bytes": len(image_bytes),
        }
        if params.get("include_base64") or params.get("inline"):
            data["mime"] = "image/png"
            data["base64"] = base64.b64encode(image_bytes).decode("ascii")

        return {
            "status": "success",
            "data": data,
        }
    except Exception as exc:
        return {"status": "error", "error": "CLI_ERROR", "message": str(exc)}


def _png_size(image_bytes: bytes) -> tuple[int, int]:
    if len(image_bytes) < 24 or image_bytes[:8] != b"\x89PNG\r\n\x1a\n":
        return 0, 0
    return struct.unpack(">II", image_bytes[16:24])
