<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useLocale } from '@/composables/useLocale'
import { useStreamingControl } from '@/composables/useStreamingControl'

const route = useRoute()
const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')
const sessionId = computed(() => String(route.params.sessionId || 'default'))
const control = useStreamingControl(sessionId.value, 'viewer')
const controllerUrl = computed(() => {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/streaming/control/${sessionId.value}`
})

onMounted(() => {
  control.connect()
})

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}
</script>

<template>
  <main class="monitor-page">
    <header>
      <div>
        <span>Streaming Control Monitor</span>
        <h1>{{ label('控制事件接收端', 'Control Event Receiver') }}</h1>
      </div>
      <strong :class="{ ok: control.connected.value }">
        {{ control.connected.value ? label('已连接', 'Connected') : control.status.value }}
      </strong>
    </header>

    <section class="link-panel">
      <span>{{ label('手机控制器地址', 'Phone controller URL') }}</span>
      <code>{{ controllerUrl }}</code>
    </section>

    <section class="event-list">
      <article v-for="event in control.events.value" :key="event.id || `${event.action}-${event.at}`">
        <strong>{{ event.action }}</strong>
        <span>{{ event.kind }} · {{ event.at }}</span>
        <code>{{ JSON.stringify(event.value ?? null) }}</code>
      </article>
      <p v-if="control.events.value.length === 0">{{ label('等待手机控制器输入。', 'Waiting for phone controller input.') }}</p>
    </section>
  </main>
</template>

<style scoped>
.monitor-page {
  min-height: 100dvh;
  padding: 24px;
  background: #020617;
  color: #e2e8f0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

header,
.link-panel,
.event-list {
  border: 1px solid #1e293b;
  border-radius: 8px;
  background: #0f172a;
  padding: 16px;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

span {
  color: #94a3b8;
  font-size: 12px;
  font-weight: 900;
}

h1 {
  margin: 4px 0 0;
  font-size: 24px;
}

strong.ok {
  color: #5eead4;
}

.link-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

code {
  overflow-wrap: anywhere;
  color: #f8fafc;
}

.event-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

article {
  border: 1px solid #334155;
  border-radius: 8px;
  padding: 12px;
  display: grid;
  gap: 5px;
}

p {
  margin: 0;
  color: #94a3b8;
}
</style>
