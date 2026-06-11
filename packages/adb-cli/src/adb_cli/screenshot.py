import base64
import os
from typing import Any, Callable

AdbDeps = dict[str, Callable[..., Any]]


def handle_screenshot(params: dict, deps: AdbDeps) -> dict:
    try:
        from PIL import Image
    except ImportError:
        return {"status": "error", "error": "DEP_MISSING", "message": "Pillow not installed, run: pip install Pillow"}

    from io import BytesIO

    save_path = params.get("path")
    if not save_path:
        cache_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")
        os.makedirs(cache_dir, exist_ok=True)
        save_path = os.path.join(cache_dir, "screenshot.jpg")

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

        img = Image.open(save_path)
        if img.mode == "RGBA":
            rgb_img = Image.new("RGB", img.size, (255, 255, 255))
            rgb_img.paste(img, mask=img.split()[3])
            img = rgb_img
        elif img.mode != "RGB":
            img = img.convert("RGB")

        output = BytesIO()
        img.save(output, format="JPEG", quality=40, optimize=True)
        image_bytes = output.getvalue()
        with open(save_path, "wb") as file:
            file.write(image_bytes)

        data = {
            "path": save_path, "width": img.size[0], "height": img.size[1],
            "size_bytes": len(image_bytes),
        }
        if params.get("include_base64") or params.get("inline"):
            data["mime"] = "image/jpeg"
            data["base64"] = base64.b64encode(image_bytes).decode("ascii")

        return {
            "status": "success",
            "data": data,
        }
    except Exception as exc:
        return {"status": "error", "error": "CLI_ERROR", "message": str(exc)}
