<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MoonlightWebRuntimeStatus, StreamingHost } from '@/api/streamingGateway'

const props = defineProps<{
  hosts: StreamingHost[]
  runtimeStatus: MoonlightWebRuntimeStatus | null
  label: (zh: string, en: string) => string
}>()

const emit = defineEmits<{
  registerHost: []
}>()

const selectedHostId = ref('')
const copyMessage = ref('')

const selectedHost = computed(() => {
  return props.hosts.find((host) => host.id === selectedHostId.value) || props.hosts[0] || null
})

const homesenseUrl = computed(() => {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/streaming`
})

const controlSessionId = computed(() => {
  return selectedHost.value ? `host-${selectedHost.value.id}` : 'default'
})

const controllerUrl = computed(() => {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/streaming/control/${controlSessionId.value}`
})

const monitorUrl = computed(() => {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/streaming/monitor/${controlSessionId.value}`
})

const viewerStatus = computed(() => {
  if (props.runtimeStatus?.reachable) return props.label('可打开', 'Ready')
  if (props.runtimeStatus?.registered) return props.label('运行时离线', 'Runtime offline')
  return props.label('待接运行时', 'Runtime pending')
})

async function copyText(value: string, success: string) {
  if (!value) return
  try {
    await navigator.clipboard?.writeText(value)
    copyMessage.value = success
  } catch {
    copyMessage.value = value
  }
  window.setTimeout(() => {
    copyMessage.value = ''
  }, 2400)
}

async function shareHomeSenseUrl() {
  if (!homesenseUrl.value) return
  const share = navigator.share
  if (share) {
    try {
      await share({
        title: 'HomeSense Streaming',
        url: homesenseUrl.value,
      })
      return
    } catch {}
  }
  await copyText(homesenseUrl.value, props.label('已复制 HomeSense 地址', 'HomeSense URL copied'))
}

function openUrl(url: string) {
  if (!url) return
  window.open(url, '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <section class="mobile-panel">
    <div class="mobile-head">
      <div>
        <span class="eyebrow inline">{{ label('手机', 'Mobile') }}</span>
        <h2>{{ label('手机操作入口', 'Mobile Access') }}</h2>
      </div>
      <button class="secondary-btn" type="button" @click="shareHomeSenseUrl">
        {{ label('发送到手机', 'Share') }}
      </button>
    </div>

    <div class="mobile-grid">
      <article class="mobile-card primary">
        <div class="card-head">
          <span>{{ viewerStatus }}</span>
          <strong>{{ label('浏览器屏幕', 'Browser Screen') }}</strong>
        </div>
        <code>{{ homesenseUrl }}</code>
        <div class="action-row">
          <button class="primary-btn" type="button" @click="shareHomeSenseUrl">
            {{ label('分享', 'Share') }}
          </button>
          <button class="secondary-btn" type="button" @click="copyText(homesenseUrl, label('已复制 HomeSense 地址', 'HomeSense URL copied'))">
            {{ label('复制地址', 'Copy URL') }}
          </button>
        </div>
      </article>

      <article class="mobile-card">
        <div class="card-head">
          <span>{{ selectedHost ? selectedHost.network_path : label('待登记', 'Pending') }}</span>
          <strong>Moonlight</strong>
        </div>
        <select v-if="hosts.length > 0" v-model="selectedHostId">
          <option value="">{{ label('默认主机', 'Default host') }}</option>
          <option v-for="host in hosts" :key="host.id" :value="host.id">
            {{ host.label }}
          </option>
        </select>
        <code v-if="selectedHost">{{ selectedHost.host }}:{{ selectedHost.web_port }}</code>
        <button v-if="selectedHost" class="secondary-btn" type="button" @click="copyText(`${selectedHost.host}:${selectedHost.web_port}`, label('已复制 Moonlight 主机地址', 'Moonlight host copied'))">
          {{ label('复制主机', 'Copy Host') }}
        </button>
        <button v-else class="secondary-btn" type="button" @click="emit('registerHost')">
          {{ label('登记主机', 'Register Host') }}
        </button>
      </article>

      <article class="mobile-card">
        <div class="card-head">
          <span>{{ controlSessionId }}</span>
          <strong>{{ label('手机控制器', 'Phone Controller') }}</strong>
        </div>
        <code>{{ controllerUrl }}</code>
        <div class="controller-pad" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div class="action-row">
          <button class="primary-btn" type="button" @click="openUrl(controllerUrl)">
            {{ label('打开控制器', 'Open Controller') }}
          </button>
          <button class="secondary-btn" type="button" @click="copyText(controllerUrl, label('已复制控制器地址', 'Controller URL copied'))">
            {{ label('复制', 'Copy') }}
          </button>
          <button class="secondary-btn" type="button" @click="openUrl(monitorUrl)">
            {{ label('接收端', 'Receiver') }}
          </button>
        </div>
      </article>
    </div>

    <p v-if="copyMessage" class="copy-line">{{ copyMessage }}</p>
  </section>
</template>

<style scoped>
.mobile-panel {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.mobile-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.eyebrow {
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
}

.eyebrow.inline {
  display: inline-flex;
  margin-bottom: 5px;
}

h2,
p {
  margin: 0;
}

h2 {
  color: var(--text-primary, #1e293b);
  font-size: 20px;
  font-weight: 900;
  letter-spacing: 0;
}

.mobile-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.mobile-card {
  min-width: 0;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 14px;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mobile-card.primary {
  background: #f0fdfa;
  border-color: #99f6e4;
}

.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.card-head span {
  border-radius: 999px;
  padding: 4px 8px;
  background: #e2e8f0;
  color: #475569;
  font-size: 11px;
  font-weight: 900;
}

.card-head strong {
  color: #0f172a;
  font-size: 14px;
  font-weight: 900;
  text-align: right;
}

code {
  min-width: 0;
  overflow-wrap: anywhere;
  border-radius: 6px;
  padding: 6px 8px;
  background: #e2e8f0;
  color: #0f172a;
  font-size: 12px;
}

select {
  width: 100%;
  min-height: 36px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 0 10px;
  background: #fff;
  color: #1e293b;
}

.action-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.primary-btn,
.secondary-btn {
  min-height: 36px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
  background: #fff;
  color: #334155;
}

.primary-btn {
  border-color: #0f766e;
  background: #0f766e;
  color: #fff;
}

.controller-pad {
  width: 112px;
  height: 72px;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.controller-pad span {
  border-radius: 999px;
  background: #dbeafe;
  border: 1px solid #bfdbfe;
}

small,
.copy-line {
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}

.copy-line {
  border: 1px solid #ccfbf1;
  border-radius: 8px;
  background: #f0fdfa;
  padding: 10px 12px;
  color: #0f766e;
  font-weight: 900;
}

@media (max-width: 900px) {
  .mobile-grid {
    grid-template-columns: 1fr;
  }

  .mobile-head {
    flex-direction: column;
  }
}
</style>
