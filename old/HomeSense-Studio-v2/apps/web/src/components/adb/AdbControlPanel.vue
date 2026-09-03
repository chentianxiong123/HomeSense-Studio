<script setup lang="ts">
type AdbOverview = {
  name?: string
  manufacturer?: string
  brand?: string
  model?: string
  android_version?: string
  sdk_version?: string
  screen?: { resolution?: string; density?: string }
  memory?: { total?: number; used?: number; available?: number }
  storage?: { total?: number; used?: number; available?: number }
  battery?: { level?: number; temperature_c?: number; voltage_mv?: number; status?: string }
  network?: { ip?: string; mac?: string }
} | null

defineProps<{
  adbIp: string
  busy: boolean
  textInput: string
  tapInput: string
  overviewLoading: boolean
  overview: AdbOverview
  currentApp: { current_app?: string; activity?: string; raw_line?: string } | null
  label: (zh: string, en: string) => string
  usageText: (value?: { total?: number; used?: number }) => string
}>()

defineEmits<{
  check: []
  quickKey: [action: string, successLabel: string]
  sendText: []
  tapPoint: []
  refreshOverview: []
  'update:textInput': [value: string]
  'update:tapInput': [value: string]
}>()
</script>

<template>
  <div class="panel-grid">
    <div class="surface primary-control">
      <div class="surface-head">
        <h3>{{ label('遥控与输入', 'Remote And Input') }}</h3>
        <button class="ghost-btn" :disabled="busy" @click="$emit('check')">{{ label('检查连接', 'Check') }}</button>
      </div>
      <div class="remote-grid">
        <button :disabled="busy" @click="$emit('quickKey', 'home', label('已返回主页', 'Home sent'))">Home</button>
        <button :disabled="busy" @click="$emit('quickKey', 'back', label('已返回', 'Back sent'))">Back</button>
        <button :disabled="busy" @click="$emit('quickKey', 'enter', label('已确认', 'Enter sent'))">Enter</button>
        <button :disabled="busy" @click="$emit('quickKey', 'volume_up', label('音量已增加', 'Volume up sent'))">Vol +</button>
        <button :disabled="busy" @click="$emit('quickKey', 'volume_down', label('音量已降低', 'Volume down sent'))">Vol -</button>
        <button :disabled="busy" @click="$emit('quickKey', 'power', label('电源键已发送', 'Power sent'))">Power</button>
      </div>
      <div class="inline-form">
        <input
          :value="textInput"
          :placeholder="label('输入文本', 'Input text')"
          @input="$emit('update:textInput', ($event.target as HTMLInputElement).value)"
          @keydown.enter="$emit('sendText')"
        />
        <button :disabled="busy || !textInput.trim()" @click="$emit('sendText')">{{ label('发送', 'Send') }}</button>
      </div>
      <div class="inline-form">
        <input
          :value="tapInput"
          placeholder="540,960"
          @input="$emit('update:tapInput', ($event.target as HTMLInputElement).value)"
          @keydown.enter="$emit('tapPoint')"
        />
        <button :disabled="busy || !tapInput.trim()" @click="$emit('tapPoint')">{{ label('点击坐标', 'Tap') }}</button>
      </div>
    </div>

    <div class="surface stack-surface">
      <div class="surface-head">
        <h3>{{ label('设备概览', 'Device Overview') }}</h3>
        <button class="ghost-btn" :disabled="overviewLoading" @click="$emit('refreshOverview')">{{ overviewLoading ? label('读取中', 'Loading') : label('刷新', 'Refresh') }}</button>
      </div>
      <div class="state-list">
        <div>
          <span>{{ label('设备', 'Device') }}</span>
          <strong>{{ overview?.name || adbIp }}</strong>
        </div>
        <div>
          <span>Android</span>
          <strong>{{ overview?.android_version ? `Android ${overview.android_version} (API ${overview.sdk_version || '-'})` : '-' }}</strong>
        </div>
        <div>
          <span>{{ label('型号', 'Model') }}</span>
          <strong>{{ overview?.manufacturer || overview?.brand || '-' }} {{ overview?.model || '' }}</strong>
        </div>
        <div>
          <span>{{ label('屏幕', 'Screen') }}</span>
          <strong>{{ overview?.screen?.resolution || '-' }} <small v-if="overview?.screen?.density">{{ overview.screen.density }} dpi</small></strong>
        </div>
        <div>
          <span>{{ label('内存', 'Memory') }}</span>
          <strong>{{ usageText(overview?.memory) }}</strong>
        </div>
        <div>
          <span>{{ label('存储', 'Storage') }}</span>
          <strong>{{ usageText(overview?.storage) }}</strong>
        </div>
        <div>
          <span>{{ label('电池', 'Battery') }}</span>
          <strong>{{ overview?.battery?.level ? `${overview.battery.level}%` : '-' }} <small v-if="overview?.battery?.temperature_c">{{ overview.battery.temperature_c }} C</small></strong>
        </div>
        <div>
          <span>{{ label('网络', 'Network') }}</span>
          <code>{{ overview?.network?.ip || '-' }} {{ overview?.network?.mac || '' }}</code>
        </div>
        <div>
          <span>{{ label('当前应用', 'Current App') }}</span>
          <code>{{ currentApp?.current_app || label('未读取', 'Not loaded') }}</code>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
  gap: 14px;
}

.surface {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  padding: 16px;
}

.surface-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

h3 {
  margin: 0;
  color: #0f172a;
  font-size: 15px;
  letter-spacing: 0;
}

code {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  color: #475569;
  overflow-wrap: anywhere;
}

.ghost-btn,
.inline-form button,
.remote-grid button {
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  color: #334155;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.ghost-btn {
  padding: 7px 11px;
}

.ghost-btn:hover:not(:disabled),
.inline-form button:hover:not(:disabled),
.remote-grid button:hover:not(:disabled) {
  border-color: #2563eb;
  color: #1d4ed8;
  background: #eff6ff;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.remote-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}

.remote-grid button {
  min-height: 40px;
}

.inline-form {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.inline-form input {
  flex: 1;
  min-width: 0;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  padding: 9px 11px;
  color: #0f172a;
  font: inherit;
  font-size: 14px;
}

.inline-form button {
  padding: 8px 12px;
}

.state-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.state-list div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.state-list span {
  color: #64748b;
  font-size: 12px;
  font-weight: 800;
}

.state-list strong {
  color: #0f172a;
  font-size: 14px;
}

@media (max-width: 900px) {
  .surface-head {
    align-items: stretch;
    flex-direction: column;
  }

  .panel-grid {
    grid-template-columns: 1fr;
  }

  .remote-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
