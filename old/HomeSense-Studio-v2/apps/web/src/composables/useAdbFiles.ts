import { computed, ref, type Ref } from 'vue'
import { cliApi } from '@/api/cli'
import type { RemoteWorkspaceFileEntry, RemoteWorkspaceFileList, RemoteWorkspaceFilePreview } from '@/api/remoteWorkspace'

type LabelFn = (zh: string, en: string) => string

type AdbFileEntry = {
  name: string
  path: string
  directory: boolean
  symlink?: boolean
  link_target?: string
  mode?: string
  owner?: string
  group?: string
  size?: number
  mtime?: string
}

export function useAdbFiles(options: {
  adbIp: () => string
  deviceName: () => string
  label: LabelFn
  statusMessage: Ref<string>
  errorMessage: Ref<string>
}) {
  const fileLoading = ref(false)
  const filePath = ref('/sdcard/')
  const fileInputPath = ref('/sdcard/')
  const fileParent = ref('/')
  const files = ref<AdbFileEntry[]>([])
  const filePreview = ref<RemoteWorkspaceFilePreview | null>(null)

  const adbFileList = computed<RemoteWorkspaceFileList | null>(() => ({
    target_id: `adb:${options.adbIp()}`,
    label: options.deviceName(),
    kind: 'adb',
    root: '/sdcard/',
    path: filePath.value,
    absolute_path: filePath.value,
    entries: files.value.map((file) => ({
      name: file.name,
      path: file.path,
      type: file.directory ? 'directory' : file.symlink ? 'symlink' : 'file',
      size: file.size ?? null,
      modified_at: file.mtime ?? null,
    })),
    truncated: false,
  }))

  function params(extra: Record<string, unknown> = {}) {
    return { device: options.adbIp(), ...extra }
  }

  function normalizePath(path: string) {
    const value = (path || '/sdcard/').trim().replace(/\/+/g, '/')
    if (value === '/sdcard/sdcard') return '/sdcard/'
    return value.startsWith('/') ? value : `/${value}`
  }

  async function loadFiles(path = fileInputPath.value) {
    if (fileLoading.value) return
    const targetPath = normalizePath(path)
    fileLoading.value = true
    options.statusMessage.value = ''
    options.errorMessage.value = ''
    try {
      const result = await cliApi.run<{ path: string; parent: string; files: AdbFileEntry[]; count: number }>('adb-cli', {
        action: 'list_files',
        params: params({ path: targetPath }),
        ttl_ms: 0,
        bypass_cache: true,
      })
      if (result.status !== 'success' || !result.data) {
        options.errorMessage.value = result.message || result.error || options.label('目录读取失败', 'Failed to read directory')
        return
      }
      filePath.value = result.data.path
      fileInputPath.value = result.data.path
      fileParent.value = result.data.parent || '/'
      files.value = result.data.files
      filePreview.value = null
      options.statusMessage.value = options.label('目录已读取', 'Directory loaded')
    } catch (e) {
      options.errorMessage.value = (e as Error).message || String(e)
    } finally {
      fileLoading.value = false
    }
  }

  async function readFile(entry: RemoteWorkspaceFileEntry) {
    if (fileLoading.value) return
    fileLoading.value = true
    options.statusMessage.value = ''
    options.errorMessage.value = ''
    try {
      const result = await cliApi.run<RemoteWorkspaceFilePreview>('adb-cli', {
        action: 'read_file',
        params: params({ path: entry.path, max_bytes: 65536 }),
        ttl_ms: 0,
        bypass_cache: true,
      })
      if (result.status !== 'success' || !result.data) {
        options.errorMessage.value = result.message || result.error || options.label('文件预览失败', 'Failed to preview file')
        return
      }
      filePreview.value = result.data
      options.statusMessage.value = options.label('文件已读取', 'File loaded')
    } catch (e) {
      options.errorMessage.value = (e as Error).message || String(e)
    } finally {
      fileLoading.value = false
    }
  }

  function openFile(entry: RemoteWorkspaceFileEntry) {
    if (entry.type === 'directory') {
      void loadFiles(entry.path)
      return
    }
    if (entry.type === 'file' || entry.type === 'symlink') void readFile(entry)
  }

  return {
    fileLoading,
    filePath,
    fileInputPath,
    fileParent,
    files,
    filePreview,
    adbFileList,
    loadFiles,
    openFile,
  }
}
