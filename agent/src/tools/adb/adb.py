"""
ADB 工具 - Android Debug Bridge
通过 adb 命令控制安卓设备
"""
import subprocess
import os
import json
import sys
import time
import re
from io import BytesIO

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

TV_IP = os.getenv("TV_IP", "192.168.31.124")
TV_PORT = os.getenv("TV_PORT", "5555")
ADB_PATH = os.getenv("ADB_PATH", "adb")
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")

TV_TEMP_DIR = "/data/local/tmp"

BILIBILI_PACKAGE_CANDIDATES = [
    "com.xiaodianshi.tv.yst",
    "tv.danmaku.bili",
    "com.bilibili.app.in",
    "com.bilibili.android",
]

DANGBEI_PACKAGE_CANDIDATES = [
    "com.dangbeimarket",
]

BILIBILI_RESULT_ALIASES = [
    "B站",
    "哔哩",
    "哔哩哔哩",
    "云视听小电视",
    "小电视",
]

SEARCH_ENTRY_ALIASES = [
    "搜索",
    "Search",
]

INSTALL_BUTTON_ALIASES = [
    "安装",
    "下载",
    "立即安装",
    "立即下载",
    "重新安装",
]

OPEN_BUTTON_ALIASES = [
    "打开",
    "启动",
]

INSTALL_PROGRESS_ALIASES = [
    "安装中",
    "下载中",
    "正在安装",
    "正在下载",
    "等待安装",
    "继续安装",
]

INSTALL_CONFIRM_ALIASES = [
    "安装",
    "继续安装",
    "允许",
    "继续",
    "完成",
]

FALLBACK_COORDINATES = {
    "dangbei_search": (0.92, 0.09),
    "bilibili_result": (0.50, 0.30),
    "install_button": (0.86, 0.92),
}


def get_adb_prefix() -> list[str]:
    return [ADB_PATH, "-s", f"{TV_IP}:{TV_PORT}"]


def run_cmd(args: list[str], timeout: int = 10) -> tuple[str, str, int]:
    cmd = get_adb_prefix() + args
    result = subprocess.run(cmd, capture_output=True, timeout=timeout)
    stdout = result.stdout.decode("utf-8", errors="replace") if result.stdout else ""
    stderr = result.stderr.decode("utf-8", errors="replace") if result.stderr else ""
    return stdout, stderr, result.returncode


def run_global_cmd(args: list[str], timeout: int = 10) -> tuple[str, str, int]:
    result = subprocess.run([ADB_PATH] + args, capture_output=True, timeout=timeout)
    stdout = result.stdout.decode("utf-8", errors="replace") if result.stdout else ""
    stderr = result.stderr.decode("utf-8", errors="replace") if result.stderr else ""
    return stdout, stderr, result.returncode


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", "", text or "").strip().lower()


def any_text_matches(texts: list[str], aliases: list[str]) -> str | None:
    normalized_texts = [(text, normalize_text(text)) for text in texts if normalize_text(text)]
    for alias in aliases:
        normalized_alias = normalize_text(alias)
        if not normalized_alias:
            continue
        for raw_text, normalized in normalized_texts:
            if normalized_alias == normalized or normalized_alias in normalized or normalized in normalized_alias:
                return raw_text
    return None


def get_display_size() -> dict:
    out, stderr, code = run_cmd(["shell", "wm", "size"])
    if code != 0:
        return {"success": False, "error": stderr or "failed_to_get_display_size"}

    match = re.search(r"(\d+)\s*x\s*(\d+)", out)
    if not match:
        return {"success": False, "error": f"unexpected_wm_size_output: {out.strip()}"}

    return {
        "success": True,
        "width": int(match.group(1)),
        "height": int(match.group(2)),
    }


def tap_ratio(x_ratio: float, y_ratio: float) -> dict:
    size = get_display_size()
    if not size.get("success"):
        width = 1920
        height = 1080
    else:
        width = int(size["width"])
        height = int(size["height"])

    x = int(width * x_ratio)
    y = int(height * y_ratio)
    result = tap(x, y)
    result["x"] = x
    result["y"] = y
    result["coordinate_mode"] = "ratio"
    return result


def ui_snapshot() -> tuple[dict, list[str]]:
    result = get_ui_tree()
    texts = []
    if result.get("success"):
        texts = [
            str(element.get("text", "")).strip()
            for element in result.get("elements", [])
            if str(element.get("text", "")).strip()
        ]
    return result, texts


def find_ui_match(aliases: list[str]) -> dict:
    ui_result = get_ui_tree()
    if not ui_result.get("success"):
        return ui_result

    elements = ui_result.get("elements", [])
    for alias in aliases:
        normalized_alias = normalize_text(alias)
        if not normalized_alias:
            continue
        for element in elements:
            text = str(element.get("text", "")).strip()
            normalized_text_value = normalize_text(text)
            if not normalized_text_value:
                continue
            if normalized_alias == normalized_text_value or normalized_alias in normalized_text_value or normalized_text_value in normalized_alias:
                return {
                    "success": True,
                    "match": element,
                    "matched_text": text,
                    "query": alias,
                    "strategy": "ui_tree_alias",
                }

    return {"success": False, "error": f"aliases_not_found: {aliases}", "strategy": "ui_tree_alias"}


def click_ui_alias(aliases: list[str]) -> dict:
    match_result = find_ui_match(aliases)
    if not match_result.get("success"):
        return match_result

    center = match_result["match"].get("center")
    if not center or len(center) != 2:
        return {"success": False, "error": "match_center_missing", "aliases": aliases}

    tap_result = tap(center[0], center[1])
    tap_result["matched_text"] = match_result.get("matched_text")
    tap_result["query"] = match_result.get("query")
    tap_result["strategy"] = match_result.get("strategy")
    tap_result["center"] = center
    return tap_result


def ensure_device_connected() -> dict:
    listed = list_devices()
    if listed.get("success"):
        target_id = f"{TV_IP}:{TV_PORT}"
        for device in listed.get("devices", []):
            if device.get("id") == target_id and device.get("status") == "device":
                return {"success": True, "message": "already_connected", "device": target_id}

    connected = connect_device(TV_IP, int(TV_PORT))
    if connected.get("success"):
        return {"success": True, "message": connected.get("message", "connected"), "device": f"{TV_IP}:{TV_PORT}"}

    return {"success": False, "error": connected.get("message", "failed_to_connect"), "device": f"{TV_IP}:{TV_PORT}"}


def get_installed_packages() -> dict:
    out, stderr, code = run_cmd(["shell", "pm", "list", "packages"], timeout=20)
    if code != 0:
        return {"success": False, "error": stderr or "failed_to_list_installed_packages"}

    packages = [line.replace("package:", "").strip() for line in out.splitlines() if line.startswith("package:")]
    return {"success": True, "packages": packages}


def check_candidates_installed(candidates: list[str]) -> dict:
    packages_result = get_installed_packages()
    if not packages_result.get("success"):
        return packages_result

    packages = packages_result.get("packages", [])
    matched = [package for package in packages if package in candidates]
    return {
        "success": True,
        "installed": len(matched) > 0,
        "matched_packages": matched,
        "packages": packages,
    }


def current_focus_line() -> dict:
    out, stderr, code = run_cmd(["shell", "dumpsys", "window"], timeout=20)
    if code != 0:
        return {"success": False, "error": stderr or "failed_to_get_current_focus"}

    for line in out.split("\n"):
        if "mCurrentFocus" in line or "mFocusedApp" in line:
            return {"success": True, "focus": line.strip()}

    return {"success": True, "focus": "unknown"}


def window_dump() -> dict:
    out, stderr, code = run_cmd(["shell", "dumpsys", "window"], timeout=20)
    if code != 0:
        return {"success": False, "error": stderr or "failed_to_get_window_dump"}
    return {"success": True, "dump": out}


def resolve_launcher_component(package: str) -> dict:
    out, stderr, code = run_cmd(
        ["shell", "cmd", "package", "resolve-activity", "--brief", package],
        timeout=20,
    )
    if code != 0:
        return {"success": False, "error": stderr or "resolve_activity_failed", "package": package}

    lines = [line.strip() for line in out.splitlines() if line.strip()]
    component = next((line for line in reversed(lines) if "/" in line), None)
    if not component:
        return {"success": False, "error": f"launcher_component_not_found: {out.strip()}", "package": package}

    return {"success": True, "package": package, "component": component}


def wait_for_focus(packages: list[str], timeout: int = 15, interval: float = 1.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        dump_result = window_dump()
        focus_result = current_focus_line()
        if dump_result.get("success"):
            dump = str(dump_result.get("dump", ""))
            for package in packages:
                if package in dump:
                    focus = str(focus_result.get("focus", ""))
                    matched_line = next((line.strip() for line in dump.splitlines() if package in line), focus)
                    return {"success": True, "focus": matched_line, "matched_package": package}
        time.sleep(interval)

    focus_result = current_focus_line()
    return {
        "success": False,
        "error": "foreground_package_not_detected",
        "focus": focus_result.get("focus") if isinstance(focus_result, dict) else None,
        "candidates": packages,
    }


def launch_package(package: str) -> dict:
    run_cmd(["shell", "cmd", "statusbar", "collapse"], timeout=5)
    press_key("back")
    press_key("home")
    time.sleep(1)

    resolved = resolve_launcher_component(package)
    if resolved.get("success"):
        out, stderr, code = run_cmd(["shell", "am", "start", "-n", resolved["component"]], timeout=20)
        success = code == 0 and "Error" not in out and "Exception" not in stderr
        return {
            "success": success,
            "package": package,
            "component": resolved.get("component"),
            "stdout": out.strip(),
            "stderr": stderr.strip(),
            "strategy": "am_start_component",
        }

    out, stderr, code = run_cmd(
        ["shell", "monkey", "-p", package, "-c", "android.intent.category.LAUNCHER", "1"],
        timeout=20,
    )
    success = code == 0 and "No activities found" not in out and "No activities found" not in stderr
    return {
        "success": success,
        "package": package,
        "stdout": out.strip(),
        "stderr": stderr.strip(),
        "strategy": "monkey",
        "resolve_error": resolved.get("error"),
    }


def run_hami_action(action: str, **params) -> dict:
    script_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "hami", "hami.py"))
    if not os.path.exists(script_path):
        return {"success": False, "error": f"hami_script_not_found: {script_path}"}

    args = [sys.executable or "python", script_path, action]
    for key, value in params.items():
        args.append(f"{key}={value}")

    result = subprocess.run(args, capture_output=True, timeout=20)
    stdout = result.stdout.decode("utf-8", errors="replace").strip()
    stderr = result.stderr.decode("utf-8", errors="replace").strip()

    if result.returncode != 0:
        return {"success": False, "error": stderr or stdout or f"hami_process_exit_{result.returncode}"}

    try:
        parsed = json.loads(stdout)
    except json.JSONDecodeError:
        return {"success": False, "error": f"hami_invalid_json: {stdout}"}

    return parsed


def turn_on_tv() -> dict:
    result = run_hami_action("xiaoai_execute", command="打开电视")
    return {
        "success": bool(result.get("success")),
        "action": "turn_on_tv",
        "provider": "hami.xiaoai_execute",
        "command": "打开电视",
        "result": result,
        "error": result.get("error"),
    }


def turn_on_stb() -> dict:
    result = run_hami_action("xiaoai_execute", command="打开机顶盒")
    return {
        "success": bool(result.get("success")),
        "action": "turn_on_stb",
        "provider": "hami.xiaoai_execute",
        "command": "打开机顶盒",
        "result": result,
        "error": result.get("error"),
    }


def check_bilibili_installed() -> dict:
    connection = ensure_device_connected()
    if not connection.get("success"):
        return {
            "success": False,
            "action": "check_bilibili_installed",
            "error": connection.get("error", "adb_not_connected"),
        }

    installed_result = check_candidates_installed(BILIBILI_PACKAGE_CANDIDATES)
    if not installed_result.get("success"):
        return {
            "success": False,
            "action": "check_bilibili_installed",
            "error": installed_result.get("error", "bilibili_check_failed"),
        }

    matched_packages = installed_result.get("matched_packages", [])
    return {
        "success": True,
        "action": "check_bilibili_installed",
        "installed": len(matched_packages) > 0,
        "matched_package": matched_packages[0] if matched_packages else None,
        "matched_packages": matched_packages,
        "package_candidates": BILIBILI_PACKAGE_CANDIDATES,
    }


def open_dangbei() -> dict:
    connection = ensure_device_connected()
    if not connection.get("success"):
        return {"success": False, "action": "open_dangbei", "error": connection.get("error", "adb_not_connected")}

    installed_result = check_candidates_installed(DANGBEI_PACKAGE_CANDIDATES)
    if not installed_result.get("success"):
        return {"success": False, "action": "open_dangbei", "error": installed_result.get("error", "dangbei_precheck_failed")}

    matched_packages = installed_result.get("matched_packages", [])
    if not matched_packages:
        return {
            "success": False,
            "action": "open_dangbei",
            "error": "dangbei_not_installed",
            "package_candidates": DANGBEI_PACKAGE_CANDIDATES,
        }

    attempts = []
    for package in matched_packages:
        launch_result = launch_package(package)
        focus_result = wait_for_focus([package], timeout=12)
        attempts.append({"package": package, "launch": launch_result, "focus": focus_result})
        if launch_result.get("success") and focus_result.get("success"):
            return {
                "success": True,
                "action": "open_dangbei",
                "package": package,
                "focus": focus_result.get("focus"),
                "attempts": attempts,
            }

    return {
        "success": False,
        "action": "open_dangbei",
        "error": "dangbei_launch_failed",
        "package_candidates": matched_packages,
        "attempts": attempts,
    }


def search_bilibili() -> dict:
    dangbei_result = open_dangbei()
    if not dangbei_result.get("success"):
        return {
            "success": False,
            "action": "search_bilibili",
            "error": dangbei_result.get("error", "dangbei_not_opened"),
            "open_dangbei": dangbei_result,
        }

    click_search = click_ui_alias(SEARCH_ENTRY_ALIASES)
    if not click_search.get("success"):
        click_search = tap_ratio(*FALLBACK_COORDINATES["dangbei_search"])
        click_search["fallback"] = True
        click_search["fallback_name"] = "dangbei_search"

    if not click_search.get("success"):
        return {
            "success": False,
            "action": "search_bilibili",
            "error": click_search.get("error", "search_entry_not_found"),
            "open_dangbei": dangbei_result,
            "search_click": click_search,
        }

    time.sleep(1.5)
    input_result = input_text("bilibili")
    if not input_result.get("success"):
        return {
            "success": False,
            "action": "search_bilibili",
            "error": input_result.get("message", "search_input_failed"),
            "search_click": click_search,
        }

    press_key("enter")
    time.sleep(2.5)
    ui_result, ui_texts = ui_snapshot()
    matched_text = any_text_matches(ui_texts, BILIBILI_RESULT_ALIASES)

    return {
        "success": bool(matched_text),
        "action": "search_bilibili",
        "query": "bilibili",
        "matched_text": matched_text,
        "search_click": click_search,
        "ui_tree_success": ui_result.get("success", False),
        "visible_texts": ui_texts[:30],
        "error": None if matched_text else "bilibili_search_result_not_found",
    }


def open_bilibili_result() -> dict:
    match_click = click_ui_alias(BILIBILI_RESULT_ALIASES)
    if match_click.get("success"):
        return {
            "success": True,
            "action": "open_bilibili_result",
            "strategy": "ui_text",
            "result": match_click,
        }

    fallback_click = tap_ratio(*FALLBACK_COORDINATES["bilibili_result"])
    if fallback_click.get("success"):
        fallback_click["fallback_name"] = "bilibili_result"
        return {
            "success": True,
            "action": "open_bilibili_result",
            "strategy": "fallback_ratio",
            "result": fallback_click,
        }

    return {
        "success": False,
        "action": "open_bilibili_result",
        "error": match_click.get("error", "bilibili_result_not_found"),
        "text_attempt": match_click,
        "fallback_attempt": fallback_click,
    }


def click_install_button() -> dict:
    open_match = find_ui_match(OPEN_BUTTON_ALIASES)
    if open_match.get("success"):
        return {
            "success": True,
            "status": "already_installed",
            "matched_text": open_match.get("matched_text"),
            "strategy": "ui_tree_alias",
        }

    install_click = click_ui_alias(INSTALL_BUTTON_ALIASES)
    if install_click.get("success"):
        return {
            "success": True,
            "status": "install_triggered",
            "strategy": "ui_text",
            "result": install_click,
        }

    fallback_click = tap_ratio(*FALLBACK_COORDINATES["install_button"])
    if fallback_click.get("success"):
        fallback_click["fallback_name"] = "install_button"
        return {
            "success": True,
            "status": "install_triggered",
            "strategy": "fallback_ratio",
            "result": fallback_click,
        }

    return {
        "success": False,
        "status": "failed",
        "error": install_click.get("error", "install_button_not_found"),
        "text_attempt": install_click,
        "fallback_attempt": fallback_click,
    }


def handle_install_confirm_dialog() -> dict | None:
    confirm_click = click_ui_alias(INSTALL_CONFIRM_ALIASES)
    if confirm_click.get("success"):
        return {
            "success": True,
            "status": "confirm_clicked",
            "result": confirm_click,
        }
    return None


def install_bilibili() -> dict:
    installed_before = check_bilibili_installed()
    if not installed_before.get("success"):
        return {
            "success": False,
            "action": "install_bilibili",
            "error": installed_before.get("error", "precheck_failed"),
            "precheck": installed_before,
        }

    if installed_before.get("installed"):
        return {
            "success": True,
            "action": "install_bilibili",
            "status": "already_installed",
            "matched_package": installed_before.get("matched_package"),
            "precheck": installed_before,
        }

    search_result = search_bilibili()
    if not search_result.get("success"):
        return {
            "success": False,
            "action": "install_bilibili",
            "status": "failed",
            "error": search_result.get("error", "search_bilibili_failed"),
            "search": search_result,
        }

    open_result = open_bilibili_result()
    if not open_result.get("success"):
        return {
            "success": False,
            "action": "install_bilibili",
            "status": "failed",
            "error": open_result.get("error", "bilibili_result_open_failed"),
            "search": search_result,
            "open_result": open_result,
        }

    time.sleep(2)
    install_start = click_install_button()
    if not install_start.get("success"):
        return {
            "success": False,
            "action": "install_bilibili",
            "status": "failed",
            "error": install_start.get("error", "install_button_click_failed"),
            "search": search_result,
            "open_result": open_result,
            "install_start": install_start,
        }

    if install_start.get("status") == "already_installed":
        installed_now = check_bilibili_installed()
        return {
            "success": True,
            "action": "install_bilibili",
            "status": "already_installed",
            "matched_package": installed_now.get("matched_package"),
            "install_start": install_start,
        }

    timeline = []
    deadline = time.time() + 180
    while time.time() < deadline:
        installed_check = check_bilibili_installed()
        if installed_check.get("success") and installed_check.get("installed"):
            timeline.append({"status": "installed", "matched_package": installed_check.get("matched_package")})
            return {
                "success": True,
                "action": "install_bilibili",
                "status": "installed",
                "matched_package": installed_check.get("matched_package"),
                "timeline": timeline,
                "install_start": install_start,
            }

        confirm_result = handle_install_confirm_dialog()
        if confirm_result:
            timeline.append(confirm_result)

        ui_result, ui_texts = ui_snapshot()
        progress_text = any_text_matches(ui_texts, INSTALL_PROGRESS_ALIASES)
        open_text = any_text_matches(ui_texts, OPEN_BUTTON_ALIASES)
        if progress_text:
            timeline.append({"status": "installing", "matched_text": progress_text})
        elif open_text:
            timeline.append({"status": "open_visible", "matched_text": open_text})

        time.sleep(3)

    final_check = check_bilibili_installed()
    if final_check.get("success") and final_check.get("installed"):
        timeline.append({"status": "installed", "matched_package": final_check.get("matched_package")})
        return {
            "success": True,
            "action": "install_bilibili",
            "status": "installed",
            "matched_package": final_check.get("matched_package"),
            "timeline": timeline,
            "install_start": install_start,
        }

    return {
        "success": False,
        "action": "install_bilibili",
        "status": "failed",
        "error": "install_timeout",
        "timeline": timeline,
        "install_start": install_start,
        "final_check": final_check,
    }


def open_bilibili() -> dict:
    installed_result = check_bilibili_installed()
    if not installed_result.get("success"):
        return {
            "success": False,
            "action": "open_bilibili",
            "error": installed_result.get("error", "install_check_failed"),
            "check": installed_result,
        }

    if not installed_result.get("installed"):
        return {
            "success": False,
            "action": "open_bilibili",
            "error": "bilibili_not_installed",
            "check": installed_result,
        }

    attempts = []
    for package in installed_result.get("matched_packages", []) or BILIBILI_PACKAGE_CANDIDATES:
        launch_result = launch_package(package)
        focus_result = wait_for_focus([package], timeout=15)
        attempts.append({"package": package, "launch": launch_result, "focus": focus_result})
        if launch_result.get("success") and focus_result.get("success"):
            return {
                "success": True,
                "action": "open_bilibili",
                "package": package,
                "focus": focus_result.get("focus"),
                "attempts": attempts,
            }

    return {
        "success": False,
        "action": "open_bilibili",
        "error": "bilibili_launch_failed",
        "attempts": attempts,
        "check": installed_result,
    }


def list_devices() -> dict:
    out, _, code = run_global_cmd(["devices", "-l"])
    if code != 0:
        return {"success": False, "error": "failed to list devices"}

    devices = []
    for line in out.strip().split("\n"):
        line = line.strip()
        if line and not line.startswith("List"):
            parts = line.split()
            if len(parts) >= 2:
                devices.append({
                    "id": parts[0],
                    "status": parts[1],
                    "info": " ".join(parts[2:]) if len(parts) > 2 else ""
                })

    return {"success": True, "devices": devices, "count": len(devices)}


def connect_device(ip: str, port: int = 5555) -> dict:
    out, _, code = run_global_cmd(["connect", f"{ip}:{port}"])
    return {"success": code == 0, "message": out.strip()}


def disconnect_device(ip: str, port: int = 5555) -> dict:
    out, _, code = run_global_cmd(["disconnect", f"{ip}:{port}"])
    return {"success": code == 0, "message": out.strip()}


KEY_MAP = {
    "enter": "66", "tab": "61", "delete": "67", "backspace": "67",
    "space": "62", "escape": "111", "esc": "111", "dpad_up": "19",
    "dpad_down": "20", "dpad_left": "21", "dpad_right": "22",
    "dpad_center": "23", "page_up": "92", "page_down": "93",
    "power": "26", "camera": "27", "menu": "82", "search": "84",
    "back": "4", "home": "3", "volume_up": "24", "volume_down": "25",
    "volume_mute": "164", "mute": "91", "media_play_pause": "85",
    "media_stop": "86", "media_next": "87", "media_previous": "88",
    "media_rewind": "89", "media_fast_forward": "90",
}


def tap(x: int, y: int) -> dict:
    _, stderr, code = run_cmd(["shell", "input", "tap", str(x), str(y)])
    return {"success": code == 0, "message": f"tapped ({x}, {y})" if code == 0 else stderr}


def swipe(x1: int, y1: int, x2: int, y2: int, duration: int = 300) -> dict:
    _, stderr, code = run_cmd(["shell", "input", "swipe", str(x1), str(y1), str(x2), str(y2), str(duration)])
    return {"success": code == 0, "message": f"swiped ({x1},{y1})->({x2},{y2})" if code == 0 else stderr}


def input_text(text: str) -> dict:
    escaped = text.replace(" ", "%s")
    _, stderr, code = run_cmd(["shell", "input", "text", escaped])
    return {"success": code == 0, "message": f"input: {text}" if code == 0 else stderr}


def key_event(keycode: int) -> dict:
    _, stderr, code = run_cmd(["shell", "input", "keyevent", str(keycode)])
    return {"success": code == 0, "message": f"key: {keycode}" if code == 0 else stderr}


def press_key(key: str) -> dict:
    key_lower = key.lower().strip()
    keycode = KEY_MAP.get(key_lower, key)
    if not str(keycode).isdigit():
        keycode = f"KEYCODE_{keycode.upper()}"
    _, stderr, code = run_cmd(["shell", "input", "keyevent", str(keycode)])
    return {"success": code == 0, "message": f"key: {key}" if code == 0 else stderr}


def open_app(package: str) -> dict:
    _, stderr, code = run_cmd(["shell", "am", "start", "-n", package])
    return {"success": code == 0, "message": f"opened: {package}" if code == 0 else stderr}


def get_current_app() -> dict:
    out, _, code = run_cmd(["shell", "dumpsys", "window"])
    if code != 0:
        return {"success": False, "error": "failed to get current app"}
    for line in out.split("\n"):
        if "mCurrentFocus" in line:
            return {"success": True, "current_app": line.strip()}
    return {"success": True, "current_app": "unknown"}


def list_apps(keyword: str = "") -> dict:
    if keyword:
        out, _, code = run_cmd(["shell", "pm", "list", "packages", keyword])
    else:
        out, _, code = run_cmd(["shell", "pm", "list", "packages"])
    if code != 0:
        return {"success": False, "error": "failed to list apps"}
    packages = [line.replace("package:", "") for line in out.strip().split("\n") if line.startswith("package:")]
    return {"success": True, "count": len(packages), "packages": packages}


def screenshot() -> dict:
    try:
        from PIL import Image
    except ImportError:
        return {"success": False, "error": "PIL not installed, run: pip install Pillow"}

    os.makedirs(CACHE_DIR, exist_ok=True)
    local_path = os.path.join(CACHE_DIR, "screen.png")
    tv_path = f"{TV_TEMP_DIR}/screen.png"

    try:
        _, err1, code1 = run_cmd(["shell", "screencap", "-p", tv_path])
        if code1 != 0:
            return {"success": False, "error": f"screencap failed: {err1}"}
        _, err2, code2 = run_cmd(["pull", tv_path, local_path])
        if code2 != 0:
            return {"success": False, "error": f"pull failed: {err2}"}
        if not os.path.exists(local_path):
            return {"success": False, "error": "screenshot file not found"}

        img = Image.open(local_path)
        width, height = img.size
        file_size = os.path.getsize(local_path)
        return {"success": True, "file": "screen.png", "path": local_path, "width": width, "height": height, "size_kb": round(file_size / 1024, 2)}
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_ui_tree() -> dict:
    import xml.etree.ElementTree as ET
    os.makedirs(CACHE_DIR, exist_ok=True)
    local_path = os.path.join(CACHE_DIR, "ui.json")
    tv_xml_path = f"{TV_TEMP_DIR}/ui.xml"
    try:
        _, err1, code1 = run_cmd(["shell", "uiautomator", "dump", tv_xml_path], timeout=15)
        if code1 != 0:
            return {"success": False, "error": f"uiautomator failed: {err1}"}
        out2, _, code2 = run_cmd(["shell", "cat", tv_xml_path])
        if code2 != 0:
            return {"success": False, "error": "read ui.xml failed"}

        root = ET.fromstring(out2)
        elements = []
        for node in root.iter("node"):
            text = node.get("text", "") or node.get("content-desc", "")
            bounds_str = node.get("bounds", "[0,0][0,0]")
            parts = bounds_str.replace("][", ",").strip("[]").split(",")
            if len(parts) == 4:
                box = [int(p) for p in parts]
                elements.append({
                    "text": text,
                    "box": box,
                    "center": [(box[0] + box[2]) // 2, (box[1] + box[3]) // 2],
                })

        with open(local_path, "w", encoding="utf-8") as f:
            json.dump({"elements": elements}, f, ensure_ascii=False, indent=2)
        return {"success": True, "file": "ui.json", "path": local_path, "elements": elements}
    except Exception as e:
        return {"success": False, "error": str(e)}


def find_text(text: str) -> dict:
    ui_result = get_ui_tree()
    if not ui_result.get("success"):
        return ui_result

    target = text.strip().lower()
    elements = ui_result.get("elements", [])
    exact = next((item for item in elements if str(item.get("text", "")).strip().lower() == target), None)
    if exact:
        return {"success": True, "match": exact, "strategy": "ui_tree_exact"}

    partial = next((item for item in elements if target and target in str(item.get("text", "")).strip().lower()), None)
    if partial:
        return {"success": True, "match": partial, "strategy": "ui_tree_partial"}

    return {"success": False, "error": f"text_not_found: {text}", "strategy": "ui_tree"}


def click_element(text: str = "", x: int | None = None, y: int | None = None) -> dict:
    if x is not None and y is not None:
        return tap(x, y)
    if not text:
        return {"success": False, "error": "missing text or coordinates"}

    match_result = find_text(text)
    if not match_result.get("success"):
        return match_result

    center = match_result["match"].get("center")
    if not center or len(center) != 2:
        return {"success": False, "error": "match_center_missing"}
    tap_result = tap(center[0], center[1])
    tap_result["matched_text"] = text
    tap_result["strategy"] = match_result.get("strategy")
    tap_result["center"] = center
    return tap_result


def ocr_local(text: str = "") -> dict:
    return {
        "success": False,
        "error": "ocr_local_not_configured",
        "provider": "local",
        "message": "Local OCR provider placeholder. Configure a local OCR service to enable this capability.",
        "query": text,
    }


def ocr_api(text: str = "") -> dict:
    return {
        "success": False,
        "error": "ocr_api_not_configured",
        "provider": "api",
        "message": "OCR API provider placeholder. Configure API credentials to enable this capability.",
        "query": text,
    }


def multimodal_understand(text: str = "") -> dict:
    return {
        "success": False,
        "error": "multimodal_not_configured",
        "provider": "multimodal",
        "message": "Multimodal placeholder. Configure a multimodal model endpoint to enable screenshot understanding.",
        "query": text,
    }


TOOLS = {
    "tap": {"func": lambda p: tap(p["x"], p["y"])},
    "swipe": {"func": lambda p: swipe(p["x1"], p["y1"], p["x2"], p["y2"], p.get("duration", 300))},
    "input_text": {"func": lambda p: input_text(p["text"])},
    "press_key": {"func": lambda p: press_key(p["key"])},
    "key_event": {"func": lambda p: key_event(p["keycode"])},
    "open_app": {"func": lambda p: open_app(p["package"])},
    "back": {"func": lambda p: press_key("back")},
    "home": {"func": lambda p: press_key("home")},
    "enter": {"func": lambda p: press_key("enter")},
    "screenshot": {"func": lambda p: screenshot()},
    "get_ui_tree": {"func": lambda p: get_ui_tree()},
    "get_current_app": {"func": lambda p: get_current_app()},
    "find_text": {"func": lambda p: find_text(p.get("text", ""))},
    "click_element": {"func": lambda p: click_element(p.get("text", ""), p.get("x"), p.get("y"))},
    "ocr_local": {"func": lambda p: ocr_local(p.get("text", ""))},
    "ocr_api": {"func": lambda p: ocr_api(p.get("text", ""))},
    "multimodal_understand": {"func": lambda p: multimodal_understand(p.get("text", ""))},
    "list_apps": {"func": lambda p: list_apps(p.get("keyword", ""))},
    "list_devices": {"func": lambda p: list_devices()},
    "connect": {"func": lambda p: connect_device(p.get("ip", ""), p.get("port", 5555))},
    "disconnect": {"func": lambda p: disconnect_device(p.get("ip", ""), p.get("port", 5555))},
    "turn_on_tv": {"func": lambda p: turn_on_tv()},
    "turn_on_stb": {"func": lambda p: turn_on_stb()},
    "check_bilibili_installed": {"func": lambda p: check_bilibili_installed()},
    "open_dangbei": {"func": lambda p: open_dangbei()},
    "search_bilibili": {"func": lambda p: search_bilibili()},
    "install_bilibili": {"func": lambda p: install_bilibili()},
    "open_bilibili": {"func": lambda p: open_bilibili()},
}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Missing action"}))
        sys.exit(1)

    action = sys.argv[1]
    params = {}
    for arg in sys.argv[2:]:
        if "=" in arg:
            key, value = arg.split("=", 1)
            if value.isdigit():
                value = int(value)
            params[key] = value

    if action not in TOOLS:
        print(json.dumps({"success": False, "error": f"Unknown action: {action}"}))
        sys.exit(1)

    result = TOOLS[action]["func"](params)
    print(json.dumps(result, ensure_ascii=False))
