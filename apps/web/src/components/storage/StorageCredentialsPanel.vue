<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { alistApi, type AlistAuthorizationRecord } from '@/api/alist'
import { storageApi, type StorageProtocolSpec } from '@/api/storage'

const props = defineProps<{
  label: (zh: string, en: string) => string
}>()

const emit = defineEmits<{
  countChange: [count: number]
  error: [message: string]
  success: [message: string]
}>()

const router = useRouter()
const authorizations = ref<AlistAuthorizationRecord[]>([])
const protocols = ref<StorageProtocolSpec[]>([])
const busy = ref<Record<string, boolean>>({})
const formOpen = ref(false)
const editingId = ref<number | null>(null)
const name = ref('')
const driver = ref('webdav')
const endpoint = ref('')
const rootPath = ref('')
const username = ref('')
const password = ref('')
const keyName = ref('')

const fallbackProtocols: StorageProtocolSpec[] = [
  {
    id: 'webdav',
    name: 'WebDAV',
    status: 'implemented',
    summary: 'HTTP file protocol',
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
    summary: 'Server filesystem root',
    default_root_path: '/',
    readonly_default: false,
    supports: { list: true, get: true, remove: true, copy: true, mkdir: true, upload: true, cross_mount_copy: true },
    fields: [{ key: 'root_path', label: 'Local Root Path', required: true, placeholder: 'D:/files' }],
  },
  {
    id: 'sftp',
    name: 'SSH/SFTP',
    status: 'implemented',
    summary: 'Shared SSH credential for terminal and file access',
    default_root_path: '/',
    readonly_default: false,
    supports: { list: true, get: true, remove: true, copy: true, mkdir: true, upload: true, cross_mount_copy: true },
    fields: [
      { key: 'endpoint', label: 'Endpoint', required: true, placeholder: 'sftp://192.168.1.10:22' },
      { key: 'username', label: 'Username', required: true },
      { key: 'password', label: 'Password', required: false, secret: true },
      { key: 'key_name', label: 'SSH Key Name', required: false, placeholder: 'nas_root' },
      { key: 'root_path', label: 'SSH/SFTP Root Path', required: false, placeholder: '/' },
    ],
  },
  {
    id: 'adb',
    name: 'ADB',
    status: 'implemented',
    summary: 'Android filesystem browsing',
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

const protocolSpecs = computed(() => protocols.value.length > 0 ? protocols.value : fallbackProtocols)
const count = computed(() => authorizations.value.length)

onMounted(refresh)

defineExpose({ refresh })

async function refresh() {
  await Promise.allSettled([loadProtocols(), loadAuthorizations()])
}

async function loadAuthorizations() {
  setBusy('storage-auths', true)
  try {
    const result = await alistApi.listAuthorizations()
    authorizations.value = result.authorizations ?? []
    emit('countChange', authorizations.value.length)
  } catch (error) {
    emit('error', errorText(error))
  } finally {
    setBusy('storage-auths', false)
  }
}

async function loadProtocols() {
  try {
    const result = await storageApi.protocols()
    protocols.value = result.protocols ?? []
  } catch {
    protocols.value = fallbackProtocols
  }
}

function openCreate() {
  editingId.value = null
  name.value = ''
  driver.value = 'webdav'
  endpoint.value = ''
  rootPath.value = ''
  username.value = ''
  password.value = ''
  keyName.value = ''
  formOpen.value = true
}

function openEdit(record: AlistAuthorizationRecord) {
  const recordRoot = stringValue(record.props?.root_path)
  editingId.value = record.id
  name.value = record.name
  driver.value = protocolSpecs.value.some((protocol) => protocol.id === record.driver) ? record.driver : 'webdav'
  endpoint.value = record.driver === 'local' ? '' : record.endpoint
  rootPath.value = recordRoot || (record.driver === 'local' ? record.endpoint : '')
  username.value = record.username ?? ''
  password.value = ''
  keyName.value = stringValue(record.props?.key_name)
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
  editingId.value = null
}

async function submit() {
  const protocol = selectedProtocol()
  const bodyName = name.value.trim()
  const bodyEndpoint = endpoint.value.trim()
  const bodyRoot = rootPath.value.trim()
  const bodyKeyName = keyName.value.trim()
  if (!bodyName) return
  if (field('endpoint')?.required && !bodyEndpoint) return
  if (field('root_path')?.required && !bodyRoot) return

  const body = {
    name: bodyName,
    driver: protocol.id,
    endpoint: protocol.id === 'local' ? bodyRoot : bodyEndpoint,
    username: field('username') ? username.value.trim() : '',
    password: password.value || undefined,
    props: {
      ...(bodyRoot ? { root_path: bodyRoot } : {}),
      ...(bodyKeyName ? { key_name: bodyKeyName } : {}),
    },
    ...(field('username') || field('password') ? {} : { secret: {} }),
  }

  const key = editingId.value ? `storage-auth-edit-${editingId.value}` : 'storage-auth-create'
  setBusy(key, true)
  try {
    if (editingId.value) {
      await alistApi.updateAuthorization(editingId.value, body)
      emit('success', props.label('文件源授权已更新', 'Storage source authorization updated'))
    } else {
      await alistApi.createAuthorization(body)
      emit('success', props.label('文件源授权已保存', 'Storage source authorization saved'))
    }
    closeForm()
    await loadAuthorizations()
  } catch (error) {
    emit('error', errorText(error))
  } finally {
    setBusy(key, false)
  }
}

async function remove(record: AlistAuthorizationRecord) {
  if (!window.confirm(props.label(`删除文件源授权「${record.name}」？`, `Delete storage authorization "${record.name}"?`))) return
  const key = `storage-auth-delete-${record.id}`
  setBusy(key, true)
  try {
    await alistApi.removeAuthorization(record.id)
    await loadAuthorizations()
    emit('success', props.label('文件源授权已删除', 'Storage authorization removed'))
  } catch (error) {
    emit('error', errorText(error))
  } finally {
    setBusy(key, false)
  }
}

function setBusy(key: string, value: boolean) {
  const next = { ...busy.value }
  if (value) next[key] = true
  else delete next[key]
  busy.value = next
}

function isBusy(key: string) {
  return Boolean(busy.value[key])
}

function authRoot(record: AlistAuthorizationRecord): string {
  return stringValue(record.props?.root_path) || (record.driver === 'local' ? record.endpoint : '/')
}

function selectedProtocol(protocolId = driver.value): StorageProtocolSpec {
  return protocolSpecs.value.find((protocol) => protocol.id === protocolId) ?? fallbackProtocols[0]
}

function field(key: StorageProtocolSpec['fields'][number]['key'], protocolId = driver.value) {
  return selectedProtocol(protocolId).fields.find((item) => item.key === key)
}

function hasField(key: StorageProtocolSpec['fields'][number]['key']): boolean {
  return Boolean(field(key))
}

function protocolLabel(protocolId: string): string {
  return selectedProtocol(protocolId).name || protocolId
}

function endpointPlaceholder(): string {
  return field('endpoint')?.placeholder || 'https://example.test/dav'
}

function rootLabel(): string {
  return field('root_path')?.label || props.label('远端根路径', 'Remote Root Path')
}

function rootPlaceholder(): string {
  return field('root_path')?.placeholder || selectedProtocol().default_root_path || '/'
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
</script>

<template>
  <section class="detail-surface">
    <div class="detail-head">
      <div>
        <span class="eyebrow">{{ label('局域网账号', 'Local Network') }}</span>
        <h2>{{ label('文件源 / SSH/SFTP', 'Storage / SSH/SFTP') }}</h2>
      </div>
      <span :class="['pill', count > 0 ? 'ok' : 'muted']">
        {{ count }} {{ label('个凭据', 'credentials') }}
      </span>
    </div>

    <div class="list-toolbar">
      <div>
        <strong>{{ label('协议凭据注册中心', 'Protocol Credential Registry') }}</strong>
        <small>{{ label('授权中心只保存协议凭据；SSH/SFTP 同一来源可同时用于控制台和文件系统。', 'The authorization center stores protocol credentials; one SSH/SFTP source can power both terminal and files.') }}</small>
      </div>
      <div class="toolbar-actions">
        <button class="primary-btn" :disabled="isBusy('storage-auth-create')" @click="openCreate">
          {{ label('新增授权', 'Add Authorization') }}
        </button>
        <button class="plain-btn" @click="router.push('/storage')">
          {{ label('打开文件工作台', 'Open Storage') }}
        </button>
        <button class="plain-btn" :disabled="isBusy('storage-auths')" @click="refresh">
          {{ label('刷新', 'Refresh') }}
        </button>
      </div>
    </div>

    <div class="protocol-strip">
      <div
        v-for="protocol in protocolSpecs"
        :key="protocol.id"
        class="protocol-chip"
        :class="protocol.status"
      >
        <strong>{{ protocol.name }}</strong>
        <small>{{ protocol.status === 'implemented' ? label('可用', 'Available') : label('计划中', 'Planned') }}</small>
      </div>
    </div>

    <div v-if="authorizations.length === 0" class="empty-line left">
      {{ label('还没有文件源授权。SSH/SFTP 来源保存后，可以在设备里绑定为控制台和文件系统入口。', 'No storage source authorization yet. Save an SSH/SFTP source, then bind it to a device for terminal and files.') }}
    </div>

    <div v-else class="target-table">
      <div class="target-row header">
        <span>{{ label('名称', 'Name') }}</span>
        <span>{{ label('挂载凭据', 'Mount Credential') }}</span>
        <span>{{ label('操作', 'Actions') }}</span>
      </div>
      <div v-for="record in authorizations" :key="record.id" class="target-row">
        <div class="device-cell">
          <strong>{{ record.name }}</strong>
          <small>auth_ref: alist:{{ record.id }} · authorization_id: {{ record.id }}</small>
        </div>

        <div class="endpoint-cell">
          <code>{{ record.driver === 'local' ? authRoot(record) : record.endpoint }}</code>
          <small>
            {{ protocolLabel(record.driver) }} · {{ record.username || label('无用户名', 'No username') }} ·
            {{ record.has_secret ? label('已保存密钥', 'Secret saved') : label('无密钥', 'No secret') }}
          </small>
        </div>

        <div class="row-actions">
          <button class="plain-btn compact" :disabled="isBusy(`storage-auth-edit-${record.id}`)" @click="openEdit(record)">
            {{ label('编辑', 'Edit') }}
          </button>
          <button class="danger-btn compact" :disabled="isBusy(`storage-auth-delete-${record.id}`)" @click="remove(record)">
            {{ label('删除', 'Delete') }}
          </button>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="formOpen" class="dialog-overlay" @click.self="closeForm">
        <form class="dialog-panel" @submit.prevent="submit">
          <div class="dialog-head">
            <div>
              <span class="eyebrow">{{ label('文件源', 'Storage Source') }}</span>
              <h2>{{ editingId ? label('编辑授权', 'Edit Authorization') : label('新增授权', 'Add Authorization') }}</h2>
            </div>
            <button type="button" class="plain-btn compact" @click="closeForm">{{ label('关闭', 'Close') }}</button>
          </div>

          <div class="form-grid">
            <label class="form-field">
              <span>{{ label('名称', 'Name') }}</span>
              <input v-model="name" class="form-input" :placeholder="label('家庭 WebDAV', 'Home WebDAV')" />
            </label>

            <label class="form-field">
              <span>Driver</span>
              <select v-model="driver" class="form-input">
                <option
                  v-for="protocol in protocolSpecs"
                  :key="protocol.id"
                  :value="protocol.id"
                  :disabled="protocol.status !== 'implemented'"
                >
                  {{ protocol.name }}{{ protocol.status === 'planned' ? ` · ${label('计划中', 'Planned')}` : '' }}
                </option>
              </select>
            </label>

            <label v-if="hasField('endpoint')" class="form-field full">
              <span>Endpoint</span>
              <input v-model="endpoint" class="form-input" :placeholder="endpointPlaceholder()" />
            </label>

            <label v-if="hasField('root_path')" class="form-field full">
              <span>{{ rootLabel() }}</span>
              <input v-model="rootPath" class="form-input" :placeholder="rootPlaceholder()" />
            </label>

            <label v-if="hasField('username')" class="form-field">
              <span>{{ label('用户名', 'Username') }}</span>
              <input v-model="username" class="form-input" autocomplete="username" />
            </label>

            <label v-if="hasField('password')" class="form-field">
              <span>{{ editingId ? label('新密码', 'New Password') : label('密码', 'Password') }}</span>
              <input v-model="password" class="form-input" type="password" autocomplete="new-password" :placeholder="editingId ? label('留空则不变', 'Leave blank to keep') : ''" />
            </label>

            <label v-if="hasField('key_name')" class="form-field">
              <span>{{ label('私钥名称', 'Key Name') }}</span>
              <input v-model="keyName" class="form-input" :placeholder="field('key_name')?.placeholder || 'nas_root'" />
            </label>
          </div>

          <div class="empty-line left">
            {{ label('密码不会写进设备 props；SSH/SFTP 来源可被设备控制台和文件系统共同使用。', 'Secrets are not written to device props; SSH/SFTP sources are shared by terminal and files.') }}
          </div>

          <div class="dialog-actions">
            <button type="button" class="plain-btn" @click="closeForm">{{ label('取消', 'Cancel') }}</button>
            <button
              type="submit"
              class="primary-btn"
              :disabled="!name.trim() || (field('endpoint')?.required && !endpoint.trim()) || (field('root_path')?.required && !rootPath.trim()) || isBusy('storage-auth-create') || (editingId ? isBusy(`storage-auth-edit-${editingId}`) : false)"
            >
              {{ editingId ? label('保存', 'Save') : label('创建', 'Create') }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.detail-surface {
  min-height: 470px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.detail-head,
.list-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.eyebrow {
  display: inline-flex;
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0;
}

h2 {
  margin: 5px 0 0;
  color: #0f172a;
  font-size: 24px;
}

.pill {
  min-height: 28px;
  border-radius: 999px;
  padding: 5px 10px;
  display: inline-flex;
  align-items: center;
  color: #475569;
  background: #f1f5f9;
  font-size: 12px;
  font-weight: 900;
}

.pill.ok {
  color: #047857;
  background: #d1fae5;
}

.list-toolbar,
.empty-line,
.target-row {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
}

.list-toolbar {
  padding: 16px;
}

.list-toolbar > div,
.device-cell,
.endpoint-cell {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.list-toolbar strong,
.device-cell strong {
  color: #0f172a;
  font-size: 14px;
  font-weight: 900;
}

.list-toolbar small,
.device-cell small,
.endpoint-cell small {
  color: #64748b;
  font-size: 12px;
  font-weight: 750;
}

.toolbar-actions,
.row-actions,
.dialog-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.protocol-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.protocol-chip {
  min-height: 40px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.protocol-chip strong {
  color: #0f172a;
  font-size: 13px;
  font-weight: 900;
}

.protocol-chip small {
  color: #64748b;
  font-size: 11px;
  font-weight: 850;
}

.protocol-chip.implemented {
  border-color: rgba(15, 118, 110, 0.24);
  background: #f0fdfa;
}

.protocol-chip.planned {
  background: #f8fafc;
}

.empty-line {
  min-height: 58px;
  padding: 18px;
  color: #64748b;
  font-size: 13px;
  font-weight: 750;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-line.left {
  justify-content: flex-start;
}

.target-table {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

.target-row {
  border: 0;
  border-radius: 0;
  min-height: 68px;
  padding: 12px 14px;
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.25fr) auto;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid #e2e8f0;
}

.target-row:last-child {
  border-bottom: 0;
}

.target-row.header {
  min-height: 42px;
  background: #f8fafc;
  color: #64748b;
  font-size: 12px;
  font-weight: 900;
}

.endpoint-cell code {
  overflow: hidden;
  color: #0f172a;
  font-size: 12px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plain-btn,
.primary-btn,
.danger-btn {
  min-height: 36px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 0 12px;
  background: #fff;
  color: #334155;
  font: inherit;
  font-size: 13px;
  font-weight: 850;
  cursor: pointer;
}

.primary-btn {
  border-color: #0f766e;
  background: #0f766e;
  color: #fff;
}

.danger-btn {
  border-color: #fecaca;
  color: #b91c1c;
}

.compact {
  min-height: 30px;
  padding: 0 9px;
  font-size: 12px;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  padding: 20px;
  background: rgba(15, 23, 42, 0.42);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialog-panel {
  width: min(720px, 100%);
  max-height: min(760px, calc(100vh - 40px));
  overflow: auto;
  border-radius: 8px;
  background: #fff;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-field.full {
  grid-column: 1 / -1;
}

.form-field span {
  color: #334155;
  font-size: 12px;
  font-weight: 900;
}

.form-input {
  min-height: 38px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 0 10px;
  color: #0f172a;
  font: inherit;
  font-size: 13px;
  font-weight: 750;
}

@media (max-width: 760px) {
  .detail-head,
  .list-toolbar,
  .target-row {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .detail-head,
  .list-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
