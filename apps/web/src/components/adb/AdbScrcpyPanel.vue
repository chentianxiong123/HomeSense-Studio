<script setup lang="ts">
import type { AdbScrcpySession } from '@/api/streamingGateway'
import AdbRawH264Player from '@/components/stream/AdbRawH264Player.vue'

defineProps<{
  loading: boolean
  sessions: AdbScrcpySession[]
  maxSize: string
  bitRate: string
  maxFps: string
  v4l2Sink: string
  recordPath: string
  rawStreamSessionId: string
  rawStreamStatus: string
  rawStreamBytes: number
  label: (zh: string, en: string) => string
  formatBytes: (value?: number) => string
}>()

const emit = defineEmits<{
  'update:maxSize': [value: string]
  'update:bitRate': [value: string]
  'update:maxFps': [value: string]
  'update:v4l2Sink': [value: string]
  'update:recordPath': [value: string]
  refresh: []
  'create-bridge': []
  'create-desktop': []
  'create-record': []
  connect: [session: AdbScrcpySession]
  disconnect: []
  stop: [id: string]
  remove: [id: string]
}>()
</script>

<template>
  <div class="surface scrcpy-surface">
    <div class="surface-head">
      <h3>scrcpy</h3>
      <button class="ghost-btn" :disabled="loading" @click="emit('refresh')">{{ label('刷新', 'Refresh') }}</button>
    </div>
    <div class="scrcpy-form">
      <label>
        <span>{{ label('尺寸', 'Size') }}</span>
        <input :value="maxSize" placeholder="1280" @input="emit('update:maxSize', ($event.target as HTMLInputElement).value)" />
      </label>
      <label>
        <span>{{ label('码率', 'Bitrate') }}</span>
        <input :value="bitRate" placeholder="4M" @input="emit('update:bitRate', ($event.target as HTMLInputElement).value)" />
      </label>
      <label>
        <span>FPS</span>
        <input :value="maxFps" placeholder="30" @input="emit('update:maxFps', ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="wide-field">
        <span>V4L2</span>
        <input :value="v4l2Sink" placeholder="/dev/video2" @input="emit('update:v4l2Sink', ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="wide-field">
        <span>{{ label('录制', 'Record') }}</span>
        <input :value="recordPath" placeholder="D:\\captures\\phone.mp4" @input="emit('update:recordPath', ($event.target as HTMLInputElement).value)" />
      </label>
    </div>
    <div class="scrcpy-actions">
      <button :disabled="loading" @click="emit('create-bridge')">{{ label('准备浏览器桥', 'Prepare Bridge') }}</button>
      <button :disabled="loading" @click="emit('create-desktop')">{{ label('桌面启动', 'Desktop') }}</button>
      <button :disabled="loading" @click="emit('create-record')">{{ label('开始录制', 'Record') }}</button>
    </div>
    <div v-if="sessions.length === 0" class="empty-line compact">{{ label('暂无 scrcpy 会话。', 'No scrcpy sessions.') }}</div>
    <div v-else class="scrcpy-list">
      <div v-for="session in sessions" :key="session.id" class="scrcpy-row">
        <div>
          <strong>{{ session.label }}</strong>
          <code>{{ session.id }}</code>
          <span :class="['session-state', session.state]">{{ session.state }}</span>
          <p>{{ session.command.bridge_strategy }} · {{ session.command.profile }}</p>
          <p v-if="session.stream">
            {{ session.stream.mime }} · {{ session.stream.local_host }}:{{ session.stream.local_port }}
          </p>
          <code v-if="session.stream" class="command-line">{{ session.stream.ws_path }}</code>
          <p v-if="rawStreamSessionId === session.id" class="raw-stream-meter">
            {{ rawStreamStatus || label('流状态未知', 'Stream status unknown') }} · {{ formatBytes(rawStreamBytes) }}
          </p>
          <code class="command-line">{{ session.command.command_line }}</code>
          <p v-if="session.error" class="session-error">{{ session.error }}</p>
          <AdbRawH264Player v-if="session.stream" :ws-path="session.stream.ws_path" :label="label" />
        </div>
        <div class="session-actions">
          <button v-if="session.stream && rawStreamSessionId !== session.id" :disabled="loading" @click="emit('connect', session)">
            {{ label('连接流', 'Connect') }}
          </button>
          <button v-if="session.stream && rawStreamSessionId === session.id" @click="emit('disconnect')">
            {{ label('断开流', 'Disconnect') }}
          </button>
          <button :disabled="loading || ['exited', 'failed', 'stopped', 'prepared'].includes(session.state)" @click="emit('stop', session.id)">
            {{ label('停止', 'Stop') }}
          </button>
          <button :disabled="loading" @click="emit('remove', session.id)">
            {{ label('移除', 'Remove') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.surface {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  padding: 16px;
}

.surface-head {
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

h3 {
  margin: 0;
  color: #0f172a;
  font-size: 15px;
  letter-spacing: 0;
}

.ghost-btn {
  padding: 7px 11px;
}

.ghost-btn:hover:not(:disabled),
.scrcpy-actions button:hover:not(:disabled),
.session-actions button:hover:not(:disabled) {
  border-color: #2563eb;
  color: #1d4ed8;
  background: #eff6ff;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.scrcpy-form {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.scrcpy-form label {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
}

.scrcpy-form label span {
  color: #64748b;
  font-size: 12px;
  font-weight: 900;
}

.scrcpy-form input {
  min-width: 0;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  padding: 8px 10px;
  color: #0f172a;
  font: inherit;
  font-size: 13px;
}

.wide-field {
  grid-column: span 3;
}

.scrcpy-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0;
}

.scrcpy-actions button,
.session-actions button {
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  color: #334155;
  padding: 7px 10px;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.scrcpy-list {
  display: flex;
  max-height: 360px;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
}

.scrcpy-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  padding: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
}

.scrcpy-row strong,
.scrcpy-row code,
.scrcpy-row p {
  display: block;
  margin: 0 0 4px;
}

.scrcpy-row strong {
  color: #0f172a;
  font-size: 13px;
}

.command-line {
  max-height: 54px;
  overflow: auto;
  white-space: normal;
}

.session-state {
  display: inline-flex;
  width: fit-content;
  margin: 2px 0 6px;
  padding: 3px 7px;
  border-radius: 999px;
  background: #e2e8f0;
  color: #334155;
  font-size: 11px;
  font-weight: 900;
}

.session-state.running,
.session-state.starting {
  background: #dcfce7;
  color: #166534;
}

.session-state.failed {
  background: #fee2e2;
  color: #b91c1c;
}

.session-state.prepared {
  background: #fef3c7;
  color: #92400e;
}

.session-error {
  color: #dc2626;
  font-weight: 800;
}

.raw-stream-meter {
  width: fit-content;
  max-width: 100%;
  padding: 5px 8px;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 900;
}

.session-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.empty-line {
  padding: 36px 0;
  color: #64748b;
  font-size: 14px;
  font-weight: 700;
  text-align: center;
}

.empty-line.compact {
  padding: 18px 0;
}

@media (max-width: 720px) {
  .surface-head {
    align-items: stretch;
    flex-direction: column;
  }

  .scrcpy-form {
    grid-template-columns: 1fr;
  }

  .wide-field {
    grid-column: auto;
  }

  .scrcpy-row {
    grid-template-columns: 1fr;
  }
}
</style>
