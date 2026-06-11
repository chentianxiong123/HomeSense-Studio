import os
import shlex
from typing import Any, Callable

from .utils import _is_binary, _join_remote_path, _parse_ls_line, _safe_int

AdbDeps = dict[str, Callable[..., Any]]


def _ensure(deps: AdbDeps, params: dict) -> dict:
    return deps["ensure_connected"](params)


def handle_list_files(params: dict, deps: AdbDeps) -> dict:
    ensure = _ensure(deps, params)
    if ensure.get("status") != "success":
        return ensure

    remote_path = str(params.get("path") or "/sdcard/").strip() or "/sdcard/"
    if not remote_path.startswith("/"):
        return {"status": "error", "error": "INVALID_PARAMS", "message": "path must be absolute"}
    remote_path = remote_path.rstrip("/") or "/"

    quoted = shlex.quote(remote_path)
    out, stderr, code = deps["run_device_cmd"](
        params, ["shell", f"ls -la --time-style=long-iso {quoted}"], timeout=20,
    )
    if code != 0:
        out, stderr, code = deps["run_device_cmd"](params, ["shell", f"ls -la {quoted}"], timeout=20)
    if code != 0:
        return {"status": "error", "error": "EXEC_FAILED", "message": stderr or out or "failed to list files"}

    files = []
    for line in out.splitlines():
        item = _parse_ls_line(line, remote_path)
        if item:
            files.append(item)
    files.sort(key=lambda item: (not item["directory"], item["name"].lower()))

    return {
        "status": "success",
        "data": {
            "path": remote_path + ("" if remote_path == "/" else "/"),
            "parent": "" if remote_path == "/" else "/".join(remote_path.rstrip("/").split("/")[:-1]) or "/",
            "files": files,
            "count": len(files),
        },
    }


def handle_read_file(params: dict, deps: AdbDeps) -> dict:
    ensure = _ensure(deps, params)
    if ensure.get("status") != "success":
        return ensure

    remote_path = str(params.get("path") or "").strip()
    if not remote_path or not remote_path.startswith("/"):
        return {"status": "error", "error": "INVALID_PARAMS", "message": "path must be absolute"}

    max_bytes = int(params.get("max_bytes") or 65536)
    max_bytes = max(1024, min(max_bytes, 262144))
    quoted = shlex.quote(remote_path)
    raw, stderr, code = deps["run_device_cmd_bytes"](
        params,
        ["exec-out", "sh", "-c", f"head -c {max_bytes + 1} {quoted}"],
        timeout=20,
    )
    if code != 0:
        return {"status": "error", "error": "EXEC_FAILED", "message": stderr or "failed to read file"}

    size_text = deps["shell_value"](params, f"wc -c < {quoted}", timeout=10)
    size = _safe_int(size_text.split()[0] if size_text else "")
    truncated = len(raw) > max_bytes or (size > max_bytes if size else False)
    data = raw[:max_bytes]
    binary = _is_binary(data)
    name = remote_path.rstrip("/").split("/")[-1] or "/"

    return {
        "status": "success",
        "data": {
            "target_id": f"adb:{deps['extract_device'](params)}",
            "label": deps["extract_device"](params),
            "kind": "adb",
            "root": "/sdcard/",
            "path": remote_path,
            "absolute_path": remote_path,
            "name": name,
            "size": size or len(raw),
            "modified_at": None,
            "encoding": "binary" if binary else "utf8",
            "content": "" if binary else data.decode("utf-8", errors="replace"),
            "truncated": truncated,
        },
    }


def handle_remove_files(params: dict, deps: AdbDeps) -> dict:
    ensure = _ensure(deps, params)
    if ensure.get("status") != "success":
        return ensure

    remote_dir = str(params.get("dir") or params.get("path") or "").strip()
    names = params.get("names") or []
    if not remote_dir or not remote_dir.startswith("/"):
        return {"status": "error", "error": "INVALID_PARAMS", "message": "dir must be absolute"}
    if not isinstance(names, list) or not names:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "names must be a non-empty array"}
    for name in names:
        if not isinstance(name, str) or not name.strip() or "/" in name or "\\" in name:
            return {"status": "error", "error": "INVALID_PARAMS", "message": f"invalid name: {name}"}

    targets = " ".join(shlex.quote(_join_remote_path(remote_dir.rstrip("/") or "/", name.strip())) for name in names)
    _, stderr, code = deps["run_device_cmd"](params, ["shell", f"rm -rf -- {targets}"], timeout=30)
    if code != 0:
        return {"status": "error", "error": "EXEC_FAILED", "message": stderr or "failed to remove files"}
    return {"status": "success", "data": {"removed": len(names)}}


def handle_copy_files(params: dict, deps: AdbDeps) -> dict:
    ensure = _ensure(deps, params)
    if ensure.get("status") != "success":
        return ensure

    src_dir = str(params.get("src_dir") or params.get("src-dir") or "").strip()
    dst_dir = str(params.get("dst_dir") or params.get("dst-dir") or "").strip()
    names = params.get("names") or []
    if not src_dir.startswith("/") or not dst_dir.startswith("/"):
        return {"status": "error", "error": "INVALID_PARAMS", "message": "src_dir and dst_dir must be absolute"}
    if not isinstance(names, list) or not names:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "names must be a non-empty array"}
    for name in names:
        if not isinstance(name, str) or not name.strip() or "/" in name or "\\" in name:
            return {"status": "error", "error": "INVALID_PARAMS", "message": f"invalid name: {name}"}

    mkdir_cmd = f"mkdir -p -- {shlex.quote(dst_dir)}"
    _, stderr, code = deps["run_device_cmd"](params, ["shell", mkdir_cmd], timeout=15)
    if code != 0:
        return {"status": "error", "error": "EXEC_FAILED", "message": stderr or "failed to create destination"}

    for name in names:
        src = shlex.quote(_join_remote_path(src_dir.rstrip("/") or "/", name.strip()))
        dst = shlex.quote(dst_dir.rstrip("/") or "/")
        _, stderr, code = deps["run_device_cmd"](params, ["shell", f"cp -R -- {src} {dst}/"], timeout=60)
        if code != 0:
            return {"status": "error", "error": "EXEC_FAILED", "message": stderr or f"failed to copy {name}"}
    return {"status": "success", "data": {"copied": len(names)}}


def handle_pull_file(params: dict, deps: AdbDeps) -> dict:
    ensure = _ensure(deps, params)
    if ensure.get("status") != "success":
        return ensure

    remote_path = str(params.get("path") or params.get("remote_path") or "").strip()
    local_path = str(params.get("local_path") or params.get("dst") or "").strip()
    if not remote_path or not remote_path.startswith("/"):
        return {"status": "error", "error": "INVALID_PARAMS", "message": "path must be absolute"}
    if not local_path:
        return {"status": "error", "error": "INVALID_PARAMS", "message": "local_path is required"}

    local_dir = os.path.dirname(os.path.abspath(local_path))
    if local_dir:
        os.makedirs(local_dir, exist_ok=True)
    _, stderr, code = deps["run_device_cmd"](params, ["pull", remote_path, local_path], timeout=120)
    if code != 0:
        return {"status": "error", "error": "EXEC_FAILED", "message": stderr or "failed to pull file"}
    return {"status": "success", "data": {"path": remote_path, "local_path": local_path}}


def handle_push_file(params: dict, deps: AdbDeps) -> dict:
    ensure = _ensure(deps, params)
    if ensure.get("status") != "success":
        return ensure

    remote_path = str(params.get("path") or params.get("remote_path") or "").strip()
    local_path = str(params.get("local_path") or params.get("src") or "").strip()
    if not remote_path or not remote_path.startswith("/"):
        return {"status": "error", "error": "INVALID_PARAMS", "message": "path must be absolute"}
    if not local_path or not os.path.isfile(local_path):
        return {"status": "error", "error": "INVALID_PARAMS", "message": "local_path must be an existing file"}

    parent = "/".join(remote_path.rstrip("/").split("/")[:-1]) or "/"
    _, stderr, code = deps["run_device_cmd"](params, ["shell", f"mkdir -p -- {shlex.quote(parent)}"], timeout=15)
    if code != 0:
        return {"status": "error", "error": "EXEC_FAILED", "message": stderr or "failed to create destination"}
    _, stderr, code = deps["run_device_cmd"](params, ["push", local_path, remote_path], timeout=120)
    if code != 0:
        return {"status": "error", "error": "EXEC_FAILED", "message": stderr or "failed to push file"}
    return {"status": "success", "data": {"path": remote_path, "local_path": local_path}}


def handle_mkdir_path(params: dict, deps: AdbDeps) -> dict:
    ensure = _ensure(deps, params)
    if ensure.get("status") != "success":
        return ensure

    remote_path = str(params.get("path") or params.get("dir") or "").strip()
    if not remote_path or not remote_path.startswith("/"):
        return {"status": "error", "error": "INVALID_PARAMS", "message": "path must be absolute"}

    _, stderr, code = deps["run_device_cmd"](params, ["shell", f"mkdir -p -- {shlex.quote(remote_path)}"], timeout=20)
    if code != 0:
        return {"status": "error", "error": "EXEC_FAILED", "message": stderr or "failed to create directory"}
    return {"status": "success", "data": {"path": remote_path}}
