import type { StorageProtocolSpec } from './storage.types'

export const STORAGE_PROTOCOLS: StorageProtocolSpec[] = [
  {
    id: 'webdav',
    name: 'WebDAV',
    status: 'implemented',
    summary: 'HTTP file protocol for AList, OpenList, NAS and cloud drive gateways.',
    default_root_path: '/',
    readonly_default: false,
    supports: { list: true, get: true, remove: true, copy: true, mkdir: true, upload: true, cross_mount_copy: true },
    fields: [
      { key: 'endpoint', label: 'Endpoint', required: true, placeholder: 'https://example.test/dav' },
      { key: 'username', label: 'Username', required: false },
      { key: 'password', label: 'Password', required: false, secret: true },
      { key: 'root_path', label: 'Remote Root Path', required: false, placeholder: '/' },
    ],
  },
  {
    id: 'local',
    name: 'Local Folder',
    status: 'implemented',
    summary: 'Server-side filesystem roots exposed as HomeSense storage mounts.',
    default_root_path: '/',
    readonly_default: false,
    supports: { list: true, get: true, remove: true, copy: true, mkdir: true, upload: true, cross_mount_copy: true },
    fields: [
      { key: 'root_path', label: 'Local Root Path', required: true, placeholder: 'D:/files' },
    ],
  },
  {
    id: 'sftp',
    name: 'SFTP',
    status: 'implemented',
    summary: 'SSH file transfer for Linux, NAS and server filesystems.',
    default_root_path: '/',
    readonly_default: false,
    supports: { list: true, get: true, remove: true, copy: true, mkdir: true, upload: true, cross_mount_copy: true },
    fields: [
      { key: 'endpoint', label: 'Endpoint', required: true, placeholder: 'sftp://192.168.1.10:22' },
      { key: 'username', label: 'Username', required: true },
      { key: 'password', label: 'Password', required: false, secret: true },
      { key: 'key_name', label: 'SSH Key Name', required: false, placeholder: 'nas_root' },
      { key: 'root_path', label: 'SFTP Root Path', required: false, placeholder: '/' },
    ],
  },
  {
    id: 'adb',
    name: 'ADB',
    status: 'implemented',
    summary: 'Android device filesystem browsing through adb-cli.',
    default_root_path: '/sdcard/',
    readonly_default: true,
    supports: { list: true, get: true, remove: true, copy: true, mkdir: true, upload: true, cross_mount_copy: true },
    fields: [
      { key: 'endpoint', label: 'Device', required: true, placeholder: '192.168.1.91:5555' },
      { key: 'root_path', label: 'ADB Root Path', required: false, placeholder: '/sdcard/' },
    ],
  },
  {
    id: 'smb',
    name: 'SMB',
    status: 'implemented',
    summary: 'Windows and NAS shares through an OS-mounted server path.',
    default_root_path: '/',
    readonly_default: false,
    supports: { list: true, get: true, remove: true, copy: true, mkdir: true, upload: true, cross_mount_copy: true },
    fields: [
      { key: 'endpoint', label: 'Share', required: true, placeholder: '//nas/share' },
      { key: 'username', label: 'Username', required: false },
      { key: 'password', label: 'Password', required: false, secret: true },
      { key: 'root_path', label: 'Mounted Root Path', required: true, placeholder: '/mnt/nas/share' },
    ],
  },
  {
    id: 'nfs',
    name: 'NFS',
    status: 'implemented',
    summary: 'Unix NAS exports through an OS-mounted server path.',
    default_root_path: '/',
    readonly_default: false,
    supports: { list: true, get: true, remove: true, copy: true, mkdir: true, upload: true, cross_mount_copy: true },
    fields: [
      { key: 'endpoint', label: 'Export', required: true, placeholder: 'nas:/volume1/media' },
      { key: 'root_path', label: 'Mounted Root Path', required: true, placeholder: '/mnt/nfs/media' },
    ],
  },
]

export function implementedStorageDrivers(): Set<string> {
  return new Set(STORAGE_PROTOCOLS.filter((protocol) => protocol.status === 'implemented').map((protocol) => protocol.id))
}
