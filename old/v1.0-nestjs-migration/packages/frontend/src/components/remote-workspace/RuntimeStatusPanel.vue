<script setup lang="ts">
import type { RemoteWorkspaceStatus } from '@/api/remoteWorkspace'

defineProps<{
  status: RemoteWorkspaceStatus | null
  loading: boolean
  actionLoading: boolean
  error: string
  message: string
  openUrl: string
  label: (zh: string, en: string) => string
}>()

const emit = defineEmits<{
  probe: []
  open: []
  start: []
  stop: []
}>()
</script>

<template>
  <section class="runtime-panel">
    <div class="runtime-head">
      <div>
        <span class="eyebrow inline">{{ label('运行态', 'Runtime') }}</span>
        <h2>{{ label('code-server 探测', 'code-server Probe') }}</h2>
      </div>
      <div class="runtime-actions">
        <button class="secondary-btn" @click="emit('probe')">
          {{ loading ? label('探测中', 'Probing') : label('重新探测', 'Probe Again') }}
        </button>
        <button
          class="secondary-btn"
          :disabled="actionLoading || !status?.endpoint.reachable || !openUrl"
          @click="emit('open')"
        >
          {{ label('打开工作台', 'Open Workspace') }}
        </button>
        <button
          v-if="status?.endpoint.reachable"
          class="danger-btn"
          :disabled="actionLoading"
          @click="emit('stop')"
        >
          {{ actionLoading ? label('处理中', 'Working') : label('停止侧车', 'Stop') }}
        </button>
        <button
          v-else
          class="primary-btn"
          :disabled="actionLoading || !status"
          @click="emit('start')"
        >
          {{ actionLoading ? label('处理中', 'Working') : label('启动侧车', 'Start') }}
        </button>
      </div>
    </div>
    <p v-if="error" class="error-line">{{ error }}</p>
    <p v-if="message" class="info-line">{{ message }}</p>
    <div v-if="status" class="runtime-grid">
      <article class="runtime-card">
        <span>{{ label('接入状态', 'Integration') }}</span>
        <strong>{{ status.integration_state }}</strong>
        <small>{{ status.integration?.description || label('未登记能力', 'Capability not registered') }}</small>
      </article>
      <article class="runtime-card">
        <span>{{ label('健康检查', 'Health') }}</span>
        <strong :class="{ ok: status.endpoint.reachable }">
          {{ status.endpoint.reachable ? (status.endpoint.state || `OK ${status.endpoint.status_code ?? ''}`) : label('不可达', 'Offline') }}
        </strong>
        <small>{{ status.endpoint.url }}</small>
      </article>
      <article class="runtime-card">
        <span>{{ label('CLI', 'CLI') }}</span>
        <strong :class="{ ok: status.cli.available }">
          {{ status.cli.available ? (status.cli.version || 'found') : label('未找到', 'Missing') }}
        </strong>
        <small>{{ [status.cli.command, ...status.cli.args].join(' ') }}</small>
        <small v-if="!status.cli.available">{{ status.cli.install_hint }}</small>
        <div v-if="status.cli.candidates.length > 0" class="candidate-list">
          <span v-for="candidate in status.cli.candidates.slice(0, 4)" :key="candidate">
            {{ candidate }}
          </span>
        </div>
      </article>
      <article class="runtime-card">
        <span>{{ label('SSH 客户端', 'SSH Client') }}</span>
        <strong :class="{ ok: status.ssh.available }">
          {{ status.ssh.available ? (status.ssh.version || 'found') : label('未找到', 'Missing') }}
        </strong>
        <small>{{ [status.ssh.command, ...status.ssh.args].join(' ') }}</small>
        <small v-if="!status.ssh.available">{{ status.ssh.install_hint }}</small>
        <div v-if="status.ssh.candidates.length > 0" class="candidate-list">
          <span v-for="candidate in status.ssh.candidates.slice(0, 4)" :key="candidate">
            {{ candidate }}
          </span>
        </div>
      </article>
      <article class="runtime-card">
        <span>{{ label('源码内核', 'Source Kernel') }}</span>
        <strong :class="{ ok: status.kernel.available }">
          {{ status.kernel.available ? status.kernel.name : label('待接入', 'Pending') }}
        </strong>
        <small>{{ status.kernel.source_path }}</small>
        <small>{{ label('模式', 'Mode') }}: {{ status.kernel.mode }} · {{ label('状态', 'Status') }}: {{ status.kernel.status }}</small>
        <small v-if="status.kernel.error">{{ status.kernel.error }}</small>
        <div v-if="status.kernel.notes.length > 0" class="note-list">
          <small v-for="note in status.kernel.notes" :key="note">{{ note }}</small>
        </div>
      </article>
      <article class="runtime-card span-two">
        <span>{{ label('启动命令', 'Launch Command') }}</span>
        <code>{{ status.launch.command }}</code>
        <small>{{ status.launch.cwd }}</small>
        <div v-if="status.launch.notes.length > 0" class="note-list">
          <small v-for="note in status.launch.notes" :key="note">{{ note }}</small>
        </div>
      </article>
      <article class="runtime-card span-two">
        <span>{{ label('独立认证', 'Auth') }}</span>
        <strong>{{ status.auth.mode }}</strong>
        <small>{{ status.auth.owner }} · {{ status.auth.notes }}</small>
      </article>
    </div>
    <div v-else class="empty-line">{{ label('没有探测结果。', 'No probe result yet.') }}</div>
  </section>
</template>
