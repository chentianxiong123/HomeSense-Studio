import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
HAMI_SCRIPT = ROOT / "agent" / "src" / "tools" / "hami" / "hami.py"


def cli_main(payload: str):
    if payload == "-":
        payload = sys.stdin.read().strip()

    parsed = json.loads(payload)
    action = parsed.get("action")
    if not action:
        print(json.dumps({"success": False, "error": "Missing action"}, ensure_ascii=False))
        return

    args = [sys.executable, str(HAMI_SCRIPT), action]
    for key, value in parsed.items():
        if key == "action":
            continue
        args.append(f"{key}={value}")

    result = subprocess.run(
        args,
        capture_output=True,
        text=True,
        cwd=str(HAMI_SCRIPT.parent),
    )

    if result.stdout:
        print(result.stdout.strip())
        return

    error = result.stderr.strip() if result.stderr else f"Process exited with code {result.returncode}"
    print(json.dumps({"success": False, "error": error}, ensure_ascii=False))
