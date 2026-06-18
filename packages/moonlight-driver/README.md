# HomeSense Moonlight Driver

This package owns the Sunshine/Moonlight pairing CLI boundary for HomeSense.

Current state:
- `python -m moonlight_driver pair ...` is a lightweight fallback driver.
- It emits the same stdout JSON shape that the future real driver must emit.
- It writes placeholder PEM files so the server, database, and UI can exercise the full pairing storage path.
- It is intentionally marked with `mock_pairing: true`.

Production path:
- Build a real Moonlight driver binary from `moonlight-common`.
- Point HomeSense to it with `MOONLIGHT_DRIVER_BIN`.
- Keep the CLI contract unchanged.

Required CLI contract:

```bash
moonlight-driver pair --host 192.168.31.204 --port 47990 --output-dir data/streaming/moonlight/streaming-2
```

stdout:

```json
{"code":0,"stage":"pin","pin":"1234"}
{"code":0,"stage":"paired","data":{"status":"paired","mock_pairing":false,"client_certificate_ref":"...","client_private_key_ref":"...","server_certificate_ref":"..."}}
```

The browser must never receive private key contents. It only receives refs.
