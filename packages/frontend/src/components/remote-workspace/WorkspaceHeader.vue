<script setup lang="ts">
defineProps<{
  loading: boolean
  label: (zh: string, en: string) => string
}>()

const emit = defineEmits<{
  refresh: []
  openIntegrations: []
}>()
</script>

<template>
  <header class="workspace-head">
    <div>
      <span class="eyebrow">{{ label('远程工作台', 'Remote Workspace') }}</span>
      <h1>{{ label('NAS 本机工作区', 'NAS Local Workspace') }}</h1>
      <p>
        {{
          label(
            '这是家庭中枢自己的运行区：默认管理 NAS 本机源码、终端、文件和服务；SSH 只是扩展到局域网其他主机的高级能力。',
            'This is the home hub workspace: manage the NAS local source, terminal, files, and services by default; SSH is an advanced extension for other LAN hosts.',
          )
        }}
      </p>
    </div>
    <div class="head-actions">
      <button class="secondary-btn" @click="emit('refresh')">
        {{ loading ? label('刷新中', 'Refreshing') : label('刷新状态', 'Refresh') }}
      </button>
      <button class="primary-btn" @click="emit('openIntegrations')">
        {{ label('能力登记处', 'Integrations') }}
      </button>
    </div>
  </header>
</template>
