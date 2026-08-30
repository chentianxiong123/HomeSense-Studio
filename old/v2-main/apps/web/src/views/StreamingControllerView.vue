<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useLocale } from '@/composables/useLocale'
import { useStreamingControl, type StreamingControlEvent } from '@/composables/useStreamingControl'

const route = useRoute()
const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')
const sessionId = computed(() => String(route.params.sessionId || route.query.session || 'default'))
const textInput = ref('')
const control = useStreamingControl(sessionId.value, 'controller')

onMounted(() => {
  control.connect()
})

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

function send(event: StreamingControlEvent) {
  control.sendControl(event)
  if ('vibrate' in navigator) {
    try { navigator.vibrate?.(18) } catch {}
  }
}

function sendButton(action: string) {
  send({ kind: 'button', action, value: 1 })
}

function sendAxis(action: string, x: number, y: number) {
  send({ kind: 'axis', action, value: { x, y } })
}

function sendText() {
  const value = textInput.value
  if (!value) return
  send({ kind: 'text', action: 'text.input', value })
  textInput.value = ''
}
</script>

<template>
  <main class="controller-page">
    <header class="controller-head">
      <div>
        <span class="eyebrow">Controller</span>
        <h1>{{ label('手机控制器', 'Phone Controller') }}</h1>
      </div>
      <div class="status-pill" :class="control.connected.value ? 'ok' : 'bad'">
        {{ control.connected.value ? label('已连接', 'Connected') : control.status.value }}
      </div>
    </header>

    <section class="session-strip">
      <span>{{ label('会话', 'Session') }}</span>
      <code>{{ sessionId }}</code>
      <small>{{ label('控制器', 'Controllers') }} {{ control.peers.value.controllers }} · {{ label('视图', 'Viewers') }} {{ control.peers.value.viewers }}</small>
    </section>

    <section class="pad-layout">
      <div class="dpad" aria-label="direction pad">
        <button class="pad-btn up" @click="sendAxis('stick.left', 0, -1)">↑</button>
        <button class="pad-btn left" @click="sendAxis('stick.left', -1, 0)">←</button>
        <button class="pad-btn center" @click="sendAxis('stick.left', 0, 0)">•</button>
        <button class="pad-btn right" @click="sendAxis('stick.left', 1, 0)">→</button>
        <button class="pad-btn down" @click="sendAxis('stick.left', 0, 1)">↓</button>
      </div>

      <div class="face-buttons" aria-label="action buttons">
        <button class="face-btn y" @click="sendButton('button.y')">Y</button>
        <button class="face-btn x" @click="sendButton('button.x')">X</button>
        <button class="face-btn b" @click="sendButton('button.b')">B</button>
        <button class="face-btn a" @click="sendButton('button.a')">A</button>
      </div>
    </section>

    <section class="shoulder-row">
      <button @click="sendButton('button.lb')">LB</button>
      <button @click="sendButton('button.rb')">RB</button>
      <button @click="sendButton('button.lt')">LT</button>
      <button @click="sendButton('button.rt')">RT</button>
    </section>

    <section class="system-row">
      <button @click="sendButton('button.select')">{{ label('选择', 'Select') }}</button>
      <button @click="sendButton('button.start')">{{ label('开始', 'Start') }}</button>
      <button @click="send({ kind: 'system', action: 'viewer.fullscreen' })">{{ label('全屏', 'Fullscreen') }}</button>
    </section>

    <form class="text-row" @submit.prevent="sendText">
      <input v-model="textInput" :placeholder="label('发送文字到串流视图', 'Send text to stream viewer')" />
      <button type="submit">{{ label('发送', 'Send') }}</button>
    </form>

    <p v-if="control.error.value" class="error-line">{{ control.error.value }}</p>
  </main>
</template>

<style scoped>
.controller-page {
  min-height: 100dvh;
  padding: calc(16px + env(safe-area-inset-top, 0px)) 16px calc(24px + env(safe-area-inset-bottom, 0px));
  background: #0f172a;
  color: #f8fafc;
  display: flex;
  flex-direction: column;
  gap: 14px;
  touch-action: manipulation;
  user-select: none;
}

.controller-head,
.session-strip,
.pad-layout,
.shoulder-row,
.system-row,
.text-row {
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.82);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.22);
}

.controller-head {
  padding: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.eyebrow {
  color: #5eead4;
  font-size: 11px;
  font-weight: 900;
}

h1 {
  margin: 4px 0 0;
  font-size: 24px;
  letter-spacing: 0;
}

.status-pill {
  border-radius: 999px;
  padding: 7px 10px;
  background: #334155;
  color: #cbd5e1;
  font-size: 12px;
  font-weight: 900;
}

.status-pill.ok {
  background: #064e3b;
  color: #a7f3d0;
}

.status-pill.bad {
  background: #7f1d1d;
  color: #fecaca;
}

.session-strip {
  padding: 10px 12px;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 8px;
  align-items: center;
}

.session-strip span,
.session-strip small {
  color: #94a3b8;
  font-size: 12px;
  font-weight: 900;
}

code {
  min-width: 0;
  overflow-wrap: anywhere;
  color: #e2e8f0;
  font-size: 12px;
}

.pad-layout {
  padding: 18px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  align-items: center;
}

.dpad,
.face-buttons {
  aspect-ratio: 1;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: 8px;
}

button {
  border: 1px solid rgba(148, 163, 184, 0.32);
  border-radius: 8px;
  background: #1e293b;
  color: #f8fafc;
  font: inherit;
  font-size: 14px;
  font-weight: 900;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

button:active {
  transform: translateY(1px);
  background: #0f766e;
  border-color: #2dd4bf;
}

.pad-btn.up { grid-column: 2; grid-row: 1; }
.pad-btn.left { grid-column: 1; grid-row: 2; }
.pad-btn.center { grid-column: 2; grid-row: 2; }
.pad-btn.right { grid-column: 3; grid-row: 2; }
.pad-btn.down { grid-column: 2; grid-row: 3; }

.face-btn.y { grid-column: 2; grid-row: 1; }
.face-btn.x { grid-column: 1; grid-row: 2; }
.face-btn.b { grid-column: 3; grid-row: 2; }
.face-btn.a { grid-column: 2; grid-row: 3; }

.face-btn.a { background: #14532d; }
.face-btn.b { background: #7f1d1d; }
.face-btn.x { background: #1e3a8a; }
.face-btn.y { background: #713f12; }

.shoulder-row,
.system-row,
.text-row {
  padding: 10px;
  display: grid;
  gap: 8px;
}

.shoulder-row {
  grid-template-columns: repeat(4, 1fr);
}

.system-row {
  grid-template-columns: repeat(3, 1fr);
}

.text-row {
  grid-template-columns: 1fr auto;
}

input {
  min-width: 0;
  min-height: 42px;
  border: 1px solid rgba(148, 163, 184, 0.32);
  border-radius: 8px;
  background: #020617;
  color: #f8fafc;
  padding: 0 12px;
  font-size: 15px;
}

.error-line {
  border: 1px solid #7f1d1d;
  border-radius: 8px;
  background: #450a0a;
  color: #fecaca;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 900;
}

@media (orientation: landscape) and (max-height: 620px) {
  .controller-page {
    display: grid;
    grid-template-columns: 1fr 1.2fr;
    grid-auto-rows: min-content;
  }

  .pad-layout {
    grid-row: span 4;
  }
}
</style>
