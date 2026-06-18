<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, type UserDevice } from '@/api'
import type { MiDeviceCandidate } from '@/api'
import { alistApi, type AlistAuthorizationRecord } from '@/api/alist'
import { streamingGatewayApi, type StreamingHost } from '@/api/streamingGateway'
import { useLocale } from '@/composables/useLocale'
import { useDeviceDetailCapabilities } from '@/composables/useDeviceDetailCapabilities'
import AppBrowserModal from '@/components/AppBrowserModal.vue'
import AdbWorkbench from '@/components/AdbWorkbench.vue'
import DeviceCapabilitiesPanel from '@/components/devices/DeviceCapabilitiesPanel.vue'
import type { DeviceCapability } from '@/types/deviceCapabilities'

const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')
function label(zh: string, en: string) { return isZh.value ? zh : en }

const route = useRoute()
const router = useRouter()
const deviceId = Number(route.params.id)
const returnTo = computed(() => {
  const from = route.query.from
  if (typeof from === 'string' && from.startsWith('/')) return from
  return '/devices'
})

function goBack() {
  router.push(returnTo.value)
}

const loading = ref(true)
const device = ref<UserDevice | null>(null)
const errorMessage = ref('')
const showAppBrowser = ref(false)
const showBindingDialog = ref(false)
const bindingSaving = ref(false)
const bindingLoading = ref(false)
const bindingMessage = ref('')
const bindingError = ref('')
const authorizations = ref<AlistAuthorizationRecord[]>([])
const sshTargets = ref<Array<{ id: number; name: string; kind: 'local' | 'ssh' | 'adb'; target: Record<string, unknown> }>>([])
const streamingHosts = ref<StreamingHost[]>([])
const miCandidates = ref<MiDeviceCandidate[]>([])
const bindingSourcesLoaded = ref(false)
const deviceNameDraft = ref('')
const selectedMiDid = ref('')
const selectedAdbAuthId = ref('')
const selectedSshTargetId = ref('')
const selectedStreamingHostId = ref('')
const bindingForm = ref({
  ip_address: '',
})

const adbAuthOptions = computed(() => authorizations.value.filter((auth) => auth.driver === 'adb'))
const sshAuthOptions = computed(() => authorizations.value.filter((auth) => auth.driver === 'sftp' || auth.driver === 'ssh'))
const pairedStreamingHosts = computed(() => streamingHosts.value.filter((host) => host.pairing?.status === 'paired' && !host.pairing.mock_pairing))

function propString(d: UserDevice | null, key: string): string {
  if (!d) return ''
  const v = d.props?.[key]
  return typeof v === 'string' ? v : ''
}

const {
  capabilities,
  capsLoading,
  capsError,
  executingCap,
  execResult,
  execError,
  textInputs,
  execHistory,
  irKeys,
  irKeysLoading,
  miActionCaps,
  miPropertyCaps,
  adbCaps,
  isIrDevice,
  isAdbDevice,
  miDidOf,
  adbIpOf,
  miNameFor,
  hydrateIrRemoteProfile,
  refreshCapabilities,
  loadHistory,
  loadIrKeys,
  executeIrKey,
  executeCapability,
  setTextInput,
} = useDeviceDetailCapabilities({
  deviceId,
  device,
  label,
  propString,
})

onMounted(async () => {
  try {
    const result = await api.userDevices.get(deviceId)
    device.value = result.device ?? null
    hydrateDeviceSnapshot(device.value)
    void loadHistory()
  } catch (e) {
    errorMessage.value = (e as Error).message || String(e)
  } finally {
    loading.value = false
  }
})

const deviceTypeOptions: Record<string, { zh: string; en: string }> = {
  television: { zh: '电视', en: 'TV' },
  stb: { zh: '机顶盒', en: 'STB' },
  speaker: { zh: '音箱', en: 'Speaker' },
  router: { zh: '路由器', en: 'Router' },
  outlet: { zh: '插座', en: 'Outlet' },
  phone: { zh: '手机', en: 'Phone' },
  tv_box: { zh: '电视盒', en: 'TV Box' },
  tablet: { zh: '平板', en: 'Tablet' },
  computer: { zh: '电脑', en: 'Computer' },
  other: { zh: '其他', en: 'Other' },
}

function typeLabel(t: string) {
  return deviceTypeOptions[t]?.[isZh.value ? 'zh' : 'en'] ?? t
}

function sourceTags(d: UserDevice): string[] {
  const tags: string[] = []
  if (propString(d, 'mi_did')) tags.push('Mi')
  if (propString(d, 'adb_ip')) tags.push('ADB')
  if (propString(d, 'streaming_host_id')) tags.push(label('串流', 'Stream'))
  return tags
}

function miDisplayName(did: string): string {
  if (!did) return ''
  const candidate = miCandidates.value.find((item) => item.did === did)
  return candidate?.name || candidate?.model || miNameFor(did)
}

const canOpenConsole = computed(() => {
  if (!device.value) return false
  if (propString(device.value, 'ssh_target_id') || propString(device.value, 'ssh_authorization_id')) return true
  if (propString(device.value, 'ssh_host') && propString(device.value, 'ssh_user')) return true
  if (propString(device.value, 'adb_serial') || propString(device.value, 'adb_ip')) return true
  return propString(device.value, 'device_type') === 'windows_pc'
})

const canOpenFiles = computed(() => {
  if (!device.value) return false
  if (propString(device.value, 'adb_serial') || propString(device.value, 'adb_ip')) return true
  return Boolean(
    propString(device.value, 'ssh_target_id') ||
    propString(device.value, 'ssh_authorization_id') ||
    (propString(device.value, 'ssh_host') && propString(device.value, 'ssh_user')),
  )
})

const canOpenStreaming = computed(() => {
  if (!device.value) return false
  if (propString(device.value, 'streaming_host_id')) return true
  return Boolean(propString(device.value, 'adb_ip') || propString(device.value, 'adb_serial'))
})

function openConsole() {
  router.push({ path: '/sessions/terminal', query: { target_device_id: deviceId, from: route.fullPath } })
}

function openAdbStream() {
  if (!device.value) return
  const adb = propString(device.value, 'adb_ip') || propString(device.value, 'adb_serial')
  if (!adb) return
  router.push({
    path: '/sessions/adb-stream',
    query: {
      target_device_id: String(deviceId),
      device: adb,
      name: device.value.name,
      from: route.fullPath,
    },
  })
}

function openStreaming() {
  if (!device.value) return
  const streamingHostId = propString(device.value, 'streaming_host_id')
  if (streamingHostId) {
    router.push({
      path: '/sessions/streaming',
      query: {
        target_device_id: String(deviceId),
        host_id: streamingHostId,
        name: device.value.name,
        autostart: '1',
        from: route.fullPath,
      },
    })
    return
  }
  openAdbStream()
}

function openAdbFiles() {
  if (!device.value) return
  const adb = propString(device.value, 'adb_ip') || propString(device.value, 'adb_serial')
  if (!adb) {
    router.push({
      path: '/sessions/device-files',
      query: {
        target_device_id: String(deviceId),
        name: device.value.name,
        from: route.fullPath,
      },
    })
    return
  }
  router.push({
    path: '/sessions/adb-files',
    query: {
      target_device_id: String(deviceId),
      device: adb,
      name: device.value.name,
      from: route.fullPath,
    },
  })
}

async function openBindingDialog() {
  syncBindingForm(device.value)
  showBindingDialog.value = true
  bindingMessage.value = ''
  bindingError.value = ''
  if (!bindingSourcesLoaded.value) {
    void loadBindingSources()
  } else {
    syncSelectedSources(device.value)
  }
}

async function loadBindingSources(options?: { refresh?: boolean }) {
  bindingLoading.value = true
  try {
    const [authResult, terminalResult, miResult, streamingResult] = await Promise.allSettled([
      alistApi.listAuthorizations(),
      api.terminal.listTargets(),
      api.userDevices.miCandidates({ refresh: Boolean(options?.refresh) }),
      streamingGatewayApi.hosts(),
    ])
    if (authResult.status === 'fulfilled') {
      authorizations.value = authResult.value.authorizations ?? []
    }
    if (terminalResult.status === 'fulfilled') {
      sshTargets.value = terminalResult.value.data.filter((target) => target.kind === 'ssh' || target.kind === 'adb')
    }
    if (miResult.status === 'fulfilled') {
      miCandidates.value = miResult.value.devices ?? []
    }
    if (streamingResult.status === 'fulfilled') {
      streamingHosts.value = streamingResult.value.data ?? []
    }
    bindingSourcesLoaded.value = true
    syncSelectedSources(device.value)
  } finally {
    bindingLoading.value = false
  }
}

function syncBindingForm(d: UserDevice | null) {
  deviceNameDraft.value = d?.name ?? ''
  bindingForm.value = {
    ip_address: propString(d, 'ip_address'),
  }
  syncSelectedSources(d)
}

function syncSelectedSources(d: UserDevice | null) {
  selectedMiDid.value = propString(d, 'mi_did')
  selectedAdbAuthId.value = ''
  selectedSshTargetId.value = ''
  selectedStreamingHostId.value = propString(d, 'streaming_host_id')
  const adbIp = propString(d, 'adb_ip')
  const sshHost = propString(d, 'ssh_host')
  const sshUser = propString(d, 'ssh_user')
  const adbAuth = authorizations.value.find((auth) => auth.driver === 'adb' && auth.endpoint === adbIp)
  if (adbAuth) selectedAdbAuthId.value = String(adbAuth.id)
  const sshTarget = sshTargets.value.find((target) =>
    target.kind === 'ssh' &&
    String(target.target.host ?? '') === sshHost &&
    String(target.target.user ?? '') === sshUser
  )
  if (sshTarget) selectedSshTargetId.value = `target:${sshTarget.id}`
  const sshAuth = authorizations.value.find((auth) => {
    const host = auth.endpoint.replace(/^sftp:\/\//, '').split(':')[0] || auth.endpoint
    return (auth.driver === 'sftp' || auth.driver === 'ssh') && host === sshHost && (auth.username || '') === sshUser
  })
  if (!selectedSshTargetId.value && sshAuth) selectedSshTargetId.value = `auth:${sshAuth.id}`
}

function cleanBindingProps(props: Record<string, unknown>) {
  const next = { ...props }
  const ip = bindingForm.value.ip_address.trim()
  if (ip) next.ip_address = ip
  else delete next.ip_address

  if (selectedMiDid.value) next.mi_did = selectedMiDid.value
  else delete next.mi_did

  const selectedAdbId = String(selectedAdbAuthId.value || '')
  const adbAuth = authorizations.value.find((auth) => String(auth.id) === selectedAdbId)
  if (adbAuth) {
    next.adb_ip = adbAuth.endpoint
    next.adb_authorization_id = adbAuth.id
    delete next.adb_serial
  } else {
    delete next.adb_ip
    delete next.adb_authorization_id
    delete next.adb_serial
  }

  if (selectedSshTargetId.value.startsWith('target:')) {
    const id = Number(selectedSshTargetId.value.slice('target:'.length))
    const target = sshTargets.value.find((item) => item.id === id)
    if (target) {
      next.ssh_host = String(target.target.host ?? '')
      next.ssh_user = String(target.target.user ?? '')
      next.ssh_target_id = target.id
      delete next.ssh_authorization_id
    }
  } else if (selectedSshTargetId.value.startsWith('auth:')) {
    const id = Number(selectedSshTargetId.value.slice('auth:'.length))
    const auth = authorizations.value.find((item) => item.id === id)
    if (auth) {
      next.ssh_host = auth.endpoint.replace(/^sftp:\/\//, '').split(':')[0] || auth.endpoint
      next.ssh_user = auth.username || ''
      next.ssh_authorization_id = auth.id
      delete next.ssh_target_id
    }
  } else {
    delete next.ssh_host
    delete next.ssh_user
    delete next.ssh_target_id
    delete next.ssh_authorization_id
  }

  const selectedStreamingId = String(selectedStreamingHostId.value || '')
  const streamingHost = pairedStreamingHosts.value.find((host) => host.id === selectedStreamingId)
  if (streamingHost) {
    next.streaming_host_id = streamingHost.id
    next.streaming_host_label = streamingHost.label
    next.streaming_host_endpoint = streamingHost.endpoint
  } else {
    delete next.streaming_host_id
    delete next.streaming_host_label
    delete next.streaming_host_endpoint
  }
  return next
}

async function saveBindings() {
  if (!device.value) return
  bindingSaving.value = true
  bindingMessage.value = ''
  bindingError.value = ''
  try {
    if (selectedAdbAuthId.value && !authorizations.value.some((auth) => auth.driver === 'adb' && String(auth.id) === String(selectedAdbAuthId.value))) {
      throw new Error(label('选择的 ADB 来源不存在，请刷新来源后重试', 'Selected ADB source does not exist. Refresh sources and try again.'))
    }
    if (selectedStreamingHostId.value && !pairedStreamingHosts.value.some((host) => host.id === selectedStreamingHostId.value)) {
      throw new Error(label('选择的串流来源未配对，请先回授权中心完成配对', 'Selected streaming source is not paired. Pair it in Authorization Center first.'))
    }
    const result = await api.userDevices.update(deviceId, {
      name: deviceNameDraft.value.trim() || device.value.name,
      props: cleanBindingProps(device.value.props ?? {}),
    })
    device.value = result.data.device
    syncBindingForm(device.value)
    bindingMessage.value = label('绑定已保存', 'Bindings saved')
    capabilities.value = Array.isArray(device.value.props?.capabilities)
      ? (device.value.props.capabilities as DeviceCapability[])
      : []
    showBindingDialog.value = false
  } catch (e) {
    bindingError.value = (e as Error).message || String(e)
  } finally {
    bindingSaving.value = false
  }
}

function hydrateDeviceSnapshot(d: UserDevice | null) {
  syncBindingForm(d)
  capabilities.value = Array.isArray(d?.props?.capabilities)
    ? (d!.props.capabilities as DeviceCapability[])
    : []
  hydrateIrRemoteProfile()
}
</script>

<template>
  <div class="detail-page">
    <header class="page-head glass-panel">
      <button class="back-btn" @click="goBack">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        {{ label('返回', 'Back') }}
      </button>

      <div v-if="!loading && device" class="head-content">
        <div class="head-top">
          <span class="eyebrow">{{ typeLabel(propString(device, 'device_type') || 'other') }}</span>
          <h1>{{ device.name }}</h1>
          <div class="source-tags">
            <span v-for="tag in sourceTags(device)" :key="tag" class="source-tag" :class="tag === 'ADB' ? 'tag-adb' : 'tag-mi'">{{ tag }}</span>
          </div>
          <button v-if="canOpenConsole" class="console-btn" @click="openConsole">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
            {{ label('控制台', 'Console') }}
          </button>
          <button v-if="canOpenStreaming" class="console-btn stream-btn" @click="openStreaming">
            {{ label('串流', 'Stream') }}
          </button>
          <button v-if="canOpenFiles" class="console-btn" @click="openAdbFiles">
            {{ label('文件', 'Files') }}
          </button>
          <button class="bind-btn" @click="openBindingDialog">
            {{ label('编辑设备', 'Edit Device') }}
          </button>
        </div>
        <div class="head-meta">
          <span v-if="propString(device, 'mi_did')" class="meta-chip monospace">Mi: {{ miDisplayName(propString(device, 'mi_did')) }}</span>
          <span v-if="propString(device, 'adb_ip')" class="meta-chip monospace">ADB: {{ propString(device, 'adb_ip') }}</span>
          <span v-if="propString(device, 'streaming_host_id')" class="meta-chip monospace">
            {{ label('串流', 'Stream') }}: {{ propString(device, 'streaming_host_label') || propString(device, 'streaming_host_id') }}
          </span>
          <span v-if="propString(device, 'ip_address')" class="meta-chip monospace">IP: {{ propString(device, 'ip_address') }}</span>
        </div>
      </div>
    </header>

    <div v-if="errorMessage" class="error-line glass-panel">
      {{ errorMessage }}
    </div>

    <div v-if="loading" class="empty-state">{{ label('加载中…', 'Loading…') }}</div>

    <div v-else-if="!device" class="empty-state">{{ label('设备不存在', 'Device not found') }}</div>

    <template v-else>
      <DeviceCapabilitiesPanel
        class="glass-panel"
        :label="label"
        :has-capability-source="!!(propString(device, 'mi_did') || propString(device, 'adb_ip'))"
        :caps-loading="capsLoading"
        :caps-error="capsError"
        :capabilities-count="capabilities.length"
        :exec-result="execResult"
        :exec-error="execError"
        :is-ir-device="isIrDevice"
        :ir-keys="irKeys"
        :ir-keys-loading="irKeysLoading"
        :is-adb-device="isAdbDevice"
        :mi-action-caps="miActionCaps"
        :mi-property-caps="miPropertyCaps"
        :adb-caps="adbCaps"
        :executing-cap="executingCap"
        :text-inputs="textInputs"
        :exec-history="execHistory"
        @refresh="refreshCapabilities"
        @load-ir-keys="loadIrKeys"
        @execute-ir-key="executeIrKey"
        @execute-capability="executeCapability"
        @open-app-browser="showAppBrowser = true"
        @update-text-input="setTextInput"
      />

      <AdbWorkbench
        v-if="propString(device, 'adb_ip')"
        class="glass-panel adb-workbench-section"
        :device-id="deviceId"
        :device-name="device.name"
        :adb-ip="propString(device, 'adb_ip')"
        :device-type="typeLabel(propString(device, 'device_type') || 'other')"
        :label="label"
      />

      <AppBrowserModal v-if="showAppBrowser" :device-id="deviceId" :adb-ip="propString(device, 'adb_ip')" @close="showAppBrowser = false" />

      <div v-if="showBindingDialog" class="modal-backdrop" @click.self="showBindingDialog = false">
        <section class="binding-dialog">
          <div class="panel-head">
            <div>
              <span class="panel-kicker">{{ label('设备设置', 'Device Settings') }}</span>
              <h2>{{ label('编辑设备', 'Edit Device') }}</h2>
            </div>
            <button class="close-dialog" @click="showBindingDialog = false">×</button>
          </div>

          <div class="source-section">
            <div class="source-head">
              <strong>{{ label('基础信息', 'Basics') }}</strong>
              <small>{{ label('只有设备名称和 IP 允许手动编辑。', 'Only device name and IP can be edited manually.') }}</small>
            </div>
            <div class="binding-grid two">
              <label class="field">
                <span>{{ label('设备名称', 'Device Name') }}</span>
                <input v-model="deviceNameDraft" :placeholder="label('客厅电视', 'Living Room TV')" />
              </label>
              <label class="field">
                <span>{{ label('设备 IP', 'Device IP') }}</span>
                <input v-model="bindingForm.ip_address" placeholder="192.168.31.100" />
              </label>
            </div>
          </div>

          <div class="source-section">
            <div class="source-head">
              <strong>Mi</strong>
              <small>{{ label('从授权中心的 Mi 发现结果中选择设备。', 'Select a device discovered through the Mi authorization source.') }}</small>
              <button class="mini-refresh-btn" :disabled="bindingLoading" @click="loadBindingSources({ refresh: true })">
                {{ bindingLoading ? label('刷新中', 'Refreshing') : label('刷新来源', 'Refresh Sources') }}
              </button>
            </div>
            <label class="field">
              <span>{{ label('Mi 设备', 'Mi Device') }}</span>
              <select v-model="selectedMiDid">
                <option value="">{{ label('不绑定 Mi', 'No Mi binding') }}</option>
                <option v-for="candidate in miCandidates" :key="candidate.did" :value="candidate.did">
                  {{ candidate.name || candidate.did }} · {{ candidate.model || '-' }} · {{ candidate.did }}
                </option>
              </select>
            </label>
          </div>

          <div class="source-section">
            <div class="source-head">
              <strong>ADB</strong>
              <small>{{ label('只能从授权中心已有 ADB 来源选择。', 'Select only from existing Authorization Center ADB sources.') }}</small>
            </div>
            <label class="field">
              <span>{{ label('认证中心来源', 'Authorization Source') }}</span>
              <select v-model="selectedAdbAuthId">
                <option value="">{{ label('不绑定来源', 'No source') }}</option>
                <option v-for="auth in adbAuthOptions" :key="auth.id" :value="String(auth.id)">
                  {{ auth.name }} · {{ auth.endpoint }}
                </option>
              </select>
            </label>
          </div>

          <div class="source-section">
            <div class="source-head">
              <strong>SSH</strong>
              <small>{{ label('只能从授权中心已有 SSH 来源选择。', 'Select only from existing Authorization Center SSH sources.') }}</small>
            </div>
            <label class="field">
              <span>{{ label('认证中心来源', 'Authorization Source') }}</span>
              <select v-model="selectedSshTargetId">
                <option value="">{{ label('不绑定来源', 'No source') }}</option>
                <option v-for="target in sshTargets.filter((item) => item.kind === 'ssh')" :key="`target-${target.id}`" :value="`target:${target.id}`">
                  {{ target.name }} · {{ target.target.user }}@{{ target.target.host }}
                </option>
                <option v-for="auth in sshAuthOptions" :key="`auth-${auth.id}`" :value="`auth:${auth.id}`">
                  {{ auth.name }} · {{ auth.endpoint }}
                </option>
              </select>
            </label>
          </div>

          <div class="source-section">
            <div class="source-head">
              <strong>{{ label('串流', 'Streaming') }}</strong>
              <small>{{ label('从授权中心已配对的 Sunshine 主机中选择。', 'Select a paired Sunshine host from Authorization Center.') }}</small>
            </div>
            <label class="field">
              <span>{{ label('串流来源', 'Streaming Source') }}</span>
              <select v-model="selectedStreamingHostId">
                <option value="">{{ label('不绑定串流', 'No streaming binding') }}</option>
                <option v-for="host in pairedStreamingHosts" :key="host.id" :value="host.id">
                  {{ host.label }} · {{ host.endpoint }}
                </option>
              </select>
            </label>
          </div>

          <div class="dialog-actions">
            <span v-if="bindingLoading" class="dialog-note">{{ label('正在读取来源…', 'Loading sources…') }}</span>
            <span v-else-if="bindingError" class="binding-status error">{{ bindingError }}</span>
            <span v-else-if="bindingMessage" class="binding-status success">{{ bindingMessage }}</span>
            <button class="plain-action" @click="showBindingDialog = false">{{ label('取消', 'Cancel') }}</button>
            <button class="primary-action" :disabled="bindingSaving" @click="saveBindings">
              {{ bindingSaving ? label('保存中…', 'Saving…') : label('保存', 'Save') }}
            </button>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.detail-page {
  height: 100%;
  overflow-y: auto;
  padding: 48px;
  background: #f7f9fa;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.glass-panel {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 40px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(48px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.02);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.page-head {
  padding: 40px 48px;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.8);
  color: var(--text-secondary);
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
  margin-bottom: 24px;
  transition: all 0.2s;
}

.back-btn:hover {
  border-color: #6366f1;
  color: #6366f1;
  background: #fff;
  box-shadow: 0 6px 16px rgba(99, 102, 241, 0.12);
  transform: translateY(-1px);
}

.head-content {
  margin-left: 0;
}

.head-top {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.eyebrow {
  display: inline-block;
  color: #10b981;
  font-size: 14px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  background: rgba(16, 185, 129, 0.1);
  padding: 6px 16px;
  border-radius: 10px;
}

h1 {
  margin: 0;
  font-size: 36px;
  font-weight: 900;
  letter-spacing: -0.06em;
  color: var(--text-primary);
  line-height: 1;
}

.source-tags {
  display: flex;
  gap: 6px;
}

.source-tag {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 99px;
  font-size: 13px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.tag-mi { background: rgba(16, 185, 129, 0.1); color: #10b981; }
.tag-adb { background: rgba(99, 102, 241, 0.1); color: #6366f1; }

.head-meta {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 16px;
}

.meta-chip {
  display: inline-block;
  padding: 6px 14px;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 10px;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-tertiary);
}

.meta-chip.monospace {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 16px;
}

.error-line {
  padding: 20px 32px;
  border-color: rgba(239, 68, 68, 0.15);
  background: rgba(254, 242, 242, 0.8);
  color: #ef4444;
  font-size: 16px;
  font-weight: 900;
  box-shadow: 0 8px 24px rgba(239, 68, 68, 0.08);
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 300px;
  color: var(--text-tertiary);
  font-size: 16px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.25em;
  opacity: 0.4;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 22px;
}

.panel-kicker {
  display: block;
  margin-bottom: 6px;
  color: #6366f1;
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.16em;
}

.panel-head h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: 22px;
  font-weight: 900;
  letter-spacing: 0;
}

.primary-action {
  min-height: 38px;
  padding: 8px 16px;
  border: 1px solid #111827;
  border-radius: 8px;
  background: #111827;
  color: #fff;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
}

.primary-action:disabled {
  cursor: wait;
  opacity: 0.55;
}

.plain-action {
  min-height: 38px;
  padding: 8px 16px;
  border: 1px solid rgba(148, 163, 184, 0.45);
  border-radius: 8px;
  background: #fff;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
}

.binding-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(180px, 1fr));
  gap: 14px;
}

.binding-grid.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.field span {
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 900;
}

.field input,
.field select {
  width: 100%;
  min-height: 42px;
  box-sizing: border-box;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.82);
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 14px;
  padding: 8px 10px;
  outline: none;
}

.field select {
  font-family: inherit;
}

.field input:focus,
.field select:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.binding-hints {
  margin-top: 14px;
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.6;
}

.binding-status {
  margin-top: 12px;
  font-size: 14px;
  font-weight: 900;
}

.binding-status.success { color: #059669; }
.binding-status.error { color: #dc2626; }

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.42);
}

.binding-dialog {
  width: min(860px, 100%);
  max-height: min(86vh, 820px);
  overflow-y: auto;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 12px;
  background: #fff;
  padding: 24px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
}

.close-dialog {
  width: 34px;
  height: 34px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 8px;
  background: #fff;
  color: var(--text-secondary);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.source-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 0;
  border-top: 1px solid rgba(226, 232, 240, 0.86);
}

.source-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}

.source-head strong {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 900;
}

.source-head small,
.dialog-note {
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.5;
}

.dialog-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 16px;
  border-top: 1px solid rgba(226, 232, 240, 0.86);
}

.dialog-actions > span {
  margin-right: auto;
}

.console-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  margin-left: 12px;
  border-radius: 6px;
  border: 1px solid #10b981;
  background: transparent;
  color: #10b981;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.console-btn:hover {
  background: #10b981;
  color: #fff;
}

.stream-btn {
  border-color: #6366f1;
  color: #6366f1;
}

.stream-btn:hover {
  background: #6366f1;
  color: #fff;
}

.bind-btn {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid #6366f1;
  background: transparent;
  color: #6366f1;
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.bind-btn:hover {
  background: #6366f1;
  color: #fff;
}

@media (max-width: 900px) {
  .detail-page {
    padding: 24px;
  }

  .binding-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .binding-grid.two {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .page-head {
    padding: 28px 24px;
  }

  .panel-head {
    align-items: stretch;
    flex-direction: column;
  }

  .primary-action {
    width: 100%;
  }

  .binding-grid {
    grid-template-columns: 1fr;
  }

  .source-head,
  .dialog-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .dialog-actions > span {
    margin-right: 0;
  }
}
</style>
