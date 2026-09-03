<script setup lang="ts">
defineProps<{
  filesystemReady: boolean
  readySshTargetCount: number
  registeredLaneCount: number
  laneCount: number
  loading: boolean
  label: (zh: string, en: string) => string
}>()

const emit = defineEmits<{
  goFiles: []
  goTerminal: []
  goRemote: []
}>()
</script>

<template>
  <section class="summary-strip">
    <div class="summary-item">
      <span>{{ label('主路径', 'Primary Path') }}</span>
      <strong>{{ label('本机 NAS', 'Local NAS') }}</strong>
    </div>
    <button class="summary-item summary-action" @click="emit('goFiles')">
      <span>{{ label('文件树', 'Filesystem') }}</span>
      <strong>{{ filesystemReady ? label('已连接', 'Connected') : label('读取中', 'Loading') }}</strong>
    </button>
    <button class="summary-item summary-action" @click="emit('goTerminal')">
      <span>{{ label('终端内核', 'Terminal Core') }}</span>
      <strong>PTY</strong>
    </button>
    <button class="summary-item summary-action" @click="emit('goRemote')">
      <span>{{ label('远程主机', 'Remote Hosts') }}</span>
      <strong>{{ readySshTargetCount }}</strong>
    </button>
    <div class="summary-item">
      <span>{{ label('接入分区', 'Lanes') }}</span>
      <strong>{{ registeredLaneCount }}/{{ laneCount }}</strong>
    </div>
    <div class="summary-item">
      <span>{{ label('状态', 'Status') }}</span>
      <strong>{{ loading ? label('检查中', 'Checking') : label('框架已开口', 'Framework opened') }}</strong>
    </div>
  </section>
</template>
