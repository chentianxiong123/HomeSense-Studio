# AList Driver Integration Notes

## Decision

HomeSense stays the product boundary. AList/OpenList is treated as a source of driver ideas and selected adapter resources, not as an embedded product.

The integration shape is:

```txt
HomeSense NestJS -> spawn packages/alist-driver -> stdout JSON
```

`alist-driver` does not start an AList HTTP server and does not own devices, auth UI, task center, permissions, or HomeSense API routing.

## Current Feasibility Scope

Implemented:

- `packages/alist-driver` Go CLI.
- stdout JSON protocol with `code`, `data`, `error`, `message`, `retryable`, `duration_ms`.
- Actions: `health`, `list`, `get`, `remove`, `copy`.
- Drivers: `local`, minimal `webdav`.
- Cross-mount file copy through `Open -> Put`.
- Nest module under `apps/server/src/alist`.
- System storage module under `apps/server/src/storage`.
- Frontend storage workbench at `/storage`.
- AList/WebDAV credentials stored in the unified authorization center (`alist_authorizations`), with runtime injection by `authorization_id` / `auth_ref`.
- System mounts stored in `storage_mounts`; devices do not own AList mounts.

Not implemented:

- Real Baidu/Aliyun/Quark adapter tests.
- Full AList source fork.
- AList HTTP daemon.
- Upload UI.
- Aria2.
- File preview/transcode.
- Dynamic mount discovery.
- Async large-copy task progress.

## System Storage Mounts

The product-level model is:

```txt
alist_authorizations -> storage_mounts -> /api/storage/fs/* -> alist-driver
```

`alist_authorizations` stores WebDAV/local credentials. `storage_mounts` stores the HomeSense virtual path, driver, readonly flag, and authorization reference. The file workbench reads `storage_mounts` and never asks the user to write JSON.

Inline mount config is still supported for local smoke tests:

```json
{
  "path": "/本地/临时",
  "driver": "local",
  "root_path": "D:/files"
}
```

The authorization center currently supports:

- `webdav`: `endpoint`, optional `username`, server-side password, optional `props.root_path`.
- `local`: `props.root_path` for server-side file roots.

## API

```txt
GET  /api/storage/mounts
POST /api/storage/mounts
PUT  /api/storage/mounts/:id
DELETE /api/storage/mounts/:id
GET  /api/storage/health
POST /api/storage/fs/list
POST /api/storage/fs/get
POST /api/storage/fs/remove
POST /api/storage/fs/copy
```

The current product path is `/api/storage/*`. The older device-scoped AList API remains as a compatibility surface for previous local tests:

```txt
GET  /api/alist/devices/:deviceId/health
POST /api/alist/devices/:deviceId/fs/list
POST /api/alist/devices/:deviceId/fs/get
POST /api/alist/devices/:deviceId/fs/remove
POST /api/alist/devices/:deviceId/fs/copy
```

The storage service resolves `storage_mounts`, spawns `alist-driver`, writes runtime config through stdin JSON, and parses the last stdout JSON line.

## Copy Semantics

Same mount:

```txt
driver.Copy(srcRel, dstRel)
```

Different mount:

```txt
srcDriver.Get -> srcDriver.Open -> dstDriver.Put
```

The feasibility slice supports cross-mount file copy. Cross-mount directory copy returns a clear unsupported error; it should become an async task later.

## Verification

Use local verification only:

```powershell
cd packages/alist-driver
go test ./...

cd D:/files/HomeSense-Studio-v2
.\apps\server\node_modules\.bin\tsc.CMD --noEmit -p apps/server/tsconfig.json
.\apps\web\node_modules\.bin\vue-tsc.CMD --noEmit -p apps/web/tsconfig.json
cd apps/web
.\node_modules\.bin\vite.CMD build
```

`pnpm --filter @hs/server typecheck` may be blocked by pnpm approve-builds in this workspace before TypeScript starts; direct `tsc.CMD` is the current verification path.

## Next Steps

- Add a task store for large cross-mount copies.
- Add a real AList/OpenList adapter fork only when a specific driver is needed.
- Extract the file table into a shared HomeSense file browser once SSH/ADB/AList converge on the same DTO.
