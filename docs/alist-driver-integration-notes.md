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
- SFTP system mounts through the same `/api/storage/fs/*` API. SFTP is handled by the NestJS storage layer with `ssh2`, not by the terminal shell channel.
- ADB system mounts through the same `/api/storage/fs/*` API for browse/detail/remove/copy. ADB is handled by `adb-cli` and normalized into storage entries.
- SMB/NFS entries are supported as OS-mounted server paths. HomeSense stores the original share/export endpoint as metadata and uses `props.root_path` as the mounted local path.
- Browser upload/download streams for local/WebDAV/SFTP/ADB/SMB/NFS through `/api/storage/fs/upload` and `/api/storage/fs/download`. ADB uses `adb-cli pull_file/push_file` plus server-side temp files to preserve the unified HTTP surface.
- Cross-protocol file copy through the shared transfer layer. Same-mount native copy is still preferred when the protocol provides it; cross-mount copy streams source download into destination upload.
- The storage workbench reuses `RemoteFileBrowserPanel` so ADB, remote-workspace, and system storage share the same browser surface.

Not implemented:

- Real Baidu/Aliyun/Quark adapter tests.
- Full AList source fork.
- AList HTTP daemon.
- Aria2.
- File preview/transcode.
- Dynamic mount discovery.
- Byte-level async copy progress. Current copy tasks are persisted in SQLite and report file-level progress, but not byte-level progress.
- Cross-mount directory copy across protocols.
- Native SMB/NFS client drivers. Current support expects the server OS to mount those shares first.

## System Storage Mounts

The product-level model is:

```txt
storage protocol specs -> alist_authorizations -> storage_mounts -> /api/storage/fs/*
```

`alist_authorizations` stores WebDAV/local credentials. `storage_mounts` stores the HomeSense virtual path, driver, readonly flag, and authorization reference. The file workbench reads `storage_mounts` and never asks the user to write JSON.

The authorization center is the protocol credential registry. It knows which
storage protocols are implemented, which fields each protocol needs, and which
planned protocols should be visible but not selectable yet. Device detail pages
should not own these credentials.

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
- `sftp`: `endpoint` as `sftp://host:22` or `host:22`, `username`, server-side password, optional `props.root_path`; `props.key_name` can point to a key in `runtime-keys/ssh`.
- `adb`: `endpoint` as `ip:5555`, optional `props.root_path` defaulting to `/sdcard/`.
- `smb`: `endpoint` as `//host/share`, required `props.root_path` pointing to the server-mounted path.
- `nfs`: `endpoint` as `host:/export`, required `props.root_path` pointing to the server-mounted path.

## API

```txt
GET  /api/storage/mounts
POST /api/storage/mounts
PUT  /api/storage/mounts/:id
DELETE /api/storage/mounts/:id
GET  /api/storage/protocols
GET  /api/storage/health
POST /api/storage/fs/list
POST /api/storage/fs/get
POST /api/storage/fs/remove
POST /api/storage/fs/copy
POST /api/storage/fs/copy-task
GET  /api/storage/fs/download?path=...
PUT  /api/storage/fs/upload?path=...
GET  /api/storage/tasks
GET  /api/storage/tasks/:id
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
SFTP and ADB are normalized in the NestJS storage layer because they already exist as HomeSense protocol capabilities; they do not require AList to own the runtime.

## Copy Semantics

Same mount:

```txt
driver.Copy(srcRel, dstRel)
```

Different mount:

```txt
StorageTransfer.download(srcPath) -> stream -> StorageTransfer.upload(dstPath)
```

The current slice supports cross-mount file copy across local/WebDAV/SFTP/ADB/SMB/NFS. Copy tasks are stored in SQLite and update file-level progress; tasks that were queued or running during a server restart are marked as interrupted on the next boot. Cross-mount directory copy returns a clear unsupported error.

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

- Add byte-level task progress once transfer streams expose counters.
- Add resumable or restartable copy tasks if large file operations become common.
- Add a real AList/OpenList adapter fork only when a specific driver is needed.
- Keep `RemoteFileBrowserPanel` as the shared HomeSense browser surface and add protocol-specific actions around it only when the workflow requires them.
