<script setup lang="ts">
import type { AlistAuthorizationRecord, AlistDriverHealthResult } from '@/api/alist'
import type { StorageMountRecord } from '@/api/storage'

type LabelFn = (zh: string, en: string) => string

defineProps<{
  authorizations: AlistAuthorizationRecord[]
  mounts: StorageMountRecord[]
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
  (event: 'edit', mount: StorageMountRecord): void
  (event: 'delete', mount: StorageMountRecord): void
}>()
</script>

<template>
  <section class="mount-band">
    <div class="mount-head">
      <div>
        <strong>{{ label('系统挂载', 'System Mounts') }}</strong>
        <small>{{ health ? `${health.status} · ${health.drivers.join(', ')}` : label('等待探测', 'Pending probe') }}</small>
      </div>
      <button class="plain-btn compact" :disabled="authorizations.length === 0" @click="emit('create')">{{ label('创建挂载', 'Create Mount') }}</button>
    </div>

    <div v-if="authorizations.length === 0" class="empty-line left">
      {{ label('还没有可用授权。先在授权中心保存 WebDAV 或本地目录凭据。', 'No authorization is available. Save a WebDAV or local folder credential first.') }}
    </div>

    <div v-else-if="mounts.length === 0" class="empty-line left">
      {{ label('已有授权，但还没有系统挂载。创建挂载后，这里会成为 HomeSense 的统一文件入口。', 'Authorizations exist, but no system mount is configured yet. Create a mount to make it available in HomeSense storage.') }}
    </div>

    <div v-else class="mount-grid">
      <article
        v-for="mount in mounts"
        :key="mount.id"
        class="mount-item"
        :class="{ active: activeMountPath === mount.virtual_path || pathInput === mount.virtual_path }"
      >
        <button class="mount-main" :disabled="disabled" @click="emit('open', mount.virtual_path)">
          <strong>{{ mount.name }}</strong>
          <code>{{ mount.virtual_path }}</code>
          <small>{{ mount.driver }} · {{ authorizationName(mount.authorization_id) }}{{ mount.readonly ? ` · ${label('只读', 'Readonly')}` : '' }}</small>
        </button>
        <div class="mount-actions">
          <button class="plain-btn compact" @click="emit('edit', mount)">{{ label('编辑', 'Edit') }}</button>
          <button class="danger-btn compact" :disabled="isBusy(`mount-delete-${mount.id}`)" @click="emit('delete', mount)">{{ label('删除', 'Delete') }}</button>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.mount-band {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mount-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
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
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
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

.mount-main {
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
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
  color: var(--text-secondary);
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
