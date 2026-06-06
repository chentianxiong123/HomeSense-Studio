# HomeSense Studio v2

Active workspace: `D:\files\HomeSense-Studio-v2`.

## Device Backend

The v2 server owns the local device database, rooms, Mi auth/discovery, Mi capability execution, LAN presence checks, and Android TV/box LAN control through the migrated CLI bridge.

Run the backend:

```powershell
pnpm --filter @hs/server start:dev
```

The server listens on `http://localhost:3000` and exposes API routes under `/api`.

## Web API Modes

Default web dev mode still uses the browser mock API:

```powershell
pnpm --filter @hs/web dev
```

Use the real backend through the Vite `/api` proxy:

```powershell
$env:VITE_ENABLE_MOCK_API='0'
pnpm --filter @hs/web dev
```

The proxy target defaults to `http://localhost:3000`. Override it with `VITE_DEV_API_TARGET` if the server runs elsewhere.

Alternatively, set `VITE_API_BASE` to call the backend directly:

```powershell
$env:VITE_API_BASE='http://localhost:3000'
pnpm --filter @hs/web dev
```

## Device Page Direction

`/devices` is the unified device and digital-twin surface. The frontend product language should expose only `Mi` and `LAN` as device sources; IR, MIoT, XiaoAi virtual children, and CLI-specific implementation details stay behind the backend boundary.

`/integrations` is the unified authentication and authorization surface. It is split first by account class: external accounts such as Mi and Bilibili, then local-network accounts such as ADB, streaming, SSH, FRP, and SMB.

Next product step: replace the plain device grid with a 2D room-first device view.
