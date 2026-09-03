<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { alistApi, type AlistAuthorizationRecord } from '@/api/alist'
import { storageApi, type StorageProtocolSpec } from '@/api/storage'

type LabelFn = (zh: string, en: string) => string

const props = defineProps<{ label: LabelFn }>()

const emit = defineEmits<{
  (event: 'count-change', count: number): void
  (event: 'error', message: string): void
  (event: 'success', message: string): void
}>()

const router = useRouter()
const authorizations = ref<AlistAuthorizationRecord[]>([])
const protocols = ref<StorageProtocolSpec[]>([])
const busy = ref<Record<string, boolean>>({})
const formOpen = ref(false)
const editingId = ref<number | null>(null)
const driver = ref<'baidu_netdisk' | 'webdav'>('baidu_netdisk')
const name = ref('')
const endpoint = ref('')
const rootPath = ref('/')
const username = ref('')
const password = ref('')
const baiduTokenUrl = 'https://openapi.baidu.com/oauth/2.0/authorize?response_type=code&client_id=hq9yQ9w9kR4YHj1kyYafLygVocobh7Sf&redirect_uri=https://alistgo.com/tool/baidu/callback&scope=basic,netdisk&qrcode=1'

const fallbackSpec: StorageProtocolSpec = {
  id: 'webdav',
  name: 'WebDAV',
  status: 'implemented',
  summary: 'HTTP file protocol',
  default_root_path: '/',
  readonly_default: false,
  supports: { list: true, get: true, remove: true, copy: true, mkdir: true, upload: true, cross_mount_copy: true },
  fields: [
    { key: 'endpoint', label: 'Endpoint', required: true, placeholder: 'https://dav.example.com/remote.php/webdav' },
    { key: 'username', label: 'Username', required: false },
    { key: 'password', label: 'Password', required: false, secret: true },
    { key: 'root_path', label: 'Remote Root Path', required: false, placeholder: '/' },
  ],
}

const spec = computed<StorageProtocolSpec>(() => {
  const found = protocols.value.find((item) => item.id === 'webdav')
  return found ?? fallbackSpec
})

const cloudRecords = computed(() => authorizations.value.filter((record) => ['baidu_netdisk', 'webdav'].includes(record.driver)))
const count = computed(() => cloudRecords.value.length)

onMounted(refresh)
defineExpose({ refresh })

async function refresh() {
  await Promise.allSettled([loadProtocols(), loadAuthorizations()])
}

async function loadAuthorizations() {
  setBusy('cloud-auths', true)
  try {
    const result = await alistApi.listAuthorizations()
    authorizations.value = result.authorizations ?? []
    emit('count-change', count.value)
  } catch (error) {
    emit('error', errorText(error))
  } finally {
    setBusy('cloud-auths', false)
  }
}

async function loadProtocols() {
  try {
    const result = await storageApi.protocols()
    protocols.value = result.protocols ?? []
  } catch {
    protocols.value = []
  }
}

function openCreate() {
  editingId.value = null
  driver.value = 'baidu_netdisk'
  name.value = ''
  endpoint.value = 'baidu://netdisk'
  rootPath.value = '/'
  username.value = ''
  password.value = ''
  formOpen.value = true
}

function openEdit(record: AlistAuthorizationRecord) {
  editingId.value = record.id
  driver.value = record.driver === 'webdav' ? 'webdav' : 'baidu_netdisk'
  name.value = record.name
  endpoint.value = record.endpoint
  rootPath.value = stringValue(record.props?.root_path) || '/'
  username.value = record.username ?? ''
  password.value = ''
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
  editingId.value = null
}

function openBaiduTokenTool() {
  window.open(baiduTokenUrl, '_blank', 'noopener,noreferrer')
}

async function submit() {
  const bodyName = name.value.trim()
  const bodyDriver = driver.value
  const bodyEndpoint = bodyDriver === 'baidu_netdisk' ? 'baidu://netdisk' : endpoint.value.trim()
  const bodyRoot = rootPath.value.trim()
  if (!bodyName || !bodyEndpoint) return
  if (bodyDriver === 'baidu_netdisk' && !editingId.value && !password.value.trim()) return
  const body = {
    name: bodyName,
    driver: bodyDriver,
    endpoint: bodyEndpoint,
    username: bodyDriver === 'webdav' ? username.value.trim() : '',
    password: password.value || undefined,
    secret: bodyDriver === 'baidu_netdisk' && password.value ? { refresh_token: password.value } : undefined,
    props: { root_path: bodyRoot || '/' },
  }
  const key = editingId.value ? `cloud-auth-edit-${editingId.value}` : 'cloud-auth-create'
  setBusy(key, true)
  try {
    if (editingId.value) {
      await alistApi.updateAuthorization(editingId.value, body)
      emit('success', props.label('网盘授权已更新', 'Cloud drive authorization updated'))
    } else {
      const created = await alistApi.createAuthorization(body)
      await ensureCloudMount(created.authorization)
      emit('success', props.label('网盘授权已保存', 'Cloud drive authorization saved'))
    }
    closeForm()
    await loadAuthorizations()
  } catch (error) {
    emit('error', errorText(error))
  } finally {
    setBusy(key, false)
  }
}

async function ensureCloudMount(record: AlistAuthorizationRecord) {
  const safeName = record.name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-')
  try {
    await storageApi.createMount({
      name: record.name,
      virtual_path: `/cloud/${safeName || `drive-${record.id}`}`,
      driver: record.driver,
      authorization_id: record.id,
      readonly: false,
      props: {
        source: 'cloud',
        root_path: stringValue(record.props?.root_path) || '/',
      },
    })
  } catch (error) {
    emit('error', props.label(`网盘已保存，但自动创建文件中枢入口失败：${errorText(error)}`, `Cloud drive saved, but file hub mount failed: ${errorText(error)}`))
  }
}

function driverName(value: string): string {
  if (value === 'baidu_netdisk') return props.label('百度网盘', 'Baidu Netdisk')
  if (value === 'webdav') return 'WebDAV'
  return value
}

async function remove(record: AlistAuthorizationRecord) {
  if (!window.confirm(props.label(`删除网盘授权「${record.name}」？`, `Delete cloud drive "${record.name}"?`))) return
  const key = `cloud-auth-delete-${record.id}`
  setBusy(key, true)
  try {
    await alistApi.removeAuthorization(record.id)
    await loadAuthorizations()
    emit('success', props.label('网盘授权已删除', 'Cloud drive removed'))
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

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
</script>

<template>
  <section class="cloud-panel">
    <div class="cloud-head">
      <div>
        <span class="eyebrow">{{ label('外部账号', 'External Accounts') }}</span>
        <h2>{{ label('网盘', 'Cloud Drives') }}</h2>
        <p class="hint">
          {{ label('网盘账号保存在这里。文件中枢只使用已绑定来源，不在浏览时重复登录。',
                   'Cloud drive accounts live here. The file hub only uses bound sources and never asks you to log in while browsing.') }}
        </p>
      </div>
      <span :class="['pill', count > 0 ? 'ok' : 'muted']">
        {{ count }} {{ label('个网盘', 'drives') }}
      </span>
    </div>

    <div class="toolbar">
      <div class="toolbar-actions">
        <button class="primary-btn" :disabled="isBusy('cloud-auth-create')" @click="openCreate">
          {{ label('新增网盘', 'Add Cloud Drive') }}
        </button>
        <button class="plain-btn" @click="router.push('/storage')">
          {{ label('打开文件中枢', 'Open File Hub') }}
        </button>
        <button class="plain-btn" :disabled="isBusy('cloud-auths')" @click="refresh">
          {{ label('刷新', 'Refresh') }}
        </button>
      </div>
    </div>

    <div v-if="cloudRecords.length === 0" class="empty">
      {{ label('还没有网盘账号。先添加百度网盘或 WebDAV，保存后会自动进入文件中枢。',
               'No cloud drive yet. Add Baidu Netdisk or WebDAV, then it appears in the file hub.') }}
    </div>

    <div v-else class="row-list">
      <div class="row header">
        <span>{{ label('名称', 'Name') }}</span>
        <span>{{ label('来源', 'Source') }}</span>
        <span>{{ label('凭据', 'Credentials') }}</span>
        <span>{{ label('操作', 'Actions') }}</span>
      </div>
      <div v-for="record in cloudRecords" :key="record.id" class="row">
        <div class="cell name">
          <strong>{{ record.name }}</strong>
          <small>authorization_id: {{ record.id }}</small>
        </div>
        <div class="cell endpoint">
          <code>{{ driverName(record.driver) }}</code>
          <small>{{ label('根路径', 'Root') }}: {{ stringValue(record.props?.root_path) || '/' }}</small>
        </div>
        <div class="cell credentials">
          <small>{{ record.driver === 'webdav' ? (record.username || label('无用户名', 'No username')) : label('Refresh Token', 'Refresh Token') }} · {{ record.has_secret ? label('已保存', 'Saved') : label('未保存', 'Missing') }}</small>
        </div>
        <div class="cell actions">
          <button class="plain-btn compact" :disabled="isBusy(`cloud-auth-edit-${record.id}`)" @click="openEdit(record)">
            {{ label('编辑', 'Edit') }}
          </button>
          <button class="danger-btn compact" :disabled="isBusy(`cloud-auth-delete-${record.id}`)" @click="remove(record)">
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
              <span class="eyebrow">{{ label('外部账号', 'External Accounts') }}</span>
              <h3>{{ editingId ? label('编辑网盘', 'Edit Cloud Drive') : label('新增网盘', 'Add Cloud Drive') }}</h3>
            </div>
            <button type="button" class="plain-btn compact" @click="closeForm">{{ label('关闭', 'Close') }}</button>
          </div>

          <div class="form-grid">
            <label class="form-field full">
              <span>{{ label('平台', 'Provider') }}</span>
              <select v-model="driver" class="form-input" :disabled="Boolean(editingId)">
                <option value="baidu_netdisk">{{ label('百度网盘', 'Baidu Netdisk') }}</option>
                <option value="webdav">WebDAV</option>
              </select>
            </label>

            <label class="form-field full">
              <span>{{ label('名称', 'Name') }}</span>
              <input v-model="name" class="form-input" :placeholder="driver === 'baidu_netdisk' ? label('我的百度网盘', 'My Baidu Netdisk') : label('坚果云 / 家庭 WebDAV', 'Nutstore / Home WebDAV')" />
            </label>

            <label v-if="driver === 'webdav'" class="form-field full">
              <span>Endpoint</span>
              <input v-model="endpoint" class="form-input" placeholder="https://dav.example.com/remote.php/webdav" />
            </label>

            <label class="form-field">
              <span>{{ label('远端根路径', 'Remote Root Path') }}</span>
              <input v-model="rootPath" class="form-input" placeholder="/" />
            </label>

            <label v-if="driver === 'webdav'" class="form-field">
              <span>{{ label('用户名', 'Username') }}</span>
              <input v-model="username" class="form-input" autocomplete="username" />
            </label>

            <label class="form-field full">
              <span>
                {{ driver === 'baidu_netdisk'
                  ? (editingId ? label('新 Refresh Token（留空不变）', 'New Refresh Token (leave blank to keep)') : 'Refresh Token')
                  : (editingId ? label('新密码（留空不变）', 'New Password (leave blank to keep)') : label('密码', 'Password')) }}
              </span>
              <input v-model="password" class="form-input" type="password" autocomplete="new-password" />
            </label>

            <div v-if="driver === 'baidu_netdisk'" class="token-helper full">
              <button type="button" class="plain-btn" @click="openBaiduTokenTool">
                {{ label('获取 Refresh Token', 'Get Refresh Token') }}
              </button>
              <span>
                {{ label('按 AList 原版方式授权，完成后把返回的 Refresh Token 粘贴到上方。',
                         'Uses the same AList authorization flow. Paste the returned Refresh Token above.') }}
              </span>
            </div>
          </div>

          <p class="footnote">
            {{ label('来源：', 'Source:') }} {{ driverName(driver) }} · {{ label('保存后自动进入文件中枢', 'Automatically appears in the file hub after saving') }}
          </p>

          <div class="dialog-actions">
            <button type="button" class="plain-btn" @click="closeForm">{{ label('取消', 'Cancel') }}</button>
            <button
              type="submit"
              class="primary-btn"
              :disabled="!name.trim() || (driver === 'webdav' && !endpoint.trim()) || (driver === 'baidu_netdisk' && !editingId && !password.trim()) || isBusy('cloud-auth-create') || (editingId ? isBusy(`cloud-auth-edit-${editingId}`) : false)"
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
.cloud-panel {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
}

.cloud-head {
  display: flex;
  align-items: flex-start;
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
  font-weight: 900;
}

h3 {
  margin: 5px 0 0;
  color: #0f172a;
  font-size: 18px;
  font-weight: 900;
}

.hint {
  margin: 8px 0 0;
  color: #64748b;
  font-size: 13px;
  font-weight: 750;
  line-height: 1.5;
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

.toolbar {
  display: flex;
  justify-content: flex-end;
}

.toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.empty {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  padding: 18px;
  color: #64748b;
  font-size: 13px;
  font-weight: 750;
}

.row-list {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

.row {
  min-height: 60px;
  padding: 12px 14px;
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.6fr) minmax(0, 1.1fr) auto;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid #e2e8f0;
}

.row:last-child {
  border-bottom: 0;
}

.row.header {
  min-height: 42px;
  background: #f8fafc;
  color: #64748b;
  font-size: 12px;
  font-weight: 900;
}

.cell {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cell.name strong,
.cell.endpoint code {
  color: #0f172a;
  font-size: 13px;
  font-weight: 900;
}

.cell.endpoint code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: inherit;
}

.cell small {
  color: #64748b;
  font-size: 12px;
  font-weight: 750;
}

.cell.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
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
  width: min(620px, 100%);
  max-height: min(700px, calc(100vh - 40px));
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

.token-helper.full {
  grid-column: 1 / -1;
}

.token-helper {
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #eff6ff;
  padding: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.token-helper span {
  color: #1e3a8a;
  font-size: 12px;
  font-weight: 750;
  line-height: 1.45;
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

.footnote {
  color: #64748b;
  font-size: 12px;
  font-weight: 750;
}

.dialog-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 760px) {
  .row {
    grid-template-columns: 1fr;
    align-items: stretch;
  }
  .cell.actions {
    justify-content: flex-start;
  }
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
