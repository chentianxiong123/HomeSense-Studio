<script setup lang="ts">
import type { AlistAuthorizationRecord, AlistDriverHealthResult } from '@/api/alist'
import type { StorageMountRecord } from '@/api/storage'

type LabelFn = (zh: string, en: string) => string
type StorageSourceKind = 'local' | 'device' | 'cloud'

interface StorageSourceGroup {
  kind: StorageSourceKind
  title: string
  subtitle: string
  mounts: StorageMountRecord[]
  pendingDevices?: StorageDeviceSource[]
}

interface StorageDeviceSource {
  id: number
  name: string
  subtitle: string
}

const props = defineProps<{
  authorizations: AlistAuthorizationRecord[]
  sourceGroups: StorageSourceGroup[]
  health: AlistDriverHealthResult | null
  activeMountPath?: string
  pathInput: string
  disabled: boolean
  label: LabelFn
  authorizationName: (id: number) => string
  isBusy: (key: string) => boolean
}>()

const emit = defineEmits<{
  (event: 'create'): void
  (event: 'open', path: string): void
  (event: 'open-device', deviceId: number): void
  (event: 'edit', mount: StorageMountRecord): void
  (event: 'delete', mount: StorageMountRecord): void
}>()

function driverLabel(driver: string): string {
  const normalized = driver.trim().toLowerCase()
  if (normalized === 'local') return props.label('本机目录', 'Local folder')
  if (normalized === 'adb') return props.label('设备文件系统', 'Device filesystem')
  if (normalized === 'sftp') return props.label('SSH/SFTP 文件系统', 'SSH/SFTP filesystem')
  if (normalized === 'webdav') return 'WebDAV'
  if (normalized === 'smb') return 'SMB'
  if (normalized === 'nfs') return 'NFS'
  return driver || props.label('文件来源', 'File source')
}

function sourceMeta(mount: StorageMountRecord): string {
  return [
    driverLabel(mount.driver),
    props.authorizationName(mount.authorization_id),
    mount.readonly ? props.label('只读', 'Readonly') : '',
  ].filter(Boolean).join(' · ')
}
</script>

<template>
  <section class="mount-band">
    <div class="mount-head">
      <div>
        <strong>{{ label('文件来源', 'File Sources') }}</strong>
        <small>{{ health ? label('来源服务可用', 'Source service ready') : label('正在检查来源服务', 'Checking source service') }}</small>
      </div>
      <button class="plain-btn compact" :disabled="authorizations.length === 0" @click="emit('create')">{{ label('新增来源', 'Add Source') }}</button>
    </div>

    <div v-if="authorizations.length === 0" class="empty-line left">
      {{ label('还没有可用授权。先在授权中心保存 WebDAV 或本地目录凭据。', 'No authorization is available. Save a WebDAV or local folder credential first.') }}
    </div>

    <div v-else-if="sourceGroups.every((group) => group.mounts.length === 0 && (group.pendingDevices?.length ?? 0) === 0)" class="empty-line left">
      {{ label('已有授权，但还没有文件来源。新增来源后，这里会成为 HomeSense 的统一文件入口。', 'Authorizations exist, but no file source is configured yet. Add a source to make it available in HomeSense storage.') }}
    </div>

    <div v-else class="source-sections">
      <section v-for="group in sourceGroups" :key="group.kind" class="source-section">
        <div class="source-title">
          <strong>{{ group.title }}</strong>
          <small>{{ group.subtitle }}</small>
        </div>
        <div v-if="group.mounts.length === 0 && (group.pendingDevices?.length ?? 0) === 0" class="empty-line compact-empty">
          {{ label('暂无来源', 'No sources') }}
        </div>
        <div v-else class="mount-grid">
          <article
            v-for="mount in group.mounts"
            :key="mount.id"
            class="mount-item"
            :class="{ active: activeMountPath === mount.virtual_path || pathInput === mount.virtual_path }"
          >
            <button class="mount-main" :disabled="disabled" @click="emit('open', mount.virtual_path)">
              <strong>{{ mount.name }}</strong>
              <small>{{ sourceMeta(mount) }}</small>
            </button>
            <div class="mount-actions">
              <button class="plain-btn compact" @click="emit('edit', mount)">{{ label('编辑', 'Edit') }}</button>
              <button class="danger-btn compact" :disabled="isBusy(`mount-delete-${mount.id}`)" @click="emit('delete', mount)">{{ label('删除', 'Delete') }}</button>
            </div>
          </article>
          <article
            v-for="device in group.pendingDevices ?? []"
            :key="`device-${device.id}`"
            class="mount-item pending"
          >
            <button class="mount-main" :disabled="disabled" @click="emit('open-device', device.id)">
              <strong>{{ device.name }}</strong>
              <code>{{ label('设备文件系统', 'Device filesystem') }}</code>
              <small>{{ device.subtitle }}</small>
            </button>
          </article>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.mount-band {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mount-head {
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.source-sections {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.source-section {
  min-width: 0;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.source-title {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.source-title strong {
  color: #0f172a;
  font-size: 14px;
  font-weight: 900;
}

.source-title small {
  color: #64748b;
  font-size: 12px;
  font-weight: 750;
}

.mount-head > div,
.mount-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mount-head strong,
.mount-main strong {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 900;
}

.mount-head small,
.mount-main small,
.empty-line {
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.45;
}

.mount-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.mount-item {
  min-width: 0;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px;
  background: #fff;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}

.mount-item.active {
  border-color: #14b8a6;
  background: #f0fdfa;
}

.mount-item.pending {
  border-style: dashed;
}

.mount-main {
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  padding: 0;
}

.mount-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

code {
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  font-weight: 800;
  text-overflow: ellipsis;
}

.empty-line {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 18px;
  background: #fff;
  text-align: center;
}

.empty-line.left {
  text-align: left;
}

.compact-empty {
  min-height: 74px;
  padding: 14px;
}

.plain-btn,
.danger-btn {
  min-height: 34px;
  border-radius: 8px;
  padding: 0 12px;
  font: inherit;
  font-size: 13px;
  font-weight: 900;
  cursor: pointer;
  white-space: nowrap;
}

.plain-btn {
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #334155;
}

.plain-btn:hover:not(:disabled) {
  border-color: #0f766e;
  background: #f0fdfa;
  color: #0f766e;
}

.danger-btn {
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #dc2626;
}

.compact {
  min-height: 30px;
  padding: 0 9px;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

@media (max-width: 760px) {
  .source-sections {
    grid-template-columns: 1fr;
  }

  .mount-head {
    align-items: stretch;
    flex-direction: column;
  }

  .mount-item {
    grid-template-columns: 1fr;
  }

  .mount-actions {
    justify-content: flex-start;
  }
}
</style>
