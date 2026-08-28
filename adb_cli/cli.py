import base64
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any
from urllib import request
from urllib.error import URLError, HTTPError


ROOT = Path(__file__).resolve().parents[2]
ADB_SCRIPT = ROOT / "agent" / "src" / "tools" / "adb" / "adb.py"
CONFIG_PATH = ROOT / "homesense-adb-cli-source" / "config.json"
DEVICES_PATH = ROOT / "homesense-adb-cli-source" / "adb_devices.json"


def _load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _load_device_config() -> dict[str, Any]:
    if not DEVICES_PATH.exists():
        return {}
    try:
        return json.loads(DEVICES_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _resolve_device_env(command: dict[str, Any]) -> dict[str, str]:
    device_config = _load_device_config()
    devices = device_config.get("devices", {})
    selected_name = command.get("device_name") or device_config.get("default_device")
    selected = devices.get(selected_name, {}) if selected_name else {}

    ip = command.get("device_ip") or selected.get("ip")
    port = command.get("device_port") or selected.get("port")

    env_updates: dict[str, str] = {}
    if ip:
        env_updates["TV_IP"] = str(ip)
    if port:
        env_updates["TV_PORT"] = str(port)
    return env_updates


def _run_adb_payload(payload: dict[str, Any]) -> dict[str, Any]:
    env = os.environ.copy()
    env.update(_resolve_device_env(payload))
    result = subprocess.run(
        [sys.executable, str(ADB_SCRIPT), "run", json.dumps(payload, ensure_ascii=False)],
        capture_output=True,
        text=True,
        cwd=str(ADB_SCRIPT.parent),
        env=env,
    )

    if result.stdout:
        try:
            return json.loads(result.stdout.strip())
        except json.JSONDecodeError:
            return {"status": "error", "error": "Invalid JSON returned by adb wrapper", "raw": result.stdout.strip()}

    error = result.stderr.strip() if result.stderr else f"Process exited with code {result.returncode}"
    return {"status": "error", "error": error}


def _read_image_as_base64(path: str) -> str:
    return base64.b64encode(Path(path).read_bytes()).decode("utf-8")


def _resolve_image_path(command: dict[str, Any]) -> tuple[str | None, dict[str, Any] | None]:
    image_path = command.get("image_path")
    if image_path:
        p = Path(image_path)
        if not p.exists():
            return None, {"status": "error", "error": f"image_path not found: {image_path}"}
        return str(p), None

    screenshot_result = _run_adb_payload({"action": "screenshot"})
    if screenshot_result.get("status") != "success":
        return None, screenshot_result
    return screenshot_result.get("path"), None


def _handle_ocr_local(command: dict[str, Any]) -> dict[str, Any]:
    image_path, error = _resolve_image_path(command)
    if error:
        return error

    config = _load_config()
    local_cfg = config.get("ocr_local", {})
    engine = command.get("engine") or local_cfg.get("engine", "paddleocr")

    if engine == "paddleocr":
        try:
            from paddleocr import PaddleOCR
        except ImportError:
            return {
                "status": "error",
                "error": "paddleocr not installed",
                "hint": "pip install paddleocr paddlepaddle",
                "provider": "ocr_local",
                "engine": engine,
            }

        lang = command.get("lang") or local_cfg.get("lang", "ch")
        try:
            ocr = PaddleOCR(lang=lang, use_doc_orientation_classify=False, use_doc_unwarping=False)
            raw = ocr.predict(image_path)
            texts: list[str] = []
            items: list[dict[str, Any]] = []
            if hasattr(raw, "data") and raw.data:
                for row in raw.data:
                    text = getattr(row, "rec_text", None) or getattr(row, "text", None)
                    score = getattr(row, "rec_score", None) or getattr(row, "score", None)
                    box = getattr(row, "dt_polys", None) or getattr(row, "box", None)
                    if text:
                        texts.append(text)
                        items.append({"text": text, "score": score, "box": box})
            return {
                "status": "success",
                "provider": "ocr_local",
                "engine": engine,
                "image_path": image_path,
                "count": len(items),
                "texts": texts,
                "items": items,
            }
        except Exception as exc:
            return {"status": "error", "error": str(exc), "provider": "ocr_local", "engine": engine}

    return {
        "status": "error",
        "error": f"unsupported local OCR engine: {engine}",
        "available_engines": ["paddleocr"],
    }


def _http_post_json(url: str, headers: dict[str, str], body: dict[str, Any], timeout: int = 60) -> dict[str, Any]:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = request.Request(url, data=data, headers=headers, method="POST")
    with request.urlopen(req, timeout=timeout) as resp:
        content = resp.read().decode("utf-8")
        return json.loads(content) if content else {}


def _handle_ocr_api(command: dict[str, Any]) -> dict[str, Any]:
    image_path, error = _resolve_image_path(command)
    if error:
        return error

    config = _load_config()
    api_cfg = config.get("ocr_api", {})
    url = command.get("url") or api_cfg.get("url")
    api_key = command.get("api_key") or api_cfg.get("api_key", "")
    model = command.get("model") or api_cfg.get("model", "")

    if not url:
        return {
            "status": "error",
            "error": "ocr_api.url is not configured",
            "hint": f"Edit {CONFIG_PATH}",
            "provider": "ocr_api",
        }

    try:
        result = _http_post_json(
            url=url,
            headers={
                "Content-Type": "application/json",
                **({"Authorization": f"Bearer {api_key}"} if api_key else {}),
            },
            body={
                "model": model,
                "image_base64": _read_image_as_base64(image_path),
                "image_path": image_path,
                "prompt": command.get("prompt", "Recognize all visible text in the image."),
            },
            timeout=int(command.get("timeout", api_cfg.get("timeout", 60))),
        )
        return {"status": "success", "provider": "ocr_api", "image_path": image_path, "result": result}
    except HTTPError as exc:
        return {"status": "error", "error": f"http {exc.code}", "provider": "ocr_api"}
    except URLError as exc:
        return {"status": "error", "error": str(exc.reason), "provider": "ocr_api"}
    except Exception as exc:
        return {"status": "error", "error": str(exc), "provider": "ocr_api"}


def _handle_vision_api(command: dict[str, Any]) -> dict[str, Any]:
    image_path, error = _resolve_image_path(command)
    if error:
        return error

    config = _load_config()
    api_cfg = config.get("vision_api", {})
    url = command.get("url") or api_cfg.get("url")
    api_key = command.get("api_key") or api_cfg.get("api_key", "")
    model = command.get("model") or api_cfg.get("model", "")
    prompt = command.get("prompt", "Describe the UI and actionable elements in this image.")

    if not url:
        return {
            "status": "error",
            "error": "vision_api.url is not configured",
            "hint": f"Edit {CONFIG_PATH}",
            "provider": "vision_api",
        }

    try:
        result = _http_post_json(
            url=url,
            headers={
                "Content-Type": "application/json",
                **({"Authorization": f"Bearer {api_key}"} if api_key else {}),
            },
            body={
                "model": model,
                "image_base64": _read_image_as_base64(image_path),
                "image_path": image_path,
                "prompt": prompt,
            },
            timeout=int(command.get("timeout", api_cfg.get("timeout", 60))),
        )
        return {
            "status": "success",
            "provider": "vision_api",
            "image_path": image_path,
            "prompt": prompt,
            "result": result,
        }
    except HTTPError as exc:
        return {"status": "error", "error": f"http {exc.code}", "provider": "vision_api"}
    except URLError as exc:
        return {"status": "error", "error": str(exc.reason), "provider": "vision_api"}
    except Exception as exc:
        return {"status": "error", "error": str(exc), "provider": "vision_api"}


CUSTOM_ACTIONS = {
    "ocr_local": _handle_ocr_local,
    "ocr_api": _handle_ocr_api,
    "vision_api": _handle_vision_api,
}


def cli_main(payload: str):
    if payload == "-":
        payload = sys.stdin.read().strip()

    try:
        command = json.loads(payload)
    except json.JSONDecodeError as exc:
        print(json.dumps({"status": "error", "error": f"Invalid JSON: {exc}"}, ensure_ascii=False))
        return

    if not isinstance(command, dict):
        print(json.dumps({"status": "error", "error": "CLI wrapper expects a single JSON object"}, ensure_ascii=False))
        return

    action = command.get("action")
    if action in CUSTOM_ACTIONS:
        print(json.dumps(CUSTOM_ACTIONS[action](command), ensure_ascii=False))
        return

    result = _run_adb_payload(command)
    print(json.dumps(result, ensure_ascii=False))
