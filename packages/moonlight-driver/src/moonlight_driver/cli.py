import argparse
import json
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


def emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def pair(args: argparse.Namespace) -> int:
    pin = f"{random.randint(0, 9999):04d}"
    emit({"code": 0, "stage": "pin", "pin": pin})
    if args.wait_seconds > 0:
        time.sleep(min(args.wait_seconds, 3))
    now = datetime.now(timezone.utc).isoformat()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    client_cert = output_dir / "client.crt.pem"
    client_key = output_dir / "client.key.pem"
    server_cert = output_dir / "server.crt.pem"
    client_cert.write_text(_mock_pem("CERTIFICATE", f"homesense moonlight client {args.host}:{args.port} {now}"), encoding="utf-8")
    client_key.write_text(_mock_pem("PRIVATE KEY", f"homesense moonlight key {args.host}:{args.port} {now}"), encoding="utf-8")
    server_cert.write_text(_mock_pem("CERTIFICATE", f"sunshine server {args.host}:{args.port} {now}"), encoding="utf-8")
    emit(
        {
            "code": 0,
            "stage": "paired",
            "data": {
                "status": "paired",
                "driver": "moonlight-driver",
                "mock_pairing": True,
                "host": args.host,
                "port": args.port,
                "paired_at": now,
                "client_certificate_ref": str(client_cert),
                "client_private_key_ref": str(client_key),
                "server_certificate_ref": str(server_cert),
                "notes": [
                    "Lightweight placeholder pairing. Replace this action with moonlight-common real pairing.",
                    "No private key is emitted to the browser.",
                ],
            },
        }
    )
    return 0


def _mock_pem(kind: str, body: str) -> str:
    return f"-----BEGIN {kind}-----\n{body}\n-----END {kind}-----\n"


def status(args: argparse.Namespace) -> int:
    emit({"code": 0, "data": {"host": args.host, "port": args.port, "driver": "moonlight-driver", "available": True}})
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="moonlight-driver")
    subparsers = parser.add_subparsers(dest="action", required=True)

    pair_parser = subparsers.add_parser("pair")
    pair_parser.add_argument("--host", required=True)
    pair_parser.add_argument("--port", type=int, default=47990)
    pair_parser.add_argument("--output-dir", required=True)
    pair_parser.add_argument("--wait-seconds", type=float, default=0.2)
    pair_parser.set_defaults(func=pair)

    status_parser = subparsers.add_parser("status")
    status_parser.add_argument("--host", required=True)
    status_parser.add_argument("--port", type=int, default=47990)
    status_parser.set_defaults(func=status)
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    try:
        raise SystemExit(args.func(args))
    except Exception as exc:
        emit({"code": 1, "message": str(exc)})
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
