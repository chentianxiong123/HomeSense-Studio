# HomeSense alist-driver

`alist-driver` is a headless child-process file capability provider for HomeSense.

It does not embed the AList product, HTTP server, web UI, user system, task system, or database. The package keeps the HomeSense architecture as the owner and uses selected AList driver concepts: mount routing, driver-shaped adapters, and normalized file objects.

Process contract:

```txt
HomeSense NestJS -> spawn alist-driver <action> -> stdout JSON
```

Secrets should be passed through stdin JSON or a protected config file, not command-line arguments.

Current feasibility slice:

- `health`
- `list`
- `get`
- `remove`
- `copy`
- `local` driver
- minimal `webdav` driver
- cross-mount file copy through `Open -> Put`

This package is designed as the place where selected AList/OpenList driver resources can be forked into HomeSense over time. The feasibility slice keeps the code headless and HomeSense-owned. If official AList source files are copied into this package later, keep the AGPL-3.0 license obligations documented in the repository README and license files.

Example:

```powershell
$config = '{"mounts":[{"path":"/repo","driver":"local","root_path":"D:/files/HomeSense-Studio-v2"}]}'
go run ./cmd/alist-driver health --config $config
go run ./cmd/alist-driver list --path /repo --config $config
```

Build:

```powershell
go build -o ./bin/alist-driver.exe ./cmd/alist-driver
```

HomeSense can use a prebuilt binary via `ALIST_DRIVER_BIN`. If it is not set, the Nest service falls back to `go run ./cmd/alist-driver` for development.
