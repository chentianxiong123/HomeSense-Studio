import os
import re
import shlex
import shutil
import subprocess


SCRCPY_PATH = os.getenv("SCRCPY_PATH", "scrcpy")


def scrcpy_executable() -> str:
    configured = str(SCRCPY_PATH or "scrcpy").strip()
    if os.path.isabs(configured) or os.sep in configured or (os.altsep and os.altsep in configured):
        return configured
    return shutil.which(configured) or configured


def scrcpy_version(timeout: int = 5) -> dict:
    executable = scrcpy_executable()
    try:
        result = subprocess.run([executable, "--version"], capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return {
            "available": False,
            "path": executable,
            "error": "TIMEOUT",
            "message": "scrcpy --version timed out",
        }
    except FileNotFoundError:
        return {
            "available": False,
            "path": executable,
            "error": "SCRCPY_NOT_FOUND",
            "message": f"scrcpy not found at: {executable}",
        }

    stdout = result.stdout.decode("utf-8", errors="replace") if result.stdout else ""
    stderr = result.stderr.decode("utf-8", errors="replace") if result.stderr else ""
    first_line = next((line.strip() for line in stdout.splitlines() if line.strip()), "")
    version_match = re.search(r"scrcpy\s+([^\s]+)", first_line, flags=re.IGNORECASE)
    return {
        "available": result.returncode == 0,
        "path": executable,
        "version": version_match.group(1) if version_match else "",
        "raw": stdout.strip() or stderr.strip(),
        "return_code": result.returncode,
    }


def scrcpy_command_spec(params: dict, device: str = "") -> dict:
    executable = scrcpy_executable()
    args: list[str] = [executable]
    if device:
        args.extend(["--serial", device])

    _append_value_arg(args, params, ("max_size", "max-size", "m"), "--max-size")
    _append_value_arg(args, params, ("bit_rate", "video_bit_rate", "video-bit-rate", "b"), "--video-bit-rate")
    _append_value_arg(args, params, ("max_fps", "max-fps"), "--max-fps")
    _append_value_arg(args, params, ("video_codec", "video-codec"), "--video-codec")
    _append_value_arg(args, params, ("display_id", "display-id"), "--display-id")
    _append_value_arg(args, params, ("video_encoder", "video-encoder"), "--video-encoder")
    _append_value_arg(args, params, ("audio_codec", "audio-codec"), "--audio-codec")
    _append_value_arg(args, params, ("video_buffer", "video-buffer"), "--video-buffer")
    _append_value_arg(args, params, ("audio_buffer", "audio-buffer"), "--audio-buffer")

    profile = str(params.get("profile") or params.get("mode") or "browser_bridge").strip().lower()
    window = _bool_param(params, "window", profile in ("desktop", "window", "interactive"))
    playback = _bool_param(params, "playback", window)
    audio = _bool_param(params, "audio", False if profile in ("browser_bridge", "headless", "probe") else True)
    control = _bool_param(params, "control", True)

    if not audio:
        args.append("--no-audio")
    if not control:
        args.append("--no-control")
    if not window:
        args.append("--no-window")

    record = params.get("record") or params.get("record_path")
    v4l2_sink = params.get("v4l2_sink") or params.get("v4l2-sink")
    if not playback and (record or v4l2_sink):
        args.append("--no-playback")
    if record:
        args.extend(["--record", str(record)])
    if v4l2_sink:
        args.extend(["--v4l2-sink", str(v4l2_sink)])

    tunnel_mode = str(params.get("tunnel_mode") or params.get("tunnel") or "auto").strip().lower()
    if tunnel_mode in ("forward", "adb_forward", "force_forward"):
        args.append("--force-adb-forward")

    tcpip_destination = params.get("tcpip") or params.get("tcpip_destination")
    if tcpip_destination:
        args.extend(["--tcpip", str(tcpip_destination)])

    extra_args = params.get("extra_args") or []
    if isinstance(extra_args, str):
        extra_args = shlex.split(extra_args)
    if isinstance(extra_args, list):
        args.extend(str(item) for item in extra_args if str(item).strip())

    direct_cli_video = bool(window or record or v4l2_sink)
    requires_backend_bridge = profile in ("browser_bridge", "web", "web_bridge", "headless")
    return {
        "executable": executable,
        "args": args[1:],
        "argv": args,
        "command_line": shlex.join(args),
        "device": device,
        "profile": profile,
        "headless": not window,
        "window": window,
        "playback": playback,
        "audio": audio,
        "control": control,
        "tunnel_mode": tunnel_mode,
        "direct_cli_video": direct_cli_video,
        "effective_video": direct_cli_video,
        "requires_backend_bridge": requires_backend_bridge,
        "bridge_strategy": "standalone_raw_stream_or_protocol_bridge" if requires_backend_bridge else "scrcpy_cli",
        "notes": [
            "scrcpy starts a device-side server over ADB and opens video/audio/control sockets.",
            "Plain scrcpy CLI disables video when there is no playback, recording, or V4L2 sink; browser streaming needs a backend bridge or standalone raw stream session.",
            "For browser delivery, use this spec from a backend session manager instead of running it as a short-lived CLI command.",
        ],
    }


def _bool_param(params: dict, name: str, default: bool) -> bool:
    value = params.get(name)
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() not in ("0", "false", "no", "off", "")
    return default


def _append_value_arg(args: list[str], params: dict, param_names: tuple[str, ...], option: str) -> None:
    for name in param_names:
        value = params.get(name)
        if value is not None and str(value).strip() != "":
            args.extend([option, str(value).strip()])
            return
